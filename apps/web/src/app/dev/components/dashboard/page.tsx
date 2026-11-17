'use client';

import { Bell, LogOut, Pencil, Send, UserRound } from 'lucide-react';
import { Button, StatusPill } from '@/components/atoms';
import { ConfirmDialog, KeyValue, Tabs, toast } from '@/components/molecules';
import { Timeline } from '@/components/organisms';
import { DashboardLayout, DetailPageLayout } from '@/components/templates';
import { demoNavigation } from '../_demo/data';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-border bg-surface shadow-card grid gap-4 rounded-xl border p-4 sm:p-5">
      <h2 className="text-fg text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function DashboardDemoPage() {
  return (
    <DashboardLayout
      navigation={demoNavigation}
      sidebarFooter={<p className="text-fg-subtle px-3 text-xs">Karachi — Gulshan branch</p>}
      topBar={{
        title: 'Match case',
        user: { name: 'Sana Malik', role: 'Job Bank Staff' },
        userMenuItems: [
          { label: 'My profile', icon: UserRound, onSelect: () => toast('Profile') },
          { label: 'Sign out', icon: LogOut, tone: 'danger', onSelect: () => toast('Signed out') },
        ],
        actions: (
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell />
          </Button>
        ),
      }}
    >
      <DetailPageLayout
        breadcrumbs={[
          { label: 'Match pipeline', href: '/dev/components/dashboard/pipeline' },
          { label: 'Electrician — Al-Noor Builders', href: '/dev/components/dashboard/jobs' },
          { label: 'JB-KHI-00412' },
        ]}
        title="JB-KHI-00412 · Ahmed Raza"
        subtitle="Electrician · Gulshan-e-Iqbal"
        status={<StatusPill label="Eligible" tone="success" />}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Pencil />}>
              Edit
            </Button>
            <ConfirmDialog
              title="Refer to Al-Noor Builders?"
              description="The employer will receive the masked profile only."
              confirmLabel="Refer"
              onConfirm={() => {
                toast.success('Referred to employer');
              }}
              trigger={<Button leftIcon={<Send />}>Refer to employer</Button>}
            />
          </>
        }
        aside={
          <>
            <Card title="Match summary">
              <KeyValue
                columns={1}
                items={[
                  { label: 'Match score', value: '86 / 100' },
                  { label: 'Assigned staff', value: 'Sana Malik' },
                ]}
              />
            </Card>
            <Card title="History">
              <Timeline
                label="Case history"
                items={[
                  {
                    id: '1',
                    title: 'Suggested by matching engine',
                    timestamp: '2026-09-26T07:00:00Z',
                    tone: 'neutral',
                  },
                  {
                    id: '2',
                    title: 'Reviewed',
                    timestamp: '2026-09-26T09:30:00Z',
                    actor: 'Sana Malik',
                    tone: 'info',
                  },
                  {
                    id: '3',
                    title: 'Job Bank interview — present',
                    timestamp: '2026-09-29T06:00:00Z',
                    actor: 'Sana Malik',
                    tone: 'accent',
                  },
                  {
                    id: '4',
                    title: 'Marked eligible',
                    timestamp: '2026-09-29T06:40:00Z',
                    actor: 'Sana Malik',
                    tone: 'success',
                  },
                ]}
              />
            </Card>
          </>
        }
      >
        <Card title="Candidate">
          <Tabs
            label="Candidate details"
            items={[
              {
                value: 'profile',
                label: 'Profile',
                content: (
                  <KeyValue
                    items={[
                      { label: 'Experience', value: '4 years' },
                      { label: 'Education', value: 'Matric' },
                      { label: 'Skills', value: 'Wiring, DB panels, solar installation' },
                      { label: 'Languages', value: 'Urdu, English (basic)' },
                      { label: 'Preferred shift', value: 'Morning' },
                      { label: 'Expected salary', value: 'PKR 45,000' },
                    ]}
                  />
                ),
              },
              {
                value: 'interview',
                label: 'JB interview',
                content: (
                  <p className="text-fg-muted text-sm">
                    Strong practical skills; punctual; recommended.
                  </p>
                ),
              },
              {
                value: 'documents',
                label: 'Documents',
                count: 3,
                content: <p className="text-fg-muted text-sm">CNIC (front, back), CV.</p>,
              },
            ]}
          />
        </Card>
      </DetailPageLayout>
    </DashboardLayout>
  );
}
