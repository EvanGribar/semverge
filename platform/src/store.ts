import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  parseReleaseTransaction,
  RELEASE_PHASES,
} from "../../lib/transaction.js";
import {
  InputError,
  object,
  text,
  integer,
  type Application,
  type Service,
  type Environment,
  type Monitor,
  type Observation,
  type ReleaseRecord,
  type Incident,
  type TimelineEntry,
  type ProbeResult,
} from "./models.js";

const DAY = 86_400_000;
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    const version = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version > 1) {
      this.db.close();
      throw new Error(
        "Database is newer than this platform. Upgrade the application.",
      );
    }
    if (version.user_version === 0)
      this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE applications (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL) STRICT;
      CREATE TABLE services (id TEXT PRIMARY KEY, applicationId TEXT NOT NULL REFERENCES applications(id), name TEXT NOT NULL, createdAt INTEGER NOT NULL, UNIQUE(applicationId,name)) STRICT;
      CREATE TABLE environments (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL) STRICT;
      CREATE TABLE monitors (id TEXT PRIMARY KEY, serviceId TEXT NOT NULL REFERENCES services(id), environmentId TEXT NOT NULL REFERENCES environments(id), name TEXT NOT NULL, url TEXT NOT NULL, intervalSeconds INTEGER NOT NULL, expectedStatus INTEGER NOT NULL, paused INTEGER NOT NULL DEFAULT 0, nextRunAt INTEGER NOT NULL, leaseUntil INTEGER NOT NULL DEFAULT 0, leaseId TEXT, createdAt INTEGER NOT NULL) STRICT;
      CREATE TABLE observations (id TEXT PRIMARY KEY, monitorId TEXT NOT NULL REFERENCES monitors(id), checkedAt INTEGER NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('up','down')), statusCode INTEGER, latencyMs INTEGER NOT NULL, reason TEXT NOT NULL) STRICT;
      CREATE INDEX observations_monitor_time ON observations(monitorId,checkedAt DESC);
      CREATE INDEX observations_time ON observations(checkedAt);
      CREATE TABLE releases (id TEXT PRIMARY KEY, serviceId TEXT NOT NULL REFERENCES services(id), environmentId TEXT NOT NULL REFERENCES environments(id), transactionId TEXT NOT NULL, version TEXT NOT NULL, sourceCommit TEXT NOT NULL, phase TEXT NOT NULL, failed INTEGER NOT NULL, published INTEGER NOT NULL, ready INTEGER NOT NULL, sourceUpdatedAt INTEGER NOT NULL, importedAt INTEGER NOT NULL, fingerprint TEXT NOT NULL, events TEXT NOT NULL, UNIQUE(serviceId,environmentId,transactionId)) STRICT;
      CREATE TABLE incidents (id TEXT PRIMARY KEY, serviceId TEXT NOT NULL REFERENCES services(id), environmentId TEXT NOT NULL REFERENCES environments(id), monitorId TEXT REFERENCES monitors(id), releaseId TEXT REFERENCES releases(id), title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','acknowledged','resolved')), owner TEXT, createdAt INTEGER NOT NULL, resolvedAt INTEGER) STRICT;
      CREATE UNIQUE INDEX one_active_monitor_incident ON incidents(monitorId) WHERE monitorId IS NOT NULL AND status != 'resolved';
      CREATE TABLE timeline (id TEXT PRIMARY KEY, incidentId TEXT NOT NULL REFERENCES incidents(id), kind TEXT NOT NULL, message TEXT NOT NULL, createdAt INTEGER NOT NULL) STRICT;
      PRAGMA user_version=1;
      COMMIT;
    `);
  }
  close(): void {
    this.db.close();
  }
  private atomic<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private requireRow(
    table:
      | "applications"
      | "services"
      | "environments"
      | "releases"
      | "monitors"
      | "incidents",
    id: string,
  ): void {
    if (!this.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))
      throw new InputError(`Unknown ${table} reference.`, 404);
  }
  private context(serviceId: string, environmentId: string): void {
    this.requireRow("services", serviceId);
    this.requireRow("environments", environmentId);
  }
  createApplication(value: unknown, now = Date.now()): Application {
    const data = object(value);
    const item = {
      id: randomUUID(),
      name: text(data.name, "Application name"),
      createdAt: now,
    };
    if (
      (
        this.db.prepare("SELECT COUNT(*) AS n FROM applications").get() as {
          n: number;
        }
      ).n >= 50
    )
      throw new InputError(
        "This installation supports at most 50 applications.",
      );
    this.db
      .prepare("INSERT INTO applications VALUES (?,?,?)")
      .run(item.id, item.name, now);
    return item;
  }
  createService(value: unknown, now = Date.now()): Service {
    const data = object(value);
    const applicationId = text(data.applicationId, "Application");
    this.requireRow("applications", applicationId);
    const item = {
      id: randomUUID(),
      applicationId,
      name: text(data.name, "Service name"),
      createdAt: now,
    };
    if (
      (
        this.db.prepare("SELECT COUNT(*) AS n FROM services").get() as {
          n: number;
        }
      ).n >= 100
    )
      throw new InputError("This installation supports at most 100 services.");
    this.db
      .prepare("INSERT INTO services VALUES (?,?,?,?)")
      .run(item.id, applicationId, item.name, now);
    return item;
  }
  createEnvironment(value: unknown, now = Date.now()): Environment {
    const data = object(value);
    const item = {
      id: randomUUID(),
      name: text(data.name, "Environment name"),
      createdAt: now,
    };
    if (
      (
        this.db.prepare("SELECT COUNT(*) AS n FROM environments").get() as {
          n: number;
        }
      ).n >= 20
    )
      throw new InputError(
        "This installation supports at most 20 environments.",
      );
    this.db
      .prepare("INSERT INTO environments VALUES (?,?,?)")
      .run(item.id, item.name, now);
    return item;
  }
  createMonitor(
    value: unknown,
    validateUrl: (url: string) => string,
    now = Date.now(),
  ): Monitor {
    const data = object(value);
    const serviceId = text(data.serviceId, "Service"),
      environmentId = text(data.environmentId, "Environment");
    this.context(serviceId, environmentId);
    const id = randomUUID(),
      name = text(data.name, "Monitor name"),
      url = validateUrl(text(data.url, "URL", 2048));
    const intervalSeconds = integer(
        data.intervalSeconds ?? 60,
        "Interval",
        30,
        86400,
      ),
      expectedStatus = integer(
        data.expectedStatus ?? 200,
        "Expected status",
        200,
        299,
      );
    if (
      (
        this.db.prepare("SELECT COUNT(*) AS n FROM monitors").get() as {
          n: number;
        }
      ).n >= 50
    )
      throw new InputError("This installation supports at most 50 monitors.");
    this.db
      .prepare("INSERT INTO monitors VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        serviceId,
        environmentId,
        name,
        url,
        intervalSeconds,
        expectedStatus,
        0,
        now,
        0,
        null,
        now,
      );
    return this.monitor(id);
  }
  monitor(id: string): Monitor {
    const item = this.db
      .prepare("SELECT * FROM monitors WHERE id=?")
      .get(id) as unknown as Monitor | undefined;
    if (!item) throw new InputError("Monitor not found.", 404);
    return item;
  }
  pauseMonitor(id: string, paused: unknown, now = Date.now()): Monitor {
    this.monitor(id);
    if (typeof paused !== "boolean")
      throw new InputError("paused must be a boolean.");
    this.db
      .prepare("UPDATE monitors SET paused=?,nextRunAt=? WHERE id=?")
      .run(Number(paused), now, id);
    return this.monitor(id);
  }
  claim(id: string, now = Date.now(), manual = false): Monitor | null {
    const leaseId = randomUUID();
    const result = this.db
      .prepare(
        "UPDATE monitors SET leaseUntil=?,leaseId=? WHERE id=? AND paused=0 AND leaseUntil<=? AND (?=1 OR nextRunAt<=?)",
      )
      .run(now + 30000, leaseId, id, now, Number(manual), now);
    return result.changes ? this.monitor(id) : null;
  }
  due(now = Date.now()): Monitor[] {
    return this.db
      .prepare(
        "SELECT * FROM monitors WHERE paused=0 AND nextRunAt<=? AND leaseUntil<=? ORDER BY nextRunAt LIMIT 50",
      )
      .all(now, now) as unknown as Monitor[];
  }
  recordCheck(
    claim: Monitor,
    result: ProbeResult,
    now = Date.now(),
  ): Observation | null {
    return this.atomic(() => {
      const monitor = this.monitor(claim.id);
      if (monitor.leaseId !== claim.leaseId || monitor.paused) {
        // Do not clear a newer worker's lease.
        this.db
          .prepare(
            "UPDATE monitors SET leaseUntil=0,leaseId=NULL WHERE id=? AND leaseId=?",
          )
          .run(claim.id, claim.leaseId);
        return null;
      }
      const observation = {
        id: randomUUID(),
        monitorId: claim.id,
        checkedAt: now,
        ...result,
      };
      this.db
        .prepare("INSERT INTO observations VALUES (?,?,?,?,?,?,?)")
        .run(
          observation.id,
          claim.id,
          now,
          result.outcome,
          result.statusCode,
          result.latencyMs,
          result.reason,
        );
      this.db
        .prepare(
          "UPDATE monitors SET nextRunAt=?,leaseUntil=0,leaseId=NULL WHERE id=?",
        )
        .run(now + monitor.intervalSeconds * 1000, claim.id);
      const active = this.db
        .prepare(
          "SELECT * FROM incidents WHERE monitorId=? AND status!='resolved'",
        )
        .get(claim.id) as unknown as Incident | undefined;
      if (result.outcome === "down" && !active) {
        const recent = this.history(claim.id, 2);
        if (
          recent.length === 2 &&
          recent.every((check) => check.outcome === "down")
        ) {
          this.insertIncident(
            {
              serviceId: monitor.serviceId,
              environmentId: monitor.environmentId,
              monitorId: monitor.id,
              releaseId: null,
              title: `${monitor.name} is failing`,
            },
            now,
            "Opened after two consecutive failed observations.",
          );
        }
      } else if (result.outcome === "up" && active) {
        this.db
          .prepare(
            "UPDATE incidents SET status='resolved',resolvedAt=? WHERE id=?",
          )
          .run(now, active.id);
        this.appendTimeline(
          active.id,
          "recovered",
          `Monitor returned expected HTTP ${monitor.expectedStatus}.`,
          now,
        );
      }
      return observation;
    });
  }
  history(id: string, limit = 60): Observation[] {
    this.requireRow("monitors", id);
    return this.db
      .prepare(
        "SELECT * FROM observations WHERE monitorId=? ORDER BY checkedAt DESC,rowid DESC LIMIT ?",
      )
      .all(id, limit) as unknown as Observation[];
  }
  private appendTimeline(
    incidentId: string,
    kind: string,
    message: string,
    now: number,
  ): void {
    this.db
      .prepare("INSERT INTO timeline VALUES (?,?,?,?,?)")
      .run(randomUUID(), incidentId, kind, message, now);
  }
  private insertIncident(
    input: Pick<
      Incident,
      "serviceId" | "environmentId" | "monitorId" | "releaseId" | "title"
    >,
    now: number,
    message: string,
  ): Incident {
    const item: Incident = {
      id: randomUUID(),
      ...input,
      status: "open",
      owner: null,
      createdAt: now,
      resolvedAt: null,
    };
    this.db
      .prepare("INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(
        item.id,
        item.serviceId,
        item.environmentId,
        item.monitorId,
        item.releaseId,
        item.title,
        item.status,
        item.owner,
        now,
        null,
      );
    this.appendTimeline(item.id, "opened", message, now);
    return item;
  }
  private releaseContext(
    releaseId: unknown,
    serviceId: string,
    environmentId: string,
  ): string | null {
    if (releaseId === undefined || releaseId === null || releaseId === "")
      return null;
    const id = text(releaseId, "Release");
    if (
      !this.db
        .prepare(
          "SELECT id FROM releases WHERE id=? AND serviceId=? AND environmentId=?",
        )
        .get(id, serviceId, environmentId)
    )
      throw new InputError(
        "Release must belong to the same service and environment.",
      );
    return id;
  }
  createIncident(value: unknown, now = Date.now()): Incident {
    const data = object(value),
      serviceId = text(data.serviceId, "Service"),
      environmentId = text(data.environmentId, "Environment");
    this.context(serviceId, environmentId);
    const releaseId = this.releaseContext(
        data.releaseId,
        serviceId,
        environmentId,
      ),
      title = text(data.title, "Incident title", 200);
    return this.atomic(() =>
      this.insertIncident(
        { serviceId, environmentId, monitorId: null, releaseId, title },
        now,
        "Reported by the workspace operator.",
      ),
    );
  }
  transitionIncident(id: string, value: unknown, now = Date.now()): Incident {
    const data = object(value);
    return this.atomic(() => {
      const item = this.db
        .prepare("SELECT * FROM incidents WHERE id=?")
        .get(id) as unknown as Incident | undefined;
      if (!item) throw new InputError("Incident not found.", 404);
      const action = text(data.action, "Action");
      if (action === "note") {
        this.appendTimeline(id, "note", text(data.message, "Note", 2000), now);
      } else if (action === "link-release") {
        const releaseId = this.releaseContext(
          data.releaseId,
          item.serviceId,
          item.environmentId,
        );
        if (!releaseId) throw new InputError("Choose a release to link.");
        if (item.releaseId !== releaseId) {
          this.db
            .prepare("UPDATE incidents SET releaseId=? WHERE id=?")
            .run(releaseId, id);
          const release = this.db
            .prepare("SELECT version FROM releases WHERE id=?")
            .get(releaseId) as { version: string };
          this.appendTimeline(
            id,
            "release-linked",
            `Operator associated release ${release.version}; causation is unverified.`,
            now,
          );
        }
      } else if (action === "acknowledge") {
        if (item.status === "resolved")
          throw new InputError(
            "A resolved incident cannot be acknowledged.",
            409,
          );
        const owner = text(data.owner, "Owner", 100);
        if (item.status !== "acknowledged" || item.owner !== owner) {
          this.db
            .prepare(
              "UPDATE incidents SET status='acknowledged',owner=? WHERE id=?",
            )
            .run(owner, id);
          this.appendTimeline(
            id,
            "acknowledged",
            `Acknowledged by ${owner}.`,
            now,
          );
        }
      } else if (action === "resolve") {
        if (item.status !== "resolved") {
          const message = text(data.message, "Resolution note", 2000);
          this.db
            .prepare(
              "UPDATE incidents SET status='resolved',resolvedAt=? WHERE id=?",
            )
            .run(now, id);
          this.appendTimeline(id, "resolved", message, now);
        }
      } else throw new InputError("Unknown incident action.");
      return this.db
        .prepare("SELECT * FROM incidents WHERE id=?")
        .get(id) as unknown as Incident;
    });
  }
  timeline(id: string): TimelineEntry[] {
    this.requireRow("incidents", id);
    return this.db
      .prepare(
        "SELECT * FROM timeline WHERE incidentId=? ORDER BY createdAt,rowid",
      )
      .all(id) as unknown as TimelineEntry[];
  }
  importRelease(value: unknown, now = Date.now()): ReleaseRecord {
    const data = object(value),
      serviceId = text(data.serviceId, "Service"),
      environmentId = text(data.environmentId, "Environment");
    this.context(serviceId, environmentId);
    let transaction;
    try {
      transaction = parseReleaseTransaction(data.transaction);
    } catch {
      throw new InputError(
        "A valid Semverge release transaction JSON object is required.",
      );
    }
    text(transaction.id, "Transaction id", 256);
    text(transaction.version, "Version", 128);
    if (!/^[a-f0-9]{7,64}$/i.test(transaction.sourceCommit))
      throw new InputError(
        "A release needs its recorded hexadecimal source commit.",
      );
    const sourceUpdatedAt = Date.parse(transaction.updatedAt);
    if (
      !Number.isFinite(sourceUpdatedAt) ||
      sourceUpdatedAt > now + 300000 ||
      transaction.events.length > 1000
    )
      throw new InputError(
        "Invalid release timestamp or excessive event count.",
      );
    const events = transaction.events.map((event) => {
      if (
        !Number.isFinite(Date.parse(event.at)) ||
        !/^[a-zA-Z0-9_.:-]{1,100}$/.test(event.kind)
      )
        throw new InputError(
          "Release contains an invalid event timestamp or kind.",
        );
      return {
        kind: event.kind,
        status: event.status,
        phase: event.phase,
        attempt: event.attempt,
        at: event.at,
      };
    });
    // An allowlisted projection; never persist failure messages, targets, plugin payloads, or raw provider output.
    const projection = {
      version: transaction.version,
      sourceCommit: transaction.sourceCommit,
      phase: transaction.phase,
      failed: Number(Boolean(transaction.failure)),
      published: Number(transaction.published),
      ready: Number(transaction.ready),
      sourceUpdatedAt,
      events: JSON.stringify(events),
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(projection))
      .digest("hex");
    return this.atomic(() => {
      const existing = this.db
        .prepare(
          "SELECT * FROM releases WHERE serviceId=? AND environmentId=? AND transactionId=?",
        )
        .get(serviceId, environmentId, transaction.id) as unknown as
        | ReleaseRecord
        | undefined;
      if (existing?.fingerprint === fingerprint) return existing;
      if (
        existing &&
        (sourceUpdatedAt <= existing.sourceUpdatedAt ||
          existing.sourceCommit !== transaction.sourceCommit ||
          existing.version !== transaction.version ||
          RELEASE_PHASES.indexOf(transaction.phase) <
            RELEASE_PHASES.indexOf(existing.phase as typeof transaction.phase))
      )
        throw new InputError(
          "Stale or conflicting release import. Use a newer record with the same identity.",
          409,
        );
      const id = existing?.id ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO releases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET phase=excluded.phase,failed=excluded.failed,published=excluded.published,ready=excluded.ready,sourceUpdatedAt=excluded.sourceUpdatedAt,importedAt=excluded.importedAt,fingerprint=excluded.fingerprint,events=excluded.events`,
        )
        .run(
          id,
          serviceId,
          environmentId,
          transaction.id,
          projection.version,
          projection.sourceCommit,
          projection.phase,
          projection.failed,
          projection.published,
          projection.ready,
          sourceUpdatedAt,
          now,
          fingerprint,
          projection.events,
        );
      return this.db
        .prepare("SELECT * FROM releases WHERE id=?")
        .get(id) as unknown as ReleaseRecord;
    });
  }
  prune(now = Date.now()): void {
    this.db
      .prepare("DELETE FROM observations WHERE checkedAt<?")
      .run(now - 30 * DAY);
  }
  snapshot(now = Date.now()) {
    const monitors = this.db
      .prepare("SELECT * FROM monitors ORDER BY createdAt DESC")
      .all() as unknown as Monitor[];
    const observations = monitors.flatMap((monitor) =>
      this.history(monitor.id, 1),
    );
    const statuses = monitors.map((monitor) => {
      const check = observations.find((item) => item.monitorId === monitor.id);
      const status = monitor.paused
        ? "paused"
        : !check ||
            now - check.checkedAt > monitor.intervalSeconds * 2000 + 30000
          ? "unknown"
          : check.outcome;
      return { monitorId: monitor.id, status };
    });
    return {
      generatedAt: now,
      retentionDays: 30,
      applications: this.db
        .prepare("SELECT * FROM applications ORDER BY name")
        .all() as unknown as Application[],
      services: this.db
        .prepare("SELECT * FROM services ORDER BY name")
        .all() as unknown as Service[],
      environments: this.db
        .prepare("SELECT * FROM environments ORDER BY name")
        .all() as unknown as Environment[],
      monitors,
      observations,
      statuses,
      releases: this.db
        .prepare(
          "SELECT * FROM releases ORDER BY sourceUpdatedAt DESC LIMIT 1000",
        )
        .all() as unknown as ReleaseRecord[],
      incidents: this.db
        .prepare(
          "SELECT * FROM incidents ORDER BY (status='resolved'),createdAt DESC LIMIT 1000",
        )
        .all() as unknown as Incident[],
    };
  }
}
