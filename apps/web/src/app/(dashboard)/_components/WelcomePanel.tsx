import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileText,
  GitBranch,
  MapPin,
  Settings,
  ShieldCheck,
  Star,
  Target,
  UserRound,
  Users,
  Zap,
} from 'lucide-react';
import { InteractiveBarChart, CardActionMenu } from './InteractiveBarChart';
import type { LucideIcon } from 'lucide-react';
import NextLink from 'next/link';
import { ROLE_LABELS, type Role } from '@jobbank/shared';
import { describeMe, requireRole } from '@/domains/auth';
import { listBranches } from '@/domains/branch';
import { listApplicants, getMyProfile } from '@/domains/applicant';
import { listCompanies, listQueue } from '@/domains/company';
import { listStaff } from '@/domains/user';
import { listMyJobs } from '@/domains/job';
import { formatPkMobileDisplay } from '@/lib/format/phone';

/* ─── Monthly chart labels ──────────────────────────────────────── */
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/* ─── Chart shape (illustrative — real time-series coming later) ── */
const ROLE_CHART: Record<Role, { values: number[]; peak: number; label: string }> = {
  SUPER_ADMIN: {
    values: [12, 18, 15, 22, 19, 26, 23, 31, 28, 0, 0, 0],
    peak: 31,
    label: 'Monthly Registrations',
  },
  BRANCH_ADMIN: {
    values: [5, 8, 6, 10, 9, 13, 11, 16, 14, 0, 0, 0],
    peak: 16,
    label: 'Branch Registrations',
  },
  VERIFIER: {
    values: [20, 28, 24, 35, 30, 42, 38, 48, 44, 0, 0, 0],
    peak: 48,
    label: 'Verifications Done',
  },
  STAFF: { values: [8, 12, 10, 16, 14, 20, 18, 24, 22, 0, 0, 0], peak: 24, label: 'Cases Handled' },
  EMPLOYER: { values: [0, 1, 1, 2, 1, 3, 2, 4, 3, 0, 0, 0], peak: 4, label: 'Hires Made' },
  APPLICANT: {
    values: [10, 20, 35, 50, 60, 68, 75, 82, 88, 0, 0, 0],
    peak: 88,
    label: 'Profile Strength %',
  },
};

/* ─── Action buttons per role (static) ─────────────────────────── */
const ROLE_ACTIONS: Record<
  Role,
  {
    action1: { label: string; href: string };
    action2: { label: string; href: string };
  }
> = {
  SUPER_ADMIN: {
    action1: { label: 'Browse Applicants', href: '/super-admin/applicants' },
    action2: { label: 'Manage Staff', href: '/super-admin/staff' },
  },
  BRANCH_ADMIN: {
    action1: { label: 'View Applicants', href: '/branch-admin/applicants' },
    action2: { label: 'Add Staff', href: '/branch-admin/staff' },
  },
  VERIFIER: {
    action1: { label: 'Open Queue', href: '/verifier/queue' },
    action2: { label: 'My Cases', href: '/verifier/queue?filter=mine' },
  },
  STAFF: {
    action1: { label: 'View Applicants', href: '/staff/applicants' },
    action2: { label: 'Open Jobs', href: '/staff/jobs' },
  },
  EMPLOYER: {
    action1: { label: 'Post a Job', href: '/employer/jobs/new' },
    action2: { label: 'View Candidates', href: '/employer/candidates' },
  },
  APPLICANT: {
    action1: { label: 'Edit Profile', href: '/applicant/profile' },
    action2: { label: 'My Documents', href: '/applicant/documents' },
  },
};

/* ─── Recent activity (illustrative until audit log is built) ───── */
const ROLE_ACTIVITY: Record<
  Role,
  {
    icon: LucideIcon;
    action: string;
    detail: string;
    when: string;
    price: string;
    status: 'success' | 'pending' | 'info' | 'warning';
  }[]
