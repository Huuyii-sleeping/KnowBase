export function decodeText(buffer: Buffer): string {
  let text: string;
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    text = new TextDecoder('utf-16le', { fatal: true }).decode(buffer);
  else if (buffer[0] === 0xfe && buffer[1] === 0xff)
    text = new TextDecoder('utf-16be', { fatal: true }).decode(buffer);
  else text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  text = text.replace(/\r\n?/g, '\n').trim();
  if (!text || text.includes('\0'))
    throw new Error(
      'Text is empty or contains binary data. Use UTF-8 or BOM-marked UTF-16.',
    );
  return text;
}
