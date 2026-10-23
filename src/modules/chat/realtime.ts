import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";

const incoming = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send"), clientMessageId: z.uuid(), body: z.string().min(1).max(4000) }),
  z.object({ type: z.literal("resume") }),
]);

type ResolveTenant = (headers: Headers, expectedHost: string) => Promise<string | null>;

export async function startRealtimeServer(db: PrismaClient, resolveTenant: ResolveTenant, port = 0) {
  const server: HttpServer = createServer((_request, response) => {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8_192 });

  server.on("upgrade", (request, socket, head) => {
    const address = server.address();
    if (!address || typeof address === "string") { socket.destroy(); return; }
    const expectedHost = `127.0.0.1:${address.port}`;
    const organizationId = new URL(request.url ?? "/", "http://localhost").searchParams.get("organizationId");
    if (request.headers.host !== expectedHost || !organizationId || !z.uuid().safeParse(organizationId).success || request.url?.split("?", 1)[0] !== "/ws") {
      socket.destroy();
      return;
    }
    const headers = new Headers();
    if (request.headers.cookie) headers.set("cookie", request.headers.cookie);
    if (request.headers.origin) headers.set("origin", request.headers.origin);
    headers.set("host", request.headers.host);
    void resolveTenant(headers, expectedHost).then((tenant) => {
      if (tenant !== organizationId) { socket.destroy(); return; }
      sockets.handleUpgrade(request, socket, head, (connection) => {
        sockets.emit("connection", connection, { organizationId, headers, expectedHost });
      });
    }).catch(() => socket.destroy());
  });

  sockets.on("connection", (connection: WebSocket, context: { organizationId: string; headers: Headers; expectedHost: string }) => {
    connection.on("message", (raw) => {
      void (async () => {
        if (await resolveTenant(context.headers, context.expectedHost) !== context.organizationId) { connection.close(4401); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(raw.toString()); } catch { connection.send(JSON.stringify({ type: "error", code: "INVALID_MESSAGE" })); return; }
        const message = incoming.safeParse(parsed);
        if (!message.success) { connection.send(JSON.stringify({ type: "error", code: "INVALID_MESSAGE" })); return; }
        if (message.data.type === "resume") {
          const last = await db.chatMessage.findMany({
            where: { organizationId: context.organizationId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
            select: { id: true, clientMessageId: true, body: true, createdAt: true },
          });
          connection.send(JSON.stringify({ type: "history", messages: last.reverse() }));
          return;
        }
        const saved = await db.chatMessage.upsert({
          where: { organizationId_clientMessageId: { organizationId: context.organizationId, clientMessageId: message.data.clientMessageId } },
          create: { organizationId: context.organizationId, clientMessageId: message.data.clientMessageId, body: message.data.body },
          update: {},
          select: { id: true, clientMessageId: true, body: true, createdAt: true },
        });
        connection.send(JSON.stringify({ type: "sent", message: saved }));
      })().catch(() => connection.send(JSON.stringify({ type: "error", code: "PERSISTENCE_FAILED" })));
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to obtain WebSocket port");
  return {
    port: address.port,
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
