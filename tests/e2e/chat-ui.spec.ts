import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #52: the company chat page in a real browser. The local ingress carries no WebSocket, so the live channel
// shows its reconnect state while sending, history and the draft work over HTTP and local storage.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("czat firmy: historia, trwałe potwierdzenie wysyłki, szkic po przeładowaniu, izolacja firm, zero zadań poczty", async ({ page, context, browser, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const tag = randomUUID().slice(0, 8);
  const org = { a: randomUUID(), b: randomUUID() };
  const user = { a: randomUUID(), b: randomUUID() };
  const host = { a: `chat-ui-a-${tag}.example.test`, b: `chat-ui-b-${tag}.example.test` };
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  const cookie = (value: string, url: string) => { const [name, ...rest] = value.split("="); return { name, value: rest.join("="), url }; };
  try {
    for (const key of ["a", "b"] as const) {
      // An expired period must not matter: the chat works regardless (C-F125).
      await db.organization.create({ data: { id: org[key], slug: `chat-ui-${key}-${tag}`, name: `Czat ${key} ${tag}`, firstAdminRegisteredAt: new Date() } });
      await db.user.create({ data: { id: user[key], name: `Czat ${key}`, email: `chat-ui-${key}-${tag}@example.test`, role: "ADMIN_FIRMY",
        organizationId: org[key], emailVerified: true, twoFactorEnabled: true } });
      await db.hostMapping.create({ data: { hostname: host[key], area: "COMPANY_ADMIN", organizationId: org[key], status: "ACTIVE" } });
      sessions.push(await verifiedFixtureSession(db, user[key]));
    }
    const originA = `http://${host.a}:${port}`;
    await context.addCookies([cookie(sessions[0].cookie, originA)]);
    await page.goto(`${originA}/admin/czat/`);
    await expect(page.getByText(/Brak wiadomości/)).toBeVisible();
    // The live channel is not reachable here: it says so and does not block sending.
    await expect(page.getByText(/łączymy ponownie|Łączenie/)).toBeVisible();

    await page.getByRole("textbox", { name: /Napisz wiadomość/ }).fill("Dzień dobry, proszę o kontakt.");
    await page.reload();
    // The draft survives a reload and is not sent by itself.
    await expect(page.getByRole("textbox", { name: /Napisz wiadomość/ })).toHaveValue("Dzień dobry, proszę o kontakt.");
    expect(await db.chatMessage.count({ where: { organizationId: org.a } })).toBe(0);

    await page.getByRole("button", { name: "Wyślij" }).click();
    await expect(page.getByText(/Wysłano/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Napisz wiadomość/ })).toHaveValue("");
    expect(await db.chatMessage.count({ where: { organizationId: org.a } })).toBe(1);
    await page.reload();
    await expect(page.getByText("Dzień dobry, proszę o kontakt.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Napisz wiadomość/ })).toHaveValue("");

    // No attachments and no mail job for chat.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    expect(await db.job.count({ where: { organizationId: org.a } })).toBe(0);

    // Company B sees nothing of A (own host, own session).
    const other = await browser.newContext();
    try {
      const originB = `http://${host.b}:${port}`;
      await other.addCookies([cookie(sessions[1].cookie, originB)]);
      const pageB = await other.newPage();
      await pageB.goto(`${originB}/admin/czat/`);
      await expect(pageB.getByText(/Brak wiadomości/)).toBeVisible();
      await expect(pageB.getByText("Dzień dobry, proszę o kontakt.")).toHaveCount(0);
    } finally { await other.close(); }
  } finally {
    for (const session of sessions) await session.dispose();
    await db.chatMessage.deleteMany({ where: { organizationId: { in: Object.values(org) } } });
    await db.conversation.deleteMany({ where: { organizationId: { in: Object.values(org) } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(user) } } });
    await db.hostMapping.deleteMany({ where: { organizationId: { in: Object.values(org) } } });
    await db.organization.deleteMany({ where: { id: { in: Object.values(org) } } });
    await db.$disconnect();
  }
});
