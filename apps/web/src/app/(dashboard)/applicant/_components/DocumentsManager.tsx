'use client';

import { Lock } from 'lucide-react';
import { missingApplicantDocumentRequirements } from '@jobbank/shared';
import { Badge } from '@/components/atoms';
import { FileUploader, toast, type UploadFn } from '@/components/molecules';
import { DocumentList } from '@/components/organisms';
import type {
  ApplicantDocumentType,
  ApplicantProfile,
  PresignedDocument,
} from '@/domains/applicant';
import { apiFetch } from '@/lib/api/client';
import { putWithProgress } from '@/lib/upload/put-with-progress';
import { DOCUMENT_STATUS_PILL } from '../../_components/applicants/labels';
import { errorMessage } from '../../_components/applicants/form';
import { openDocument } from '../../_components/applicants/open-document';

const IDENTITY_TYPES = new Set(['CNIC_FRONT', 'CNIC_BACK']);
const FORMAT_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
};

/**
 * Upload area per document type. Files go straight to storage with a presigned URL, then the
 * server confirms what actually arrived. Used by the wizard's last step and the Documents page.
 */
export function DocumentsManager({
  profile,
  types,
  onProfile,
}: {
  profile: ApplicantProfile;
  types: ApplicantDocumentType[];
  onProfile: (profile: ApplicantProfile) => void;
}) {
  const applicantCategories = new Set(profile.preferences?.categoryCodes ?? []);
  const requirements = types.map((type) => ({ code: type.code, ...type.meta }));
  const presentTypes = new Set(profile.documents.map((document) => document.typeCode));
  const missingCount = missingApplicantDocumentRequirements(
    requirements,
    applicantCategories,
    presentTypes,
  );
  const hasAlternativeUpload = (category: string) =>
    types.some(
      (type) =>
        type.meta.requiredAlternativeForCategories.includes(category) &&
        presentTypes.has(type.code),
    );
  const directlyRequiredFor = (type: ApplicantDocumentType) =>
    type.meta.required ||
    type.meta.requiredForCategories.some((category) => applicantCategories.has(category));
  const alternativelyRequiredFor = (type: ApplicantDocumentType) =>
    type.meta.requiredAlternativeForCategories.filter((category) =>
      applicantCategories.has(category),
    );

  const uploadFor =
    (type: ApplicantDocumentType): UploadFn =>
    async (file, { onProgress, signal }) => {
      const { data: presigned } = await apiFetch<PresignedDocument>(
        '/api/v1/applicants/me/documents',
        {
          method: 'POST',
          body: {
            typeCode: type.code,
            fileName: file.name,
            contentType: file.type,
            sizeBytes: file.size,
          },
          signal,
        },
      );
      await putWithProgress({
        url: presigned.upload.url,
        file,
        headers: presigned.upload.headers,
        onProgress,
        signal,
      });
      const { data } = await apiFetch<ApplicantProfile>(
        `/api/v1/applicants/me/documents/${presigned.documentId}/confirm`,
        { method: 'POST' },
      );
      toast.success(`${type.label} uploaded`);
      onProfile(data);
      return { key: presigned.documentId };
    };

  const remove = async (id: string, label: string) => {
    try {
      const { data } = await apiFetch<ApplicantProfile>(`/api/v1/applicants/me/documents/${id}`, {
        method: 'DELETE',
      });
      toast.success(`${label} removed`);
      onProfile(data);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // Sort: globally required first, then category-required, then optional
  const ordered = [...types].sort((a, b) => {
    const aScore = directlyRequiredFor(a)
      ? a.meta.required
        ? 3
        : 2
      : alternativelyRequiredFor(a).length
        ? 1
        : 0;
    const bScore = directlyRequiredFor(b)
      ? b.meta.required
        ? 3
        : 2
      : alternativelyRequiredFor(b).length
        ? 1
        : 0;
    return bScore - aScore;
  });

  return (
    <div className="grid gap-4">
      {ordered.map((type) => {
        const current = profile.documents.filter((d) => d.typeCode === type.code);
        const locked = profile.identityLocked && IDENTITY_TYPES.has(type.code);
        const formats = type.meta.mimeTypes.map((m) => FORMAT_LABELS[m] ?? m).join(', ');
        const directRequirement = directlyRequiredFor(type);
        const alternativeCategories = alternativelyRequiredFor(type);
        const alternativeMissing = alternativeCategories.some(
          (category) => !hasAlternativeUpload(category),
        );
        const missing =
          (directRequirement && current.length === 0) ||
          (!directRequirement && alternativeMissing && current.length === 0);

        // Build a readable label for why it's required
        const requiredReason =
          !type.meta.required && type.meta.requiredForCategories.length > 0
            ? `Required for your selected job category`
            : alternativeCategories.length > 0
              ? `For your selected job category, upload one: ${[
                  type.label,
                  ...types
                    .filter(
                      (option) =>
                        option.code !== type.code &&
                        alternativeCategories.some((category) =>
                          option.meta.requiredAlternativeForCategories.includes(category),
                        ),
                    )
                    .map((option) => option.label),
                ]
                  .filter((label, index, labels) => labels.indexOf(label) === index)
                  .join(' or ')}.`
              : null;

        return (
          <section
            key={type.code}
            aria-labelledby={`doc-${type.code}`}
            className="border-border grid gap-3 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`doc-${type.code}`} className="text-fg text-sm font-semibold">
                {type.label}
              </h3>
              {directRequirement ? (
                <Badge tone={missing ? 'warning' : 'success'} size="sm">
                  {missing ? 'Required' : 'Done'}
                </Badge>
              ) : alternativeCategories.length > 0 ? (
                <Badge
                  tone={missing ? 'warning' : current.length > 0 ? 'success' : 'neutral'}
                  size="sm"
                  variant={missing || current.length > 0 ? undefined : 'outline'}
                >
                  {missing ? 'Upload one option' : current.length > 0 ? 'Uploaded' : 'Alternative'}
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm" variant="outline">
                  Optional
                </Badge>
              )}
            </div>

            {/* Explain category-conditional requirement */}
            {requiredReason && <p className="text-fg-muted text-xs">{requiredReason}</p>}

            <DocumentList
              label={`${type.label} uploads`}
              items={current.map((d) => ({
                id: d.id,
                title: type.label,
                fileName: d.fileName,
                sizeBytes: d.sizeBytes,
                contentType: d.contentType,
                uploadedAt: d.uploadedAt,
                status: DOCUMENT_STATUS_PILL[d.status],
                note: d.reviewNote,
                removable:
                  !locked &&
                  missingApplicantDocumentRequirements(
                    requirements,
                    applicantCategories,
                    new Set(
                      profile.documents
                        .filter((document) => document.id !== d.id)
                        .map((document) => document.typeCode),
                    ),
                  ) <= missingCount,
              }))}
              onView={(item) => openDocument(`/api/v1/applicants/me/documents/${item.id}/url`)}
              onRemove={(item) => remove(item.id, type.label)}
            />
            {locked ? (
              <p className="text-fg-muted flex items-center gap-2 text-sm">
                <Lock className="size-4" aria-hidden="true" /> Checked by Job Bank staff — locked.
              </p>
            ) : (
              <FileUploader
                // Remount after each saved upload so the new file shows once, in the list above.
                key={current.map((d) => d.id).join(',') || 'empty'}
                upload={uploadFor(type)}
                accept={type.meta.mimeTypes}
                maxSizeBytes={type.meta.maxSizeMb * 1024 * 1024}
                multiple={type.meta.multiple}
                maxFiles={type.meta.multiple ? 5 : 1}
                label={current.length && !type.meta.multiple ? 'Replace file' : 'Choose a file'}
                hint={`${formats}, up to ${type.meta.maxSizeMb} MB.`}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
