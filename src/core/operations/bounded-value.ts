/** Utilities for bounding JSON-like operation payloads before persistence. */
export interface BoundedValue<T = unknown> {
  value: T;
  truncated: boolean;
}

export function boundJson(value: unknown, maxBytes: number): BoundedValue {
  // Preserve both the beginning and end of oversized strings because failures commonly appear at the tail.
  if (value === undefined) return { value: null, truncated: false };
  const json = safeStringify(value);
  const size = Buffer.byteLength(json);
  if (size <= maxBytes)
    return { value: JSON.parse(json) as unknown, truncated: false };

  const marker = "\n…[truncated]…\n";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker));
  const headBudget = Math.floor(budget / 2);
  const tailBudget = budget - headBudget;
  const encoded = Buffer.from(json);
  const head = encoded.subarray(0, headBudget).toString("utf8");
  const tail = encoded.subarray(encoded.length - tailBudget).toString("utf8");
  const text = `${head}${marker}${tail}`;
  return {
    value: { truncatedJson: text, originalBytes: size },
    truncated: true,
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
