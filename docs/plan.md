# Lantern build plan

An interactive site that teaches how packets move through networks, in the
Architecture Notes voice: one new notion at a time, the reader presses send,
the scene grows, and every exchange is a real simulation that can be opened
in Wireshark.

Companion doc: `engine-design.md` holds the engine internals. This document
is the plan: architecture, libraries, phases, and the review gate for each.

## Architecture

```
  packages/
    engine/    generic forwarding plane. config in, events + frames out.
               zero runtime deps. runs in Node and in the browser.
    web/       React + React Flow. renders a config as a scene, steps the
               event log, shows narration, downloads the pcap.
    lessons/   JSON scenarios plus narration markdown. no code.
    server/    Hono HTTP wrapper over engine. runs scenarios, serves
               pcaps, and later hosts the LLM diagram-to-config step.
```

Data flow for a lesson:

```
  lesson.json ─► resolve() ─► Network ─► simulate(actions) ─► { events[], frames{} }
                                                                   │
                                     ┌─────────────────────────────┼──────────────┐
                                     ▼                             ▼              ▼
                              React Flow scene              step narration     pcap writer
                              (nodes, links, moving frame)  (keyed by event)   (one merged file)
```

Principles carried from the engine design:

- **Engine is a generic forwarding plane.** Every node is configured the way
  a real box is: `ip addr`, `ip route`, `ip neigh`. Host, router, switch.
  RFC-shaped input and output for Ethernet II, ARP, IPv4, ICMP echo and
  time exceeded, without implementing the full RFCs.
- **The event log is the single source of truth.** UI, narration, and pcap
  all derive from it. Deterministic: same config and actions, same bytes.
- **Partial configs resolve deterministically.** That resolver is the seam
  a later LLM plugs into.
- **Lessons are data.** The engine never sees narration.

### Where the engine runs

On the server, from day one. The engine could run in the browser, but a
backend is where inference will run later and keeping it there leaves room
to grow the idea. The web package never imports the engine; it talks to
`POST /runs` and `GET /runs/{id}/pcap`.

### Where narration lives

One directory per lesson, one markdown file per narration slot, named by
the slot it fills, so each can be reviewed and rewritten on its own:

```
  packages/lessons/01-two-hosts/
    lesson.json        title and one-line summary
    scenario.json
    narration/
      intro.md
      route.lookup.md
      arp.miss.md
      arp.learn.md
      icmp.reply.md
      outro.md
```

A slot named after an event kind fires on every event of that kind; a slot
named `seq-12.md` fires once, on that step. Placeholders are drafted in the
Architecture Notes voice for you to replace.

Some things are taught in prose only because the scenarios are too short
to show them: ARP entries expiring and being refreshed all the time, and
how an unsolicited ARP reply can poison a cache so a client believes an
attacker is its gateway. These get an aside slot in lesson 1, not engine
support.

## Libraries

| package | library | version | why |
|---------|---------|---------|-----|
| all | TypeScript, strict | 7.0 | shared types across engine and web |
| all | pnpm workspaces | 11.13 | one repo, three packages |
| all | Biome | 2.5 | lint and format in one tool, one config |
| all | Vitest | 5.0 | tests, same runner for engine and web |
| engine | Zod | 4.6 | config schema is the contract; validation and inferred types from one source |
| all | LogTape | 2.3 | structured logging. Built for libraries: the engine logs under the `lantern.engine` category with no sink configured, and the server (or a test) decides where it goes |
| engine | none at runtime | | encoders and pcap writer are hand-rolled, about 300 lines |
| engine tests | tshark | 4.6 | Wireshark's dissector verifies every emitted pcap. Not a project dependency: run the tests under `nix shell nixpkgs#wireshark-cli` when it is not on the PATH |
| web | React | 19 | |
| web | Vite | 8 | dev server and static build |
| web | @xyflow/react (React Flow) | 12.11 | scene graph: nodes, edges, custom node renderers |
| server | Hono | 4.13 | thin, typed, runs anywhere |

Not chosen: scapy or gopacket equivalents in TS do not exist at a quality
worth depending on. tshark covers the verification gap they would have
filled.

## Working agreement

- **TDD from the first line.** Each phase lists its tests before its code.
  Red, green, refactor. No engine behavior lands without a test that
  describes it in terms of the network, not the implementation.
- **Review gate at the end of every phase.** I stop, summarize what landed,
  show test output, and wait. Nothing from the next phase starts before
  sign-off.
- **Commits per logical unit** using comet, confirmed before each commit.
- **Lesson prose is yours.** I wire narration slots; you fill them in your
  voice. I can draft placeholders so the stepper is testable.

## Phases

Each phase ends with a review gate. Lesson 1 goes all the way to the
screen before lessons 2 and 3 get engine work, so there is something to
look at early; after that the engine grows the same way the reader's
understanding does.

### Phase 0. Workspace

Scaffold `packages/engine`, `packages/server`, `packages/web`, and
`packages/lessons` in a pnpm workspace with Biome, Vitest, and strict
TypeScript. One placeholder test per code package. The pcap tests call
`tshark` from the PATH and fail with a pointer to
`nix shell nixpkgs#wireshark-cli -c pnpm test` if it is missing, rather
than silently skipping.

Verify: `pnpm lint`, `pnpm typecheck`, `pnpm test` all green from the root.

