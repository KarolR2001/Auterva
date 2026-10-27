import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

type Reply = { status: number; body: Record<string, unknown>; headers: IncomingHttpHeaders };

function call(port: number, host: string, method: string, path: string, cookie = "", body?: unknown): Promise<Reply> {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: {
      Host: host, Origin: `http://${host}`, ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
    } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        let parsed: Record<string, unknown> = {};
        try { parsed = raw && response.headers["content-type"]?.includes("application/json") ? JSON.parse(raw) : {}; }
        catch (error) { reject(error); return; }
        resolve({ status: response.statusCode ?? 0, body: parsed, headers: response.headers });
      });
    });
    request.on("error", reject);
    request.end(data);
  });
}

test("built app: admin A writes, superadmin reads conversation A, admin B sees nothing, archive refuses A but keeps history", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [orgA, orgB, userA, userB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const platformHost = `chat-e2e-platform-${randomUUID()}.example.test`;
  const hostA = `chat-e2e-a-${orgA}.example.test`;
  const hostB = `chat-e2e-b-${orgB}.example.test`;
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  let ownedSuperadmin: string | null = null;
  try {
    await db.organization.createMany({ data: [orgA, orgB].map((id) => ({ id, slug: `chat-e2e-${id}`, name: `Chat ${id.slice(0, 4)}`,
      firstAdminRegisteredAt: new Date() })) });
    await db.hostMapping.createMany({ data: [
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
      { hostname: hostA, area: "COMPANY_ADMIN", organizationId: orgA, status: "ACTIVE" },
      { hostname: hostB, area: "COMPANY_ADMIN", organizationId: orgB, status: "ACTIVE" },
    ] });
    // Both companies have an expired trial and no paid period: chat must work regardless.
    for (const [id, organizationId] of [[userA, orgA], [userB, orgB]] as const) {
      await db.serviceAccess.create({ data: { organizationId, trialGranted: true,
        trialStartedAt: new Date(Date.now() - 500 * 3_600_000), trialEndsAt: new Date(Date.now() - 164 * 3_600_000) } });
      await db.user.create({ data: { id, name: "Chat E2E admin", email: `chat-e2e-${id}@example.test`, emailVerified: true,
        twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
    }
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const platformId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, platformId);
    else {
      ownedSuperadmin = platformId;
      await db.user.create({ data: { id: platformId, name: "Chat E2E operator", email: `chat-e2e-op-${platformId}@example.test`,
        emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    }
    const [platform, adminA, adminB] = [await verifiedFixtureSession(db, platformId), await verifiedFixtureSession(db, userA),
      await verifiedFixtureSession(db, userB)];
    sessions.push(platform, adminA, adminB);
    const html = "<script>window.__chat=1</script> <b>pogrubione</b>";
    const id = randomUUID();

    // Superadmin opens A's conversation (never existed); admin A sees the same one; GET on B creates nothing.
    const opened = await call(port, platformHost, "POST", `/api/platform/companies/${orgA}/chat/conversation/`, platform.cookie);
    expect(opened.status).toBe(201);
    const conversationId = opened.body.conversationId as string;
    expect((await call(port, hostB, "GET", "/api/admin/chat/conversation/", adminB.cookie)).body).toEqual({ conversationId: null });

    const sent = await call(port, hostA, "POST", "/api/admin/chat/messages/", adminA.cookie, { clientMessageId: id, body: html });
    expect(sent.status).toBe(201);
    expect(sent.headers["cache-control"]).toBe("no-store");
    // A lost response: the retry is the same message.
    const retry = await call(port, hostA, "POST", "/api/admin/chat/messages/", adminA.cookie, { clientMessageId: id, body: html });
    expect(retry.status).toBe(200);
    expect((retry.body.message as { id: string }).id).toBe((sent.body.message as { id: string }).id);
    const reply = await call(port, platformHost, "POST", `/api/platform/companies/${orgA}/chat/messages/`, platform.cookie,
      { clientMessageId: randomUUID(), body: "Odpowiedź Autervy", conversationId });
    expect(reply.status).toBe(201);

    const platformView = await call(port, platformHost, "GET", `/api/platform/companies/${orgA}/chat/messages/`, platform.cookie);
    expect((platformView.body.messages as { body: string }[]).map((m) => m.body)).toEqual([html, "Odpowiedź Autervy"]);
    const adminView = await call(port, hostA, "GET", "/api/admin/chat/messages/", adminA.cookie);
    expect(adminView.body.conversationId).toBe(conversationId);
    const inbox = await call(port, platformHost, "GET", "/api/platform/chat/conversations/?limit=100", platform.cookie);
    const entry = (inbox.body.conversations as { organizationId: string; lastMessage: { preview: string } }[]).find((item) => item.organizationId === orgA);
    expect(entry?.lastMessage.preview).toBe("Odpowiedź Autervy");

    // Admin B sees nothing of A and cannot reach A's conversation or company.
    const bView = await call(port, hostB, "GET", "/api/admin/chat/messages/", adminB.cookie);
    expect(bView.body).toMatchObject({ conversationId: null, messages: [] });
    expect(JSON.stringify(bView.body)).not.toContain("Odpowiedź");
    expect((await call(port, hostB, "GET", `/api/admin/chat/messages/?conversationId=${conversationId}`, adminB.cookie)).status).toBe(404);
    expect((await call(port, hostA, "GET", "/api/admin/chat/messages/", adminB.cookie)).status).toBe(403);
    expect((await call(port, platformHost, "GET", `/api/platform/companies/${orgA}/chat/messages/`, adminB.cookie)).status).toBe(403);
    expect((await call(port, hostB, "POST", "/api/admin/chat/messages/", adminB.cookie,
      { clientMessageId: randomUUID(), body: "x", conversationId })).status).toBe(404);
    // Chat is not a public surface and never mails.
    expect((await call(port, hostA, "GET", "/api/admin/chat/messages/")).status).toBe(403);
    expect(await db.job.count({ where: { organizationId: { in: [orgA, orgB] } } })).toBe(0);

    // Archive: admin A is refused everywhere, the superadmin still reads the history.
    const detail = await call(port, platformHost, "GET", `/api/platform/companies/${orgA}/`, platform.cookie);
    const archived = await call(port, platformHost, "POST", `/api/platform/companies/${orgA}/archive/`, platform.cookie,
      { expectedOrganizationVersion: detail.body.organizationVersion, eventKey: randomUUID() });
    expect(archived.status).toBe(200);
    expect((await call(port, hostA, "POST", "/api/admin/chat/messages/", adminA.cookie,
      { clientMessageId: randomUUID(), body: "po archiwizacji" })).status).toBe(403);
    expect((await call(port, hostA, "GET", "/api/admin/chat/messages/", adminA.cookie)).status).toBe(403);
    const kept = await call(port, platformHost, "GET", `/api/platform/companies/${orgA}/chat/messages/`, platform.cookie);
    expect((kept.body.messages as { body: string }[]).map((m) => m.body)).toEqual([html, "Odpowiedź Autervy"]);
    expect(await db.chatMessage.count({ where: { organizationId: orgA } })).toBe(2);
  } finally {
    await db.chatMessage.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.conversation.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    for (const session of sessions) await session.dispose();
    await db.user.deleteMany({ where: { id: { in: [userA, userB, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [platformHost, hostA, hostB] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  }
});
