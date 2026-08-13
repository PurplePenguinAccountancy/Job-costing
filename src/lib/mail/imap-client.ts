import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export type FetchedEmailAttachment = {
  filename: string;
  mimeType: string;
  content: Buffer;
};

export type FetchedEmail = {
  uid: number;
  from: string | null;
  subject: string | null;
  attachments: FetchedEmailAttachment[];
};

/**
 * Dev/pilot inbound-invoice path — Addendum 2.N's real production route
 * (AWS SES + a dedicated per-tenant address) is still pending an AWS
 * account. Polls a single shared IMAP mailbox for unseen messages, pulls
 * out non-inline attachments (inline images are almost always signature
 * logos, not invoices), and marks each message seen once handled so a poll
 * never processes the same email twice.
 */
export async function fetchUnseenInvoiceEmails(): Promise<FetchedEmail[]> {
  const host = process.env.MAIL_IMAP_HOST;
  const user = process.env.MAIL_IMAP_USER;
  const pass = process.env.MAIL_IMAP_PASSWORD;
  if (!host || !user || !pass) {
    throw new Error("MAIL_IMAP_HOST/USER/PASSWORD are not set — see .env.example.");
  }

  const client = new ImapFlow({
    host,
    port: process.env.MAIL_IMAP_PORT ? Number(process.env.MAIL_IMAP_PORT) : 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const results: FetchedEmail[] = [];
  const uids: number[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch({ seen: false }, { source: true, envelope: true })) {
        const parsed = await simpleParser(message.source!);
        const attachments = parsed.attachments
          .filter((a) => a.contentDisposition !== "inline")
          .map((a) => ({
            filename: a.filename ?? `attachment-${message.uid}`,
            mimeType: a.contentType,
            content: a.content,
          }));

        results.push({
          uid: message.uid,
          from: parsed.from?.text ?? null,
          subject: parsed.subject ?? null,
          attachments,
        });
        uids.push(message.uid);
      }

      // Flagging must happen after the fetch stream is fully drained, not
      // per-message inside the loop — issuing a STORE command while a FETCH
      // response is still being iterated deadlocks the connection (the
      // server won't respond to the new command until the client finishes
      // reading the FETCH it already started). Batch it into one call
      // instead. Marks everything found regardless of whether it carried
      // attachments — a reply, bounce, or plain-text email with no invoice
      // shouldn't be re-fetched on every subsequent poll either.
      if (uids.length > 0) {
        await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return results;
}
