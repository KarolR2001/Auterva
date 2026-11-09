-- #74: additive index for the panel audit read, keyset-paginated by (createdAt, id) within one company.
CREATE INDEX "AuditLog_organizationId_createdAt_id_idx" ON "AuditLog"("organizationId", "createdAt", "id");
