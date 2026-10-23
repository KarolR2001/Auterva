import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import * as OTPAuth from "otpauth";
import { hashPassword } from "better-auth/crypto";
import { FIXTURE } from "./fixture-ids";
import { assertLocalFixtureTarget } from "./fixture-safety";

type Access = Record<string, { email: string; password: string; totpURI?: string }>;
const path = resolve(".local/fixture-9/access.json");
const identities = [
  [FIXTURE.users[0], "admin-a@example.test", "fixture-account-a"],
  [FIXTURE.users[1], "admin-b@example.test", "fixture-account-b"],
  [FIXTURE.users[2], "superadmin@example.test", "fixture-account-superadmin"],
] as const;

function save(access: Access) {
  mkdirSync(resolve(".local/fixture-9"), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(access, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export async function seedLocalAccess(db: Client, env: Record<string, string | undefined>) {
  assertLocalFixtureTarget(env);
  const access = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Access : {};
  const { createPrismaClient } = await import("../src/lib/prisma");
  const { createAuth } = await import("../src/lib/auth");
  const prisma = createPrismaClient(env.DATABASE_URL ?? "");
  const auth = createAuth(prisma, true);
  try {
    for (const [userId, email, accountId] of identities) {
      const prior = access[userId];
      const entry = prior ?? { email, password: randomBytes(24).toString("base64url") };
      if (entry.email !== email || !entry.password) throw new Error("Invalid local access file; refusing credential rotation");
      const existingAccount = await db.query('SELECT id FROM "account" WHERE "userId" = $1 AND "providerId" = $2', [userId, "credential"]);
      if (existingAccount.rowCount && !prior) throw new Error("Existing credential has no local access file; use explicit --reset on this fixture database");
      access[userId] = entry;
      save(access);
      if (existingAccount.rowCount === 0) {
        await db.query('INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [accountId, userId, "credential", userId, await hashPassword(entry.password)]);
      }
      const factor = await db.query('SELECT id FROM "twoFactor" WHERE "userId" = $1', [userId]);
      if (factor.rowCount && !entry.totpURI) throw new Error("Existing MFA has no local secret; use explicit --reset on this fixture database");
      if (!factor.rowCount) {
        const signedIn = await auth.api.signInEmail({ body: { email, password: entry.password }, returnHeaders: true });
        const cookie = signedIn.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
        const enabled = await auth.api.enableTwoFactor({ body: { password: entry.password, method: "totp" }, headers: new Headers({ cookie }) });
        if (enabled.method !== "totp") throw new Error("TOTP enrollment failed");
        const totp = OTPAuth.URI.parse(enabled.totpURI);
        if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Invalid TOTP URI");
        await auth.api.verifyTOTP({ body: { code: totp.generate(), trustDevice: false }, headers: new Headers({ cookie }) });
        entry.totpURI = enabled.totpURI;
      }
      save(access);
      await db.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
    }
  } finally {
    await prisma.$disconnect();
  }
  return path;
}
