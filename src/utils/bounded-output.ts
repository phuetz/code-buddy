import { StringDecoder } from 'node:string_decoder';

/** Decode a retained UTF-8 segment without exposing a cut code point. */
function decode(bytes: Buffer): string {
  let start = 0;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return new StringDecoder('utf8').write(bytes.subarray(start));
}

/** Bounded byte storage retaining the beginning and most recent end of output. */
export class BoundedOutput {
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private observed = 0;

  constructor(readonly capacity = 256 * 1024) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Output capacity must be a positive integer');
  }

  get retainedBytes(): number { return this.head.length + this.tail.length; }
  get omittedBytes(): number { return this.observed - this.retainedBytes; }

  append(chunk: string | Buffer): void {
    let bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this.observed += bytes.length;
    const headRemaining = Math.ceil(this.capacity / 2) - this.head.length;
    if (headRemaining > 0) {
      this.head = Buffer.concat([this.head, bytes.subarray(0, headRemaining)]);
      bytes = bytes.subarray(headRemaining);
    }
    const tailCapacity = Math.floor(this.capacity / 2);
    if (tailCapacity > 0 && bytes.length > 0) {
      this.tail = bytes.length >= tailCapacity
        ? Buffer.from(bytes.subarray(-tailCapacity))
        : Buffer.concat([this.tail.subarray(Math.max(0, this.tail.length + bytes.length - tailCapacity)), bytes]);
    }
  }

  text(): string {
    if (!this.omittedBytes) return decode(Buffer.concat([this.head, this.tail]));
    return `${decode(this.head)}\n[... ${this.omittedBytes} bytes omitted ...]\n${decode(this.tail)}`;
  }

  /** Consume the pending preview; producers can continue into a fresh bounded buffer. */
  drain(): string {
    const result = this.text();
    this.head = Buffer.alloc(0);
    this.tail = Buffer.alloc(0);
    this.observed = 0;
    return result;
  }
}

/** A rendered byte budget, including the omission marker, for model context. */
export function truncateOutput(text: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Output budget must be a positive integer');
  if (Buffer.byteLength(text) <= maxBytes) return text;
  if (maxBytes < 80) return decode(Buffer.from(text).subarray(0, maxBytes));
  const buffer = new BoundedOutput(maxBytes - 80);
  buffer.append(text);
  return buffer.text();
}
