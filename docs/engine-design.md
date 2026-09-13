# Lantern engine design

The engine is a generic forwarding plane written in TypeScript. It knows
nothing about lessons. A network where every node is configured the way a
real box is goes in, and an ordered event log plus a set of raw frames come
out. The HTTP API, the pcap export, and the lesson narration all sit on top
of it and never reach inside.

```
  scenario (topology + actions)
          |
          v
  +---------------+      events[]      +-----------+     +-----------+
  |    engine     | ----------------> | frontend  |     |   pcap    |
  | (pure, det.)  | ----------------> | stepper   |     |  writer   |
  +---------------+      frames[]      +-----------+     +-----------+
```

## 1. Network configuration

Every node is described the way you would read it off a Linux machine.

| command | config key | contents |
|---------|-----------|----------|
| `ip addr` | `interfaces` | name, MAC, IP with prefix, which link it is plugged into |
| `ip route` | `routes` | static routing table: connected, static, default |
| `ip neigh` | `neighbors` | ARP table, optionally pre-seeded |

```json
{
  "id": "r1",
  "kind": "router",
  "interfaces": [
    { "name": "eth0", "mac": "02:00:00:00:00:03", "ip": "10.0.1.1/24", "link": "l1" },
    { "name": "eth1", "mac": "02:00:00:00:00:04", "ip": "10.0.2.1/24", "link": "l2" }
  ],
  "routes": [
    { "dst": "10.0.1.0/24", "dev": "eth0" },
    { "dst": "10.0.2.0/24", "dev": "eth1" },
    { "dst": "10.0.3.0/24", "via": "10.0.2.2" }
  ],
  "neighbors": []
}
```

Three node kinds, each with one generic behavior.

| kind | behavior |
|------|----------|
| `host` | accepts frames for its MAC or broadcast, resolves next hops with ARP, answers echo |
| `router` | everything a host does, plus forwards IP packets with TTL decrement |
| `switch` | no IP config; learns source MAC per port, forwards to the learned port or floods |

A `link` is always exactly two endpoints, like a cable. Each endpoint is a
`node/interface` pair. A switch's interfaces are its ports and carry
neither IP nor MAC: a transparent bridge learns and forwards by the MACs in
the hosts' frames and never writes its own address into one.
A LAN is a switch plus cables. Two hosts back to back is one cable.

```json
{ "id": "l1", "a": "laptop/eth0", "b": "r1/eth0", "latency_us": 1000 }
```

### Partial configs and the LLM seam

Any of `mac`, `ip`, `routes`, and `neighbors` may be omitted.
`resolve(spec) -> Network` fills them deterministically:

- MACs for host and router interfaces from a fixed locally-administered
  OUI plus a counter in declaration order; switch ports get none
- one /24 per broadcast domain (the set of links joined by switches), hosts
  numbered in declaration order
- connected routes for every interface, a host default route to the first
  router in its broadcast domain, router static routes by shortest path
- `neighbors` left empty unless declared

Any producer of a partial config (hand-written JSON, a future LLM diagram
parser, a playground UI) hits the same `resolve` and the same validation.
That is the whole LLM integration point.

Validation rejects duplicate MACs, IPs outside a connected route, interfaces
on unknown links, links with more or fewer than two endpoints, and gateways
that do not resolve.

A gateway resolves the way a router builds its FIB: look the gateway up in
the same table, recursively, until a connected route is reached. So
`10.0.3.0/24 via 192.168.5.1` is valid when `192.168.5.0/24 via 10.0.1.1`
exists and `10.0.1.0/24` is connected. The invariant the engine needs is
only that, when a packet leaves, the node can name an interface and an
address to ARP for. `onlink` is not modeled; add it if a lesson needs a
gateway off every connected subnet.

The complete schema is in Appendix A.

## 2. Node state

Runtime state starts from the config and mutates as traffic flows.