> = {
  SUPER_ADMIN: [
    {
      icon: Building2,
      action: 'Company Verified',
      detail: 'TechCorp Pvt Ltd',
      when: 'Today, 10:42 AM',
      price: 'Karachi',
      status: 'success',
    },
    {
      icon: GitBranch,
      action: 'Branch Added',
      detail: 'Faisalabad North',
      when: 'Today, 9:15 AM',
      price: '3 staff',
      status: 'success',
    },
    {
      icon: Users,
      action: 'Staff Joined',
      detail: 'Ayesha Khan',
      when: 'Yesterday, 4:30 PM',
      price: 'Lahore',
      status: 'info',
    },
    {
      icon: ShieldCheck,
      action: 'Verification Issue',
      detail: 'CNIC dispute',
      when: 'Yesterday, 2:00 PM',
      price: 'Rawalpindi',
      status: 'warning',
    },
    {
      icon: Activity,
      action: 'Placement Recorded',
      detail: 'Ahmed Ali',
      when: '2 days ago',
      price: 'Multan',
      status: 'success',
    },
  ],
  BRANCH_ADMIN: [
    {
      icon: Users,
      action: 'New Applicant',
      detail: 'Fatima Bibi',
      when: 'Today, 11:05 AM',
      price: 'House Helper',
      status: 'success',
    },
    {
      icon: Building2,
      action: 'Employer Inquiry',
      detail: 'Royal Home Services',
      when: 'Today, 9:48 AM',
      price: 'Pending',
      status: 'pending',
    },
    {
      icon: ShieldCheck,
      action: 'ID Verified',
      detail: 'Zubair Ahmed',
      when: 'Yesterday, 3:20 PM',
      price: 'CNIC Check',
      status: 'success',
    },
    {
      icon: Briefcase,
      action: 'Job Posted',
      detail: 'Cook — DHA Phase 5',
      when: 'Yesterday, 1:00 PM',
      price: 'Lahore',
      status: 'info',
    },
    {
      icon: Activity,
      action: 'Placement Confirmed',
      detail: 'Nasreen Bano',
      when: '2 days ago',
      price: 'Driver Helper',
      status: 'success',
    },
  ],
  VERIFIER: [
    {
      icon: CheckCircle2,
      action: 'Identity Verified',
      detail: 'CNIC — Case #1045',
      when: 'Today, 11:30 AM',
      price: 'Pass',
      status: 'success',
    },
    {
      icon: Clock,
      action: 'Case Claimed',
      detail: 'Case #1042',
      when: 'Today, 10:00 AM',
      price: 'In Review',
      status: 'pending',
    },
    {
      icon: ShieldCheck,
      action: 'Doc Reviewed',
      detail: 'Matric Certificate',
      when: 'Yesterday, 5:00 PM',
      price: 'Valid',
      status: 'success',
    },
    {
      icon: Zap,
      action: 'SLA Reminder',
      detail: 'Case #1038',
      when: 'Yesterday, 3:45 PM',
      price: 'Due 2h',
      status: 'warning',
    },
    {
      icon: CheckCircle2,
      action: 'Batch Completed',
      detail: '6 identities done',
      when: '2 days ago',
      price: '6 cases',
      status: 'success',
    },
  ],
  STAFF: [
    {
      icon: Users,
      action: 'Applicant Profiled',
      detail: 'Rashid Mehmood',
      when: 'Today, 10:20 AM',
      price: '5 skills',
      status: 'success',
    },
    {
      icon: Target,
      action: 'Match Suggested',
      detail: 'Zara Bibi → Cook',
      when: 'Today, 9:30 AM',
      price: 'Pending',
      status: 'info',
    },
    {
      icon: Calendar,
      action: 'Interview Scheduled',
      detail: 'Ali Hassan',
      when: 'Yesterday',
      price: 'Tomorrow 2 PM',
      status: 'pending',
    },
    {
      icon: Activity,
      action: 'Placement Recorded',
      detail: 'Mariam Naz',
      when: 'Yesterday',
      price: 'Office Cleaner',
      status: 'success',
    },
    {
      icon: Briefcase,
      action: 'New Job Received',
      detail: 'Driver — Islamabad',
      when: '2 days ago',
      price: 'Open',
      status: 'info',
    },
  ],
  EMPLOYER: [
    {
      icon: Users,
      action: 'Candidate Referred',
      detail: 'Imran Malik — Cook',
      when: 'Today, 10:00 AM',
      price: 'Pending',
      status: 'pending',
    },
    {
      icon: Calendar,
      action: 'Interview Scheduled',
      detail: 'Saima Bibi',
      when: 'Yesterday',
      price: 'Thu 11 AM',
      status: 'success',
    },
    {
      icon: Briefcase,
      action: 'Job Posted',
      detail: 'Guard — DHA Karachi',
      when: '2 days ago',
      price: 'Open',
      status: 'success',
    },
    {
      icon: CheckCircle2,
      action: 'Hire Confirmed',
      detail: 'Nadeem Khan',
      when: '3 days ago',
      price: 'Placed',
      status: 'success',
    },
    {
      icon: Building2,
      action: 'Profile Updated',
      detail: 'License renewed',
      when: '4 days ago',
      price: 'Done',
      status: 'info',
    },
  ],
  APPLICANT: [
    {
      icon: UserRound,
      action: 'Profile Updated',
      detail: 'Skills section done',
      when: 'Today',
      price: '+5 skills',
      status: 'success',
    },
    {
      icon: FileText,
      action: 'Document Uploaded',
      detail: 'CNIC front & back',
      when: 'Yesterday',
      price: '2 files',
      status: 'success',
    },
    {
      icon: MapPin,
      action: 'Location Added',
      detail: 'Gulshan-e-Iqbal',
      when: '2 days ago',
      price: 'Karachi',
      status: 'info',
    },
    {
      icon: ShieldCheck,
      action: 'Identity Check',
      detail: 'Verification sent',
      when: '3 days ago',
      price: 'In Review',
      status: 'pending',
    },
    {
      icon: Activity,
      action: 'Profile Activated',
      detail: 'Now visible to staff',
      when: '4 days ago',
      price: 'Live',
      status: 'success',
    },
  ],
};

