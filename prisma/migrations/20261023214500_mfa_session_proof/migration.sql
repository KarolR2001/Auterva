-- Scaffold proof: distinguish a session with a verified second factor from a password-only session.
ALTER TABLE "session" ADD COLUMN "mfaVerifiedAt" TIMESTAMPTZ(6);
