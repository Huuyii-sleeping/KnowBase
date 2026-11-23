import { Logger } from '@nestjs/common';
import { PNG } from 'pngjs';
import { FileParserContext, ParsedAsset } from '../file-parser.types';
import { errorMessage } from '../parser.utils';

export class PdfImages {
  private readonly logger = new Logger(PdfImages.name);
  async extract(
    pageData: any,
    pageNumber: number,
    context: FileParserContext,
  ): Promise<ParsedAsset[]> {
    const images: ParsedAsset[] = [];
    try {
      const operatorList = await pageData.getOperatorList();
      const imageOperations = new Set([82, 85, 86, 87, 88]);
      for (let index = 0; index < operatorList.fnArray.length; index += 1) {
        if (!imageOperations.has(operatorList.fnArray[index])) {
          continue;
        }
        const imageName = operatorList.argsArray[index]?.[0];
        if (
          typeof imageName !== 'string' ||
          !pageData.objs?.isResolved?.(imageName)
        ) {
          continue;
        }
        const imageData = pageData.objs.get(imageName);
        const png = this.imageToPng(imageData);
        if (!png) {
          continue;
        }
        images.push(
          await context.uploadAsset({
            fileName: `page-${pageNumber}-image-${images.length + 1}.png`,
            data: png,
            contentType: 'image/png',
            type: 'image',
            alt: `page ${pageNumber} image`,
          }),
        );
      }
    } catch (error) {
      this.logger.warn(
        `PDF image extraction skipped on page ${pageNumber}: ${errorMessage(error)}`,
      );
    }
    return images;
  }

  private imageToPng(imageData: any): Buffer | undefined {
    const width = Number(imageData?.width);
    const height = Number(imageData?.height);
    const source = imageData?.data;
    if (!width || !height || !source) {
      return undefined;
    }

    const kind = Number(imageData.kind ?? 3);
    const rgba = Buffer.alloc(width * height * 4);
    if (kind === 1) {
      const bytes = Buffer.from(source);
      const rowBytes = Math.ceil(width / 8);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const bit =
            (bytes[y * rowBytes + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
          const value = bit ? 0 : 255;
          const offset = (y * width + x) * 4;
          rgba[offset] = value;
          rgba[offset + 1] = value;
          rgba[offset + 2] = value;
          rgba[offset + 3] = 255;
        }
      }
    } else if (kind === 2) {
      const bytes = Buffer.from(source);
      for (let index = 0; index < width * height; index += 1) {
        const sourceOffset = index * 3;
        const targetOffset = index * 4;
        rgba[targetOffset] = bytes[sourceOffset] ?? 0;
        rgba[targetOffset + 1] = bytes[sourceOffset + 1] ?? 0;
        rgba[targetOffset + 2] = bytes[sourceOffset + 2] ?? 0;
        rgba[targetOffset + 3] = 255;
      }
    } else if (kind === 3) {
      Buffer.from(source).copy(
        rgba,
        0,
        0,
        Math.min(rgba.length, source.length),
      );
    } else {
      return undefined;
    }

    return PNG.sync.write({ width, height, data: rgba } as any);
  }
}