const STATUS_PILL: Record<
  'success' | 'pending' | 'info' | 'warning',
  { bg: string; color: string; dot: string; label: string }
> = {
  success: { bg: '#f0fdf4', color: '#15803d', dot: '#22c55e', label: 'Success' },
  pending: { bg: '#fffbeb', color: '#b45309', dot: '#f59e0b', label: 'Pending' },
  info: { bg: '#eff6ff', color: '#1d4ed8', dot: '#3b82f6', label: 'Info' },
  warning: { bg: '#fff1f2', color: '#be123c', dot: '#f43f5e', label: 'Warning' },
};

/* ─── Dashboard view types ──────────────────────────────────────── */
interface DashMain {
  icon: LucideIcon;
  label: string;
  value: string;
  trend: { dir: 'up' | 'down'; text: string };
  subTitle: string;
  subItems: { icon: LucideIcon; label: string; value: string; status: 'active' | 'inactive' }[];
}
interface DashSmallStat {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  color: string;
  trend?: { dir: 'up' | 'down'; pct: string };
}
interface DashPipeline {
  title: string;
  items: { icon: LucideIcon; label: string; current: number; total: number; color: string }[];
}

/* ─── Helpers ───────────────────────────────────────────────────── */
function minQ<S extends string>(field: S, filters: Record<string, unknown> = {}) {
  return {
    page: 1,
    pageSize: 1,
    limit: 1,
    offset: 0,
    sort: { field, direction: 'desc' as const },
    q: undefined,
    filters,
  };
}
function fmt(n: number) {
  return n.toLocaleString('en-PK');
}

