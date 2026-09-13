import { describe, expect, it } from "vitest";
import { cidrContains, formatIp, formatMac, formatNetwork, parseCidr, parseIp } from "./addr.js";

describe("parseIp", () => {
  it("parses a dotted quad to a number and back", () => {
    expect(parseIp("10.0.1.10")).toBe(0x0a00010a);
    expect(formatIp(0x0a00010a)).toBe("10.0.1.10");
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["10.0.1", "10.0.1.256", "a.b.c.d", "10.0.1.10/24", ""]) {
      expect(() => parseIp(bad), bad).toThrow();
    }
  });
});

describe("parseCidr", () => {
  it("splits address and prefix and computes the network", () => {
    expect(parseCidr("10.0.1.10/24")).toEqual({
      ip: parseIp("10.0.1.10"),
      prefix: 24,
      network: parseIp("10.0.1.0"),
    });
    expect(formatNetwork(parseCidr("10.0.1.10/24"))).toBe("10.0.1.0/24");
  });

  it("rejects a missing prefix and prefixes outside 0..32", () => {
    expect(() => parseCidr("10.0.1.10")).toThrow();
    expect(() => parseCidr("10.0.1.0/33")).toThrow();
    expect(() => parseCidr("10.0.1.0/-1")).toThrow();
  });
});

describe("cidrContains", () => {
  it("is true inside the subnet and false outside", () => {
    const net = parseCidr("10.0.1.0/24");
    expect(cidrContains(net, parseIp("10.0.1.1"))).toBe(true);
    expect(cidrContains(net, parseIp("10.0.1.255"))).toBe(true);
    expect(cidrContains(net, parseIp("10.0.2.1"))).toBe(false);
  });

  it("matches everything for /0", () => {
    expect(cidrContains(parseCidr("0.0.0.0/0"), parseIp("192.168.9.9"))).toBe(true);
  });
});

describe("formatMac", () => {
  it("renders 48 bits as six lower-case colon separated bytes", () => {
    expect(formatMac(0x02000000000a)).toBe("02:00:00:00:00:0a");
  });
});
