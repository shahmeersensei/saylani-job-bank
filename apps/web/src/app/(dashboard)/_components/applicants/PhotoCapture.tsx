'use client';

import { AlertTriangle, Camera, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/atoms';

export interface CapturedPhoto {
  /** JPEG blob, cropped to passport ratio (35:45) and capped at 2 MB. */
  blob: Blob;
  /** Object URL for the preview image; the owner revokes it when done. */
  previewUrl: string;
}

/** Passport-size photo: 35 × 45 mm, JPEG/PNG, max 2 MB (the PHOTO document type). */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

/**
 * Plain-language camera errors. The browser's own messages name error codes
 * nobody at a counter understands, so every failure maps to what happened and
 * what to do next.
 */
export function cameraErrorMessage(error: unknown): string {
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot access a camera. Upload a photo file instead, or continue without a photo.';
  }
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was denied. Allow camera access in the browser address bar, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Check that a webcam is connected, or upload a photo file instead.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another app or browser tab. Close it and try again.';
    case 'AbortError':
      return 'The camera could not be started. Try again.';
    default:
      return 'The camera could not be started. Try again, or upload a photo file instead.';
  }
}

type CameraState = 'idle' | 'starting' | 'live' | 'error';

interface Props {
  photo: CapturedPhoto | null;
  onPhotoChange: (photo: CapturedPhoto | null) => void;
  /** True once staff chose to continue without a photo after a camera failure. */
  skipped: boolean;
  onSkippedChange: (skipped: boolean) => void;
  /** Shown under the frame when Review is pressed with no photo and no skip. */
  validationError?: string | null;
  disabled?: boolean;
}

/**
 * Live photo capture for applicant registration. The passport-size frame sits
 * in the top-right of the Personal information section; the captured photo is
 * previewed before submit and held in memory until the applicant exists, when
 * the form uploads it as the PHOTO document. Nothing is saved from here.
 */
