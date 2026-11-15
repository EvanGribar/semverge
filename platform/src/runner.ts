import { Store } from "./store.js";
import { probe } from "./probe.js";
import { InputError, type ProbeResult } from "./models.js";

export type CheckProbe = (
  url: string,
  expectedStatus: number,
) => Promise<ProbeResult>;
export class MonitorRunner {
  private active = new Set<Promise<unknown>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private lastPrune = 0;
  lastTickAt: number | null = null;
  lastErrorAt: number | null = null;
  constructor(
    readonly store: Store,
    private readonly check: CheckProbe = probe,
  ) {}
  get running(): number {
    return this.active.size;
  }
  async run(id: string, manual = false, now = Date.now()) {
    if (this.stopped || this.active.size >= 3)
      throw new InputError("The worker is busy. Try again shortly.", 409);
    const monitor = this.store.claim(id, now, manual);
    if (!monitor)
      throw new InputError(
        "Monitor is paused, already checking or not due.",
        409,
      );
    const work = (async () => {
      // A failed worker never invents a success; the persisted lease expires on interruption.
      const result = await this.check(monitor.url, monitor.expectedStatus);
      return this.store.recordCheck(monitor, result);
    })();
    this.active.add(work);
    try {
      return await work;
    } finally {
      this.active.delete(work);
    }
  }
  tick(now = Date.now()): void {
    if (this.stopped) return;
    this.lastTickAt = now;
    try {
      if (now - this.lastPrune >= 86400000) {
        this.store.prune(now);
        this.lastPrune = now;
      }
      for (const monitor of this.store.due(now)) {
        if (this.active.size >= 3) break;
        void this.run(monitor.id, false, now).catch(() => {
          this.lastErrorAt = Date.now();
        });
      }
    } catch {
      this.lastErrorAt = Date.now();
    }
  }
  start(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.active]);
  }
}
