interface BufferSnapshot {
  text: string;
  bytesSeen: number;
  outputTruncated: boolean;
}

export class HeadTailBuffer {
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private bytesSeen = 0;

  constructor(totalLimitBytes = 256 * 1024) {
    if (totalLimitBytes < 128)
      throw new RangeError("Buffer limit must be at least 128 bytes");
    this.headLimit = Math.floor(totalLimitBytes / 2);
    this.tailLimit = totalLimitBytes - this.headLimit;
  }

  append(chunk: Buffer | string): void {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.bytesSeen += data.length;

    if (this.head.length < this.headLimit) {
      const needed = this.headLimit - this.head.length;
      this.head = Buffer.concat([this.head, data.subarray(0, needed)]);
      if (data.length <= needed) return;
      this.pushTail(data.subarray(needed));
      return;
    }
    this.pushTail(data);
  }

  snapshot(): BufferSnapshot {
    const stored = this.head.length + this.tail.length;
    const truncated = this.bytesSeen > stored;
    if (!truncated) {
      return {
        text: Buffer.concat([this.head, this.tail]).toString("utf8"),
        bytesSeen: this.bytesSeen,
        outputTruncated: false,
      };
    }
    return {
      text: `${this.head.toString("utf8")}\n…[${this.bytesSeen - stored} bytes truncated]…\n${this.tail.toString("utf8")}`,
      bytesSeen: this.bytesSeen,
      outputTruncated: true,
    };
  }

  private pushTail(data: Buffer): void {
    const combined = Buffer.concat([this.tail, data]);
    this.tail =
      combined.length > this.tailLimit
        ? combined.subarray(combined.length - this.tailLimit)
        : combined;
  }
}
