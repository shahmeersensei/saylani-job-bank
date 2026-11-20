'use client';

import { tokenCodeFor, type ApplicantTokenView } from '@jobbank/shared';
import { Search, Ticket } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Input, Select, type SelectOption } from '@/components/atoms';
import { CNICInput, FormField } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';
import { errorMessage, toFieldErrors, type FieldErrors } from './form';
import { StaffRegisterApplicantForm } from './StaffRegisterApplicantForm';

interface Props {
  /** Branch code (`KHI-GULSHAN`) rides along so a bare number can be previewed as its full code. */
  branches: (SelectOption & { code: string })[];
  cities: SelectOption[];
  areas: SelectOption[];
  educationLevels: SelectOption[];
  skills: SelectOption[];
  languages: SelectOption[];
  categories: SelectOption[];
  basePath: string;
}

function formatIssuedAt(issuedAt: string) {
  return formatDateTime(issuedAt);
}

function tokenState(token: ApplicantTokenView) {
  if (token.status === 'COMPLETED') return 'Already registered';
  if (token.status === 'CANCELLED') return 'Cancelled';
  if (token.expired) return 'Expired — issue a new token at Counter 1';
  return 'Ready to register';
}

/**
 * Counter 2 (2026-11-13): the applicant shows the token from Counter 1,
 * staff enters its code (or the CNIC) to find it, checks the name and CNIC
 * against the person standing there, then opens the full registration form
 * prefilled from the token. Saving the form completes the token in the same
 * transaction, so a token is never left ISSUED for a registered applicant.
 */
