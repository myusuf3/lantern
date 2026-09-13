import { describe, expect, it } from "vitest";
import { parseProse } from "./markdown.js";

describe("parseProse", () => {
  it("splits paragraphs on blank lines", () => {
    expect(parseProse("One.\n\nTwo.")).toEqual([[{ text: "One." }], [{ text: "Two." }]]);
  });

  it("turns [[term]] marks into term tokens keyed by slug", () => {
    expect(parseProse("Check the [[ARP table]] for a [[MAC address]].")).toEqual([
      [
        { text: "Check the " },
        { term: "arp-table", text: "ARP table" },
        { text: " for a " },
        { term: "mac-address", text: "MAC address" },
        { text: "." },
      ],
    ]);
  });

  it("lets the shown text differ from the term with a pipe", () => {
    expect(parseProse("[[ARP|asks around]]")).toEqual([[{ term: "arp", text: "asks around" }]]);
  });

  it("renders backticks as code", () => {
    expect(parseProse("run `ip neigh` now")).toEqual([
      [{ text: "run " }, { code: "ip neigh" }, { text: " now" }],
    ]);
  });
});
