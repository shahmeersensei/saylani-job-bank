'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  JOB_TYPES,
  JOB_TYPE_LABELS,
  SHIFT_TYPES,
  SHIFT_TYPE_LABELS,
  GENDER_PREFERENCES,
  GENDER_PREFERENCE_LABELS,
} from '@jobbank/shared';
import type { JobView } from '@/domains/job';
import { apiFetch } from '@/lib/api/client';
import { Button, Input, Select, Spinner, Textarea } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { MapPinPicker, type LatLng } from '@/components/organisms';
import { useRouter } from 'next/navigation';

interface Props {
  initialJob?: JobView | null;
}

interface CityOption {
  value: string;
  label: string;
}

interface ReverseResult {
  addressLine: string;
  cityCode: string | null;
  cityLabel: string | null;
}

const JOB_TYPE_OPTIONS = JOB_TYPES.map((v) => ({ value: v, label: JOB_TYPE_LABELS[v] }));
const SHIFT_OPTIONS = SHIFT_TYPES.map((v) => ({ value: v, label: SHIFT_TYPE_LABELS[v] }));
const GENDER_OPTIONS = GENDER_PREFERENCES.map((v) => ({
  value: v,
  label: GENDER_PREFERENCE_LABELS[v],
}));

export function JobWizard({ initialJob = null }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initialJob?.title ?? '');
  const [categoryCode, setCategoryCode] = useState(initialJob?.categoryCode ?? '');
  const [description, setDescription] = useState(initialJob?.description ?? '');
  const [jobType, setJobType] = useState<string>(initialJob?.jobType ?? 'FULL_TIME');
  const [shift, setShift] = useState<string>(initialJob?.shift ?? 'DAY');
  const [genderPreference, setGenderPreference] = useState<string>(
    initialJob?.genderPreference ?? 'ANY',
  );
  const [vacancies, setVacancies] = useState(String(initialJob?.vacancies ?? 1));
  const [salaryMin, setSalaryMin] = useState(
    initialJob?.salaryMin != null ? String(initialJob.salaryMin) : '',
  );
  const [salaryMax, setSalaryMax] = useState(
    initialJob?.salaryMax != null ? String(initialJob.salaryMax) : '',
  );

  // ── Location: pin on the map, address/city autofilled by reverse geocode ──
  const saved = initialJob?.locations[0] ?? null;
  const [pin, setPin] = useState<LatLng | null>(saved?.location ?? null);
  const [addressLine, setAddressLine] = useState(saved?.addressLine ?? '');
  const [cityCode, setCityCode] = useState(saved?.cityCode ?? '');
  const [cities, setCities] = useState<CityOption[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  /** True while the address text is machine-filled (so a new pin may replace it). */
  const autoFilled = useRef(!saved?.addressLine);

  const isNew = !initialJob;

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ code: string; label: string }[]>('/api/v1/master-data?type=CITY')
      .then(({ data }) => {
        if (!cancelled) setCities(data.map((c) => ({ value: c.code, label: c.label })));
      })
      .catch(() => {
        // City list is a nicety; the form still works with manual entry.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pin change → reverse geocode → autofill address + city (debounced).
  useEffect(() => {
    if (!pin || cities.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setGeocoding(true);
      try {
        const { data } = await apiFetch<ReverseResult>(
          `/api/v1/geocode/reverse?lat=${pin.lat}&lng=${pin.lng}`,
          { signal: controller.signal },
        );
        if (autoFilled.current || !addressLine) setAddressLine(data.addressLine || addressLine);
        if (data.cityCode) setCityCode(data.cityCode);
      } catch {
        // Offline or Nominatim down: keep whatever the employer typed.
      } finally {
        setGeocoding(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on pin/cities only; addressLine read at fire time
  }, [pin, cities]);

  function handleSubmit() {
    startTransition(async () => {
      setError(null);
      try {
        const body = {
          title: title.trim(),
          categoryCode: categoryCode.trim(),
          description: description.trim(),
          jobType,
          shift,
          genderPreference,
          vacancies: parseInt(vacancies, 10),
          salaryMin: salaryMin ? parseInt(salaryMin, 10) : undefined,
          salaryMax: salaryMax ? parseInt(salaryMax, 10) : undefined,
        };

        let jobId: string;
        if (isNew) {
          const { data: created } = await apiFetch<JobView>('/api/v1/jobs/me', {
            method: 'POST',
            body,
          });
          jobId = created.id;
        } else {
          const { data: updated } = await apiFetch<JobView>(`/api/v1/jobs/me/${initialJob.id}`, {
            method: 'PATCH',
            body,
          });
          jobId = updated.id;
        }

        if (pin && addressLine.trim().length >= 3 && cityCode) {
          await apiFetch<JobView>(`/api/v1/jobs/me/${jobId}/location`, {
            method: 'PUT',
            body: {
              location: pin,
              addressLine: addressLine.trim(),
              cityCode,
            },
          });
        }

        if (isNew) router.push(`/employer/jobs/${jobId}`);
        else router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      }
    });
  }

  const locationReady = pin && addressLine.trim().length >= 3 && cityCode;

  return (
    <div className="grid w-full gap-8">
      <header>
        <h1 className="text-fg text-2xl font-semibold">{isNew ? 'Post a new job' : 'Edit job'}</h1>
      </header>

      <div className="grid gap-5">
        <FormField label="Job title" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Senior Accountant"
          />
        </FormField>

        <FormField label="Category code" required>
          <Input
            value={categoryCode}
            onChange={(e) => setCategoryCode(e.target.value)}
            placeholder="e.g. ACCOUNTING"
          />
        </FormField>

        <FormField label="Description" required>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Describe the role, responsibilities, and what you are looking for..."
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Job type" required>
            <Select
              options={JOB_TYPE_OPTIONS}
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
            />
          </FormField>

          <FormField label="Shift" required>
            <Select
              options={SHIFT_OPTIONS}
              value={shift}
              onChange={(e) => setShift(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Gender preference">
            <Select
              options={GENDER_OPTIONS}
              value={genderPreference}
              onChange={(e) => setGenderPreference(e.target.value)}
            />
          </FormField>

          <FormField label="Vacancies" required>
            <Input
              type="number"
              min={1}
              value={vacancies}
              onChange={(e) => setVacancies(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Min salary (PKR/month)">
            <Input
              type="number"
              min={0}
              value={salaryMin}
              onChange={(e) => setSalaryMin(e.target.value)}
              placeholder="Optional"
            />
          </FormField>

          <FormField label="Max salary (PKR/month)">
            <Input
              type="number"
              min={0}
              value={salaryMax}
              onChange={(e) => setSalaryMax(e.target.value)}
              placeholder="Optional"
            />
          </FormField>
        </div>

        <div className="grid gap-4 border-t pt-6">
          <div>
            <h2 className="text-fg text-lg font-semibold">Work location</h2>
            <p className="text-fg-muted text-sm">
              Tap the job site on the map — we will fill in the address for you. Matching uses this
              pin to rank nearby applicants.
            </p>
          </div>

          <MapPinPicker value={pin} onChange={setPin} label="Job site location" height="18rem" />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Address"
              hint={
                geocoding ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner className="size-3" /> Looking up the address…
                  </span>
                ) : pin ? (
                  'Autofilled from the map — edit if needed.'
                ) : (
                  'Place the pin on the map first.'
                )
              }
              className="sm:col-span-2"
            >
              <Input
                value={addressLine}
                onChange={(e) => {
                  setAddressLine(e.target.value);
                  autoFilled.current = false;
                }}
                placeholder="House, street and block"
              />
            </FormField>

            <FormField
              label="City"
              hint={pin && !cityCode ? 'Could not match a city — pick it manually.' : undefined}
            >
              <Select
                placeholder={cities.length ? 'Choose the city' : 'Loading cities…'}
                value={cityCode}
                onChange={(e) => setCityCode(e.target.value)}
                options={cities}
              />
            </FormField>
          </div>

          {!locationReady && (
            <p className="text-fg-muted text-sm">
              The location is saved once you place a pin, fill the address (3+ characters) and pick
              a city — required before publishing.
            </p>
          )}
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pending || !title.trim() || !categoryCode.trim() || !description.trim()}
          >
            {pending ? 'Saving…' : isNew ? 'Create draft' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
