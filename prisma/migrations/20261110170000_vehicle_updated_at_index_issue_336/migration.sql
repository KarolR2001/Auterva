-- #336 (D-42): sortowanie i filtr listy floty po ostatniej zmianie. Addytywny indeks, bez zmiany danych.
CREATE INDEX "Vehicle_organizationId_updatedAt_id_idx" ON "Vehicle"("organizationId", "updatedAt" DESC, "id");
