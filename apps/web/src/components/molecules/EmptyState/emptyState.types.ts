import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  /**
   * Element for the title. Defaults to `p`; pass `h1` when the empty state *is* the
   * page (e.g. /forbidden) so the page still exposes a top-level heading.
   */
  titleAs?: 'p' | 'h1';
  description?: ReactNode;
  icon?: LucideIcon;
  /** Primary next step, e.g. a "Post a job" button. */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}
