import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  headers: vi.fn(),
  resolveRequestArea: vi.fn(),
  requireRequestContext: vi.fn(),
  requireAuthorizedActor: vi.fn(),
  findOrganization: vi.fn(),
  getSession: vi.fn(),
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
vi.mock("@/modules/auth/authorization", () => ({
  requireAuthorizedActor: dependencies.requireAuthorizedActor,
}));

import AdminPage from "../../src/app/admin/page";
import HomePage from "../../src/app/page";

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
});
