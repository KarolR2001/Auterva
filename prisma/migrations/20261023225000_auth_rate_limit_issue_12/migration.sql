CREATE TABLE "RateLimitEvent" (
  "id" UUID NOT NULL,
  "keyHash" VARCHAR(64) NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'COMMITTED',
  CONSTRAINT "RateLimitEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rate_event_order" CHECK ("expiresAt" > "occurredAt"),
  CONSTRAINT "rate_event_state" CHECK ("state" IN ('COMMITTED', 'PENDING'))
);

CREATE INDEX "RateLimitEvent_keyHash_occurredAt_idx" ON "RateLimitEvent" ("keyHash", "occurredAt");
CREATE INDEX "RateLimitEvent_expiresAt_idx" ON "RateLimitEvent" ("expiresAt");
