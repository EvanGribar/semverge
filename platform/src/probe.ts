import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { performance } from "node:perf_hooks";
import { InputError, type ProbeResult } from "./models.js";

const privateAddresses = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const) privateAddresses.addSubnet(address,prefix,"ipv4");
for (const [address,prefix] of [["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20]] as const) privateAddresses.addSubnet(address,prefix,"ipv6");
const globalV6 = new BlockList(); globalV6.addSubnet("2000::",3,"ipv6");

export function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !privateAddresses.check(address,"ipv4") : family === 6 && globalV6.check(address,"ipv6") && !privateAddresses.check(address,"ipv6");
}
export function monitorUrl(value: string, allowLocal = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new InputError("Enter an absolute HTTPS URL."); }
  if (url.username || url.password || url.search || url.hash) throw new InputError("Monitor URLs cannot contain credentials, a query string or a fragment.");
  if (allowLocal && url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port) >= 1024) return url.href;
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) throw new InputError("Public monitors require HTTPS on port 443.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || (isIP(host) && !publicAddress(host))) throw new InputError("Private, loopback and reserved addresses cannot be monitored.");
  return url.href;
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export async function probe(value: string, expectedStatus: number, options: { allowLocal?: boolean; timeoutMs?: number; resolve?: Resolver } = {}): Promise<ProbeResult> {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  let timedOut = false;
  try {
    const url = new URL(monitorUrl(value, options.allowLocal));
    const local = url.protocol === "http:" && url.hostname === "127.0.0.1" && options.allowLocal;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const resolve = options.resolve ?? ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
      resolve(host), new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }))
    ]);
    if (!local && (!addresses.length || addresses.some((item) => !publicAddress(item.address)))) return { outcome: "down", statusCode: null, latencyMs: Math.round(performance.now() - start), reason: "Address blocked by egress policy" };
    if (controller.signal.aborted) throw new Error("timeout");
    const pinned = addresses[0]!;
    const statusCode = await new Promise<number>((resolveStatus, reject) => {
      const request = (local ? httpRequest : httpsRequest)(url, {
        method: "GET", signal: controller.signal, agent: false, family: pinned.family,
        headers: { "user-agent": "semverge-monitor/0.1", accept: "*/*" },
        // The connection uses exactly the checked address, including under DNS rebinding.
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family)
      }, (response) => {
        const status = response.statusCode ?? 0;
        response.destroy(); resolveStatus(status);
      });
      request.on("error", reject); request.end();
    });
    const up = statusCode === expectedStatus;
    return { outcome: up ? "up" : "down", statusCode, latencyMs: Math.round(performance.now() - start), reason: up ? "Expected response" : statusCode >= 300 && statusCode < 400 ? "Redirects are not followed" : "Unexpected HTTP status" };
  } catch {
    timedOut = controller.signal.aborted;
    return { outcome: "down", statusCode: null, latencyMs: Math.round(performance.now() - start), reason: timedOut ? "Check timed out" : "Connection or TLS failed" };
  } finally { clearTimeout(timeout); }
}
