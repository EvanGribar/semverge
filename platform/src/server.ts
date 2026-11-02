import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { MonitorRunner, type CheckProbe } from "./runner.js";
import { monitorUrl, probe } from "./probe.js";
import { InputError, object } from "./models.js";

const SESSION_MS = 8 * 3600000;
const MAX_BODY = 512 * 1024;
export interface PlatformOptions {
  database: string;
  token: string;
  origin: string;
  allowLocal?: boolean;
  probe?: CheckProbe;
  scheduler?: boolean;
}
export function createPlatform(options: PlatformOptions) {
  if (options.token.length < 32)
    throw new Error(
      "SEMVERGE_PLATFORM_TOKEN must contain at least 32 characters.",
    );
  const origin = new URL(options.origin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      "Configure a valid public origin without a path or credentials.",
    );
  if (
    origin.protocol === "http:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  )
    throw new Error(
      "Non-loopback origins require HTTPS and a TLS reverse proxy.",
    );
  const store = new Store(options.database),
    runner = new MonitorRunner(
      store,
      options.probe ??
        ((url, status) =>
          probe(url, status, { allowLocal: options.allowLocal })),
    );
  const sessions = new Map<string, number>();
  let loginAttempts = 0,
    loginWindow = Date.now();
  const tokenHash = createHash("sha256").update(options.token).digest();
  const secure = origin.protocol === "https:" ? "; Secure" : "";
  const cookie = (value: string, age: number) =>
    `semverge_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
  const headers = (res: ServerResponse): void => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
    );
  };
  const send = (res: ServerResponse, code: number, value: unknown): void => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  };
  const sessionId = (req: IncomingMessage) =>
    /(?:^|;\s*)semverge_session=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie ?? "",
    )?.[1] ?? "";
  const readBody = async (
    req: IncomingMessage,
  ): Promise<Record<string, unknown>> => {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json")
      throw new InputError("Use application/json.", 415);
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY)
        throw new InputError("Request exceeds 512 KiB.", 413);
      chunks.push(Buffer.from(chunk));
    }
    try {
      return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError("Invalid JSON body.");
    }
  };
  const server = createServer(async (req, res) => {
    headers(res);
    try {
      if (req.headers.host !== origin.host)
        throw new InputError("Unexpected Host.", 403);
      const url = new URL(req.url ?? "/", origin);
      if (url.origin !== origin.origin)
        throw new InputError("Unexpected origin.", 403);
      if (!["GET", "POST", "PATCH"].includes(req.method ?? ""))
        throw new InputError("Method not allowed.", 405);
      if (req.method !== "GET" && req.headers.origin !== origin.origin)
        throw new InputError("A matching Origin is required.", 403);
      if (req.headers.origin && req.headers.origin !== origin.origin)
        throw new InputError("Cross-origin requests are forbidden.", 403);
      const path = url.pathname;
      if (path === "/api/login" && req.method === "POST") {
        if (Date.now() - loginWindow >= 60000) {
          loginWindow = Date.now();
          loginAttempts = 0;
        }
        if (++loginAttempts > 10)
          throw new InputError(
            "Too many sign-in attempts. Wait one minute.",
            429,
          );
        const body = await readBody(req),
          candidate = typeof body.token === "string" ? body.token : "";
        if (
          !timingSafeEqual(
            tokenHash,
            createHash("sha256").update(candidate).digest(),
          )
        )
          throw new InputError("The operator token is incorrect.", 401);
        for (const [id, expiry] of sessions)
          if (expiry <= Date.now()) sessions.delete(id);
        if (sessions.size >= 50) sessions.delete(sessions.keys().next().value!);
        const id = randomBytes(32).toString("hex");
        sessions.set(id, Date.now() + SESSION_MS);
        res.setHeader("Set-Cookie", cookie(id, SESSION_MS / 1000));
        send(res, 200, { authenticated: true });
        return;
      }
      if (path.startsWith("/api/")) {
        const id = sessionId(req),
          expiry = sessions.get(id) ?? 0;
        if (expiry <= Date.now()) {
          sessions.delete(id);
          throw new InputError("Sign in with your operator token.", 401);
        }
        if (path === "/api/logout" && req.method === "POST") {
          sessions.delete(id);
          res.setHeader("Set-Cookie", cookie("", 0));
          send(res, 200, { authenticated: false });
          return;
        }
        if (path === "/api/state" && req.method === "GET") {
          send(res, 200, {
            ...store.snapshot(),
            worker: {
              lastTickAt: runner.lastTickAt,
              lastErrorAt: runner.lastErrorAt,
              running: runner.running,
            },
            localMonitoringEnabled: Boolean(options.allowLocal),
          });
          return;
        }
        const monitorRoute =
          /^\/api\/monitors\/([a-f0-9-]+)(?:\/(checks))?$/.exec(path);
        const incidentRoute =
          /^\/api\/incidents\/([a-f0-9-]+)(?:\/(timeline))?$/.exec(path);
        if (monitorRoute) {
          const monitorId = monitorRoute[1]!;
          store.monitor(monitorId);
          if (monitorRoute[2] && req.method === "GET") {
            send(res, 200, store.history(monitorId));
            return;
          }
          if (monitorRoute[2] && req.method === "POST") {
            await readBody(req);
            send(res, 201, await runner.run(monitorId, true));
            return;
          }
          if (!monitorRoute[2] && req.method === "PATCH") {
            send(
              res,
              200,
              store.pauseMonitor(monitorId, (await readBody(req)).paused),
            );
            return;
          }
        }
        if (incidentRoute) {
          if (incidentRoute[2] && req.method === "GET") {
            send(res, 200, store.timeline(incidentRoute[1]!));
            return;
          }
          if (!incidentRoute[2] && req.method === "PATCH") {
            send(
              res,
              200,
              store.transitionIncident(incidentRoute[1]!, await readBody(req)),
            );
            return;
          }
        }
        if (req.method === "POST") {
          const body = await readBody(req);
          let result;
          if (path === "/api/applications")
            result = store.createApplication(body);
          else if (path === "/api/services") result = store.createService(body);
          else if (path === "/api/environments")
            result = store.createEnvironment(body);
          else if (path === "/api/monitors")
            result = store.createMonitor(body, (value) =>
              monitorUrl(value, options.allowLocal),
            );
          else if (path === "/api/releases") result = store.importRelease(body);
          else if (path === "/api/incidents")
            result = store.createIncident(body);
          else throw new InputError("Route not found.", 404);
          send(res, 201, result);
          return;
        }
        throw new InputError("Route not found.", 404);
      }
      if (req.method !== "GET") throw new InputError("Route not found.", 404);
      const assets: Record<string, [string, string]> = {
        "/": ["index.html", "text/html"],
        "/app.js": ["app.js", "text/javascript"],
        "/styles.css": ["styles.css", "text/css"],
        "/mark.svg": ["mark.svg", "image/svg+xml"],
      };
      const asset = assets[path];
      if (!asset) throw new InputError("Route not found.", 404);
      const content = await readFile(
        new URL(`../web/${asset[0]}`, import.meta.url),
      );
      res.writeHead(200, { "content-type": `${asset[1]}; charset=utf-8` });
      res.end(content);
    } catch (error) {
      const constraint =
        error instanceof Error &&
        error.message.startsWith("UNIQUE constraint failed");
      send(
        res,
        error instanceof InputError ? error.status : constraint ? 409 : 500,
        {
          error:
            error instanceof InputError
              ? error.message
              : constraint
                ? "That name already exists in this context."
                : "The request could not be completed. Check the server and try again.",
        },
      );
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  if (options.scheduler !== false) runner.start();
  return {
    server,
    store,
    runner,
    async close() {
      await runner.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      store.close();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const origin =
    process.env.SEMVERGE_PLATFORM_ORIGIN ?? "http://127.0.0.1:4310";
  const app = createPlatform({
    database:
      process.env.SEMVERGE_PLATFORM_DATABASE ?? "semverge-platform.sqlite",
    token: process.env.SEMVERGE_PLATFORM_TOKEN ?? "",
    origin,
    allowLocal: process.env.SEMVERGE_MONITOR_LOCAL === "true",
  });
  const port = Number(
    new URL(origin).port || (new URL(origin).protocol === "https:" ? 443 : 80),
  );
  app.server.listen(
    port,
    process.env.SEMVERGE_PLATFORM_BIND ?? "127.0.0.1",
    () => process.stdout.write(`semverge platform listening at ${origin}\n`),
  );
  let closing = false;
  const shutdown = () => {
    if (!closing) {
      closing = true;
      void app.close().then(
        () => {
          process.exitCode = 0;
        },
        () => {
          process.exitCode = 1;
        },
      );
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
