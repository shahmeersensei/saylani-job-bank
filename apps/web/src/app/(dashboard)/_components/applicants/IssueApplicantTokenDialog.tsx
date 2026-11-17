'use client';

import { issueApplicantTokenSchema, type ApplicantTokenView } from '@jobbank/shared';
import { AlertTriangle, Printer, Ticket, User } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useState, type FormEvent } from 'react';
import { Button, Input, Select, type SelectOption } from '@/components/atoms';
import { CNICInput, FormField, Modal, PhoneInput } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { formatDate, formatDateTime, formatTime } from '@/lib/format/date';
import { maskCnic } from '@/lib/format/cnic';
import { maskPkMobile } from '@/lib/format/phone';
import { errorMessage, toFieldErrors, zodFieldErrors, type FieldErrors } from './form';
import { ApplicantTokenSlip } from './ApplicantTokenSlip';

interface Props {
  branches: SelectOption[];
  placement?: 'default' | 'sidebar';
}

/**
 * Token-only first counter (2026-11-07 reversal): collect a CNIC, name and
 * phone number, issue the day's next token number for the branch, and print
 * the slip. The full registration happens at a later step — this dialog
 * deliberately collects nothing else.
 *
 * Duplicate guard (2026-11-17): before issuing, the dialog looks up a live
 * (ISSUED, unexpired) token for the same CNIC + branch. If one exists it is
 * shown in an amber warning panel — masked CNIC/phone, token number, date,
 * status, branch — with a View / Print action, and no second token is
 * issued. The POST is still the source of truth: if a second counter wins
 * the race in between, the server hands back the live token with 200 and
 * the same panel is shown. Completed / cancelled / expired tokens never
 * block a new issue.
 */
