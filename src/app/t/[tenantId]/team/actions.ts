"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getMembership,
  inviteMember,
  updateMemberRole,
  removeMember,
  revokeAllSessions,
  createPasswordSetupToken,
} from "@/db/queries/auth";
import { sendSetupEmail } from "@/lib/mail/send-setup-email";

// Plain top-level "use server" functions, not nested closures inside the
// page component — passing a page-local closure as an argument to a
// shared error-handling helper broke Next.js's server-action
// serialization ("Functions cannot be passed directly to Client
// Components"), so the try/catch is duplicated per action here instead.
async function requireEditor(tenantId: string) {
  const session = await auth();
  const membership = await getMembership(tenantId, session!.user!.id!);
  if (membership?.role !== "editor") throw new Error("Only editors can manage team members.");
}

function reportError(tenantId: string, err: unknown): never {
  if (err && typeof err === "object" && "digest" in err) throw err; // Next.js redirect/notFound signal
  const message = err instanceof Error ? err.message : "Something went wrong.";
  redirect(`/t/${tenantId}/team?error=${encodeURIComponent(message)}`);
}

export async function inviteAction(tenantId: string, formData: FormData) {
  try {
    await requireEditor(tenantId);
    const email = String(formData.get("email") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const role = String(formData.get("role") || "viewer") as "editor" | "viewer";
    if (!email) throw new Error("Email is required.");

    const session = await auth();
    const { userId, needsSetup } = await inviteMember(tenantId, session!.user!.id!, { email, name, role });

    if (needsSetup) {
      const token = await createPasswordSetupToken(userId, "initial_setup");
      const url = `${process.env.APP_URL}/setup-account?token=${token}`;
      await sendSetupEmail({ to: email, url, purpose: "initial_setup" });
    }
  } catch (err) {
    reportError(tenantId, err);
  }
  revalidatePath(`/t/${tenantId}/team`);
}

export async function changeRoleAction(tenantId: string, formData: FormData) {
  try {
    await requireEditor(tenantId);
    const membershipId = String(formData.get("membershipId"));
    const role = String(formData.get("role")) as "editor" | "viewer";
    const session = await auth();
    await updateMemberRole(tenantId, session!.user!.id!, membershipId, role);
  } catch (err) {
    reportError(tenantId, err);
  }
  revalidatePath(`/t/${tenantId}/team`);
}

export async function removeAction(tenantId: string, formData: FormData) {
  try {
    await requireEditor(tenantId);
    const membershipId = String(formData.get("membershipId"));
    const session = await auth();
    await removeMember(tenantId, session!.user!.id!, membershipId);
  } catch (err) {
    reportError(tenantId, err);
  }
  revalidatePath(`/t/${tenantId}/team`);
}

export async function revokeAction(tenantId: string, formData: FormData) {
  try {
    await requireEditor(tenantId);
    const userId = String(formData.get("userId"));
    await revokeAllSessions(userId);
  } catch (err) {
    reportError(tenantId, err);
  }
  revalidatePath(`/t/${tenantId}/team`);
}
