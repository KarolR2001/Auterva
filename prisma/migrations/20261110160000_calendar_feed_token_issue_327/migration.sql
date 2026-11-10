-- #327 (D-40): private iCal feed tokens. Additive: one new table, no existing row is touched.
-- Only the SHA-256 (hex) of the 256-bit secret is stored; the limit of 5 active tokens per company is enforced in the
-- use case under the company row lock. Rollback: DROP TABLE "CalendarFeedToken";
CREATE TABLE "CalendarFeedToken" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "revokedReason" TEXT,

    CONSTRAINT "CalendarFeedToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calendar_feed_token_hash_format" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "calendar_feed_token_label_length" CHECK (char_length("label") BETWEEN 1 AND 60),
    CONSTRAINT "calendar_feed_token_expiry_after_creation" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "CalendarFeedToken_tokenHash_key" ON "CalendarFeedToken"("tokenHash");
CREATE INDEX "CalendarFeedToken_organizationId_revokedAt_expiresAt_idx" ON "CalendarFeedToken"("organizationId", "revokedAt", "expiresAt");
CREATE INDEX "CalendarFeedToken_createdByUserId_idx" ON "CalendarFeedToken"("createdByUserId");

ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
