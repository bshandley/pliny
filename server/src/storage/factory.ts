import { StorageDriver } from './index';
import { LocalStorageDriver } from './local';
import { S3StorageDriver } from './s3';

let driver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (!driver) {
    const type = process.env.STORAGE_DRIVER || 'local';
    driver = type === 's3' ? new S3StorageDriver() : new LocalStorageDriver();
  }
  return driver;
}
