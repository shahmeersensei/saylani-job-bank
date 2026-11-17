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
/** Remembered camera choice for this laptop, so the next applicant reuses it. */
const CAMERA_DEVICE_STORAGE_KEY = 'jobbank-camera-device-id';

/**
 * Whether a camera label looks like the laptop's own built-in webcam
 * ("Integrated Camera", "Built-in Camera", "FaceTime HD Camera", …) rather
 * than a plugged-in USB webcam or a virtual camera. Vendor names vary, so
 * this is only a preference — staff can always pick another camera below.
 */
export function isIntegratedCameraLabel(label: string): boolean {
  return /integrat|built-?in|internal|facetime|true ?vision|easy ?camera/i.test(label);
}

type CameraDevice = Pick<MediaDeviceInfo, 'deviceId' | 'label'>;

function cameraLabel(device: CameraDevice, index: number): string {
  return device.label || `Camera ${index + 1}`;
}

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
  /** Cameras found on this device (labels only appear once permission is granted). */
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  /** The camera the user picked (or the integrated one, auto-picked below). */
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() => {
    try {
      return typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(CAMERA_DEVICE_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  /** deviceId of the track actually feeding the preview, if known. */
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);

  const rememberDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    try {
      window.localStorage.setItem(CAMERA_DEVICE_STORAGE_KEY, deviceId);
    } catch {
      // Private mode / blocked storage: the choice just lasts this session.
    }
  };

  /** Forget a saved camera id that no longer exists, so the next Start does not retry a dead camera. */
  const forgetDevice = () => {
    setSelectedDeviceId(null);
    try {
      window.localStorage.removeItem(CAMERA_DEVICE_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage: nothing to forget.
    }
  };

  const activeTrackDeviceId = (stream: MediaStream): string | undefined =>
    stream.getVideoTracks?.()[0]?.getSettings?.().deviceId;

  const listCameras = async (): Promise<CameraDevice[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all
        .filter((device) => device.kind === 'videoinput' && Boolean(device.deviceId))
        .map((device) => ({ deviceId: device.deviceId, label: device.label }));
    } catch {
      return [];
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setVideoReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => stopCamera, []);

  /**
   * List the cameras as soon as the form opens, so staff can see both the
   * laptop's own camera and a plugged-in webcam before pressing Start — and
   * pick either one. Labels stay blank until permission is granted, so the
   * list shows "Camera 1", "Camera 2" until then; plugging a webcam in (or
   * unplugging one) refreshes the list.
   */
  useEffect(() => {
    let cancelled = false;
    const refreshCameras = async () => {
      const cameras = await listCameras();
      if (!cancelled && cameras.length > 0) setDevices(cameras);
    };
    void refreshCameras();
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.('devicechange', refreshCameras);
    return () => {
      cancelled = true;
      mediaDevices?.removeEventListener?.('devicechange', refreshCameras);
    };
    // listCameras only reads navigator.mediaDevices; no state belongs here.
  }, []);

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
    setActiveDeviceId(null);
    setCamera('idle');
  };

  const requestCamera = (deviceId: string | null) =>
    navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

  /**
   * Starts the camera. A staff member's pick (or the remembered camera) is
   * tried first; with no pick, every camera found on this device is tried in
   * turn — laptop camera and USB webcam alike — and only when none of them
   * starts do we report "No camera was found". One dead camera (unplugged,
   * busy, or a saved id that no longer exists) must never hide the working
   * one. With no pick, the integrated webcam is still preferred once labels
   * are visible, but only when it actually starts: if it does not, the
   * camera already previewing stays live instead of failing the capture.
   */
  const startCamera = async (deviceId?: string | null) => {
    if (disabled) return;
    stopCamera();
    onSkippedChange(false);
    setError(null);
    setCamera('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Camera not supported', 'NotFoundError');
      }
      // A pick from the selector is explicit; the remembered camera is only
      // a first try in the chain below, never an explicit pick — it may be
      // gone, and then the other camera must take over.
      const picked = deviceId !== undefined ? deviceId : null;
      // Cameras first: trying the saved/default camera blind can fail with
      // NotFoundError while the other camera on this laptop works fine.
      const camerasBefore = await listCameras();
      if (camerasBefore.length > 0) setDevices(camerasBefore);
      const knownIds = new Set(camerasBefore.map((device) => device.deviceId));
      const tried = new Set<string>();
      let lastError: unknown = null;
      let staleRemembered = false;

      const tryCamera = async (id: string | null): Promise<MediaStream | null> => {
        try {
          const stream = await requestCamera(id);
          if (id) tried.add(id);
          return stream;
        } catch (caught) {
          if (id) tried.add(id);
          const name = (caught as { name?: string } | null)?.name;
          // Permission denied: no other camera will work either.
          if (name === 'NotAllowedError' || name === 'SecurityError') throw caught;
          if (
            id === selectedDeviceId &&
            (name === 'NotFoundError' || name === 'OverconstrainedError')
          ) {
            staleRemembered = true;
          }
          lastError = caught;
          return null;
        }
      };

      let stream: MediaStream | null;
      if (picked) {
        // A deliberate pick: try that camera only, so the preview never
        // silently comes from the other one. On failure the selector stays
        // visible, so staff can try the other camera right away.
        stream = await tryCamera(picked);
      } else {
        // No pick: remembered camera first, then every listed camera, then
        // the browser default. A remembered id the browser no longer lists
        // is stale (camera unplugged / id changed) — skip and forget it.
        if (selectedDeviceId && camerasBefore.length > 0 && !knownIds.has(selectedDeviceId)) {
          staleRemembered = true;
        }
        const attempts: (string | null)[] = [];
        const queue = (id: string | null) => {
          if (!attempts.includes(id)) attempts.push(id);
        };
        if (selectedDeviceId && !staleRemembered) queue(selectedDeviceId);
        camerasBefore.forEach((device) => queue(device.deviceId));
        queue(null);
        stream = null;
        for (const id of attempts) {
          stream = await tryCamera(id);
          if (stream) break;
        }
      }
      if (!stream) {
        if (staleRemembered) forgetDevice();
        throw lastError ?? new DOMException('No camera found', 'NotFoundError');
      }

      streamRef.current = stream;
      let activeId = activeTrackDeviceId(stream) ?? picked ?? null;
      const cameras = await listCameras();
      if (cameras.length > 0) setDevices(cameras);
      if (!picked) {
        const integrated = cameras.find((device) => isIntegratedCameraLabel(device.label));
        if (integrated && integrated.deviceId !== activeId && !tried.has(integrated.deviceId)) {
          try {
            const switched = await requestCamera(integrated.deviceId);
            stream.getTracks().forEach((track) => track.stop());
            stream = switched;
            streamRef.current = switched;
            activeId = activeTrackDeviceId(switched) ?? integrated.deviceId;
          } catch {
            // The integrated webcam would not start: keep the camera that
            // is already previewing instead of failing the capture.
          }
        }
      }
      if (staleRemembered) forgetDevice();
      setActiveDeviceId(activeId);
      if (activeId) rememberDevice(activeId);
      // The <video> mounts from this state change; the effect above
      // attaches the stream once it exists.
      setVideoReady(false);
      setCamera('live');
    } catch (caught) {
      stopCamera();
      setActiveDeviceId(null);
      setError(cameraErrorMessage(caught));
      setCamera('error');
    }
  };

  const switchCamera = (deviceId: string) => {
    void startCamera(deviceId);
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
        // Stacked, full-width: two side-by-side buttons are ~190px wide and
        // overflow this 148px column, cutting "Remove" off at the card edge.
        <div className="grid gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            fullWidth
            leftIcon={<RotateCcw />}
            onClick={retakePhoto}
            disabled={disabled}
          >
            Retake
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            fullWidth
            leftIcon={<Trash2 />}
            onClick={removePhoto}
            disabled={disabled}
          >
            Remove
          </Button>
        </div>
      ) : camera === 'live' ? (
        <div className="grid gap-2">
          <Button
            type="button"
            size="sm"
            fullWidth
            leftIcon={<Camera />}
            onClick={() => void capturePhoto()}
            disabled={disabled || !videoReady}
          >
            Capture photo
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            fullWidth
            onClick={cancelCamera}
            disabled={disabled}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          fullWidth
          leftIcon={<Camera />}
          onClick={() => void startCamera()}
          disabled={disabled || camera === 'starting'}
        >
          {camera === 'starting' ? 'Starting camera…' : 'Start camera'}
        </Button>
      )}

      {/* Camera choice: the list is filled when the form opens, so both the
          laptop camera and a plugged-in webcam can be picked before (or
          after) Start — including after a failed start, when the other
          camera may still work. With one camera, show which one it is. */}
      {!photo && devices.length > 1 && (
        <div className="grid gap-1">
          <label htmlFor="applicant-camera-select" className="text-fg-muted text-xs font-medium">
            Camera
          </label>
          <select
            id="applicant-camera-select"
            name="applicant-camera"
            aria-label="Choose camera"
            value={activeDeviceId ?? selectedDeviceId ?? ''}
            onChange={(event) => switchCamera(event.target.value)}
            disabled={disabled}
            className="border-border bg-surface text-fg w-full truncate rounded-lg border px-2 py-1.5 text-xs"
          >
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {cameraLabel(device, index)}
              </option>
            ))}
          </select>
        </div>
      )}
      {!photo && devices.length === 1 && devices[0]?.label && (
        <p className="text-fg-muted truncate text-xs" title={devices[0].label}>
          Camera: {devices[0].label}
        </p>
      )}

      {!photo && camera !== 'live' && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            id="applicant-photo-upload"
            name="applicant-photo"
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
            size="sm"
            fullWidth
            leftIcon={<Upload />}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            Upload a photo
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
