/**
 * Document-extraction interface — same reasoning as the accounting adapter
 * (brief section 4): Azure Document Intelligence is the provisional choice
 * (Addendum 2.G, pending a pilot bake-off against AWS Textract), but
 * nothing in the capture pipeline should call it directly. Swapping
 * providers, or falling back to the mock during local dev, should never
 * touch matching/review/allocation logic.
 */

export type ExtractedLineItem = {
  description: string;
  amount: number;
};

export type ExtractedInvoice = {
  vendorName: string | null;
  poNumber: string | null;
  /** ISO date string (YYYY-MM-DD), or null if not extracted. */
  invoiceDate: string | null;
  totalAmount: number | null;
  lineItems: ExtractedLineItem[];
  /** Overall confidence, 0–1. Drives Mid-tier confidence-based routing
   * (Addendum 1.A) — Core tier reviews everything regardless. */
  confidence: number;
};

export interface DocumentExtractionAdapter {
  readonly provider: string;
  extractInvoice(fileBuffer: Buffer, mimeType: string): Promise<ExtractedInvoice>;
}
