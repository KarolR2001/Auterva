import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  headers: vi.fn(),
  resolveRequestArea: vi.fn(),
  requireRequestContext: vi.fn(),
  requireAuthorizedActor: vi.fn(),
  requireScopedActor: vi.fn(),
  findOrganization: vi.fn(),
  getSession: vi.fn(),
  resolveHostMapping: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: dependencies.headers }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: dependencies.getSession } },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUnique: dependencies.findOrganization } },
}));
vi.mock("@/modules/tenancy/request-context", () => ({
  resolveRequestArea: dependencies.resolveRequestArea,
  requireRequestContext: dependencies.requireRequestContext,
}));
vi.mock("@/modules/public-offer/page-data", () => ({
  requestHost: async () => "panel.example.test",
  loadHome: async () => null,
}));
vi.mock("@/modules/tenancy/host-registry", () => ({
  resolveHostMapping: dependencies.resolveHostMapping,
}));
vi.mock("@/modules/auth/authorization", () => ({
  requireAuthorizedActor: dependencies.requireAuthorizedActor,
  requireScopedActor: dependencies.requireScopedActor,
}));

import AdminPage from "../../src/app/admin/page";
import HomePage from "../../src/app/page";
import NotFound from "../../src/app/not-found";

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.headers.mockResolvedValue(
    new Headers({ host: "panel.example.test" }),
  );
});

describe("serwerowe wejścia paneli", () => {
  it("nie montuje prywatnego panelu firmy bez kontekstu aktora", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "COMPANY_ADMIN",
      organizationId: "firma-alfa",
    });
    dependencies.requireRequestContext.mockResolvedValue(null);
    dependencies.getSession.mockResolvedValue({ user: { id: "obcy" } });

    await expect(AdminPage()).rejects.toThrow("NOT_FOUND");
    expect(dependencies.findOrganization).not.toHaveBeenCalled();
  });

  it("zimny start panelu firmy bez sesji prowadzi do loginu tego hosta bez prywatnej treści", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "COMPANY_ADMIN",
      organizationId: "firma-alfa",
    });
    dependencies.requireRequestContext.mockResolvedValue(null);
    dependencies.getSession.mockResolvedValue(null);

    await expect(AdminPage()).rejects.toThrow(
      "REDIRECT:/admin/login?returnTo=%2Fadmin",
    );
    expect(dependencies.findOrganization).not.toHaveBeenCalled();
  });

  it("obcy host bez dopasowania pozostaje 404, nie loginem", async () => {
    dependencies.resolveRequestArea.mockResolvedValue(null);
    await expect(AdminPage()).rejects.toThrow("NOT_FOUND");
    await expect(HomePage()).rejects.toThrow("NOT_FOUND");
    expect(dependencies.getSession).not.toHaveBeenCalled();
  });

  it("wyświetla shell firmy dopiero po autoryzacji i odczycie tej samej firmy", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "COMPANY_ADMIN",
      organizationId: "firma-alfa",
    });
    dependencies.requireRequestContext.mockResolvedValue({
      actorId: "admin-alfa",
      role: "ADMIN_FIRMY",
      organizationId: "firma-alfa",
      sessionId: "sesja-alfa",
    });
    dependencies.findOrganization.mockResolvedValue({ name: "Firma Alfa" });

    const html = renderToStaticMarkup(await AdminPage());
    expect(html).toContain("Firma Alfa");
    expect(html).toContain('aria-label="Nawigacja panelu"');
    expect(html).toContain("Panel jest w przygotowaniu.");
    expect(dependencies.findOrganization).toHaveBeenCalledWith({
      where: { id: "firma-alfa" },
      select: { name: true },
    });
  });

  it("pokazuje shell platformy tylko pełnej sesji superadmina", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "PLATFORM",
      organizationId: null,
    });
    dependencies.requireAuthorizedActor.mockResolvedValue({
      userId: "superadmin",
      role: "SUPERADMIN_AUTERVA",
      organizationId: null,
      sessionId: "sesja-platformy",
    });

    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('aria-label="Nawigacja panelu"');
    expect(html).toContain("Firmy");
    expect(html).not.toContain("Przykładowa lista firm");
  });

  it("odmawia prywatnej platformy po utracie sesji", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "PLATFORM",
      organizationId: null,
    });
    dependencies.requireAuthorizedActor.mockResolvedValue(null);
    dependencies.getSession.mockResolvedValue({ user: { id: "admin-firmy" } });

    await expect(HomePage()).rejects.toThrow("NOT_FOUND");
  });

  it("zimny start platformy bez sesji prowadzi do /login", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "PLATFORM",
      organizationId: null,
    });
    dependencies.requireAuthorizedActor.mockResolvedValue(null);
    dependencies.getSession.mockResolvedValue(null);

    await expect(HomePage()).rejects.toThrow("REDIRECT:/login");
  });

  it("własna sesja ograniczona (bez TOTP) trafia do MFA, a sesja z TOTP bez dowodu zostaje 404", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "COMPANY_ADMIN",
      organizationId: "firma-alfa",
    });
    dependencies.requireRequestContext.mockResolvedValue(null);
    dependencies.getSession.mockResolvedValue({ user: { id: "admin" } });
    dependencies.requireScopedActor.mockResolvedValue({
      twoFactorEnabled: false,
    });
    await expect(AdminPage()).rejects.toThrow(
      "REDIRECT:/admin/mfa?returnTo=%2Fadmin",
    );
    dependencies.requireScopedActor.mockResolvedValue({
      twoFactorEnabled: true,
    });
    await expect(AdminPage()).rejects.toThrow("NOT_FOUND");
    expect(dependencies.findOrganization).not.toHaveBeenCalled();
  });

  it("nieznany host nie dostaje panelu (strona publiczna PUB-10 z #41)", async () => {
    dependencies.resolveRequestArea.mockResolvedValue(null);
    dependencies.resolveHostMapping.mockResolvedValue(null);
    const html = renderToStaticMarkup(await NotFound());
    expect(html).not.toContain("Nawigacja panelu");
    expect(dependencies.findOrganization).not.toHaveBeenCalled();
  });
});

