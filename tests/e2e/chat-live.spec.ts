import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { FIXTURE } from "../../scripts/fixture-ids";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #426: the chat over a real WebSocket in a real browser. The trusted ingress forwards /ws and /ws/platform to the
// realtime process; this spec runs that process on E2E_WS_PORT, where nothing listens during the other specs.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("czat na żywo przez ingress: licznik skrzynki, wiadomości, pisanie, odczyt i wznowienie po przerwie procesu WS", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const wsPort = Number(process.env.E2E_WS_PORT);
  const port = new URL(baseURL).port;
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const org = randomUUID();
  const adminId = randomUUID();
  const name = `Na żywo ${tag}`;
  const adminHost = `chat-live-${tag}.example.test`;
  const platformHost = `chat-live-platform-${tag}.example.test`;
  const adminOrigin = `http://${adminHost}:${port}`;
  const platformOrigin = `http://${platformHost}:${port}`;
  const startRealtime = () => startRealtimeServer({ db, databaseUrl: process.env.DATABASE_URL ?? "",
    authority: createRealtimeAuthority(db, createAuth(db)),
    config: { host: "127.0.0.1", port: wsPort, allowedHosts: new Set([`127.0.0.1:${wsPort}`]) } });
  let realtime: Awaited<ReturnType<typeof startRealtime>> | null = null;
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  const cookie = (value: string, url: string) => ({ name: "better-auth.session_token", value: value.slice(value.indexOf("=") + 1), url });
  const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await db.organization.create({ data: { id: org, slug: `chat-live-${tag}`, name, firstAdminRegisteredAt: new Date() } });
    await db.user.create({ data: { id: adminId, name: `Admin ${tag}`, email: `chat-live-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: org, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" },
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
    ] });
    await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
    await resetPlatformApiBudget(db, FIXTURE.users[2]);
    sessions.push(await verifiedFixtureSession(db, adminId), await verifiedFixtureSession(db, FIXTURE.users[2]));
    await page.context().addCookies([cookie(sessions[0].cookie, adminOrigin)]);
    await operatorContext.addCookies([cookie(sessions[1].cookie, platformOrigin)]);
    realtime = await startRealtime();

    const opened: string[] = [];
    const watch = (target: Page) => target.on("websocket", (socket) => { opened.push(socket.url()); });
    const operator = await operatorContext.newPage();
    watch(page);
    watch(operator);
    const online = (target: Page) => expect(target.getByRole("status").filter({ hasText: "Online" })).toBeVisible({ timeout: 30_000 });
    const reconnecting = (target: Page) => expect(target.getByText(/łączymy ponownie/)).toBeVisible({ timeout: 30_000 });
    const composer = (target: Page) => target.getByRole("textbox", { name: /Napisz wiadomość/ });
    const send = async (target: Page, text: string) => {
      await composer(target).fill(text);
      await target.getByRole("button", { name: "Wyślij" }).click();
    };

    // Company admin: the live channel is up on the host and port of the page.
    await page.goto(`${adminOrigin}/admin/czat/`);
    await online(page);
    expect(opened).toContainEqual(expect.stringMatching(new RegExp(`^ws://${adminHost}:${port}/ws\\?organizationId=${org}`)));

    // Superadmin inbox (/ws/platform): the counter of the company moves without a reload.
    await operator.goto(`${platformOrigin}/wiadomosci/`);
    await send(page, "Pierwsza wiadomość firmy");
    const row = operator.getByRole("button", { name: new RegExp(name) });
    await expect(row).toContainText("Nowe: 1", { timeout: 30_000 });
    await expect(row).toContainText("Pierwsza wiadomość firmy");
    expect(opened).toContainEqual(`ws://${platformHost}:${port}/ws/platform`);

    // Superadmin opens the conversation (/ws in the context of the company): the read status returns to the admin live.
    await row.click();
    await online(operator);
    await expect(operator.locator("article", { hasText: "Pierwsza wiadomość firmy" })).toBeVisible();
    await expect(page.locator("article", { hasText: "Pierwsza wiadomość firmy" }).getByText("Przeczytano")).toBeVisible({ timeout: 30_000 });

    // Typing and messages, both directions, no reload.
    await composer(page).pressSequentially("piszę", { delay: 60 });
    await expect(operator.getByText(/pisze…/)).toBeVisible({ timeout: 15_000 });
    await composer(page).fill("");
    await composer(operator).pressSequentially("odpowiadam", { delay: 60 });
    await expect(page.getByText(/pisze…/)).toBeVisible({ timeout: 15_000 });
    await send(operator, "Odpowiedź platformy");
    await expect(page.locator("article", { hasText: "Odpowiedź platformy" })).toBeVisible({ timeout: 15_000 });
    await expect(operator.locator("article", { hasText: "Odpowiedź platformy" }).getByText("Przeczytano")).toBeVisible({ timeout: 30_000 });

    // The realtime process goes away: both sides say so, sending still works over HTTP and nothing is lost.
    await realtime.close();
    realtime = null;
    await reconnecting(page);
    await reconnecting(operator);
    await send(page, "Wysłane w czasie przerwy");
    await expect(page.locator("article", { hasText: "Wysłane w czasie przerwy" }).getByText("Wysłano")).toBeVisible();
    await expect(operator.locator("article", { hasText: "Wysłane w czasie przerwy" })).toHaveCount(0);

    // It returns: both sides resume from their cursor and the missed message arrives without a reload.
    realtime = await startRealtime();
    await online(page);
    await online(operator);
    await expect(operator.locator("article", { hasText: "Wysłane w czasie przerwy" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("article", { hasText: "Wysłane w czasie przerwy" }).getByText("Przeczytano")).toBeVisible({ timeout: 30_000 });
    expect(await db.chatMessage.count({ where: { organizationId: org } })).toBe(3);
    expect(await db.job.count({ where: { organizationId: org } })).toBe(0);
  } finally {
    await operatorContext.close();
    await realtime?.close().catch(() => undefined);
    for (const session of sessions) await session.dispose();
    await db.conversationReadCursor.deleteMany({ where: { organizationId: org } });
    await db.chatMessage.deleteMany({ where: { organizationId: org } });
    await db.conversation.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: adminId } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [adminHost, platformHost] } } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
