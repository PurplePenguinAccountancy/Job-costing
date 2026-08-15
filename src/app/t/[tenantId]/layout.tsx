import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getMembership, getUserTenants } from "@/db/queries/auth";
import { AppShell } from "./AppShell";

/**
 * The real access-control gate for every /t/[tenantId] route — both "is
 * anyone signed in" and "does this specific user belong to this specific
 * tenant" (tenant_memberships). No middleware.ts: Next.js middleware runs
 * on the Edge runtime by default, which can't load the Postgres-backed
 * auth adapter (drags in Node-only modules like `stream` via `postgres`/
 * `nodemailer`) — this layout runs as a normal Node.js server component
 * instead, so the full DB-backed check just works, and it's still exactly
 * one choke point since every nested route sits under it.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/signin");
  }

  const membership = await getMembership(tenantId, session.user.id);
  if (!membership) {
    return (
      <div style={{ padding: "2.5rem 2rem" }}>
        <p>
          {session.user.email} doesn&apos;t have access to this tenant.{" "}
          <Link href="/">Back to your tenants</Link>
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <button type="submit">Sign out</button>
        </form>
      </div>
    );
  }

  const tenants = await getUserTenants(session.user.id);
  const tenantName = tenants.find((t) => t.id === tenantId)?.name ?? "Tenant";

  return (
    <AppShell tenantId={tenantId} tenantName={tenantName} role={membership.role} userEmail={session.user.email ?? ""}>
      {children}
    </AppShell>
  );
}
