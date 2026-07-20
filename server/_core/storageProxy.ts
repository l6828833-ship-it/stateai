import type { Express } from "express";
import * as db from "../db";
import { storageGetSignedUrl } from "../storage";
import { sdk } from "./sdk";

const USER_OBJECT = /^user-(\d+)\/(.+)$/;
const PUBLIC_MARKETING_OBJECTS = new Set([
  "hero-living_b05098b0.jpg",
  "hero-kitchen2_815b2217.jpg",
  "hero-aerial_18f0bf6c.jpg",
]);

/**
 * Preserve the app's historical /manus-storage/{key} URLs while serving all
 * current objects from a private Supabase Storage bucket.
 *
 * Root-level marketing assets remain public. User-prefixed objects require the
 * matching signed-in user, and full videos additionally require a subscription.
 */
export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    try {
      const userObject = USER_OBJECT.exec(key);
      if (userObject) {
        let user;
        try {
          user = await sdk.authenticateRequest(req);
        } catch {
          res.status(404).send("Media not found");
          return;
        }

        const ownerId = Number(userObject[1]);
        if (user.id !== ownerId) {
          // Avoid revealing whether another user's object exists.
          res.status(404).send("Media not found");
          return;
        }

        if (userObject[2].startsWith("videos/")) {
          const subscribed = await db.hasActiveSubscription(user.id);
          if (!subscribed) {
            res.status(403).send("An active subscription is required");
            return;
          }
        }
      } else if (key.startsWith("blog/")) {
        // Blog media is intentionally public so search engines, social-card
        // scrapers, and the AdSense crawler can fetch cover / OG images.
        const signedUrl = await storageGetSignedUrl(key);
        res.set("Cache-Control", "public, max-age=3600");
        res.redirect(307, signedUrl);
        return;
      } else if (!PUBLIC_MARKETING_OBJECTS.has(key)) {
        // Every non-user namespace is private unless explicitly allowlisted.
        res.status(404).send("Media not found");
        return;
      }

      const signedUrl = await storageGetSignedUrl(key);
      res.set("Cache-Control", "no-store");
      res.redirect(307, signedUrl);
    } catch (error) {
      console.error("[StorageProxy] failed:", error);
      // Do not expose provider configuration or bucket details publicly.
      res.status(502).send("Storage backend error");
    }
  });
}
