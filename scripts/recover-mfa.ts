import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import type { PrismaClient } from "../src/generated/prisma/client";
import { withMfaFactorLock } from "../src/modules/auth/mfa-factor-lock";

export type OperatorRecovery = {
  targetEmail: string;
  operatorId: string;
  verifiedChannel: string;
  evidenceReference: string;
  identityConfirmed: boolean;
};

export async function recoverMfaByOperator(db: PrismaClient, input: OperatorRecovery): Promise<{ userId: string; revokedSessions: number }> {
  const email = input.targetEmail.trim().toLowerCase();
  const operatorId = input.operatorId.trim();
  const channel = input.verifiedChannel.trim();
  const reference = input.evidenceReference.trim();
  if (!input.identityConfirmed || !z.email().safeParse(email).success
    || !/^[a-zA-Z0-9._-]{3,80}$/.test(operatorId)
    || channel.length < 3 || channel.length > 80
    || !/^[a-zA-Z0-9._:/-]{3,128}$/.test(reference)) {
    throw new Error("Recovery requires confirmed identity, operator and evidence reference");
  }
  const user = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (!user) throw new Error("Recovery target not found");
  return withMfaFactorLock(db, user.id, async (tx) => {
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { role: true, organizationId: true } });
    if (!current || (current.role !== "SUPERADMIN_AUTERVA" && current.role !== "ADMIN_FIRMY")) throw new Error("Recovery target is not an administrator");
    const revoked = await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    await tx.verification.deleteMany({ where: { identifier: { startsWith: "auterva:mfa:" }, value: { contains: `"userId":"${user.id}"` } } });
    await tx.auditLog.create({ data: {
      actorId: `operator:${operatorId}`, actorRole: "OPERATOR", organizationId: current.organizationId,
      action: "MFA_OPERATOR_RECOVERY", entityType: "User", entityId: user.id, requestId: randomUUID(),
      safeChanges: { channel, evidenceReference: reference, identityConfirmed: true, revokedSessions: revoked.count, next: "totp-enrollment" },
    } });
    return { userId: user.id, revokedSessions: revoked.count };
  });
}

async function runInteractiveRecovery() {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive TTY without arguments is required");
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let operatorId: string;
  let targetEmail: string;
  let verifiedChannel: string;
  let evidenceReference: string;
  let confirmation: string;
  try {
    operatorId = await prompt.question("Operator identifier: ");
    targetEmail = await prompt.question("Account email: ");
    verifiedChannel = await prompt.question("Previously agreed out-of-band verification channel: ");
    evidenceReference = await prompt.question("Evidence reference (no secrets or personal document data): ");
    confirmation = await prompt.question("Type POTWIERDZAM only after identity verification: ");
  } finally {
    prompt.close();
  }
  const { prisma } = await import("../src/lib/prisma");
  try {
    await recoverMfaByOperator(prisma, { operatorId, targetEmail, verifiedChannel, evidenceReference, identityConfirmed: confirmation === "POTWIERDZAM" });
    process.stdout.write("Old MFA and sessions revoked. The existing account must sign in and enroll a new TOTP factor.\n");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInteractiveRecovery().catch(() => { process.stderr.write("MFA recovery refused or failed\n"); process.exitCode = 1; });
}
