import { describe, expect, it } from "vitest";
import { hex } from "./bytes.js";
import { internetChecksum } from "./checksum.js";

describe("internetChecksum", () => {
  it("matches the RFC 1071 worked example", () => {
    expect(internetChecksum(hex("0001f203f4f5f6f7"))).toBe(0x220d);
  });

  it("matches a documented IPv4 header with the checksum field zeroed", () => {
    expect(internetChecksum(hex("45000073000040004011" + "0000" + "c0a80001c0a800c7"))).toBe(
      0xb861,
    );
  });

  it("pads an odd-length buffer with a zero byte", () => {
    expect(internetChecksum(hex("0001f2"))).toBe(internetChecksum(hex("0001f200")));
  });

  it("verifies to zero over a buffer that includes its own checksum", () => {
    expect(internetChecksum(hex("45000073000040004011" + "b861" + "c0a80001c0a800c7"))).toBe(0);
  });
});
