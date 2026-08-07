import { Badge } from '@/components/ui/badge';
import type { DocumentParseStatus, DocumentStatus } from '@/lib/api';

const STATUS_MAP: Record<DocumentStatus, { label: string; variant: 'neutral' | 'amber' | 'green' | 'red' }> = {
  DRAFT: { label: '草稿', variant: 'neutral' },
  PENDING_REVIEW: { label: '待审核', variant: 'amber' },
  PUBLISHED: { label: '已发布', variant: 'green' },
  REJECTED: { label: '已驳回', variant: 'red' },
};

const PARSE_MAP: Record<DocumentParseStatus, { label: string; variant: 'blue' | 'neutral' | 'red' }> = {
  PENDING: { label: '解析中', variant: 'blue' },
  READY: { label: '就绪', variant: 'neutral' },
  FAILED: { label: '失败', variant: 'red' },
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const { label, variant } = STATUS_MAP[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function ParseBadge({ status }: { status: DocumentParseStatus }) {
  const { label, variant } = PARSE_MAP[status];
  return <Badge variant={variant}>{label}</Badge>;
}
