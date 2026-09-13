import { describe, expect, it } from "vitest";
import { dissect } from "../testing/tshark.js";
import { encodeArp } from "./arp.js";
import { hex, toHex } from "./bytes.js";
import { BROADCAST_MAC, ETHERTYPE_ARP, ETHERTYPE_IPV4, encodeEthernet } from "./ethernet.js";
import { encodeIcmp } from "./icmp.js";
import { encodeIpv4, PROTO_ICMP } from "./ipv4.js";
import { writePcap } from "./pcap.js";

const A = { mac: "02:00:00:00:00:01", ip: "10.0.1.10" };
const B = { mac: "02:00:00:00:00:02", ip: "10.0.1.11" };
const payload = new TextEncoder().encode("lantern");

const frames = [
  encodeEthernet(
    { dst: BROADCAST_MAC, src: A.mac, type: ETHERTYPE_ARP },
    encodeArp({
      op: "request",
      senderMac: A.mac,
      senderIp: A.ip,
      targetMac: "00:00:00:00:00:00",
      targetIp: B.ip,
    }),
  ),
  encodeEthernet(
    { dst: A.mac, src: B.mac, type: ETHERTYPE_ARP },
    encodeArp({ op: "reply", senderMac: B.mac, senderIp: B.ip, targetMac: A.mac, targetIp: A.ip }),
  ),
  encodeEthernet(
    { dst: B.mac, src: A.mac, type: ETHERTYPE_IPV4 },
    encodeIpv4(
      { id: 1, ttl: 64, protocol: PROTO_ICMP, src: A.ip, dst: B.ip },
      encodeIcmp({ type: "echo-request", id: 0x1234, seq: 1, payload }),
    ),
  ),
  encodeEthernet(
    { dst: A.mac, src: B.mac, type: ETHERTYPE_IPV4 },
    encodeIpv4(
      { id: 2, ttl: 64, protocol: PROTO_ICMP, src: B.ip, dst: A.ip },
      encodeIcmp({ type: "echo-reply", id: 0x1234, seq: 1, payload }),
    ),
  ),
];
const records = frames.map((bytes, i) => ({ t_us: 1_000_000 + i * 1500, bytes }));

describe("writePcap", () => {
  it("writes the legacy global header for Ethernet with microsecond timestamps", () => {
    const file = writePcap([]);
    expect(toHex(file)).toBe(
      "a1b2c3d4" + "0002" + "0004" + "00000000" + "00000000" + "0000ffff" + "00000001",
    );
  });

  it("writes one 16 byte record header per frame with seconds, microseconds, and both lengths", () => {
    const frame = hex("deadbeef");
    const file = writePcap([{ t_us: 1_000_500, bytes: frame }]);
    expect(toHex(file.subarray(24))).toBe(
      "00000001" + "000001f4" + "00000004" + "00000004" + "deadbeef",
    );
  });

  it("is dissected by tshark as exactly the frames written, with every checksum good", async () => {
    const packets = await dissect(writePcap(records));
    expect(packets.map((p) => p.summary)).toEqual([
      "ARP request 10.0.1.10 -> 10.0.1.11",
      "ARP reply 10.0.1.11 -> 10.0.1.10",
      "ICMP echo-request 10.0.1.10 -> 10.0.1.11 ttl=64",
      "ICMP echo-reply 10.0.1.11 -> 10.0.1.10 ttl=64",
    ]);
    expect(packets.map((p) => p.t_us)).toEqual(records.map((r) => r.t_us));
    expect(packets.every((p) => p.checksumsGood)).toBe(true);
    expect(packets.every((p) => p.expertErrors.length === 0)).toBe(true);
  });

  it("is dissected by tshark with a time exceeded quote intact", async () => {
    const original = frames[2]?.subarray(14) ?? new Uint8Array();
    const te = encodeEthernet(
      { dst: A.mac, src: B.mac, type: ETHERTYPE_IPV4 },
      encodeIpv4(
        { id: 3, ttl: 64, protocol: PROTO_ICMP, src: B.ip, dst: A.ip },
        encodeIcmp({ type: "time-exceeded", original }),
      ),
    );
    const [packet] = await dissect(writePcap([{ t_us: 0, bytes: te }]));
    expect(packet?.summary).toBe("ICMP time-exceeded 10.0.1.11 -> 10.0.1.10 ttl=64");
    expect(packet?.checksumsGood).toBe(true);
    expect(packet?.expertErrors).toEqual([]);
  });
});
