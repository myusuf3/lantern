import { loadScenario, simulate } from "@lantern/engine";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const scenario = {
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

const lesson = {
  id: "01-two-hosts",
  title: "Two hosts and a cable",
  summary: "The smallest network there is.",
  show: { arp: true, routes: false },
  scenario,
  narration: {
    intro: "Two computers. One cable. Press send and watch.",
    "route.lookup": "The laptop asks its [[routing table]] where the address lives.",
    "arp.miss": "It checks its [[ARP table]] and finds nothing.",
    "arp.learn": "A new row goes into the ARP table.",
    "icmp.recv": "The reply is home.",
    outro: "Download the capture and open it in Wireshark.",
  },
};

const glossary = {
  "routing-table": {
    title: "routing table",
    body: "The list a machine consults before sending anything.",
  },
  "arp-table": { title: "ARP table", body: "A memory of which IP lives at which MAC." },
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.endsWith("/api/lessons")) return json([lesson]);
    if (url.endsWith("/api/lessons/01-two-hosts")) return json(lesson);
    if (url.endsWith("/api/glossary")) return json(glossary);
    if (url.endsWith("/api/runs") && init?.method === "POST") {
      const run = simulate(loadScenario(JSON.parse(String(init.body))));
      return json({ id: "abc123", ...run });
    }
    return json({ error: "not found" }, 404);
  });
}

beforeEach(() => vi.stubGlobal("fetch", mockFetch()));
afterEach(() => vi.unstubAllGlobals());

async function renderLesson() {
  render(<App />);
  await screen.findByRole("heading", { name: "Two hosts and a cable" });
  return userEvent.setup();
}

describe("App", () => {
  it("shows the lesson, its intro, and the resolved hosts before anything is sent", async () => {
    await renderLesson();
    expect(screen.getByText(/Two computers\. One cable\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send ping" })).toBeInTheDocument();
    const laptop = await screen.findByTestId("node-laptop");
    expect(within(laptop).getByText("10.0.1.10/24")).toBeInTheDocument();
    expect(within(laptop).getByText("02:00:00:00:00:01")).toBeInTheDocument();
    expect(within(laptop).getByText(/arp/i)).toBeInTheDocument();
    expect(within(laptop).queryByText(/routes/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("node-server")).toBeInTheDocument();
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
    expect(within(inspector).getByText("10.0.1.11")).toBeInTheDocument();
  });

  it("writes a learned row into the ARP table on the node that learned it", async () => {
    const user = await renderLesson();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    const server = screen.getByTestId("node-server");
    expect(within(server).queryByText("02:00:00:00:00:01")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 3 of 9")).toBeInTheDocument();
    expect(within(server).getByText("02:00:00:00:00:01")).toBeInTheDocument();
  });

  it("opens a definition when a marked term is clicked", async () => {
    const user = await renderLesson();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    await user.click(screen.getByRole("button", { name: "routing table" }));
    const popover = await screen.findByRole("dialog");
    expect(within(popover).getByText(/consults before sending/)).toBeInTheDocument();
  });

  it("ends on the outro with a capture download for this run", async () => {
    const user = await renderLesson();
    await user.click(screen.getByRole("button", { name: "Send ping" }));
    for (let i = 0; i < 9; i++) await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/open it in Wireshark/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /download/i });
    expect(link).toHaveAttribute("href", "/api/runs/abc123/pcap");
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeDisabled());
  });
});
