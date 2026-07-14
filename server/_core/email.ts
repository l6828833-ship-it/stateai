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

/** Returns true when the message was accepted (or logged in dev). */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    console.log(
      `\n[email:dev] (BREVO_API_KEY not set — logging instead of sending)\n` +
        `  To: ${input.to}\n  Subject: ${input.subject}\n  ${input.text}\n`,
    );
    return true;
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
      console.warn(`[email] Brevo failed (${res.status} ${res.statusText}): ${detail}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[email] Error sending via Brevo:", error);
    return false;
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
): Promise<boolean> {
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
