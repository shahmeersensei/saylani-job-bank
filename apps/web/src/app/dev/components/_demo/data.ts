import {
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  FileSearch,
  Gauge,
  Handshake,
  LifeBuoy,
  Settings,
  ShieldBan,
  Users,
} from 'lucide-react';
import type { NavSection } from '@/components/organisms/AppSidebar';
import type { Tone } from '@/design-system/tokens';

export interface DemoCandidate {
  id: string;
  code: string;
  name: string;
  area: string;
  trade: string;
  status: { label: string; tone: Tone };
  updatedAt: string;
}

export const demoCandidates: DemoCandidate[] = [
  {
    id: '1',
    code: 'JB-KHI-00412',
    name: 'Ahmed Raza',
    area: 'Gulshan-e-Iqbal',
    trade: 'Electrician',
    status: { label: 'Eligible', tone: 'success' },
    updatedAt: '2026-09-29T09:15:00Z',
  },
  {
    id: '2',
    code: 'JB-KHI-00418',
    name: 'Sana Iqbal',
    area: 'North Nazimabad',
    trade: 'Data entry',
    status: { label: 'Referred', tone: 'accent' },
    updatedAt: '2026-09-30T11:40:00Z',
  },
  {
    id: '3',
    code: 'JB-KHI-00431',
    name: 'Bilal Ahmed',
    area: 'Korangi',
    trade: 'Driver (LTV)',
    status: { label: 'Interview scheduled', tone: 'info' },
    updatedAt: '2026-10-01T05:05:00Z',
  },
  {
    id: '4',
    code: 'JB-KHI-00437',
    name: 'Fatima Noor',
    area: 'Saddar',
    trade: 'Sales associate',
    status: { label: 'Decision pending', tone: 'warning' },
    updatedAt: '2026-09-27T14:20:00Z',
  },
  {
    id: '5',
    code: 'JB-KHI-00440',
    name: 'Usman Tariq',
    area: 'Landhi',
    trade: 'Welder',
    status: { label: 'Not eligible', tone: 'danger' },
    updatedAt: '2026-09-25T08:00:00Z',
  },
  {
    id: '6',
    code: 'JB-KHI-00446',
    name: 'Hira Siddiqui',
    area: 'Clifton',
    trade: 'Receptionist',
    status: { label: 'Placed', tone: 'primary' },
    updatedAt: '2026-09-20T10:30:00Z',
  },
];

export const demoNavigation: NavSection[] = [
  {
    items: [
      { href: '/dev/components/dashboard', label: 'Overview', icon: Gauge, exact: true },
      { href: '/dev/components/dashboard/applicants', label: 'Applicants', icon: Users },
      { href: '/dev/components/dashboard/jobs', label: 'Jobs', icon: Briefcase },
      {
        href: '/dev/components/dashboard/pipeline',
        label: 'Match pipeline',
        icon: ClipboardList,
        badge: 12,
      },
      { href: '/dev/components/dashboard/interviews', label: 'Interviews', icon: CalendarDays },
      { href: '/dev/components/dashboard/placements', label: 'Placements', icon: Handshake },
    ],
  },
  {
    title: 'Governance',
    items: [
      { href: '/dev/components/dashboard/companies', label: 'Companies', icon: Building2 },
      {
        href: '/dev/components/dashboard/verification',
        label: 'Verification queue',
        icon: FileSearch,
        badge: 4,
      },
      { href: '/dev/components/dashboard/blacklist', label: 'Blacklist', icon: ShieldBan },
      { href: '/dev/components/dashboard/audit', label: 'Audit log', icon: BadgeCheck },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/dev/components/dashboard/settings', label: 'Settings', icon: Settings },
      { href: '/dev/components/dashboard/help', label: 'Help', icon: LifeBuoy },
    ],
  },
];

/** Simulated presigned upload: ~1.2 s with progress; file names containing "fail" error out. */
export async function fakeUpload(
  file: File,
  { onProgress, signal }: { onProgress: (fraction: number) => void; signal: AbortSignal },
): Promise<{ key: string }> {
  for (let step = 1; step <= 10; step += 1) {
    if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (step === 6 && file.name.toLowerCase().includes('fail'))
      throw new Error('Upload failed (HTTP 500)');
    onProgress(step / 10);
  }
  return { key: `demo/${crypto.randomUUID()}/${file.name}` };
}
