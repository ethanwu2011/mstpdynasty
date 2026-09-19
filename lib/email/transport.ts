/**
 * Email transport. Resend when RESEND_API_KEY is set, otherwise none (every caller then
 * reports "not configured"). Tests inject a fake with setEmailTransportForTests().
 */
import { Resend } from "resend";
import { emailFrom } from "@/lib/env";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface EmailTransport {
  readonly name: string;
  /**
   * Send every message (one API call per 100). `idempotencyKey` makes a retry within 24 h a
   * no-op on Resend's side, so a crash between "sent" and "marked sent" never double-sends.
   */
  send(messages: EmailMessage[], opts?: { idempotencyKey?: string }): Promise<{ ids: string[] }>;
}

const BATCH_LIMIT = 100;

function resendTransport(apiKey: string): EmailTransport {
  const client = new Resend(apiKey);
  const from = emailFrom();
  return {
    name: "resend",
    async send(messages, opts = {}) {
      const ids: string[] = [];
      if (messages.length === 1) {
        const [m] = messages;
        const { data, error } = await client.emails.send(
          { from, to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers },
          opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
        );
        if (error || !data) throw new Error(`Resend: ${error?.message ?? "no response"}`);
        return { ids: [data.id] };
      }
      for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
        const chunk = messages.slice(i, i + BATCH_LIMIT);
        const key = opts.idempotencyKey ? `${opts.idempotencyKey}/${i / BATCH_LIMIT}` : undefined;
        const { data, error } = await client.batch.send(
          chunk.map((m) => ({ from, to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers })),
          key ? { idempotencyKey: key } : undefined,
        );
        if (error || !data) throw new Error(`Resend batch: ${error?.message ?? "no response"}`);
        for (const d of data.data) ids.push(d.id);
      }
      return { ids };
    },
  };
}

let override: EmailTransport | null | undefined;

/** Tests only: force a transport (or null for "not configured"). Pass undefined to reset. */
export function setEmailTransportForTests(t: EmailTransport | null | undefined): void {
  override = t;
}

export function getTransport(): EmailTransport | null {
  if (override !== undefined) return override;
  const key = process.env.RESEND_API_KEY;
  return key ? resendTransport(key) : null;
}
