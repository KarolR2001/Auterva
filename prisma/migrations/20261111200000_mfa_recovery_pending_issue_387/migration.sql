-- #387 (D-05 pt. 4/5): durable "MFA recovery in progress" state. After a recovery code removes the old factor, a
-- password alone must not open an enrollment session; only the session that consumed the code may enroll a new TOTP.
-- Additive: two nullable columns (NULL = no recovery in progress, the meaning of every existing row) and a CHECK that
-- keeps them set or cleared together. The session id is not a foreign key on purpose: ending that session must not
-- silently clear the pending state (it stays locked until the operator procedure).
-- Rollback: ALTER TABLE "user" DROP CONSTRAINT "user_mfa_recovery_pending_pair";
-- ALTER TABLE "user" DROP COLUMN "mfaRecoverySessionId"; ALTER TABLE "user" DROP COLUMN "mfaRecoveryPendingAt";
ALTER TABLE "user" ADD COLUMN "mfaRecoveryPendingAt" TIMESTAMPTZ(6);
ALTER TABLE "user" ADD COLUMN "mfaRecoverySessionId" TEXT;
ALTER TABLE "user" ADD CONSTRAINT "user_mfa_recovery_pending_pair"
  CHECK (("mfaRecoveryPendingAt" IS NULL) = ("mfaRecoverySessionId" IS NULL));
