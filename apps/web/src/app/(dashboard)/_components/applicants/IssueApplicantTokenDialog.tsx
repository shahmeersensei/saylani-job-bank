'use client';

import { issueApplicantTokenSchema, type ApplicantTokenView } from '@jobbank/shared';
import { Printer, Ticket, User } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useState, type FormEvent } from 'react';
import { Button, Input, Select, type SelectOption } from '@/components/atoms';
import { CNICInput, FormField, Modal, PhoneInput } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
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
 * Fresh number per visit (2026-11-17, user decision): every submit issues a
 * new token number, even if this CNIC already has a live token — the server
 * cancels the previous live token for this branch + CNIC in the same
 * transaction and reports its code, so the dialog can say the old token was
 * replaced. No duplicate check blocks issuing here.
 */
export function IssueApplicantTokenDialog({ branches, placement = 'default' }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0]!.value : '');
  const [cnic, setCnic] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState<ApplicantTokenView | null>(null);

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
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAlert(null);
    const parsed = issueApplicantTokenSchema.safeParse({ branchId, cnic, applicantName, phone });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      // N7: a fresh Idempotency-Key per issue, so a double-click or a retried
      // request replays the same issue instead of issuing twice.
      const { data } = await apiFetch<ApplicantTokenView>('/api/v1/applicants/tokens', {
        method: 'POST',
        body: parsed.data,
        idempotencyKey: crypto.randomUUID(),
      });
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
            {token.supersededTokenCodes && token.supersededTokenCodes.length > 0 && (
              <p
                role="status"
                className="bg-info-soft text-info-soft-fg rounded-lg px-4 py-3 text-sm"
              >
                Previous token {token.supersededTokenCodes.join(', ')} was replaced — only this new
                token is valid now.
              </p>
            )}
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
                disabled={loading}
              >
                {loading ? 'Issuing token…' : 'Generate token'}
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
