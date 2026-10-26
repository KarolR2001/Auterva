import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { expect, test } from "vitest";

const migration = readFileSync(new URL("../../prisma/migrations/20261027100000_chat_messages_issue_50/migration.sql",
  import.meta.url), "utf8");

test("occupied database upgrade numbers existing messages per conversation and keeps orphan fixture rows", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const [org, otherOrg, conversation, otherConversation] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  try {
    await client.query("BEGIN");
    // Reconstruct the pre-#50 shape inside a rolled-back transaction on the local test DB.
    await client.query('DROP TRIGGER "chat_message_assign_seq" ON "ChatMessage"');
    await client.query('DROP FUNCTION "chat_message_assign_seq"()');
    await client.query('ALTER TABLE "ChatMessage" DROP CONSTRAINT "chat_message_body_length"');
    await client.query('ALTER TABLE "ChatMessage" DROP COLUMN "seq" CASCADE');
    await client.query('ALTER TABLE "Conversation" DROP COLUMN "lastSeq", DROP COLUMN "activityAt"');
    await client.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2), ($3, $4)',
      [org, `mig-${org}`, otherOrg, `mig-${otherOrg}`]);
    await client.query('INSERT INTO "Conversation" (id, "organizationId", "createdAt") VALUES ($1, $2, $3), ($4, $5, $3)',
      [conversation, org, "2026-10-01T10:00:00.123456Z", otherConversation, otherOrg]);
    const insert = (organizationId: string, conversationId: string | null, body: string, at: string) => client.query(
      'INSERT INTO "ChatMessage" (id, "organizationId", "conversationId", "clientMessageId", body, "createdAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), organizationId, conversationId, randomUUID(), body, at]);
    await insert(org, conversation, "trzecia", "2026-10-03T10:00:00Z");
    await insert(org, conversation, "pierwsza", "2026-10-01T11:00:00Z");
    await insert(org, conversation, "druga", "2026-10-02T10:00:00Z");
    await insert(org, null, "sierota", "2026-10-04T10:00:00Z");
    await client.query(migration);
    const rows = await client.query<{ body: string; seq: number | null }>(
      'SELECT body, seq FROM "ChatMessage" WHERE "organizationId" = $1 ORDER BY seq NULLS LAST', [org]);
    expect(rows.rows).toEqual([{ body: "pierwsza", seq: 1 }, { body: "druga", seq: 2 }, { body: "trzecia", seq: 3 }, { body: "sierota", seq: null }]);
    const counters = await client.query<{ id: string; lastSeq: number; at: string }>(
      `SELECT id, "lastSeq", to_char("activityAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at FROM "Conversation" WHERE id = ANY($1)`,
      [[conversation, otherConversation]]);
    const byId = new Map(counters.rows.map((row) => [row.id, row]));
    expect(byId.get(conversation)).toMatchObject({ lastSeq: 3, at: "2026-10-03T10:00:00.000000" });
    expect(byId.get(otherConversation)).toMatchObject({ lastSeq: 0 });
    // A writer that does not number its message gets the next sequence from the trigger; orphans stay unnumbered.
    await insert(org, conversation, "bez seq", "2026-10-05T10:00:00Z");
    await insert(org, null, "druga sierota", "2026-10-05T11:00:00Z");
    const numbered = await client.query<{ body: string; seq: number | null }>(
      'SELECT body, seq FROM "ChatMessage" WHERE "organizationId" = $1 AND body IN ($2, $3) ORDER BY body', [org, "bez seq", "druga sierota"]);
    expect(numbered.rows).toEqual([{ body: "bez seq", seq: 4 }, { body: "druga sierota", seq: null }]);
    expect((await client.query<{ n: number }>('SELECT "lastSeq" AS n FROM "Conversation" WHERE id = $1', [conversation])).rows[0].n).toBe(4);
    // Constraints guard new rows: duplicate sequence, non-positive sequence, oversized body.
    for (const [seq, body] of [[1, "dubel"], [9, "x".repeat(4001)], [0, "zero"]] as const) {
      await client.query("SAVEPOINT attempt");
      await expect(client.query(
        'INSERT INTO "ChatMessage" (id, "organizationId", "conversationId", "clientMessageId", body, seq) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), org, conversation, randomUUID(), body, seq])).rejects.toMatchObject({ code: expect.stringMatching(/^23/) });
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
