import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicantProfile } from '@/domains/applicant';
import { expectNoA11yViolations } from '@/test/a11y';
import { PersonalStep } from './PersonalStep';
import type { StepSave } from './step';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const lists = {
  educationLevels: [],
  skills: [],
  languages: [],
  cities: [],
  areas: [],
  categories: [],
};

function renderStep(profile: ApplicantProfile | null = null) {
  let save: StepSave | null = null;
  const utils = render(
    <PersonalStep profile={profile} lists={lists} bindSave={(fn) => (save = fn)} />,
  );
  return { ...utils, save: () => act(() => save!()) };
}

describe('PersonalStep', () => {
  it('validates before calling the API and shows each problem next to its field', async () => {
    const { save, container } = renderStep();
    expect(await save()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter your full name/)).toBeInTheDocument();
    expect(screen.getByText(/13-digit CNIC/)).toBeInTheDocument();
    expect(screen.getByText('Choose an option')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('registers with the CNIC digits and shows the recovery message for a taken CNIC', async () => {
    fetchMock.mockResolvedValue(
      json(409, {
        error: {
          code: 'CONFLICT',
          message:
            'This CNIC is already registered. To recover your account, please contact the Karachi branch.',
        },
      }),
    );
    const { save } = renderStep();
    await userEvent.type(screen.getByLabelText(/^Full name/), 'Ayesha Khan');
    await userEvent.type(screen.getByLabelText(/husband/), 'Imran Khan');
    await userEvent.type(screen.getByLabelText(/CNIC number/), '4210112345671');
    await userEvent.type(screen.getByLabelText(/Date of birth/), '12/04/1998');
    await userEvent.click(screen.getByRole('radio', { name: 'Female' }));

    expect(await save()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/applicants/register');
    expect(JSON.parse(init.body)).toMatchObject({ cnic: '4210112345671', gender: 'FEMALE' });
    expect(init.headers['idempotency-key']).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('contact the Karachi branch');
  });

  it('locks identity fields once verified, but still saves gender and email', async () => {
    const profile = {
      identityLocked: true,
      personal: {
        fullName: 'Ayesha Khan',
        fatherName: 'Imran Khan',
        cnic: '4210112345671',
        dateOfBirth: '1998-04-12',
        gender: 'FEMALE',
        email: null,
        phone: '+923001234567',
      },
    } as unknown as ApplicantProfile;
    fetchMock.mockResolvedValue(json(200, { data: profile }));
    const { save } = renderStep(profile);
    expect(screen.getByLabelText(/^Full name/)).toBeDisabled();
    expect(screen.getByLabelText(/CNIC number/)).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Email/), 'ayesha@example.com');

    expect(await save()).toEqual(profile);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/applicants/me');
    expect(JSON.parse(init.body)).toEqual({ gender: 'FEMALE', email: 'ayesha@example.com' });
  });
});
