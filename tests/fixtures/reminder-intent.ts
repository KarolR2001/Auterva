import type { PrismaClient } from "../../src/generated/prisma/client";
import { paidEndExclusive } from "../../src/modules/service-period/state";

/**
 * Binds a hand-made MAIL_REMINDER job to a live QUEUED intent of the company's current boundary
 * (registered company, paid to a far date), as the reminder module does. Since #54 the mail
 * processor refuses a reminder job that has no current intent.
 */
let sequence = 0;

export async function bindReminderIntent(db: PrismaClient, organizationId: string, referenceId: string, jobId: string) {
  // A distinct boundary per call keeps the (company, boundary, offset, channel) key unique.
  const paidThrough = new Date(Date.UTC(2027, 0, 1 + sequence++)).toISOString().slice(0, 10);
  const organization = await db.organization.findUniqueOrThrow({ where: { id: organizationId },
    select: { firstAdminRegisteredAt: true } });
  if (!organization.firstAdminRegisteredAt) await db.organization.update({ where: { id: organizationId },
    data: { firstAdminRegisteredAt: new Date("2026-01-01T00:00:00.000Z") } });
  const access = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } });
  await db.serviceAccess.update({ where: { organizationId }, data: { paidThrough: new Date(`${paidThrough}T00:00:00.000Z`) } });
  await db.reminderIntent.create({ data: { id: referenceId, organizationId, effectiveEndsAt: paidEndExclusive(paidThrough),
    offsetDays: 7, channel: "EMAIL", slotAt: new Date(`${paidThrough}T07:00:00.000Z`), source: "PAID",
    periodVersion: access.periodVersion, status: "QUEUED", jobId } });
}
