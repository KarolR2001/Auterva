import { createHmac, randomUUID } from "node:crypto";
import { getServerEnv } from "../../src/lib/env";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import { ChatError } from "../../src/modules/chat/errors";
import { listMessages, listPlatformConversations, openConversation, sendMessage, type ChatScope } from "../../src/modules/chat/service";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { GET as adminMessagesGet, POST as adminMessagesPost } from "../../src/app/api/admin/chat/messages/route";
import { GET as adminConversationGet, POST as adminConversationPost } from "../../src/app/api/admin/chat/conversation/route";
import { GET as platformMessagesGet, POST as platformMessagesPost } from "../../src/app/api/platform/companies/[organizationId]/chat/messages/route";
import { GET as platformConversationGet, POST as platformConversationPost } from "../../src/app/api/platform/companies/[organizationId]/chat/conversation/route";
import { GET as platformList } from "../../src/app/api/platform/chat/conversations/route";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const platformHost = `chat-platform-${randomUUID()}.example.test`;
type Company = { organizationId: string; adminId: string; host: string; cookie: string; sessionId: string;
  admin: ChatScope; operator: ChatScope };
const created: Company[] = [];
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
let platformId = "";
let platformSessionId = "";
let platformCookie = "";
let ownedPlatformId: string | null = null;
let timeBase = Date.UTC(2031, 0, 1);

