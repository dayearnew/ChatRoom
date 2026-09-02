export interface BoundedValue<T = unknown> {
  value: T;
  truncated: boolean;
}

export function boundJson(value: unknown, maxBytes: number): BoundedValue {
  if (value === undefined) return { value: null, truncated: false };
  const json = safeStringify(value);
  const size = Buffer.byteLength(json);
  if (size <= maxBytes)
    return { value: JSON.parse(json) as unknown, truncated: false };

  const encoded = Buffer.from(json);
  const marker = "\n…[truncated]…\n";
  let low = 0;
  let high = encoded.length;
  let best = truncatedValue(encoded, marker, size, 0);

  while (low <= high) {
    const retainedBytes = Math.floor((low + high) / 2);
    const candidate = truncatedValue(encoded, marker, size, retainedBytes);
    if (Buffer.byteLength(JSON.stringify(candidate)) <= maxBytes) {
      best = candidate;
      low = retainedBytes + 1;
    } else {
      high = retainedBytes - 1;
    }
  }

  return { value: best, truncated: true };
}

function truncatedValue(
  encoded: Buffer,
  marker: string,
  originalBytes: number,
  retainedBytes: number,
) {
  const headBytes = Math.floor(retainedBytes / 2);
  const tailBytes = retainedBytes - headBytes;
  const head = encoded.subarray(0, headBytes).toString("utf8");
  const tail = encoded
    .subarray(Math.max(0, encoded.length - tailBytes))
    .toString("utf8");
  return {
    truncatedJson: `${head}${marker}${tail}`,
    originalBytes,
  };
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, current: unknown) => {
      if (typeof current === "bigint") return current.toString();
      if (current instanceof Error) {
        return {
          name: current.name,
          message: current.message,
          stack: current.stack,
        };
      }
      if (current && typeof current === "object") {
        if (seen.has(current)) return "[circular]";
        seen.add(current);
      }
      return current;
    }) ?? "null"
  );
}
