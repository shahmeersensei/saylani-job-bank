export interface UploadResult {
  /** Object-storage key returned by the upload function (stored on the domain record). */
  key: string;
  name: string;
  size: number;
  type: string;
}

/**
 * Performs one upload. Typically: ask the API for the upload route, then `putWithProgress`.
 * Must call `onProgress` with 0..1 and honour `signal` for cancellation.
 */
export type UploadFn = (
  file: File,
  helpers: { onProgress: (fraction: number) => void; signal: AbortSignal },
) => Promise<{ key: string }>;

export type UploadStatus = 'uploading' | 'done' | 'error';

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  key?: string;
}

export interface FileUploaderProps {
  upload: UploadFn;
  /** Called whenever the set of successfully uploaded files changes. */
  onChange?: (uploaded: UploadResult[]) => void;
  accept?: string[];
  maxSizeBytes?: number;
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  /** Accessible name for the drop zone, e.g. "Upload CNIC (front)". */
  label?: string;
  hint?: string;
  className?: string;
}
