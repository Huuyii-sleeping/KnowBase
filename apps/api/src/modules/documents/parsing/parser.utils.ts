import { extname } from 'node:path';

export function titleFromFileName(fileName: string): string {
  return fileName.replace(extname(fileName), '') || 'Untitled document';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function extensionFromMime(contentType?: string): string {
  return contentType?.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
}

export function mimeFromExtension(extension: string): string {
  const values: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };
  return values[extension.toLowerCase()] || 'application/octet-stream';
}

export function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function extractXmlText(xml: string): string {
  return [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('\n');
}

export function slideNumber(fileName: string): number {
  return Number(fileName.match(/slide(\d+)\.xml/)?.[1] ?? 0);
}
