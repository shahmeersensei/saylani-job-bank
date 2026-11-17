'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/atoms';
import { FormField, GeocodeAddressPicker, toast } from '@/components/molecules';
import type { BranchView } from '@/domains/branch';
import { ApiClientError, apiFetch, friendlyApiError } from '@/lib/api/client';

interface Props {
  branch?: BranchView;
}

/** Create (no `branch`) or edit a branch. The code is editable by Super Admin only (this form lives on Super Admin pages); changing it breaks token slips issued under the old code. */
export function BranchForm({ branch }: Props) {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [values, setValues] = useState({
    code: branch?.code ?? '',
    name: branch?.name ?? '',
    city: branch?.city ?? '',
    address: branch?.address ?? '',
    phone: branch?.phone ?? '',
  });
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    branch?.location ?? null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!location) {
      setErrors({ location: 'Search for the branch address and pick a match from the list' });
      return;
    }
    setPending(true);
    setErrors({});
    const body = {
      ...(branch
        ? values.code !== branch.code
          ? { code: values.code }
          : {}
        : { code: values.code }),
      name: values.name,
      city: values.city,
      address: values.address || null,
      phone: values.phone || null,
      location,
    };
    try {
      const { data } = branch
        ? await apiFetch<BranchView>(`/api/v1/branches/${branch.id}`, { method: 'PATCH', body })
        : await apiFetch<BranchView>('/api/v1/branches', {
            method: 'POST',
            body,
            idempotencyKey: idempotencyKey.current,
          });
      toast.success(branch ? 'Branch updated' : `Branch ${data.code} created`);
      if (branch) {
        // Same page: refresh the data and keep the form usable for further edits.
        setPending(false);
        router.refresh();
      } else {
        router.push(`/super-admin/branches/${data.id}`);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
        if (!err.issues.length) toast.error(friendlyApiError(err));
      } else toast.error('Could not save the branch');
      setPending(false);
    }
  };

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Branch code"
          required
          hint={
            branch
              ? 'Changing the code breaks token slips issued under the old code.'
              : 'e.g. KHI-GULSHAN — used in candidate codes.'
          }
          error={errors.code}
        >
          <Input
            value={values.code}
            onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
            className="font-mono uppercase"
          />
        </FormField>
        <FormField label="Name" required error={errors.name}>
          <Input value={values.name} onChange={set('name')} />
        </FormField>
        <FormField label="City" required error={errors.city}>
          <Input value={values.city} onChange={set('city')} />
        </FormField>
        <FormField label="Phone" error={errors.phone}>
          <Input type="tel" value={values.phone} onChange={set('phone')} />
        </FormField>
        <FormField label="Address" error={errors.address} className="sm:col-span-2">
          <Input value={values.address} onChange={set('address')} />
        </FormField>
      </div>
      <GeocodeAddressPicker
        value={location}
        onChange={setLocation}
        onPick={(result) => {
          // The branch address and city are free text: fill them from the
          // picked place only when they are still empty, and never with a
          // non-Latin city label (search results sometimes come back in Urdu).
          if (result.addressLine && !values.address) {
            setValues((v) => ({ ...v, address: result.addressLine }));
          }
          if (result.cityLabel && !values.city && /^[A-Za-z .'-]+$/.test(result.cityLabel)) {
            setValues((v) => ({ ...v, city: result.cityLabel! }));
          }
        }}
        label="Location"
        hint="Used to suggest the nearest branch to applicants."
        initialQuery={branch?.address ?? ''}
        required
        error={errors.location}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {branch ? 'Save changes' : 'Create branch'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
