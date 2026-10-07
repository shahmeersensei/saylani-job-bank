import type { Role } from '@jobbank/shared';
import { ROLE_HOME } from '@jobbank/shared';
import {
  Building2,
  CheckSquare,
  Contact,
  FileText,
  Briefcase,
  Gauge,
  ListTree,
  SlidersHorizontal,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItemConfig {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

/**
 * Sidebar per role. Each module adds its pages here as they are delivered
 * (only routes that exist are listed — no dead links).
 */
export function navigationFor(role: Role): { title?: string; items: NavItemConfig[] }[] {
  const overview: NavItemConfig = {
    href: ROLE_HOME[role],
    label: 'Overview',
    icon: Gauge,
    exact: true,
  };
  switch (role) {
    case 'SUPER_ADMIN':
      return [
        { items: [overview] },
        {
          title: 'Job seekers',
          items: [{ href: '/super-admin/applicants', label: 'Applicants', icon: Contact }],
        },
        {
          title: 'Employers',
          items: [
            { href: '/super-admin/companies', label: 'Companies', icon: Building2 },
            { href: '/super-admin/jobs', label: 'Jobs', icon: Briefcase },
          ],
        },
        {
          title: 'Administration',
          items: [
            { href: '/super-admin/branches', label: 'Branches', icon: Building2 },
            { href: '/super-admin/staff', label: 'Staff', icon: Users },
            { href: '/super-admin/master-data', label: 'Master data', icon: ListTree },
            { href: '/super-admin/settings', label: 'Settings', icon: SlidersHorizontal },
          ],
        },
      ];
    case 'BRANCH_ADMIN':
      return [
        {
          items: [
            overview,
            { href: '/branch-admin/applicants', label: 'Applicants', icon: Contact },
            { href: '/branch-admin/companies', label: 'Companies', icon: Building2 },
            { href: '/branch-admin/jobs', label: 'Jobs', icon: Briefcase },
            { href: '/branch-admin/staff', label: 'Staff', icon: Users },
            { href: '/branch-admin/settings', label: 'Branch settings', icon: SlidersHorizontal },
          ],
        },
      ];
    case 'VERIFIER':
      return [
        {
          items: [
            overview,
            { href: '/verifier/queue', label: 'Verification queue', icon: CheckSquare },
          ],
        },
      ];
    case 'STAFF':
      return [
        {
          items: [overview, { href: '/staff/applicants', label: 'Applicants', icon: Contact }],
        },
      ];
    case 'APPLICANT':
      return [
        {
          items: [
            overview,
            { href: '/applicant/profile', label: 'My profile', icon: UserRound },
            { href: '/applicant/documents', label: 'Documents', icon: FileText },
          ],
        },
      ];
    case 'EMPLOYER':
      return [
        {
          items: [
            overview,
            { href: '/employer/company', label: 'Company', icon: Building2 },
            { href: '/employer/jobs', label: 'Jobs', icon: Briefcase },
          ],
        },
      ];
    default:
      return [{ items: [overview] }];
  }
}
