import { createHash } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";

/**
 * Deterministic test data for the load profiles of #59 (NFR-PERF-002, section 21.2). Same seed and options
 * give byte-identical rows (ids included). Nothing here reads the clock except through `today`, which callers
 * freeze. The caller (CLI or test) decides which database receives the rows; the CLI refuses everything but the
 * local fixture.
 */
export type CompanyPlan = { index: number; vehicles: number; blocksPerVehicle: number };
export type GenerateOptions = { prefix: string; seed: number; companies: number; vehicles: number;
  blocksPerCompany: number; today: string; messagesPerCompany?: number };

/** P1 (approved, section 21.2): one company, 100 vehicles, 100 000 periods. P2 (proposed in #90): two such companies. */
export const PROFILES = {
  p1: { companies: 1, vehicles: 100, blocksPerCompany: 100_000 },
  p2: { companies: 2, vehicles: 100, blocksPerCompany: 100_000 },
} as const;
export type ProfileName = keyof typeof PROFILES;

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stableUuid(...parts: (string | number)[]): string {
  const hex = createHash("sha256").update(parts.join("|")).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const dayOffset = (base: string, days: number) =>
  new Date(sqlDate(base).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export const companyIds = (prefix: string, seed: number, n: number) => ({
  organizationId: stableUuid(prefix, seed, "org", n),
  adminId: `${prefix}-${seed}-admin-${n}`,
  slug: `${prefix}-${n}`,
  publicHost: `${prefix}-${n}.perf.localhost`,
  adminHost: `admin.${prefix}-${n}.perf.localhost`,
});

export const vehicleId = (prefix: string, seed: number, n: number, v: number) => stableUuid(prefix, seed, "vehicle", n, v);
export const vehicleSlug = (prefix: string, n: number, v: number) => `${prefix}-${n}-auto-${String(v).padStart(3, "0")}`;

const batches = <T>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) },
  (_, index) => rows.slice(index * size, (index + 1) * size));

/**
 * History starts 6 years before `today` and the last block ends about 6 years after it. Blocks of one
 * vehicle never touch each other, which is what the GiST exclusion constraint requires.
 */
export function planBlocks(seed: number, options: { prefix: string; n: number; v: number; count: number; today: string }) {
  const rand = mulberry32(seed ^ Math.imul(options.n + 1, 2654435761) ^ Math.imul(options.v + 1, 40503));
  const types = ["BLOCKED", "MAINTENANCE", "RESERVED"];
  let cursor = -6 * 365;
  const rows: { from: string; to: string; type: string }[] = [];
  for (let i = 0; i < options.count; i += 1) {
    cursor += 1 + Math.floor(rand() * 4); // 1-4 free days before the block
    const length = 1 + Math.floor(rand() * 3); // 1-3 days, both ends inclusive
    rows.push({ from: dayOffset(options.today, cursor), to: dayOffset(options.today, cursor + length - 1),
      type: types[Math.floor(rand() * types.length)] });
    cursor += length;
  }
  return rows;
}

