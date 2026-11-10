import { createHmac } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";

/** Fresh MFA proof for exporting company data (#328, E1): single-use, 5 minutes, bound to account, session and this purpose. */
export const EXPORT_COMPANY_DATA_PURPOSE = "export-company-data";

/** Same derivation as `/api/auth/mfa/reauth`: the proof itself is never stored, only its keyed digest. */
export function reauthProofIdentifier(secret: string, proof: string): string {
  return `auterva:mfa:${createHmac("sha256", secret).update(`reauth:${proof}`).digest("hex")}`;
}

/**
 * Call inside the transaction of the guarded operation. Deleting the row is the consumption: a second use, another
 * session, another account or another purpose finds nothing.
 */
export async function consumeReauthProof(tx: Prisma.TransactionClient, input: {
  secret: string; proof: string; userId: string; sessionId: string; purpose: string; now: Date;
}): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(input.proof)) return false;
  const value = JSON.stringify({ userId: input.userId, sessionId: input.sessionId, purpose: input.purpose });
  const consumed = await tx.verification.deleteMany({ where: {
    identifier: reauthProofIdentifier(input.secret, input.proof), value, expiresAt: { gt: input.now } } });
  return consumed.count === 1;
}
