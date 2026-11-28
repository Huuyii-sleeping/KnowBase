import { SourceLocation } from '../../ingestion/document-structure';

export interface EvidenceUnit {
  schema: 'evidence-v1';
  id: string;
  kind:
    | 'image'
    | 'table'
    | 'worksheet_row'
    | 'audio_segment'
    | 'video_scene'
    | 'web_snapshot';
  source: SourceLocation & {
    cellRange?: string;
    startMs?: number;
    endMs?: number;
  };
  objectKeys: string[];
  text: string;
  producer: string;
  data: Record<string, unknown>;
}
export interface EvidenceManifest {
  count: number;
  digest: string;
}
