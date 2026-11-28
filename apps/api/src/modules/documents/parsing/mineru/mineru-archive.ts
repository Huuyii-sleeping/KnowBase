import JSZip from 'jszip';

export async function mineruArchive(
  buffer: Buffer,
  maxBytes: number,
): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length > 2000) throw new Error('MinerU archive has too many files');
  const output = new Map<string, Buffer>();
  let total = 0;
  for (const entry of files) {
    const original = entry.unsafeOriginalName ?? entry.name;
    if (
      original.startsWith('/') ||
      original.includes('\\') ||
      original.split('/').some((p) => p === '..' || p === '.') ||
      output.has(original)
    )
      throw new Error('Unsafe MinerU archive path');
    // Check declared size before decompression, then enforce the actual budget too.
    const declared = (
      entry as unknown as { _data?: { uncompressedSize?: number } }
    )._data?.uncompressedSize;
    if (declared === undefined || declared + total > maxBytes)
      throw new Error('MinerU archive exceeds byte budget');
    const bytes = await entry.async('nodebuffer');
    total += bytes.length;
    if (total > maxBytes) throw new Error('MinerU archive exceeds byte budget');
    output.set(original, bytes);
  }
  for (const required of [
    'markdown.md',
    'structured_content.json',
    'middle_json.json',
  ])
    if (!output.has(required)) throw new Error(`Missing MinerU ${required}`);
  return output;
}
