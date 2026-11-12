import { randomUUID } from "node:crypto";
import { expect, test, type WebSocketRoute } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #393: a client that was offline for more than the replay limit (200 messages) gets `ready` with backlog "refetch" and the
// server head as cursor. The page must fill the gap from its own cursor over the real HTTP history, page by page, and only
// then resume after the newest message it really holds. The local ingress carries no WebSocket, so the live channel is
// played by the test (routeWebSocket); history, cursors and pagination come from the real application and database.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

const seqOf = (cursor: string | null) => (cursor ? Number(Buffer.from(cursor.split(".")[0], "base64url").toString("utf8").split("|")[2]) : null);

test("czat: po ready z backlog refetch luka ponad 200 wiadomości jest dociągnięta przez HTTP w kolejności i bez duplikatów", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const tag = randomUUID().slice(0, 8);
  const org = randomUUID();
  const user = randomUUID();
  const host = `chat-gap-${tag}.example.test`;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
  const sockets: { url: URL; route: WebSocketRoute }[] = [];
  const at = (seq: number) => new Date(Date.UTC(2026, 10, 9, 8, 0, seq));
  const rows = (from: number, to: number, conversationId: string) => Array.from({ length: to - from + 1 }, (_, index) => {
    const seq = from + index;
    return { organizationId: org, conversationId, senderId: user, clientMessageId: randomUUID(), seq, body: `wiadomość ${seq}`, createdAt: at(seq) };
  });
  try {
    await db.organization.create({ data: { id: org, slug: `chat-gap-${tag}`, name: `Czat luka ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.user.create({ data: { id: user, name: "Czat luka", email: `chat-gap-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: org, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.create({ data: { hostname: host, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" } });
    const conversation = await db.conversation.create({ data: { organizationId: org, lastSeq: 5, activityAt: at(5) } });
    await db.chatMessage.createMany({ data: rows(1, 5, conversation.id) });
    session = await verifiedFixtureSession(db, user);

    await page.routeWebSocket(/\/ws\?/, (route) => { sockets.push({ url: new URL(route.url()), route }); });
    const origin = `http://${host}:${port}`;
    const [name, ...rest] = session.cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: origin }]);
    await page.goto(`${origin}/admin/czat/`);
    await expect(page.getByText("wiadomość 5", { exact: true })).toBeVisible();

    // First connection: resumes after the HTTP history (seq 5) and goes live.
    await expect.poll(() => sockets.length).toBe(1);
    const own = sockets[0].url.searchParams.get("after");
    expect(seqOf(own)).toBe(5);
    const state = { ownMessageId: null, ownSeq: 0, peerMessageId: null, peerSeq: 0, unread: 0 };
    sockets[0].route.send(JSON.stringify({ type: "ready", protocol: 1, role: "ADMIN_FIRMY", conversationId: conversation.id,
      cursor: own, backlog: "none", state }));
    await expect(page.getByText("Łączenie…")).toHaveCount(0);

    // While the client is away, 250 messages are written: more than the replay limit.
    await db.chatMessage.createMany({ data: rows(6, 255, conversation.id) });
    await db.conversation.update({ where: { id: conversation.id }, data: { lastSeq: 255, activityAt: at(255) } });
    await sockets[0].route.close({ code: 4503, reason: "SHUTDOWN" });

    // Second connection: the client still sends its own cursor; the server answers refetch with the head as cursor.
    await expect.poll(() => sockets.length, { timeout: 10_000 }).toBe(2);
    expect(sockets[1].url.searchParams.get("after")).toBe(own);
    sockets[1].route.send(JSON.stringify({ type: "ready", protocol: 1, role: "ADMIN_FIRMY", conversationId: conversation.id,
      cursor: "head-of-the-conversation", backlog: "refetch", state }));

    const list = page.getByRole("log", { name: "Historia rozmowy" });
    await expect(list.getByText("wiadomość 255", { exact: true })).toBeVisible();
    const bodies = await list.locator("[data-message-id] p:nth-child(2)").allTextContents();
    expect(bodies).toEqual(Array.from({ length: 255 }, (_, index) => `wiadomość ${index + 1}`));
    const ids = await list.locator("[data-message-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-message-id")));
    expect(new Set(ids).size).toBe(255);

    // The resume point is the newest message on the list (seq 255), never the head token from ready.
    await sockets[1].route.close({ code: 4503, reason: "SHUTDOWN" });
    await expect.poll(() => sockets.length, { timeout: 10_000 }).toBe(3);
    expect(seqOf(sockets[2].url.searchParams.get("after"))).toBe(255);
  } finally {
    await session?.dispose();
    await db.chatMessage.deleteMany({ where: { organizationId: org } });
    await db.conversation.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: user } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
