import { formatIp, parseIp } from "../addr.js";

export function hex(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Big-endian field writer over a fixed-size buffer. */
export class Writer {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(v: number): this {
    this.view.setUint8(this.offset, v);
    this.offset += 1;
    return this;
  }

  u16(v: number): this {
    this.view.setUint16(this.offset, v);
    this.offset += 2;
    return this;
  }

  u32(v: number): this {
    this.view.setUint32(this.offset, v);
    this.offset += 4;
    return this;
  }

  mac(text: string): this {
    for (const part of text.split(":")) this.u8(Number.parseInt(part, 16));
    return this;
  }

  ip(text: string): this {
    return this.u32(parseIp(text));
  }

  raw(bytes: Uint8Array): this {
    this.bytes.set(bytes, this.offset);
    this.offset += bytes.length;
    return this;
  }
}

/** Big-endian field reader that throws on short input. */
export class Reader {
  private readonly view: DataView;
  private offset = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly what: string,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (this.offset + n > this.bytes.length) throw new Error(`${this.what}: too short`);
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset);
    this.offset += 4;
    return v;
  }

  mac(): string {
    return Array.from({ length: 6 }, () => this.u8().toString(16).padStart(2, "0")).join(":");
  }

  ip(): string {
    return formatIp(this.u32());
  }

  rest(): Uint8Array {
    const out = this.bytes.subarray(this.offset);
    this.offset = this.bytes.length;
    return out;
  }
}
