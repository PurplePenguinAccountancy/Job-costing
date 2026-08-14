import { signIn } from "@/auth";
import styles from "./signin.module.css";

export default function SignInPage() {
  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") || "").trim();
    if (!email) throw new Error("Email is required.");
    await signIn("nodemailer", { email, redirectTo: "/" });
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1>Wayleave</h1>
        <p className={styles.hint}>
          Sign in with your email — no password. We&apos;ll send a one-time link.
        </p>
        <form action={sendMagicLink} className={styles.form}>
          <input
            type="email"
            name="email"
            placeholder="you@example.com"
            required
            className={styles.input}
          />
          <button type="submit" className={styles.submit}>
            Send sign-in link
          </button>
        </form>
      </div>
    </div>
  );
}
