import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import type { Readable, Writable } from "node:stream";
import { hashPassword } from "better-auth/crypto";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import type { PrismaClient } from "../src/generated/prisma/client";

export async function bootstrapSuperadmin(db: PrismaClient, input: { name: string; email: string; password: string }): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success || !input.name.trim() || input.password.length < 12 || input.password.length > 256) {
    throw new Error("Invalid bootstrap identity or password policy");
  }
  const password = await hashPassword(input.password);
  const userId = randomUUID();
  await db.$transaction(async (tx) => {
    // Serializes independent operator processes. The schema also has a unique
    // partial index for the single superadmin, independent of this script.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('auterva:superadmin-bootstrap', 0))`;
    const tables = await tx.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename NOT IN ('_prisma_migrations', 'RateLimitEvent')
      ORDER BY tablename
    `;
    for (const { tablename } of tables) {
      const table = `"${tablename.replaceAll('"', '""')}"`;
      await tx.$executeRawUnsafe(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
      const [row] = await tx.$queryRawUnsafe<Array<{ occupied: boolean }>>(`SELECT EXISTS (SELECT 1 FROM ${table}) AS occupied`);
      if (row.occupied) throw new Error("Bootstrap requires an empty database");
    }
    await tx.user.create({ data: {
      id: userId, name: input.name.trim(), email, emailVerified: true,
      role: "SUPERADMIN_AUTERVA", twoFactorEnabled: false,
    } });
    await tx.account.create({ data: {
      id: randomUUID(), accountId: userId, providerId: "credential", userId, password,
    } });
  });
  return userId;
}

export function readHiddenLine(input: Readable & { isTTY?: boolean; setRawMode?: (enabled: boolean) => void }, output: Writable, prompt: string): Promise<string> {
  if (!input.isTTY || !input.setRawMode) throw new Error("Interactive TTY is required");
  output.write(prompt);
  const decoder = new StringDecoder("utf8");
  let value = "";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off("data", onData);
      input.off("error", onError);
      input.setRawMode?.(false);
      output.write("\n");
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onData = (chunk: Buffer) => {
      for (const char of decoder.write(chunk)) {
        if (char === "\r" || char === "\n") { cleanup(); resolve(value); return; }
        if (char === "\u0003" || char === "\u0004") { cleanup(); reject(new Error("Cancelled")); return; }
        if (char === "\u007f" || char === "\b") value = [...value].slice(0, -1).join("");
        else if (char >= " " && char !== "\u007f" && value.length < 512) value += char;
      }
    };
    input.on("data", onData);
    input.on("error", onError);
    input.setRawMode?.(true);
    input.resume();
  });
}

async function runInteractiveBootstrap() {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive TTY without arguments is required");
  loadEnv({ path: ".env", quiet: true });
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let name: string;
  let email: string;
  try {
    name = await prompt.question("Operator name: ");
    email = await prompt.question("Operator email: ");
  } finally {
    prompt.close();
  }
  const password = await readHiddenLine(process.stdin, process.stdout, "Password: ");
  const confirmation = await readHiddenLine(process.stdin, process.stdout, "Confirm password: ");
  if (password !== confirmation) throw new Error("Password confirmation differs");
  const { prisma } = await import("../src/lib/prisma");
  try {
    await bootstrapSuperadmin(prisma, { name, email, password });
    process.stdout.write("Superadmin created. Sign in and enroll TOTP before using the panel.\n");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInteractiveBootstrap().catch((error: unknown) => {
    const message = error instanceof Error && /^(Bootstrap requires an empty database|Invalid bootstrap identity or password policy|Password confirmation differs|Interactive TTY without arguments is required|Interactive TTY is required|Cancelled)$/.test(error.message)
      ? error.message : "Bootstrap failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