- `neighbors`: the ARP table, `ip -> {mac, dev}`. Persists across actions in
  a scenario so the second ping shows no ARP, which is itself a lesson.
  Entries never age out. Real tables expire entries and refresh them
  constantly; the lesson text says so rather than the simulation showing
  it, since the scenarios are too short for it to matter.
- `routes`: longest-prefix match. Same table shape for hosts and routers.
- `mac_table` (switch only): `mac -> port`.
- `pending`: packets parked while an ARP request is outstanding. There is
  no ARP timeout: every address a lesson pings is owned by someone. Add a
  timer and an `arp-timeout` drop when a lesson wants "destination host
  unreachable".

## 3. Simulation

Discrete event simulation with a priority queue keyed by logical time.
Deterministic: same scenario, same log, byte for byte.

Time only exists to order things and to give pcap timestamps. A link
delivers a frame `latency_us` after it is sent; a node takes
`PROCESSING_US`, an engine constant, to handle one.

Simulated time and wall-clock time are separate. When the reader presses
play instead of stepping, the UI waits `PLAY_STEP_MS` between events, a
web-side constant with a default the lesson may override. Simulated
microseconds never drive the animation.

Protocols in v1: Ethernet II, ARP, IPv4, ICMP echo and time exceeded.
TTL is decremented at every router; TTL 0 produces ICMP time exceeded back
to the source, which gives traceroute for free in lesson 3.

## 4. Actions

A scenario is a network config plus an ordered list of actions.

```json
{
  "action": "ping",
  "from": { "name": "laptop", "ip": "10.0.1.10" },
  "to":   { "name": "server", "ip": "10.0.2.10" },
  "ttl": 64,
  "count": 1
}
```

`from` and `to` are always addressed by IP. The engine finds the node that
owns `from.ip` and uses that interface as the source. `name` is optional
and exists for lessons and the UI; the engine ignores it.

`ping` is the only action in v1. `traceroute` is `ping` with `ttl` 1..n and
falls out of the same code.

## 5. Event log

The log is the single source of truth. The UI steps through it; the pcap
is cut from it. Every event has `seq`, `t_us`, `node`, `kind`, and `action`,
the index of the action that produced it, so the stepper knows where the
second ping or the next traceroute probe begins. Frame events also carry
`frame`, `dev`, and `link`; the frame's decoded summary lives in
`frames[id]` so the UI never parses bytes.

Events are trace data for the UI and narration only. The pcap writer reads
nothing from them except which frame ids to emit and when. Frame bytes are
built by the protocol encoders and never carry event fields, sequence
numbers, or anything else that is not on the wire.

| kind | meaning |
|------|---------|
| `route.lookup` | node chose an outgoing iface and next hop for a destination |
| `arp.miss` | no cache entry for next hop; packet parked |
| `arp.hit` | cache entry found |
| `arp.learn` | cache entry written from a request or reply |
| `arp.reply` | request was for one of our IPs; reply generated |
| `frame.tx` | frame left an interface |
| `frame.rx` | frame arrived at an interface |
| `switch.learn` | switch recorded source MAC on a port |
| `switch.flood` | switch had no entry for destination MAC |
| `ttl.decrement` | router lowered TTL |
| `ttl.expired` | TTL hit zero; time exceeded generated |
| `icmp.reply` | echo reply generated |
| `icmp.recv` | echo reply or time exceeded arrived at the original sender |
| `drop` | packet discarded, with a reason |

Frames are stored once, keyed by `frame` id, as raw bytes. The same frame
appears in one `frame.tx` and one or more `frame.rx` events. A frame that
arrives and is not wanted, such as an ARP request for someone else's IP,
is a `frame.rx` followed by a `drop`.

## 6. pcap

One merged capture per run, ordered by `t_us`. Each frame id appears once,
at its first `frame.tx`, so a switch forwarding a frame unchanged does not
duplicate it while a router's rewritten frame, which is a new id, does
appear. The writer takes `(t_us, bytes)` pairs and nothing else; no event
metadata reaches the file. The MAC change either side of a router is taught in the lesson
itself, not by comparing captures. Legacy pcap format, link type 1,
microsecond timestamps from `t_us`.

