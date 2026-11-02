// Isolated browser-test harness. Never used by platform:start or seeded into a real workspace.
import { createServer } from "node:http";
import { createPlatform } from "../build/server.js";
let status = 200;
const target = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/fail") status = 503;
  if (req.method === "POST" && req.url === "/recover") status = 200;
  res.writeHead(status);
  res.end("Local browser test endpoint");
});
await new Promise((resolve) => target.listen(4321, "127.0.0.1", resolve));
const app = createPlatform({
  database: ":memory:",
  origin: "http://127.0.0.1:4320",
  token: process.env.SEMVERGE_PLATFORM_TOKEN ?? "",
  allowLocal: true,
});
await new Promise((resolve) => app.server.listen(4320, "127.0.0.1", resolve));
console.log(
  "Browser-test installation ready on 127.0.0.1:4320 (test data only)",
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  target.close();
  target.closeAllConnections();
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
