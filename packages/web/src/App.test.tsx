import { loadScenario, simulate } from "@lantern/engine";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const cable = {
  version: 1,
  network: {
    nodes: [
      { id: "laptop", kind: "host", interfaces: [{ name: "eth0", link: "cable" }] },
      { id: "server", kind: "host", interfaces: [{ name: "eth0", link: "cable" }] },
    ],
    links: [{ id: "cable", a: "laptop/eth0", b: "server/eth0" }],
  },
  actions: [{ action: "ping", from: { name: "laptop" }, to: { name: "server" } }],
};

const viaRouter = {
  version: 1,
  network: {
    nodes: [
      { id: "laptop", kind: "host", interfaces: [{ name: "eth0", link: "left" }] },
      {
        id: "router",
        kind: "router",
        interfaces: [
          { name: "eth0", link: "left" },
          { name: "eth1", link: "right" },
        ],
      },
      { id: "server", kind: "host", interfaces: [{ name: "eth0", link: "right" }] },
    ],
    links: [
      { id: "left", a: "laptop/eth0", b: "router/eth0" },
      { id: "right", a: "router/eth1", b: "server/eth0" },
    ],
  },
  actions: [{ action: "ping", from: { name: "laptop" }, to: { name: "server" } }],
};

const viaSwitch = {
  version: 1,
  network: {
    nodes: [
      { id: "laptop", kind: "host", interfaces: [{ name: "eth0", link: "left" }] },
      {
        id: "switch",
        kind: "switch",
        interfaces: [
          { name: "p1", link: "left" },
          { name: "p2", link: "middle" },
        ],
      },
      {
        id: "router",
        kind: "router",
        interfaces: [
          { name: "eth0", link: "middle" },
          { name: "eth1", link: "right" },
        ],
      },
      { id: "server", kind: "host", interfaces: [{ name: "eth0", link: "right" }] },
    ],
    links: [
      { id: "left", a: "laptop/eth0", b: "switch/p1" },
      { id: "middle", a: "switch/p2", b: "router/eth0" },
      { id: "right", a: "router/eth1", b: "server/eth0" },
    ],
  },
  actions: [{ action: "ping", from: { name: "laptop" }, to: { name: "server" } }],
};

const lesson1 = {
  id: "01-two-hosts",
  title: "Two hosts and a cable",
  summary: "The smallest network there is.",
  show: { arp: true, routes: false },
  scenes: [
    {
      id: "01-cable",
      title: "Two hosts, one cable",
      scenario: cable,
      narration: {
        intro: "Two computers. One cable. Press send and watch.",
        "route.lookup": "The laptop asks its [[routing table]] where the address lives.",
        "arp.miss": "It checks its [[ARP table]] and finds nothing.",
        "arp.learn": "A new row goes into the ARP table.",
        "icmp.recv": "The reply is home.",
        outro: "Every lesson from here adds one box to this picture.",
      },
    },
  ],
};

const lesson2 = {
  id: "02-through-a-router",
  title: "Through a router",
  summary: "The server moves to another subnet.",
  show: { arp: true, routes: true },
  scenes: [
    {
      id: "01-router",
      title: "Through a router",
      scenario: viaRouter,
      narration: {
        intro: "A router has one foot in each subnet.",
        "route.lookup": "Generic lookup text.",
        "route.lookup@laptop": "Not on my cable, so via the gateway.",
        "route.lookup@router": "Connected on eth1.",
        "ttl.decrement": "The router lowers the TTL by one.",
        outro: "The frame changed. The packet did not.",
      },
    },
    {
      id: "02-switch",
      title: "Adding a switch",
      scenario: viaSwitch,
      narration: {
        intro: "One more box, and it is invisible.",
        "switch.learn": "The switch notes which port the MAC came in on.",
        "switch.flood": "It sends the frame out every other port.",
        outro: "The switch never touched a header.",
      },
    },
  ],
};

const glossary = {
  "routing-table": {
    title: "routing table",
    body: "The list a machine consults before sending anything.",
  },
  "arp-table": { title: "ARP table", body: "A memory of which IP lives at which MAC." },
  wireshark: { title: "Wireshark", body: "The standard tool for looking inside network traffic." },
};

