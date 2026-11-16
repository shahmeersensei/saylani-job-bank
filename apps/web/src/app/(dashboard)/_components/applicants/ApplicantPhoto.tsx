'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/atoms';
import { toast } from '@/components/molecules';
import type { ApplicantDocumentView, DocumentLink, PresignedDocument } from '@/domains/applicant';
import { apiFetch } from '@/lib/api/client';
import { putWithProgress } from '@/lib/upload/put-with-progress';
import { errorMessage } from './form';
import { openDocument } from './open-document';
import { PHOTO_MAX_BYTES } from './PhotoCapture';

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

/**
 * The applicant's passport photo on the profile page.
 *
 * The profile page never showed a photo at all — the PHOTO document only
 * surfaced as a row in the Documents list (or on the printed form). This
 * renders it beside the identity details instead, fetching the same
 * short-lived view link the Documents list opens (viewing it is audited
 * the same way). When no PHOTO is on file, staff who can manage the
 * profile can add one here with the same presign → upload → confirm
 * pipeline the registration form uses; uploading over an existing photo
 * supersedes it, so this is also the replace path.
 */
export function ApplicantPhoto({
  applicantId,
  photo,
  canManage,
}: {
  applicantId: string;
  /** The current PHOTO document, if one is on file. */
  photo: ApplicantDocumentView | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) {
      setSrc(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    let active = true;
    setSrc(null);
    setLoading(true);
    setFailed(false);
    apiFetch<DocumentLink>(`/api/v1/applicants/${applicantId}/documents/${photo.id}/url`)
      .then(({ data }) => {
        if (active) {
          setSrc(data.url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [applicantId, photo]);

  const upload = async (file: File) => {
    if (!(PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error('Choose a JPG or PNG photo.');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error('The photo must be 2 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const { data: presigned } = await apiFetch<PresignedDocument>(
        `/api/v1/applicants/${applicantId}/documents`,
        {
          method: 'POST',
          body: {
            typeCode: 'PHOTO',
            fileName: contentType === 'image/png' ? 'passport-photo.png' : 'passport-photo.jpg',
            contentType,
            sizeBytes: file.size,
          },
        },
      );
      await putWithProgress({
        url: presigned.upload.url,
        file,
        headers: presigned.upload.headers,
      });
      await apiFetch(
        `/api/v1/applicants/${applicantId}/documents/${presigned.documentId}/confirm`,
        { method: 'POST' },
      );
      toast.success(photo ? 'Photo replaced' : 'Photo saved');
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="grid shrink-0 content-start justify-items-center gap-2">
      {src && !failed ? (
        <button
          type="button"
          onClick={() =>
            openDocument(`/api/v1/applicants/${applicantId}/documents/${photo!.id}/url`)
          }
          className="focus-visible:focus-ring rounded-lg"
          aria-label="Open applicant photo"
          title="Open full photo"
        >
          {/* Plain img: the signed view link is remote, and the print form
              already embeds the same photo — no optimizer round-trip. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Applicant photo"
            width={112}
            height={144}
            onError={() => setFailed(true)}
            className="border-border h-36 w-28 rounded-lg border object-cover"
          />
        </button>
      ) : (
        <div
          className="border-border bg-surface-muted text-fg-muted flex h-36 w-28 items-center justify-center rounded-lg border p-2 text-center text-xs"
          role="img"
          aria-label="No applicant photo on file"
        >
          {loading ? 'Loading photo…' : failed ? 'Photo could not be loaded' : 'No photo on file'}
        </div>
      )}
      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="sr-only"
            aria-label={photo ? 'Replace applicant photo' : 'Upload applicant photo'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {photo ? 'Replace photo' : 'Upload photo'}
          </Button>
        </>
      )}
    </div>
  );
}
