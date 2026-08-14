import Link from "next/link";
import { auth } from "@/auth";
import { getMembership, listTenantMembers } from "@/db/queries/auth";
import { inviteAction, changeRoleAction, removeAction, revokeAction } from "./actions";
import styles from "./team.module.css";

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenantId } = await params;
  const { error } = await searchParams;
  const session = await auth();
  const actingUserId = session!.user!.id!;

  const [actingMembership, members] = await Promise.all([
    getMembership(tenantId, actingUserId),
    listTenantMembers(tenantId, actingUserId),
  ]);
  const isEditor = actingMembership?.role === "editor";

  // Bound here (not defined here) — see actions.ts for why these live in
  // their own "use server" module rather than as nested closures.
  const boundInvite = inviteAction.bind(null, tenantId);
  const boundChangeRole = changeRoleAction.bind(null, tenantId);
  const boundRemove = removeAction.bind(null, tenantId);
  const boundRevoke = revokeAction.bind(null, tenantId);

  return (
    <div className={styles.page}>
      <Link href={`/t/${tenantId}`} className={styles.back}>
        ← Dashboard
      </Link>
      <h1>Team</h1>
      <p className={styles.hint}>
        Who has access to this tenant. Editors see and act on everything; viewers are read-only.
        {!isEditor ? " You're a viewer here, so these controls are read-only for you." : ""}
      </p>
      {error ? <p className={styles.error}>{decodeURIComponent(error)}</p> : null}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>2FA</th>
            <th>Status</th>
            {isEditor ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.membershipId}>
              <td>{m.email}</td>
              <td>{m.name}</td>
              <td>
                {isEditor ? (
                  <form action={boundChangeRole} className={styles.inlineForm}>
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                    <select name="role" defaultValue={m.role}>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button type="submit" className={styles.smallButton}>
                      Update
                    </button>
                  </form>
                ) : (
                  m.role
                )}
              </td>
              <td>
                {m.totpEnabled ? (
                  <span className={styles.statusOk}>Enabled</span>
                ) : m.hasPassword ? (
                  <span className={styles.statusWarn}>Not enrolled</span>
                ) : (
                  <span className={styles.statusWarn}>Setup pending</span>
                )}
              </td>
              <td>{m.isLocked ? "Locked" : "Active"}</td>
              {isEditor ? (
                <td className={styles.actions}>
                  <form action={boundRevoke}>
                    <input type="hidden" name="userId" value={m.userId} />
                    <button type="submit" className={styles.smallButton}>
                      Sign out everywhere
                    </button>
                  </form>
                  <form action={boundRemove}>
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                    <button type="submit" className={styles.smallDangerButton}>
                      Remove
                    </button>
                  </form>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {isEditor ? (
        <section>
          <h2>Invite someone</h2>
          <p className={styles.hint}>
            If they&apos;re new to Wayleave, we&apos;ll send a one-time link to set a password and enable 2FA.
            Already have an account elsewhere? They just gain access here immediately — no new setup needed.
          </p>
          <form action={boundInvite} className={styles.inlineForm}>
            <input name="email" type="email" placeholder="email@example.com" required />
            <input name="name" placeholder="Name (optional)" />
            <select name="role" defaultValue="viewer">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button type="submit" className={styles.addButton}>
              Invite
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
