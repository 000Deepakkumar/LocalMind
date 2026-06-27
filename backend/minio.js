const Minio = require('minio');

const client = new Minio.Client({
  endPoint:  process.env.MINIO_ENDPOINT  || 'localhost',
  port:      parseInt(process.env.MINIO_PORT || '9000'),
  useSSL:    process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

const BUCKETS = {
  images: process.env.MINIO_BUCKET_IMAGES || 'localmind-images',
  videos: process.env.MINIO_BUCKET_VIDEOS || 'localmind-videos',
  chats:  process.env.MINIO_BUCKET_CHATS  || 'localmind-chats',
};

async function ensureBuckets() {
  for (const [key, bucket] of Object.entries(BUCKETS)) {
    try {
      const exists = await client.bucketExists(bucket);
      if (!exists) {
        await client.makeBucket(bucket);
        console.log(`[minio] Created bucket: ${bucket}`);
      }
    } catch (e) {
      console.warn(`[minio] Could not ensure bucket ${bucket}:`, e.message);
    }
  }
}

async function uploadBuffer(bucket, objectName, buffer, contentType = 'application/octet-stream') {
  await client.putObject(bucket, objectName, buffer, buffer.length, { 'Content-Type': contentType });
}

async function getPresignedUrl(bucket, objectName, expiry = 3600) {
  return client.presignedGetObject(bucket, objectName, expiry);
}

module.exports = { client, BUCKETS, ensureBuckets, uploadBuffer, getPresignedUrl };
