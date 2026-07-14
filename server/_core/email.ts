import { createHash, randomInt } from "node:crypto";

/**
 * Email delivery with a pluggable provider.
 *
 * - If `RESEND_API_KEY` is set, real emails are sent via the Resend HTTP API
 *   (https://resend.com) using `EMAIL_FROM` as the sender.
 * - Otherwise (local dev / provider not configured), the email is logged to the
 *   server console so the auth flow remains fully testable. The 6-digit code
 *   prints in the logs.
 *
 * To send real emails in production, set:
 *   RESEND_API_KEY=re_xxx
 *   EMAIL_FROM="EstateTour AI <no-reply@yourdomain.com>"
 */

const OTP_TTL_MINUTES = 10;

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** Returns true when the message was accepted (or logged in dev). */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "EstateTour AI <onboarding@resend.dev>";

  if (!apiKey) {
    console.log(
      `\n[email:dev] (RESEND_API_KEY not set — logging instead of sending)\n` +
        `  To: ${input.to}\n  Subject: ${input.subject}\n  ${input.text}\n`,
    );
    return true;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[email] Resend failed (${res.status} ${res.statusText}): ${detail}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[email] Error sending via Resend:", error);
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
