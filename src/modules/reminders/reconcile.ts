import type { Prisma } from "@/generated/prisma/client";
import { parseMailPayloadKey } from "@/modules/jobs/config";
import { rebindReminder } from "@/modules/jobs/outbox";
import { companyBoundary, loadReminderCompany } from "./current";
import { REMINDER_OFFSETS, reminderSlot } from "./slots";

export type ReconcileOptions = {
  now: Date;
  /** Needed only to refresh the version of an already queued mail; resolved lazily. */
  loadKey?: () => Buffer;
};

const CHANNELS = ["PANEL", "EMAIL"] as const;

/** Row lock that excludes period, archive, activation and delivery writers of one company. */
export async function lockReminderCompany(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new Error("REMINDER_COMPANY_NOT_FOUND");
}

/**
 * Brings the durable intents in line with the company's current period (contract steps 1-4).
 * Call it in the very transaction that changed the period, activation, archive or restore, while
 * holding the organization row lock. A changed boundary supersedes undelivered intents; slots in
 * the past are never created. An unchanged boundary keeps every intent (also overdue ones),
 * only attaching the new version and source; a queued mail keeps its Job and visible content.
 */
export async function reconcileReminders(tx: Prisma.TransactionClient, organizationId: string,
  options: ReconcileOptions) {
  const { now } = options;
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid reconcile instant");
  const company = await loadReminderCompany(tx, organizationId);
  if (!company) throw new Error("REMINDER_COMPANY_NOT_FOUND");
  const version = company.serviceAccess?.periodVersion ?? 0;
  const boundary = companyBoundary(company, now);
  await tx.reminderIntent.updateMany({ where: { organizationId, status: { in: ["PENDING", "QUEUED"] },
    ...(boundary ? { effectiveEndsAt: { not: boundary.endsAt } } : {}) },
  data: { status: "SUPERSEDED" } });
  if (boundary) {
    const existing = await tx.reminderIntent.findMany({ where: { organizationId,
      effectiveEndsAt: boundary.endsAt } });
    for (const offset of REMINDER_OFFSETS) {
      const slotAt = reminderSlot(boundary, offset);
      for (const channel of CHANNELS) {
        const row = existing.find((item) => item.offsetDays === offset && item.channel === channel);
        if (!row) {
          if (slotAt > now) await tx.reminderIntent.create({ data: { organizationId,
            effectiveEndsAt: boundary.endsAt, offsetDays: offset, channel, slotAt,
            source: boundary.source, periodVersion: version } });
        } else if (row.status === "SUPERSEDED") {
          // Revive only a slot that is in the future again and never produced a mail.
          if (slotAt > now && !row.jobId) await tx.reminderIntent.update({ where: { id: row.id },
            data: { status: "PENDING", slotAt, source: boundary.source, periodVersion: version,
              errorCode: null } });
        } else if (row.status === "PENDING") {
          await tx.reminderIntent.update({ where: { id: row.id }, data: { source: boundary.source,
            periodVersion: version, ...(row.slotAt > now ? { slotAt } : {}) } });
        } else if (row.status === "QUEUED") {
          if (row.periodVersion !== version) {
            await rebindReminder(tx, organizationId, row.id, version, (options.loadKey
              ?? (() => parseMailPayloadKey(process.env.MAIL_PAYLOAD_KEY)))());
            await tx.reminderIntent.update({ where: { id: row.id },
              data: { periodVersion: version, source: boundary.source } });
          }
        }
        // DELIVERED / FAILED / UNCERTAIN / SKIPPED are final: never re-sent under the same key.
      }
    }
  }
  await tx.reminderPlan.upsert({ where: { organizationId },
    create: { organizationId, effectiveEndsAt: boundary?.endsAt ?? null, source: boundary?.source ?? null,
      periodVersion: version },
    update: { effectiveEndsAt: boundary?.endsAt ?? null, source: boundary?.source ?? null,
      periodVersion: version } });
  return { periodVersion: version, boundary };
}
