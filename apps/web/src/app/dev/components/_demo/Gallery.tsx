'use client';

import { Bell, Download, LogOut, Mail, Plus, Search, Trash2, UserRound } from 'lucide-react';
import NextLink from 'next/link';
import { useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Icon,
  Input,
  Label,
  Link,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  StatusPill,
  Switch,
  Textarea,
  Tooltip,
} from '@/components/atoms';
import { BrandMark } from '@/components/brand';
import {
  CNICInput,
  ConfirmDialog,
  DateTimePicker,
  EmptyState,
  FileUploader,
  FormField,
  KeyValue,
  OTPInput,
  Pagination,
  PhoneInput,
  SearchBar,
  Tabs,
  ThemeToggle,
  toast,
} from '@/components/molecules';
import {
  DataTable,
  KanbanBoard,
  Stepper,
  Timeline,
  TopBar,
  type SortState,
} from '@/components/organisms';
import { tones } from '@/design-system/tokens';
import { formatDateTime } from '@/lib/format/date';
import { demoCandidates, fakeUpload, type DemoCandidate } from './data';
import { Demo, Section } from './Section';

const sections = [
  ['foundations', 'Foundations'],
  ['atoms', 'Atoms'],
  ['forms', 'Form molecules'],
  ['feedback', 'Feedback & display'],
  ['data', 'Data organisms'],
  ['navigation', 'Navigation'],
  ['templates', 'Templates'],
] as const;

const swatches = [
  'bg',
  'surface',
  'surface-muted',
  'border',
  'fg',
  'fg-muted',
  'primary',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
] as const;