async function makeCompany(label: string, options: { expiredPeriod?: boolean } = {}): Promise<Company> {
  const organizationId = randomUUID();
  const adminId = randomUUID();
  const host = `chat-${label}-${organizationId}.example.test`;
  await db.organization.create({ data: { id: organizationId, slug: `chat-${label}-${organizationId}`,
    name: `Firma ${label}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: host, organizationId, area: "COMPANY_ADMIN", status: "ACTIVE" } });
  if (options.expiredPeriod) {
    await db.serviceAccess.create({ data: { organizationId, trialGranted: true,
      trialStartedAt: new Date(Date.now() - 400 * 3_600_000), trialEndsAt: new Date(Date.now() - 64 * 3_600_000),
      paidThrough: new Date("2026-01-01T00:00:00Z"), changedById: platformId } });
  }
  await db.user.create({ data: { id: adminId, name: `Admin ${label}`, email: `chat-${adminId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  const session = await verifiedFixtureSession(db, adminId);
  sessions.push(session);
  const sessionRow = await db.session.findUniqueOrThrow({ where: { token: session.cookie.split("=")[1].split(".")[0] } });
  const company: Company = { organizationId, adminId, host, cookie: session.cookie, sessionId: sessionRow.id,
    admin: { actorId: adminId, sessionId: sessionRow.id, organizationId },
    operator: { actorId: platformId, sessionId: platformSessionId, organizationId } };
  created.push(company);
  return company;
}

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = platform?.id ?? randomUUID();
  if (platform) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "Chat operator", email: `chat-op-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const session = await verifiedFixtureSession(db, platformId);
  sessions.push(session);
  platformCookie = session.cookie;
  platformSessionId = (await db.session.findUniqueOrThrow({ where: { token: session.cookie.split("=")[1].split(".")[0] } })).id;
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
});

afterAll(async () => {
  // The controlled clock starts in 2031; those chat:send events would otherwise outlive the run and
  // keep the (possibly shared) operator rate-limited for later runs such as E2E.
  const chatKeys = [...new Set([platformId, ...created.map((company) => company.adminId)])].flatMap((actorId) =>
    [`chat:send:burst:${actorId}`, `chat:send:minute:${actorId}`])
    .map((key) => createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: chatKeys }, occurredAt: { gte: new Date(Date.UTC(2031, 0, 1)) } } });
  const organizationId = { in: created.map((company) => company.organizationId) };
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.job.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { OR: [{ hostname: platformHost }, { organizationId }] } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: [...created.map((company) => company.adminId), ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

const nextBase = () => { timeBase += 3_600_000; return timeBase; };
function http(method: string, path: string, host: string, cookie: string, data?: object) {
  return new Request(`http://127.0.0.1:3381${path}`, { method, headers: { host, origin: `http://${host}`, cookie,
    ...(data ? { "content-type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const orgParams = (organizationId: string) => ({ params: Promise.resolve({ organizationId }) });
const adminSend = (company: Company, clientMessageId: string, body: string, extra: object = {}) =>
  adminMessagesPost(http("POST", "/api/admin/chat/messages", company.host, company.cookie, { clientMessageId, body, ...extra }));
const platformSend = (organizationId: string, clientMessageId: string, body: string, extra: object = {}) =>
  platformMessagesPost(http("POST", `/api/platform/companies/${organizationId}/chat/messages`, platformHost, platformCookie,
    { clientMessageId, body, ...extra }), orgParams(organizationId));
const platformRead = (organizationId: string, query = "") =>
  platformMessagesGet(http("GET", `/api/platform/companies/${organizationId}/chat/messages${query}`, platformHost, platformCookie),
    orgParams(organizationId));
const adminRead = (company: Company, query = "") =>
  adminMessagesGet(http("GET", `/api/admin/chat/messages${query}`, company.host, company.cookie));
const codeOf = async (promise: Promise<unknown>) => {
  try { await promise; return "none"; } catch (error) { return error instanceof ChatError ? error.code : `other:${String(error)}`; }
};

test("parallel open creates exactly one conversation, GET creates nothing, and the target company only", async () => {
  const [a, b, empty] = [await makeCompany("open-a"), await makeCompany("open-b"), await makeCompany("open-empty")];
  const before = await adminConversationGet(http("GET", "/api/admin/chat/conversation", empty.host, empty.cookie));
  expect(await before.json()).toEqual({ conversationId: null });
  const platformBefore = await platformConversationGet(http("GET", `/api/platform/companies/${empty.organizationId}/chat/conversation`,
    platformHost, platformCookie), orgParams(empty.organizationId));
  expect(await platformBefore.json()).toEqual({ conversationId: null });
  expect(await db.conversation.count({ where: { organizationId: empty.organizationId } })).toBe(0);

  const results = await Promise.all([
    ...Array.from({ length: 6 }, () => openConversation(db, a.admin)),
    ...Array.from({ length: 6 }, () => openConversation(db, a.operator)),
  ]);
  expect(new Set(results.map((result) => result.conversationId)).size).toBe(1);
  expect(results.filter((result) => result.created)).toHaveLength(1);
  expect(await db.conversation.count({ where: { organizationId: a.organizationId } })).toBe(1);

  // Superadmin opens a company that never had one, through the platform route; retry returns the same id.
  const first = await platformConversationPost(http("POST", `/api/platform/companies/${b.organizationId}/chat/conversation`,
    platformHost, platformCookie, undefined), orgParams(b.organizationId));
  expect(first.status).toBe(201);
  const opened = await first.json() as { conversationId: string; created: boolean };
  expect(opened.created).toBe(true);
  const again = await platformConversationPost(http("POST", `/api/platform/companies/${b.organizationId}/chat/conversation`,
    platformHost, platformCookie), orgParams(b.organizationId));
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ conversationId: opened.conversationId, created: false });
  expect(opened.conversationId).not.toBe(results[0].conversationId);
  // Admin of B sees exactly that conversation through its own host.
  const adminOpen = await adminConversationPost(http("POST", "/api/admin/chat/conversation", b.host, b.cookie));
  expect(await adminOpen.json()).toEqual({ conversationId: opened.conversationId, created: false });
  // Missing/foreign company: unknown id is 404, the admin session on a foreign host or the platform route is refused.
  const unknown = randomUUID();
  const missing = await platformConversationPost(http("POST", `/api/platform/companies/${unknown}/chat/conversation`,
    platformHost, platformCookie), orgParams(unknown));
  expect(missing.status).toBe(403); // same as every platform company route: an unknown target is not an authorised context
  expect(await db.conversation.count({ where: { organizationId: unknown } })).toBe(0);
  const crossHost = await adminConversationPost(http("POST", "/api/admin/chat/conversation", a.host, b.cookie));
  expect(crossHost.status).toBe(403);
  const adminOnPlatform = await platformConversationPost(http("POST", `/api/platform/companies/${a.organizationId}/chat/conversation`,
    platformHost, a.cookie), orgParams(a.organizationId));
  expect(adminOnPlatform.status).toBe(403);
});

test("admin A sends, superadmin sees it in conversation A, admin B and conversation B do not", async () => {
  const [a, b] = [await makeCompany("iso-a"), await makeCompany("iso-b")];
  const html = "<img src=x onerror=alert(1)> <script>x</script> & \"quote\"";
  const id = randomUUID();
  const sent = await adminSend(a, id, html);
  expect(sent.status).toBe(201);
  expect(sent.headers.get("cache-control")).toBe("no-store");
  const payload = await sent.json() as { message: { id: string; body: string; own: boolean; senderRole: string; clientMessageId: string }; conversationId: string };
  expect(payload.message).toMatchObject({ body: html, own: true, senderRole: "ADMIN_FIRMY", clientMessageId: id });
  expect(Object.keys(payload.message).sort()).toEqual(["body", "clientMessageId", "createdAt", "id", "own", "senderRole"]);

  const seen = await platformRead(a.organizationId);
  const history = await seen.json() as { conversationId: string; messages: { id: string; body: string; own: boolean; clientMessageId: string | null; senderRole: string }[] };
  expect(history.conversationId).toBe(payload.conversationId);
  expect(history.messages).toEqual([expect.objectContaining({ id: payload.message.id, body: html, own: false,
    clientMessageId: null, senderRole: "ADMIN_FIRMY" })]);

  const reply = await platformSend(a.organizationId, randomUUID(), "Odpowiedź Autervy");
  expect(reply.status).toBe(201);
  const adminView = await (await adminRead(a)).json() as { messages: { body: string; senderRole: string; own: boolean }[] };
  expect(adminView.messages.map((m) => [m.body, m.senderRole, m.own])).toEqual([[html, "ADMIN_FIRMY", true], ["Odpowiedź Autervy", "SUPERADMIN_AUTERVA", false]]);

  const other = await (await adminRead(b)).json();
  expect(other).toMatchObject({ conversationId: null, messages: [] });
  expect(JSON.stringify(other)).not.toContain("Odpowiedź");
  const platformB = await (await platformRead(b.organizationId)).json();
  expect(platformB).toMatchObject({ conversationId: null, messages: [] });

  // Forged conversationId (TEST-MVP-07): B's admin cannot write into A's conversation, nothing is persisted.
  const rows = await db.chatMessage.count({ where: { organizationId: b.organizationId } });
  const forged = await adminSend(b, randomUUID(), "podmiana", { conversationId: payload.conversationId });
  expect(forged.status).toBe(404);
  expect(await db.chatMessage.count({ where: { organizationId: b.organizationId } })).toBe(rows);
  expect((await adminRead(b, `?conversationId=${payload.conversationId}`)).status).toBe(404);
  // A cursor of conversation A is refused in company B.
  const cursorA = (await (await adminRead(a)).json() as { olderCursor: string | null; newerCursor: string }).newerCursor;
  await adminSend(b, randomUUID(), "hello B");
  expect((await adminRead(b, `?after=${encodeURIComponent(cursorA)}`)).status).toBe(400);
  // Another admin's session on this host, no session, and unknown fields (attachments) are refused.
  expect((await adminMessagesGet(http("GET", "/api/admin/chat/messages", a.host, b.cookie))).status).toBe(403);
  expect((await adminMessagesGet(http("GET", "/api/admin/chat/messages", a.host, ""))).status).toBe(403);
  const attachment = await adminSend(a, randomUUID(), "z załącznikiem", { attachments: [{ url: "https://x" }] });
  expect(attachment.status).toBe(400);
  // No e-mail, audit text or job was produced by chat.
  expect(await db.job.count({ where: { organizationId: { in: [a.organizationId, b.organizationId] } } })).toBe(0);
  expect(await db.auditLog.count({ where: { organizationId: { in: [a.organizationId, b.organizationId] },
    action: { not: "AUTH_LOGIN_COMPLETED" } } })).toBe(0);
});

test("retry of an uncertain send, in parallel and after a lost response, yields one message and one charge", async () => {
  const company = await makeCompany("retry");
  const base = nextBase();
  const id = randomUUID();
  const results = await Promise.all(Array.from({ length: 12 }, () =>
    sendMessage(db, company.admin, { clientMessageId: id, body: "Jedna wiadomość" }, new Date(base))));
  expect(new Set(results.map((result) => result.message.id)).size).toBe(1);
  expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(1);
  // Same id, other text -> conflict; same id from the other participant -> conflict; nothing changes.
  expect(await codeOf(sendMessage(db, company.admin, { clientMessageId: id, body: "Inna treść" }, new Date(base)))).toBe("CLIENT_MESSAGE_ID_CONFLICT");
  expect(await codeOf(sendMessage(db, company.operator, { clientMessageId: id, body: "Jedna wiadomość" }, new Date(base)))).toBe("CLIENT_MESSAGE_ID_CONFLICT");
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(1);
  // Burst window: 9 more distinct messages fill 10/10 s; retries stay free, the 11th new message is refused.
  for (let i = 0; i < 9; i += 1) await sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: `m${i}` }, new Date(base + i));
  const retry = await sendMessage(db, company.admin, { clientMessageId: id, body: "Jedna wiadomość" }, new Date(base + 9));
  expect(retry.deduplicated).toBe(true);
  const refused = await sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "jedenasta" }, new Date(base + 9)).catch((e) => e);
  expect(refused).toBeInstanceOf(ChatError);
  expect([refused.code, refused.retryAfter]).toEqual(["RATE_LIMITED", 10]);
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(10);
  // After the burst window the next one passes (minute window has room: 10 of 30).
  await sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "po oknie" }, new Date(base + 10_001));
  // Lost response over HTTP: the same request again returns the same message with 200.
  const httpId = randomUUID();
  const first = await adminSend(company, httpId, "po utracie odpowiedzi");
  const second = await adminSend(company, httpId, "po utracie odpowiedzi");
  expect([first.status, second.status]).toEqual([201, 200]);
  expect((await first.json() as { message: { id: string } }).message.id).toBe((await second.json() as { message: { id: string } }).message.id);
  expect((await adminSend(company, httpId, "zmieniona")).status).toBe(409);
});

