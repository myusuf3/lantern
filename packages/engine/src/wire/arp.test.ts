import { describe, expect, it } from "vitest";
import { decodeArp, encodeArp } from "./arp.js";
import { hex, toHex } from "./bytes.js";

const request = {
  op: "request" as const,
  senderMac: "02:00:00:00:00:01",
  senderIp: "10.0.1.10",
  targetMac: "00:00:00:00:00:00",
  targetIp: "10.0.1.1",
};

describe("arp", () => {
  it("encodes an Ethernet/IPv4 request exactly as tshark dissected it earlier", () => {
    expect(toHex(encodeArp(request))).toBe(
      "0001" +
        "0800" +
        "06" +
        "04" +
        "0001" +
        "020000000001" +
        "0a00010a" +
        "000000000000" +
        "0a000101",
    );
  });

  it("encodes a reply with opcode 2", () => {
    const reply = encodeArp({ ...request, op: "reply" });
    expect(toHex(reply.subarray(6, 8))).toBe("0002");
  });

  it("decodes what it encoded", () => {
    expect(decodeArp(encodeArp(request))).toEqual(request);
    expect(decodeArp(encodeArp({ ...request, op: "reply" })).op).toBe("reply");
  });

  it("rejects hardware or protocol types it does not model", () => {
    const bytes = encodeArp(request);
    bytes[1] = 6;
    expect(() => decodeArp(bytes)).toThrow(/hardware/);
  });

  it("rejects a truncated packet", () => {
    expect(() => decodeArp(hex("00010800060400"))).toThrow(/short/);
  });
});