export function Gallery() {
  const [phone, setPhone] = useState<{ e164: string | null; national: string }>({
    e164: null,
    national: '',
  });
  const [cnic, setCnic] = useState('');
  const [otp, setOtp] = useState('');
  const [when, setWhen] = useState('');
  const [page, setPage] = useState(3);
  const [sort, setSort] = useState<SortState | null>({ id: 'updated', direction: 'asc' });
  const [tableLoading, setTableLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [notify, setNotify] = useState(true);

  const sortedRows = useMemo(() => {
    if (!sort) return demoCandidates;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...demoCandidates].sort((a, b) => {
      if (sort.id === 'updated') return a.updatedAt.localeCompare(b.updatedAt) * factor;
      return a.code.localeCompare(b.code) * factor;
    });
  }, [sort]);

  return (
    <div className="min-h-dvh">
      <header className="border-border bg-surface/90 page-gutter sticky top-0 z-30 flex h-14 items-center justify-between border-b backdrop-blur">
        <div className="flex items-center gap-3">
          <BrandMark compact />
          <span className="text-fg text-sm font-semibold">Component gallery</span>
          <Badge tone="warning" size="sm">
            dev only
          </Badge>
        </div>
        <ThemeToggle />
      </header>

      <div className="page-gutter mx-auto grid max-w-7xl gap-8 py-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Gallery sections" className="hidden lg:block">
          <ul className="sticky top-20 grid gap-1 text-sm">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="text-fg-muted hover:bg-surface-muted hover:text-fg block rounded-md px-2 py-1"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-12">
          {/* ── Foundations ─────────────────────────────── */}
          <Section
            id="foundations"
            title="Foundations"
            description="Semantic colour tokens switch automatically between light and dark themes."
          >
            <Demo
              title="Colour tokens"
              className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"
            >
              {swatches.map((token) => (
                <div key={token} className="grid gap-1.5">
                  <div
                    className="border-border h-12 rounded-lg border"
                    style={{ background: `var(--${token})` }}
                  />
                  <code className="text-fg-muted text-xs">--{token}</code>
                </div>
              ))}
            </Demo>
            <Demo title="Type scale" className="grid gap-2">
              <p className="text-3xl font-semibold">Heading 3xl — Find work near you</p>
              <p className="text-2xl font-semibold">Heading 2xl — Verification queue</p>
              <p className="text-lg font-semibold">Heading lg — Interview details</p>
              <p className="text-base">
                Body base — Your personal details are never shared with employers.
              </p>
              <p className="text-fg-muted text-sm">Body sm muted — Last updated 1 Oct 2026</p>
              <p className="text-fg-subtle text-xs">Caption xs subtle — JB-KHI-00412</p>
            </Demo>
          </Section>

          {/* ── Atoms ───────────────────────────────────── */}
          <Section id="atoms" title="Atoms">
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <Demo title="Button — variants" className="flex flex-wrap gap-2">
                <Button>Primary</Button>
                <Button variant="accent">Accent</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger" leftIcon={<Trash2 />}>
                  Danger
                </Button>
                <Button variant="link">Link</Button>
              </Demo>
              <Demo title="Button — sizes & states" className="flex flex-wrap items-center gap-2">
                <Button size="sm">Small</Button>
                <Button size="md" leftIcon={<Plus />}>
                  Medium
                </Button>
                <Button size="lg">Large</Button>
                <Button loading>Saving</Button>
                <Button disabled>Disabled</Button>
                <Tooltip content="Download CSV">
                  <Button size="icon" variant="secondary" aria-label="Download CSV">
                    <Download />
                  </Button>
                </Tooltip>
              </Demo>
              <Demo title="Badge — tones (soft / solid / outline)" className="grid gap-2">
                {(['soft', 'solid', 'outline'] as const).map((variant) => (
                  <div key={variant} className="flex flex-wrap gap-2">
                    {tones.map((tone) => (
                      <Badge key={tone} tone={tone} variant={variant}>
                        {tone}
                      </Badge>
                    ))}
                  </div>
                ))}
              </Demo>
              <Demo title="StatusPill (match-case style statuses)" className="flex flex-wrap gap-2">
                <StatusPill label="Suggested" tone="neutral" />
                <StatusPill label="Under verification" tone="info" />
                <StatusPill label="Referred" tone="accent" />
                <StatusPill label="Decision pending" tone="warning" pulse />
                <StatusPill label="Selected" tone="success" />
                <StatusPill label="Rejected" tone="danger" />
                <StatusPill label="Placed" tone="primary" />
              </Demo>
              <Demo
                title="Avatar, Icon, Spinner, Link"
                className="flex flex-wrap items-center gap-4"
              >
                <Avatar name="Ayesha Khan" size="sm" />
                <Avatar name="Muhammad Hasan" />
                <Avatar name="Zainab" size="lg" />
                <Icon as={Bell} label="Notifications" />
                <Icon as={Mail} size="lg" className="text-accent" />
                <Spinner />
                <Link href="/dev/components">Internal link</Link>
                <Link href="https://www.saylaniwelfare.com" external>
                  Saylani Welfare
                </Link>
              </Demo>
              <Demo title="Skeleton" className="grid gap-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton lines={3} />
              </Demo>
              <Demo title="Input, Select, Textarea" className="grid gap-3">
                <Input placeholder="Plain input" aria-label="Plain input" />
                <Input placeholder="With icon" aria-label="With icon" startAdornment={<Search />} />
                <Input placeholder="Disabled" aria-label="Disabled input" disabled />
                <Select
                  aria-label="Trade"
                  placeholder="Choose a trade"
                  defaultValue=""
                  options={[
                    { value: 'electrician', label: 'Electrician' },
                    { value: 'driver', label: 'Driver (LTV)' },
                    { value: 'sales', label: 'Sales associate' },
                  ]}
                />
                <Textarea aria-label="Notes" placeholder="Notes…" maxLength={200} showCount />
              </Demo>
              <Demo title="Checkbox, Radio, Switch" className="grid gap-4">
                <Checkbox
                  label="I confirm the information is correct"
                  description="Required before submitting."
                  defaultChecked
                />
                <Checkbox label="Indeterminate example" checked="indeterminate" />
                <div className="grid gap-2">
                  <Label>Preferred shift</Label>
                  <RadioGroup
                    aria-label="Preferred shift"
                    orientation="horizontal"
                    defaultValue="morning"
                    options={[
                      { value: 'morning', label: 'Morning' },
                      { value: 'evening', label: 'Evening' },
                      { value: 'night', label: 'Night' },
                    ]}
                  />
                </div>
                <Switch
                  label="SMS notifications"
                  description="Interview reminders 24 hours before."
                  checked={notify}
                  onCheckedChange={setNotify}
                />
              </Demo>
            </div>
          </Section>

          {/* ── Form molecules ──────────────────────────── */}
          <Section
            id="forms"
            title="Form molecules"
            description="FormField wires the label, hint and error to any control automatically."
          >
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <Demo title="FormField — hint, error, required" className="grid gap-4">
                <FormField label="Full name" required hint="As written on your CNIC.">
                  <Input autoComplete="name" />
                </FormField>
                <FormField label="Email" error="Enter a valid email address.">
                  <Input type="email" defaultValue="ayesha@" startAdornment={<Mail />} />
                </FormField>
              </Demo>
              <Demo title="PhoneInput & CNICInput (Pakistan)" className="grid gap-4">
                <FormField
                  label="Mobile number"
                  required
                  hint={
                    phone.e164 ? `Stored as ${phone.e164}` : 'We will send a verification code.'
                  }
                  error={
                    phone.national.length === 10 && !phone.e164
                      ? 'Mobile numbers start with 3, e.g. 300 1234567.'
                      : undefined
                  }
                >
                  <PhoneInput
                    onChange={(change) =>
                      setPhone({ e164: change.e164, national: change.national })
                    }
                  />
                </FormField>
                <FormField
                  label="CNIC"
                  required
                  hint={cnic.length === 13 ? `Stored as ${cnic}` : '13 digits'}
                >
                  <CNICInput onChange={(change) => setCnic(change.digits)} />
                </FormField>
              </Demo>
              <Demo title="OTPInput" className="grid gap-3">
                <OTPInput
                  value={otp}
                  onChange={setOtp}
                  onComplete={(code) => toast.success(`Code ${code} entered`)}
                />
                <p className="text-fg-muted text-sm">
                  Try pasting “123456”. Value: <code className="numeric">{otp || '—'}</code>
                </p>
              </Demo>
              <Demo title="DateTimePicker & SearchBar" className="grid gap-4">
                <FormField
                  label="Interview date & time"
                  hint={when ? formatDateTime(new Date(when)) : 'Physical interviews only.'}
                >
                  <DateTimePicker value={when} onChange={setWhen} />
                </FormField>
                <SearchBar
                  onSearch={(q) => q && toast(`Searching for “${q}”`)}
                  placeholder="Search applicants…"
                />
              </Demo>
              <Demo
                title="FileUploader (simulated; name a file “fail.pdf” to see an error)"
                className="grid"
              >
                <FileUploader
                  multiple
                  maxFiles={3}
                  accept={['application/pdf', 'image/*']}
                  maxSizeBytes={5 * 1024 * 1024}
                  label="Choose files"
                  hint="PDF or image, up to 5 MB each. Max 3 files."
                  upload={fakeUpload}
                />
              </Demo>
            </div>
          </Section>

          {/* ── Feedback & display ──────────────────────── */}
          <Section id="feedback" title="Feedback & display">
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <Demo title="Toasts" className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => toast.success('Company verified')}>
                  Success
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => toast.error('Referral blocked: candidate is 10.4 km away')}
                >
                  Error
                </Button>
                <Button variant="secondary" onClick={() => toast.info('Interview reminder sent')}>
                  Info
                </Button>
                <Button variant="secondary" onClick={() => toast.warning('Hold expires in 2 days')}>
                  Warning
                </Button>
              </Demo>
              <Demo title="ConfirmDialog" className="flex flex-wrap gap-2">
                <ConfirmDialog
                  title="Refer candidate to employer?"
                  description="The employer will see the masked profile only — no name, phone, CNIC or address."
                  confirmLabel="Refer"
                  onConfirm={async () => {
                    await new Promise((resolve) => setTimeout(resolve, 800));
                    toast.success('Referred');
                  }}
                  trigger={<Button>Refer…</Button>}
                />
                <ConfirmDialog
                  title="Withdraw match case"
                  description="This closes the case for everyone. It is recorded in the audit log."
                  tone="danger"
                  confirmLabel="Withdraw"
                  requireReason={{
                    label: 'Reason',
                    minLength: 10,
                    placeholder: 'Why is this case being withdrawn?',
                  }}
                  onConfirm={(reason) => {
                    toast(`Withdrawn: ${reason}`);
                  }}
                  trigger={<Button variant="danger">Withdraw…</Button>}
                />
              </Demo>
              <Demo title="KeyValue">
                <KeyValue
                  items={[
                    { label: 'Candidate code', value: 'JB-KHI-00412' },
                    { label: 'Trade', value: 'Electrician' },
                    { label: 'Experience', value: '4 years' },
                    { label: 'Education', value: 'Matric' },
                    { label: 'Languages', value: 'Urdu, English' },
                    { label: 'Expected salary', value: null },
                    {
                      label: 'Job Bank interview',
                      value: 'Strong practical skills; punctual.',
                      wide: true,
                    },
                  ]}
                />
              </Demo>
              <Demo title="Tabs">
                <Tabs
                  label="Applicant sections"
                  items={[
                    {
                      value: 'profile',
                      label: 'Profile',
                      content: <p className="text-fg-muted text-sm">Profile content</p>,
                    },
                    {
                      value: 'documents',
                      label: 'Documents',
                      count: 3,
                      content: <p className="text-fg-muted text-sm">Documents content</p>,
                    },
                    {
                      value: 'cases',
                      label: 'Match cases',
                      count: 2,
                      content: <p className="text-fg-muted text-sm">Cases content</p>,
                    },
                    {
                      value: 'history',
                      label: 'History',
                      content: <p className="text-fg-muted text-sm">History content</p>,
                    },
                  ]}
                />
              </Demo>
              <Demo title="EmptyState">
                <EmptyState
                  icon={UserRound}
                  title="No referred candidates yet"
                  description="Job Bank staff will refer verified candidates who match this job."
                  action={<Button variant="secondary">View job</Button>}
                />
              </Demo>
            </div>
          </Section>

          {/* ── Data organisms ──────────────────────────── */}
          <Section id="data" title="Data organisms">
            <Demo title="DataTable — sortable, responsive, paginated, clickable rows">
              <DataTable<DemoCandidate>
                caption="Candidates"
                rows={sortedRows}
                getRowId={(row) => row.id}
                sort={sort}
                onSortChange={setSort}
                loading={tableLoading}
                onRowClick={(row) => toast(`Open ${row.code}`)}
                toolbar={
                  <>
                    <SearchBar
                      className="max-w-xs"
                      onSearch={() => {}}
                      placeholder="Search candidates…"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setTableLoading(true);
                        setTimeout(() => setTableLoading(false), 1200);
                      }}
                    >
                      Reload
                    </Button>
                  </>
                }
                columns={[
                  {
                    id: 'code',
                    header: 'Candidate',
                    sortable: true,
                    cell: (row) => (
                      <div className="flex items-center gap-3">
                        <Avatar name={row.name} size="sm" />
                        <div className="grid">
                          <span className="font-medium">{row.name}</span>
                          <span className="text-fg-subtle numeric text-xs">{row.code}</span>
                        </div>
                      </div>
                    ),
                  },
                  { id: 'trade', header: 'Trade', hideBelow: 'md', cell: (row) => row.trade },
                  { id: 'area', header: 'Area', hideBelow: 'lg', cell: (row) => row.area },
                  { id: 'status', header: 'Status', cell: (row) => <StatusPill {...row.status} /> },
                  {
                    id: 'updated',
                    header: 'Updated',
                    sortable: true,
                    hideBelow: 'sm',
                    align: 'end',
                    cell: (row) => (
                      <span className="text-fg-muted">{formatDateTime(row.updatedAt)}</span>
                    ),
                  },
                ]}
                pagination={{
                  page,
                  pageCount: 16,
                  onPageChange: setPage,
                  pageSize: 20,
                  total: 312,
                }}
              />
            </Demo>
            <Demo title="DataTable — empty">
              <DataTable<DemoCandidate>
                caption="Empty candidates"
                rows={[]}
                getRowId={(row) => row.id}
                columns={[
                  { id: 'code', header: 'Candidate', cell: (row) => row.code },
                  { id: 'status', header: 'Status', cell: (row) => row.status.label },
                ]}
                empty={
                  <EmptyState
                    compact
                    title="No matches yet"
                    description="Try again after new applicants register."
                  />
                }
              />
            </Demo>
            <Demo title="KanbanBoard — match pipeline (read-only; moves happen via guarded actions)">
              <KanbanBoard<DemoCandidate>
                label="Match pipeline"
                getItemId={(item) => item.id}
                onCardClick={(item) => toast(`Open ${item.code}`)}
                renderCard={(item) => (
                  <div className="grid gap-2">
                    <span className="text-fg text-sm font-medium">{item.name}</span>
                    <span className="text-fg-muted text-xs">
                      {item.trade} · {item.area}
                    </span>
                  </div>
                )}
                columns={[
                  {
                    id: 'suggested',
                    title: 'Suggested',
                    tone: 'neutral',
                    items: demoCandidates.slice(0, 2),
                  },
                  {
                    id: 'interview',
                    title: 'JB interview',
                    tone: 'info',
                    items: demoCandidates.slice(2, 3),
                  },
                  {
                    id: 'referred',
                    title: 'Referred',
                    tone: 'accent',
                    items: demoCandidates.slice(3, 4),
                  },
                  { id: 'decision', title: 'Decision pending', tone: 'warning', items: [] },
                  {
                    id: 'placed',
                    title: 'Placed',
                    tone: 'primary',
                    items: demoCandidates.slice(5),
                  },
                ]}
              />
            </Demo>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <Demo title="Timeline (audit / case history)">
                <Timeline
                  label="Verification history"
                  items={[
                    {
                      id: '1',
                      title: 'Company registered',
                      timestamp: '2026-09-28T06:00:00Z',
                      actor: 'Employer',
                      tone: 'neutral',
                    },
                    {
                      id: '2',
                      title: 'Claimed for verification',
                      timestamp: '2026-09-28T09:12:00Z',
                      actor: 'Ayesha Khan (Verifier)',
                      tone: 'info',
                    },
                    {
                      id: '3',
                      title: 'More information requested',
                      description: 'NTN certificate is unreadable.',
                      timestamp: '2026-09-28T10:30:00Z',
                      actor: 'Ayesha Khan (Verifier)',
                      tone: 'warning',
                    },
                    {
                      id: '4',
                      title: 'Documents resubmitted',
                      timestamp: '2026-09-29T07:45:00Z',
                      actor: 'Employer',
                      tone: 'accent',
                    },
                    {
                      id: '5',
                      title: 'Company verified',
                      timestamp: '2026-09-29T11:20:00Z',
                      actor: 'Ayesha Khan (Verifier)',
                      tone: 'success',
                    },
                  ]}
                />
              </Demo>
              <Demo title="Stepper (click a completed step)" className="grid gap-4">
                <Stepper
                  current={step}
                  onStepClick={setStep}
                  steps={[
                    { id: 'personal', label: 'Personal' },
                    { id: 'location', label: 'Location' },
                    { id: 'experience', label: 'Experience' },
                    { id: 'documents', label: 'Documents' },
                  ]}
                />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={step === 0}
                    onClick={() => setStep((s) => s - 1)}
                  >
                    Back
                  </Button>
                  <Button disabled={step === 3} onClick={() => setStep((s) => s + 1)}>
                    Next
                  </Button>
                </div>
              </Demo>
            </div>
            <Demo title="Pagination">
              <Pagination
                page={page}
                pageCount={16}
                onPageChange={setPage}
                pageSize={20}
                total={312}
              />
            </Demo>
          </Section>

          {/* ── Navigation ──────────────────────────────── */}
          <Section id="navigation" title="Navigation">
            <Demo title="TopBar (with Super Admin branch switcher and user menu)">
              <div className="border-border overflow-hidden rounded-lg border">
                <TopBar
                  title="Verification queue"
                  branchSwitcher={{
                    branches: [
                      { id: 'all', name: 'All branches' },
                      { id: 'khi-gulshan', name: 'Karachi — Gulshan' },
                      { id: 'lhr-johar', name: 'Lahore — Johar Town' },
                    ],
                    value: 'all',
                    onChange: (id) => toast(`Branch scope: ${id}`),
                  }}
                  user={{ name: 'Muhammad Hasan', role: 'Super Admin' }}
                  userMenuItems={[
                    { label: 'My profile', icon: UserRound, onSelect: () => toast('Profile') },
                    {
                      label: 'Sign out',
                      icon: LogOut,
                      tone: 'danger',
                      onSelect: () => toast('Signed out'),
                    },
                  ]}
                  actions={
                    <Button variant="ghost" size="icon" aria-label="Notifications">
                      <Bell />
                    </Button>
                  }
                />
              </div>
            </Demo>
          </Section>

          {/* ── Templates ───────────────────────────────── */}
          <Section
            id="templates"
            title="Templates"
            description="Full-page layouts — open each demo (resize the window to check mobile)."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  href: '/dev/components/dashboard',
                  title: 'DashboardLayout + DetailPageLayout',
                  text: 'Sidebar, drawer on mobile, top bar, detail page with aside.',
                },
                {
                  href: '/dev/components/auth',
                  title: 'AuthLayout',
                  text: 'Phone login with OTP step.',
                },
                {
                  href: '/dev/components/wizard',
                  title: 'WizardLayout',
                  text: 'Multi-step registration with map step.',
                },
              ].map((demo) => (
                <NextLink
                  key={demo.href}
                  href={demo.href}
                  className="border-border bg-surface shadow-card hover:border-primary focus-visible:focus-ring grid gap-1 rounded-xl border p-4 transition-colors"
                >
                  <span className="text-fg text-sm font-semibold">{demo.title}</span>
                  <span className="text-fg-muted text-sm">{demo.text}</span>
                </NextLink>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
