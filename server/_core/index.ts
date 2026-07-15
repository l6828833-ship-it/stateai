import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerGoogleAuthRoutes } from "./googleAuth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import {
  handleAdditionalVideoCheckout,
  handleCheckout,
  handlePortal,
  handleWebhook,
} from "../billing";
import { sdk } from "./sdk";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Stripe webhook needs the RAW body for signature verification —
  // it must be registered BEFORE express.json().
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
    void handleWebhook(req, res);
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Billing endpoints (session-authenticated).
  app.post("/api/billing/checkout", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Please sign in first" });
        return;
      }
      await handleCheckout(req, res, { id: user.id, email: user.email, name: user.name });
    } catch {
      res.status(401).json({ error: "Please sign in first" });
    }
  });
  app.post("/api/billing/additional-video", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Please sign in first" });
        return;
      }
      await handleAdditionalVideoCheckout(req, res, {
        id: user.id,
        email: user.email,
      });
    } catch {
      res.status(401).json({ error: "Please sign in first" });
    }
  });
  app.post("/api/billing/portal", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Please sign in first" });
        return;
      }
      await handlePortal(req, res, { id: user.id });
    } catch {
      res.status(401).json({ error: "Please sign in first" });
    }
  });
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerGoogleAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // In production (Railway, etc.) the platform injects PORT and routes traffic
  // to exactly that port, then health-checks it — so we must bind to it as-is.
  // Only in development do we hunt for a free port to avoid local clashes.
  const envPort = parseInt(process.env.PORT || "3000");
  const port =
    process.env.NODE_ENV === "production" ? envPort : await findAvailablePort(envPort);

  // Bind on 0.0.0.0 so the container is reachable from the platform's router.
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
