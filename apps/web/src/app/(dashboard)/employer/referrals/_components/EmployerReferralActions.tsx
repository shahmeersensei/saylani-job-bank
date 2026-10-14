'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { FormField, Modal, toast } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import type { ApplicationView } from '@/domains/placement';

interface Props {
  applicationId: string;
  status: ApplicationView['status'];
  employerInterviewAt: string | null;
  employerInterviewLocation: string | null;
  companyName: string;
  jobTitle: string;
}

export function EmployerReferralActions({
  applicationId,
  status,
  employerInterviewAt,
  employerInterviewLocation,
  companyName,
  jobTitle,
}: Props) {
  const router = useRouter();

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<'HOLD' | 'ACCEPTED' | 'REJECTED' | null>(
    null,
  );

  const [interviewAt, setInterviewAt] = useState(
    employerInterviewAt ? new Date(employerInterviewAt).toISOString().slice(0, 16) : '',
  );
  const [location, setLocation] = useState(employerInterviewLocation ?? '');
  const [note, setNote] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [updateStatus, setUpdateStatus] = useState<string>('EMPLOYER_INTERVIEW_SCHEDULED');
  const [loading, setLoading] = useState(false);

  async function handleSchedule(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/employer-interview`, {
        method: 'POST',
        body: {
          interviewAt: new Date(interviewAt).toISOString(),
          interviewLocation: location || undefined,
          interviewNote: note || undefined,
        },
      });
      toast.success('Interview scheduled');
      setScheduleOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to schedule interview');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateStatus(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/employer-interview`, {
        method: 'PATCH',
        body: {
          status: updateStatus,
          ...(updateStatus === 'EMPLOYER_INTERVIEW_SCHEDULED' && interviewAt
            ? { interviewAt: new Date(interviewAt).toISOString() }
            : {}),
          interviewLocation: location || undefined,
          interviewNote: note || undefined,
        },
      });
      toast.success('Interview status updated');
      setUpdateOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to update interview');
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(decision: 'HOLD' | 'ACCEPTED' | 'REJECTED') {
    setLoading(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/employer-decision`, {
        method: 'POST',
        body: { decision, note: decisionNote || undefined },
      });
      const labels = {
        HOLD: 'On hold',
        ACCEPTED: 'Offer extended',
        REJECTED: 'Applicant not selected',
      };
      toast.success(labels[decision]);
      setDecisionOpen(false);
      setPendingDecision(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to record decision');
    } finally {
      setLoading(false);
    }
  }

  const canSchedule =
    status === 'FORWARDED' ||
    status === 'EMPLOYER_INTERVIEW_POSTPONED' ||
    status === 'EMPLOYER_INTERVIEW_CANCELLED';

  const canUpdateInterview =
    status === 'EMPLOYER_INTERVIEW_SCHEDULED' ||
    status === 'EMPLOYER_INTERVIEW_POSTPONED' ||
    status === 'EMPLOYER_INTERVIEW_CANCELLED';

  const canDecide = status === 'EMPLOYER_INTERVIEW_SCHEDULED' || status === 'ON_HOLD';

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canSchedule && (
          <Button size="sm" onClick={() => setScheduleOpen(true)}>
            Schedule Interview
          </Button>
        )}
        {canUpdateInterview && (
          <Button size="sm" variant="secondary" onClick={() => setUpdateOpen(true)}>
            Update Interview
          </Button>
        )}
        {canDecide && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPendingDecision('HOLD');
                setDecisionOpen(true);
              }}
            >
              Put on Hold
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setPendingDecision('ACCEPTED');
                setDecisionOpen(true);
              }}
            >
              Extend Offer
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setPendingDecision('REJECTED');
                setDecisionOpen(true);
              }}
            >
              Not Selected
            </Button>
          </>
        )}
      </div>

      {/* Schedule Interview Modal */}
      <Modal open={scheduleOpen} onOpenChange={setScheduleOpen} title="Schedule Interview">
        <form onSubmit={handleSchedule} className="grid gap-4">
          <FormField label="Interview date & time" required>
            <Input
              type="datetime-local"
              value={interviewAt}
              onChange={(e) => setInterviewAt(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Location">
            <Input
              placeholder="e.g. Office, Google Meet link"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </FormField>
          <FormField label="Note for candidate">
            <Textarea
              placeholder="Any instructions for the candidate…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Scheduling…' : 'Schedule'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Update Interview Status Modal */}
      <Modal open={updateOpen} onOpenChange={setUpdateOpen} title="Update Interview">
        <form onSubmit={handleUpdateStatus} className="grid gap-4">
          <FormField label="New status" required>
            <Select value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value)}>
              <option value="EMPLOYER_INTERVIEW_SCHEDULED">Scheduled</option>
              <option value="EMPLOYER_INTERVIEW_POSTPONED">Postponed</option>
              <option value="EMPLOYER_INTERVIEW_CANCELLED">Cancelled</option>
            </Select>
          </FormField>
          {updateStatus === 'EMPLOYER_INTERVIEW_SCHEDULED' && (
            <>
              <FormField label="Interview date & time">
                <Input
                  type="datetime-local"
                  value={interviewAt}
                  onChange={(e) => setInterviewAt(e.target.value)}
                />
              </FormField>
              <FormField label="Location">
                <Input
                  placeholder="e.g. Office, Google Meet link"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </FormField>
            </>
          )}
          <FormField label="Note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setUpdateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Decision Modal */}
      <Modal
        open={decisionOpen}
        onOpenChange={(open) => {
          setDecisionOpen(open);
          if (!open) setPendingDecision(null);
        }}
        title={
          pendingDecision === 'ACCEPTED'
            ? 'Extend Job Offer'
            : pendingDecision === 'REJECTED'
              ? 'Mark as Not Selected'
              : 'Put Application on Hold'
        }
      >
        <div className="grid gap-4">
          <p className="text-fg-muted text-sm">
            {pendingDecision === 'ACCEPTED'
              ? `This will send a job offer notification to the applicant for ${jobTitle} at ${companyName}.`
              : pendingDecision === 'REJECTED'
                ? 'The applicant will be notified that they were not selected.'
                : 'The applicant will be notified that their application is on hold.'}
          </p>
          <FormField label="Note (optional)">
            <Textarea
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              rows={3}
              placeholder="Any additional context…"
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDecisionOpen(false);
                setPendingDecision(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={loading || !pendingDecision}
              onClick={() => pendingDecision && handleDecision(pendingDecision)}
              variant={pendingDecision === 'REJECTED' ? 'danger' : 'primary'}
            >
              {loading ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
