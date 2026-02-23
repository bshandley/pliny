import fs from 'fs';
import path from 'path';
import { StorageDriver } from './index';

const BASE_DIR = process.env.LOCAL_STORAGE_PATH || '/data/attachments';

export class LocalStorageDriver implements StorageDriver {
  async upload(file: Express.Multer.File, dest: string): Promise<string> {
    const fullPath = path.join(BASE_DIR, dest);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, file.buffer);
    return dest;
  }

  async getStream(filePath: string): Promise<NodeJS.ReadableStream> {
    const fullPath = path.join(BASE_DIR, filePath);
    return fs.createReadStream(fullPath);
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = path.join(BASE_DIR, filePath);
    await fs.promises.unlink(fullPath).catch(() => {});
  }
}
