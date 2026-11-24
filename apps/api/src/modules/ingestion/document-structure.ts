import type { TableData } from './tables/table.types';

export interface SourceLocation {
  startMs?: number;
  endMs?: number;
  page?: number;
  slide?: number;
  sheet?: string;
  rowStart?: number;
  rowEnd?: number;
  blockIndex?: number;
  bbox?: number[];
  partition?: number;
  // Logical rows within a parsed table; never presented as original sheet rows.
  tableId?: string;
  tableRowStart?: number;
  tableRowEnd?: number;
  // When an explicit PDF continuation borrows a header, keep its actual source page.
  tableHeaderPage?: number;
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
  table?: TableData;
  // Persisted blocks refer to the canonical table stored once in content.tables.
  tableId?: string;
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