export function IssueApplicantTokenDialog({ branches, placement = 'default' }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0]!.value : '');
  const [cnic, setCnic] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState<ApplicantTokenView | null>(null);
  const [existingToken, setExistingToken] = useState<ApplicantTokenView | null>(null);

  /** A field's error clears as soon as the staff member starts fixing it. */
  const clearFieldError = (field: string) =>
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const resetForm = () => {
    setErrors({});
    setAlert(null);
    setExistingToken(null);
    setBranchId(branches.length === 1 ? branches[0]!.value : '');
    setCnic('');
    setApplicantName('');
    setPhone('');
  };

  const setDialogOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setToken(null);
      resetForm();
    } else {
      // N8: closing the dialog clears the token, so the print portal does not
      // stay mounted with a stale slip after the window is gone.
      setToken(null);
      setExistingToken(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAlert(null);
    setExistingToken(null);
    const parsed = issueApplicantTokenSchema.safeParse({ branchId, cnic, applicantName, phone });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    // Pre-issue duplicate check: same CNIC + branch, live token only.
    // A failed lookup never blocks issuing — the POST below re-checks on
    // the server and hands back the live token instead of duplicating it.
    setChecking(true);
    try {
      const params = new URLSearchParams({
        cnic: parsed.data.cnic,
        branchId: parsed.data.branchId,
      });
      const { data: found } = await apiFetch<ApplicantTokenView[]>(
        `/api/v1/applicants/tokens?${params.toString()}`,
      );
      const live = Array.isArray(found)
        ? found.find((candidate) => candidate.status === 'ISSUED' && !candidate.expired)
        : undefined;
      if (live) {
        setExistingToken(live);
        return;
      }
    } catch (error) {
      if (error instanceof ApiClientError && error.issues.length > 0) {
        setErrors(toFieldErrors(error.issues));
        return;
      }
    } finally {
      setChecking(false);
    }
    setLoading(true);
    try {
      // N7: a fresh Idempotency-Key per issue, so a double-click or a retried
      // request replays the same issue instead of issuing twice.
      const { data, status } = await apiFetch<ApplicantTokenView>('/api/v1/applicants/tokens', {
        method: 'POST',
        body: parsed.data,
        idempotencyKey: crypto.randomUUID(),
      });
      // 200 = the server handed back a live token issued earlier (a second
      // counter won the race after the lookup above): show it as the
      // existing token instead of a fresh slip. 201 = newly issued.
      if (status === 200) {
        setExistingToken(data);
        return;
      }
      setToken(data);
    } catch (error) {
      if (error instanceof ApiClientError && error.issues.length > 0) {
        setErrors(toFieldErrors(error.issues));
      } else {
        setErrors({});
        setAlert(errorMessage(error));
      }
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || checking;

  return (
    <>
      <Modal
        title="Issue token"
        description="Take the applicant's CNIC, name and phone number, issue today's next token, and print it."
        open={open}
        onOpenChange={setDialogOpen}
        size="lg"
        trigger={
          <Button
            fullWidth={placement === 'sidebar'}
            leftIcon={placement === 'sidebar' ? <Ticket aria-hidden="true" /> : undefined}
          >
            Issue token
          </Button>
        }
      >
        {token ? (
          <div className="grid gap-4">
            <ApplicantTokenSlip token={token} />
            <Button
              fullWidth
              leftIcon={<Printer aria-hidden="true" />}
              onClick={() => window.print()}
            >
              Print token
            </Button>
            <p className="text-fg-muted text-center text-sm">
              Close this window to issue the next token.
            </p>
          </div>
        ) : existingToken ? (
          <div className="grid gap-4">
            <div
              role="alert"
              className="bg-warning-soft text-warning-soft-fg flex gap-3 rounded-lg px-4 py-3"
            >
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="grid gap-1">
                <p className="font-semibold">An active token already exists</p>
                <p className="text-sm">
                  This applicant already has an active token. Please use the existing token instead
                  of generating another one.
                </p>
              </div>
            </div>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Token number</dt>
                <dd className="font-semibold">{existingToken.tokenCode}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Applicant</dt>
                <dd className="font-medium">{existingToken.applicantName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">CNIC</dt>
                <dd className="numeric">{maskCnic(existingToken.cnic)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Phone</dt>
                <dd className="numeric">{maskPkMobile(existingToken.phone)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Status</dt>
                <dd className="font-medium">{existingToken.status}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Generated</dt>
                <dd>
                  {formatDate(existingToken.issuedAt)} • {formatTime(existingToken.issuedAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Valid until</dt>
                <dd>{formatDateTime(existingToken.expiresAt)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Branch</dt>
                <dd>{existingToken.branchName}</dd>
              </div>
            </dl>
            <Button
              fullWidth
              leftIcon={<Printer aria-hidden="true" />}
              onClick={() => setToken(existingToken)}
            >
              View / Print existing token
            </Button>
            <Button
              fullWidth
              variant="secondary"
              onClick={() => {
                setExistingToken(null);
                setCnic('');
              }}
            >
              Use a different CNIC
            </Button>
          </div>
        ) : (
          <form className="grid gap-5" onSubmit={submit} noValidate>
            {alert && (
              <p
                role="alert"
                className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm"
              >
                {alert}
              </p>
            )}
            {branches.length > 1 && (
              <FormField label="Branch" required error={errors.branchId}>
                <Select
                  value={branchId}
                  onChange={(event) => {
                    setBranchId(event.target.value);
                    clearFieldError('branchId');
                  }}
                  placeholder="Choose a branch"
                  options={branches}
                />
              </FormField>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label="CNIC number"
                required
                error={errors.cnic}
                hint="13 digits, as on the CNIC"
              >
                <CNICInput
                  autoFocus
                  value={cnic}
                  onChange={(change) => {
                    setCnic(change.digits);
                    clearFieldError('cnic');
                  }}
                />
              </FormField>
              <FormField
                label="Phone number"
                required
                error={errors.phone}
                hint="Mobile number the applicant can be reached on"
              >
                <PhoneInput
                  aria-label="Phone number"
                  value={phone}
                  onChange={(value) => {
                    setPhone(value.e164 ?? value.national);
                    clearFieldError('phone');
                  }}
                />
              </FormField>
            </div>
            <FormField
              label="Applicant name"
              required
              error={errors.applicantName}
              hint="Full name, as on the CNIC"
            >
              <Input
                value={applicantName}
                onChange={(event) => {
                  setApplicantName(event.target.value);
                  clearFieldError('applicantName');
                }}
                placeholder="Full name"
                autoComplete="off"
                maxLength={100}
                startAdornment={<User aria-hidden="true" />}
              />
            </FormField>
            <div className="grid gap-2">
              <Button
                type="submit"
                fullWidth
                leftIcon={<Ticket aria-hidden="true" />}
                disabled={busy}
              >
                {checking
                  ? 'Checking for an existing token…'
                  : loading
                    ? 'Issuing token…'
                    : 'Generate token'}
              </Button>
              <p className="text-fg-muted text-center text-sm">
                The token prints with these details. The applicant is called by token number.
              </p>
            </div>
          </form>
        )}
      </Modal>
      {token
        ? createPortal(
            <div className="applicant-token-print-root">
              <ApplicantTokenSlip token={token} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
