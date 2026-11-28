import { extname } from 'node:path';
import {
  FileParserContext,
  ParsedAsset,
  ParseQuality,
} from '../file-parser.types';
import { mimeFromExtension } from '../parser.utils';

// Resolve only packaged assets. HTML external/relative images become visible
// review markers; parsing never initiates a network request for those images.
export async function mineruImages(
  files: Map<string, Buffer>,
  context: FileParserContext,
  html: boolean,
) {
  const assets: ParsedAsset[] = [];
  const replacements = new Map<string, string>();
  const packaged = new Map<string, ParsedAsset>();
  const missing = new Set<string>();
  const issues: ParseQuality['issues'] = [];
  for (const [name, bytes] of files) {
    if (!name.startsWith('images/')) continue;
    const extension = extname(name).slice(1);
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension))
      throw new Error('Unsupported MinerU image type');
    const asset = await context.uploadAsset({
      fileName: name.replaceAll('/', '-'),
      data: bytes,
      contentType:
        extension === 'webp' ? 'image/webp' : mimeFromExtension(extension),
      type: 'image',
    });
    assets.push(asset);
    replacements.set(name, asset.url);
    packaged.set(name, asset);
  }
  const render = (source: string, alt = '') => {
    if (typeof source !== 'string' || !source.trim())
      throw new Error('Invalid MinerU image reference');
    const url = replacements.get(source);
    if (url) return `![${alt}](${url})`;
    const externalOrRelative =
      /^(https?:)?\/\//i.test(source) ||
      (!/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('images/'));
    if (!html || !externalOrRelative)
      throw new Error('MinerU image reference is missing or external');
    if (!missing.has(source)) {
      missing.add(source);
      issues.push({
        code: 'HTML_IMAGE_NOT_IMPORTED',
        message:
          'HTML image was not embedded in the snapshot; review the original.',
      });
    }
    // Keep source URLs out of rendered content, including tracking/private URLs.
    return '[网页图片未导入，需核对原文]';
  };
  const rewrite = (text: string) =>
    text
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, source) =>
        render(source, alt),
      )
      .replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi, (_match, source) =>
        render(source),
      );
  return {
    assets,
    issues,
    render,
    rewrite,
    asset: (name: string) => packaged.get(name),
  };
}
