import { createServer } from "node:net";
import { afterEach, expect, test } from "vitest";
import { metrics } from "../../src/modules/observability/metrics";
import { initProcessObservability } from "../../src/modules/observability/process";

const token = "p".repeat(32);
let close = async () => {};
afterEach(() => close());

function freePort() {
  return new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => { const port = (probe.address() as { port: number }).port; probe.close(() => resolve(port)); });
  });
}

test("R3: a stale /ready result never stays in the metrics: every scrape re-evaluates readiness", async () => {
  metrics.reset();
  let down = true;
  const db = { $queryRaw: async () => { if (down) throw new Error("down"); return [{ oldest: null }]; } } as never;
  const port = await freePort();
  const ops = await initProcessObservability("worker", { db, checks: ["database"], readinessTtlMs: 5, env: { OPS_PORT: String(port), OPS_METRICS_TOKEN: token } });
  close = ops.close;
  const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await get("/ready")).status).toBe(503); // one manual probe during the outage
  expect(await (await get("/metrics")).text()).toContain('auterva_ready_check{check="database"} 0');
  down = false;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const text = await (await get("/metrics")).text(); // no /ready call in between
  expect(text).toContain('auterva_ready_check{check="database"} 1');
  expect(text).not.toContain('auterva_ready_check{check="database"} 0');
});