/* ─── Component ─────────────────────────────────────────────────── */
export async function WelcomePanel({ role }: { role: Role }) {
  const { user, actor } = await requireRole(role);
  const me = await describeMe(user, actor);
  const visible = await listBranches(actor);

  /* ── Real data per role ────────────────────────────────────────── */
  let main: DashMain;
  let smallStats: DashSmallStat[];
  let pipeline: DashPipeline;

  if (role === 'SUPER_ADMIN') {
    const [r_all, r_active, r_co_all, r_co_ver, r_staff] = await Promise.all([
      listApplicants(actor, minQ('createdAt')),
      listApplicants(actor, minQ('createdAt', { status: 'ACTIVE' })),
      listCompanies(actor, minQ('createdAt')),
      listCompanies(actor, minQ('createdAt', { status: 'VERIFIED' })),
      listStaff(actor, minQ('createdAt')),
    ]);
    const totalUsers = r_all.meta.total + r_staff.meta.total;
    main = {
      icon: Users,
      label: 'Total Platform Users',
      value: fmt(totalUsers),
      trend: {
        dir: 'up',
        text: `${fmt(r_all.meta.total)} applicants · ${fmt(r_staff.meta.total)} staff`,
      },
      subTitle: 'By Role',
      subItems: [
        { icon: Users, label: 'Applicants', value: fmt(r_all.meta.total), status: 'active' },
        {
          icon: Building2,
          label: 'Employers',
          value: fmt(r_co_ver.pagination.total),
          status: 'active',
        },
        { icon: ShieldCheck, label: 'Staff', value: fmt(r_staff.meta.total), status: 'active' },
        { icon: GitBranch, label: 'Branches', value: String(visible.length), status: 'inactive' },
      ],
    };
    smallStats = [
      {
        icon: Building2,
        label: 'Verified Companies',
        value: fmt(r_co_ver.pagination.total),
        sub: `of ${fmt(r_co_all.pagination.total)} total`,
        color: '#1a5fac',
      },
      {
        icon: Activity,
        label: 'Active Applicants',
        value: fmt(r_active.meta.total),
        sub: `of ${fmt(r_all.meta.total)} total`,
        color: '#0f766e',
      },
    ];
    pipeline = {
      title: 'Platform Overview',
      items: [
        {
          icon: Users,
          label: 'Applicants Active',
          current: r_active.meta.total,
          total: Math.max(r_all.meta.total, 1),
          color: '#0d7a3e',
        },
        {
          icon: Building2,
          label: 'Companies Verified',
          current: r_co_ver.pagination.total,
          total: Math.max(r_co_all.pagination.total, 1),
          color: '#1a5fac',
        },
        {
          icon: GitBranch,
          label: 'Branches Active',
          current: visible.length,
          total: Math.max(visible.length, 1),
          color: '#b45309',
        },
      ],
    };
  } else if (role === 'BRANCH_ADMIN') {
    const [r_all, r_active, r_draft, r_id_ver] = await Promise.all([
      listApplicants(actor, minQ('createdAt')),
      listApplicants(actor, minQ('createdAt', { status: 'ACTIVE' })),
      listApplicants(actor, minQ('createdAt', { status: 'DRAFT' })),
      listApplicants(actor, minQ('createdAt', { identityStatus: 'VERIFIED' })),
    ]);
    main = {
      icon: Users,
      label: 'Total Applicants',
      value: fmt(r_all.meta.total),
      trend: { dir: 'up', text: `${fmt(r_active.meta.total)} currently active` },
      subTitle: 'By Status',
      subItems: [
        { icon: CheckCircle2, label: 'Active', value: fmt(r_active.meta.total), status: 'active' },
        { icon: Clock, label: 'Draft', value: fmt(r_draft.meta.total), status: 'active' },
        {
          icon: ShieldCheck,
          label: 'ID Verified',
          value: fmt(r_id_ver.meta.total),
          status: 'active',
        },
        { icon: Activity, label: 'Total', value: fmt(r_all.meta.total), status: 'inactive' },
      ],
    };
    const [r_co_all, r_co_ver] = await Promise.all([
      listCompanies(actor, minQ('createdAt')),
      listCompanies(actor, minQ('createdAt', { status: 'VERIFIED' })),
    ]);
    smallStats = [
      {
        icon: Building2,
        label: 'Verified Companies',
        value: fmt(r_co_ver.pagination.total),
        sub: `of ${fmt(r_co_all.pagination.total)} total`,
        color: '#1a5fac',
      },
      {
        icon: Activity,
        label: 'Active Applicants',
        value: fmt(r_active.meta.total),
        sub: `of ${fmt(r_all.meta.total)} registered`,
        color: '#0f766e',
      },
    ];
    pipeline = {
      title: 'Branch Targets',
      items: [
        {
          icon: Activity,
          label: 'Active Applicants',
          current: r_active.meta.total,
          total: Math.max(r_all.meta.total, 1),
          color: '#0d7a3e',
        },
        {
          icon: ShieldCheck,
          label: 'IDs Verified',
          current: r_id_ver.meta.total,
          total: Math.max(r_all.meta.total, 1),
          color: '#1a5fac',
        },
        {
          icon: Building2,
          label: 'Companies Verified',
          current: r_co_ver.pagination.total,
          total: Math.max(r_co_all.pagination.total, 1),
          color: '#b45309',
        },
      ],
    };
  } else if (role === 'VERIFIER') {
    const { items: qItems } = await listQueue(actor, {
      page: 1,
      pageSize: 100,
      limit: 100,
      offset: 0,
      sort: { field: 'slaDueOn', direction: 'asc' },
      q: undefined,
      filters: {},
    });
    const unclaimed = qItems.filter((i) => !i.verifierId).length;
    const inReview = qItems.filter((i) => !!i.verifierId).length;
    const breached = qItems.filter((i) => i.sla === 'BREACHED').length;
    const dueToday = qItems.filter((i) => i.sla === 'DUE_TODAY').length;
    main = {
      icon: ShieldCheck,
      label: 'Queue Status',
      value: String(qItems.length),
      trend: {
        dir: breached > 0 ? 'down' : 'up',
        text: breached > 0 ? `${breached} SLA breached` : 'All SLAs healthy',
      },
      subTitle: 'Queue Breakdown',
      subItems: [
        { icon: Clock, label: 'Unclaimed', value: String(unclaimed), status: 'active' },
        { icon: Zap, label: 'In Review', value: String(inReview), status: 'active' },
        { icon: Calendar, label: 'Due Today', value: String(dueToday), status: 'active' },
        {
          icon: ShieldCheck,
          label: 'SLA Breached',
          value: String(breached),
          status: breached > 0 ? 'inactive' : 'active',
        },
      ],
    };
    smallStats = [
      {
        icon: CheckCircle2,
        label: 'Items in Queue',
        value: String(qItems.length),
        sub: 'awaiting review',
        color: '#0d7a3e',
      },
      {
        icon: Zap,
        label: 'SLA Status',
        value: breached > 0 ? 'At Risk' : 'Healthy',
        sub: `${breached} breached`,
        color: '#1a5fac',
      },
    ];
    pipeline = {
      title: 'Daily Progress',
      items: [
        {
          icon: Clock,
          label: 'Unclaimed Cases',
          current: unclaimed,
          total: Math.max(qItems.length, 1),
          color: '#0d7a3e',
        },
        {
          icon: Zap,
          label: 'Cases In Review',
          current: inReview,
          total: Math.max(qItems.length, 1),
          color: '#1a5fac',
        },
        {
          icon: ShieldCheck,
          label: 'SLA Breached',
          current: breached,
          total: Math.max(qItems.length, 1),
          color: '#b45309',
        },
      ],
    };
  } else if (role === 'STAFF') {
    const [r_all, r_active, r_draft, r_id_ver] = await Promise.all([
      listApplicants(actor, minQ('createdAt')),
      listApplicants(actor, minQ('createdAt', { status: 'ACTIVE' })),
      listApplicants(actor, minQ('createdAt', { status: 'DRAFT' })),
      listApplicants(actor, minQ('createdAt', { identityStatus: 'VERIFIED' })),
    ]);
    main = {
      icon: Users,
      label: 'Branch Applicants',
      value: fmt(r_all.meta.total),
      trend: { dir: 'up', text: `${fmt(r_active.meta.total)} active in pipeline` },
      subTitle: 'Pipeline Stage',
      subItems: [
        { icon: Users, label: 'Total', value: fmt(r_all.meta.total), status: 'active' },
        { icon: CheckCircle2, label: 'Active', value: fmt(r_active.meta.total), status: 'active' },
        { icon: Clock, label: 'Draft', value: fmt(r_draft.meta.total), status: 'active' },
        {
          icon: ShieldCheck,
          label: 'ID Verified',
          value: fmt(r_id_ver.meta.total),
          status: 'inactive',
        },
      ],
    };
    smallStats = [
      {
        icon: Briefcase,
        label: 'Active Applicants',
        value: fmt(r_active.meta.total),
        sub: 'in branch pipeline',
        color: '#1a5fac',
      },
      {
        icon: Activity,
        label: 'Total Registered',
        value: fmt(r_all.meta.total),
        sub: 'all statuses',
        color: '#0f766e',
      },
    ];
    pipeline = {
      title: 'Caseload Overview',
      items: [
        {
          icon: Users,
          label: 'Active Applicants',
          current: r_active.meta.total,
          total: Math.max(r_all.meta.total, 1),
          color: '#0d7a3e',
        },
        {
          icon: ShieldCheck,
          label: 'IDs Verified',
          current: r_id_ver.meta.total,
          total: Math.max(r_all.meta.total, 1),
          color: '#1a5fac',
        },
        {
          icon: Clock,
          label: 'Draft Profiles',
          current: r_draft.meta.total,
          total: Math.max(r_all.meta.total, 1),
          color: '#b45309',
        },
      ],
    };
  } else if (role === 'EMPLOYER') {
    let jobs: { title: string; status: string; vacancies: number | null }[] = [];
    try {
      jobs = await listMyJobs(actor);
    } catch {
      /* no company yet */
    }
    const activeJobs = jobs.filter((j) => j.status === 'OPEN');
    const filled = jobs.map((j) => j.vacancies ?? 1);
    const jobItems: DashMain['subItems'] = activeJobs.slice(0, 4).map((j) => ({
      icon: Briefcase as LucideIcon,
      label: j.title,
      value: j.vacancies != null ? `${j.vacancies} slots` : 'Open',
      status: 'active' as const,
    }));
    while (jobItems.length < 4)
      jobItems.push({ icon: Briefcase, label: '—', value: '—', status: 'inactive' as const });
    main = {
      icon: Building2,
      label: 'Active Job Postings',
      value: String(activeJobs.length),
      trend: { dir: 'up', text: `${jobs.length} total jobs posted` },
      subTitle: 'By Position',
      subItems: jobItems,
    };
    smallStats = [
      {
        icon: Users,
        label: 'Total Jobs Posted',
        value: String(jobs.length),
        sub: 'all time',
        color: '#1a5fac',
      },
      {
        icon: Briefcase,
        label: 'Open Positions',
        value: String(activeJobs.length),
        sub: 'accepting referrals',
        color: '#0f766e',
      },
    ];
    pipeline = {
      title: 'Hiring Pipeline',
      items: [
        {
          icon: Briefcase,
          label: 'Active Postings',
          current: activeJobs.length,
          total: Math.max(jobs.length, 1),
          color: '#0d7a3e',
        },
        {
          icon: Users,
          label: 'Candidates Referred',
          current: 0,
          total: Math.max(activeJobs.length, 1),
          color: '#1a5fac',
        },
        {
          icon: CheckCircle2,
          label: 'Positions Filled',
          current: 0,
          total: Math.max(activeJobs.length, 1),
          color: '#b45309',
        },
      ],
    };
  } else {
    /* APPLICANT */
    let profile: Awaited<ReturnType<typeof getMyProfile>> = null;
    try {
      profile = await getMyProfile(actor);
    } catch {
      /* not registered yet */
    }
    const pct = profile?.completeness.percent ?? 0;
    const sections = profile?.completeness.sections ?? [];
    const SECTION_ICONS: Record<string, LucideIcon> = {
      personal: UserRound,
      location: MapPin,
      skills: FileText,
      languages: FileText,
      education: FileText,
      experience: Briefcase,
      preferences: Settings,
      documents: ShieldCheck,
    };
    const secItems: DashMain['subItems'] = sections.slice(0, 4).map((s) => ({
      icon: SECTION_ICONS[s.id] ?? FileText,
      label: s.label,
      value: s.done ? '✓' : '—',
      status: s.done ? 'active' : 'inactive',
    }));
    while (secItems.length < 4)
      secItems.push({ icon: FileText, label: '—', value: '—', status: 'inactive' });
    main = {
      icon: Star,
      label: 'Profile Strength',
      value: `${pct}%`,
      trend: {
        dir: 'up',
        text: `${sections.filter((s) => s.done).length} of ${sections.length} sections complete`,
      },
      subTitle: 'Profile Sections',
      subItems: secItems,
    };
    smallStats = [
      {
        icon: Briefcase,
        label: 'Active Applications',
        value: '—',
        sub: 'coming in M10',
        color: '#1a5fac',
      },
      {
        icon: Activity,
        label: 'Upcoming Interviews',
        value: '—',
        sub: 'coming in M11',
        color: '#0f766e',
      },
    ];
    pipeline = {
      title: 'Your Progress',
      items: [
        { icon: Star, label: 'Profile Completeness', current: pct, total: 100, color: '#0d7a3e' },
        {
          icon: FileText,
          label: 'Sections Done',
          current: sections.filter((s) => s.done).length,
          total: Math.max(sections.length, 1),
          color: '#1a5fac',
        },
        {
          icon: ShieldCheck,
          label: 'Profile Activated',
          current: profile?.status === 'ACTIVE' ? 1 : 0,
          total: 1,
          color: '#b45309',
        },
      ],
    };
  }

  const actions = ROLE_ACTIONS[role];
  const chart = ROLE_CHART[role];
  const activity = ROLE_ACTIVITY[role];
  const MainIcon = main.icon;

  const firstName = user.name.split(' ')[0];
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-PK', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const scopeLabel =
    role === 'SUPER_ADMIN'
      ? actor.activeBranchId
        ? (visible[0]?.name ?? 'One Branch')
        : `All ${visible.length} branches`
      : me.branches.map((b) => b.name).join(', ') || 'Platform-wide';

  const CARD = 'rounded-2xl border bg-white p-6';
  const BORDER = '1px solid #e8eeed';

  return (
    <div className="grid w-full gap-6">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-fg text-2xl font-bold sm:text-3xl">Welcome back {firstName}</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
            {scopeLabel} · {ROLE_LABELS[role]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm"
            style={{ borderColor: '#e8eeed', color: 'var(--fg-muted)', background: '#fff' }}
          >
            <Calendar className="size-4" aria-hidden="true" />
            {dateStr}
          </span>
          <NextLink
            href="#"
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{ background: '#0d7a3e' }}
          >
            <Download className="size-4" aria-hidden="true" />
            Export
          </NextLink>
        </div>
      </div>

      {/* ── Main 2-column grid ──────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[5fr_7fr]">
        {/* ── LEFT COLUMN ─────────────────────────────────────── */}
        <div className="grid gap-5">
          {/* Featured stat card */}
          <div className={CARD} style={{ border: BORDER }}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="grid size-8 place-items-center rounded-lg"
                  style={{ background: '#dff2e8' }}
                  aria-hidden="true"
                >
                  <MainIcon className="size-4" style={{ color: '#0d7a3e' }} />
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--fg-muted)' }}>
                  {main.label}
                </span>
              </div>
              <CardActionMenu
                items={[
                  { label: 'View detailed report' },
                  { label: 'Export as CSV' },
                  { label: 'Refresh data' },
                ]}
              />
            </div>

            <p className="numeric text-fg mb-1 text-4xl font-extrabold tracking-tight">
              {main.value}
            </p>
            <div className="mb-5 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-0.5 text-xs font-semibold"
                style={{ color: main.trend.dir === 'up' ? '#15803d' : '#c0262d' }}
              >
                {main.trend.dir === 'up' ? (
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                ) : (
                  <ArrowDownRight className="size-3.5" aria-hidden="true" />
                )}
                {main.trend.text}
              </span>
            </div>

            <div className="mb-6 flex gap-2">
              <NextLink
                href={actions.action1.href}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white"
                style={{ background: '#0d7a3e' }}
              >
                {actions.action1.label}
              </NextLink>
              <NextLink
                href={actions.action2.href}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold"
                style={{ borderColor: '#e8eeed', color: 'var(--fg)' }}
              >
                {actions.action2.label}
              </NextLink>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>
                {main.subTitle}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {main.subItems.map((sub, si) => {
                const SubIcon = sub.icon;
                return (
                  <div
                    key={si}
                    className="flex items-center justify-between rounded-xl p-3"
                    style={{ background: '#f8faf9', border: '1px solid #e8eeed' }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="grid size-7 shrink-0 place-items-center rounded-lg"
                        style={{ background: sub.status === 'active' ? '#dff2e8' : '#f4f7f5' }}
                        aria-hidden="true"
                      >
                        <SubIcon
                          className="size-3.5"
                          style={{ color: sub.status === 'active' ? '#0d7a3e' : '#6b7d74' }}
                        />
                      </span>
                      <div className="min-w-0">
                        <p
                          className="truncate text-xs font-semibold"
                          style={{ color: 'var(--fg)' }}
                        >
                          {sub.label}
                        </p>
                        <p
                          className="text-xs font-bold"
                          style={{ color: sub.status === 'active' ? '#0d7a3e' : '#6b7d74' }}
                        >
                          {sub.status === 'active' ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                    </div>
                    <span className="numeric ml-2 text-sm font-bold" style={{ color: 'var(--fg)' }}>
                      {sub.value}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pipeline card */}
          <div className={CARD} style={{ border: BORDER }}>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-base font-bold" style={{ color: 'var(--fg)' }}>
                {pipeline.title}
              </p>
              <CardActionMenu
                items={[{ label: 'View full breakdown' }, { label: 'Export report' }]}
              />
            </div>
            <div className="grid gap-5">
              {pipeline.items.map((item, pi) => {
                const PIcon = item.icon;
                const pct = item.total > 0 ? Math.round((item.current / item.total) * 100) : 0;
                return (
                  <div key={pi}>
                    <div className="mb-2 flex items-center gap-3">
                      <span
                        className="grid size-8 shrink-0 place-items-center rounded-xl"
                        style={{ background: item.color + '18' }}
                        aria-hidden="true"
                      >
                        <PIcon className="size-4" style={{ color: item.color }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-baseline justify-between">
                          <span
                            className="truncate text-sm font-semibold"
                            style={{ color: 'var(--fg)' }}
                          >
                            {item.label}
                          </span>
                          <span
                            className="numeric ml-2 shrink-0 text-sm font-bold"
                            style={{ color: 'var(--fg)' }}
                          >
                            {pct}%
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-label={item.label}
                          aria-valuemin={0}
                          aria-valuemax={item.total}
                          aria-valuenow={item.current}
                          className="h-2 w-full overflow-hidden rounded-full"
                          style={{ background: '#f4f7f5' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: item.color }}
                          />
                        </div>
                      </div>
                    </div>
                    <p className="ml-11 text-xs" style={{ color: 'var(--fg-muted)' }}>
                      {item.current}/{item.total} complete
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────── */}
        <div className="grid content-start gap-5">
          {/* Two small stat cards */}
          <div className="grid grid-cols-2 gap-5">
            {smallStats.map((s, si) => {
              const SIcon = s.icon;
              const isUp = s.trend?.dir === 'up';
              return (
                <div key={si} className={CARD} style={{ border: BORDER }}>
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="grid size-8 place-items-center rounded-lg"
                        style={{ background: s.color + '15' }}
                        aria-hidden="true"
                      >
                        <SIcon className="size-4" style={{ color: s.color }} />
                      </span>
                      <span className="text-xs font-semibold" style={{ color: 'var(--fg-muted)' }}>
                        {s.label}
                      </span>
                    </div>
                    <CardActionMenu items={[{ label: 'View details' }, { label: 'Export' }]} />
                  </div>
                  <p className="numeric text-fg mb-1 text-3xl font-extrabold tracking-tight">
                    {s.value}
                  </p>
                  {s.trend && (
                    <span
                      className="inline-flex items-center gap-0.5 text-xs font-semibold"
                      style={{ color: isUp ? '#15803d' : '#c0262d' }}
                    >
                      {isUp ? (
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDownRight className="size-3.5" aria-hidden="true" />
                      )}
                      {s.trend.pct}
                    </span>
                  )}
                  <span
                    className={`${s.trend ? 'ml-1' : ''}text-xs`}
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    {s.sub}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Bar chart — interactive client component */}
          <InteractiveBarChart
            values={chart.values}
            peak={chart.peak}
            color="#0d7a3e"
            label={chart.label}
          />

          {/* Recent Activity */}
          <div className="rounded-2xl border bg-white" style={{ border: BORDER }}>
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: BORDER }}
            >
              <p className="text-base font-bold" style={{ color: 'var(--fg)' }}>
                Recent Activity
              </p>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: '#e8eeed', color: 'var(--fg-muted)' }}
              >
                Filter <ChevronRight className="size-3" aria-hidden="true" />
              </button>
            </div>
            <div
              className="grid gap-4 px-6 py-3 text-[11px] font-bold tracking-wider uppercase"
              style={{
                gridTemplateColumns: '1fr auto auto auto',
                color: 'var(--fg-muted)',
                background: '#f8faf9',
                borderBottom: BORDER,
              }}
            >
              <span>Activity</span>
              <span>Date</span>
              <span>Detail</span>
              <span>Status</span>
            </div>
            <ul>
              {activity.map((item, idx) => {
                const AIcon = item.icon;
                const pill = STATUS_PILL[item.status];
                return (
                  <li
                    key={idx}
                    className="grid items-center gap-4 px-6 py-3.5 transition-colors hover:bg-[#f8faf9]"
                    style={{
                      gridTemplateColumns: '1fr auto auto auto',
                      borderBottom: idx < activity.length - 1 ? BORDER : 'none',
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="grid size-8 shrink-0 place-items-center rounded-lg"
                        style={{ background: pill.bg }}
                        aria-hidden="true"
                      >
                        <AIcon className="size-4" style={{ color: pill.color }} />
                      </span>
                      <div className="min-w-0">
                        <p
                          className="truncate text-sm font-semibold"
                          style={{ color: 'var(--fg)' }}
                        >
                          {item.action}
                        </p>
                        <p className="truncate text-xs" style={{ color: 'var(--fg-muted)' }}>
                          {item.detail}
                        </p>
                      </div>
                    </div>
                    <span
                      className="text-xs whitespace-nowrap"
                      style={{ color: 'var(--fg-muted)' }}
                    >
                      {item.when}
                    </span>
                    <span className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>
                      {item.price}
                    </span>
                    <span
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{ background: pill.bg, color: pill.color }}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: pill.dot }}
                        aria-hidden="true"
                      />
                      {pill.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
