/** A growable little-endian byte writer and a bounds-checked reader over DataView. */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  reset(): this {
    this.length = 0;
    return this;
  }

  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    this.room(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
    return this;
  }
  u16(v: number): this {
    this.room(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
    return this;
  }
  i16(v: number): this {
    this.room(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
    return this;
  }
  u32(v: number): this {
    this.room(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
    return this;
  }
  i32(v: number): this {
    this.room(4);
    this.view.setInt32(this.length, v | 0, true);
    this.length += 4;
    return this;
  }

  /** A copy of the written bytes (safe to keep or send). */
  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class ProtocolError extends Error {
  override name = 'ProtocolError';
}

export class ByteReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (this.offset + n > this.bytes.length) throw new ProtocolError('message too short');
  }
  get remaining(): number {
    return this.bytes.length - this.offset;
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }
  end(): void {
    if (this.offset !== this.bytes.length) throw new ProtocolError('trailing bytes');
  }
}
