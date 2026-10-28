-- #59: additive index for the availability check. Blocks of one vehicle never overlap (GiST exclusion constraint
-- availability_no_overlap), so "does a block intersect [from, to]" is decided by the block with the latest start
-- not after `to`; this index finds it in O(log n) instead of filtering every block of the vehicle (about 765 rows
-- per vehicle at 100 000 periods per company). Nothing is dropped or rewritten; plain CREATE INDEX takes a short
-- write lock on "AvailabilityBlock" (writes wait, reads are not blocked); apply in a quiet moment on a populated
-- table or create it CONCURRENTLY by hand beforehand (same name makes this statement fail, so drop-free rollback is
-- `DROP INDEX "AvailabilityBlock_vehicleId_from_idx"`).
CREATE INDEX "AvailabilityBlock_vehicleId_from_idx" ON "AvailabilityBlock"("vehicleId", "from" DESC);
