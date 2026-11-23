import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  MapPin,
  Settings,
  ShieldCheck,
  Star,
  UserRound,
  Users,
} from 'lucide-react';
import { InteractiveBarChart, CardActionMenu } from './InteractiveBarChart';
import { DashboardAutoRefresh } from './DashboardAutoRefresh';
import type { LucideIcon } from 'lucide-react';
import NextLink from 'next/link';
import { ROLE_LABELS, type Role } from '@jobbank/shared';
import { describeMe, requireRole } from '@/domains/auth';
import { listBranches } from '@/domains/branch';
import { listApplicants, getMyProfile, monthlyApplicantCounts } from '@/domains/applicant';
import { countCompaniesOnboardedByMonth, listCompanies } from '@/domains/company';
import { countEmployerCandidates, countHiresByMonth, listJobsForEmployer } from '@/domains/job';
import { listMyNotifications } from '@/domains/notifications';
import {
  countInterviewerReferrals,
  interviewPipelineCounts,
  listInterviews,
  listMyApplications,
  monthlyInterviewCounts,
} from '@/domains/placement';
import { listStaff } from '@/domains/user';
import { bucketByMonth, pktYearMonth } from './monthlySeries';
import { formatDate } from '@/lib/format/date';

/* ─── Monthly chart values are computed per role below, from live DB ────
   counts (monthlyApplicantCounts, countCompaniesOnboardedByMonth,
   countHiresByMonth, or the applicant's own applications). No hardcoded
   series lives here any more. ─────────────────────────────────────────── */

/* ─── Action buttons per role (static) ─────────────────────────── */
const ROLE_ACTIONS: Record<
  Role,
  {
    action1: { label: string; href: string };
    action2: { label: string; href: string };
    /** Optional third shortcut — only roles that need one define it. */
    action3?: { label: string; href: string };
  }
> = {
  SUPER_ADMIN: {
    action1: { label: 'Browse Applicants', href: '/super-admin/applicants' },
    action2: { label: 'Manage Staff', href: '/super-admin/staff' },
    // The dashboard had no way to reach the add-branch page: the only
    // entry point was sidebar Branches → list → New branch.
    action3: { label: 'Add Branch', href: '/super-admin/branches/new' },
  },
  BRANCH_ADMIN: {
    action1: { label: 'View Applicants', href: '/branch-admin/applicants' },
    action2: { label: 'Add Staff', href: '/branch-admin/staff' },
  },
  VERIFIER: {
    action1: { label: 'View Companies', href: '/verifier/companies' },
    action2: { label: 'View Jobs', href: '/verifier/jobs' },
  },
  STAFF: {
    action1: { label: 'View Applicants', href: '/staff/applicants' },
    action2: { label: 'Open Jobs', href: '/staff/jobs' },
  },
  INTERVIEWER_SCHEDULER: {
    action1: { label: 'View Interviews', href: '/interviewer-scheduler/interviews' },
    action2: { label: 'View Applicants', href: '/interviewer-scheduler/applicants' },
  },
  EMPLOYER: {
    action1: { label: 'Post a Job', href: '/employer/jobs/new' },
    action2: { label: 'View My Jobs', href: '/employer/jobs' },
  },
  APPLICANT: {
    action1: { label: 'Edit Profile', href: '/applicant/profile' },
    action2: { label: 'My Documents', href: '/applicant/documents' },
  },
};

/* ─── Relative date helper ──────────────────────────────────────── */
function relativeDate(iso: string | Date): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7) return `${diffD} days ago`;
  return formatDate(iso);
}

/* ─── Activity item type ────────────────────────────────────────── */
type ActivityItem = {
  icon: LucideIcon;
  action: string;
  detail: string;
  when: string;
  price: string;
  status: 'success' | 'pending' | 'info' | 'warning';
};

/* ─── Recent activity: built from real rows, never invented ──────────── */
const APPLICANT_ACTIVITY_STATUS: Record<string, ActivityItem['status']> = {
  ACTIVE: 'success',
  INACTIVE: 'info',
};