### Phase 1. Config schema, resolver, validation

The contract everything else depends on.

Tests first:
- a full hand-written config parses and round-trips unchanged
- a bare config (nodes and links, no addresses) resolves to the documented
  MACs, /24s, connected routes, and default routes, byte-for-byte stable
- two hosts joined by a switch land in one /24; two hosts either side of a
  router land in two
- duplicate MAC, IP outside its subnet, dangling link, and unreachable next
  hop each produce one named validation error

Then: Zod schema for `NetworkSpec` and `Network`, `resolve()`, validation.

### Phase 2. Wire formats and pcap

Bytes that Wireshark agrees with.

Tests first:
- Ethernet II, ARP request/reply, IPv4, ICMP echo request/reply, ICMP time
  exceeded each encode to known-good byte vectors
- IPv4 and ICMP checksums match RFC 1071 test values
- a pcap containing one ARP pair and one echo pair is read back by
  `tshark -r` and dissected as exactly those four packets, with `-z io,phs`
  showing no malformed frames

Then: encoders, checksum, legacy pcap writer.

### Phase 3. Lesson 1, two hosts and a cable

The first demo step: ARP, then ping, with nothing else in the way.

Tests first:
- pinging a neighbor with an empty ARP table produces, in order: route
  lookup, ARP miss, ARP request tx (broadcast), ARP rx and learn on the
  peer, ARP reply, ARP learn on the sender, echo request, echo reply
- a second ping produces no ARP events
- a pre-seeded `neighbors` entry produces no ARP events on the first ping
- pinging an address with no route emits one `drop` with reason `no-route`
- the merged pcap contains every frame once, in time order, and tshark
  dissects it cleanly
- the log is identical across two runs

Then: discrete event loop, host behavior, ARP state machine, echo.

### Phase 4. Server

Tests first:
- `POST /runs` with the lesson 1 scenario returns the resolved network,
  events, and frames, identical to calling the engine directly
- `POST /runs` with an invalid scenario returns 400 and the validation
  errors by name
- `GET /runs/{id}/pcap` returns `application/vnd.tcpdump.pcap` bytes that
  tshark dissects cleanly
- `GET /lessons` lists lessons; `GET /lessons/{id}` returns scenario plus
  narration slots

Then: Hono app, in-memory run store, lesson loader.

### Phase 5. Web, lesson 1 on screen

First time the reader sees anything.

Tests first (Vitest with Testing Library, server mocked at the fetch
boundary):
- a resolved config renders one React Flow node per host and one edge per
  link
- pressing send posts the scenario and the stepper shows step 1 of N
- next and previous move through events; the narration slot for the current
  event kind is shown
- the pcap download produces the same bytes the engine test verified

Then: scene layout, custom node renderer showing ARP table and routes as
they change, frame-in-flight animation on the edge, stepper, narration
panel, download button. Prose placeholders in your voice for you to
replace.

### Phase 6. Lesson 2, through a router, then a switch

The second demo step, taught as two scenes. Scene one is host, router,
host: two subnets, the packet's MACs change and its IPs do not. Scene two
adds a switch between the first host and the router, reinforcing the ARP
and MAC ideas from lesson 1 with one new box.

Tests first:
- host A pings host B across router R: A ARPs for R, not B; R ARPs for B;
  the echo request's source and destination IPs are unchanged at every hop
  while the MACs are rewritten; TTL is 64 leaving A and 63 leaving R
- the reply path mirrors it and R's ARP table now holds both hosts
- a switch between A and R learns A's MAC on the first frame, floods the
  first ARP request, and unicasts the reply
- the merged capture shows the echo request twice, once with A's MACs and
  once with R's, with identical IP headers apart from TTL and checksum

Then: router forwarding, TTL decrement, switch learning and flooding.

### Phase 7. Lesson 3, many routers and TTL

The third demo step: a chain of routers, and what TTL is actually for.

Tests first:
- a ping across three routers arrives with TTL 61
- a ping sent with TTL 2 dies at the second router, which emits ICMP time
  exceeded back to the source, and the source logs it
- a traceroute action (TTL 1, 2, 3, ...) yields one time-exceeded per router
  then an echo reply
- a routing loop between two routers is cut by TTL reaching zero, never by a
  hop limit in the simulator

Then: time exceeded generation, traceroute action.

### Phase 8. Web, lessons 2 and 3

Routers and switches on screen, a TTL counter on the packet, time exceeded
drawn as a packet going backwards. Lesson picker so the scene grows across
lessons rather than resetting.

### Phase 9. Content and polish

You write the narration. I match Architecture Notes typography and spacing,
handle phone width, dark mode, reduced motion. End-to-end pass on every
lesson from a clean load.

### Phase 10, stretch. Out to the internet

Needs primitives the first three lessons do not: NAT on the home router,
and probably DNS. Scoped only after phase 9; not designed yet on purpose.

### Later. Playground and LLM

A diagram or prose description goes to an LLM on the server, which emits a
partial `NetworkSpec` that hits the same `resolve` and validation as
everything else. Deferred until the lessons ship.

## Decisions taken

- Engine runs on the server from day one; the web package only talks HTTP.
- Lesson 2 is two scenes: plain router first, then a switch added.
- Narration placeholders are drafted in your voice, one markdown file per
  slot, for you to rewrite.
