-- First completed registration is an idempotent event, not a resettable flag.
CREATE FUNCTION organization_first_registration_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."firstAdminRegisteredAt" IS NOT NULL
    AND NEW."firstAdminRegisteredAt" IS DISTINCT FROM OLD."firstAdminRegisteredAt" THEN
    RAISE EXCEPTION 'first administrator registration is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_first_registration_immutable_before_update
  BEFORE UPDATE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION organization_first_registration_immutable();
