'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { BarChart3, Check, Eye, RefreshCw, UserPlus, Users, X } from 'lucide-react';
import type { JobMatchView, MatchesPage, MatchReviewStatus } from '@/domains/matching';
import { apiFetch } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { Badge, Button, Label, Select, StatusPill, Textarea } from '@/components/atoms';
import { DistanceBadge, EmptyState, Modal, toast } from '@/components/molecules';
import { DataTable } from '@/components/organisms';

export interface ReasonOption {
  code: string;
  label: string;
  requiresNote: boolean;
}

interface Props {
  jobId: string;
  matches: MatchesPage;
  page: number;
  pageSize: number;
  /** Active REJECTION_REASON codes (master data) for the reject dialog. */
  reasons: ReasonOption[];
}

type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const REVIEW_PILL: Record<string, { label: string; tone: Tone; pulse?: boolean }> = {
  NEW: { label: 'New', tone: 'neutral', pulse: true },
  REVIEWED: { label: 'Reviewed', tone: 'info' },
  SHORTLISTED: { label: 'Shortlisted', tone: 'success' },
  HIRED: { label: 'Hired', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

const FACTOR_LABELS: Record<string, string> = {
  required_skills: 'Required skills',
  preferred_skills: 'Preferred skills',
  experience: 'Experience',
  education: 'Education',
  languages: 'Languages',
  distance: 'Distance',
  salary: 'Salary',
  preferences: 'Job preferences',
  text_fit: 'Profile fit (AI)',
};

const RUN_PILL: Record<string, { label: string; tone: Tone; pulse?: boolean }> = {
  COMPLETED: { label: 'Up to date', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  RUNNING: { label: 'Running…', tone: 'info', pulse: true },
};

const shortId = (id: string) => id.slice(0, 8);

const TERMINAL: MatchReviewStatus[] = ['HIRED', 'REJECTED'];

type MatchRow = JobMatchView & { rank: number };
type PendingDecision = { applicantId: string; name: string } | null;

export function MatchesShortlist({ jobId, matches, page, pageSize, reasons }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [actingId, setActingId] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<JobMatchView | null>(null);
  const [rejecting, setRejecting] = useState<PendingDecision>(null);
  const [hiring, setHiring] = useState<PendingDecision>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);

  const { run } = matches;
  const rows = matches.matches.map((m, i) => ({ ...m, rank: (page - 1) * pageSize + i + 1 }));

  const reasonLabel = (code: string | null) =>
    code ? (reasons.find((r) => r.code === code)?.label ?? code) : null;

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete('page');
    else params.set('page', String(next));
    router.push(`${pathname}${params.toString() ? `?${params}` : ''}`);
  };

  function handleRefresh() {
    startRefresh(async () => {
      try {
        await apiFetch(`/api/v1/jobs/${jobId}/matches/refresh`, { method: 'POST' });
        toast.success('Recalculation queued — updated scores will appear in a few seconds.');
        // The Python worker usually finishes in well under a second (LISTEN wakeup).
        setTimeout(() => router.refresh(), 2_500);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not queue recalculation.');
      }
    });
  }

  async function decide(
    applicantId: string,
    reviewStatus: MatchReviewStatus,
    extra?: { reasonCode?: string; note?: string },
  ) {
    setActingId(applicantId);
    try {
      await apiFetch(`/api/v1/jobs/${jobId}/matches/${applicantId}`, {
        method: 'PATCH',
        body: { reviewStatus, ...extra },
      });
      toast.success(`Marked as ${REVIEW_PILL[reviewStatus]?.label.toLowerCase() ?? reviewStatus}.`);
      setRejecting(null);
      setHiring(null);
      setRejectReason('');
      setRejectNote('');
      setModalError(null);
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not update the decision.';
      setModalError(message);
      toast.error(message);
    } finally {
      setActingId(null);
    }
  }

  function submitReject() {
    if (!rejecting) return;
    const chosen = reasons.find((r) => r.code === rejectReason);
    if (!chosen) {
      setModalError('Choose a rejection reason');
      return;
    }
    if (chosen.requiresNote && rejectNote.trim().length < 5) {
      setModalError('This reason needs a short note (at least 5 characters)');
      return;
    }
    void decide(rejecting.applicantId, 'REJECTED', {
      reasonCode: chosen.code,
      ...(rejectNote.trim() ? { note: rejectNote.trim() } : {}),
    });
  }

  const refreshButton = (
    <Button size="sm" onClick={handleRefresh} disabled={refreshing} loading={refreshing}>
      <RefreshCw className="mr-1.5 size-4" />
      Recalculate
    </Button>
  );

  // No completed or failed run yet.
  if (!run) {
    return (
      <div className="grid w-full gap-6">
        <ShortlistHeader onRefresh={refreshButton} />
        <EmptyState
          icon={Users}
          title="Matching hasn't run for this job yet"
          description="The engine shortlists eligible applicants by skills, experience, distance and preferences. Run it now — it usually finishes in under a second."
          action={refreshButton}
        />
      </div>
    );
  }

  const runPill = RUN_PILL[run.status] ?? { label: run.status, tone: 'neutral' as const };

  return (
    <div className="grid w-full gap-6">
      <ShortlistHeader onRefresh={refreshButton} />

      {run.status === 'FAILED' && (
        <div className="border-danger/40 bg-danger-soft/40 rounded-xl border p-4">
          <p className="text-fg text-sm font-medium">The last matching run failed</p>
          <p className="text-fg-muted mt-1 text-sm">{run.error ?? 'No details were recorded.'}</p>
        </div>
      )}

      <div className="border-border bg-surface flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-5 py-3 text-sm">
        <StatusPill {...runPill} />
        <span className="text-fg-muted">
          <span className="numeric text-fg font-medium">{matches.total}</span> eligible of{' '}
          <span className="numeric">{run.candidateCount ?? '—'}</span> nearby candidates
        </span>
        {run.completedAt && (
          <span className="text-fg-subtle">Calculated {formatDate(run.completedAt)}</span>
        )}
        <Badge variant="outline" size="sm" className="text-fg-subtle">
          scoring {run.scoringVersion}
        </Badge>
      </div>

      <DataTable<MatchRow>
        caption="Applicant shortlist"
        rows={rows}
        getRowId={(r) => r.applicantId}
        empty={
          <EmptyState
            icon={Users}
            title="No eligible applicants yet"
            description="Nobody nearby matched the required skills and filters. Try widening the requirements or wait for new applicants."
            compact
          />
        }
        pagination={{
          page,
          pageCount: Math.max(1, Math.ceil(matches.total / pageSize)),
          pageSize,
          total: matches.total,
          onPageChange: goToPage,
        }}
        columns={[
          {
            id: 'rank',
            header: '#',
            cell: (r) => <span className="text-fg-subtle numeric w-6 text-right">{r.rank}</span>,
          },
          {
            id: 'applicant',
            header: 'Applicant',
            cell: (r) => (
              <div className="grid min-w-0">
                <span className="truncate font-medium">{r.fullName ?? 'Deleted applicant'}</span>
                <span className="text-fg-subtle numeric truncate text-xs">
                  id {shortId(r.applicantId)}
                </span>
              </div>
            ),
          },
          {
            id: 'score',
            header: 'Score',
            cell: (r) => (
              <div className="flex items-center gap-2">
                <span className="numeric w-8 text-right font-semibold">{r.score ?? '—'}</span>
                <div className="bg-surface-muted h-1.5 w-16 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, r.score ?? 0)}%` }}
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'distance',
            header: 'Distance',
            hideBelow: 'md',
            cell: (r) =>
              r.distanceM != null ? (
                <DistanceBadge meters={r.distanceM} masked />
              ) : (
                <span className="text-fg-subtle">—</span>
              ),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (r) => {
              const rejectedReason =
                r.reviewStatus === 'REJECTED' ? reasonLabel(r.reviewReasonCode) : null;
              const responseLine =
                r.reviewStatus === 'HIRED'
                  ? r.applicantResponse === 'ACCEPTED'
                    ? 'Accepted ✓'
                    : r.applicantResponse === 'DECLINED'
                      ? `Declined — ${reasonLabel(r.refusalReasonCode) ?? 'no reason'}`
                      : 'Awaiting response'
                  : null;
              return (
                <div className="grid gap-0.5">
                  <StatusPill
                    {...(REVIEW_PILL[r.reviewStatus] ?? { label: r.reviewStatus, tone: 'neutral' })}
                  />
                  {rejectedReason && (
                    <span
                      className="text-fg-subtle max-w-40 truncate text-xs"
                      title={r.reviewNote ?? undefined}
                    >
                      {rejectedReason}
                      {r.reviewNote ? ' · note' : ''}
                    </span>
                  )}
                  {responseLine && (
                    <span
                      className={
                        r.applicantResponse === 'DECLINED'
                          ? 'text-warning max-w-40 truncate text-xs'
                          : 'text-fg-subtle max-w-40 truncate text-xs'
                      }
                    >
                      {responseLine}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (r) => {
              const busy = actingId === r.applicantId;
              const terminal = TERMINAL.includes(r.reviewStatus as MatchReviewStatus);
              return (
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setBreakdown(r)}
                    title="Score breakdown"
                  >
                    <BarChart3 className="size-4" />
                  </Button>
                  {!terminal && r.reviewStatus !== 'REVIEWED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => decide(r.applicantId, 'REVIEWED')}
                      title="Mark reviewed"
                    >
                      <Eye className="size-4" />
                    </Button>
                  )}
                  {!terminal && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setRejectReason('');
                          setRejectNote('');
                          setModalError(null);
                          setRejecting({
                            applicantId: r.applicantId,
                            name: r.fullName ?? shortId(r.applicantId),
                          });
                        }}
                        title="Reject"
                      >
                        <X className="text-danger size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setModalError(null);
                          setHiring({
                            applicantId: r.applicantId,
                            name: r.fullName ?? shortId(r.applicantId),
                          });
                        }}
                        title="Hire"
                      >
                        <UserPlus className="text-success size-4" />
                      </Button>
                    </>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      <Modal
        open={breakdown !== null}
        onOpenChange={(open) => !open && setBreakdown(null)}
        title="Score breakdown"
        description={
          breakdown
            ? `${breakdown.fullName ?? shortId(breakdown.applicantId)} · ${breakdown.score ?? '—'} / 100`
            : undefined
        }
        size="md"
      >
        {breakdown && (
          <div className="grid gap-4">
            <p className="text-fg-muted text-sm">{breakdown.summary}</p>
            <ul className="grid gap-3">
              {breakdown.factors.map((f) => {
                const pct = f.weight > 0 ? Math.round((f.score / f.weight) * 100) : 0;
                return (
                  <li key={f.factor} className="grid gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-fg text-sm font-medium">
                        {FACTOR_LABELS[f.factor] ?? f.factor}
                      </span>
                      <span className="text-fg-subtle numeric text-xs">
                        {f.score.toFixed(1)} / {f.weight.toFixed(1)}
                      </span>
                    </div>
                    <div className="bg-surface-muted h-1.5 overflow-hidden rounded-full">
                      <div
                        className={
                          pct >= 70
                            ? 'bg-success h-full rounded-full'
                            : pct >= 40
                              ? 'bg-warning h-full rounded-full'
                              : 'bg-danger h-full rounded-full'
                        }
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <p className="text-fg-subtle text-xs">{f.reason}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Modal>

      {/* Reject dialog — reason is mandatory (master data), note when required. */}
      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setModalError(null);
          }
        }}
        title="Reject applicant"
        description={rejecting ? rejecting.name : undefined}
        size="sm"
      >
        <div className="grid gap-4">
          <p className="text-fg-muted text-sm">
            The applicant is notified in-app and by email. Choose an honest reason — it feeds back
            into match quality.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Select
              id="reject-reason"
              placeholder="Choose a reason…"
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                setModalError(null);
              }}
              options={reasons.map((r) => ({ value: r.code, label: r.label }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reject-note">
              Note
              {reasons.find((r) => r.code === rejectReason)?.requiresNote
                ? ' (required)'
                : ' (optional)'}
            </Label>
            <Textarea
              id="reject-note"
              rows={3}
              maxLength={500}
              placeholder="Short context for the record…"
              value={rejectNote}
              onChange={(e) => {
                setRejectNote(e.target.value);
                setModalError(null);
              }}
            />
          </div>
          {modalError && (
            <p className="text-danger text-sm" role="alert">
              {modalError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRejecting(null);
                setModalError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={actingId !== null}
              loading={actingId !== null && rejecting !== null}
              onClick={submitReject}
            >
              Reject & notify
            </Button>
          </div>
        </div>
      </Modal>

      {/* Hire dialog — confirms before the offer goes out. */}
      <Modal
        open={hiring !== null}
        onOpenChange={(open) => {
          if (!open) {
            setHiring(null);
            setModalError(null);
          }
        }}
        title="Hire applicant"
        description={hiring ? `${hiring.name} will be notified of the selection` : undefined}
        size="sm"
      >
        <div className="grid gap-4">
          <p className="text-fg-muted text-sm">
            The applicant receives the offer in-app and by email, and can accept or decline with a
            reason. You will be notified either way.
          </p>
          {modalError && (
            <p className="text-danger text-sm" role="alert">
              {modalError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setHiring(null);
                setModalError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={actingId !== null}
              loading={actingId !== null && hiring !== null}
              onClick={() => hiring && decide(hiring.applicantId, 'HIRED')}
              leftIcon={<Check className="size-4" />}
            >
              Hire & notify
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ShortlistHeader({ onRefresh }: { onRefresh: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-fg text-2xl font-semibold">Applicant shortlist</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Ranked by the auto-matching engine — shortlist, hire or reject; every decision notifies
          the applicant.
        </p>
      </div>
      <div className="shrink-0">{onRefresh}</div>
    </header>
  );
}
