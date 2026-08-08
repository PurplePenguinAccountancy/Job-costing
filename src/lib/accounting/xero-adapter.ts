import { xeroRequest } from "@/lib/xero/client";
import type { AccountingAdapter, AccountingCapabilities, Account, OrganisationSummary } from "./adapter";

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

// Xero account Types that represent Cost of Sales / direct expense —
// candidates for the cost-type mapping (Addendum 2.B/2.J). "OVERHEADS" and
// other expense types are deliberately excluded: this product is Sales/
// Direct-Costs-only down to GP (brief section 10), never overhead.
const COST_OF_SALES_TYPES = new Set(["DIRECTCOSTS"]);

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
      body: JSON.stringify({ Code: input.code, Name: input.name, Type: "DIRECTCOSTS" }),
    });
    const created = data.Accounts[0];
    return { id: created.AccountID, code: created.Code, name: created.Name, type: created.Type };
  }
}
