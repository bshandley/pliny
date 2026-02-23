import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StorageDriver } from './index';

function createS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: process.env.S3_KEY || '',
      secretAccessKey: process.env.S3_SECRET || '',
    },
  });
}

export class S3StorageDriver implements StorageDriver {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.client = createS3Client();
    this.bucket = process.env.S3_BUCKET || 'attachments';
  }

  async upload(file: Express.Multer.File, dest: string): Promise<string> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: dest,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));
    return dest;
  }

  async getStream(path: string): Promise<NodeJS.ReadableStream> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: path,
    }));
    return result.Body as Readable;
  }

  async delete(path: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: path,
    }));
  }
}
