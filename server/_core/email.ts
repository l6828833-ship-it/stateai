import { createHash, randomInt } from "node:crypto";

/**
 * Email delivery via Brevo (https://www.brevo.com), formerly Sendinblue.
 *
 * - If `BREVO_API_KEY` is set, real emails are sent through the Brevo
 *   transactional email API (POST /v3/smtp/email) using the sender parsed from
 *   `EMAIL_FROM` (or `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME`).
 * - Otherwise (local dev / provider not configured), the email is logged to the
 *   server console so the auth flow remains fully testable. The 6-digit code
 *   prints in the logs.
 *
 * To send real emails in production, set:
 *   BREVO_API_KEY=xkeysib-xxx
 *   EMAIL_FROM="EstateTour AI <no-reply@yourdomain.com>"
 *   # or, alternatively:
 *   # BREVO_SENDER_EMAIL=no-reply@yourdomain.com
 *   # BREVO_SENDER_NAME="EstateTour AI"
 *
 * Note: the sender email/domain must be a verified sender in your Brevo account.
 */

const OTP_TTL_MINUTES = 10;
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Read + sanitize the Brevo API key from the environment.
 *
 * A very common cause of Brevo's `401 {"message":"Key not found"}` is invisible
 * junk in the env value: a trailing newline (common when pasting into a secrets
 * UI), surrounding quotes, or an accidental `api-key:` / `Bearer ` prefix. We
 * strip all of that so a copy-paste slip doesn't look like an auth failure.
 * Returns undefined when nothing usable is configured.
 */
function getBrevoApiKey(): string | undefined {
  const raw = process.env.BREVO_API_KEY;
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .replace(/^(api-key|authorization|bearer)\s*[:=]?\s*/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  return cleaned || undefined;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Resolve the sender name/email from env. Accepts either the combined
 * `EMAIL_FROM` "Name <email@domain>" format or the discrete
 * `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` variables.
 */
function resolveSender(): { name: string; email: string } {
  const combined = process.env.EMAIL_FROM;
  if (combined) {
    const match = combined.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
    if (match) {
      return { name: match[1] || "EstateTour AI", email: match[2] };
    }
    // Bare email with no display name.
    if (combined.includes("@")) {
      return { name: "EstateTour AI", email: combined.trim() };
    }
  }
  return {
    name: process.env.BREVO_SENDER_NAME || "EstateTour AI",
    email: process.env.BREVO_SENDER_EMAIL || "no-reply@estatetour.ai",
  };
}

export type SendEmailResult = {
  /** True when Brevo accepted the message, or when logged in dev mode. */
  ok: boolean;
  /** True when no provider was configured and the email was only logged. */
  skipped?: boolean;
  /** Human-readable failure reason (surfaced to the caller on failure). */
  error?: string;
};

/**
 * Send an email via Brevo. Returns a structured result so callers can react to
 * (and surface) delivery failures instead of them being silently swallowed.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = getBrevoApiKey();

  if (!apiKey) {
    console.warn(
      `\n[email] BREVO_API_KEY is NOT set — the email was NOT sent, only logged.\n` +
        `  To: ${input.to}\n  Subject: ${input.subject}\n  ${input.text}\n`,
    );
    return { ok: true, skipped: true };
  }

  // Brevo v3 API keys look like `xkeysib-...`. Warn (don't block) on anything
  // else, since SMTP credentials and Marketing keys will fail with "Key not found".
  if (!apiKey.startsWith("xkeysib-")) {
    console.warn(
      `[email] BREVO_API_KEY does not look like a Brevo v3 API key (expected it to start with "xkeysib-"). ` +
        `If sending fails with 401 "Key not found", generate a v3 API key under Brevo → SMTP & API → API Keys.`,
    );
  }

  const sender = resolveSender();

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Extract Brevo's human message (e.g. "Sender not valid", IP not allowed).
      let reason = detail;
      try {
        const parsed = JSON.parse(detail) as { message?: string; code?: string };
        reason = parsed.message || parsed.code || detail;
      } catch {
        /* keep raw detail */
      }
      // Add actionable hints for the most common Brevo rejections.
      if (res.status === 401) {
        reason +=
          " — the BREVO_API_KEY is invalid or not recognized. Use a Brevo v3 API key " +
          '(starts with "xkeysib-", from SMTP & API → API Keys), with no quotes or extra spaces.';
      } else if (/sender/i.test(reason)) {
        reason += ` — verify the sender "${sender.email}" under Brevo → Senders, Domains & Dedicated IPs.`;
      }
      console.warn(
        `[email] Brevo REJECTED the send: ${res.status} ${res.statusText} — ${detail} ` +
          `(sender=${sender.email}, to=${input.to})`,
      );
      return { ok: false, error: `Brevo ${res.status}: ${reason}` };
    }

    console.log(`[email] Brevo accepted message to ${input.to} (from ${sender.email})`);
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn("[email] Network error calling Brevo:", msg);
    return { ok: false, error: `Brevo request error: ${msg}` };
  }
}

/** Generate a cryptographically-random, zero-padded 6-digit code. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** SHA-256 hash (hex) of a code — codes are never stored in plaintext. */
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Milliseconds until an OTP created now should expire. */
export function otpExpiryDate(): Date {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

/** Compose + send the verification-code email. */
export async function sendOtpEmail(
  to: string,
  code: string,
  purpose: "signup" | "login" | "reset",
): Promise<SendEmailResult> {
  const intro =
    purpose === "signup"
      ? "Welcome to EstateTour AI! Use the code below to verify your email and finish creating your account."
      : purpose === "login"
        ? "Use the code below to finish signing in."
        : "Use the code below to reset your password.";

  const subject = `${code} is your EstateTour AI verification code`;
  const text = `${intro}\n\nYour verification code is: ${code}\n\nThis code expires in ${OTP_TTL_MINUTES} minutes. If you didn't request it, you can ignore this email.`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#3A2E33;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
      <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#E894B5;"></span>
      <strong style="font-size:18px;">EstateTour AI</strong>
    </div>
    <p style="font-size:15px;line-height:1.6;color:#6b5b62;">${intro}</p>
    <div style="margin:28px 0;text-align:center;">
      <div style="display:inline-block;font-size:34px;letter-spacing:10px;font-weight:700;padding:18px 28px;border-radius:16px;background:#FFF0F6;color:#D9799F;border:1px solid #F7B8D0;">
        ${code}
      </div>
    </div>
    <p style="font-size:13px;color:#9a8b91;line-height:1.6;">This code expires in ${OTP_TTL_MINUTES} minutes. If you didn't request it, you can safely ignore this email.</p>
  </div>`;

  return sendEmail({ to, subject, html, text });
}
