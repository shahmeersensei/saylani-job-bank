import type { Role } from '@jobbank/shared';
import { ROLE_HOME } from '@jobbank/shared';
import {
  Bell,
  Building2,
  Calendar,
  Contact,
  FileText,
  Briefcase,
  Gauge,
  ListTree,
  SlidersHorizontal,
  TrendingUp,
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
export function navigationFor(
  role: Role,
  opts: { hideEmployerJobs?: boolean } = {},
): { title?: string; items: NavItemConfig[] }[] {
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
            { href: '/branch-admin/companies', label: 'Companies', icon: Building2 },
            { href: '/branch-admin/applicants', label: 'Applicants', icon: Contact },
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
            { href: '/verifier/companies', label: 'Companies', icon: Building2 },
            { href: '/verifier/jobs', label: 'Jobs', icon: Briefcase },
          ],
        },
      ];
    case 'STAFF':
      return [
        {
          items: [
            overview,
            { href: '/staff/applicants', label: 'Applicants', icon: Contact },
            { href: '/staff/jobs', label: 'Jobs', icon: Briefcase },
          ],
        },
      ];
    case 'INTERVIEWER_SCHEDULER':
      return [
        {
          items: [
            overview,
            {
              href: '/interviewer-scheduler/interviews',
              label: 'Interviews',
              icon: Calendar,
            },
            {
              href: '/interviewer-scheduler/applicants',
              label: 'Applicants',
              icon: Contact,
            },
          ],
        },
      ];
    case 'APPLICANT':
      return [
        {
          items: [
            overview,
            { href: '/applicant/jobs', label: 'Job Matches', icon: Briefcase },
            { href: '/applicant/progress', label: 'My Progress', icon: TrendingUp },
            { href: '/applicant/notifications', label: 'Notifications', icon: Bell },
            { href: '/applicant/profile', label: 'My Profile', icon: UserRound },
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
            // No visible jobs (own postings or referrals) → no Jobs section.
            ...(opts.hideEmployerJobs
              ? []
              : [{ href: '/employer/jobs', label: 'Jobs', icon: Briefcase }]),
            // Referrals entry removed 2026-11-12 (Act of employer removed):
            // employers no longer see or decide referred candidates.
          ],
        },
      ];
    default:
      return [{ items: [overview] }];
  }
}
