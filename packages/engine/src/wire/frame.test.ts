import { describe, expect, it } from "vitest";
import { encodeArp } from "./arp.js";
import { toHex } from "./bytes.js";
import { BROADCAST_MAC, ETHERTYPE_ARP, ETHERTYPE_IPV4, encodeEthernet } from "./ethernet.js";
import { summarizeFrame } from "./frame.js";
import { encodeIcmp } from "./icmp.js";
import { encodeIpv4, PROTO_ICMP } from "./ipv4.js";

const payload = new TextEncoder().encode("lantern");

describe("summarizeFrame", () => {
  it("summarizes an ARP request", () => {
    const frame = encodeEthernet(
      { dst: BROADCAST_MAC, src: "02:00:00:00:00:01", type: ETHERTYPE_ARP },
      encodeArp({
        op: "request",
        senderMac: "02:00:00:00:00:01",
        senderIp: "10.0.1.10",
        targetMac: "00:00:00:00:00:00",
        targetIp: "10.0.1.1",
      }),
    );
    expect(summarizeFrame(frame)).toEqual({
      eth: { src: "02:00:00:00:00:01", dst: BROADCAST_MAC, type: "arp" },
      arp: {
        op: "request",
        sender_mac: "02:00:00:00:00:01",
        sender_ip: "10.0.1.10",
        target_mac: "00:00:00:00:00:00",
        target_ip: "10.0.1.1",
      },
    });
  });

  it("summarizes an ICMP echo request inside IPv4", () => {
    const frame = encodeEthernet(
      { dst: "02:00:00:00:00:02", src: "02:00:00:00:00:01", type: ETHERTYPE_IPV4 },
      encodeIpv4(
        { id: 7, ttl: 64, protocol: PROTO_ICMP, src: "10.0.1.10", dst: "10.0.2.10" },
        encodeIcmp({ type: "echo-request", id: 0x1234, seq: 1, payload }),
      ),
    );
    expect(summarizeFrame(frame)).toEqual({
      eth: { src: "02:00:00:00:00:01", dst: "02:00:00:00:00:02", type: "ipv4" },
      ip: { src: "10.0.1.10", dst: "10.0.2.10", ttl: 64, id: 7, protocol: "icmp" },
      icmp: { type: "echo-request", id: 0x1234, seq: 1, payload: toHex(payload) },
    });
  });

  it("summarizes time exceeded with the quoted packet's addresses", () => {
    const original = encodeIpv4(
      { id: 7, ttl: 0, protocol: PROTO_ICMP, src: "10.0.1.10", dst: "10.0.2.10" },
      encodeIcmp({ type: "echo-request", id: 0x1234, seq: 3, payload }),
    );
    const frame = encodeEthernet(
      { dst: "02:00:00:00:00:01", src: "02:00:00:00:00:02", type: ETHERTYPE_IPV4 },
      encodeIpv4(
        { id: 8, ttl: 64, protocol: PROTO_ICMP, src: "10.0.1.1", dst: "10.0.1.10" },
        encodeIcmp({ type: "time-exceeded", original }),
      ),
    );
    expect(summarizeFrame(frame).icmp).toEqual({
      type: "time-exceeded",
      original: { src: "10.0.1.10", dst: "10.0.2.10", id: 7, icmp_id: 0x1234, icmp_seq: 3 },
    });
  });
});
