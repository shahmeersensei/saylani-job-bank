import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicantPhoto } from './ApplicantPhoto';
import type { ApplicantDocumentView } from '@/domains/applicant';

const { apiFetchMock, refreshMock, putWithProgressMock, toastMock, openDocumentMock } = vi.hoisted(
  () => ({
    apiFetchMock: vi.fn(),
    refreshMock: vi.fn(),
    putWithProgressMock: vi.fn().mockResolvedValue(undefined),
    toastMock: { success: vi.fn(), error: vi.fn() },
    openDocumentMock: vi.fn(),
  }),
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('@/lib/upload/put-with-progress', () => ({
  putWithProgress: putWithProgressMock,
}));

vi.mock('@/lib/api/client', () => ({
  apiFetch: apiFetchMock,
}));

vi.mock('@/components/molecules', () => ({
  toast: toastMock,
}));

vi.mock('./open-document', () => ({
  openDocument: openDocumentMock,
}));

const photo: ApplicantDocumentView = {
  id: 'photo-doc-id',
  typeCode: 'PHOTO',
  fileName: 'passport-photo.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 12345,
  status: 'UPLOADED',
  reviewNote: null,
  uploadedAt: '2026-11-16T10:00:00.000Z',
};

describe('ApplicantPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putWithProgressMock.mockResolvedValue(undefined);
  });

  it('shows a placeholder and an upload button when no photo is on file', () => {
    render(<ApplicantPhoto applicantId="applicant-id" photo={null} canManage />);

    expect(screen.getByText('No photo on file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('shows no upload button when staff cannot manage the profile', () => {
    render(<ApplicantPhoto applicantId="applicant-id" photo={null} canManage={false} />);

    expect(screen.getByText('No photo on file')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument();
  });

  it('loads the photo through the signed view link', async () => {
    apiFetchMock.mockResolvedValue({
      data: { url: 'https://storage.test/photo.jpg', expiresAt: '2026-11-16T10:02:00.000Z' },
    });
    render(<ApplicantPhoto applicantId="applicant-id" photo={photo} canManage />);

    const img = await screen.findByAltText('Applicant photo');
    expect(img).toHaveAttribute('src', 'https://storage.test/photo.jpg');
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/applicants/applicant-id/documents/photo-doc-id/url',
    );
    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeInTheDocument();
  });

  it('shows a failure message when the view link cannot be loaded', async () => {
    apiFetchMock.mockRejectedValue(new Error('Not found'));
    render(<ApplicantPhoto applicantId="applicant-id" photo={photo} canManage={false} />);

    expect(await screen.findByText('Photo could not be loaded')).toBeInTheDocument();
    expect(screen.queryByAltText('Applicant photo')).not.toBeInTheDocument();
  });

  it('uploads a photo through presign, PUT and confirm, then refreshes', async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        data: {
          documentId: 'new-photo-doc-id',
          upload: {
            url: '/api/v1/applicants/applicant-id/documents/new-photo-doc-id/upload',
            headers: { 'Content-Type': 'image/jpeg' },
          },
        },
      })
      .mockResolvedValueOnce({ data: {} });
    render(<ApplicantPhoto applicantId="applicant-id" photo={null} canManage />);

    const file = new File(['photo-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Upload applicant photo'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(putWithProgressMock).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/api/v1/applicants/applicant-id/documents', {
      method: 'POST',
      body: {
        typeCode: 'PHOTO',
        fileName: 'passport-photo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: file.size,
      },
    });
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/applicants/applicant-id/documents/new-photo-doc-id/confirm',
      { method: 'POST' },
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith('Photo saved');
  });

  it('rejects a non-photo file without calling the API', () => {
    render(<ApplicantPhoto applicantId="applicant-id" photo={null} canManage />);

    const file = new File(['not-a-photo'], 'photo.gif', { type: 'image/gif' });
    fireEvent.change(screen.getByLabelText('Upload applicant photo'), {
      target: { files: [file] },
    });

    expect(toastMock.error).toHaveBeenCalledWith('Choose a JPG or PNG photo.');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
