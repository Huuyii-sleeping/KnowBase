import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

const FORMAT_COLORS: Record<string, string> = {
  PDF: 'border-rose-100 bg-rose-50 text-rose-600',
  DOCX: 'border-blue-100 bg-blue-50 text-blue-600',
  XLSX: 'border-emerald-100 bg-emerald-50 text-emerald-600',
  PPTX: 'border-orange-100 bg-orange-50 text-orange-600',
  MD: 'border-teal-100 bg-teal-50 text-teal-600',
};

export function FileSymbol({ fileName }: { fileName: string }) {
  const format = fileName.includes('.')
    ? fileName.split('.').pop()!.toUpperCase()
    : 'FILE';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'file-symbol',
        FORMAT_COLORS[format] ?? 'border-slate-200 bg-slate-50 text-slate-500',
      )}
    >
      <Icon name="file" width={17} height={17} />
      {format.slice(0, 4)}
    </span>
  );
}