function toApplicantActivity(a: {
  fullName: string;
  status: string;
  cityLabel: string | null;
  branchName: string | null;
  createdAt: string;
}): ActivityItem {
  return {
    icon: Users,
    action: 'Applicant Registered',
    detail: a.fullName,
    when: relativeDate(a.createdAt),
    price: a.cityLabel ?? a.branchName ?? '—',
    status: APPLICANT_ACTIVITY_STATUS[a.status] ?? 'info',
  };
}

function toCompanyActivity(c: {
  legalName: string;
  branchName: string | null;
  createdAt: string;
  verifiedAt: string | null;
}): ActivityItem {
  return {
    icon: Building2,
    action: 'Company Verified',
    detail: c.legalName,
    when: relativeDate(c.verifiedAt ?? c.createdAt),
    price: c.branchName ?? 'Verified',
    status: 'success',
  };
}

/** Newest-first merge of timestamped activity items, capped at 5. */
function latestActivity(entries: { at: string; item: ActivityItem }[]): ActivityItem[] {
  return entries
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, 5)
    .map((e) => e.item);
}

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

/**
 * Application statuses with no further action possible. "Active
 * Applications" counts everything except these — rejected, refused, hired
 * and staff-rejected applications are outcomes, not live applications.
 */
const TERMINAL_APPLICATION_STATUSES: readonly string[] = [
  'EMPLOYER_REJECTED',
  'APPLICANT_REFUSED',
  'HIRED',
  'REJECTED',
  // 0052 — a failed interview is an outcome, not a live application.
  'INTERVIEW_FAILED',
];

