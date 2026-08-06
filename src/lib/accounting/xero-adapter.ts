import { xeroRequest } from "@/lib/xero/client";
import type {
  AccountingAdapter,
  AccountingCapabilities,
  OrganisationSummary,
  TrackingCategory,
} from "./adapter";

const XERO_CAPABILITIES: AccountingCapabilities = {
  supports: {
    trackingCategories: true,
    attachments: true,
    manualJournals: true,
    profitAndLossReport: true,
    trialBalanceReport: true,
  },
  maxTrackingCategories: 2,
  maxOptionsPerTrackingCategory: 100,
  maxTrackingCategoriesOnPayrollTransactions: 1,
};

type XeroOrganisationResponse = {
  Organisations: { Name: string; BaseCurrency: string }[];
};

type XeroTrackingCategoriesResponse = {
  TrackingCategories: {
    TrackingCategoryID: string;
    Name: string;
    Options: { TrackingOptionID: string; Name: string }[];
  }[];
};

export class XeroAdapter implements AccountingAdapter {
  readonly platform = "xero" as const;
  readonly capabilities = XERO_CAPABILITIES;

  async getOrganisation(): Promise<OrganisationSummary> {
    const data = await xeroRequest<XeroOrganisationResponse>("/Organisation");
    const org = data.Organisations[0];
    return { name: org.Name, baseCurrency: org.BaseCurrency };
  }

  async listTrackingCategories(): Promise<TrackingCategory[]> {
    const data = await xeroRequest<XeroTrackingCategoriesResponse>("/TrackingCategories");
    return data.TrackingCategories.map((c) => ({
      id: c.TrackingCategoryID,
      name: c.Name,
      options: c.Options.map((o) => ({ id: o.TrackingOptionID, name: o.Name })),
    }));
  }

  async ensureTrackingCategoryOption(categoryName: string, optionName: string) {
    const categories = await this.listTrackingCategories();
    const category = categories.find((c) => c.name === categoryName);
    if (!category) {
      throw new Error(
        `Tracking category "${categoryName}" doesn't exist in Xero yet. Xero allows at most ` +
          `${this.capabilities.maxTrackingCategories} active categories, so creating one is a ` +
          `deliberate setup choice, not something this ever does automatically — create it in ` +
          `Xero (Settings > Tracking categories) first.`,
      );
    }

    const existing = category.options.find((o) => o.name === optionName);
    if (existing) {
      return { categoryId: category.id, optionId: existing.id };
    }

    const max = this.capabilities.maxOptionsPerTrackingCategory;
    if (max !== undefined && category.options.length >= max) {
      throw new Error(
        `Tracking category "${categoryName}" is already at Xero's ${max}-option limit — cannot add "${optionName}".`,
      );
    }

    await xeroRequest(`/TrackingCategories/${category.id}/Options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Name: optionName }),
    });

    // Xero's create-option response shape isn't worth hand-parsing —
    // re-fetch and look the new option up by name, staying correct rather
    // than assuming a particular response envelope.
    const refreshed = await this.listTrackingCategories();
    const refreshedCategory = refreshed.find((c) => c.id === category.id);
    const newOption = refreshedCategory?.options.find((o) => o.name === optionName);
    if (!newOption) {
      throw new Error(`Created tracking option "${optionName}" but couldn't find it on re-fetch`);
    }
    return { categoryId: category.id, optionId: newOption.id };
  }
}