test("minute window: 30 accepted messages block the 31st until the oldest leaves the window", async () => {
  const company = await makeCompany("minute");
  const base = nextBase();
  for (let i = 0; i < 30; i += 1) {
    await sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: `n${i}` }, new Date(base + i * 2_000));
  }
  const refused = await sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "31" }, new Date(base + 58_000)).catch((e) => e);
  expect([refused.code, refused.retryAfter]).toEqual(["RATE_LIMITED", 2]);
  await sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "31" }, new Date(base + 60_000));
});

test("limits: 4 000 characters pass, 4 001 and control characters are refused without a row; DB check is a second barrier", async () => {
  const company = await makeCompany("limits");
  const base = nextBase();
  const ok = await sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "😀".repeat(4000) }, new Date(base));
  expect(Array.from(ok.message.body)).toHaveLength(4000);
  const bodies: [string, string][] = [["😀".repeat(4001), "MESSAGE_TOO_LONG"], ["a\u0000b", "CHAT_INVALID_MESSAGE"], ["   ", "CHAT_INVALID_MESSAGE"]];
  for (const [body, expected] of bodies) {
    expect(await codeOf(sendMessage(db, company.admin, { clientMessageId: randomUUID(), body }, new Date(base)))).toBe(expected);
  }
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(1);
  for (const bad of ["\u200B", "x\u202Ey", "x\u2028y", "a\u0000b"]) {
    expect((await adminSend(company, randomUUID(), bad)).status).toBe(400);
  }
  expect((await adminSend(company, randomUUID(), "Zażółć 👨\u200D👩 gęślą")).status).toBe(201);
  const tooLong = await adminSend(company, randomUUID(), "a".repeat(4001));
  expect(tooLong.status).toBe(422);
  const text = JSON.stringify(await tooLong.json());
  expect(text).toContain("MESSAGE_TOO_LONG");
  expect(text).not.toContain("aaaa");
  const conversation = await db.conversation.findFirstOrThrow({ where: { organizationId: company.organizationId } });
  await expect(db.chatMessage.create({ data: { organizationId: company.organizationId, conversationId: conversation.id,
    senderId: company.adminId, clientMessageId: randomUUID(), seq: 99, body: "x".repeat(4001) } })).rejects.toThrow();
});

