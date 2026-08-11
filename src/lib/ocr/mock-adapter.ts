import type { DocumentExtractionAdapter, ExtractedInvoice } from "./adapter";

/**
 * Dev-only stand-in — no Azure Document Intelligence account exists yet.
 * Parses simple "Key: Value" lines out of the file content as if OCR had
 * already run (e.g. "Vendor: Northline Cabling Ltd\nPO: PO-1042\n..."),
 * which is enough to build and test the rest of the pipeline (PO matching,
 * review states, confidence routing) without live OCR. Swap for
 * AzureDocumentIntelligenceAdapter once credentials exist.
 */
export class MockExtractionAdapter implements DocumentExtractionAdapter {
  readonly provider = "mock";

  async extractInvoice(fileBuffer: Buffer): Promise<ExtractedInvoice> {
    const text = fileBuffer.toString("utf-8");
    const field = (key: string): string | null => {
      const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
      return match ? match[1].trim() : null;
    };

    const vendorName = field("Vendor");
    const poNumber = field("PO");
    const invoiceDate = field("Date");
    const totalRaw = field("Total");
    const totalAmount = totalRaw ? parseFloat(totalRaw.replace(/[^\d.]/g, "")) || null : null;

    // Confident only when every field parsed — an incomplete "document"
    // (missing vendor/PO/total) is exactly the low-confidence case the
    // review queue exists for (Addendum 2.G).
    const confidence = vendorName && poNumber && totalAmount !== null ? 0.95 : 0.4;

    return {
      vendorName,
      poNumber,
      invoiceDate,
      totalAmount,
      lineItems: totalAmount !== null ? [{ description: vendorName ?? "Line item", amount: totalAmount }] : [],
      confidence,
    };
  }
}
