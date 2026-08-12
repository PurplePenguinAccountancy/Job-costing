import type { StorageAdapter } from "./adapter";
import { LocalFilesystemStorageAdapter } from "./local-adapter";

export type { StorageAdapter } from "./adapter";

let cached: StorageAdapter | null = null;

/**
 * Local filesystem for now — no S3/AWS account exists yet (Addendum 2.N is
 * still pending a hosting decision). One place to swap in a real S3Adapter
 * later without touching any caller.
 */
export function getStorageAdapter(): StorageAdapter {
  if (cached) return cached;
  cached = new LocalFilesystemStorageAdapter();
  return cached;
}
