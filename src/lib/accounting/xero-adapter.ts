import { xeroRequest } from "@/lib/xero/client";
import type {
  AccountingAdapter,
  AccountingCapabilities,
  Account,
  AccountBalance,
  BillLineItem,
  Contact,
  OrganisationSummary,
} from "./adapter";

const XERO_CAPABILITIES: AccountingCapabilities = {
  supports: {
    chartOfAccounts: true,
    attachments: true,
    manualJournals: true,
    profitAndLossReport: true,
    trialBalanceReport: true,
  },
};

type XeroOrganisationResponse = {
  Organisations: { Name: string; BaseCurrency: string }[];
};

type XeroAccountsResponse = {
  Accounts: { AccountID: string; Code: string; Name: string; Type: string; Class: string; Status: string }[];
};

type XeroContactsResponse = {
  Contacts: { ContactID: string; Name: string }[];
};

type XeroInvoicesResponse = {
  Invoices: { InvoiceID: string }[];
};

type XeroReportCell = { Value?: string; Attributes?: { Value: string; Id: string }[] };
type XeroReportRow = { RowType: string; Title?: string; Cells?: XeroReportCell[]; Rows?: XeroReportRow[] };
type XeroReportsResponse = { Reports: { Rows: XeroReportRow[] }[] };

// Xero account Types that represent Cost of Sales / direct expense —
// candidates for the cost-type mapping (Addendum 2.B/2.J). "OVERHEADS" and
// other expense types are deliberately excluded: this product is Sales/
// Direct-Costs-only down to GP (brief section 10), never overhead.
const COST_OF_SALES_TYPES = new Set(["DIRECTCOSTS"]);

function collectDataRows(rows: XeroReportRow[], out: XeroReportRow[]) {
  for (const row of rows) {
    if (row.RowType === "Row" && row.Cells) out.push(row);
    if (row.Rows) collectDataRows(row.Rows, out);
  }
}

export class XeroAdapter implements AccountingAdapter {
  readonly platform = "xero" as const;
  readonly capabilities = XERO_CAPABILITIES;

  async getOrganisation(): Promise<OrganisationSummary> {
    const data = await xeroRequest<XeroOrganisationResponse>("/Organisation");
    const org = data.Organisations[0];
    return { name: org.Name, baseCurrency: org.BaseCurrency };
  }

  async listCostOfSalesAccounts(): Promise<Account[]> {
    const data = await xeroRequest<XeroAccountsResponse>(
      `/Accounts?where=${encodeURIComponent('Status=="ACTIVE"')}`,
    );
    return data.Accounts.filter((a) => COST_OF_SALES_TYPES.has(a.Type)).map((a) => ({
      id: a.AccountID,
      code: a.Code,
      name: a.Name,
      type: a.Type,
    }));
  }

  async createCostOfSalesAccount(input: { code: string; name: string }): Promise<Account> {
    const data = await xeroRequest<XeroAccountsResponse>("/Accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Accounts: [{ Code: input.code, Name: input.name, Type: "DIRECTCOSTS" }] }),
    });
    const created = data.Accounts[0];
    return { id: created.AccountID, code: created.Code, name: created.Name, type: created.Type };
  }

  async getAccountBalances(): Promise<AccountBalance[]> {
    const today = new Date().toISOString().slice(0, 10);
    const data = await xeroRequest<XeroReportsResponse>(`/Reports/TrialBalance?date=${today}`);
    const dataRows: XeroReportRow[] = [];
    collectDataRows(data.Reports[0]?.Rows ?? [], dataRows);

    const balances: AccountBalance[] = [];
    for (const row of dataRows) {
      const cells = row.Cells!;
      const accountId = cells[0]?.Attributes?.find((a) => a.Id === "account")?.Value;
      if (!accountId) continue; // total/summary rows carry no account attribute
      const ytdDebit = parseFloat(cells[3]?.Value || "0") || 0;
      const ytdCredit = parseFloat(cells[4]?.Value || "0") || 0;
      balances.push({ accountId, accountName: cells[0]?.Value ?? "", balance: ytdDebit - ytdCredit });
    }
    return balances;
  }

  async findOrCreateContact(name: string): Promise<Contact> {
    // Xero's `where` clause needs the value's own quotes escaped — doesn't
    // yet handle every special character a real contact name could contain
    // (e.g. unescaped backslashes); fine for now, revisit with the capture
    // pipeline where contact names come from OCR'd documents.
    const escaped = name.replace(/"/g, '\\"');
    const existing = await xeroRequest<XeroContactsResponse>(
      `/Contacts?where=${encodeURIComponent(`Name=="${escaped}"`)}`,
    );
    if (existing.Contacts.length > 0) {
      const c = existing.Contacts[0];
      return { id: c.ContactID, name: c.Name };
    }

    const created = await xeroRequest<XeroContactsResponse>("/Contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Contacts: [{ Name: name }] }),
    });
    const c = created.Contacts[0];
    return { id: c.ContactID, name: c.Name };
  }

  async createBill(input: {
    contactId: string;
    date: string;
    dueDate?: string;
    reference?: string;
    lineItems: BillLineItem[];
  }): Promise<{ id: string }> {
    const data = await xeroRequest<XeroInvoicesResponse>("/Invoices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Invoices: [
          {
            Type: "ACCPAY",
            Contact: { ContactID: input.contactId },
            Date: input.date,
            DueDate: input.dueDate ?? input.date,
            Reference: input.reference,
            // Addendum 1.A: approval already happened in Wayleave before
            // this is ever called — Xero doesn't need a second draft review.
            Status: "AUTHORISED",
            LineItems: input.lineItems.map((li) => ({
              Description: li.description,
              AccountCode: li.accountCode,
              LineAmount: li.amount,
            })),
          },
        ],
      }),
    });
    return { id: data.Invoices[0].InvoiceID };
  }

  async attachFileToBill(
    billId: string,
    fileName: string,
    mimeType: string,
    content: Buffer,
  ): Promise<void> {
    await xeroRequest(`/Invoices/${billId}/Attachments/${encodeURIComponent(fileName)}`, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: new Uint8Array(content),
    });
  }
}
