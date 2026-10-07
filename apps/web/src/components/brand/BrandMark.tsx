import { cn } from '@/lib/utils/cn';

export function BrandMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <span
          className="text-sm font-extrabold tracking-tight"
          style={{ color: 'var(--sidebar-fg)' }}
        >
          SJB
        </span>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center', className)}>
      <span className="grid leading-tight">
        <span
          className="block text-xl font-extrabold tracking-tight"
          style={{ color: 'var(--sidebar-fg)' }}
        >
          Saylani <span style={{ color: 'var(--primary)' }}>Job Bank</span>
        </span>
      </span>
    </span>
  );
}
