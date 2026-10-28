import { defaultOptions, generateData, PROFILES, type ProfileName } from "./generate-data";
import { requireOwnFixture } from "./target";

// pnpm perf:generate -- --profile p1|p2 [--seed 59] [--messages 0]
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const profile = flag("profile", "p1") as ProfileName;
if (!(profile in PROFILES)) throw new Error(`Unknown profile ${profile}`);
const url = await requireOwnFixture();
// Dynamic: src/lib/prisma.ts reads the server env at import time, after requireOwnFixture() loaded it.
const { createPrismaClient } = await import("../../src/lib/prisma");
const db = createPrismaClient(url);
try {
  const options = { ...defaultOptions(profile, Number(flag("seed", "59"))), messagesPerCompany: Number(flag("messages", "0")) };
  const result = await generateData(db, options);
  process.stdout.write(`Generated ${profile}: ${result.blocks} blocks in ${result.ms} ms (existing companies are kept)\n`);
} finally { await db.$disconnect(); }