export async function generateData(db: PrismaClient, options: GenerateOptions) {
  const perVehicle = Math.floor(options.blocksPerCompany / options.vehicles);
  const startedAt = Date.now();
  const activityFrom = dayOffset(options.today, -8 * 365);
  const activityTo = dayOffset(options.today, 8 * 365);
  const category = { id: stableUuid(options.prefix, options.seed, "category"), code: `${options.prefix}-cat` };
  await db.vehicleCategory.upsert({ where: { code: category.code }, create: { ...category, name: "Perf" }, update: {} });
  const paidThrough = sqlDate(dayOffset(options.today, 365));
  let blocks = 0;
  for (let n = 1; n <= options.companies; n += 1) {
    const ids = companyIds(options.prefix, options.seed, n);
    const org = await db.organization.findUnique({ where: { id: ids.organizationId }, select: { id: true } });
    if (org) continue; // idempotent: an existing perf company is never rewritten
    const rand = mulberry32(options.seed + n);
    await db.organization.create({ data: { id: ids.organizationId, slug: ids.slug, name: `Perf ${n}`,
      firstAdminRegisteredAt: new Date("2026-01-01T00:00:00Z") } });
    await db.hostMapping.createMany({ data: [
      { id: stableUuid(options.prefix, options.seed, "host-pub", n), organizationId: ids.organizationId,
        hostname: ids.publicHost, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { id: stableUuid(options.prefix, options.seed, "host-adm", n), organizationId: ids.organizationId,
        hostname: ids.adminHost, area: "COMPANY_ADMIN", status: "ACTIVE" },
    ] });
    await db.serviceAccess.create({ data: { organizationId: ids.organizationId, paidThrough } });
    await db.user.create({ data: { id: ids.adminId, name: `Perf admin ${n}`, email: `${ids.adminId}@example.test`,
      role: "ADMIN_FIRMY", organizationId: ids.organizationId, emailVerified: true, twoFactorEnabled: true } });
    await db.conversation.create({ data: { id: stableUuid(options.prefix, options.seed, "conv", n),
      organizationId: ids.organizationId } });
    const vehicles = Array.from({ length: options.vehicles }, (_, v) => {
      const published = v % 10 !== 9; // 90% PUBLISHED, 10% DRAFT
      return { id: vehicleId(options.prefix, options.seed, n, v), organizationId: ids.organizationId,
        slug: vehicleSlug(options.prefix, n, v), name: `Auto ${v}`, brand: "Perf", model: `M${v % 7}`, seats: 2 + (v % 7),
        transmission: v % 2 ? "MANUAL" : "AUTOMATIC", price: (100 + Math.floor(rand() * 400)).toFixed(2), priceUnit: "doba",
        status: published ? "PUBLISHED" : "DRAFT", sortOrder: v, categoryId: category.id,
        availableFrom: sqlDate(activityFrom), availableTo: sqlDate(activityTo) };
    });
    await db.vehicle.createMany({ data: vehicles });
    await db.vehicleImage.createMany({ data: vehicles.flatMap((vehicle, v) => [0, 1].map((position) => ({
      id: stableUuid(options.prefix, options.seed, "img", n, v, position), organizationId: ids.organizationId,
      vehicleId: vehicle.id, storageKey: `perf/${options.prefix}/${n}/${v}/${position}`, mime: "image/webp", width: 480,
      height: 320, bytes: 20_000, alt: null, position, isCover: position === 0, status: "READY",
      variants: { large: `perf/${v}/${position}/large.webp`, thumb: `perf/${v}/${position}/thumb.webp` } }))) });
    const blockRows = vehicles.flatMap((vehicle, v) => planBlocks(options.seed, { prefix: options.prefix, n, v, count: perVehicle,
      today: options.today }).map((block, i) => ({ id: stableUuid(options.prefix, options.seed, "block", n, v, i),
      organizationId: ids.organizationId, vehicleId: vehicle.id, from: sqlDate(block.from), to: sqlDate(block.to),
      type: block.type, source: "MANUAL" })));
    for (const part of batches(blockRows, 5_000)) await db.availabilityBlock.createMany({ data: part });
    blocks += blockRows.length;
    const messages = options.messagesPerCompany ?? 0;
    if (messages > 0) {
      // seq and Conversation.lastSeq are assigned by the chat_message_assign_seq trigger.
      const conversationId = stableUuid(options.prefix, options.seed, "conv", n);
      for (const part of batches(Array.from({ length: messages }, (_, i) => i), 5_000)) {
        await db.chatMessage.createMany({ data: part.map((i) => ({ id: stableUuid(options.prefix, options.seed, "msg", n, i),
          organizationId: ids.organizationId, conversationId, senderId: ids.adminId,
          clientMessageId: stableUuid(options.prefix, options.seed, "cmsg", n, i), body: `Wiadomość ${i}`,
          createdAt: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 60_000) })) });
      }
    }
  }
  await db.$executeRawUnsafe('ANALYZE "AvailabilityBlock", "Vehicle", "VehicleImage", "ChatMessage"');
  return { blocks, ms: Date.now() - startedAt };
}

export function defaultOptions(profile: ProfileName, seed = 59, today = availabilityToday()): GenerateOptions {
  return { prefix: "perf", seed, today, ...PROFILES[profile] };
}
