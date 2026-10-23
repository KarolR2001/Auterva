CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "AvailabilityBlock"
  ADD CONSTRAINT "availability_valid_range" CHECK ("from" <= "to");

ALTER TABLE "AvailabilityBlock"
  ADD CONSTRAINT "availability_no_overlap"
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    daterange("from", "to", '[]') WITH &&
  );