## 7. Lessons sit outside

A lesson is `{ scenario, narration }`. Narration attaches prose to steps by
event kind, or to a specific `seq` when a lesson wants to say something once.
The engine never sees narration.

## 8. API surface (thin)

- `POST /runs` with a scenario, returns `{run_id, events, frames}`
- `GET /runs/{id}/pcap` returns the merged capture

## Decided

- TypeScript, so the engine and the React Flow frontend share types.
- Hand-rolled encoders for Ethernet II, ARP, IPv4, ICMP, and legacy pcap.
- Switch is a first-class node kind from v1.

- ARP entries do not age out. Aging, and how unsolicited replies can
  poison a cache, are narration topics, not engine features.
- Package layout: `packages/engine`, `packages/server`, `packages/web`,
  `packages/lessons` in one pnpm workspace.

## Appendix A. Full JSON spec

One document, three parts: `network`, `actions`, and the output the engine
returns. A `NetworkSpec` may omit any field marked optional; `resolve()`
returns a `Network` in the same shape with nothing omitted.

### Scenario input

```json
{
  "version": 1,
  "network": {
    "nodes": [
      {
        "id": "laptop",
        "kind": "host",
        "interfaces": [
          { "name": "eth0", "mac": "02:00:00:00:00:01", "ip": "10.0.1.10/24", "link": "l1" }
        ],
        "routes": [
          { "dst": "default", "via": "10.0.1.1" }
        ],
        "neighbors": []
      },
      {
        "id": "sw1",
        "kind": "switch",
        "interfaces": [
          { "name": "p1", "link": "l1" },
          { "name": "p2", "link": "l2" }
        ]
      },
      {
        "id": "r1",
        "kind": "router",
        "interfaces": [
          { "name": "eth0", "mac": "02:00:00:00:00:02", "ip": "10.0.1.1/24", "link": "l2" },
          { "name": "eth1", "mac": "02:00:00:00:00:03", "ip": "10.0.2.1/24", "link": "l3" }
        ],
        "routes": [],
        "neighbors": []
      },
      {
        "id": "server",
        "kind": "host",
        "interfaces": [
          { "name": "eth0", "mac": "02:00:00:00:00:04", "ip": "10.0.2.10/24", "link": "l3" }
        ],
        "routes": [
          { "dst": "default", "via": "10.0.2.1" }
        ],
        "neighbors": [
          { "ip": "10.0.2.1", "mac": "02:00:00:00:00:03", "dev": "eth0" }
        ]
      }
    ],
    "links": [
      { "id": "l1", "a": "laptop/eth0", "b": "sw1/p1", "latency_us": 1000 },
      { "id": "l2", "a": "sw1/p2",     "b": "r1/eth0", "latency_us": 1000 },
      { "id": "l3", "a": "r1/eth1",    "b": "server/eth0", "latency_us": 1000 }
    ]
  },
  "actions": [
    { "action": "ping", "from": { "name": "laptop", "ip": "10.0.1.10" }, "to": { "name": "server", "ip": "10.0.2.10" }, "ttl": 64, "count": 2 },
    { "action": "traceroute", "from": { "name": "laptop", "ip": "10.0.1.10" }, "to": { "name": "server", "ip": "10.0.2.10" }, "max_ttl": 8 }
  ]
}
```

The same scenario as a minimal spec. Everything below resolves to the
document above.

