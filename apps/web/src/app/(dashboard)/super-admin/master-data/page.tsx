import {
  MASTER_DATA_PARENT,
  MASTER_DATA_TYPE_LABELS,
  masterDataTypeSchema,
  type MasterDataType,
} from '@jobbank/shared';
import { requireRole } from '@/domains/auth';
import { listHolidays, listMasterData, pktDate } from '@/domains/settings';
import { HolidaysManager } from '../../_components/master-data/HolidaysManager';
import { MasterDataManager } from '../../_components/master-data/MasterDataManager';
import { MasterDataNav, type ListKey } from '../../_components/master-data/MasterDataNav';

export const metadata = { title: 'Master data' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MasterDataPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireRole('SUPER_ADMIN');
  const params = await searchParams;
  const parsed = masterDataTypeSchema.safeParse(params.type);
  const current: ListKey =
    params.type === 'HOLIDAYS' ? 'HOLIDAYS' : parsed.success ? parsed.data : 'JOB_CATEGORY';

  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Master data</h1>
        <p className="text-fg-muted text-sm">
          The lists people choose from across the Job Bank. Items are deactivated, never deleted, so
          older records keep their meaning.
        </p>
      </header>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside>
          <MasterDataNav current={current} />
        </aside>
        <section className="grid min-w-0 content-start gap-4">
          <h2 className="text-fg text-lg font-semibold">
            {current === 'HOLIDAYS' ? 'Public holidays' : MASTER_DATA_TYPE_LABELS[current]}
          </h2>
          {current === 'HOLIDAYS' ? (
            <HolidaysView yearParam={params.year} />
          ) : (
            <ListView type={current} actor={actor} />
          )}
        </section>
      </div>
    </div>
  );
}

async function ListView({
  type,
  actor,
}: {
  type: MasterDataType;
  actor: Awaited<ReturnType<typeof requireRole>>['actor'];
}) {
  const parentType = MASTER_DATA_PARENT[type]?.type;
  const [items, parents] = await Promise.all([
    listMasterData(actor, { type, includeInactive: true }),
    parentType ? listMasterData(actor, { type: parentType }) : Promise.resolve([]),
  ]);
  return (
    <MasterDataManager
      type={type}
      items={items}
      parents={parents.map((p) => ({ id: p.id, label: p.label }))}
    />
  );
}

async function HolidaysView({ yearParam }: { yearParam: string | string[] | undefined }) {
  const thisYear = Number(pktDate(new Date()).slice(0, 4));
  const requested = Number(yearParam);
  const year =
    Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : thisYear;
  const holidays = await listHolidays({ year });
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, year])].sort();
  return <HolidaysManager holidays={holidays} year={year} years={years} />;
}
