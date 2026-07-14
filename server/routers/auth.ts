import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "../_core/cookies";
import {
  generateOtpCode,
  hashCode,
  otpExpiryDate,
  sendOtpEmail,
} from "../_core/email";
import { hashPassword, verifyPassword } from "../_core/password";
import { sdk } from "../_core/sdk";
import type { TrpcContext } from "../_core/context";
import { publicProcedure, router } from "../_core/trpc";

const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30_000;

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200);
const codeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");
const purposeSchema = z.enum(["signup", "login"]);

/** Strip sensitive fields before sending a user object to the client. */
function sanitizeUser(user: User) {
  const { passwordHash, ...safe } = user;
  return safe;
}

/** Sign a session JWT and set it as the httpOnly session cookie. */
async function establishSession(ctx: TrpcContext, user: User) {
  const token = await sdk.createSessionToken(user.openId, {
    // Must be non-empty: verifySession rejects sessions with a blank name.
    name: user.name || user.email || "User",
    expiresInMs: ONE_YEAR_MS,
  });
  ctx.res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(ctx.req),
    maxAge: ONE_YEAR_MS,
  });
}

/** Invalidate old codes, create a fresh one, and email it. */
async function issueCode(email: string, purpose: "signup" | "login") {
  await db.invalidateAuthCodes(email, purpose);
  const code = generateOtpCode();
  await db.createAuthCode({
    email,
    codeHash: hashCode(code),
    purpose,
    expiresAt: otpExpiryDate(),
  });

  const result = await sendOtpEmail(email, code, purpose);
  if (!result.ok) {
    // Surface the real provider error instead of pretending the code was sent.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `We couldn't send the verification email. ${result.error ?? "Please try again shortly."}`,
    });
  }
  if (result.skipped) {
    // Email provider not configured — fail loudly in production so users aren't
    // stuck waiting for a code that will never arrive.
    if (process.env.NODE_ENV === "production") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Email delivery is not configured (BREVO_API_KEY is missing). Please contact support.",
      });
    }
    console.warn(`[auth] DEV ONLY — OTP for ${email} (${purpose}): ${code}`);
  }
}

export const authRouter = router({
  /** Current user (sanitized — never exposes passwordHash). */
  me: publicProcedure.query((opts) =>
    opts.ctx.user ? sanitizeUser(opts.ctx.user) : null,
  ),

  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),

  /**
   * Create an email/password account (or attach a password to an OAuth account)
   * and send an OTP to verify the email. The account is not usable until
   * verified via `verifyOtp`.
   */
  signup: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "Name is required").max(120),
        email: emailSchema,
        password: passwordSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await db.getUserByEmail(input.email);

      if (existing?.passwordHash && existing.emailVerified) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists. Please sign in instead.",
        });
      }

      const passwordHash = await hashPassword(input.password);

      if (existing) {
        // Unverified local account OR an OAuth account gaining a password.
        await db.setUserPassword(existing.id, passwordHash);
      } else {
        await db.createLocalUser({
          openId: `email_${nanoid()}`,
          name: input.name,
          email: input.email,
          passwordHash,
        });
      }

      await issueCode(input.email, "signup");
      return { ok: true, email: input.email, needsVerification: true } as const;
    }),

  /**
   * Verify a plaintext password. If correct but the email is unverified, an OTP
   * is sent and the client is told to verify. Otherwise a session is created.
   */
  login: publicProcedure
    .input(z.object({ email: emailSchema, password: passwordSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserByEmail(input.email);

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Incorrect email or password.",
        });
      }
      if (!user.passwordHash) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This email uses social sign-in. Continue with Manus instead.",
        });
      }

      const ok = await verifyPassword(input.password, user.passwordHash);
      if (!ok) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Incorrect email or password.",
        });
      }

      if (!user.emailVerified) {
        await issueCode(input.email, "login");
        return {
          ok: true,
          needsVerification: true,
          email: input.email,
          user: null,
        } as const;
      }

      await establishSession(ctx, user);
      return {
        ok: true,
        needsVerification: false,
        email: input.email,
        user: sanitizeUser(user),
      } as const;
    }),

  /** Verify a submitted OTP. On success: mark verified + establish a session. */
  verifyOtp: publicProcedure
    .input(
      z.object({
        email: emailSchema,
        code: codeSchema,
        purpose: purposeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const record = await db.getActiveAuthCode(input.email, input.purpose);
      if (!record) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That code has expired. Request a new one.",
        });
      }
      if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Request a new code.",
        });
      }

      if (hashCode(input.code) !== record.codeHash) {
        await db.incrementAuthCodeAttempts(record.id);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That code is incorrect. Please try again.",
        });
      }

      const user = await db.getUserByEmail(input.email);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
      }

      // Sign the session BEFORE consuming the code. If signing fails (e.g.
      // JWT_SECRET is missing), the code stays valid so the user can retry
      // once the server is configured, rather than burning a correct code.
      try {
        await establishSession(ctx, user);
      } catch (e) {
        console.error("[auth] Failed to create session token:", e);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            e instanceof Error && e.message.includes("JWT_SECRET")
              ? e.message
              : "Could not create your session. Please try again shortly.",
        });
      }

      if (!user.emailVerified) {
        await db.markEmailVerified(user.id);
      }
      await db.consumeAuthCode(record.id);

      const fresh = (await db.getUserByEmail(input.email)) ?? user;
      return { ok: true, user: sanitizeUser(fresh) } as const;
    }),

  /** Re-send an OTP, rate-limited to one every 30 seconds. */
  resendOtp: publicProcedure
    .input(z.object({ email: emailSchema, purpose: purposeSchema }))
    .mutation(async ({ input }) => {
      const active = await db.getActiveAuthCode(input.email, input.purpose);
      if (active && Date.now() - active.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Please wait a moment before requesting another code.",
        });
      }
      await issueCode(input.email, input.purpose);
      return { ok: true, email: input.email } as const;
    }),
});
