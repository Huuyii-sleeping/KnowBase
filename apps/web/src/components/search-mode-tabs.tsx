import { type SearchMode } from '@/lib/api';
import { SEARCH_MODES } from '@/lib/search-result.utils';
import { cn } from '@/lib/utils';

interface SearchModeTabsProps {
  value: SearchMode;
  onChange: (mode: SearchMode) => void;
}

export function SearchModeTabs({ value, onChange }: SearchModeTabsProps) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-border pb-3" role="tablist" aria-label="检索模式">
      {SEARCH_MODES.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            'rounded-md border px-3.5 py-2 text-left transition-colors',
            value === item.value
              ? 'border-primary bg-primary/5 text-foreground'
              : 'border-border text-muted-foreground hover:bg-accent',
          )}
        >
          <div className="text-[13px] font-medium">{item.label}</div>
          <div className="mt-0.5 text-[11px] opacity-70">{item.description}</div>
        </button>
      ))}
    </div>
  );
}
