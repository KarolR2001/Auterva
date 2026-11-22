import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { getServerEnv } from "./env";

// D-61 (#414): a panel login lasts 30 days from the last refresh (sliding window). A session is refreshed on use
// at most once per day (`updateAge`), so an active admin stays signed in while an idle one expires after 30 days.
// Sensitive operations keep their own one-time reauth proof; revocation (archive, password change/reset,
// MFA recovery, logout) deletes session rows and is independent of this lifetime.
export const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

export function createAuth(client: PrismaClient | Prisma.TransactionClient, allowFixtureSignup = false, baseURL?: string) {
  const env = getServerEnv();
  return betterAuth({
    appName: "Auterva",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: baseURL ?? env.BETTER_AUTH_URL,
    database: prismaAdapter(client, { provider: "postgresql" }),
    // The gateway applies shared PostgreSQL limits by actor and client address.
    // Better Auth's process-local default (100/min) would preempt the 120/min contract.
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowFixtureSignup,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: SESSION_EXPIRES_IN_SECONDS, updateAge: SESSION_UPDATE_AGE_SECONDS },
    plugins: [twoFactor()],
  });
}

export const auth = createAuth(prisma);
