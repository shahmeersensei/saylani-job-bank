import 'server-only';
import { S3Client } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  // Only send checksums when an API requires them — also needed for
  // Cloudflare R2 and other S3-compatible stores.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const S3_BUCKET = env.S3_BUCKET;
