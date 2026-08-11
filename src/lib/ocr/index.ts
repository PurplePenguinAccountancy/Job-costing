import type { DocumentExtractionAdapter } from "./adapter";
import { MockExtractionAdapter } from "./mock-adapter";
import { AzureDocumentIntelligenceAdapter } from "./azure-adapter";

export type { DocumentExtractionAdapter, ExtractedInvoice, ExtractedLineItem } from "./adapter";

let cached: DocumentExtractionAdapter | null = null;

/**
 * Real Azure Document Intelligence if credentials are configured, the mock
 * otherwise — so the capture pipeline never has to know which is active.
 * Falls back to the mock (with a loud warning) rather than throwing, so
 * local dev keeps working without an Azure account.
 */
export function getDocumentExtractionAdapter(): DocumentExtractionAdapter {
  if (cached) return cached;

  if (process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY) {
    cached = new AzureDocumentIntelligenceAdapter();
  } else {
    console.warn(
      "[ocr] AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/KEY not set — using MockExtractionAdapter. " +
        "Fine for local dev, not for anything real.",
    );
    cached = new MockExtractionAdapter();
  }
  return cached;
}
