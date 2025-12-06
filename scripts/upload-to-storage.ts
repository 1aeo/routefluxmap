/**
 * Upload processed data to Cloudflare R2 AND/OR DigitalOcean Spaces
 * Supports dual upload to both storage providers simultaneously
 * 
 * Usage: npx tsx scripts/upload-to-storage.ts <localPath> <remoteKey> [contentType] [cacheControl]
 */

import * as fs from 'fs';
import * as path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Load config from config.env
function loadConfig(): Record<string, string> {
  const configPath = path.join(process.cwd(), 'config.env');
  const config: Record<string, string> = {};
  
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        config[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
  return config;
}

interface StorageProvider {
  name: string;
  client: S3Client;
  bucket: string;
}

function createStorageProviders(config: Record<string, string>): StorageProvider[] {
  const providers: StorageProvider[] = [];
  
  // Cloudflare R2
  if (config.R2_ENABLED === 'true') {
    providers.push({
      name: 'Cloudflare R2',
      client: new S3Client({
        region: 'auto',
        endpoint: config.R2_ENDPOINT,
        credentials: {
          accessKeyId: config.R2_ACCESS_KEY_ID,
          secretAccessKey: config.R2_SECRET_ACCESS_KEY,
        },
      }),
      bucket: config.R2_BUCKET_NAME,
    });
  }
  
  // DigitalOcean Spaces
  if (config.SPACES_ENABLED === 'true') {
    providers.push({
      name: 'DigitalOcean Spaces',
      client: new S3Client({
        region: 'us-east-1', // Required but ignored by Spaces
        endpoint: config.SPACES_ENDPOINT,
        credentials: {
          accessKeyId: config.SPACES_ACCESS_KEY_ID,
          secretAccessKey: config.SPACES_SECRET_ACCESS_KEY,
        },
        forcePathStyle: false,
      }),
      bucket: config.SPACES_BUCKET_NAME,
    });
  }
  
  return providers;
}

async function uploadFile(
  provider: StorageProvider,
  localPath: string,
  remoteKey: string,
  contentType: string,
  cacheControl: string
): Promise<void> {
  console.log(`  Uploading to ${provider.name} (${provider.bucket})...`);
  
  const content = fs.readFileSync(localPath);
  
  await provider.client.send(new PutObjectCommand({
    Bucket: provider.bucket,
    Key: remoteKey,
    Body: content,
    ContentType: contentType,
    CacheControl: cacheControl,
    ACL: 'public-read', // Required for Spaces, ignored by R2
  }));
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/upload-to-storage.ts <localPath> <remoteKey> [contentType] [cacheControl]');
    process.exit(1);
  }
  
  const localPath = args[0];
  const remoteKey = args[1];
  const contentType = args[2] || 'application/json';
  const cacheControl = args[3] || 'public, max-age=3600';
  
  if (!fs.existsSync(localPath)) {
    console.error(`Error: File not found at ${localPath}`);
    process.exit(1);
  }
  
  const config = loadConfig();
  const providers = createStorageProviders(config);
  
  if (providers.length === 0) {
    console.warn('Warning: No storage providers enabled (R2_ENABLED or SPACES_ENABLED). Skipping upload.');
    return;
  }
  
  console.log(`Uploading ${localPath} -> ${remoteKey}`);
  
  const uploads = providers.map(p => 
    uploadFile(p, localPath, remoteKey, contentType, cacheControl)
      .catch(err => console.error(`  ✗ Failed to upload to ${p.name}: ${err.message}`))
  );
  
  await Promise.all(uploads);
  console.log('Done.');
}

main().catch(console.error);
