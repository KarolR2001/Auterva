-- Temporary scaffold membership used to prove WebSocket auth and tenant isolation.
ALTER TABLE "user" ADD COLUMN "organizationId" UUID;
CREATE INDEX "user_organizationId_idx" ON "user"("organizationId");
ALTER TABLE "user" ADD CONSTRAINT "user_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
