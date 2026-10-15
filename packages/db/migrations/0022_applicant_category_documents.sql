-- Category-specific applicant documents and healthcare alternatives.
UPDATE master_data
SET meta = jsonb_set(meta, '{requiredForCategories}', '["DRIVING_DELIVERY"]'::jsonb, true)
WHERE type = 'DOCUMENT_TYPE' AND code = 'DRIVING_LICENSE';
--> statement-breakpoint
UPDATE master_data
SET meta = jsonb_set(
  meta,
  '{requiredAlternativeForCategories}',
  '["HEALTHCARE"]'::jsonb,
  true
)
WHERE type = 'DOCUMENT_TYPE' AND code = 'EDUCATION_CERTIFICATE';
--> statement-breakpoint
INSERT INTO master_data (type, code, label, meta, sort_order)
VALUES (
  'DOCUMENT_TYPE',
  'HEALTHCARE_LICENSE',
  'Professional licence / registration',
  '{
    "appliesTo": "APPLICANT",
    "required": false,
    "requiredForCategories": [],
    "requiredAlternativeForCategories": ["HEALTHCARE"],
    "mimeTypes": ["application/pdf", "image/jpeg", "image/png"],
    "maxSizeMb": 5,
    "multiple": true
  }'::jsonb,
  75
)
ON CONFLICT (type, code) DO UPDATE
SET meta = jsonb_set(
  master_data.meta,
  '{requiredAlternativeForCategories}',
  '["HEALTHCARE"]'::jsonb,
  true
);
