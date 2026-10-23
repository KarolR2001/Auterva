-- Better Auth instants are stored with timezone; existing UTC fixture values retain their instant.
ALTER TABLE "user" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "user" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "session" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6) USING "expiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "session" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "session" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "account" ALTER COLUMN "accessTokenExpiresAt" TYPE TIMESTAMPTZ(6) USING "accessTokenExpiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "account" ALTER COLUMN "refreshTokenExpiresAt" TYPE TIMESTAMPTZ(6) USING "refreshTokenExpiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "account" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "account" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "verification" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6) USING "expiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "verification" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "verification" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "twoFactor" ALTER COLUMN "lockedUntil" TYPE TIMESTAMPTZ(6) USING "lockedUntil" AT TIME ZONE 'UTC';
