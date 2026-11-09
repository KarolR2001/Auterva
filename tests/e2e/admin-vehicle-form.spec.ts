import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday } from "../../src/modules/availability/dates";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #35: vehicle form and publication cycle of the company admin against the real API of the built ingress.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("vehicle form: draft without data, publication gaps, publish, slug change, conflict, lost response, hide", async ({ baseURL, browser }) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [org, user, cat] = Array.from({ length: 3 }, () => randomUUID());
  const host = `admin-form-${org}.example.test`;
  const today = availabilityToday();
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await db.organization.create({ data: { id: org, slug: `admin-form-${org}`, name: "Firma Formularza E2E", firstAdminRegisteredAt: new Date() } });
    await db.user.create({ data: { id: user, name: "Form admin", role: "ADMIN_FIRMY", organizationId: org,
      email: `admin-form-${user}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: org, paidThrough: new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000) } });
    await db.vehicleCategory.create({ data: { id: cat, code: `af-${cat.slice(0, 8)}`, name: "Bus testowy", requiresSeats: true } });
    session = await verifiedFixtureSession(db, user);
    const [name, value] = session.cookie.split(/=(.*)/s);
    await context.addCookies([{ name, value, domain: host, path: "/" }]);
    const page = await context.newPage();
    const base = `http://${host}:${port}`;
    // Mobile accordions: open a section by its heading button unless it is already open.
    const openSection = async (title: string) => {
      const toggle = page.locator("h3 button[aria-expanded]").filter({ hasText: title });
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    };

    // A draft needs no complete data: a name alone saves and leads to the edit view.
    await page.goto(`${base}/admin/pojazdy/nowy/`);
    await page.getByLabel("Nazwa pojazdu").fill("Bus E2E");
    await page.getByRole("button", { name: "Zapisz szkic" }).click();
    await expect(page).toHaveURL(/\/admin\/pojazdy\/[0-9a-f-]{36}\/\?saved=1/);
    await expect(page.getByText("Szkic został zapisany.")).toBeVisible();
    const id = page.url().match(/pojazdy\/([0-9a-f-]{36})\//)![1]!;
    const draft = await db.vehicle.findUniqueOrThrow({ where: { id } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.name).toBe("Bus E2E");
    expect(draft.slug).toBe("bus-e2e");

    // Publishing with gaps shows concrete gaps, opens the section with the field and sends no publish request.
    let publishRequests = 0;
    page.on("request", (request) => { if (request.url().includes("/publish/")) publishRequests += 1; });
    await page.getByRole("button", { name: "Opublikuj", exact: true }).click();
    await expect(page.getByText("Do poprawy:", { exact: false })).toBeVisible();
    await expect(page.getByText("Wybierz kategorię pojazdu.").first()).toBeVisible();
    await expect(page.getByLabel("Krótki opis")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(publishRequests).toBe(0);

    // Fill the rest, keep the draft saved; the cover image is still missing, so publication stays refused by the checklist.
    await page.getByLabel("Kategoria").selectOption({ label: "Bus testowy" });
    await openSection("Parametry techniczne");
    await page.getByLabel("Liczba miejsc").fill("9");
    await page.getByLabel("Krótki opis").fill("Bus na wyjazdy");
    await page.getByLabel("Pełny opis").fill("Dziewięciomiejscowy bus z klimatyzacją.");
    await openSection("Dostępność bazowa");
    await page.getByLabel("Aktywny od").fill(today);
    await openSection("Cena");
    await page.getByLabel("Cena (opcjonalnie)", { exact: true }).fill("350,50");
    await page.getByRole("button", { name: "Zapisz szkic" }).click();
    await expect(page.getByText("Zapisano zmiany.")).toBeVisible();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id } })).price?.toString()).toBe("350.5");
    await page.getByRole("button", { name: "Opublikuj", exact: true }).click();
    await expect(page.getByText("Dodaj co najmniej jedno gotowe zdjęcie", { exact: false }).first()).toBeVisible();
    expect(publishRequests).toBe(0);

    // With a ready cover the publish dialog confirms and the result comes from the server.
    await db.vehicleImage.create({ data: { organizationId: org, vehicleId: id, status: "READY", isCover: true,
      storageKey: `fleet/e2e/${id}/cover.webp`, mime: "image/webp", width: 600, height: 400, bytes: 1000 } });
    await page.reload();
    await page.getByRole("button", { name: "Opublikuj", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Opublikuj" }).click();
    await expect(page.getByText("Pojazd został opublikowany.")).toBeVisible();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id } })).status).toBe("PUBLISHED");

    // Changing the slug of a published vehicle asks for confirmation and records the redirect.
    await openSection("Dane podstawowe");
    await page.getByLabel("Adres w witrynie (slug)").fill("bus-e2e-nowy");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Zmień adres i zapisz" }).click();
    await expect(page.getByText("Zapisano zmiany.")).toBeVisible();
    expect(await db.slugRedirect.count({ where: { organizationId: org, oldSlug: "bus-e2e" } })).toBe(1);

    // Version conflict: entries survive, the merge keeps them and takes the other editor's fields.
    await db.vehicle.update({ where: { id }, data: { brand: "Ford", version: { increment: 1 } } });
    await openSection("Parametry techniczne");
    await page.getByLabel("Kolor").fill("czarny");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Pojazd został zmieniony przez kogoś innego.")).toBeVisible();
    await expect(page.getByLabel("Kolor")).toHaveValue("czarny");
    await page.getByRole("button", { name: "Wczytaj aktualną wersję" }).click();
    await expect(page.getByLabel("Marka")).toHaveValue("Ford");
    await expect(page.getByLabel("Kolor")).toHaveValue("czarny");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Zapisano zmiany.")).toBeVisible();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id } })).color).toBe("czarny");

    // Lost response after a successful write: the retry reads the server and does not write twice.
    let dropped = false;
    await page.route("**/api/admin/vehicles/*/", async (route) => {
      if (route.request().method() !== "PATCH" || dropped) return route.continue();
      dropped = true;
      const target = new URL(route.request().url());
      target.hostname = "127.0.0.1";
      await route.fetch({ url: target.toString(), headers: { ...route.request().headers(), host: `${host}:${target.port}` } });
      await route.abort("failed");
    });
    await page.getByLabel("Paliwo").fill("diesel");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Nie wiemy, czy zmiana została zapisana.")).toBeVisible();
    const versionAfterLoss = (await db.vehicle.findUniqueOrThrow({ where: { id } })).version;
    await page.getByRole("button", { name: "Sprawdź i zapisz ponownie" }).click();
    await expect(page.getByText("Zmiany były już zapisane.")).toBeVisible();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id } })).version).toBe(versionAfterLoss);

    // Leaving with unsaved edits is guarded by the shell.
    await page.getByLabel("Kolor").fill("niebieski");
    await page.getByRole("link", { name: "Wróć do listy pojazdów" }).click();
    // The shell asks before leaving (its dialog is an alertdialog); Escape stays on the form with the entry kept.
    await expect(page.getByRole("alertdialog", { name: "Niezapisane zmiany" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByLabel("Kolor")).toHaveValue("niebieski");
    await page.getByLabel("Kolor").fill("czarny");

    // Hide: confirmed in a dialog, the result is the server answer, data stays.
    await page.getByRole("button", { name: "Ukryj" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ukryj" }).click();
    await expect(page.getByText("Pojazd został ukryty.")).toBeVisible();
    const hidden = await db.vehicle.findUniqueOrThrow({ where: { id } });
    expect(hidden.status).toBe("UNPUBLISHED");
    expect(hidden.name).toBe("Bus E2E");
    // Since #39 the form of a saved vehicle links to its calendar.
    await expect(page.getByRole("link", { name: "Kalendarz pojazdu" })).toHaveAttribute("href", `/admin/pojazdy/${id}/kalendarz/`);

    // Lost answer to a publication that WAS stored: the button reads the vehicle and reports the real status.
    let publishDropped = false;
    await page.route("**/api/admin/vehicles/*/publish/", async (route) => {
      if (publishDropped) return route.continue();
      publishDropped = true;
      const target = new URL(route.request().url());
      target.hostname = "127.0.0.1";
      await route.fetch({ url: target.toString(), headers: { ...route.request().headers(), host: `${host}:${target.port}` } });
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Opublikuj ponownie" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Opublikuj" }).click();
    await expect(page.getByText("Nie wiemy, czy zmiana została zapisana.")).toBeVisible();
    await page.getByRole("button", { name: "Sprawdź stan pojazdu" }).click();
    await expect(page.getByText("Zmiana była już zapisana.")).toBeVisible();
    await expect(page.getByText("Status pojazdu na serwerze: Opublikowany.")).toBeVisible();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id } })).status).toBe("PUBLISHED");
  } finally {
    await context.close();
    await session?.dispose();
    await db.vehicleImage.deleteMany({ where: { organizationId: org } });
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.slugRedirect.deleteMany({ where: { organizationId: org } });
    await db.vehicleFeature.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: user } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.vehicleCategory.deleteMany({ where: { id: cat } });
    await db.$disconnect();
  }
});