export function TokenRegistrationFlow({
  branches,
  cities,
  areas,
  educationLevels,
  skills,
  languages,
  categories,
  basePath,
}: Props) {
  const [tokenCode, setTokenCode] = useState('');
  const [cnic, setCnic] = useState('');
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0]!.value : '');
  const [searching, setSearching] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [results, setResults] = useState<ApplicantTokenView[] | null>(null);
  const [selected, setSelected] = useState<ApplicantTokenView | null>(null);

  // Auto-detect (2026-11-17): staff type just the number (`007`) and the
  // branch fills the `KHI-GULSHAN-` prefix in — the full code is previewed
  // below the field, and the server resolves the number against that branch.
  const trimmedCode = tokenCode.trim().toUpperCase();
  const digitsOnly = /^\d+$/.test(trimmedCode);
  const detectedBranch = digitsOnly
    ? (branches.find((b) => b.value === branchId) ??
      (branches.length === 1 ? branches[0]! : undefined))
    : undefined;
  const detectedCode =
    digitsOnly && detectedBranch && Number(trimmedCode) >= 1 && Number(trimmedCode) <= 9999
      ? tokenCodeFor(detectedBranch.code, Number(trimmedCode))
      : null;
  const tokenHint = detectedCode
    ? `Auto-detected: ${detectedCode}`
    : digitsOnly && branches.length > 1 && !branchId
      ? 'Choose a branch below to match this number'
      : 'Just the number is enough, e.g. 001 — or the full code, e.g. KHI-GULSHAN-001';

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAlert(null);
    const code = tokenCode.trim().toUpperCase();
    const next: FieldErrors = {};
    if (!code && !cnic) next.tokenCode = 'Enter a token code or a CNIC number';
    if (code && /^\d+$/.test(code)) {
      const tokenNumber = Number(code);
      if (tokenNumber < 1 || tokenNumber > 9999) {
        next.tokenCode = 'Enter a token number from 1 to 9999';
      } else if (branches.length > 1 && !branchId) {
        next.branchId = 'Choose a branch — a number alone does not say which branch it is from';
      }
    }
    if (cnic && branches.length > 1 && !branchId) next.branchId = 'Choose a branch';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const params = new URLSearchParams();
    if (code) {
      params.set('tokenCode', code);
      // The branch rides along so the server can resolve a bare number.
      if (branchId) params.set('branchId', branchId);
    } else {
      params.set('cnic', cnic);
      params.set('branchId', branchId);
    }
    setSearching(true);
    try {
      const { data } = await apiFetch<ApplicantTokenView[]>(
        `/api/v1/applicants/tokens?${params.toString()}`,
      );
      setResults(data);
      setSelected(null);
      if (data.length === 0) {
        setAlert(
          'No token found. Check the code and try again — a token is valid until the end of the day it was issued.',
        );
      }
    } catch (error) {
      if (error instanceof ApiClientError && error.issues.length > 0) {
        setErrors(toFieldErrors(error.issues));
      } else {
        setErrors({});
        setAlert(errorMessage(error));
      }
    } finally {
      setSearching(false);
    }
  };

  if (selected) {
    return (
      <div className="grid gap-6">
        <section className="border-border bg-surface shadow-card grid gap-2 rounded-xl border p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-fg text-base font-semibold">
              Registering token {selected.tokenCode}
            </h2>
            <Button type="button" variant="secondary" onClick={() => setSelected(null)}>
              Use a different token
            </Button>
          </div>
          <p className="text-fg-muted text-sm">
            {selected.applicantName} · CNIC {selected.cnic} · {selected.branchName} · issued{' '}
            {formatIssuedAt(selected.issuedAt)} · valid until {formatDateTime(selected.expiresAt)}
          </p>
        </section>
        <StaffRegisterApplicantForm
          token={selected}
          branches={[{ value: selected.branchId, label: selected.branchName }]}
          cities={cities}
          areas={areas}
          educationLevels={educationLevels}
          skills={skills}
          languages={languages}
          categories={categories}
          basePath={basePath}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <form
        className="border-border bg-surface shadow-card grid gap-5 rounded-xl border p-5"
        onSubmit={search}
        noValidate
      >
        {alert && (
          <p
            role="alert"
            className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm"
          >
            {alert}
          </p>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Token code" error={errors.tokenCode} hint={tokenHint}>
            <Input
              value={tokenCode}
              onChange={(event) => setTokenCode(event.target.value)}
              placeholder="001"
              autoComplete="off"
              startAdornment={<Ticket aria-hidden="true" />}
            />
          </FormField>
          <FormField label="Or CNIC number" error={errors.cnic} hint="13 digits, as on the CNIC">
            <CNICInput value={cnic} onChange={(change) => setCnic(change.digits)} />
          </FormField>
        </div>
        {branches.length > 1 && (
          <FormField
            label="Branch"
            error={errors.branchId}
            hint="Needed when searching by CNIC, or by token number alone"
          >
            <Select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              placeholder="Choose a branch"
              options={branches}
            />
          </FormField>
        )}
        <div className="flex justify-end">
          <Button type="submit" leftIcon={<Search aria-hidden="true" />} disabled={searching}>
            {searching ? 'Finding token…' : 'Find token'}
          </Button>
        </div>
      </form>

      {results !== null && results.length > 0 && (
        <section className="grid gap-3" aria-label="Tokens found">
          {results.map((token) => {
            const usable = token.status === 'ISSUED' && !token.expired;
            return (
              <article
                key={token.id}
                className="border-border bg-surface shadow-card grid gap-3 rounded-xl border p-5 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="grid gap-1">
                  <h3 className="text-fg text-base font-semibold">{token.tokenCode}</h3>
                  <p className="text-fg-muted text-sm">
                    {token.applicantName} · CNIC {token.cnic} · {token.phone}
                  </p>
                  <p className="text-fg-muted text-sm">
                    {token.branchName} · issued {formatIssuedAt(token.issuedAt)} · valid until{' '}
                    {formatDateTime(token.expiresAt)}
                  </p>
                  <p className="text-fg-muted text-sm">{tokenState(token)}</p>
                </div>
                {usable ? (
                  <Button
                    type="button"
                    leftIcon={<Ticket aria-hidden="true" />}
                    onClick={() => setSelected(token)}
                  >
                    Open registration form
                  </Button>
                ) : (
                  <span className="text-fg-muted text-sm">
                    {token.status === 'COMPLETED'
                      ? 'The applicant is already registered.'
                      : token.status === 'CANCELLED'
                        ? 'This token was cancelled.'
                        : 'This token expired. Issue a new token at Counter 1.'}
                  </span>
                )}
              </article>
            );
          })}
          <p className="text-fg-muted text-sm">
            Token numbers repeat every day — check the name and CNIC against the applicant&apos;s
            CNIC card before opening the form.
          </p>
        </section>
      )}
    </div>
  );
}
