import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  host: vi.fn(),
  authorized: vi.fn(),
  scoped: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  company: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "company.test" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    mocks.notFound();
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new Error("REDIRECT");
  },
}));
vi.mock("../../src/lib/auth", () => ({ auth: {} }));
vi.mock("../../src/lib/prisma", () => ({
  prisma: { organization: { findUnique: mocks.company } },
}));
vi.mock("../../src/modules/auth/authorization", () => ({
  resolveAuthHost: mocks.host,
  requireAuthorizedActor: mocks.authorized,
  requireScopedActor: mocks.scoped,
}));

import { AuthPage } from "../../src/components/auth/auth-page";
import { LoginForm, MfaFlow } from "../../src/components/auth/auth-flow";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.host.mockResolvedValue({
    area: "COMPANY_ADMIN",
    organizationId: "company-a",
  });
  mocks.authorized.mockResolvedValue(null);
  mocks.scoped.mockResolvedValue(null);
  mocks.company.mockResolvedValue({ name: "Firma A" });
});

describe("serwerowe wejście auth", () => {
  it("odrzuca host innej roli, zanim pokaże formularz", async () => {
    mocks.host.mockResolvedValue({ area: "PLATFORM", organizationId: null });
    await expect(
      AuthPage({
        area: "company",
        stage: "login",
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.authorized).not.toHaveBeenCalled();
  });

  it("pełną sesję kieruje na bezpieczną trasę, nigdy na obcy host", async () => {
    mocks.authorized.mockResolvedValue({ userId: "admin-a" });
    await expect(
      AuthPage({
        area: "company",
        stage: "login",
        searchParams: Promise.resolve({ returnTo: "//evil.test/" }),
      }),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin");
  });

  it("ograniczoną sesję kieruje do MFA, a nie do panelu", async () => {
    mocks.scoped.mockResolvedValue({
      userId: "admin-a",
      twoFactorEnabled: false,
    });
    await expect(
      AuthPage({
        area: "company",
        stage: "login",
        searchParams: Promise.resolve({ returnTo: "/admin/pojazdy" }),
      }),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/admin/mfa?returnTo=%2Fadmin%2Fpojazdy",
    );
    const element = await AuthPage({
      area: "company",
      stage: "mfa",
      searchParams: Promise.resolve({}),
    });
    expect(element.type).toBe(MfaFlow);
    expect(element.props).toMatchObject({
      initialMode: "enroll",
      companyName: "Firma A",
    });
  });

  it("sesja bez dowodu MFA nie wpada w pętlę przekierowań", async () => {
    mocks.scoped.mockResolvedValue({ userId: "admin-a", twoFactorEnabled: true });
    const login = await AuthPage({
      area: "company",
      stage: "login",
      searchParams: Promise.resolve({}),
    });
    expect(login.type).toBe(LoginForm);
    await expect(
      AuthPage({ area: "company", stage: "mfa", searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/login?returnTo=%2Fadmin");
  });

  it("formularz logowania pokazuje tylko dla prawidłowego hosta bez sesji", async () => {
    const element = await AuthPage({
      area: "company",
      stage: "login",
      searchParams: Promise.resolve({}),
    });
    expect(element.type).toBe(LoginForm);
    expect(element.props).toMatchObject({
      area: "company",
      companyName: "Firma A",
      returnTo: "/admin",
    });
  });
});
