import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  headers: vi.fn(),
  resolveRequestArea: vi.fn(),
  requireRequestContext: vi.fn(),
  requireAuthorizedActor: vi.fn(),
  findOrganization: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: dependencies.headers }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
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

    await expect(AdminPage()).rejects.toThrow("NOT_FOUND");
    expect(dependencies.findOrganization).not.toHaveBeenCalled();
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

    await expect(HomePage()).rejects.toThrow("NOT_FOUND");
  });
});
