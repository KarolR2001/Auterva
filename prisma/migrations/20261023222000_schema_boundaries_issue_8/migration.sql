-- Match D-04's decimal 10 MB bound without rewriting the applied migration.
ALTER TABLE "VehicleImage" DROP CONSTRAINT "vehicle_image_limits";
ALTER TABLE "VehicleImage" ADD CONSTRAINT "vehicle_image_limits" CHECK (
  "width" BETWEEN 1 AND 12000 AND "height" BETWEEN 1 AND 12000 AND "bytes" BETWEEN 1 AND 10000000
);

-- PostgreSQL accepts UNKNOWN from CHECK; require both timestamps explicitly.
ALTER TABLE "ServiceAccess" DROP CONSTRAINT "service_trial_336h";
ALTER TABLE "ServiceAccess" ADD CONSTRAINT "service_trial_336h" CHECK (
  ("trialStartedAt" IS NULL AND "trialEndsAt" IS NULL) OR
  ("trialGranted" AND "trialStartedAt" IS NOT NULL AND "trialEndsAt" IS NOT NULL
    AND "trialEndsAt" = "trialStartedAt" + INTERVAL '336 hours')
);

-- A read cursor may point only at a message in its own company and conversation.
CREATE UNIQUE INDEX "ChatMessage_organizationId_conversationId_id_key"
  ON "ChatMessage"("organizationId", "conversationId", "id");
ALTER TABLE "ConversationReadCursor" ADD CONSTRAINT "ConversationReadCursor_organizationId_conversationId_lastM_fkey"
  FOREIGN KEY ("organizationId", "conversationId", "lastMessageId")
  REFERENCES "ChatMessage"("organizationId", "conversationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