/* ─── Component ─────────────────────────────────────────────────── */
export async function WelcomePanel({ role }: { role: Role }) {
  const { user, actor } = await requireRole(role);
  const me = await describeMe(user, actor);
  const visible = await listBranches(actor);

  /* ── Real data per role ────────────────────────────────────────── */
  let main: DashMain;
  let smallStats: DashSmallStat[];
  let pipeline: DashPipeline;
  /* Chart + activity are real per-role data too (see each branch below);
     they start empty and every branch fills them in. */
  /* Year and "current month" are derived once, here, in PKT — the chart
     and the month counts all use this one clock (L1). */
  const { year, monthIndex: currentMonth } = pktYearMonth();
  let chartValues: number[] = Array.from({ length: 12 }, () => 0);
  let chartLabel = '';
  let activity: ActivityItem[] = [];
  let jobs: {
    title: string;
    status: string;
    vacancies: number | null;
    createdAt: string;
  }[] = [];

  if (role === 'SUPER_ADMIN') {
    const [r_all, r_active, r_co_all, r_co_ver, r_staff] = await Promise.all([
      listApplicants(actor, minQ('createdAt')),
      listApplicants(actor, minQ('createdAt', { status: ['ACTIVE'] })),
      listCompanies(actor, minQ('createdAt')),
      listCompanies(actor, minQ('createdAt', { status: 'VERIFIED' })),
      listStaff(actor, minQ('createdAt')),
    ]);
    const totalUsers = r_all.meta.total + r_staff.meta.total;
    main = {
      icon: Users,
      // Was "Total Platform Users": the total only ever counted applicants
      // + staff (employer/verifier/BA accounts excluded), so label it so.
      label: 'Applicants + Staff',
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
          // Was "Employers": this is the verified-company count, not a
          // count of employer user accounts.
          label: 'Verified Companies',
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
          // Was current == total (always 100%): active branches over ALL
          // visible branches, including inactive ones.
          current: visible.filter((b) => b.isActive).length,
          total: Math.max(visible.length, 1),
          color: '#b45309',
        },
      ],
    };
    const [recentApplicants, recentCompanies] = await Promise.all([
      listApplicants(actor, { ...minQ('createdAt'), pageSize: 5, limit: 5 }),
      // M3: the 5 most recently VERIFIED companies — ordered by verifiedAt,
      // not by creation date (a company verified today must show up).
      listCompanies(actor, {
        ...minQ('verifiedAt'),
        pageSize: 5,
        limit: 5,
        filters: { status: 'VERIFIED' },
      }),
    ]);
    activity = latestActivity([
      ...recentApplicants.data.map((a) => ({ at: a.createdAt, item: toApplicantActivity(a) })),
      ...recentCompanies.items.map((c) => ({
        at: c.verifiedAt ?? c.createdAt,
        item: toCompanyActivity(c),
      })),
    ]);
    chartValues = await monthlyApplicantCounts(actor, year);
    chartLabel = 'Monthly Registrations';
  } else if (role === 'BRANCH_ADMIN') {
    const [r_all, r_active, r_id_ver] = await Promise.all([
      listApplicants(actor, minQ('createdAt')),
      listApplicants(actor, minQ('createdAt', { status: ['ACTIVE'] })),
      listApplicants(actor, minQ('createdAt', { identityStatus: ['VERIFIED'] })),
    ]);
    main = {
      icon: Users,
      label: 'Total Applicants',
      value: fmt(r_all.meta.total),
      trend: { dir: 'up', text: `${fmt(r_active.meta.total)} currently active` },
      subTitle: 'By Status',
      subItems: [
        { icon: CheckCircle2, label: 'Active', value: fmt(r_active.meta.total), status: 'active' },
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
    const [recentApplicants, recentCompanies] = await Promise.all([
      listApplicants(actor, { ...minQ('createdAt'), pageSize: 5, limit: 5 }),
      // M3: the 5 most recently VERIFIED companies — ordered by verifiedAt,
      // not by creation date (a company verified today must show up).
      listCompanies(actor, {
        ...minQ('verifiedAt'),
        pageSize: 5,
        limit: 5,
        filters: { status: 'VERIFIED' },
      }),
    ]);
    activity = latestActivity([
      ...recentApplicants.data.map((a) => ({ at: a.createdAt, item: toApplicantActivity(a) })),
      ...recentCompanies.items.map((c) => ({
        at: c.verifiedAt ?? c.createdAt,
        item: toCompanyActivity(c),
      })),
    ]);
    chartValues = await monthlyApplicantCounts(actor, year);
    chartLabel = 'Branch Registrations';
  } else if (role === 'VERIFIER') {
    // 2026-11-14: verification moved to the Branch Admin, so the verifier
    // dashboard no longer shows the queue (listQueue needs company:verify).
    // It shows registration work instead: companies in their branch by
    // status, and their own monthly field-visit registrations.
    const [r_all, r_draft, r_verified, recentCompanies] = await Promise.all([
      listCompanies(actor, minQ('createdAt')),
      listCompanies(actor, minQ('createdAt', { status: 'DRAFT' })),
      listCompanies(actor, minQ('createdAt', { status: 'VERIFIED' })),
      listCompanies(actor, { ...minQ('createdAt'), pageSize: 5, limit: 5 }),
    ]);
    const total = r_all.pagination.total;
    const draft = r_draft.pagination.total;
    const verified = r_verified.pagination.total;
    main = {
      icon: Building2,
      label: 'Companies Registered',
      value: fmt(total),
      trend: {
        dir: draft > 0 ? 'down' : 'up',
        text: draft > 0 ? `${draft} awaiting Branch Admin review` : 'All reviewed',
      },
      subTitle: 'Registration Breakdown',
      subItems: [
        { icon: Clock, label: 'Draft — awaiting review', value: fmt(draft), status: 'active' },
        { icon: CheckCircle2, label: 'Verified', value: fmt(verified), status: 'active' },
        { icon: Building2, label: 'Total', value: fmt(total), status: 'inactive' },
      ],
    };
    smallStats = [
      {
        icon: Clock,
        label: 'Awaiting Review',
        value: fmt(draft),
        sub: 'with the Branch Admin',
        color: '#b45309',
      },
      {
        icon: CheckCircle2,
        label: 'Verified Companies',
        value: fmt(verified),
        sub: `of ${fmt(total)} total`,
        color: '#0d7a3e',
      },
    ];
    pipeline = {
      title: 'Registration Progress',
      items: [
        {
          icon: Clock,
          label: 'Awaiting Review',
          current: draft,
          total: Math.max(total, 1),
          color: '#b45309',
        },
        {
          icon: ShieldCheck,
          label: 'Verified',
          current: verified,
          total: Math.max(total, 1),
          color: '#0d7a3e',
        },
      ],
    };
    activity = recentCompanies.items.map((c): ActivityItem => ({
      icon: Building2,
      action: 'Company Registered',
      detail: c.legalName,
      when: relativeDate(c.createdAt),
      price: c.branchName ?? '',
      status: c.status === 'VERIFIED' ? 'success' : c.status === 'DRAFT' ? 'pending' : 'info',
    }));
    chartValues = await countCompaniesOnboardedByMonth(actor, year);
    chartLabel = 'Companies Registered';
  } else if (role === 'STAFF') {
    const [r_all, r_active, r_id_ver] = await Promise.all([
      listApplicants(actor, minQ('createdAt')),
      listApplicants(actor, minQ('createdAt', { status: ['ACTIVE'] })),
      listApplicants(actor, minQ('createdAt', { identityStatus: ['VERIFIED'] })),
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
      ],
    };
    const recentApplicants = await listApplicants(actor, {
      ...minQ('createdAt'),
      pageSize: 5,
      limit: 5,
    });
    activity = recentApplicants.data.map((a) => toApplicantActivity(a));
    chartValues = await monthlyApplicantCounts(actor, year);
    chartLabel = 'Applicants Registered';
  } else if (role === 'INTERVIEWER_SCHEDULER') {
    // Interviewer dashboard: real counts from listInterviews, the same
    // branch-scoped list the Interviews page renders, plus the referrals
    // that already left that list (FORWARDED + PASSED). Nothing here is
    // invented: an empty pipeline renders zeros, not sample data.
    const [interviews, referred, interviewMonths, pipelineCounts] = await Promise.all([
      // Activity needs only the 5 most recent rows. The pipeline numbers
      // come from the grouped count query (MEDIUM-2): deriving them from
      // listInterviews rows meant every refresh loaded the whole
      // unbounded pipeline. Every scheduled/postponed interview counts,
      // not just future ones: a row whose time has passed but whose
      // outcome is not recorded yet is still work.
      listInterviews(actor, 5),
      countInterviewerReferrals(actor),
      monthlyInterviewCounts(actor, year),
      interviewPipelineCounts(actor),
    ]);
    const toSchedule = pipelineCounts.toSchedule;
    const scheduled = pipelineCounts.scheduled;
    const upcomingToday = pipelineCounts.upcomingToday;
    const passed = pipelineCounts.passed;
    const failed = pipelineCounts.failed;
    const total = pipelineCounts.total;
    // Funnel denominator: pipeline rows in hand + referrals already made.
    // Referred candidates are not in listInterviews, so without this the
    // pipeline bars would share a denominator that excludes the funnel's
    // own end state.
    const funnelTotal = total + referred;
    main = {
      icon: Calendar,
      label: 'Interviews to schedule',
      value: fmt(toSchedule),
      trend: {
        dir: 'up',
        text: `${fmt(upcomingToday)} today · ${fmt(passed)} passed awaiting referral`,
      },
      subTitle: 'Interview Pipeline',
      subItems: [
        { icon: Calendar, label: 'To schedule', value: fmt(toSchedule), status: 'active' },
        {
          icon: Clock,
          label: 'Upcoming today',
          value: fmt(upcomingToday),
          status: 'active',
        },
        {
          icon: CheckCircle2,
          label: 'Passed awaiting referral',
          value: fmt(passed),
          status: 'active',
        },
        {
          icon: Users,
          label: 'Failed / No-show',
          value: fmt(failed),
          status: 'inactive',
        },
      ],
    };
    smallStats = [
      {
        icon: Calendar,
        label: 'To schedule',
        value: fmt(toSchedule),
        sub: 'shortlisted candidates',
        color: '#1a5fac',
      },
      {
        icon: CheckCircle2,
        label: 'Passed awaiting referral',
        value: fmt(passed),
        sub: 'refer them to the employer',
        color: '#0f766e',
      },
    ];
    pipeline = {
      title: 'Interview Pipeline',
      items: [
        {
          icon: Calendar,
          label: 'To schedule',
          current: toSchedule,
          total: Math.max(funnelTotal, 1),
          color: '#1a5fac',
        },
        {
          icon: Clock,
          label: 'Interviews scheduled',
          current: scheduled,
          total: Math.max(funnelTotal, 1),
          color: '#0d7a3e',
        },
        {
          icon: CheckCircle2,
          label: 'Passed awaiting referral',
          current: passed,
          total: Math.max(funnelTotal, 1),
          color: '#b45309',
        },
        {
          icon: Users,
          label: 'Failed / No-show',
          current: failed,
          total: Math.max(funnelTotal, 1),
          color: '#be123c',
        },
        {
          icon: Briefcase,
          label: 'Referred to employer',
          current: referred,
          total: Math.max(funnelTotal, 1),
          color: '#0f766e',
        },
      ],
    };
    const INTERVIEW_ACTIVITY: Record<string, { action: string; status: ActivityItem['status'] }> = {
      SHORTLISTED: { action: 'Candidate shortlisted', status: 'info' },
      INTERVIEW_SCHEDULED: { action: 'Interview scheduled', status: 'pending' },
      INTERVIEW_POSTPONED: { action: 'Interview postponed', status: 'warning' },
      INTERVIEW_CANCELLED: { action: 'Interview cancelled', status: 'info' },
      INTERVIEW_PASSED: { action: 'Interview passed', status: 'success' },
      INTERVIEW_FAILED: { action: 'Interview failed', status: 'warning' },
    };
    activity = interviews.slice(0, 5).map((i) => {
      const a = INTERVIEW_ACTIVITY[i.status] ?? { action: 'Interview', status: 'info' as const };
      return {
        icon: Calendar,
        action: a.action,
        detail: i.applicantName,
        when: relativeDate(i.updatedAt),
        price: i.jobTitle,
        status: a.status,
      };
    });
    // Monthly chart: every interview-dated application in the branch,
    // including ones that already left the pipeline (referred, hired).
    // Bucketing listInterviews rows lost those months on referral.
    chartValues = interviewMonths;
    chartLabel = 'Interviews Scheduled';
  } else if (role === 'EMPLOYER') {
    // Employer dashboard: real counts over the employer's OWN postings
    // only (see countEmployerCandidates / countHiresByMonth).
    let candidateCounts = { referred: 0, hired: 0 };
    if (!actor.companyId) {
      // No company linked yet — an empty dashboard, not an error. Every
      // helper below already returns zeros without a company, so skip the
      // calls entirely instead of catching their absence.
    } else {
      // No try/catch here on purpose: a real failure (DB down, bad query)
      // must surface as an error, not silently render as zeros.
      // M2 hoist: fetch the own jobs once, then pass their ids into the
      // count helpers instead of letting each re-query the same job list.
      const visibleJobs = await listJobsForEmployer(actor);
      const visibleJobIds = visibleJobs.map((j) => j.id);
      const [candidates, hiresByMonth] = await Promise.all([
        countEmployerCandidates(actor, visibleJobIds),
        countHiresByMonth(actor, year, visibleJobIds),
      ]);
      jobs = visibleJobs;
      candidateCounts = candidates;
      chartValues = hiresByMonth;
    }
    chartLabel = 'Hires Made';
    const activeJobs = jobs.filter((j) => j.status === 'OPEN');
    // Real pipeline denominator: every vacancy slot across the employer's
    // own postings.
    const totalVacancies = jobs.reduce((sum, j) => sum + (j.vacancies ?? 0), 0);
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
      trend: {
        dir: 'up',
        text: `${jobs.length} job posting${jobs.length !== 1 ? 's' : ''}`,
      },
      subTitle: 'By Position',
      subItems: jobItems,
    };
    smallStats = [
      {
        icon: Briefcase,
        label: 'Open Jobs',
        value: String(activeJobs.length),
        sub: 'open now',
        color: '#0f766e',
      },
      {
        icon: Building2,
        label: 'Total Postings',
        value: String(jobs.length),
        sub: `${totalVacancies} vacancy slot${totalVacancies !== 1 ? 's' : ''}`,
        color: '#1a5fac',
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
          // Was: candidates / active-job count — 5 candidates across 2 jobs
          // rendered as 250%. Denominator is now total vacancies; the bar
          // is clamped to 100% in the renderer regardless.
          current: candidateCounts.referred,
          total: Math.max(totalVacancies, 1),
          color: '#1a5fac',
        },
        {
          icon: CheckCircle2,
          label: 'Positions Filled',
          current: candidateCounts.hired,
          total: Math.max(totalVacancies, 1),
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
    const [myApplications, myNotifications] = await Promise.all([
      listMyApplications(actor),
      listMyNotifications(actor, { page: 1, pageSize: 5 }),
    ]);
    const upcomingInterviews = myApplications.filter(
      (a) =>
        a.status === 'INTERVIEW_SCHEDULED' && a.interviewAt && new Date(a.interviewAt) > new Date(),
    );
    const activeApplications = myApplications.filter(
      (a) => !TERMINAL_APPLICATION_STATUSES.includes(a.status),
    );
    smallStats = [
      {
        icon: Briefcase,
        label: 'Active Applications',
        value: String(activeApplications.length),
        sub: `${myApplications.filter((a) => a.status === 'SHORTLISTED').length} shortlisted of ${myApplications.length} total`,
        color: '#1a5fac',
      },
      {
        icon: Activity,
        label: 'Upcoming Interviews',
        value: String(upcomingInterviews.length),
        sub: upcomingInterviews.length > 0 ? 'scheduled' : 'none scheduled',
        color: '#0f766e',
      },
    ];
    activity = myNotifications.items.map((n): ActivityItem => ({
      icon: Bell,
      action: n.title,
      detail: n.body,
      when: relativeDate(n.createdAt),
      price: n.readAt ? 'Read' : 'Unread',
      status: n.readAt ? 'info' : 'pending',
    }));
    chartValues = bucketByMonth(
      myApplications.map((a) => a.createdAt),
      year,
    );
    chartLabel = 'Applications';
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
  const chart = { values: chartValues, peak: Math.max(...chartValues, 0), label: chartLabel };

  /* ── Build activity list ──────────────────────────────────────── */
  const JOB_STATUS_ACTIVITY: Record<string, ActivityItem['status']> = {
    OPEN: 'success',
    DRAFT: 'pending',
    PAUSED: 'warning',
    FILLED: 'success',
    CLOSED: 'info',
    EXPIRED: 'warning',
  };
  /* Employer activity is built from the employer's real jobs above; every
     other role's activity was already built from real rows in its branch. */
  if (role === 'EMPLOYER') {
    activity = jobs.slice(0, 5).map((j) => ({
      icon: Briefcase,
      action:
        j.status === 'FILLED'
          ? 'Position Filled'
          : j.status === 'OPEN'
            ? 'Job Posted'
            : 'Job Updated',
      detail: j.title,
      when: relativeDate(j.createdAt),
      price: j.vacancies != null ? `${j.vacancies} slot${j.vacancies !== 1 ? 's' : ''}` : 'Open',
      status: JOB_STATUS_ACTIVITY[j.status] ?? 'info',
    }));
  }
  const MainIcon = main.icon;

  const firstName = user.name.split(' ')[0];
  const now = new Date();
  const dateStr = `${now.toLocaleDateString('en-PK', { weekday: 'short' })}, ${formatDate(now)}`;
  const scopeLabel =
    role === 'SUPER_ADMIN'
      ? actor.activeBranchId
        ? (visible[0]?.name ?? 'One Branch')
        : `All ${visible.length} branches`
      : me.branches.map((b) => b.name).join(', ') || 'Platform-wide';

  const CARD = 'rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6';
  const BORDER = '1px solid var(--border)';

  return (
    <div className="grid w-full gap-6">
      {/* Live values: re-run the server data every 30s while this tab is
          visible, and on focus — the numbers below are a snapshot at
          load time without this. */}
      <DashboardAutoRefresh />
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
            style={{
              borderColor: 'var(--border)',
              color: 'var(--fg-muted)',
              background: 'var(--surface)',
            }}
          >
            <Calendar className="size-4" aria-hidden="true" />
            {dateStr}
          </span>
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
              {/* Dead menu items ("View detailed report", "Export as CSV")
                  removed — no report/export exists. Refresh re-runs the
                  live server data. */}
              <CardActionMenu items={[{ label: 'Refresh data', action: 'refresh' }]} />
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

            {/* Action buttons: no-wrap + wrapping row. Three flex-1 links
                share ~470px, so the longest label ("Browse Applicants")
                wrapped onto two lines mid-button. Labels now stay on one
                line; on narrow screens a button drops to its own row
                instead of wrapping its text. */}
            <div className="mb-6 flex flex-wrap gap-2">
              <NextLink
                href={actions.action1.href}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold whitespace-nowrap text-white"
                style={{ background: '#0d7a3e' }}
              >
                {actions.action1.label}
              </NextLink>
              <NextLink
                href={actions.action2.href}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold whitespace-nowrap"
                style={{ borderColor: '#e8eeed', color: 'var(--fg)' }}
              >
                {actions.action2.label}
              </NextLink>
              {actions.action3 && (
                <NextLink
                  href={actions.action3.href}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold whitespace-nowrap"
                  style={{ borderColor: '#e8eeed', color: 'var(--fg)' }}
                >
                  {actions.action3.label}
                </NextLink>
              )}
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
                    style={{
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                    }}
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
                        {/* No truncate: "Verified Companies" was cut to
                            "Verified Co..." in the half-width card. The
                            label wraps to a second line instead. */}
                        <p
                          className="text-xs leading-snug font-semibold"
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
              <CardActionMenu items={[{ label: 'Refresh data', action: 'refresh' }]} />
            </div>
            <div className="grid gap-5">
              {pipeline.items.map((item, pi) => {
                const PIcon = item.icon;
                const pct =
                  item.total > 0 ? Math.min(100, Math.round((item.current / item.total) * 100)) : 0;
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
                    <CardActionMenu items={[{ label: 'Refresh data', action: 'refresh' }]} />
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
            currentMonth={currentMonth}
            color="#0d7a3e"
            label={chart.label}
          />

          {/* Recent Activity */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: BORDER }}
            >
              <p className="text-base font-bold" style={{ color: 'var(--fg)' }}>
                Recent Activity
              </p>
            </div>
            <div
              className="grid gap-4 px-6 py-3 text-[11px] font-bold tracking-wider uppercase"
              style={{
                gridTemplateColumns: '1fr auto auto auto',
                color: 'var(--fg-muted)',
                background: 'var(--surface-muted)',
                borderBottom: BORDER,
              }}
            >
              <span>Activity</span>
              <span>Date</span>
              <span>Detail</span>
              <span>Status</span>
            </div>
            {activity.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm" style={{ color: 'var(--fg-muted)' }}>
                No activity yet. Post a job to get started.
              </div>
            ) : null}
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
