-- #59: additive index for the availability check. Blocks of one vehicle never overlap (GiST exclusion constraint
-- availability_no_overlap), so "does a block intersect [from, to]" is decided by the block with the latest start
-- not after `to`; this index finds it in O(log n) instead of filtering every block of the vehicle (about 765 rows
-- per vehicle at 100 000 periods per company). Nothing is dropped or rewritten. Plain CREATE INDEX blocks writes
-- (INSERT/UPDATE/DELETE) to "AvailabilityBlock" for the WHOLE index build, not just briefly; reads are not blocked.
-- That is acceptable before production (#3) at this size; on a populated production table create the index by hand
-- with CREATE INDEX CONCURRENTLY under the same name beforehand. Rollback: DROP INDEX "AvailabilityBlock_vehicleId_from_idx".
CREATE INDEX "AvailabilityBlock_vehicleId_from_idx" ON "AvailabilityBlock"("vehicleId", "from" DESC);
