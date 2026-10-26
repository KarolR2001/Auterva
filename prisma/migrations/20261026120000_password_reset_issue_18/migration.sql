CREATE TABLE "PasswordResetRequest" (
    "id" UUID NOT NULL,
    "requestKeyHash" VARCHAR(64) NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "userId" TEXT,
    "verificationId" TEXT,
    "hostname" VARCHAR(253) NOT NULL,
    "area" VARCHAR(32) NOT NULL,
    "organizationId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetRequest_requestKeyHash_key" ON "PasswordResetRequest"("requestKeyHash");
CREATE UNIQUE INDEX "PasswordResetRequest_verificationId_key" ON "PasswordResetRequest"("verificationId");
CREATE INDEX "PasswordResetRequest_expiresAt_idx" ON "PasswordResetRequest"("expiresAt");
CREATE INDEX "PasswordResetRequest_userId_createdAt_idx" ON "PasswordResetRequest"("userId", "createdAt");