describe("panelowe 404 (ADM-20)", () => {
  it("autoryzowana sesja firmy widzi shell z komunikatem i powrotem do startu", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "COMPANY_ADMIN",
      organizationId: "firma-alfa",
    });
    dependencies.requireRequestContext.mockResolvedValue({
      actorId: "admin-alfa",
      role: "ADMIN_FIRMY",
      organizationId: "firma-alfa",
      sessionId: "sesja-alfa",
    });
    dependencies.findOrganization.mockResolvedValue({ name: "Firma Alfa" });
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('aria-label="Nawigacja panelu"');
    expect(html).toContain("Nie znaleziono strony");
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Przejdź do panelu");
    expect(html).not.toContain("jest w przygotowaniu");
  });

  it("autoryzowany superadmin widzi shell platformy z powrotem do startu", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "PLATFORM",
      organizationId: null,
    });
    dependencies.requireAuthorizedActor.mockResolvedValue({
      userId: "superadmin",
      role: "SUPERADMIN_AUTERVA",
      organizationId: null,
      sessionId: "sesja-platformy",
    });
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('aria-label="Nawigacja panelu"');
    expect(html).toContain('href="/"');
  });

  it("anonim, obca sesja i nieznany host dostają tylko neutralną stronę", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({
      area: "COMPANY_ADMIN",
      organizationId: "firma-alfa",
    });
    dependencies.requireRequestContext.mockResolvedValue(null);
    for (const area of [
      { area: "COMPANY_ADMIN", organizationId: "firma-alfa" },
      { area: "PLATFORM", organizationId: null },
      { area: "MARKETING", organizationId: null },
    ]) {
      dependencies.resolveRequestArea.mockResolvedValue(area);
      dependencies.resolveHostMapping.mockResolvedValue(area);
      dependencies.requireAuthorizedActor.mockResolvedValue(null);
      const html = renderToStaticMarkup(await NotFound());
      expect(html).toBe("<main><h1>Nie znaleziono strony</h1></main>");
    }
    expect(dependencies.findOrganization).not.toHaveBeenCalled();
  });
});
