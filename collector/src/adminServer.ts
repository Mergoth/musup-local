import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import { rmSync } from "fs";
import QRCode from "qrcode";
import { config } from "./config.js";
import { appLogger } from "./appLogger.js";
import { getConnectionState, connectionEvents } from "./connectionState.js";
import { loadAdminConfig, saveAdminConfig, getAdminConfig } from "./adminConfig.js";
import { getAllChats } from "./store.js";

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
  }
}

export function startAdminServer(adminPort: number): void {
  if (!config.adminPassword) {
    appLogger.warn("ADMIN_PASSWORD is not set — admin UI will be inaccessible. Set ADMIN_PASSWORD env var.");
  }

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: config.adminPassword || "changeme",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }));

  // Public routes (no auth required)
  app.use("/login.html", express.static(path.resolve(__dirname, "../public/login.html")));
  app.post("/api/login", (req: Request, res: Response) => {
    const { user, password } = req.body as { user: string; password: string };
    if (user === config.adminUser && password === config.adminPassword && config.adminPassword) {
      req.session.authenticated = true;
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
  app.post("/api/logout-session", (req: Request, res: Response) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // Auth guard
  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (req.session.authenticated) { next(); return; }
    if (req.path.startsWith("/api/")) { res.status(401).json({ error: "Unauthorized" }); return; }
    res.redirect("/login.html");
  }
  app.use(requireAuth);

  // Protected static files (index.html etc.)
  app.use(express.static(path.resolve(__dirname, "../public")));

  // Protected API routes
  app.get("/api/status", async (_req: Request, res: Response) => {
    const state = getConnectionState();
    if (state.qr) {
      const qrDataUrl = await QRCode.toDataURL(state.qr);
      res.json({ ...state, qrDataUrl });
    } else {
      res.json(state);
    }
  });

  app.post("/api/reconnect", (_req: Request, res: Response) => {
    connectionEvents.emit("reconnect");
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req: Request, res: Response) => {
    res.json({ ok: true });
    setTimeout(() => {
      try { rmSync(config.authDir, { recursive: true, force: true }); } catch (_) {}
      process.exit(0);
    }, 300);
  });

  app.get("/api/chats", (_req: Request, res: Response) => {
    const cfg = getAdminConfig();
    const result = Array.from(getAllChats().entries()).map(([jid, name]) => ({
      jid,
      name,
      collectorEnabled: cfg.allowedChatJids.length === 0 || cfg.allowedChatJids.includes(jid),
      processorEnabled: cfg.processorChatJids.length === 0 || cfg.processorChatJids.includes(jid),
    }));
    res.json(result);
  });

  app.get("/api/config", (_req: Request, res: Response) => {
    res.json(getAdminConfig());
  });

  app.put("/api/config", (req: Request, res: Response) => {
    const body = req.body;
    const current = getAdminConfig();
    saveAdminConfig({
      allowedChatJids: Array.isArray(body.allowedChatJids) ? body.allowedChatJids : current.allowedChatJids,
      processorChatJids: Array.isArray(body.processorChatJids) ? body.processorChatJids : current.processorChatJids,
      chatLabels: typeof body.chatLabels === "object" && body.chatLabels !== null ? body.chatLabels : current.chatLabels,
      telegramChatIds: Array.isArray(body.telegramChatIds) ? body.telegramChatIds : current.telegramChatIds,
    });
    res.json({ ok: true });
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  connectionEvents.on("update", async (state) => {
    let payload: Record<string, unknown> = { type: "status", status: state.status };
    if (state.qr) {
      payload.qrDataUrl = await QRCode.toDataURL(state.qr);
    }
    const msg = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  });

  wss.on("connection", async (ws: WebSocket) => {
    const state = getConnectionState();
    let payload: Record<string, unknown> = { type: "status", status: state.status };
    if (state.qr) {
      payload.qrDataUrl = await QRCode.toDataURL(state.qr);
    }
    ws.send(JSON.stringify(payload));
  });

  server.listen(adminPort, () => {
    appLogger.info(`Admin server listening on port ${adminPort}`);
  });
}
