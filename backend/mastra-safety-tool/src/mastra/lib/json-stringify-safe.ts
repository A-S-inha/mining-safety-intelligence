/** JSON.stringify with circular refs replaced and long strings truncated (for trace / audit files). */
export function stringifyJsonlLine(value: unknown, maxStringLength = 20_000): string {
  const seen = new WeakSet<object>();
  return `${JSON.stringify(value, (_key, raw) => {
    if (typeof raw === 'string' && raw.length > maxStringLength) {
      return `${raw.slice(0, maxStringLength)}…[truncated:${raw.length}]`;
    }
    if (typeof raw === 'object' && raw !== null) {
      if (seen.has(raw)) return '[Circular]';
      seen.add(raw);
    }
    if (typeof raw === 'bigint') return raw.toString();
    return raw;
  })}\n`;
}
