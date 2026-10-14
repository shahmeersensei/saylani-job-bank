'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, MailCheck, X } from 'lucide-react';
import type { PendingOffer } from '@/domains/matching';
import type { NotificationView } from '@/domains/notifications';
import { apiFetch } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { Badge, Button, Label, Select, StatusPill, Textarea } from '@/components/atoms';
import { EmptyState, Modal, toast } from '@/components/molecules';

interface ReasonOption {
  code: string;
  label: string;
  requiresNote: boolean;
}

interface Props {
  items: NotificationView[];
  unread: number;
  offers: PendingOffer[];
  refusalReasons: ReasonOption[];
}

export function NotificationsClient({ items, unread, offers, refusalReasons }: Props) {
  const router = useRouter();
  const lastCreatedAt = items[0]?.createdAt?.toISOString?.() ?? new Date().toISOString();
  const sinceRef = useRef(lastCreatedAt);

  // ── SSE: real-time notification push ───────────────────────────────────
  useEffect(() => {
    const url = `/api/v1/notifications/stream?since=${encodeURIComponent(sinceRef.current)}`;
    const es = new EventSource(url);

    es.addEventListener('notifications', () => {
      // New notifications arrived — refresh the server-rendered page data.
      router.refresh();
    });

    es.onerror = () => {
      // EventSource reconnects automatically; nothing to do here.
    };

    return () => {
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PendingOffer | null>(null);
  const [accepting, setAccepting] = useState<PendingOffer | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declineNote, setDeclineNote] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);

  async function markRead(id: string) {
    try {
      await apiFetch(`/api/v1/notifications/${id}`, { method: 'PATCH' });
      router.refresh();
    } catch {
      // Best-effort: the row stays unread; nothing else breaks.
    }
  }

  async function markAllRead() {
    setBusyId('all');
    try {
      await apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
      toast.success('All updates marked as read.');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark updates as read.');
    } finally {
      setBusyId(null);
    }
  }

  async function respond(
    offer: PendingOffer,
    applicantResponse: 'ACCEPTED' | 'DECLINED',
    extra?: { reasonCode?: string; note?: string },
  ) {
    setBusyId(offer.jobId);
    try {
      await apiFetch(`/api/v1/offers/${offer.jobId}/response`, {
        method: 'POST',
        body: { applicantResponse, ...extra },
      });
      toast.success(
        applicantResponse === 'ACCEPTED'
          ? 'Offer accepted — the employer has been notified.'
          : 'Offer declined — the employer has been notified.',
      );
      setDeclining(null);
      setAccepting(null);
      setDeclineReason('');
      setDeclineNote('');
      setModalError(null);
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not send your answer.';
      setModalError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  }

  function submitDecline() {
    if (!declining) return;
    const chosen = refusalReasons.find((r) => r.code === declineReason);
    if (!chosen) {
      setModalError('Choose a reason');
      return;
    }
    if (chosen.requiresNote && declineNote.trim().length < 5) {
      setModalError('This reason needs a short note (at least 5 characters)');
      return;
    }
    void respond(declining, 'DECLINED', {
      reasonCode: chosen.code,
      ...(declineNote.trim() ? { note: declineNote.trim() } : {}),
    });
  }

  return (
    <div className="grid w-full gap-6">
      {/* ── Pending offers ───────────────────────────────────── */}
      {offers.length > 0 && (
        <section className="border-primary/30 bg-primary-soft/40 grid gap-3 rounded-2xl border p-5">
          <div className="flex items-center gap-2">
            <MailCheck className="text-primary size-5" aria-hidden="true" />
            <h2 className="text-fg text-base font-bold">
              {offers.length === 1 ? 'You have been selected' : 'You have selections'}
            </h2>
          </div>
          <p className="text-fg-muted text-sm">
            An employer selected you for a job. Answer below — the branch will take it from there.
          </p>
          {offers.map((offer) => (
            <div
              key={offer.jobId}
              className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div className="grid gap-0.5">
                <span className="text-fg font-semibold">{offer.jobTitle}</span>
                <span className="text-fg-subtle text-xs">
                  {offer.hiredAt ? `Selected ${formatDate(offer.hiredAt)}` : 'Selected recently'}
                  {offer.score != null ? ` · match ${offer.score}/100` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busyId !== null}
                  onClick={() => {
                    setDeclineReason('');
                    setDeclineNote('');
                    setModalError(null);
                    setDeclining(offer);
                  }}
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  disabled={busyId !== null}
                  loading={busyId === offer.jobId}
                  leftIcon={<Check className="size-4" />}
                  onClick={() => {
                    setModalError(null);
                    setAccepting(offer);
                  }}
                >
                  Accept offer
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── Notification feed ────────────────────────────────── */}
      <section
        className="rounded-2xl border"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="border-border flex items-center justify-between gap-3 border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-fg text-base font-bold">All updates</h2>
            {unread > 0 && (
              <Badge variant="soft" size="sm">
                {unread} new
              </Badge>
            )}
          </div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Bell}
              title="No updates yet"
              description="When an employer shortlists, hires or responds to you, it shows up here."
              compact
            />
          </div>
        ) : (
          <ul className="divide-border divide-y">
            {items.map((item) => {
              const isUnread = item.readAt === null;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => isUnread && markRead(item.id)}
                    className={`hover:bg-surface-muted flex w-full items-start gap-3 px-5 py-4 text-left transition-colors ${
                      isUnread ? 'bg-primary-soft/30' : ''
                    }`}
                  >
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${isUnread ? 'bg-primary' : 'bg-transparent'}`}
                      aria-hidden="true"
                    />
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-fg text-sm font-semibold">{item.title}</span>
                        <StatusPill
                          {...({
                            MATCH_HIRED: { label: 'Selected', tone: 'success' as const },
                            MATCH_REJECTED: { label: 'Not selected', tone: 'danger' as const },
                            MATCH_SHORTLISTED: { label: 'Shortlisted', tone: 'info' as const },
                            OFFER_ACCEPTED: { label: 'Accepted', tone: 'success' as const },
                            OFFER_DECLINED: { label: 'Declined', tone: 'warning' as const },
                            INTERVIEW_POSTPONED: { label: 'Postponed', tone: 'warning' as const },
                            INTERVIEW_CANCELLED: { label: 'Cancelled', tone: 'neutral' as const },
                            INTERVIEW_RESCHEDULED: { label: 'Rescheduled', tone: 'info' as const },
                            APPLICANT_REFERRED: { label: 'Referred', tone: 'success' as const },
                          }[item.type] ?? { label: item.type, tone: 'neutral' as const })}
                        />
                      </span>
                      {item.body && <span className="text-fg-muted text-sm">{item.body}</span>}
                      <span className="text-fg-subtle text-xs">{formatDate(item.createdAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Accept confirm ───────────────────────────────────── */}
      <Modal
        open={accepting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAccepting(null);
            setModalError(null);
          }
        }}
        title="Accept this offer?"
        description={accepting ? accepting.jobTitle : undefined}
        size="sm"
      >
        <div className="grid gap-4">
          <p className="text-fg-muted text-sm">
            The employer is notified right away, and your Job Bank branch will guide you through the
            next steps.
          </p>
          {modalError && (
            <p className="text-danger text-sm" role="alert">
              {modalError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAccepting(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busyId !== null}
              loading={busyId !== null && accepting !== null}
              onClick={() => accepting && respond(accepting, 'ACCEPTED')}
            >
              Accept offer
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Decline dialog ───────────────────────────────────── */}
      <Modal
        open={declining !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeclining(null);
            setModalError(null);
          }
        }}
        title="Decline this offer?"
        description={declining ? declining.jobTitle : undefined}
        size="sm"
      >
        <div className="grid gap-4">
          <p className="text-fg-muted text-sm">
            A short reason helps the employer and keeps the job open for other applicants.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="decline-reason">Reason</Label>
            <Select
              id="decline-reason"
              placeholder="Choose a reason…"
              value={declineReason}
              onChange={(e) => {
                setDeclineReason(e.target.value);
                setModalError(null);
              }}
              options={refusalReasons.map((r) => ({ value: r.code, label: r.label }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="decline-note">
              Note
              {refusalReasons.find((r) => r.code === declineReason)?.requiresNote
                ? ' (required)'
                : ' (optional)'}
            </Label>
            <Textarea
              id="decline-note"
              rows={3}
              maxLength={500}
              placeholder="Short context…"
              value={declineNote}
              onChange={(e) => {
                setDeclineNote(e.target.value);
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
                setDeclining(null);
                setModalError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busyId !== null}
              loading={busyId !== null && declining !== null}
              onClick={submitDecline}
              leftIcon={<X className="size-4" />}
            >
              Decline offer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
