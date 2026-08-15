import { redirect } from "next/navigation";
import { getUserByEmail, isLockedOut, recordFailedLogin, resetFailedLogins } from "@/db/queries/auth";
import { verifyPassword } from "@/lib/security/password";
import { signToken } from "@/lib/security/tokens";
import { BrandMark } from "@/app/BrandMark";
import styles from "./signin.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Invalid email or password.",
  locked: "Too many failed attempts — this account is temporarily locked. Try again in a few minutes.",
  expired: "That sign-in attempt expired. Please start again.",
  not_set_up: "This account hasn't finished setup yet. Use the setup link you were emailed.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function submitPassword(formData: FormData) {
    "use server";
    const email = String(formData.get("email") || "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") || "");

    const user = email ? await getUserByEmail(email) : null;

    // Same generic outcome whether the email doesn't exist, the account
    // isn't set up yet, or the password is wrong — a distinct message for
    // "no such account" would let an attacker enumerate real email
    // addresses. Lockout is the one exception (see below): by the time an
    // account is locked, an attacker already knows it exists.
    if (!user || !user.passwordHash) {
      if (user) await recordFailedLogin(user.id);
      redirect("/signin?error=invalid");
    }

    if (isLockedOut(user)) {
      redirect("/signin?error=locked");
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await recordFailedLogin(user.id);
      redirect("/signin?error=invalid");
    }

    if (!user.totpEnabled) {
      // Password correct but 2FA was never completed — shouldn't happen
      // for an account that finished setup (mandatory enrollment), but a
      // real password match here must never be enough to sign in alone.
      redirect("/signin?error=not_set_up");
    }

    await resetFailedLogins(user.id);
    const bridgeToken = signToken({ userId: user.id, purpose: "totp-pending" }, 300);
    redirect(`/signin/totp?token=${encodeURIComponent(bridgeToken)}`);
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <BrandMark />
        <h1>Sign in</h1>
        <p className={styles.hint}>Enter your email and password to continue.</p>
        {error ? <p className={styles.error}>{ERROR_MESSAGES[error] ?? "Something went wrong."}</p> : null}
        <form action={submitPassword} className={styles.form}>
          <input type="email" name="email" placeholder="you@example.com" required className={styles.input} />
          <input type="password" name="password" placeholder="Password" required className={styles.input} />
          <button type="submit" className={styles.submit}>
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
