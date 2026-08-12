import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StorageAdapter } from "./adapter";

/**
 * Writes to a local directory on the server's own disk. Fine for a single
 * dev/pilot instance; not fine for anything horizontally scaled or
 * ephemeral (a container redeploy would lose everything under here) — swap
 * for a real S3Adapter (Addendum 2.N) before that becomes a concern.
 */
export class LocalFilesystemStorageAdapter implements StorageAdapter {
  readonly provider = "local-filesystem";
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? process.env.STORAGE_LOCAL_DIR ?? join(process.cwd(), ".data", "documents");
  }

  async store(key: string, content: Buffer): Promise<void> {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  async retrieve(key: string): Promise<Buffer> {
    const path = join(this.root, key);
    return readFile(path);
  }
}
