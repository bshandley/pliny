export interface StorageDriver {
  upload(file: Express.Multer.File, dest: string): Promise<string>;
  getStream(path: string): Promise<NodeJS.ReadableStream>;
  delete(path: string): Promise<void>;
}
