ALTER TABLE "AuditLog" ADD COLUMN "eventKey" UUID;
CREATE UNIQUE INDEX "AuditLog_eventKey_key" ON "AuditLog"("eventKey");