```json
{
  "version": 1,
  "network": {
    "nodes": [
      { "id": "laptop", "kind": "host",   "interfaces": [{ "name": "eth0", "link": "l1" }] },
      { "id": "sw1",    "kind": "switch", "interfaces": [{ "name": "p1", "link": "l1" }, { "name": "p2", "link": "l2" }] },
      { "id": "r1",     "kind": "router", "interfaces": [{ "name": "eth0", "link": "l2" }, { "name": "eth1", "link": "l3" }] },
      { "id": "server", "kind": "host",   "interfaces": [{ "name": "eth0", "link": "l3" }],
        "neighbors": [{ "ip": "10.0.2.1", "mac": "02:00:00:00:00:03" }] }
    ],
    "links": [
      { "id": "l1", "a": "laptop/eth0", "b": "sw1/p1" },
      { "id": "l2", "a": "sw1/p2",      "b": "r1/eth0" },
      { "id": "l3", "a": "r1/eth1",     "b": "server/eth0" }
    ]
  },
  "actions": [
    { "action": "ping",       "from": { "name": "laptop" }, "to": { "name": "server" }, "count": 2 },
    { "action": "traceroute", "from": { "name": "laptop" }, "to": { "name": "server" }, "max_ttl": 8 }
  ]
}
```

In the minimal form an endpoint may give only `name`, a node id, because
the IPs do not exist yet. `resolve()` fills `ip` with that node's first
address. The resolved form always carries `ip`, and `ip` alone is enough.

### Field reference

**Scenario**

| field | type | required | notes |
|-------|------|----------|-------|
| `version` | `1` | yes | schema version |
| `network` | Network | yes | |
| `actions` | Action[] | yes | run in order against persistent state |

**Network**

| field | type | required | notes |
|-------|------|----------|-------|
| `nodes` | Node[] | yes | ids unique |
| `links` | Link[] | yes | ids unique |

**Node**

| field | type | required | notes |
|-------|------|----------|-------|
| `id` | string | yes | `[a-z0-9_-]+` |
| `kind` | `host` \| `router` \| `switch` | yes | `router` forwards; `switch` has no IP layer |
| `interfaces` | Interface[] | yes | at least one; names unique within the node |
| `routes` | Route[] | no | not allowed on `switch`. Connected routes are implicit from `interfaces`, as on Linux, and are materialized by `resolve()` |
| `neighbors` | Neighbor[] | no | not allowed on `switch`. Pre-seeded ARP entries |

**Interface**

| field | type | required | notes |
|-------|------|----------|-------|
| `name` | string | yes | `eth0`, `p1`, ... |
| `mac` | MAC | host/router only | `xx:xx:xx:xx:xx:xx`, unique across the network. Resolved from `02:00:00:00:00:00` plus a counter in declaration order. Not allowed on `switch` |
| `ip` | CIDR | host/router only | `a.b.c.d/n`. Resolved per broadcast domain from `10.0.N.0/24`: router interfaces from `.1`, host interfaces from `.10`, each in declaration order |
| `link` | string | yes | must name a link whose `a` or `b` is `node/name` |

**Route**

| field | type | required | notes |
|-------|------|----------|-------|
| `dst` | CIDR \| `default` | yes | `default` is `0.0.0.0/0` |
| `via` | IP | one of `via`/`dev` | gateway; must resolve recursively to a connected route |
| `dev` | string | one of `via`/`dev` | interface name; a route with only `dev` is connected |
| `metric` | integer | no | lower wins on equal prefix length; default `0` |

Resolution when `routes` is omitted: connected routes for every interface,
a host default route via the first router interface in its broadcast
domain, and router static routes by shortest path over the link graph.

**Neighbor**

| field | type | required | notes |
|-------|------|----------|-------|
| `ip` | IP | yes | |
| `mac` | MAC | yes | |
| `dev` | string | no | interface the entry is bound to; resolved from the connected route that covers `ip`, since an IP belongs to exactly one |

**Link**

| field | type | required | notes |
|-------|------|----------|-------|
| `id` | string | yes | |
| `a` | `node/iface` | yes | exactly two endpoints, always |
| `b` | `node/iface` | yes | |
| `latency_us` | integer | no | default `1000` |

**Action**

| field | type | required | notes |
|-------|------|----------|-------|
| `action` | `ping` \| `traceroute` | yes | |
| `from` | Endpoint | yes | the node owning `ip` is the source; must be a host or router |
| `to` | Endpoint | yes | |
| `ttl` | 1..255 | `ping` only | default `64` |
| `count` | integer | `ping` only | default `1` |
| `max_ttl` | 1..255 | `traceroute` only | default `30` |

