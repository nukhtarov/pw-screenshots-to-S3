import {
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'S3_ENDPOINT',
  'S3_BUCKET_NAME',
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} environment variable is not set`);
  }
}

const bucketName = process.env.S3_BUCKET_NAME;

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
});

async function checkS3Access() {
  try {
    const data = await client.send(new ListBucketsCommand({}));
    console.log('S3 access is valid:', data.Buckets);
  } catch (err) {
    throw new Error('S3 access is invalid');
  }
}

export async function uploadNewScreenshots(
  remoteDir = 'remoteDir',
  folder = 'tests/screenshots',
) {
  await checkS3Access();
  const images: string[] = await new Promise((resolve, reject) => {
    glob(`${folder}/**/*.png`, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });

  for (const image of images) {
    const data = await fs.promises.readFile(image);
    const base64data = Buffer.from(data);
    const params = new PutObjectCommand({
      Bucket: bucketName,
      Key: `${remoteDir}/${path.relative(folder, image)}`,
      Body: base64data,
    });
    console.log(`Uploaded successfully: ${params.input.Key}`);
  }
}

export async function downloadScreenshots(remoteDir = 'remoteDir', localDir = './tests/screenshots') {
  try {
    await checkS3Access();
    const images = await new Promise<string[]>((resolve, reject) => {
      const params = new ListObjectsCommand({
        Bucket: bucketName,
        Prefix: `${remoteDir}/`,
      });
      client.send(params, (err, data) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          const files = data.Contents.map((file) => file.Key).filter((file) => /\.png$/.test(file));
          resolve(files);
        }
      });
    });
    for (const image of images) {
      const filename = path.relative(remoteDir, image);
      console.log(filename);
      const params = new GetObjectCommand({
        Bucket: bucketName,
        Key: image,
      });

      if (!fs.existsSync(path.join(localDir, path.dirname(filename)))) {
        fs.mkdirSync(path.join(localDir, path.dirname(filename)), { recursive: true });
      }
      try {
        const { Body } = await client.send(params);
        const writeStream = fs.createWriteStream(path.join(localDir, filename));
        Body.pipe(writeStream);
        await new Promise<void>((resolve, reject) => {
          writeStream.on('error', (err) => {
            reject(err);
          });
          writeStream.on('close', () => {
            console.log(`Downloaded successfully: ${filename}`);
            resolve();
          });
        });
      } catch (error) {
        console.error(`Error downloading file ${filename}: ${error}`);
      }
    }
  } catch (error) {
    console.error(`Error: ${error}`);
  }
}
