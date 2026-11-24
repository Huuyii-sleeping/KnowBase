export interface ByteRange {
  start: number;
  end: number;
}

/** A single RFC 9110 byte range; multipart responses are intentionally unsupported. */
export function byteRange(header: string, size: number): ByteRange | undefined {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error('Invalid object size');
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return undefined;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last))
  )
    return undefined;
  if (first === undefined) {
    if (!last) return undefined;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== undefined && last < first)) return undefined;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
