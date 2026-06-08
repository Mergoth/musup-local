import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import { rmSync } from "fs";
import { randomBytes } from "crypto";
import QRCode from "qrcode";
import { config } from "#src/config.js";
import { appLogger } from "#src/appLogger.js";
import { getConnectionState, connectionEvents } from "#src/connectionState.js";
import { saveAdminConfig, getAdminConfig } from "#src/adminConfig.js";
import { getAllChats } from "#src/store.js";

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
  }
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function startAdminServer(adminPort: number): void {
  if (!config.adminPassword) {
    appLogger.warn("ADMIN_PASSWORD is not set — admin UI will be inaccessible. Set ADMIN_PASSWORD env var.");
  }

  const sessionSecret = config.adminPassword || randomBytes(32).toString("hex");

  const app = express();
  app.use(express.json());
  const sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  });
  app.use(sessionMiddleware);

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
  app.post("/api/logout-session", (req: Request, res: Response) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/status", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const state = getConnectionState();
      if (state.qr) {
        const qrDataUrl = await QRCode.toDataURL(state.qr);
        res.json({ ...state, qrDataUrl });
      } else {
        res.json(state);
      }
    } catch (e) { next(e); }
  });

  app.post("/api/reconnect", (_req: Request, res: Response) => {
    connectionEvents.emit("reconnect");
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req: Request, res: Response) => {
    res.json({ ok: true });
    res.on("finish", () => {
      try { rmSync(config.authDir, { recursive: true, force: true }); } catch (e) { appLogger.warn("Could not clear auth folder", { e }); }
      process.exit(0);
    });
  });

  app.get("/api/chats", (_req: Request, res: Response) => {
    const cfg = getAdminConfig();
    const result = Array.from(getAllChats().entries()).map(([jid, name]) => ({
      jid,
      name,
      collectorEnabled: cfg.allowedChatJids.length === 0 || cfg.allowedChatJids.includes(jid),
      processorEnabled: cfg.processorChatJids.includes(jid),
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
      allowedChatJids: isStringArray(body.allowedChatJids) ? body.allowedChatJids : current.allowedChatJids,
      processorChatJids: isStringArray(body.processorChatJids) ? body.processorChatJids : current.processorChatJids,
      chatLabels: typeof body.chatLabels === "object" && body.chatLabels !== null && !Array.isArray(body.chatLabels) ? body.chatLabels : current.chatLabels,
      telegramChatIds: isStringArray(body.telegramChatIds) ? body.telegramChatIds : current.telegramChatIds,
      digestCron: typeof body.digestCron === "string" ? body.digestCron : current.digestCron,
    });
    res.json({ ok: true });
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Authenticate WS upgrades via session middleware
  server.on("upgrade", (req, socket, head) => {
    const dummyRes = {
      writeHead: () => {},
      setHeader: () => {},
      getHeader: () => {},
      end: () => {},
    } as any;
    // @ts-ignore — express-session types don't cover raw IncomingMessage
    sessionMiddleware(req, dummyRes, () => {
      // @ts-ignore
      if (!(req as any).session?.authenticated) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });
  });

  connectionEvents.on("update", async (state) => {
    try {
      let payload: Record<string, unknown> = { type: "status", status: state.status };
      if (state.qr) {
        payload.qrDataUrl = await QRCode.toDataURL(state.qr);
      }
      const msg = JSON.stringify(payload);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });
    } catch (e) { appLogger.error("WS push failed", { e }); }
  });

  wss.on("connection", async (ws: WebSocket) => {
    try {
      const state = getConnectionState();
      let payload: Record<string, unknown> = { type: "status", status: state.status };
      if (state.qr) {
        payload.qrDataUrl = await QRCode.toDataURL(state.qr);
      }
      ws.send(JSON.stringify(payload));
    } catch (e) { appLogger.error("WS initial state push failed", { e }); }
  });

  server.listen(adminPort, () => {
    appLogger.info(`Admin server listening on port ${adminPort}`);
  });
}
