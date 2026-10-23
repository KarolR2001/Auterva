import { afterAll, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

const client = createPrismaClient(process.env.DATABASE_URL ?? "");
const auth = createAuth(client, true);

afterAll(async () => {
  await client.$disconnect();
});

function cookie(headers: Headers) {
  return headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

test("real PostgreSQL credential login requires a verified TOTP before session", async () => {
  const email = `fixture-${crypto.randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  const registration = await auth.api.signUpEmail({
    body: { name: "Fixture", email, password },
    returnHeaders: true,
  });
  const initialCookie = cookie(registration.headers);
  expect(initialCookie).toContain("better-auth.session_token");

  const enabled = await auth.api.enableTwoFactor({
    body: { password, method: "totp" },
    headers: new Headers({ cookie: initialCookie }),
  });
  expect(enabled.method).toBe("totp");
  if (enabled.method !== "totp") throw new Error("Expected TOTP enrollment");
  const totp = OTPAuth.URI.parse(enabled.totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
  const verified = await auth.api.verifyTOTP({
    body: { code: totp.generate(), trustDevice: false },
    headers: new Headers({ cookie: initialCookie }),
  });
  expect(verified).toBeDefined();

  const signIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  expect(signIn.response).toHaveProperty("twoFactorRedirect", true);
  expect(cookie(signIn.headers)).toContain("better-auth.session_token=;");

  const challengeCookie = cookie(signIn.headers);
  expect(await auth.api.getSession({ headers: new Headers({ cookie: challengeCookie }) })).toBeNull();
  const secondFactor = await auth.api.verifyTOTP({
    body: { code: totp.generate(), trustDevice: false },
    headers: new Headers({ cookie: challengeCookie }),
    returnHeaders: true,
  });
  const sessionCookie = cookie(secondFactor.headers);
  expect(sessionCookie).toContain("better-auth.session_token");
  const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) });
  expect(session?.user.email).toBe(email);
});
