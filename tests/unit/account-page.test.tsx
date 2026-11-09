import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  host: vi.fn(),
  actor: vi.fn(),
  user: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "h.test" }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new Error("REDIRECT");
  },
}));
vi.mock("../../src/lib/auth", () => ({ auth: {} }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("../../src/modules/auth/authorization", () => ({
  resolveAuthHost: mocks.host,
  requireAuthorizedActor: mocks.actor,
}));

import { AccountPage } from "../../src/components/account/account-page";
import { ResetPage } from "../../src/components/auth/reset-page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.host.mockResolvedValue({ area: "COMPANY_ADMIN", organizationId: "company-a" });
  mocks.actor.mockResolvedValue({ userId: "u1", sessionId: "s1", organizationId: "company-a", role: "ADMIN_FIRMY" });
  mocks.user.mockResolvedValue({ name: "Ola", email: "o@example.test", role: "ADMIN_FIRMY" });
});

describe("konto po stronie serwera", () => {
  it("odrzuca host innej roli, zanim odczyta dane", async () => {
    mocks.host.mockResolvedValue({ area: "PLATFORM", organizationId: null });
    await expect(AccountPage({ area: "company" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("bez pełnej sesji kieruje do logowania właściwego hosta z powrotem do konta", async () => {
    mocks.actor.mockResolvedValue(null);
    await expect(AccountPage({ area: "company" })).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/login?returnTo=%2Fadmin%2Fkonto");
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("platforma wraca do /login i /konto", async () => {
    mocks.host.mockResolvedValue({ area: "PLATFORM", organizationId: null });
    mocks.actor.mockResolvedValue(null);
    await expect(AccountPage({ area: "platform" })).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fkonto");
  });
  it("renderuje konto tylko dla aktora i nie przekazuje obcych pól", async () => {
    const element = await AccountPage({ area: "company" });
    expect(element.props.account).toEqual({ name: "Ola", email: "o@example.test", role: "ADMIN_FIRMY" });
    expect(mocks.user).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
  });
});

describe("reset po stronie serwera", () => {
  it("reset firmy na hoście platformy daje 404", async () => {
    mocks.host.mockResolvedValue({ area: "PLATFORM", organizationId: null });
    await expect(ResetPage({ area: "company" })).rejects.toThrow("NOT_FOUND");
  });
});
