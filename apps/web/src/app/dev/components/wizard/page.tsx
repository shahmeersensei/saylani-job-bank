'use client';

import { useState } from 'react';
import { Input, Select } from '@/components/atoms';
import {
  CNICInput,
  FileUploader,
  FormField,
  GeocodeAddressPicker,
  toast,
} from '@/components/molecules';
import { WizardLayout } from '@/components/templates';
import { fakeUpload } from '../_demo/data';

const steps = [
  { id: 'personal', label: 'Personal details', description: 'As written on your CNIC.' },
  {
    id: 'location',
    label: 'Home location',
    description: 'Used only to find jobs near you. Never shown to employers.',
  },
  { id: 'skills', label: 'Skills & preferences' },
  {
    id: 'documents',
    label: 'Documents',
    description: 'CNIC front and back, and your CV if you have one.',
  },
];

export default function WizardDemoPage() {
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  const next = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      if (current === steps.length - 1) toast.success('Profile submitted (demo)');
      else setCurrent((c) => c + 1);
    }, 500);
  };

  return (
    <div className="bg-bg page-gutter min-h-dvh py-8">
      <WizardLayout
        title="Create your profile"
        description="Takes about 5 minutes. You can save and finish later."
        steps={steps}
        current={current}
        onStepClick={setCurrent}
        onBack={() => setCurrent((c) => c - 1)}
        onNext={next}
        saving={saving}
        nextDisabled={current === 1 && !pin}
      >
        {current === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" required className="sm:col-span-2">
              <Input autoComplete="name" />
            </FormField>
            <FormField label="CNIC" required>
              <CNICInput />
            </FormField>
            <FormField label="Gender" required>
              <Select
                placeholder="Select"
                defaultValue=""
                options={[
                  { value: 'f', label: 'Female' },
                  { value: 'm', label: 'Male' },
                ]}
              />
            </FormField>
          </div>
        )}
        {current === 1 && <GeocodeAddressPicker value={pin} onChange={setPin} />}
        {current === 2 && (
          <FormField label="Main trade" required>
            <Select
              placeholder="Choose a trade"
              defaultValue=""
              options={[
                { value: 'electrician', label: 'Electrician' },
                { value: 'driver', label: 'Driver (LTV)' },
              ]}
            />
          </FormField>
        )}
        {current === 3 && (
          <FileUploader
            multiple
            maxFiles={3}
            accept={['application/pdf', 'image/*']}
            maxSizeBytes={5 * 1024 * 1024}
            label="Upload documents"
            hint="PDF or photo, up to 5 MB each."
            upload={fakeUpload}
          />
        )}
      </WizardLayout>
    </div>
  );
}
