import { requireRole } from '@/domains/auth';
import { listSettings } from '@/domains/settings';
import { WorkflowSettings } from '../../_components/settings/WorkflowSettings';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireRole('SUPER_ADMIN');
  const settings = await listSettings();

  return (
    <div className="grid w-full gap-8">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Settings</h1>
        <p className="text-fg-muted text-sm">
          System-wide rules. Every change is recorded in the audit log.
        </p>
      </header>
      <section className="grid gap-4">
        <h2 className="text-fg text-lg font-semibold">Workflow</h2>
        <WorkflowSettings settings={settings} />
      </section>
    </div>
  );
}
