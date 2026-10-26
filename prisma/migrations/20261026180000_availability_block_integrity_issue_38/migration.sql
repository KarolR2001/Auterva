-- #38: additive limits for manual block text and version. Type and MANUAL source are already
-- constrained by #8. NOT VALID enforces every new or updated row without scanning or rejecting
-- pre-existing rows; the overlap/range constraints from earlier migrations are unchanged.
ALTER TABLE "AvailabilityBlock"
  ADD CONSTRAINT "availability_block_text_limits"
  CHECK (char_length("reference") <= 120 AND char_length("internalNote") <= 2000) NOT VALID;

ALTER TABLE "AvailabilityBlock"
  ADD CONSTRAINT "availability_block_version_nonnegative" CHECK ("version" >= 0) NOT VALID;
