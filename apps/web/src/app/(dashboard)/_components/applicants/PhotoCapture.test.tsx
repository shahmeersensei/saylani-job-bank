import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cameraErrorMessage,
  isIntegratedCameraLabel,
  PhotoCapture,
  type CapturedPhoto,
} from './PhotoCapture';

const getUserMediaMock = vi.fn();
const enumerateDevicesMock = vi.fn();
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
    enumerateDevicesMock.mockReset();
    enumerateDevicesMock.mockResolvedValue([]);
    window.localStorage.clear();
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock, enumerateDevices: enumerateDevicesMock },
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

  it('gives the upload file input an id and name so browsers can autofill it', () => {
    renderCapture();

    const input = screen.getByLabelText('Upload a photo file');
    expect(input).toHaveAttribute('id', 'applicant-photo-upload');
    expect(input).toHaveAttribute('name', 'applicant-photo');
  });

  it('prefers the integrated webcam over the browser default camera', async () => {
    const user = userEvent.setup();
    const streamFor = (deviceId: string) => ({
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }],
    });
    getUserMediaMock.mockImplementation(async (constraints: MediaStreamConstraints) => {
      const wanted = (constraints.video as { deviceId?: { exact?: string } })?.deviceId?.exact;
      return wanted === 'int-1' ? streamFor('int-1') : streamFor('usb-1');
    });
    enumerateDevicesMock.mockResolvedValue([
      { deviceId: 'usb-1', kind: 'videoinput', label: 'USB Webcam' },
      { deviceId: 'int-1', kind: 'videoinput', label: 'Integrated Camera' },
    ]);
    expect(isIntegratedCameraLabel('Integrated Camera')).toBe(true);
    expect(isIntegratedCameraLabel('USB Webcam')).toBe(false);
    renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    // Switched to the integrated webcam once its label was visible.
    await waitFor(() =>
      expect(getUserMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({ deviceId: { exact: 'int-1' } }),
        }),
      ),
    );
    const select = await screen.findByLabelText('Choose camera');
    expect(select).toHaveValue('int-1');
    expect(window.localStorage.getItem('jobbank-camera-device-id')).toBe('int-1');
  });

  it('lets staff switch to another camera from the selector', async () => {
    const user = userEvent.setup();
    const streamFor = (deviceId: string) => ({
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }],
    });
    getUserMediaMock.mockImplementation(async (constraints: MediaStreamConstraints) => {
      const wanted = (constraints.video as { deviceId?: { exact?: string } })?.deviceId?.exact;
      return streamFor(wanted ?? 'usb-1');
    });
    enumerateDevicesMock.mockResolvedValue([
      { deviceId: 'usb-1', kind: 'videoinput', label: 'USB Webcam' },
      { deviceId: 'int-1', kind: 'videoinput', label: 'Integrated Camera' },
    ]);
    renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));
    const select = await screen.findByLabelText('Choose camera');
    expect(select).toHaveValue('int-1');

    await user.selectOptions(select, 'usb-1');

    await waitFor(() =>
      expect(getUserMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({ deviceId: { exact: 'usb-1' } }),
        }),
      ),
    );
  });

  it('falls back to the other camera when the remembered camera is gone', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('jobbank-camera-device-id', 'int-1');
    const streamFor = (deviceId: string) => ({
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }],
    });
    getUserMediaMock.mockImplementation(async (constraints: MediaStreamConstraints) => {
      const wanted = (constraints.video as { deviceId?: { exact?: string } })?.deviceId?.exact;
      // The saved integrated camera no longer exists; the USB webcam works.
      if (wanted === 'int-1') throw new DOMException('gone', 'OverconstrainedError');
      return streamFor(wanted ?? 'usb-1');
    });
    enumerateDevicesMock.mockResolvedValue([
      { deviceId: 'usb-1', kind: 'videoinput', label: 'USB Webcam' },
      { deviceId: 'int-1', kind: 'videoinput', label: 'Integrated Camera' },
    ]);
    renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    // Regression: one dead camera used to end the whole capture with
    // "No camera was found", even though the other camera worked.
    await waitFor(() => expect(screen.getByText('● LIVE')).toBeInTheDocument());
    expect(screen.queryByText(/No camera was found/)).not.toBeInTheDocument();
    expect(getUserMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ deviceId: { exact: 'usb-1' } }),
      }),
    );
    expect(screen.getByLabelText('Choose camera')).toHaveValue('usb-1');
    // The dead saved id is forgotten; the working camera is remembered.
    expect(window.localStorage.getItem('jobbank-camera-device-id')).toBe('usb-1');
  });

  it('keeps the working camera when the integrated webcam will not start', async () => {
    const user = userEvent.setup();
    const streamFor = (deviceId: string) => ({
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }],
    });
    getUserMediaMock.mockImplementation(async (constraints: MediaStreamConstraints) => {
      const wanted = (constraints.video as { deviceId?: { exact?: string } })?.deviceId?.exact;
      if (wanted === 'int-1') throw new DOMException('busy', 'NotFoundError');
      return streamFor(wanted ?? 'usb-1');
    });
    enumerateDevicesMock.mockResolvedValue([
      { deviceId: 'usb-1', kind: 'videoinput', label: 'USB Webcam' },
      { deviceId: 'int-1', kind: 'videoinput', label: 'Integrated Camera' },
    ]);
    renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    // The integrated switch was attempted but failed; the USB preview that
    // was already working stays live instead of failing the capture.
    await waitFor(() => expect(screen.getByText('● LIVE')).toBeInTheDocument());
    expect(screen.queryByText(/No camera was found/)).not.toBeInTheDocument();
    expect(getUserMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ deviceId: { exact: 'int-1' } }),
      }),
    );
    expect(screen.getByLabelText('Choose camera')).toHaveValue('usb-1');
  });

  it('lists both cameras before Start so staff can pick either one', async () => {
    enumerateDevicesMock.mockResolvedValue([
      { deviceId: 'usb-1', kind: 'videoinput', label: 'USB Webcam' },
      { deviceId: 'int-1', kind: 'videoinput', label: 'Integrated Camera' },
    ]);
    renderCapture();

    const select = await screen.findByLabelText('Choose camera');
    expect(screen.getByRole('option', { name: 'USB Webcam' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Integrated Camera' })).toBeInTheDocument();
    expect(select).toBeInTheDocument();
  });

  it('keeps the camera selector visible after a failed start', async () => {
    const user = userEvent.setup();
    getUserMediaMock.mockRejectedValue(new DOMException('none', 'NotFoundError'));
    enumerateDevicesMock.mockResolvedValue([
      { deviceId: 'usb-1', kind: 'videoinput', label: 'USB Webcam' },
      { deviceId: 'int-1', kind: 'videoinput', label: 'Integrated Camera' },
    ]);
    renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    await waitFor(() => expect(screen.getByText(/No camera was found/)).toBeInTheDocument());
    // Staff are not stuck: the other camera can still be picked from here.
    expect(screen.getByLabelText('Choose camera')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'USB Webcam' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Integrated Camera' })).toBeInTheDocument();
  });

  it('shows which camera is in use when there is only one', async () => {
    const user = userEvent.setup();
    enumerateDevicesMock.mockResolvedValue([
      { deviceId: 'int-1', kind: 'videoinput', label: 'Integrated Camera' },
    ]);
    renderCapture();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    await waitFor(() => expect(screen.getByText('Camera: Integrated Camera')).toBeInTheDocument());
    expect(screen.queryByLabelText('Choose camera')).not.toBeInTheDocument();
  });
});
