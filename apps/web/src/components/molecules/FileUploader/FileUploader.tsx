'use client';

import { CircleCheck, FileText, RotateCcw, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/atoms/Button';
import { friendlyApiError } from '@/lib/api/client';
import { formatBytes, validateFile } from '@/lib/upload/validate-file';
import { cn } from '@/lib/utils/cn';
import type { FileUploaderProps, UploadItem, UploadResult } from './fileUploader.types';

export function FileUploader({
  upload,
  onChange,
  accept,
  maxSizeBytes,
  multiple = false,
  maxFiles = multiple ? 10 : 1,
  disabled = false,
  label = 'Upload files',
  hint,
  className,
}: FileUploaderProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const [items, setItems] = useState<UploadItem[]>([]);
  const [rejections, setRejections] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const uploaded: UploadResult[] = items
      .filter((item) => item.status === 'done' && item.key)
      .map((item) => ({
        key: item.key!,
        name: item.file.name,
        size: item.file.size,
        type: item.file.type,
      }));
    onChangeRef.current?.(uploaded);
  }, [items]);

  useEffect(() => {
    const active = controllers.current;
    return () => active.forEach((controller) => controller.abort());
  }, []);

  const patch = (id: string, changes: Partial<UploadItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const start = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      patch(item.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const { key } = await upload(item.file, {
          signal: controller.signal,
          onProgress: (fraction) =>
            patch(item.id, { progress: Math.min(1, Math.max(0, fraction)) }),
        });
        patch(item.id, { status: 'done', progress: 1, key });
      } catch (error) {
        if (controller.signal.aborted) return;
        patch(item.id, {
          status: 'error',
          error: friendlyApiError(error),
        });
      } finally {
        controllers.current.delete(item.id);
      }
    },
    [upload],
  );

  const addFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const errors: string[] = [];
    const room = maxFiles - items.length;
    const accepted: UploadItem[] = [];

    for (const file of files) {
      const problem = validateFile(file, { accept, maxSizeBytes });
      if (problem) errors.push(problem);
      else if (accepted.length >= room) errors.push(`${file.name}: maximum of ${maxFiles} file(s)`);
      else accepted.push({ id: crypto.randomUUID(), file, status: 'uploading', progress: 0 });
    }

    setRejections(errors);
    if (accepted.length === 0) return;
    setItems((current) => [...current, ...accepted]);
    accepted.forEach((item) => void start(item));
  };

  const remove = (id: string) => {
    controllers.current.get(id)?.abort();
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) addFiles(event.dataTransfer.files);
  };

  const full = items.length >= maxFiles;

  return (
    <div className={cn('grid gap-3', className)}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !full) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'border-border-strong bg-surface-muted flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragging && 'border-primary bg-primary-soft',
          (disabled || full) && 'opacity-60',
        )}
      >
        <Upload className="text-fg-muted size-6" aria-hidden="true" />
        <p className="text-fg-muted text-sm">
          <span className="hidden sm:inline">Drag &amp; drop, or </span>
          <Button
            variant="link"
            disabled={disabled || full}
            aria-describedby={hint ? hintId : undefined}
            onClick={() => inputRef.current?.click()}
          >
            {label}
          </Button>
        </p>
        {hint && (
          <p id={hintId} className="text-fg-subtle text-xs">
            {hint}
          </p>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          multiple={multiple}
          accept={accept?.join(',')}
          disabled={disabled || full}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {rejections.length > 0 && (
        <ul role="alert" className="text-danger grid gap-1 text-sm">
          {rejections.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ul className="grid gap-2" aria-label="Selected files">
          {items.map((item) => (
            <li
              key={item.id}
              className="border-border bg-surface flex items-center gap-3 rounded-lg border p-3"
            >
              <FileText className="text-fg-muted size-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-fg truncate text-sm font-medium">{item.file.name}</p>
                  <p className="text-fg-subtle numeric shrink-0 text-xs">
                    {formatBytes(item.file.size)}
                  </p>
                </div>
                {item.status === 'uploading' && (
                  <div
                    role="progressbar"
                    aria-label={`Uploading ${item.file.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                    className="bg-surface-sunken mt-2 h-1.5 overflow-hidden rounded-full"
                  >
                    <div
                      className="bg-primary h-full rounded-full transition-[width]"
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </div>
                )}
                {item.status === 'done' && (
                  <p className="text-success-soft-fg mt-1 flex items-center gap-1 text-xs">
                    <CircleCheck className="size-3.5" aria-hidden="true" /> Uploaded
                  </p>
                )}
                {item.status === 'error' && (
                  <p className="text-danger mt-1 text-xs">{item.error}</p>
                )}
              </div>
              {item.status === 'error' && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Retry ${item.file.name}`}
                  onClick={() => void start(item)}
                >
                  <RotateCcw />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={`${item.status === 'uploading' ? 'Cancel' : 'Remove'} ${item.file.name}`}
                onClick={() => remove(item.id)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
