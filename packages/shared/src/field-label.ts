/**
 * Human label for a field path: "salaryMin" → "Salary min",
 * "items.0.skillCode" → "Skill code". The leaf is the field the person
 * can see; indexes are not part of the name.
 */
export function fieldLabel(path: string | readonly PropertyKey[]): string {
  const text = typeof path === 'string' ? path : Array.from(path, String).join('.');
  if (text === '' || text === '(root)' || text === 'root') return 'Form';
  const leaf = text.split('.').pop() ?? text;
  const words = leaf
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return 'Form';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** True when `message` already starts with the field's label, so the UI must not repeat it. */
export function messageNamesField(path: string | readonly PropertyKey[], message: string): boolean {
  const label = fieldLabel(path);
  return message.toLowerCase().startsWith(label.toLowerCase());
}
