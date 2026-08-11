import type { DocumentExtractionAdapter, ExtractedInvoice } from "./adapter";

const API_VERSION = "2024-11-30";
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30;

type AzureField = {
  valueString?: string;
  valueDate?: string;
  valueCurrency?: { amount: number };
  content?: string;
  confidence?: number;
  valueArray?: { valueObject?: Record<string, AzureField> }[];
};

type AzurePollResult = {
  status: "notStarted" | "running" | "succeeded" | "failed";
  error?: unknown;
  analyzeResult?: {
    documents?: { fields?: Record<string, AzureField> }[];
  };
};

function fieldValue(field: AzureField | undefined): string | null {
  if (!field) return null;
  return field.valueString ?? field.valueDate ?? field.content ?? null;
}

/**
 * Azure Document Intelligence, prebuilt invoice model — Addendum 2.G's
 * provisional choice. UNTESTED against a live account: this machine has no
 * Azure credentials configured. Written from Azure's documented API shape
 * (async analyze-then-poll, prebuilt-invoice field names), but treat the
 * response-parsing in particular as needing verification against a real
 * response before relying on it — field names/nesting are the most likely
 * thing to be subtly wrong without a live test.
 */
export class AzureDocumentIntelligenceAdapter implements DocumentExtractionAdapter {
  readonly provider = "azure-document-intelligence";

  async extractInvoice(fileBuffer: Buffer, mimeType: string): Promise<ExtractedInvoice> {
    const endpoint = requireEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
    const key = requireEnv("AZURE_DOCUMENT_INTELLIGENCE_KEY");

    const analyzeRes = await fetch(
      `${endpoint}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=${API_VERSION}`,
      {
        method: "POST",
        headers: { "Content-Type": mimeType, "Ocp-Apim-Subscription-Key": key },
        body: new Uint8Array(fileBuffer),
      },
    );
    if (!analyzeRes.ok) {
      throw new Error(
        `Azure Document Intelligence analyze request failed (${analyzeRes.status}): ${await analyzeRes.text()}`,
      );
    }

    const operationLocation = analyzeRes.headers.get("Operation-Location");
    if (!operationLocation) {
      throw new Error("Azure Document Intelligence did not return an Operation-Location header to poll");
    }

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollRes = await fetch(operationLocation, {
        headers: { "Ocp-Apim-Subscription-Key": key },
      });
      if (!pollRes.ok) {
        throw new Error(`Azure Document Intelligence poll failed (${pollRes.status}): ${await pollRes.text()}`);
      }

      const pollData = (await pollRes.json()) as AzurePollResult;
      if (pollData.status === "succeeded") return parseInvoiceResult(pollData);
      if (pollData.status === "failed") {
        throw new Error(`Azure Document Intelligence extraction failed: ${JSON.stringify(pollData.error)}`);
      }
    }

    throw new Error(
      `Azure Document Intelligence extraction did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
    );
  }
}

function parseInvoiceResult(pollData: AzurePollResult): ExtractedInvoice {
  const fields = pollData.analyzeResult?.documents?.[0]?.fields ?? {};

  const lineItems = (fields.Items?.valueArray ?? []).map((item) => ({
    description: fieldValue(item.valueObject?.Description) ?? "",
    amount: item.valueObject?.Amount?.valueCurrency?.amount ?? 0,
  }));

  return {
    vendorName: fieldValue(fields.VendorName),
    poNumber: fieldValue(fields.PurchaseOrder),
    invoiceDate: fieldValue(fields.InvoiceDate),
    totalAmount: fields.InvoiceTotal?.valueCurrency?.amount ?? null,
    lineItems,
    confidence: fields.VendorName?.confidence ?? 0.5,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — see .env.example. Azure Document Intelligence is provisional (Addendum 2.G), ` +
        "pending a pilot bake-off against AWS Textract before fully committing.",
    );
  }
  return value;
}
