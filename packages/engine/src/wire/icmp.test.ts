import { describe, expect, it } from "vitest";
import { hex, toHex } from "./bytes.js";
import { decodeIcmp, encodeIcmp } from "./icmp.js";
import { encodeIpv4, PROTO_ICMP } from "./ipv4.js";

const payload = new TextEncoder().encode("lantern");

describe("icmp", () => {
  it("encodes an echo request with type 8, identifier, sequence, and checksum", () => {
    const echo = encodeIcmp({ type: "echo-request", id: 0x1234, seq: 1, payload });
    expect(toHex(echo)).toBe(`0800378212340001${toHex(payload)}`);
  });

  it("encodes an echo reply with type 0", () => {
    const reply = encodeIcmp({ type: "echo-reply", id: 0x1234, seq: 1, payload });
    expect(reply[0]).toBe(0);
    expect(decodeIcmp(reply)).toEqual({
      message: { type: "echo-reply", id: 0x1234, seq: 1, payload },
      checksumOk: true,
    });
  });

  it("encodes time exceeded as type 11 with the offending header plus 8 bytes quoted", () => {
    const original = encodeIpv4(
      { id: 7, ttl: 0, protocol: PROTO_ICMP, src: "10.0.1.10", dst: "10.0.2.10" },
      encodeIcmp({ type: "echo-request", id: 1, seq: 1, payload }),
    );
    const te = encodeIcmp({ type: "time-exceeded", original });
    expect(te[0]).toBe(11);
    expect(te[1]).toBe(0);
    expect(toHex(te.subarray(4, 8))).toBe("00000000");
    expect(te.length).toBe(8 + 20 + 8);
    expect(toHex(te.subarray(8))).toBe(toHex(original.subarray(0, 28)));
  });

  it("decodes what it encoded", () => {
    const original = hex("45000023000100004001" + "63c6" + "0a00010a0a00020a" + "0800378212340001");
    const te = encodeIcmp({ type: "time-exceeded", original });
    expect(decodeIcmp(te)).toEqual({
      message: { type: "time-exceeded", original },
      checksumOk: true,
    });
  });

  it("flags a corrupted checksum", () => {
    const echo = encodeIcmp({ type: "echo-request", id: 1, seq: 1, payload });
    echo[7] = 9;
    expect(decodeIcmp(echo).checksumOk).toBe(false);
  });

  it("rejects types it does not model", () => {
    expect(() => decodeIcmp(hex("0300fcff00000000"))).toThrow(/type 3/);
  });
});
