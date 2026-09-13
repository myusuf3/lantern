import { describe, expect, it } from "vitest";
import { hex, toHex } from "./bytes.js";
import {
  BROADCAST_MAC,
  decodeEthernet,
  ETHERTYPE_ARP,
  ETHERTYPE_IPV4,
  encodeEthernet,
} from "./ethernet.js";

describe("ethernet", () => {
  it("encodes a header as dst, src, ethertype then payload", () => {
    const frame = encodeEthernet(
      { dst: BROADCAST_MAC, src: "02:00:00:00:00:01", type: ETHERTYPE_ARP },
      hex("deadbeef"),
    );
    expect(toHex(frame)).toBe("ffffffffffff" + "020000000001" + "0806" + "deadbeef");
  });

  it("decodes what it encoded", () => {
    const frame = encodeEthernet(
      { dst: "02:00:00:00:00:02", src: "02:00:00:00:00:01", type: ETHERTYPE_IPV4 },
      hex("0102"),
    );
    expect(decodeEthernet(frame)).toEqual({
      header: { dst: "02:00:00:00:00:02", src: "02:00:00:00:00:01", type: ETHERTYPE_IPV4 },
      payload: hex("0102"),
    });
  });

  it("rejects a frame shorter than a header", () => {
    expect(() => decodeEthernet(hex("ffffffffffff0200"))).toThrow(/short/);
  });
});
