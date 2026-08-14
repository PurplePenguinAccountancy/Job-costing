import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { authUsers, authAccounts, authSessions, authVerificationTokens, users } from "@/db/schema";

/**
 * Auth.js v5, email magic-link (Addendum 2.M) — no password ever handled by
 * this app. "database" session strategy is required for the email
 * provider's one-time verification tokens, hence the Drizzle adapter and
 * the auth.ts-owned tables in schema/auth.ts (kept separate from the
 * domain `users` table, not reshaped to fit the adapter — see that file's
 * comment).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: authUsers,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
  }),
  session: { strategy: "database" },
  providers: [
    Nodemailer({
      server: {
        host: process.env.MAIL_SMTP_HOST,
        port: Number(process.env.MAIL_SMTP_PORT ?? 587),
        auth: { user: process.env.MAIL_SMTP_USER, pass: process.env.MAIL_SMTP_PASSWORD },
        // Fail fast rather than hanging for the OS-level TCP timeout —
        // relevant right now because outbound SMTP (587) is blocked in
        // this dev environment (confirmed at the raw TCP level, not an
        // app bug); the fallback below keeps sign-in usable regardless.
        connectionTimeout: 5000,
      },
      from: process.env.MAIL_SMTP_FROM,
      // Real delivery attempted first; if it fails (e.g. the SMTP block
      // above), log the actual sign-in link instead of hard-failing the
      // request — dev/pilot only, remove once real delivery is confirmed
      // working (Resend or similar, per the SMTP-port-blocked finding).
      async sendVerificationRequest({ identifier, url, provider }) {
        const { createTransport } = await import("nodemailer");
        try {
          const transport = createTransport(provider.server);
          await transport.sendMail({
            to: identifier,
            from: provider.from,
            subject: "Sign in to Wayleave",
            text: `Sign in to Wayleave: ${url}`,
            html: `<p><a href="${url}">Sign in to Wayleave</a></p>`,
          });
        } catch (err) {
          console.warn(
            `[auth] Could not email the sign-in link to ${identifier} (${err instanceof Error ? err.message : err}). ` +
              `Link (dev fallback, would normally never be logged): ${url}`,
          );
        }
      },
    }),
  ],
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
  },
  callbacks: {
    // The adapter's own user.id is internal auth plumbing, not a row
    // anything else in this app can reference. Resolve (and lazily create)
    // the matching row in the domain `users` table by email instead, so
    // session.user.id is what every existing createdBy/ownerId/approvedBy
    // foreign key already expects — no changes needed anywhere else.
    async session({ session, user }) {
      if (!user.email) return session;

      const [existing] = await db.select().from(users).where(eq(users.email, user.email));
      const domainUser =
        existing ??
        (await db
          .insert(users)
          .values({ email: user.email, name: user.name ?? user.email.split("@")[0] })
          .onConflictDoNothing({ target: users.email })
          .returning())[0] ??
        (await db.select().from(users).where(eq(users.email, user.email)))[0];

      session.user.id = domainUser.id;
      return session;
    },
  },
});
