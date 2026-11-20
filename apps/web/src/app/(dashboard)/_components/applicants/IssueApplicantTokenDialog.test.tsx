import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicantTokenView } from '@jobbank/shared';
import { IssueApplicantTokenDialog } from './IssueApplicantTokenDialog';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const branchId = '123e4567-e89b-12d3-a456-426614174000';

const token: ApplicantTokenView = {
  id: '00000000-0000-0000-0000-000000000001',
  tokenNumber: 1,
  tokenCode: 'KHI-GULSHAN-001',
  branchId,
  branchCode: 'KHI-GULSHAN',
  branchName: 'Karachi — Gulshan-e-Iqbal',
  cnic: '4210112345671',
  applicantName: 'Ahmed Raza',
  phone: '+923001234567',
  issuedAt: '2026-11-07T14:39:20.000Z',
  expiresAt: '2026-11-07T19:00:00.000Z',
  expired: false,
  status: 'ISSUED',
  applicantId: null,
  registrationReference: 'K7M2X9QP',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function open() {
  render(
    <IssueApplicantTokenDialog
      branches={[{ value: branchId, label: 'Karachi — Gulshan-e-Iqbal' }]}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Issue token' }));
  return screen.getByRole('dialog');
}

/** Every submit is a single POST: no lookup runs before issuing (2026-11-17). */
function mockPost(postStatus = 201, postBody: unknown = token) {
  fetchMock.mockResolvedValue(json(postStatus, { data: postBody }));
}

async function fillValid(cnic = '4210112345671', name = 'Ahmed Raza', phone = '3001234567') {
  if (cnic) await userEvent.type(screen.getByLabelText(/CNIC number/), cnic);
  if (name) await userEvent.type(screen.getByLabelText(/Applicant name/), name);
  if (phone) await userEvent.type(screen.getByLabelText('Phone number'), phone);
}

describe('IssueApplicantTokenDialog', () => {
  it('renders a wide dialog with CNIC and phone side by side', async () => {
    const dialog = await open();
    expect(dialog).toHaveClass('max-w-2xl');
    expect(dialog).not.toHaveClass('max-w-lg');
    // CNIC + Phone share one two-column row; Name sits full-width below.
    expect(dialog.querySelector('[class*="grid-cols-2"]')).not.toBeNull();
  });

  it('collects CNIC, name and phone, then shows only a Print button', async () => {
    mockPost();
    await open();

    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Generate token' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print token' })).toBeInTheDocument(),
    );
    // The slip renders twice: on screen in the dialog and in the print portal.
    expect(screen.getAllByText('01')).toHaveLength(2);
    expect(screen.getAllByText('+92 300 1234567')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Print token' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue another token' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST');
    const body = JSON.parse(postCall![1].body as string);
    expect(body).toMatchObject({
      branchId,
      cnic: '4210112345671',
      applicantName: 'Ahmed Raza',
      phone: '+923001234567',
    });
    // N7: the issue carries a fresh Idempotency-Key header.
    expect(postCall![1].headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('issues with a single POST and no lookup (fresh number per visit)', async () => {
    mockPost();
    await open();
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Generate token' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print token' })).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/applicants/tokens');
  });

  it('clears the slip when the dialog closes, so no stale slip stays mounted (N8)', async () => {
    mockPost();
    await open();

    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Generate token' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print token' })).toBeInTheDocument(),
    );

    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Print token' })).not.toBeInTheDocument(),
    );

    // Reopening shows the blank form, not the old slip.
    await userEvent.click(screen.getByRole('button', { name: 'Issue token' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate token' })).toBeInTheDocument(),
    );
    expect(screen.queryByText('01')).not.toBeInTheDocument();
  });

  it('shows a field error for an incomplete phone number, and never calls the API', async () => {
    await open();

    await fillValid('4210112345671', 'Ahmed Raza', '30012');
    await userEvent.click(screen.getByRole('button', { name: 'Generate token' }));

    await waitFor(() =>
      expect(screen.getByText('Phone number is incomplete.')).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the exact required / length errors for CNIC and name', async () => {
    await open();

    // Empty CNIC, numbers-only name, empty phone — nothing is submitted.
    await fillValid('', '12345', '');
    await userEvent.click(screen.getByRole('button', { name: 'Generate token' }));

    await waitFor(() => expect(screen.getByText('CNIC is required.')).toBeInTheDocument());
    expect(screen.getByText('Please enter a valid applicant name.')).toBeInTheDocument();
    expect(screen.getByText('Phone number is required.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the 13-digit error for a short CNIC and keeps the entered values', async () => {
    await open();

    await fillValid('42101', 'Ahmed Raza', '3001234567');
    await userEvent.click(screen.getByRole('button', { name: 'Generate token' }));

    await waitFor(() =>
      expect(screen.getByText('CNIC must contain exactly 13 digits.')).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/CNIC number/)).toHaveValue('42101');
    expect(screen.getByLabelText(/Applicant name/)).toHaveValue('Ahmed Raza');
  });

  it('issues a fresh token number on a repeat visit and notes the replaced token', async () => {
    const secondToken: ApplicantTokenView = {
      ...token,
      id: '00000000-0000-0000-0000-000000000002',
      tokenNumber: 2,
      tokenCode: 'KHI-GULSHAN-002',
      supersededTokenCodes: ['KHI-GULSHAN-001'],
    };
    mockPost(201, secondToken);
    await open();

    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Generate token' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print token' })).toBeInTheDocument(),
    );
    // The new number — 02, not the morning's 01 — on the fresh slip.
    expect(screen.getAllByText('02')).toHaveLength(2);
    expect(
      screen.getByText(
        'Previous token KHI-GULSHAN-001 was replaced — only this new token is valid now.',
      ),
    ).toBeInTheDocument();
    // One POST, no lookup: the repeat visit is issued, never blocked.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('disables Generate token while issuing, so repeated clicks cannot double-issue', async () => {
    let resolvePost!: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvePost = resolve;
        }),
    );
    await open();

    await fillValid();
    const generate = screen.getByRole('button', { name: 'Generate token' });
    await userEvent.click(generate);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Issuing token…' })).toBeDisabled(),
    );
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    resolvePost(json(201, { data: token }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print token' })).toBeInTheDocument(),
    );
  });
});
