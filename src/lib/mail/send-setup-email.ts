import { createTransport } from "nodemailer";

/**
 * Account-setup / password-reset links — the one remaining place email
 * still matters now that sign-in itself is password+TOTP, not magic-link.
 * Same graceful-degradation pattern already proven out for the old
 * magic-link sender: attempt real SMTP delivery, and on failure (e.g. the
 * outbound-587-blocked dev environment — see CLAUDE.md §19) log the URL
 * instead of hard-failing, so the flow stays testable regardless.
 */
export async function sendSetupEmail(params: {
  to: string;
  url: string;
  purpose: "initial_setup" | "reset";
}): Promise<void> {
  const subject = params.purpose === "reset" ? "Reset your Wayleave password" : "Set up your Wayleave account";
  const actionText = params.purpose === "reset" ? "Reset password" : "Set up account";

  try {
    const transport = createTransport({
      host: process.env.MAIL_SMTP_HOST,
      port: Number(process.env.MAIL_SMTP_PORT ?? 587),
      auth: { user: process.env.MAIL_SMTP_USER, pass: process.env.MAIL_SMTP_PASSWORD },
      connectionTimeout: 5000,
    });
    await transport.sendMail({
      to: params.to,
      from: process.env.MAIL_SMTP_FROM,
      subject,
      text: `${actionText}: ${params.url}`,
      html: `<p><a href="${params.url}">${actionText}</a></p>`,
    });
  } catch (err) {
    console.warn(
      `[mail] Could not email the ${params.purpose} link to ${params.to} (${err instanceof Error ? err.message : err}). ` +
        `Link (dev fallback, would normally never be logged): ${params.url}`,
    );
  }
}
