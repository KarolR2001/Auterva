import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import type { PrismaClient } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { getServerEnv } from "./env";

export function createAuth(client: PrismaClient, allowFixtureSignup = false) {
  const env = getServerEnv();
  return betterAuth({
    appName: "Auterva",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: prismaAdapter(client, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowFixtureSignup,
      revokeSessionsOnPasswordReset: true,
    },
    plugins: [twoFactor()],
  });
}

export const auth = createAuth(prisma);