export function PhotoCapture({
  photo,
  onPhotoChange,
  skipped,
  onSkippedChange,
  validationError,
  disabled,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [camera, setCamera] = useState<CameraState>('idle');
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setVideoReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => stopCamera, []);

  /**
   * The <video> element only mounts once camera is 'live', so the stream
   * cannot be attached inside startCamera — at that point videoRef is still
   * null and the assignment is silently skipped, leaving a black preview
   * with videoWidth 0 ("preview is not ready"). Attach it here, once the
   * element exists.
   */
  useEffect(() => {
    if (camera !== 'live') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch((caught: unknown) => {
      stopCamera();
      setError(cameraErrorMessage(caught));
      setCamera('error');
    });
  }, [camera]);

  const cancelCamera = () => {
    stopCamera();
    setCamera('idle');
  };

  const startCamera = async () => {
    if (disabled) return;
    onSkippedChange(false);
    setError(null);
    setCamera('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Camera not supported', 'NotFoundError');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      // The <video> mounts from this state change; the effect above
      // attaches the stream once it exists.
      setVideoReady(false);
      setCamera('live');
    } catch (caught) {
      stopCamera();
      setError(cameraErrorMessage(caught));
      setCamera('error');
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.readyState < 2) {
      setError('The camera preview is not ready yet. Wait a moment and try again.');
      return;
    }
    // Crop the centre to passport ratio (35:45), max 700 × 900 px.
    const targetRatio = 35 / 45;
    const srcRatio = video.videoWidth / video.videoHeight;
    let sx = 0;
    let sy = 0;
    let sw = video.videoWidth;
    let sh = video.videoHeight;
    if (srcRatio > targetRatio) {
      sh = video.videoHeight;
      sw = sh * targetRatio;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sw = video.videoWidth;
      sh = sw / targetRatio;
      sy = (video.videoHeight - sh) / 2;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 700;
    canvas.height = 900;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('The photo could not be captured. Try again.');
      return;
    }
    context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) {
      setError('The photo could not be captured. Try again.');
      return;
    }
    stopCamera();
    setCamera('idle');
    onPhotoChange({ blob, previewUrl: URL.createObjectURL(blob) });
  };

  const removePhoto = () => {
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    onPhotoChange(null);
  };

  const retakePhoto = () => {
    removePhoto();
    void startCamera();
  };

  const uploadFile = (file: File) => {
    setError(null);
    if (!(PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError('Choose a JPG or PNG photo.');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError('The photo must be 2 MB or smaller.');
      return;
    }
    onSkippedChange(false);
    onPhotoChange({ blob: file, previewUrl: URL.createObjectURL(file) });
  };

  return (
    <div className="grid w-[148px] shrink-0 gap-2">
      <p className="text-fg text-sm font-medium">
        Applicant photo{' '}
        <span className="text-danger-soft-fg" aria-hidden="true">
          *
        </span>
      </p>
      <div className="border-border bg-surface relative aspect-[35/45] w-[148px] overflow-hidden rounded-lg border">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.previewUrl}
            alt="Captured applicant photo preview"
            className="size-full object-cover"
          />
        ) : camera === 'live' ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="Live camera preview"
              className="size-full object-cover"
              onLoadedMetadata={() => setVideoReady(true)}
              onCanPlay={() => setVideoReady(true)}
            />
            <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              ● LIVE
            </span>
            <span className="pointer-events-none absolute inset-x-6 top-4 bottom-10 rounded-[50%] border-2 border-dashed border-white/80" />
            {!videoReady && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 text-xs font-medium text-white">
                Starting preview…
              </span>
            )}
          </>
        ) : (
          <div className="text-fg-muted grid size-full place-items-center gap-1 p-3 text-center">
            <Camera className="size-6" aria-hidden="true" />
            <span className="text-xs">No photo yet</span>
            <span className="text-[11px]">35 × 45 mm</span>
          </div>
        )}
      </div>

      {photo ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            leftIcon={<RotateCcw />}
            onClick={retakePhoto}
            disabled={disabled}
          >
            Retake
          </Button>
          <Button
            type="button"
            variant="ghost"
            leftIcon={<Trash2 />}
            onClick={removePhoto}
            disabled={disabled}
          >
            Remove
          </Button>
        </div>
      ) : camera === 'live' ? (
        <div className="flex gap-2">
          <Button
            type="button"
            leftIcon={<Camera />}
            onClick={() => void capturePhoto()}
            disabled={disabled || !videoReady}
          >
            Capture photo
          </Button>
          <Button type="button" variant="ghost" onClick={cancelCamera} disabled={disabled}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          leftIcon={<Camera />}
          onClick={() => void startCamera()}
          disabled={disabled || camera === 'starting'}
        >
          {camera === 'starting' ? 'Starting camera…' : 'Start camera'}
        </Button>
      )}

      {!photo && camera !== 'live' && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            aria-label="Upload a photo file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadFile(file);
              event.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="ghost"
            leftIcon={<Upload />}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            Upload a photo instead
          </Button>
        </>
      )}

      {error && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-3 py-2 text-xs">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button
            type="button"
            className="mt-1.5 font-semibold underline"
            onClick={() => {
              setError(null);
              onSkippedChange(true);
            }}
            disabled={disabled}
          >
            Continue without a photo
          </button>
        </p>
      )}

      {skipped && !photo && !error && (
        <p className="text-fg-muted text-xs">
          Continuing without a photo. The applicant can upload one later from their documents.
          <button
            type="button"
            className="ml-1 font-semibold text-inherit underline"
            onClick={() => onSkippedChange(false)}
            disabled={disabled}
          >
            Take a photo instead
          </button>
        </p>
      )}

      {validationError && !photo && !skipped && (
        <p role="alert" className="text-danger-soft-fg text-xs font-medium">
          {validationError}
        </p>
      )}
    </div>
  );
}
