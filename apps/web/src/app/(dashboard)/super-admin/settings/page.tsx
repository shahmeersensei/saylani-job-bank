import { requireRole } from '@/domains/auth';
import { listBranches } from '@/domains/branch';
import { getRadiusOverview, listMasterData, listSettings } from '@/domains/settings';
import { RadiusSettings } from '../../_components/settings/RadiusSettings';
import { WorkflowSettings } from '../../_components/settings/WorkflowSettings';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { actor } = await requireRole('SUPER_ADMIN');
  const [overview, categories, branches, settings] = await Promise.all([
    getRadiusOverview(actor),
    listMasterData(actor, { type: 'JOB_CATEGORY' }),
    listBranches(actor),
    listSettings(),
  ]);

  return (
    <div className="grid w-full gap-8">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Settings</h1>
        <p className="text-fg-muted text-sm">
          System-wide rules. Every change is recorded in the audit log.
        </p>
      </header>
      <section className="grid gap-4">
        <h2 className="text-fg text-lg font-semibold">Matching radius</h2>
        <RadiusSettings
          overview={overview}
          categories={categories.map((c) => ({ id: c.id, label: c.label }))}
          branches={branches.map((b) => ({ id: b.id, label: b.name }))}
        />
      </section>
      <section className="grid gap-4">
        <h2 className="text-fg text-lg font-semibold">Workflow</h2>
        <WorkflowSettings settings={settings} />
      </section>
    </div>
  );
}
