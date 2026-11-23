import { HybridSearchItem } from '../search/hybrid-search.service';

export interface AnswerContentRange {
  // Half-open UTF-16 offsets into the original candidate content (String.slice).
  start: number;
  end: number;
}

export interface AnswerContextItem extends HybridSearchItem {
  contentRange?: AnswerContentRange;
}
