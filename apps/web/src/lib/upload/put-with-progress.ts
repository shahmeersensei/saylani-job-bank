export interface PutWithProgressOptions {
  url: string;
  file: Blob;
  headers?: Record<string, string>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Uploads a file to the URL the API returned for it (the app's same-origin
 * upload route). Uses XHR (not fetch) because fetch has no upload-progress events.
 */
export function putWithProgress({
  url,
  file,
  headers = {},
  onProgress,
  signal,
}: PutWithProgressOptions) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));

    if (signal) {
      if (signal.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}