const capturesPage = {
  markdown: "Every step you clicked through wrote packets. Open them in [[Wireshark]].",
  captures: [
    {
      lesson: "01-two-hosts",
      lessonTitle: "Two hosts and a cable",
      scene: "01-cable",
      sceneTitle: "Two hosts, one cable",
      run: "run-2",
      frames: ["ARP request 10.0.1.10 -> 10.0.1.11", "ARP reply 10.0.1.11 -> 10.0.1.10"],
    },
    {
      lesson: "02-through-a-router",
      lessonTitle: "Through a router",
      scene: "01-router",
      sceneTitle: "Through a router",
      run: "run-3",
      frames: ["ARP request 10.0.1.10 -> 10.0.1.1"],
    },
  ],
};

const summaryOf = ({
  id,
  title,
  summary,
  show,
}: {
  id: string;
  title: string;
  summary: string;
  show: object;
}) => ({
  id,
  title,
  summary,
  show,
});

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.endsWith("/api/lessons")) return json([summaryOf(lesson1), summaryOf(lesson2)]);
    if (url.endsWith("/api/lessons/01-two-hosts")) return json(lesson1);
    if (url.endsWith("/api/lessons/02-through-a-router")) return json(lesson2);
    if (url.endsWith("/api/glossary")) return json(glossary);
    if (url.endsWith("/api/captures")) return json(capturesPage);
    if (url.endsWith("/api/home"))
      return json({ markdown: "You have typed `ping` before. This site is that, slowed down." });
    if (url.endsWith("/api/runs") && init?.method === "POST") {
      const scenario = JSON.parse(String(init.body));
      const run = simulate(loadScenario(scenario));
      return json({ id: `run-${scenario.network.nodes.length}`, ...run });
    }
    return json({ error: "not found" }, 404);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
  window.location.hash = "";
});
afterEach(() => vi.unstubAllGlobals());

async function renderLesson(hash = "#01-two-hosts") {
  window.location.hash = hash;
  render(<App />);
  await screen.findByRole("button", { name: "Send ping" });
  return userEvent.setup();
}

