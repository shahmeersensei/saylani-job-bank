'use client';

import { Phone } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Select, Textarea } from '@/components/atoms';
import { EmptyState, FormField, Modal, toast } from '@/components/molecules';
import { apiFetch, friendlyApiError } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';
import { formatPkMobileDisplay } from '@/lib/format/phone';
import type { CallListItem } from '@/domains/placement';

const message = (err: unknown) => friendlyApiError(err);

/** Staff must have spoken to the candidate before recording their answer. */
function OfferAnswer({
  item,
  refusalReasons,
}: {
  item: CallListItem;
  refusalReasons: { code: string; label: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'accept' | 'refuse' | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const accepted = mode === 'accept';
      const label = refusalReasons.find((r) => r.code === reason)?.label ?? reason;
      if (item.matchOffer) {
        await apiFetch(`/api/v1/offers/${item.jobId}/response`, {
          method: 'POST',
          onBehalfOf: item.applicantId,
          body: accepted
            ? { applicantResponse: 'ACCEPTED' }
            : { applicantResponse: 'DECLINED', reasonCode: reason, note: note.trim() || undefined },
        });
      } else if (accepted) {
        await apiFetch(`/api/v1/applications/${item.applicationId}/accept`, {
          method: 'POST',
          onBehalfOf: item.applicantId,
        });
      } else {
        await apiFetch(`/api/v1/applications/${item.applicationId}/refuse`, {
          method: 'POST',
          onBehalfOf: item.applicantId,
          body: { reason: label, note: note.trim() || undefined },
        });
      }
      toast.success(accepted ? 'Offer accepted' : 'Offer refused');
      setMode(null);
      router.refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setMode('accept')}>
        Candidate accepts
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setMode('refuse')}>
        Candidate refuses
      </Button>
      <Modal
        open={mode !== null}
        onOpenChange={(open) => !open && setMode(null)}
        title={mode === 'accept' ? 'Record acceptance' : 'Record refusal'}
      >
        <div className="grid gap-4">
          <p className="text-fg-muted text-sm">
            {mode === 'accept'
              ? `Only continue if ${item.fullName} told you this themselves, in person or by phone. The employer will then see their name and phone number.`
              : `Only continue if ${item.fullName} told you this themselves, in person or by phone.`}
          </p>
          {mode === 'refuse' && (
            <>
              <FormField label="Reason" required>
                <Select
                  placeholder="Choose a reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  options={refusalReasons.map((r) => ({ value: r.code, label: r.label }))}
                />
              </FormField>
              <FormField label="Note">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={mode === 'refuse' && !reason}
              onClick={() => void save()}
            >
              Save answer
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function MarkCalled({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await apiFetch(`/api/v1/applications/${applicationId}/called`, { method: 'POST' });
          router.refresh();
        } catch (err) {
          toast.error(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      Candidate told
    </Button>
  );
}

export function CallList({
  items,
  basePath,
  refusalReasons,
}: {
  items: CallListItem[];
  basePath: string;
  refusalReasons: { code: string; label: string }[];
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Phone}
        title="Nobody to call"
        description="New items appear here when something changes for a counter candidate."
      />
    );
  }
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li key={item.key} className="border-border bg-surface grid gap-3 rounded-xl border p-4">
          <div className="grid gap-1">
            <NextLink
              href={`${basePath}/applicants/${item.applicantId}`}
              className="text-fg font-semibold underline-offset-4 hover:underline"
            >
              {item.fullName}
            </NextLink>
            {item.phone ? (
              <a
                href={`tel:${item.phone}`}
                className="text-accent numeric flex w-fit items-center gap-1.5 py-1 text-sm font-medium"
              >
                <Phone className="size-4" aria-hidden="true" />
                {formatPkMobileDisplay(item.phone)}
              </a>
            ) : (
              <p className="text-fg-muted text-sm">No phone: tell them when they check in.</p>
            )}
          </div>
          <div className="grid gap-0.5 text-sm">
            <p className="text-fg font-medium">{item.jobTitle}</p>
            <p className="text-fg-muted">{item.message}</p>
            {item.interviewAt && (
              <p className="text-fg-muted">
                {formatDateTime(item.interviewAt)}
                {item.interviewLocation ? ` · ${item.interviewLocation}` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {item.isOffer ? (
              <OfferAnswer item={item} refusalReasons={refusalReasons} />
            ) : (
              item.applicationId && <MarkCalled applicationId={item.applicationId} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