**Endpoint**

| field | type | required | notes |
|-------|------|----------|-------|
| `ip` | IP | yes in resolved form | in a partial spec may be omitted when `name` is given |
| `name` | node id | no | for lessons and the UI; the engine ignores it once `ip` is present |

### Engine output

```json
{
  "network": { "...": "the resolved Network, so the UI never resolves" },
  "events": [
    { "seq": 0, "t_us": 0,    "action": 0, "node": "laptop", "kind": "route.lookup", "dst": "10.0.2.10", "route": { "dst": "default", "via": "10.0.1.1" }, "dev": "eth0", "next_hop": "10.0.1.1" },
    { "seq": 1, "t_us": 0,    "action": 0, "node": "laptop", "kind": "arp.miss",     "ip": "10.0.1.1", "dev": "eth0", "parked": "pkt0" },
    { "seq": 2, "t_us": 0,    "action": 0, "node": "laptop", "kind": "frame.tx",     "dev": "eth0", "link": "l1", "frame": "f0" },
    { "seq": 3, "t_us": 1000, "action": 0, "node": "sw1",    "kind": "frame.rx",     "dev": "p1",   "link": "l1", "frame": "f0" },
    { "seq": 4, "t_us": 1000, "action": 0, "node": "sw1",    "kind": "switch.learn", "mac": "02:00:00:00:00:01", "port": "p1" },
    { "seq": 5, "t_us": 1000, "action": 0, "node": "sw1",    "kind": "switch.flood", "frame": "f0", "in": "p1", "out": ["p2"] },
    { "seq": 6, "t_us": 1010, "action": 0, "node": "sw1",    "kind": "frame.tx",     "dev": "p2",   "link": "l2", "frame": "f0" }
  ],
  "frames": {
    "f0": {
      "bytes": "ffffffffffff020000000001080600010800060400010200000000010a00010a0000000000000a000101",
      "summary": {
        "eth": { "src": "02:00:00:00:00:01", "dst": "ff:ff:ff:ff:ff:ff", "type": "arp" },
        "arp": { "op": "request", "sender_mac": "02:00:00:00:00:01", "sender_ip": "10.0.1.10", "target_mac": "00:00:00:00:00:00", "target_ip": "10.0.1.1" }
      }
    }
  }
}
```

Event kinds and their extra fields. Every event carries `seq`, `t_us`,
`node`, `kind`, `action`.

| kind | extra fields |
|------|-------------|
| `route.lookup` | `dst`, `route` (the matched entry or `null`), `dev`, `next_hop` |
| `arp.miss` | `ip`, `dev`, `parked` (packet id) |
| `arp.hit` | `ip`, `mac`, `dev` |
| `arp.learn` | `ip`, `mac`, `dev` |
| `arp.reply` | `ip`, `dev`, `reply_frame` |
| `frame.tx` | `dev`, `link`, `frame` |
| `frame.rx` | `dev`, `link`, `frame` |
| `switch.learn` | `mac`, `port` |
| `switch.forward` | `frame`, `in`, `out` (single port) |
| `switch.flood` | `frame`, `in`, `out` (port list) |
| `ttl.decrement` | `packet`, `before`, `after` |
| `ttl.expired` | `packet`, `reply_frame` |
| `icmp.reply` | `packet`, `reply_frame` |
| `icmp.recv` | `packet`, `type` (`echo-reply` \| `time-exceeded`), `from`, `rtt_us` |
| `drop` | `frame` or `packet`, `reason` (`not-our-mac`, `not-our-ip`, `no-route`, `ttl`) |

`frames[id].bytes` is hex of the exact bytes on the wire; the pcap writer
copies them verbatim. `summary` is decoded once by the engine so the UI never
parses bytes. Its keys are `eth`, and then one of `arp`, or `ip` plus `icmp`.
