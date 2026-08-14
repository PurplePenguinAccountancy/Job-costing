import { redirect } from "next/navigation";
import { verifyPasswordSetupToken, markSetupTokenUsed, setUserPassword, getUserById } from "@/db/queries/auth";
import { hashPassword, validatePasswordStrength, MIN_PASSWORD_LENGTH } from "@/lib/security/password";
import { signToken } from "@/lib/security/tokens";
import styles from "../signin/signin.module.css";

export default async function SetupAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1>Invalid link</h1>
          <p className={styles.hint}>This setup link is missing its token. Ask for a new one.</p>
        </div>
      </div>
    );
  }

  const verified = await verifyPasswordSetupToken(token);
  if (!verified) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1>Link expired</h1>
          <p className={styles.hint}>
            This setup link has already been used or has expired. Ask whoever invited you for a new one.
          </p>
        </div>
      </div>
    );
  }

  async function submitPassword(formData: FormData) {
    "use server";
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    const strengthError = validatePasswordStrength(password);
    if (strengthError) {
      redirect(`/setup-account?token=${encodeURIComponent(token!)}&error=${encodeURIComponent(strengthError)}`);
    }
    if (password !== confirmPassword) {
      redirect(`/setup-account?token=${encodeURIComponent(token!)}&error=Passwords+don't+match.`);
    }

    const userId = verified!.userId;
    const passwordHash = await hashPassword(password);
    await setUserPassword(userId, passwordHash);
    await markSetupTokenUsed(verified!.tokenId);

    const bridgeToken = signToken({ userId, purpose: "totp-enroll" }, 600);
    redirect(`/setup-account/totp?token=${encodeURIComponent(bridgeToken)}`);
  }

  const user = await getUserById(verified.userId);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1>Set your password</h1>
        <p className={styles.hint}>
          {user?.email} — choose a password at least {MIN_PASSWORD_LENGTH} characters long. A long passphrase is
          stronger (and easier to remember) than a short complex one.
        </p>
        {error ? <p className={styles.error}>{decodeURIComponent(error)}</p> : null}
        <form action={submitPassword} className={styles.form}>
          <input
            type="password"
            name="password"
            placeholder="Password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            className={styles.input}
          />
          <input
            type="password"
            name="confirmPassword"
            placeholder="Confirm password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            className={styles.input}
          />
          <button type="submit" className={styles.submit}>
            Continue to 2FA setup
          </button>
        </form>
      </div>
    </div>
  );
}
