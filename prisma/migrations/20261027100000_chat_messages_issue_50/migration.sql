-- #50: durable chat history. Additive: a per-conversation sequence assigned under the company lock gives
-- a gap-free, commit-ordered cursor key (createdAt is not commit-ordered), plus the last-activity marker
-- used by the platform conversation list. Messages without a conversation (WebSocket fixture rows from
-- #5) keep a NULL sequence and stay outside every history.
ALTER TABLE "Conversation"
  ADD COLUMN "lastSeq" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activityAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
ALTER TABLE "ChatMessage" ADD COLUMN "seq" INTEGER;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY "conversationId" ORDER BY "createdAt", id) AS rn
  FROM "ChatMessage" WHERE "conversationId" IS NOT NULL
)
UPDATE "ChatMessage" m SET "seq" = numbered.rn FROM numbered WHERE m.id = numbered.id;

UPDATE "Conversation" c SET
  "lastSeq" = COALESCE(m.max_seq, 0),
  "activityAt" = date_trunc('milliseconds', GREATEST(c."createdAt", COALESCE(m.max_at, c."createdAt")))
FROM (SELECT "conversationId", max("seq") AS max_seq, max("createdAt") AS max_at
      FROM "ChatMessage" WHERE "conversationId" IS NOT NULL GROUP BY "conversationId") m
WHERE m."conversationId" = c.id;

CREATE UNIQUE INDEX "ChatMessage_conversationId_seq_key" ON "ChatMessage"("conversationId", "seq");

-- NOT VALID: every new or updated row is checked without rejecting pre-existing fixture rows.
ALTER TABLE "ChatMessage" ADD CONSTRAINT "chat_message_seq_positive"
  CHECK ("seq" IS NULL OR "seq" > 0) NOT VALID;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "chat_message_seq_with_conversation"
  CHECK ("conversationId" IS NULL OR "seq" IS NOT NULL) NOT VALID;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "chat_message_body_length"
  CHECK (char_length("body") BETWEEN 1 AND 4000) NOT VALID;
ALTER TABLE "Conversation" ADD CONSTRAINT "conversation_last_seq_nonnegative"
  CHECK ("lastSeq" >= 0) NOT VALID;

-- A writer that does not number its message (fixture seeds, legacy code) still gets the next sequence under
-- the conversation row lock, so no message of a conversation is ever left outside its history.
CREATE FUNCTION "chat_message_assign_seq"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."conversationId" IS NOT NULL AND NEW."seq" IS NULL THEN
    UPDATE "Conversation" SET "lastSeq" = "lastSeq" + 1, "activityAt" = GREATEST("activityAt", NEW."createdAt")
      WHERE "id" = NEW."conversationId" AND "organizationId" = NEW."organizationId"
      RETURNING "lastSeq" INTO NEW."seq";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "chat_message_assign_seq" BEFORE INSERT ON "ChatMessage"
  FOR EACH ROW EXECUTE FUNCTION "chat_message_assign_seq"();
