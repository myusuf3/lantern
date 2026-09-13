import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const FIELDS = [
  "frame.number",
  "frame.time_epoch",
  "arp.opcode",
  "arp.src.proto_ipv4",
  "arp.dst.proto_ipv4",
  "ip.src",
  "ip.dst",
  "ip.ttl",
  "icmp.type",
  "ip.checksum.status",
  "icmp.checksum.status",
  "_ws.expert.severity",
  "_ws.expert.message",
];
const SEPARATOR = "|";
const AGGREGATOR = ";";
const SEVERITY_WARN = 6291456;
const CHECKSUM_BAD = "0";
const ARP_OP = { "1": "request", "2": "reply" } as const;
const ICMP_TYPE = { "0": "echo-reply", "8": "echo-request", "11": "time-exceeded" } as const;
const HINT =
  "tshark not found on PATH; run the tests under `nix shell nixpkgs#wireshark-cli -c pnpm test`";

export interface DissectedPacket {
  number: number;
  t_us: number;
  /** One line per packet, e.g. `ICMP echo-request 10.0.1.10 -> 10.0.1.11 ttl=64`. */
  summary: string;
  /** No IPv4 or ICMP checksum was reported bad. Unverified inner checksums do not count. */
  checksumsGood: boolean;
  /** Expert messages at warning severity or above, including malformed packets. */
  expertErrors: string[];
}

/** Dissect a pcap with Wireshark's own dissectors. This is the ground truth for "valid pcap". */
export async function dissect(pcap: Uint8Array): Promise<DissectedPacket[]> {
  const dir = await mkdtemp(join(tmpdir(), "lantern-tshark-"));
  const file = join(dir, "capture.pcap");
  try {
    await writeFile(file, pcap);
    const args = [
      "-r",
      file,
      "-o",
      "ip.check_checksum:TRUE",
      "-T",
      "fields",
      "-E",
      `separator=${SEPARATOR}`,
      "-E",
      `aggregator=${AGGREGATOR}`,
      ...FIELDS.flatMap((f) => ["-e", f]),
    ];
    const { stdout } = await run("tshark", args).catch((e: NodeJS.ErrnoException) => {
      throw new Error(e.code === "ENOENT" ? HINT : `tshark failed: ${e.message}`);
    });
    return stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map(parseLine);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseLine(line: string): DissectedPacket {
  const cols = line.split(SEPARATOR);
  const field = (name: string) => cols[FIELDS.indexOf(name)] ?? "";
  const multi = (name: string) =>
    field(name)
      .split(AGGREGATOR)
      .filter((v) => v.length > 0);

  const severities = multi("_ws.expert.severity").map(Number);
  const messages = multi("_ws.expert.message");
  const expertErrors = messages.filter((_, i) => (severities[i] ?? 0) >= SEVERITY_WARN);
  const statuses = [...multi("ip.checksum.status"), ...multi("icmp.checksum.status")];

  return {
    number: Number(field("frame.number")),
    t_us: Math.round(Number(field("frame.time_epoch")) * 1_000_000),
    summary: summarize(field, multi),
    checksumsGood: !statuses.includes(CHECKSUM_BAD),
    expertErrors,
  };
}

function summarize(field: (n: string) => string, multi: (n: string) => string[]): string {
  const arpOp = field("arp.opcode") as keyof typeof ARP_OP;
  if (arpOp in ARP_OP) {
    return `ARP ${ARP_OP[arpOp]} ${field("arp.src.proto_ipv4")} -> ${field("arp.dst.proto_ipv4")}`;
  }
  // Time exceeded quotes an inner packet; the outer values come first in each aggregate.
  const icmpType = multi("icmp.type")[0] as keyof typeof ICMP_TYPE;
  if (icmpType in ICMP_TYPE) {
    const [src, dst, ttl] = [multi("ip.src")[0], multi("ip.dst")[0], multi("ip.ttl")[0]];
    return `ICMP ${ICMP_TYPE[icmpType]} ${src} -> ${dst} ttl=${ttl}`;
  }
  return "unknown";
}
