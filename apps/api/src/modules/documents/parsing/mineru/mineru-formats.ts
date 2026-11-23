// Only advertise formats covered by this application's adapter and regression corpus.
// MinerU's own supported-format list is broader and may change independently.
export const MINERU_FLASH_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.html',
  '.htm',
]);
export const MINERU_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);

export function mineruSupports(extension: string): boolean {
  return (
    extension === '.pdf' ||
    MINERU_FLASH_EXTENSIONS.has(extension) ||
    MINERU_IMAGE_EXTENSIONS.has(extension)
  );
}
