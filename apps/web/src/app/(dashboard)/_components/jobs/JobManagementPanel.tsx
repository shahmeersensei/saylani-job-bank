'use client';

import { JOB_STATUS_LABELS, JOB_TYPE_LABELS } from '@jobbank/shared';
import type { JobView } from '@/domains/job';
import { Archive, Briefcase, Pencil, Plus } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button } from '@/components/atoms';
import { ConfirmDialog, Modal, toast } from '@/components/molecules';
import { apiFetch, friendlyApiError } from '@/lib/api/client';
import { StaffJobForm, type EditableJob, type JobFormCompany } from './StaffJobForm';

type ManagedJob = EditableJob & {
  companyId: string;
  companyName?: string;
  status: JobView['status'];
};

type Props = {
  jobs: ManagedJob[];
  categories: { code: string; label: string }[];
  canManage: boolean;
  companyId?: string;
  companies?: JobFormCompany[];
  jobBasePath?: string;
  jobLinkBasePath?: string;
  canCreate?: boolean;
  totalCount?: number;
};

const STATUS_TONE: Record<JobView['status'], 'success' | 'danger' | 'warning' | 'neutral'> = {
  DRAFT: 'neutral',
  OPEN: 'success',
  PAUSED: 'warning',
  FILLED: 'success',
  CLOSED: 'neutral',
  EXPIRED: 'danger',
};

export function JobManagementPanel({
  jobs: initialJobs,
  categories,
  canManage,
  companyId,
  companies = [],
  jobBasePath,
  jobLinkBasePath,
  canCreate: canCreateOverride,
  totalCount,
}: Props) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [editing, setEditing] = useState<ManagedJob | null>(null);
  const [open, setOpen] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => setJobs(initialJobs), [initialJobs]);

  function startCreate() {
    setEditing(null);
    setFormVersion((current) => current + 1);
    setOpen(true);
  }

  function startEdit(job: ManagedJob) {
    setEditing(job);
    setFormVersion((current) => current + 1);
    setOpen(true);
  }

  async function archive(job: ManagedJob) {
    if (archivingId) return;
    setArchivingId(job.id);
    try {
      const path = companyId
        ? `/api/v1/companies/${companyId}/jobs/${job.id}/status`
        : `/api/v1/jobs/${job.id}/status`;
      const { data } = await apiFetch<JobView>(path, {
        method: 'PATCH',
        body: { status: 'CLOSED', note: 'Archived by administrator' },
      });
      setJobs((current) =>
        current.map((item) => (item.id === data.id ? { ...item, ...data } : item)),
      );
      router.refresh();
      toast.success('Job archived');
    } catch (reason) {
      toast.error(friendlyApiError(reason));
    } finally {
      setArchivingId(null);
    }
  }

  const canCreate =
    canManage && (Boolean(companyId) || companies.length > 0) && canCreateOverride !== false;
  const isGlobalPage = Boolean(jobBasePath);
  const linkBasePath = jobLinkBasePath ?? jobBasePath;

  return (
    <section
      className={
        isGlobalPage ? 'grid gap-4' : 'border-border bg-surface grid gap-4 rounded-xl border p-5'
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          {isGlobalPage ? (
            <h1 className="text-fg text-2xl font-semibold">Jobs</h1>
          ) : (
            <h2 className="text-fg font-semibold">Jobs</h2>
          )}
          <p className="text-fg-muted text-sm">
            {totalCount ?? jobs.length} job
            {(totalCount ?? jobs.length) === 1 ? '' : 's'}
          </p>
        </div>
        {canCreate && (
          <Button size="sm" leftIcon={<Plus />} onClick={startCreate}>
            Add job
          </Button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="text-fg-muted grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <Briefcase className="size-6" />
          <p>
            {canManage && !companyId && companies.length === 0
              ? 'No verified companies are available in your branch.'
              : isGlobalPage
                ? 'No jobs are in your authorized scope.'
                : 'No jobs are associated with this company.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => {
            const canChange = canManage && !['FILLED', 'CLOSED', 'EXPIRED'].includes(job.status);
            return (
              <div
                key={job.id}
                className={
                  jobLinkBasePath
                    ? 'border-border hover:bg-surface-muted relative flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4'
                    : 'border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4'
                }
              >
                {jobLinkBasePath && (
                  <NextLink
                    href={`${jobLinkBasePath}/${job.id}`}
                    className="focus-visible:ring-primary absolute inset-0 cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    <span className="sr-only">{job.title}</span>
                  </NextLink>
                )}
                <div>
                  {linkBasePath && !jobLinkBasePath ? (
                    <NextLink
                      className="text-fg font-medium hover:underline"
                      href={`${linkBasePath}/${job.id}`}
                    >
                      {job.title}
                    </NextLink>
                  ) : (
                    <p className="text-fg font-medium">{job.title}</p>
                  )}
                  <p className="text-fg-muted text-sm">
                    {job.companyName ? `${job.companyName} · ` : ''}
                    {job.vacancies} vacancies · {JOB_TYPE_LABELS[job.jobType]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
                  {canChange && (
                    <div
                      className={
                        jobLinkBasePath
                          ? 'relative z-10 flex items-center gap-2'
                          : 'flex items-center gap-2'
                      }
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={<Pencil />}
                        onClick={() => startEdit(job)}
                      >
                        Edit
                      </Button>
                      <ConfirmDialog
                        title="Archive job?"
                        description={`Archive “${job.title}”? It will leave active job listings while preserving its history.`}
                        confirmLabel="Archive"
                        tone="danger"
                        onConfirm={() => archive(job)}
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Archive />}
                            loading={archivingId === job.id}
                            disabled={archivingId !== null}
                          >
                            Archive
                          </Button>
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal title={editing ? 'Edit job' : 'Add job'} open={open} onOpenChange={setOpen} size="lg">
        <StaffJobForm
          key={`${editing?.id ?? `new-${companyId ?? 'global'}`}-${formVersion}`}
          categories={categories}
          companyId={companyId}
          companies={companies}
          job={editing}
          onCancel={() => setOpen(false)}
          onSaved={(saved) => {
            const companyName =
              jobs.find((item) => item.id === saved.id)?.companyName ??
              companies.find((item) => item.id === saved.companyId)?.name;
            setJobs((current) =>
              editing
                ? current.map((item) =>
                    item.id === saved.id ? { ...item, ...saved, companyName } : item,
                  )
                : [{ ...saved, companyName }, ...current],
            );
            setOpen(false);
            router.refresh();
          }}
        />
      </Modal>
    </section>
  );
}
