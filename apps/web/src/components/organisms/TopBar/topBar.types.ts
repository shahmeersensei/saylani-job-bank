import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface BranchOption {
  id: string;
  name: string;
}

export interface UserMenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  tone?: 'default' | 'danger';
}

export interface TopBarProps {
  title?: ReactNode;
  /** Shows the hamburger on small screens. */
  onMenuClick?: () => void;
  /** Super Admin only: switch the active branch scope. */
  branchSwitcher?: {
    branches: BranchOption[];
    value: string;
    onChange: (branchId: string) => void;
  };
  user?: { name: string; role: string; avatarUrl?: string | null };
  userMenuItems?: UserMenuItem[];
  /** Extra controls (notifications bell, etc.) placed before the theme toggle. */
  actions?: ReactNode;
  /** Path for the bell's "View all" link; defaults to /notifications. */
  notificationsHref?: string;
  className?: string;
}
