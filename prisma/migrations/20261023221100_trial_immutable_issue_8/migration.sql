-- An awarded trial may start once, and its 336-hour window cannot be restarted.
CREATE FUNCTION service_access_trial_immutable() RETURNS trigger AS $$
BEGIN
  IF (OLD."trialGranted" AND NOT NEW."trialGranted")
    OR (OLD."trialStartedAt" IS NOT NULL AND NEW."trialStartedAt" IS DISTINCT FROM OLD."trialStartedAt")
    OR (OLD."trialEndsAt" IS NOT NULL AND NEW."trialEndsAt" IS DISTINCT FROM OLD."trialEndsAt") THEN
    RAISE EXCEPTION 'trial grant and started period are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_access_trial_immutable_before_update
  BEFORE UPDATE ON "ServiceAccess"
  FOR EACH ROW EXECUTE FUNCTION service_access_trial_immutable();
