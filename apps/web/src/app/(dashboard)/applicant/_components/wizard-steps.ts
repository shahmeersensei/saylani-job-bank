/** Wizard steps (plain module: the server page reads it to resolve ?step=). */
export const WIZARD_STEPS = [
  { id: 'personal', label: 'Personal details', description: 'As written on your CNIC.' },
  {
    id: 'location',
    label: 'Home & branch',
    description: 'Used only to find jobs near you. Employers never see your address or pin.',
  },
  {
    id: 'education',
    label: 'Education',
    description: 'Your schooling, plus any certificates or courses.',
  },
  { id: 'experience', label: 'Work experience' },
  { id: 'skills', label: 'Skills & languages' },
  {
    id: 'preferences',
    label: 'Job preferences',
    description: 'We use these to suggest jobs that suit you.',
  },
  {
    id: 'documents',
    label: 'Documents',
    description:
      'Clear photos of both sides of your CNIC are required. Additional documents (e.g. a driving licence) may be required depending on the type of work you are seeking.',
  },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];
