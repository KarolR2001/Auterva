-- #366 (E11, D-47): optional vehicle scope of a private iCal feed token. Additive: one new column with a default (every
-- existing token keeps the whole fleet), one new table, one new unique index. No existing row changes meaning.
-- The scope is stored explicitly: a VEHICLES token whose selected rows all disappear (cascade) stays an empty calendar
-- and never widens to the whole fleet. Composite foreign keys keep the token and the vehicle in one company.
-- Rollback: DROP TABLE "CalendarFeedTokenVehicle"; DROP INDEX "CalendarFeedToken_organizationId_id_key";
-- ALTER TABLE "CalendarFeedToken" DROP COLUMN "scope";
ALTER TABLE "CalendarFeedToken" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'FLEET';
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "calendar_feed_token_scope" CHECK ("scope" IN ('FLEET', 'VEHICLES'));

CREATE UNIQUE INDEX "CalendarFeedToken_organizationId_id_key" ON "CalendarFeedToken"("organizationId", "id");

CREATE TABLE "CalendarFeedTokenVehicle" (
    "organizationId" UUID NOT NULL,
    "tokenId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,

    CONSTRAINT "CalendarFeedTokenVehicle_pkey" PRIMARY KEY ("tokenId","vehicleId")
);

CREATE INDEX "CalendarFeedTokenVehicle_organizationId_vehicleId_idx" ON "CalendarFeedTokenVehicle"("organizationId", "vehicleId");

ALTER TABLE "CalendarFeedTokenVehicle" ADD CONSTRAINT "CalendarFeedTokenVehicle_organizationId_tokenId_fkey" FOREIGN KEY ("organizationId", "tokenId") REFERENCES "CalendarFeedToken"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarFeedTokenVehicle" ADD CONSTRAINT "CalendarFeedTokenVehicle_organizationId_vehicleId_fkey" FOREIGN KEY ("organizationId", "vehicleId") REFERENCES "Vehicle"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
