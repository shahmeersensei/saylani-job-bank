import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { EmptyStateProps } from './emptyState.types';

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  compact,
  className,
  titleAs: Title = 'p',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 py-6' : 'gap-3 py-12',
        className,
      )}
    >
      <div className="bg-surface-muted text-fg-muted grid size-12 place-items-center rounded-full">
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <div className="grid max-w-sm gap-1">
        <Title className="text-fg text-base font-semibold">{title}</Title>
        {description && <p className="text-fg-muted text-sm">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
