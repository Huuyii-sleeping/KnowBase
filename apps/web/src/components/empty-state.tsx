import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';

export function EmptyState({
  icon = 'files',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon name={icon} width={25} height={25} />
      </div>
      <h2 className="mt-4 text-[15px] font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
