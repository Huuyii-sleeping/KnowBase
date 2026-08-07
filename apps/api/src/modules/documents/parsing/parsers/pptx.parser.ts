import { Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import { tableToMarkdown } from '../markdown-table.util';
import { FileParserContext, FormatParser, ParsedAsset, ParsedDocument } from '../file-parser.types';
import { extractXmlText, mimeFromExtension, slideNumber, titleFromFileName } from '../parser.utils';

@Injectable()
export class PptxParser implements FormatParser {
  async parse(buffer: Buffer, fileName: string, context: FileParserContext): Promise<ParsedDocument> {
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((left, right) => slideNumber(left) - slideNumber(right));

    if (!slideNames.length) {
      throw new Error('pptx contains no slide XML files');
    }

    const assets: ParsedAsset[] = [];
    const slides: string[] = [];
    for (const slideName of slideNames) {
      const xml = await zip.file(slideName)!.async('string');
      const slideIndex = slideNumber(slideName);
      const textXml = xml.replace(/<a:tbl[\s\S]*?<\/a:tbl>/g, '');
      const text = extractXmlText(textXml);
      const tables = [...xml.matchAll(/<a:tbl[\s\S]*?<\/a:tbl>/g)].map((match) =>
        this.tableFromXml(match[0]),
      );
      const images = await this.extractImages(zip, slideName, xml, context);
      assets.push(...images);

      slides.push(
        [
          `## Slide ${slideIndex}`,
          text ? text.split('\n').map((line) => line.trim()).filter(Boolean).join('\n\n') : '',
          ...tables,
          ...images.map((asset) => `![${asset.alt ?? 'slide image'}](${asset.url})`),
        ].filter(Boolean).join('\n\n'),
      );
    }

    return {
      markdown: `# ${titleFromFileName(fileName)}\n\n${slides.join('\n\n')}\n`,
      assets,
      ready: true,
      parser: 'jszip+pptx-xml',
      warnings: [],
    };
  }

  private tableFromXml(xml: string): string {
    const rows = [...xml.matchAll(/<a:tr[\s\S]*?<\/a:tr>/g)].map((row) =>
      [...row[0].matchAll(/<a:tc[\s\S]*?<\/a:tc>/g)].map((cell) => extractXmlText(cell[0])),
    );
    return tableToMarkdown(rows);
  }

  private async extractImages(
    zip: JSZip,
    slideName: string,
    xml: string,
    context: FileParserContext,
  ): Promise<ParsedAsset[]> {
    const relName = `ppt/slides/_rels/slide${slideNumber(slideName)}.xml.rels`;
    const relFile = zip.file(relName);
    if (!relFile) {
      return [];
    }

    const relXml = await relFile.async('string');
    const relations = new Map<string, string>();
    for (const match of relXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relations.set(match[1], match[2]);
    }

    const assets: ParsedAsset[] = [];
    for (const match of xml.matchAll(/r:embed="([^"]+)"/g)) {
      const target = relations.get(match[1]);
      if (!target) {
        continue;
      }
      const mediaName = target.startsWith('../')
        ? `ppt/${target.replace(/^\.\.\//, '')}`
        : `ppt/slides/${target.replace(/^\.?\//, '')}`;
      const mediaFile = zip.file(mediaName);
      if (!mediaFile) {
        continue;
      }
      const extension = mediaName.split('.').pop() || 'bin';
      assets.push(await context.uploadAsset({
        fileName: `slide-${slideNumber(slideName)}-image-${assets.length + 1}.${extension}`,
        data: await mediaFile.async('nodebuffer'),
        contentType: mimeFromExtension(extension),
        type: 'image',
        alt: `slide ${slideNumber(slideName)} image`,
      }));
    }
    return assets;
  }
}
