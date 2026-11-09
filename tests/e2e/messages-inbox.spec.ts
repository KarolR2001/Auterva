import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { FIXTURE } from "../../scripts/fixture-ids";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// #53: the superadmin inbox in a real browser. The local ingress carries no WebSocket, so the live channels show their
// reconnect state; the list, history, sending and drafts work over HTTP and local storage.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("skrzynka superadmina: lista, przełączanie rozmów ze szkicami, wysyłka do właściwej firmy, archiwum tylko do odczytu, mobile i wejście z karty", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = new URL(baseURL).port;
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
  const names = { a: `Alfa ${tag}`, b: `Beta ${tag}`, c: `Gamma ${tag}` };
  const admins = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
  const platformHost = `plt53-platform-${tag}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const session = await (async () => {
    await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
    return verifiedFixtureSession(db, FIXTURE.users[2]);
  })();
  const all = Object.values(ids);
  try {
    await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
    let minute = 0;
    for (const key of ["a", "b", "c"] as const) {
      await db.organization.create({ data: { id: ids[key], slug: `plt53-${key}-${tag}`, name: names[key], firstAdminRegisteredAt: new Date(),
        ...(key === "c" ? { archivedAt: new Date() } : {}) } });
      await db.hostMapping.create({ data: { hostname: `plt53-${key}-${tag}.example.test`, area: "COMPANY_ADMIN", organizationId: ids[key], status: "ACTIVE" } });
      await db.user.create({ data: { id: admins[key], name: `Plt53 ${key}`, email: `plt53-${key}-${tag}@example.test`, emailVerified: true,
        twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: ids[key] } });
      const conversation = await db.conversation.create({ data: { organizationId: ids[key], lastSeq: 1, activityAt: new Date(Date.now() - minute * 60_000) } });
      minute += 5;
      await db.chatMessage.create({ data: { organizationId: ids[key], conversationId: conversation.id, senderId: admins[key], seq: 1,
        clientMessageId: randomUUID(), body: `Pytanie od ${names[key]}`, createdAt: new Date(Date.now() - minute * 60_000) } });
    }
    await page.context().addCookies([{ name: "better-auth.session_token", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin }]);
    const composer = (name: string) => page.getByRole("textbox", { name: `Napisz wiadomość do ${name}` });

    // Desktop: list and conversation side by side; the archived company is hidden until the filter is on.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/wiadomosci/`);
    const rowA = page.getByRole("button", { name: new RegExp(names.a) });
    const rowB = page.getByRole("button", { name: new RegExp(names.b) });
    await expect(rowA).toContainText(`Pytanie od ${names.a}`);
    await expect(rowA).toContainText("Nowe: 1");
    await expect(page.getByRole("button", { name: new RegExp(names.c) })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("inbox-1440-list.png") });

    // A -> B -> A: the draft of A returns, B receives exactly its own text and A nothing.
    await rowA.click();
    await composer(names.a).fill("szkic dla Alfy");
    await rowB.click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(composer(names.b)).toHaveValue("");
    await expect(page.getByText(`Odbiorca: ${names.b}`, { exact: true })).toBeVisible();
    await composer(names.b).fill("treść dla Bety");
    await page.getByRole("button", { name: "Wyślij" }).click();
    await expect(page.getByText(/Wysłano/)).toBeVisible();
    expect(await db.chatMessage.findMany({ where: { organizationId: ids.b, body: "treść dla Bety" } })).toHaveLength(1);
    expect(await db.chatMessage.count({ where: { organizationId: ids.a, senderId: FIXTURE.users[2] } })).toBe(0);
    await rowA.click();
    await expect(composer(names.a)).toHaveValue("szkic dla Alfy");
    await page.screenshot({ path: test.info().outputPath("inbox-1440-conversation.png") });
    await page.reload();
    await page.getByRole("button", { name: new RegExp(names.a) }).click();
    await expect(composer(names.a)).toHaveValue("szkic dla Alfy"); // survives a reload, never sent by itself
    expect(await db.chatMessage.count({ where: { organizationId: ids.a, senderId: FIXTURE.users[2] } })).toBe(0);

    // Archive: history is readable, the composer is gone, nothing can be sent (409 on the API as well).
    await page.getByRole("checkbox", { name: "Pokaż zarchiwizowane" }).check();
    await page.getByRole("button", { name: new RegExp(names.c) }).click();
    await expect(page.getByText(`Pytanie od ${names.c}`, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(new RegExp(`Firma ${names.c} jest zarchiwizowana`))).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    const refused = await page.evaluate(async ({ id, key }) => (await fetch(`/api/platform/companies/${id}/chat/messages/`, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientMessageId: key, body: "x" }) })).status, { id: ids.c, key: randomUUID() });
    expect(refused).toBe(409);

    // Entry from the company card opens exactly that company's conversation.
    await page.goto(`${origin}/firmy/${ids.b}/`);
    await page.getByRole("link", { name: "Otwórz wiadomości" }).click();
    await expect(page).toHaveURL(new RegExp(`/wiadomosci/\\?firma=${ids.b}`));
    await expect(page.getByRole("heading", { level: 2, name: names.b, exact: true })).toBeVisible();
    await expect(composer(names.b)).toBeVisible();

    // Mobile: separate list and conversation with Back; keyboard-sized viewport keeps the composer reachable.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/wiadomosci/`);
    await expect(page.getByRole("button", { name: new RegExp(names.a) })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(names.a) }).click();
    await expect(composer(names.a)).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(names.b) })).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("inbox-390-conversation.png") });
    await page.getByRole("button", { name: "Wiadomości", exact: true }).first().click();
    await expect(page.getByRole("button", { name: new RegExp(names.b) })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("inbox-390-list.png") });
    expect(await db.job.count({ where: { organizationId: { in: all } } })).toBe(0); // chat sends no mail

    // Without a session the inbox goes to the platform login, never private HTML.
    await page.context().clearCookies();
    await page.goto(`${origin}/wiadomosci/`);
    await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
  } finally {
    await session.dispose();
    await db.conversationReadCursor.deleteMany({ where: { organizationId: { in: all } } });
    await db.chatMessage.deleteMany({ where: { organizationId: { in: all } } });
    await db.conversation.deleteMany({ where: { organizationId: { in: all } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(admins) } } });
    await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: { in: all } }, { hostname: platformHost }] } });
    await db.organization.deleteMany({ where: { id: { in: all } } });
    await db.$disconnect();
  }
});
