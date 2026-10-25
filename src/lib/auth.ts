import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { getServerEnv } from "./env";

export function createAuth(client: PrismaClient | Prisma.TransactionClient, allowFixtureSignup = false, baseURL?: string) {
  const env = getServerEnv();
  return betterAuth({
    appName: "Auterva",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: baseURL ?? env.BETTER_AUTH_URL,
    database: prismaAdapter(client, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowFixtureSignup,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      revokeSessionsOnPasswordReset: true,
    },
    plugins: [twoFactor()],
  });
}

export const auth = createAuth(prisma);
