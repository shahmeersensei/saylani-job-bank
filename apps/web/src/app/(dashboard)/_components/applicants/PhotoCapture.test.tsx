import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cameraErrorMessage, PhotoCapture, type CapturedPhoto } from './PhotoCapture';

const getUserMediaMock = vi.fn();
const mockStream = { getTracks: () => [] };
const playMock = vi.fn().mockResolvedValue(undefined);
const drawImageMock = vi.fn();
const toBlobMock = vi.fn((callback: (blob: Blob | null) => void) =>
  callback(new Blob(['fake-jpeg'], { type: 'image/jpeg' })),
);
const createObjectURLMock = vi.fn(() => 'blob:mock-photo');
const revokeObjectURLMock = vi.fn();

function renderCapture(
  props: Partial<{
    photo: CapturedPhoto | null;
    skipped: boolean;
  }> = {},
) {
  const onPhotoChange = vi.fn();
  const onSkippedChange = vi.fn();
  const utils = render(
    <PhotoCapture
      photo={props.photo ?? null}
      onPhotoChange={onPhotoChange}
      skipped={props.skipped ?? false}
      onSkippedChange={onSkippedChange}
    />,
  );
  return { ...utils, onPhotoChange, onSkippedChange };
}

describe('cameraErrorMessage', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });
  });

  it.each([
    ['NotAllowedError', 'Camera access was denied'],
    ['NotFoundError', 'No camera was found'],
    ['OverconstrainedError', 'No camera was found'],
    ['NotReadableError', 'already in use'],
    ['TrackStartError', 'already in use'],
    ['AbortError', 'could not be started'],
    ['UnknownError', 'could not be started'],
  ])('maps %s to a plain-language message', (name, fragment) => {
    expect(cameraErrorMessage({ name })).toContain(fragment);
  });

  it('reports no camera support when mediaDevices is missing', () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    });
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toContain('cannot access a camera');
  });
});

describe('PhotoCapture', () => {
  beforeEach(() => {
    getUserMediaMock.mockReset();
    getUserMediaMock.mockResolvedValue(mockStream);
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });
    vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(playMock);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: drawImageMock,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      toBlobMock as unknown as typeof HTMLCanvasElement.prototype.toBlob,
    );
    globalThis.URL.createObjectURL = createObjectURLMock;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock;
  });

  it('attaches the camera stream to the preview video once it mounts', async () => {
    const user = userEvent.setup();
    renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    await waitFor(() => expect(screen.getByText('● LIVE')).toBeInTheDocument());
    // Regression: the <video> only mounts once the camera is live, so a
    // stream assigned during startCamera (before the mount) is lost and the
    // preview stays black with videoWidth 0.
    const video = document.querySelector('video')!;
    await waitFor(() => expect(video.srcObject).toBe(mockStream));
  });

  it('starts the camera and captures a passport photo for preview', async () => {
    const user = userEvent.setup();
    const { onPhotoChange } = renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    await waitFor(() => expect(screen.getByText('● LIVE')).toBeInTheDocument());
    expect(getUserMediaMock).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));

    const video = document.querySelector('video')!;
    await waitFor(() => expect(video.srcObject).toBe(mockStream));
    Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    fireEvent.loadedMetadata(video);

    await user.click(screen.getByRole('button', { name: 'Capture photo' }));

    await waitFor(() =>
      expect(onPhotoChange).toHaveBeenCalledWith(
        expect.objectContaining({ previewUrl: 'blob:mock-photo' }),
      ),
    );
    expect(drawImageMock).toHaveBeenCalled();
  });

  it('shows a plain-language error and a continue-without-photo path when access is denied', async () => {
    const user = userEvent.setup();
    getUserMediaMock.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { onSkippedChange } = renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    await waitFor(() => expect(screen.getByText(/Camera access was denied/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Continue without a photo' }));
    expect(onSkippedChange).toHaveBeenCalledWith(true);
  });

  it('rejects an oversized uploaded photo file', async () => {
    const user = userEvent.setup();
    renderCapture();
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'photo.jpg', {
      type: 'image/jpeg',
    });

    await user.upload(screen.getByLabelText('Upload a photo file'), big);

    expect(screen.getByText('The photo must be 2 MB or smaller.')).toBeInTheDocument();
  });

  it('shows Retake and Remove for a captured photo', () => {
    renderCapture({
      photo: {
        blob: new Blob(['fake-jpeg'], { type: 'image/jpeg' }),
        previewUrl: 'blob:mock-photo',
      },
    });

    expect(screen.getByAltText('Captured applicant photo preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
