/**
 * Google Sign-In (OAuth 2.0) — SERVER-SIDE.
 *
 * Standard authorization-code flow, independent of any third-party identity
 * platform. Two routes:
 *   GET /api/auth/google           → redirect the browser to Google's consent screen
 *   GET /api/auth/google/callback  → exchange the code, upsert the user, mint a
 *                                    session cookie, and redirect into the app
 *
 * Required env:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 * Optional env:
 *   GOOGLE_REDIRECT_URI  (defaults to `${origin}/api/auth/google/callback`)
 *
 * In Google Cloud Console → Credentials → OAuth client, the "Authorized
 * redirect URI" must EXACTLY match the callback URL used here.
 */
import { randomBytes } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

const STATE_COOKIE = "g_oauth_state";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

function getRedirectUri(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    req.protocol ||
    "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host;
  return `${proto}://${host}/api/auth/google/callback`;
}

export function registerGoogleAuthRoutes(app: Express) {
  // Step 1 — send the user to Google.
  app.get("/api/auth/google", (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      res.redirect("/login?error=google_not_configured");
      return;
    }
    const nonce = randomBytes(16).toString("hex");
    // Lax is enough: the callback returns via a top-level GET navigation.
    res.cookie(STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000,
    });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", getRedirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", nonce);
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
    res.redirect(url.toString());
  });

  // Step 2 — Google redirects back with a code.
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const expected = parseCookieHeader(req.headers.cookie ?? "")[STATE_COOKIE];

      // CSRF guard: the state must match the one-time cookie we set.
      if (!code || !state || !expected || state !== expected) {
        res.redirect("/login?error=google_state");
        return;
      }
      res.clearCookie(STATE_COOKIE, { path: "/" });

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        res.redirect("/login?error=google_not_configured");
        return;
      }

      // Exchange the authorization code for tokens.
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: getRedirectUri(req),
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        console.error("[google] token exchange failed:", await tokenRes.text().catch(() => ""));
        res.redirect("/login?error=google_token");
        return;
      }
      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) {
        res.redirect("/login?error=google_token");
        return;
      }

      // Fetch the verified Google profile.
      const infoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!infoRes.ok) {
        console.error("[google] userinfo failed:", await infoRes.text().catch(() => ""));
        res.redirect("/login?error=google_userinfo");
        return;
      }
      const info = (await infoRes.json()) as {
        sub?: string;
        email?: string;
        name?: string;
        email_verified?: boolean;
      };
      if (!info.sub) {
        res.redirect("/login?error=google_userinfo");
        return;
      }

      // Upsert the user. Google accounts are email-verified by definition.
      const openId = `google_${info.sub}`;
      await db.upsertUser({
        openId,
        name: info.name || null,
        email: info.email ?? null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });
      const user = await db.getUserByOpenId(openId);
      if (user && !user.emailVerified) {
        await db.markEmailVerified(user.id);
      }

      // Mint the same session cookie the rest of the app expects.
      const token = await sdk.createSessionToken(openId, {
        name: info.name || info.email || "User",
        expiresInMs: ONE_YEAR_MS,
      });
      res.cookie(COOKIE_NAME, token, {
        ...getSessionCookieOptions(req),
        maxAge: ONE_YEAR_MS,
      });
      res.redirect("/dashboard");
    } catch (error) {
      console.error("[google] callback failed:", error);
      res.redirect("/login?error=google");
    }
  });
}
