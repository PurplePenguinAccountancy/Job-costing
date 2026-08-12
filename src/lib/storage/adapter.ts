/**
 * Document byte storage — same reasoning as the accounting and OCR adapters
 * (brief section 4): nothing in the capture pipeline should know or care
 * where the actual file bytes live. S3 is the intended production backend
 * (Addendum 2.N), pending an AWS account/domain decision that hasn't been
 * made yet — the local-filesystem implementation exists so real bytes get
 * persisted (and can be reattached to Xero) in the meantime, not as a
 * long-term storage strategy.
 */
export interface StorageAdapter {
  readonly provider: string;
  store(key: string, content: Buffer): Promise<void>;
  retrieve(key: string): Promise<Buffer>;
}
