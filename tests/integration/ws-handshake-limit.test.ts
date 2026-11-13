// #173: per-source handshake limit comes before every database query of /ws and /ws/platform.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { auth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { refusedStatus } from "../fixtures/realtime-client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const db = createPrismaClient(databaseUrl);
const LIMIT = 5;
let queries = 0;
let authorizeCalls = 0;
let currentSource = "198.51.100.1";
let server: Awaited<ReturnType<typeof startRealtimeServer>>;
const org = randomUUID();
const bogus = { cookie: "better-auth.session_token=random.value", origin: "https://nobody.example.test" };

beforeAll(async () => {
  const counting = db.$extends({ query: { $allOperations({ args, query }) { queries += 1; return query(args); } } });
  const real = createRealtimeAuthority(counting as unknown as typeof db, auth);
  const authority = { ...real,
    authorize: (...args: Parameters<typeof real.authorize>) => { authorizeCalls += 1; return real.authorize(...args); },
    authorizePlatform: (...args: Parameters<typeof real.authorizePlatform>) => { authorizeCalls += 1; return real.authorizePlatform(...args); } };
  server = await startRealtimeServer({ db: counting as unknown as typeof db, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() }, databaseUrl, authority,
    limits: { maxHandshakesPerWindow: LIMIT, listenRetryMs: 200 }, clientAddress: () => currentSource });
});

afterAll(async () => { await server?.close().catch(() => undefined); await db.$disconnect(); });

test("#173: a series of unauthenticated upgrades from one source gets 429 and no authorization or database work above the limit", async () => {
  currentSource = "198.51.100.1";
  const statuses: number[] = [];
  for (let i = 0; i < LIMIT; i += 1) statuses.push(await refusedStatus(server.port, org, { ...bogus, path: "/ws" }));
  expect(statuses).toEqual(Array(LIMIT).fill(403));
  expect(authorizeCalls).toBe(LIMIT);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const before = queries;
  for (let i = 0; i < 20; i += 1) {
    expect(await refusedStatus(server.port, org, { ...bogus, path: i % 2 ? "/ws/platform" : "/ws", query: i % 2 ? "" : undefined })).toBe(429);
  }
  expect(authorizeCalls).toBe(LIMIT);
  expect(queries).toBe(before);
});

test("#173: another source is not blocked by the first one", async () => {
  currentSource = "198.51.100.2";
  expect(await refusedStatus(server.port, org, { ...bogus, path: "/ws" })).toBe(403);
  currentSource = "198.51.100.1";
  expect(await refusedStatus(server.port, org, { ...bogus, path: "/ws" })).toBe(429);
});

test("#173: a refused path or host does not use up the source budget", async () => {
  currentSource = "198.51.100.3";
  for (let i = 0; i < LIMIT * 2; i += 1) expect(await refusedStatus(server.port, org, { ...bogus, path: "/nope" })).toBe(404);
  expect(await refusedStatus(server.port, org, { ...bogus, path: "/ws" })).toBe(403);
});
