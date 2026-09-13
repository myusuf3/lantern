import { describe, expect, it } from "vitest";
import { hex, toHex } from "./bytes.js";
import { decodeIpv4, encodeIpv4, PROTO_ICMP } from "./ipv4.js";

const header = { id: 1, ttl: 64, protocol: PROTO_ICMP, src: "10.0.1.10", dst: "10.0.2.10" };
const payload = hex(`0800378212340001${toHexOf("lantern")}`);

function toHexOf(s: string): string {
  return [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

describe("ipv4", () => {
  it("encodes a 20 byte header with total length, no fragmentation, and a correct checksum", () => {
    const packet = encodeIpv4(header, payload);
    expect(toHex(packet.subarray(0, 20))).toBe(
      "4500" + "0023" + "0001" + "0000" + "40" + "01" + "63c6" + "0a00010a" + "0a00020a",
    );
    expect(packet.length).toBe(35);
  });

  it("decodes what it encoded and reports the checksum as valid", () => {
    expect(decodeIpv4(encodeIpv4(header, payload))).toEqual({ header, payload, checksumOk: true });
  });

  it("flags a corrupted checksum", () => {
    const packet = encodeIpv4(header, payload);
    packet[8] = 63;
    expect(decodeIpv4(packet).checksumOk).toBe(false);
  });

  it("re-encoding with a lower ttl changes only ttl and checksum", () => {
    const a = encodeIpv4(header, payload);
    const b = encodeIpv4({ ...header, ttl: 63 }, payload);
    const diff = [...a].map((byte, i) => (byte === b[i] ? null : i)).filter((i) => i !== null);
    expect(diff).toContain(8);
    expect(diff.every((i) => [8, 10, 11].includes(i))).toBe(true);
  });

  it("rejects a header with options or a wrong version", () => {
    const packet = encodeIpv4(header, payload);
    packet[0] = 0x46;
    expect(() => decodeIpv4(packet)).toThrow(/options/);
    packet[0] = 0x65;
    expect(() => decodeIpv4(packet)).toThrow(/version/);
  });
});
