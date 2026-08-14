import { and, eq } from "drizzle-orm";
import { withTenant, withUser } from "@/db";
import { tenants, tenantMemberships } from "@/db/schema";

export type UserTenant = { id: string; name: string; role: "editor" | "viewer" };

/** Every tenant the signed-in user belongs to — the bootstrap query, before any tenant is selected. */
export function getUserTenants(userId: string): Promise<UserTenant[]> {
  return withUser(userId, (tx) =>
    tx
      .select({ id: tenants.id, name: tenants.name, role: tenantMemberships.role })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(eq(tenantMemberships.userId, userId))
      .orderBy(tenants.name),
  );
}

/**
 * Whether the signed-in user actually belongs to this tenant — the real
 * access-control check for every /t/[tenantId] route (middleware only
 * confirms *someone* is signed in, not that they belong to this specific
 * tenant; see src/app/t/[tenantId]/layout.tsx).
 */
export async function getMembership(tenantId: string, userId: string) {
  return withTenant(tenantId, userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)));
    return row ?? null;
  });
}
