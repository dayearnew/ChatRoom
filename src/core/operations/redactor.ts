const SECRET_KEY = new RegExp(
  "(^|[_-])" +
    "(authorization|cookie|password|passwd|token|access[_-]?token|" +
    "refresh[_-]?token|api[_-]?key|apikey|secret|private[_-]?key|" +
    "client[_-]?secret)" +
    "($|[_-])",
  "i",
);
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const PEM =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;
const INLINE_SECRET =
  /\b(password|passwd|token|api[_-]?key|secret|client[_-]?secret)\s*[:=]\s*([^\s,;]+)/gi;
const CLI_SECRET =
  /(--(?:password|passwd|token|api-key|api_key|secret|client-secret))\s+([^\s]+)/gi;

export class SecretRedactor {
  redact(value: unknown): unknown {
    return this.walk(value, new WeakSet<object>());
  }

  private walk(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === "string") {
      return value
        .replace(BEARER, "Bearer [redacted]")
        .replace(PEM, "[redacted]")
        .replace(INLINE_SECRET, "$1=[redacted]")
        .replace(CLI_SECRET, "$1 [redacted]");
    }
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) return value.map((item) => this.walk(item, seen));

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = SECRET_KEY.test(key)
        ? "[redacted]"
        : key === "args" && Array.isArray(item)
          ? redactArguments(item, (entry) => this.walk(entry, seen))
          : this.walk(item, seen);
    }
    return result;
  }
}

function redactArguments(
  args: unknown[],
  redactValue: (value: unknown) => unknown,
): unknown[] {
  const output: unknown[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      output.push("[redacted]");
      redactNext = false;
      continue;
    }
    if (typeof arg === "string") {
      const equals =
        /^(--(?:password|passwd|token|api-key|api_key|secret|client-secret))=(.*)$/i.exec(
          arg,
        );
      if (equals) {
        output.push(`${equals[1]}=[redacted]`);
        continue;
      }
      if (
        /^--(?:password|passwd|token|api-key|api_key|secret|client-secret)$/i.test(
          arg,
        )
      ) {
        output.push(arg);
        redactNext = true;
        continue;
      }
    }
    output.push(redactValue(arg));
  }
  return output;
}
