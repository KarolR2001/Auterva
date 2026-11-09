import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  headers: vi.fn(),
  resolveRequestArea: vi.fn(),
  requireRequestContext: vi.fn(),
  requireAuthorizedActor: vi.fn(),
  getSession: vi.fn(),
  getCompanySettings: vi.fn(),
  requireScopedActor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: dependencies.headers }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: dependencies.getSession } } }));
vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: vi.fn() } } }));
vi.mock("@/modules/tenancy/request-context", () => ({
  resolveRequestArea: dependencies.resolveRequestArea,
  requireRequestContext: dependencies.requireRequestContext,
}));
vi.mock("@/modules/auth/authorization", () => ({
  requireAuthorizedActor: dependencies.requireAuthorizedActor,
  requireScopedActor: dependencies.requireScopedActor,
}));
vi.mock("@/modules/settings/read", () => ({ getCompanySettings: dependencies.getCompanySettings }));

import AdminSettingsPage from "../../src/app/admin/ustawienia/page";
import CompanySettingsPage from "../../src/app/firmy/[organizationId]/ustawienia/page";

const org = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.headers.mockResolvedValue(new Headers({ host: "panel.example.test" }));
});

describe("trasy ustawień firmy", () => {
  it("panel firmy bez kontekstu aktora nie czyta ustawień", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({ area: "COMPANY_ADMIN", organizationId: org });
    dependencies.requireRequestContext.mockResolvedValue(null);
    dependencies.getSession.mockResolvedValue({ user: { id: "obcy" } });
    await expect(AdminSettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(dependencies.getCompanySettings).not.toHaveBeenCalled();
  });

  it("host platformy bez superadmina nie czyta ustawień firmy", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({ area: "PLATFORM", organizationId: null });
    dependencies.requireAuthorizedActor.mockResolvedValue(null);
    dependencies.getSession.mockResolvedValue(null);
    await expect(CompanySettingsPage({ params: Promise.resolve({ organizationId: org }), searchParams: Promise.resolve({}) }))
      .rejects.toThrow("REDIRECT:/login");
    expect(dependencies.getCompanySettings).not.toHaveBeenCalled();
  });

  it("ustawienia firmy nie otwierają się na hoście firmy ani dla niepoprawnego ID", async () => {
    dependencies.resolveRequestArea.mockResolvedValue({ area: "COMPANY_ADMIN", organizationId: org });
    await expect(CompanySettingsPage({ params: Promise.resolve({ organizationId: org }), searchParams: Promise.resolve({}) }))
      .rejects.toThrow("NOT_FOUND");
    dependencies.resolveRequestArea.mockResolvedValue({ area: "PLATFORM", organizationId: null });
    await expect(CompanySettingsPage({ params: Promise.resolve({ organizationId: "x" }), searchParams: Promise.resolve({}) }))
      .rejects.toThrow("NOT_FOUND");
    expect(dependencies.getCompanySettings).not.toHaveBeenCalled();
  });
});