test("service period expiry does not block chat and earlier history stays readable", async () => {
  const company = await makeCompany("expired", { expiredPeriod: true });
  const base = nextBase();
  await sendMessage(db, company.operator, { clientMessageId: randomUUID(), body: "przed końcem" }, new Date(base));
  const sent = await adminSend(company, randomUUID(), "po końcu okresu");
  expect(sent.status).toBe(201);
  const history = await (await adminRead(company)).json() as { messages: { body: string }[] };
  expect(history.messages.map((m) => m.body)).toEqual(["przed końcem", "po końcu okresu"]);
});

test("archive: admin refused and history kept; superadmin reads, writes are refused; restore keeps history", async () => {
  const company = await makeCompany("archive");
  await adminSend(company, randomUUID(), "przed archiwizacją");
  await archiveCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId: company.organizationId,
    expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() });
  expect((await adminSend(company, randomUUID(), "po archiwizacji")).status).toBe(403);
  expect((await adminRead(company)).status).toBe(403);
  expect(await codeOf(sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "x" }))).toBe("CHAT_FORBIDDEN");
  const kept = await (await platformRead(company.organizationId)).json() as { messages: { body: string }[] };
  expect(kept.messages.map((m) => m.body)).toEqual(["przed archiwizacją"]);
  const refused = await platformSend(company.organizationId, randomUUID(), "do zarchiwizowanej");
  expect([refused.status, (await refused.json() as { code: string }).code]).toEqual([409, "CHAT_ORGANIZATION_ARCHIVED"]);
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(1);
  await restoreCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId: company.organizationId,
    expectedVersion: 1, eventKey: randomUUID(), requestId: randomUUID() });
  expect((await platformSend(company.organizationId, randomUUID(), "po przywróceniu")).status).toBe(201);
  expect((await adminRead(company)).status).toBe(403); // the old session stays revoked until a new login
  const all = await (await platformRead(company.organizationId)).json() as { messages: { body: string }[] };
  expect(all.messages.map((m) => m.body)).toEqual(["przed archiwizacją", "po przywróceniu"]);
});

