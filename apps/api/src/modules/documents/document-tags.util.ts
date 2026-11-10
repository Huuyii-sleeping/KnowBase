export function parseDocumentTags(raw?: string): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map(String)
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];
  } catch {
    return raw
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
}
