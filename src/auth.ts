import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getUserById, isLockedOut, recordFailedLogin, resetFailedLogins, consumeBackupCode } from "@/db/queries/auth";
import { verifyTotpCode } from "@/lib/security/totp";
import { decryptSecret } from "@/lib/security/encryption";
import { hashBackupCode } from "@/lib/security/backup-codes";
import { verifyToken } from "@/lib/security/tokens";

class LockedOutError extends CredentialsSignin {
  code = "locked_out";
}
class InvalidCodeError extends CredentialsSignin {
  code = "invalid_code";
}
class ExpiredStepError extends CredentialsSignin {
  code = "expired_step";
}

/**
 * Password + mandatory TOTP 2FA (explicit security/GDPR priority — email
 * magic-link was judged a higher risk and removed entirely). The password
 * step itself happens BEFORE this provider is ever invoked (see
 * app/signin/page.tsx's server action) — this authorize() only ever sees
 * the second factor, proven via a short-lived signed "bridge" token that
 * carries the already-verified userId across from the password page.
 * Credentials requires JWT sessions (Auth.js does not support the
 * database session strategy for this provider) — see users.tokenVersion
 * for how a session still gets a real, immediate revocation path despite
 * that.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    Credentials({
      credentials: {
        bridgeToken: { type: "text" },
        totpCode: { type: "text" },
        backupCode: { type: "text" },
      },
      async authorize(credentials) {
        const bridgeToken = credentials?.bridgeToken as string | undefined;
        const totpCode = credentials?.totpCode as string | undefined;
        const backupCode = credentials?.backupCode as string | undefined;
        if (!bridgeToken || (!totpCode && !backupCode)) return null;

        const payload = verifyToken<{ userId: string; purpose: string }>(bridgeToken);
        if (!payload || payload.purpose !== "totp-pending") throw new ExpiredStepError();

        const user = await getUserById(payload.userId);
        if (!user || !user.totpEnabled || !user.totpSecretEncrypted) return null;
        if (isLockedOut(user)) throw new LockedOutError();

        const verified = totpCode
          ? verifyTotpCode(decryptSecret(user.totpSecretEncrypted), totpCode)
          : await consumeBackupCode(user.id, hashBackupCode(backupCode!));

        if (!verified) {
          await recordFailedLogin(user.id);
          throw new InvalidCodeError();
        }

        await resetFailedLogins(user.id);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Fresh sign-in — pin the tokenVersion in effect right now.
        const dbUser = await getUserById(user.id!);
        token.tokenVersion = dbUser?.tokenVersion ?? 0;
        return token;
      }
      // Every subsequent request: re-check against the DB. A bump to
      // tokenVersion (see revokeAllSessions) invalidates every JWT for
      // this user immediately — the incident-response lever a pure JWT
      // strategy doesn't otherwise give you, since there's no server-side
      // session row to delete.
      if (token.sub) {
        const dbUser = await getUserById(token.sub);
        if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
          token.revoked = true;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.revoked) {
        // Every existing page in this app already gates on session.user.id
        // being present, so clearing it here is enough to make a revoked
        // JWT behave exactly like "signed out" everywhere, with no changes
        // needed elsewhere.
        session.user = undefined as never;
        return session;
      }
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
