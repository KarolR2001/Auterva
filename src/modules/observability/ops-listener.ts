import { createServer, type Server } from "node:http";
import type { ReadinessReport } from "./health";
import { liveResponse, metricsResponse, readyResponse } from "./ops-http";

export type OpsListenerOptions = {
  port: number;
  host?: string;
  readiness: () => Promise<ReadinessReport>;
  refresh?: () => Promise<void>;
  token?: string | null;
};

/**
 * Tiny internal HTTP listener for processes that serve no web traffic (worker, realtime, media worker, monitor).
 * Binds loopback unless OPS_HOST says otherwise; the metrics endpoint needs the token either way.
 */
export function startOpsListener(options: OpsListenerOptions): Promise<Server> {
  const host = options.host ?? "127.0.0.1";
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://ops.local");
      const request = new Request(url, { headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string") as Array<[string, string]>) });
      const response = req.method !== "GET" ? new Response(null, { status: 405 })
        : url.pathname === "/live" ? liveResponse()
        : url.pathname === "/ready" ? await readyResponse(request, options.readiness, options.token)
        : url.pathname === "/metrics" ? await metricsResponse(request, options.refresh, options.token)
        : new Response(null, { status: 404 });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500, { "Cache-Control": "no-store" });
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => resolve(server));
  });
}
