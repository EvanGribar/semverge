import { createServer, request, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPlatform } from "../src/server.js";
import { Store } from "../src/store.js";
import { MonitorRunner } from "../src/runner.js";
import { monitorUrl, probe, publicAddress } from "../src/probe.js";
import {
  createReleaseTransaction,
  recordReleaseTransactionEvent,
} from "../../src/transaction.js";

const token = "test-only-operator-token-with-32-characters";
const disposers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
async function installation(database = ":memory:") {
  const reserve = createServer();
  const port = await listen(reserve);
  await close(reserve);
  const origin = `http://127.0.0.1:${port}`;
  const app = createPlatform({
    database,
    origin,
    token,
    allowLocal: true,
    scheduler: false,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(port, "127.0.0.1", resolve),
  );
  let cookie = "";
  const api = async (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { origin, "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, data: await response.json() };
  };
  const login = await api("/api/login", { token });
  expect(login.response.status).toBe(200);
  cookie = login.response.headers.get("set-cookie")!.split(";")[0]!;
  return { app, api, origin, cookie };
}
function context(store: Store) {
  const application = store.createApplication({ name: "Checkout" });
  const service = store.createService({
    applicationId: application.id,
    name: "API",
  });
  const environment = store.createEnvironment({ name: "Production" });
  return { serviceId: service.id, environmentId: environment.id };
}

describe("web platform complete workflow", () => {
  it("uses real HTTP checks to open, acknowledge and recover an incident, then persists on restart", async () => {
    let status = 503;
    const target = createServer((_req, res) => {
      res.writeHead(status);
      res.end("response bodies are never stored");
    });
    const targetPort = await listen(target);
    disposers.push(() => close(target));
    const directory = mkdtempSync(join(tmpdir(), "semverge-platform-"));
    disposers.push(() => rmSync(directory, { recursive: true, force: true }));
    const database = join(directory, "workspace.sqlite");
    const { app, api } = await installation(database);
    let open = true;
    disposers.push(async () => {
      if (open) await app.close();
    });
    const application = (await api("/api/applications", { name: "Storefront" }))
      .data;
    const service = (
      await api("/api/services", {
        name: "Checkout API",
        applicationId: application.id,
      })
    ).data;
    const environment = (await api("/api/environments", { name: "Production" }))
      .data;
    const transaction = recordReleaseTransactionEvent(
      createReleaseTransaction({
        id: "release_workflow",
        version: "1.2.0",
        sourceCommit: "a".repeat(40),
        packageIds: ["api"],
        tagNames: ["v1.2.0"],
        npmEnabled: false,
      }),
      {
        key: "build",
        kind: "artifacts-built",
        target: "DO_NOT_STORE",
        detail: "secret=DO_NOT_STORE",
      },
    );
    const releaseResponse = await api("/api/releases", {
      serviceId: service.id,
      environmentId: environment.id,
      transaction,
    });
    expect(releaseResponse.response.status).toBe(201);
    expect(JSON.stringify(releaseResponse.data)).not.toContain("DO_NOT_STORE");
    const monitorResponse = await api("/api/monitors", {
      serviceId: service.id,
      environmentId: environment.id,
      name: "Checkout health",
      url: `http://127.0.0.1:${targetPort}/health`,
      intervalSeconds: 30,
    });
    expect(monitorResponse.response.status).toBe(201);
    const monitor = monitorResponse.data;
    expect(
      (await api(`/api/monitors/${monitor.id}/checks`, {})).data,
    ).toMatchObject({ outcome: "down", statusCode: 503 });
    expect((await api("/api/state")).data.incidents).toHaveLength(0);
    await api(`/api/monitors/${monitor.id}/checks`, {});
    const incident = (await api("/api/state")).data.incidents[0];
    expect(incident).toMatchObject({
      status: "open",
      releaseId: null,
      monitorId: monitor.id,
    });
    await api(`/api/monitors/${monitor.id}/checks`, {});
    expect((await api("/api/state")).data.incidents).toHaveLength(1);
    await api(
      `/api/incidents/${incident.id}`,
      { action: "acknowledge", owner: "Evan" },
      "PATCH",
    );
    await api(
      `/api/incidents/${incident.id}`,
      { action: "link-release", releaseId: releaseResponse.data.id },
      "PATCH",
    );
    await api(
      `/api/incidents/${incident.id}`,
      { action: "note", message: "Investigating the health endpoint." },
      "PATCH",
    );
    status = 200;
    await api(`/api/monitors/${monitor.id}/checks`, {});
    const state = (await api("/api/state")).data;
    expect(state.statuses[0].status).toBe("up");
    expect(state.incidents[0]).toMatchObject({
      status: "resolved",
      owner: "Evan",
      releaseId: releaseResponse.data.id,
    });
    const timeline = (await api(`/api/incidents/${incident.id}/timeline`)).data;
    expect(timeline.map((item: { kind: string }) => item.kind)).toEqual([
      "opened",
      "acknowledged",
      "release-linked",
      "note",
      "recovered",
    ]);
    expect(timeline[2].message).toContain("causation is unverified");
    const checks = (await api(`/api/monitors/${monitor.id}/checks`)).data;
    expect(checks).toHaveLength(4);
    expect(JSON.stringify(checks)).not.toContain("response bodies");
    await app.close();
    open = false;
    const reopened = new Store(database);
    disposers.push(() => reopened.close());
    expect(reopened.snapshot().incidents[0]?.status).toBe("resolved");
    expect(reopened.history(monitor.id)).toHaveLength(4);
    expect(reopened.snapshot().releases[0]?.sourceCommit).toBe("a".repeat(40));
  });

  it("requires authentication, exact Host/Origin, bounded JSON and supports session revocation", async () => {
    const { app, api, origin, cookie } = await installation();
    disposers.push(() => app.close());
    expect((await fetch(`${origin}/api/state`)).status).toBe(401);
    expect(
      (
        await fetch(`${origin}/api/state`, {
          headers: { cookie, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    const badHost = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${origin}/api/state`,
        { headers: { cookie, host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(badHost).toBe(403);
    expect(
      (
        await fetch(`${origin}/api/applications`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: '{"name":"bad"}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin}/api/applications`, {
          method: "POST",
          headers: { cookie, origin, "content-type": "text/plain" },
          body: "x",
        })
      ).status,
    ).toBe(415);
    expect(
      (await api("/api/applications", { name: "x".repeat(600000) })).response
        .status,
    ).toBe(413);
    expect(
      (await api("/api/applications", { name: "<script>alert(1)</script>" }))
        .response.status,
    ).toBe(201);
    expect(
      (await fetch(`${origin}/`)).headers.get("content-security-policy"),
    ).toContain("script-src 'self'");
    const logout = await api("/api/logout", {});
    expect(logout.response.status).toBe(200);
    expect((await api("/api/state")).response.status).toBe(401);
  });

  it("rejects conflicting imports and cross-service links while preserving release idempotency", () => {
    const store = new Store(":memory:");
    disposers.push(() => store.close());
    const ctx = context(store);
    const transaction = createReleaseTransaction({
      id: "release_safe",
      version: "1.0.0",
      sourceCommit: "b".repeat(40),
      packageIds: [],
      tagNames: [],
      npmEnabled: false,
      now: "2026-01-01T00:00:00Z",
    });
    const release = store.importRelease({ ...ctx, transaction });
    expect(store.importRelease({ ...ctx, transaction }).id).toBe(release.id);
    expect(() =>
      store.importRelease({
        ...ctx,
        transaction: {
          ...transaction,
          sourceCommit: "c".repeat(40),
          updatedAt: "2026-01-02T00:00:00Z",
        },
      }),
    ).toThrow("conflicting");
    const otherEnvironment = store.createEnvironment({ name: "Staging" });
    expect(() =>
      store.createIncident({
        ...ctx,
        environmentId: otherEnvironment.id,
        releaseId: release.id,
        title: "Context mismatch",
      }),
    ).toThrow("same service and environment");
    const updated = store.importRelease({
      ...ctx,
      transaction: {
        ...transaction,
        phase: "approved",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    });
    expect(updated.id).toBe(release.id);
    expect(() => store.importRelease({ ...ctx, transaction })).toThrow("Stale");
    const incident = store.createIncident({
      ...ctx,
      releaseId: release.id,
      title: "Investigate",
    });
    store.transitionIncident(incident.id, {
      action: "acknowledge",
      owner: "Maintainer",
    });
    store.transitionIncident(incident.id, {
      action: "acknowledge",
      owner: "Maintainer",
    });
    store.transitionIncident(incident.id, {
      action: "resolve",
      message: "Verified manually",
    });
    store.transitionIncident(incident.id, {
      action: "resolve",
      message: "Duplicate request",
    });
    expect(store.timeline(incident.id)).toHaveLength(3);
    expect(() =>
      store.transitionIncident(incident.id, {
        action: "acknowledge",
        owner: "Maintainer",
      }),
    ).toThrow("resolved");
  });
});

describe("bounded monitor execution", () => {
  it("persists scheduling, recovers expired leases and rejects stale worker results", async () => {
    const store = new Store(":memory:");
    disposers.push(() => store.close());
    const ctx = context(store);
    const now = Date.now() - 60000;
    const monitor = store.createMonitor(
      { ...ctx, name: "Public", url: "https://example.com" },
      monitorUrl,
      now,
    );
    const first = store.claim(monitor.id, now)!;
    expect(store.claim(monitor.id, now + 1)).toBeNull();
    const replacement = store.claim(monitor.id, now + 30001)!;
    expect(
      store.recordCheck(
        first,
        {
          outcome: "up",
          statusCode: 200,
          latencyMs: 1,
          reason: "Expected response",
        },
        now + 30002,
      ),
    ).toBeNull();
    expect(store.monitor(monitor.id).leaseId).toBe(replacement.leaseId);
    store.recordCheck(
      replacement,
      {
        outcome: "down",
        statusCode: 503,
        latencyMs: 1,
        reason: "Unexpected HTTP status",
      },
      now + 30003,
    );
    expect(store.due(now + 30004)).toHaveLength(0);
    store.pauseMonitor(monitor.id, true);
    expect(store.claim(monitor.id, now + 90000, true)).toBeNull();
    expect(store.snapshot(now + 90000).statuses[0]?.status).toBe("paused");
    store.pauseMonitor(monitor.id, false);
    expect(store.snapshot(now + 300000).statuses[0]?.status).toBe("unknown");
    const runner = new MonitorRunner(store, async () => ({
      outcome: "up",
      statusCode: 200,
      latencyMs: 2,
      reason: "Expected response",
    }));
    runner.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runner.stop();
    expect(store.history(monitor.id)[0]?.outcome).toBe("up");
    store.prune(Date.now() + 31 * 86400000);
    expect(store.history(monitor.id)).toHaveLength(0);
  });
  it("caps worker concurrency, suppresses duplicates and persists no observation for a paused in-flight check", async () => {
    const store = new Store(":memory:");
    disposers.push(() => store.close());
    const ctx = context(store);
    const monitors = [0, 1, 2, 3].map((index) =>
      store.createMonitor(
        { ...ctx, name: `Probe ${index}`, url: "https://example.com" },
        monitorUrl,
      ),
    );
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const runner = new MonitorRunner(store, async () => {
      await gate;
      return {
        outcome: "up",
        statusCode: 200,
        latencyMs: 1,
        reason: "Expected response",
      };
    });
    const checks = monitors
      .slice(0, 3)
      .map((monitor) => runner.run(monitor.id, true));
    await expect(runner.run(monitors[3]!.id, true)).rejects.toThrow("busy");
    store.pauseMonitor(monitors[0]!.id, true);
    finish();
    await Promise.all(checks);
    await runner.stop();
    expect(store.history(monitors[0]!.id)).toHaveLength(0);
  });
  it("blocks private/mixed DNS and URL credentials; real requests do not follow redirects or wait indefinitely", async () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "100.100.100.200",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "2001:db8::1",
      "2002:7f00:1::",
    ])
      expect(publicAddress(address), address).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
    for (const url of [
      "http://example.com",
      "https://127.1/",
      "https://2130706433/",
      "https://user:pass@example.com",
      "https://example.com/?token=x",
      "https://example.com:8443",
      "https://[::ffff:127.0.0.1]/",
    ])
      expect(() => monitorUrl(url), url).toThrow();
    expect(
      (
        await probe("https://rebind.example", 200, {
          resolve: async () => [
            { address: "8.8.8.8", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ],
        })
      ).reason,
    ).toContain("blocked");
    let followed = 0;
    const target = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/secret" });
        res.end();
      } else if (req.url === "/slow") {
      } else {
        followed++;
        res.end();
      }
    });
    const port = await listen(target);
    disposers.push(() => close(target));
    const base = `http://127.0.0.1:${port}`;
    expect(
      (await probe(`${base}/redirect`, 200, { allowLocal: true })).reason,
    ).toContain("Redirects");
    expect(followed).toBe(0);
    expect(
      (await probe(`${base}/slow`, 200, { allowLocal: true, timeoutMs: 30 }))
        .reason,
    ).toContain("timed out");
  });
});
