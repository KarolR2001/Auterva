import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  host: vi.fn(),
  authorized: vi.fn(),
  scoped: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  company: vi.fn(),
  cookie: { value: "" },
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      host: "company.test",
      ...(mocks.cookie.value ? { cookie: mocks.cookie.value } : {}),
    }),
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
  // A pending MFA challenge cookie issued by sign-in (value is opaque to the page).
  mocks.cookie.value = "theme=x; better-auth.two_factor=pending-challenge";
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

  it("odtwarza ekran wydania nowych kodów tylko przy pełnej sesji", async () => {
    mocks.authorized.mockResolvedValue({ userId: "admin-a" });
    const element = await AuthPage({
      area: "company",
      stage: "mfa",
      searchParams: Promise.resolve({
        returnTo: "/admin/pojazdy",
        recoverCodes: "1",
      }),
    });
    expect(element.type).toBe(MfaFlow);
    expect(element.props).toMatchObject({
      initialMode: "restore",
      returnTo: "/admin/pojazdy",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();

    await expect(
      AuthPage({
        area: "company",
        stage: "login",
        searchParams: Promise.resolve({ recoverCodes: "1" }),
      }),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/admin/mfa?returnTo=%2Fadmin&recoverCodes=1",
    );

    mocks.authorized.mockResolvedValue(null);
    const limited = await AuthPage({
      area: "company",
      stage: "mfa",
      searchParams: Promise.resolve({ recoverCodes: "1" }),
    });
    expect(limited.type).toBe(MfaFlow);
    expect(limited.props.initialMode).toBe("challenge");
  });

  it("zachowuje zamiar odzyskania kodów przez ponowne logowanie i challenge", async () => {
    mocks.scoped.mockResolvedValue({
      userId: "admin-a",
      twoFactorEnabled: true,
    });
    await expect(
      AuthPage({
        area: "company",
        stage: "mfa",
        searchParams: Promise.resolve({ recoverCodes: "1" }),
      }),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/admin/login?returnTo=%2Fadmin&recoverCodes=1",
    );
    mocks.scoped.mockResolvedValue(null);
    const login = await AuthPage({
      area: "company",
      stage: "login",
      searchParams: Promise.resolve({ recoverCodes: "1" }),
    });
    expect(login.type).toBe(LoginForm);
    expect(login.props.recoverCodes).toBe(true);
    const challenge = await AuthPage({
      area: "company",
      stage: "mfa",
      searchParams: Promise.resolve({ recoverCodes: "1" }),
    });
    expect(challenge.props).toMatchObject({
      initialMode: "challenge",
      recoverCodes: true,
    });
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
    mocks.scoped.mockResolvedValue({
      userId: "admin-a",
      twoFactorEnabled: true,
    });
    const login = await AuthPage({
      area: "company",
      stage: "login",
      searchParams: Promise.resolve({}),
    });
    expect(login.type).toBe(LoginForm);
    await expect(
      AuthPage({
        area: "company",
        stage: "mfa",
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/admin/login?returnTo=%2Fadmin",
    );
  });

  it("bez sesji i oczekującego challenge kieruje z MFA do logowania z informacją o wygaśnięciu", async () => {
    mocks.cookie.value = "theme=x; better-auth.two_factor=";
    await expect(
      AuthPage({
        area: "company",
        stage: "mfa",
        searchParams: Promise.resolve({ returnTo: "/admin/pojazdy", recoverCodes: "1" }),
      }),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/admin/login?returnTo=%2Fadmin%2Fpojazdy&session=expired&recoverCodes=1",
    );
    mocks.host.mockResolvedValue({ area: "PLATFORM", organizationId: null });
    mocks.cookie.value = "";
    await expect(
      AuthPage({ area: "platform", stage: "mfa", searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith("/login?returnTo=%2F&session=expired");
    const login = await AuthPage({
      area: "platform",
      stage: "login",
      searchParams: Promise.resolve({ session: "expired" }),
    });
    expect(login.type).toBe(LoginForm);
    expect(login.props.sessionExpired).toBe(true);
  });

  it("ograniczona sesja enrolmentu nie wymaga cookie challenge", async () => {
    mocks.cookie.value = "";
    mocks.scoped.mockResolvedValue({ userId: "admin-a", twoFactorEnabled: false });
    const element = await AuthPage({
      area: "company",
      stage: "mfa",
      searchParams: Promise.resolve({}),
    });
    expect(element.props.initialMode).toBe("enroll");
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
