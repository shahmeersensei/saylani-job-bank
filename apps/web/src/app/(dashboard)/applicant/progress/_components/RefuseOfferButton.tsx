'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Textarea } from '@/components/atoms';
import { FormField, Modal, toast } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';

interface Props {
  applicationId: string;
}

export function RefuseOfferButton({ applicationId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRefuse(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/refuse`, {
        method: 'POST',
        body: { reason: reason.trim(), note: note.trim() || undefined },
      });
      toast.success('Offer refused');
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to refuse offer');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Refuse this offer
      </Button>

      <Modal open={open} onOpenChange={setOpen} title="Refuse Job Offer">
        <form onSubmit={handleRefuse} className="grid gap-4">
          <p className="text-fg-muted text-sm">
            Please tell the employer why you are refusing this offer. They may respond with
            questions via chat.
          </p>
          <FormField label="Reason" required>
            <Textarea
              placeholder="e.g. Salary is too low, location not suitable…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
            />
          </FormField>
          <FormField label="Additional note (optional)">
            <Textarea
              placeholder="Any extra context…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={loading || !reason.trim()}>
              {loading ? 'Refusing…' : 'Refuse Offer'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