test("admin send racing an archive: a send queued behind the archive is refused with no row", async () => {
  const company = await makeCompany("lock-archive");
  await openConversation(db, company.admin);
  const holder = new Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT id FROM "Organization" WHERE id = $1::uuid FOR UPDATE`, [company.organizationId]);
    const pending = sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "w kolejce" }).catch((e) => e);
    const early = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve("waiting"), 400))]);
    expect(early).toBe("waiting"); // the send really waits for the company lock
    await holder.query(`UPDATE "Organization" SET "archivedAt" = now() WHERE id = $1::uuid`, [company.organizationId]);
    await holder.query(`DELETE FROM "session" WHERE "userId" = $1`, [company.adminId]);
    await holder.query("COMMIT");
    const result = await pending;
    expect(result).toBeInstanceOf(ChatError);
    expect((result as ChatError).code).toBe("CHAT_FORBIDDEN");
  } finally { await holder.end(); }
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(0);
});

test("admin send and archive started together: whichever wins, no message appears after the archive", async () => {
  for (let round = 0; round < 8; round += 1) {
    const company = await makeCompany(`race-${round}`);
    await openConversation(db, company.admin);
    const base = nextBase();
    const [sent, archived] = await Promise.all([
      sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "wyścig" }, new Date(base)).catch((e) => e),
      archiveCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId: company.organizationId,
        expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() }),
    ]);
    expect(archived.archivedAt).toBeTruthy();
    const rows = await db.chatMessage.count({ where: { organizationId: company.organizationId } });
    if (sent instanceof ChatError) { expect(sent.code).toBe("CHAT_FORBIDDEN"); expect(rows).toBe(0); }
    else { expect(rows).toBe(1); }
    expect(await codeOf(sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "po" }, new Date(base + 1)))).toBe("CHAT_FORBIDDEN");
    expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(rows);
  }
});

test("cursor history under parallel inserts has no gaps or duplicates and is independent of offsets", async () => {
  const company = await makeCompany("paging");
  const base = nextBase();
  const initial: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const sent = await sendMessage(db, i % 2 ? company.operator : company.admin,
      { clientMessageId: randomUUID(), body: `stara ${i}` }, new Date(base + i * 3_000));
    initial.push(sent.message.id);
  }
  const latest = await listMessages(db, company.admin, { limit: 7 });
  expect(latest.messages).toHaveLength(7);
  expect(latest.messages.at(-1)?.body).toBe("stara 39");
  // 30 new messages from both participants arrive in parallel while the older pages are walked.
  const freshBase = base + 40 * 3_000;
  const inserts = Promise.all(Array.from({ length: 30 }, (_, i) =>
    sendMessage(db, i % 2 ? company.operator : company.admin, { clientMessageId: randomUUID(), body: `nowa ${i}` },
      new Date(freshBase + i * 3_000))));
  const walked: string[] = [...latest.messages.map((m) => m.id).reverse()];
  let cursor = latest.olderCursor;
  while (cursor) {
    const page = await listMessages(db, company.admin, { limit: 7, before: cursor });
    walked.push(...page.messages.map((m) => m.id).reverse());
    cursor = page.olderCursor;
  }
  await inserts;
  expect(new Set(walked).size).toBe(walked.length);
  expect(walked.reverse()).toEqual(initial);
  // Reading forward from the first page's newer cursor yields every message committed after it, once, in order.
  const seen: string[] = [];
  let after = latest.newerCursor;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await listMessages(db, company.operator, { limit: 9, after: after! });
    seen.push(...page.messages.map((m) => m.body));
    after = page.newerCursor;
    if (!page.hasNewer) break;
  }
  expect([...seen].sort()).toEqual(Array.from({ length: 30 }, (_, i) => `nowa ${i}`).sort());
  const stored = await db.chatMessage.findMany({ where: { organizationId: company.organizationId }, orderBy: { seq: "asc" },
    select: { seq: true } });
  expect(stored.map((row) => row.seq)).toEqual(Array.from({ length: 70 }, (_, i) => i + 1));
  const tail = await listMessages(db, company.admin, { limit: 100 });
  expect(tail.messages).toHaveLength(70);
  expect(tail.olderCursor).toBeNull();
  // Bad inputs.
  expect(await codeOf(listMessages(db, company.admin, { limit: 0 }))).toBe("CHAT_INVALID_INPUT");
  expect(await codeOf(listMessages(db, company.admin, { limit: 101 }))).toBe("CHAT_INVALID_INPUT");
  expect(await codeOf(listMessages(db, company.admin, { before: "forged.value" }))).toBe("CHAT_INVALID_CURSOR");
  expect((await adminRead(company, "?limit=abc")).status).toBe(400);
  expect((await adminRead(company, "?offset=5")).status).toBe(400);
});

test("platform conversation list: superadmin only, last activity first, cursor-paged, archived flagged", async () => {
  const [x, y, z] = [await makeCompany("list-x"), await makeCompany("list-y"), await makeCompany("list-z")];
  const base = nextBase();
  await sendMessage(db, x.admin, { clientMessageId: randomUUID(), body: "x1" }, new Date(base));
  await sendMessage(db, y.admin, { clientMessageId: randomUUID(), body: "y".repeat(500) }, new Date(base + 2_000));
  await sendMessage(db, x.operator, { clientMessageId: randomUUID(), body: "x2" }, new Date(base + 4_000));
  await openConversation(db, z.admin, new Date(base + 1_000));
  const scope = { actorId: platformId, sessionId: platformSessionId };
  const ids = new Set([x.organizationId, y.organizationId, z.organizationId]);
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await listPlatformConversations(db, scope, { limit: 2, cursor });
    for (const item of page.conversations) if (ids.has(item.organizationId)) seen.push(item.organizationId);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(seen.slice(-3)).toHaveLength(3);
  const all = (await listPlatformConversations(db, scope, { limit: 100 })).conversations;
  const mine = all.filter((item) => ids.has(item.organizationId));
  expect(mine.map((item) => item.organizationId)).toEqual([x.organizationId, y.organizationId, z.organizationId]);
  expect(new Set(seen).size).toBe(3);
  expect(mine[0].lastMessage).toMatchObject({ preview: "x2", senderRole: "SUPERADMIN_AUTERVA", truncated: false });
  expect(mine[1].lastMessage?.truncated).toBe(true);
  expect(mine[1].lastMessage?.preview).toHaveLength(160);
  expect(mine[2].lastMessage).toBeNull();
  expect(mine[0]).toMatchObject({ organizationName: "Firma list-x", archived: false });
  // HTTP: superadmin ok, admin and anonymous refused.
  const ok = await platformList(http("GET", "/api/platform/chat/conversations?limit=100", platformHost, platformCookie));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toBe("no-store");
  expect((await platformList(http("GET", "/api/platform/chat/conversations", platformHost, x.cookie))).status).toBe(403);
  expect((await platformList(http("GET", "/api/platform/chat/conversations", platformHost, ""))).status).toBe(403);
  expect((await platformList(http("GET", "/api/platform/chat/conversations", x.host, platformCookie))).status).toBe(404);
  expect((await platformList(http("GET", "/api/platform/chat/conversations?cursor=zzz", platformHost, platformCookie))).status).toBe(400);
  await archiveCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId: y.organizationId,
    expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() });
  const after = (await listPlatformConversations(db, scope, { limit: 100 })).conversations.find((item) => item.organizationId === y.organizationId);
  expect(after).toMatchObject({ archived: true });
  expect(after?.lastMessage?.preview).toHaveLength(160);
});

test("sequence trigger: parallel inserts without seq never share a number and mix cleanly with service sends", async () => {
  const company = await makeCompany("trigger");
  const { conversationId } = await openConversation(db, company.admin);
  const insertRaw = (body: string) => db.chatMessage.create({ data: { organizationId: company.organizationId,
    conversationId, senderId: company.adminId, clientMessageId: randomUUID(), body }, select: { seq: true } });
  const raw = await Promise.all(Array.from({ length: 12 }, (_, i) => insertRaw(`bez seq ${i}`)));
  expect(raw.map((row) => row.seq).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  const base = nextBase();
  const [viaService, viaRaw] = await Promise.all([
    sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: "usługa" }, new Date(base)),
    insertRaw("surowy"),
  ]);
  const rows = await db.chatMessage.findMany({ where: { conversationId }, select: { seq: true } });
  expect(rows.map((row) => row.seq).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  expect(viaService.message.id).toBeTruthy();
  expect(viaRaw.seq).toBeGreaterThan(12);
  expect((await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })).lastSeq).toBe(14);
});

test("open on an archived company: existing conversation is returned, a new one is refused, admin is refused", async () => {
  const [withChat, without] = [await makeCompany("arch-open-a"), await makeCompany("arch-open-b")];
  const { conversationId } = await openConversation(db, withChat.admin);
  for (const company of [withChat, without]) {
    await archiveCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId: company.organizationId,
      expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() });
  }
  const existing = await platformConversationPost(http("POST", `/api/platform/companies/${withChat.organizationId}/chat/conversation`,
    platformHost, platformCookie), orgParams(withChat.organizationId));
  expect([existing.status, await existing.json()]).toEqual([200, { conversationId, created: false }]);
  const refused = await platformConversationPost(http("POST", `/api/platform/companies/${without.organizationId}/chat/conversation`,
    platformHost, platformCookie), orgParams(without.organizationId));
  expect([refused.status, (await refused.json() as { code: string }).code]).toEqual([409, "CHAT_ORGANIZATION_ARCHIVED"]);
  expect(await db.conversation.count({ where: { organizationId: without.organizationId } })).toBe(0);
  expect(await codeOf(openConversation(db, withChat.admin))).toBe("CHAT_FORBIDDEN");
  expect((await adminConversationPost(http("POST", "/api/admin/chat/conversation", withChat.host, withChat.cookie))).status).toBe(403);
});

test("a send refused by the traffic limit leaves no new conversation behind", async () => {
  const company = await makeCompany("limit-rollback");
  const base = nextBase();
  const filler = await makeCompany("limit-filler");
  // Fill the operator's burst window against another company, then try the first-ever send to this one.
  for (let i = 0; i < 10; i += 1) {
    await sendMessage(db, filler.operator, { clientMessageId: randomUUID(), body: `f${i}` }, new Date(base + i));
  }
  const refused = await sendMessage(db, company.operator, { clientMessageId: randomUUID(), body: "pierwsza" }, new Date(base + 10)).catch((e) => e);
  expect(refused).toBeInstanceOf(ChatError);
  expect(refused.code).toBe("RATE_LIMITED");
  expect(await db.conversation.count({ where: { organizationId: company.organizationId } })).toBe(0);
});
