export interface SourceLocation {
  page?: number;
  slide?: number;
  sheet?: string;
  rowStart?: number;
  rowEnd?: number;
  blockIndex?: number;
  bbox?: number[];
  partition?: number;
}

// Offsets are UTF-16 positions in the stored Markdown, never binary file offsets.
export interface SourceSection {
  start: number;
  end: number;
  source: SourceLocation;
}

export interface DocumentBlock {
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'code' | 'equation';
  text: string;
  start: number;
  end: number;
  headingPath: string[];
  source?: SourceLocation;
}

export const PARSE_STRATEGY = 'structured-markdown-v1';

export function validateSections(
  markdown: string,
  sections: SourceSection[],
): void {
  let previousEnd = 0;
  for (const section of sections) {
    if (
      !Number.isInteger(section.start) ||
      !Number.isInteger(section.end) ||
      section.start < previousEnd ||
      section.end <= section.start ||
      section.end > markdown.length
    ) {
      throw new Error('invalid or overlapping Markdown source section');
    }
    previousEnd = section.end;
  }
}