describe("lesson 1", () => {
  it("shows the lesson, its intro, and the resolved hosts before anything is sent", async () => {
    await renderLesson();
    expect(screen.getByRole("heading", { name: "Two hosts and a cable" })).toBeInTheDocument();
    expect(screen.getByText(/Two computers\. One cable\./)).toBeInTheDocument();
    const laptop = await screen.findByTestId("node-laptop");
    expect(within(laptop).getByText("10.0.1.10/24")).toBeInTheDocument();
    expect(within(laptop).getByText("02:00:00:00:00:01")).toBeInTheDocument();
    expect(within(laptop).getByText("ARP table")).toBeInTheDocument();
    expect(within(laptop).queryByText("routing table")).not.toBeInTheDocument();
  });

  it("steps through turns with narration keyed by event kind", async () => {
    const user = await renderLesson();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    expect(screen.getByText(/asks its/)).toBeInTheDocument();
    expect(screen.getByText(/finds nothing/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 9")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("shows the frame in play with its decoded headers", async () => {
    const user = await renderLesson();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    const inspector = screen.getByTestId("frame-inspector");
    expect(within(inspector).getByText("ARP request")).toBeInTheDocument();
    expect(within(inspector).getByText("ff:ff:ff:ff:ff:ff")).toBeInTheDocument();
  });

  it("writes a learned row into the ARP table on the node that learned it", async () => {
    const user = await renderLesson();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    const server = screen.getByTestId("node-server");
    expect(within(server).queryByText("02:00:00:00:00:01")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(within(server).getByText("02:00:00:00:00:01")).toBeInTheDocument();
  });

  it("opens a definition when a marked term is clicked", async () => {
    const user = await renderLesson();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    await user.click(screen.getByRole("button", { name: "routing table" }));
    expect(
      within(await screen.findByRole("dialog")).getByText(/consults before sending/),
    ).toBeInTheDocument();
  });

  it("ends on the outro, without a download, and points at the captures page", async () => {
    const user = await renderLesson();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    for (let i = 0; i < 9; i++) await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/adds one box/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next lesson: Through a router" })).toHaveAttribute(
      "href",
      "#02-through-a-router",
    );
    expect(screen.queryByText(/capture/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeDisabled());
  });
});

describe("lesson picker and scenes", () => {
  it("lists every lesson and switches to the one chosen", async () => {
    const user = await renderLesson();
    const picker = screen.getByRole("navigation", { name: "Lessons" });
    expect(
      within(picker)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["One frame at a time", "Two hosts and a cable", "Through a router"]);
    await user.click(within(picker).getByRole("link", { name: "Through a router" }));
    expect(await screen.findByRole("heading", { name: "Through a router" })).toBeInTheDocument();
    expect(await screen.findByTestId("node-router")).toBeInTheDocument();
  });

  it("opens the lesson and scene named in the URL hash", async () => {
    await renderLesson("#02-through-a-router/02-switch");
    expect(await screen.findByTestId("node-switch")).toBeInTheDocument();
    expect(screen.getByText(/One more box/)).toBeInTheDocument();
  });

  it("draws a router with both interfaces and its routing table, and highlights the route it uses", async () => {
    const user = await renderLesson("#02-through-a-router");
    const router = await screen.findByTestId("node-router");
    expect(within(router).getByText("10.0.1.1/24")).toBeInTheDocument();
    expect(within(router).getByText("10.0.2.1/24")).toBeInTheDocument();
    expect(within(router).getByText("routing table")).toBeInTheDocument();
    expect(within(router).getByText("10.0.2.0/24")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    const laptop = screen.getByTestId("node-laptop");
    expect(within(laptop).getByText("0.0.0.0/0").closest("tr")).toHaveClass("active");
  });

  it("prefers a node-specific narration slot over the plain kind", async () => {
    const user = await renderLesson("#02-through-a-router");
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    expect(screen.getByText(/via the gateway/)).toBeInTheDocument();
    expect(screen.queryByText(/Generic lookup text/)).not.toBeInTheDocument();
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 7 of 17")).toBeInTheDocument();
    expect(screen.getByText(/lowers the TTL/)).toBeInTheDocument();
    expect(screen.getByText(/Connected on eth1/)).toBeInTheDocument();
  });

  it("labels an IP frame on the cable with its TTL", async () => {
    const user = await renderLesson("#02-through-a-router");
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    for (let i = 0; i < 11; i++) await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 12 of 17")).toBeInTheDocument();
    expect(screen.getByText("echo request · TTL 63")).toBeInTheDocument();
  });

  it("draws a switch with its ports and fills its MAC table as it learns", async () => {
    const user = await renderLesson("#02-through-a-router/02-switch");
    const sw = await screen.findByTestId("node-switch");
    expect(within(sw).getByText("MAC table")).toBeInTheDocument();
    expect(within(sw).getByText("empty")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 3 of 25")).toBeInTheDocument();
    expect(within(sw).getByText("02:00:00:00:00:01")).toBeInTheDocument();
    expect(screen.getByText(/every other port/)).toBeInTheDocument();
  });

  it("offers the next scene at the end of a scene, and the reveal at the end of the last lesson", async () => {
    const user = await renderLesson("#02-through-a-router");
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    for (let i = 0; i < 17; i++) await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("link", { name: "Next scene: Adding a switch" }));
    expect(await screen.findByTestId("node-switch")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Send ping" }));
    for (let i = 0; i < 25; i++) await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("link", { name: "One more thing" })).toHaveAttribute(
      "href",
      "#captures",
    );
  });
});

describe("the captures page", () => {
  it("is the last page: prose, every scene's capture with its frames, and ways to verify them", async () => {
    window.location.hash = "#captures";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "The captures" })).toBeInTheDocument();
    expect(screen.getByText(/wrote packets/)).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem", { name: /capture/i });
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("Two hosts, one cable")).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText("ARP reply 10.0.1.11 -> 10.0.1.10"),
    ).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "/api/runs/run-2/pcap",
    );
    expect(screen.getByRole("link", { name: /Wireview/ })).toHaveAttribute(
      "href",
      "https://wireview.github.io/",
    );
    expect(screen.getByRole("link", { name: /^Wireshark/ })).toHaveAttribute(
      "href",
      "https://www.wireshark.org/",
    );
    expect(screen.getByText(/tshark -r/)).toBeInTheDocument();
  });
});

describe("the landing page", () => {
  it("opens with the hero, the pitch, and the path through the lessons", async () => {
    window.location.hash = "";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "One frame at a time" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /laptop and a server/ })).toHaveAttribute(
      "src",
      "/oneframe.jpg",
    );
    expect(await screen.findByText(/slowed down/)).toBeInTheDocument();
    const path = screen.getAllByRole("listitem");
    expect(path.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Two hosts and a cable"),
      expect.stringContaining("Through a router"),
    ]);
    expect(screen.queryByText(/capture/i)).not.toBeInTheDocument();
    expect(document.querySelector(".path-hidden")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start with lesson 1" }));
    expect(await screen.findByRole("button", { name: "Send ping" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#01-two-hosts");
  });
});
