import { KeyValue } from '@/components/molecules';
import { requireRole } from '@/domains/auth';
import { listSettings, type SettingView } from '@/domains/settings';
import { WEEKDAY_LABELS } from '@jobbank/shared';

export const metadata = { title: 'Branch settings' };

function display(setting: SettingView): string {
  const v = setting.value;
  if (setting.key === 'calendar.weekend_days') {
    return (v as number[]).map((d) => WEEKDAY_LABELS[d]).join(', ') || 'None';
  }
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  const text = Array.isArray(v) ? v.join(', ') : String(v);
  return setting.unit ? `${text} ${setting.unit}` : text;
}

export default async function BranchSettingsPage() {
  await requireRole('BRANCH_ADMIN');
  const settings = await listSettings();

  return (
    <div className="grid w-full gap-8">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Branch settings</h1>
        <p className="text-fg-muted text-sm">System rules are set by the Super Admin.</p>
      </header>
      <section className="border-border bg-surface shadow-card grid gap-4 rounded-xl border p-5">
        <div className="grid gap-1">
          <h2 className="text-fg text-base font-semibold">System rules</h2>
          <p className="text-fg-muted text-sm">Set by the Super Admin for every branch.</p>
        </div>
        <KeyValue
          columns={1}
          items={settings.map((s) => ({ label: s.label, value: display(s) }))}
        />
      </section>
    </div>
  );
}
