-- DropForeignKey
ALTER TABLE "user" DROP CONSTRAINT "user_organizationId_fkey";

-- AlterTable
ALTER TABLE "AvailabilityBlock" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "internalNote" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'BLOCKED',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "conversationId" UUID,
ADD COLUMN     "senderId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "archivedAt" TIMESTAMPTZ(6),
ADD COLUMN     "firstAdminRegisteredAt" TIMESTAMPTZ(6),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "publicUnlockRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "availableFrom" DATE,
ADD COLUMN     "availableTo" DATE,
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "categoryId" UUID,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "doors" INTEGER,
ADD COLUMN     "drive" TEXT,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "luggage" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "price" DECIMAL(12,2),
ADD COLUMN     "priceUnit" TEXT,
ADD COLUMN     "seats" INTEGER,
ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "seoTitle" TEXT,
ADD COLUMN     "shortDescription" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "transmission" TEXT,
ADD COLUMN     "variant" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "year" INTEGER;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "disabledAt" TIMESTAMPTZ(6),
ADD COLUMN     "role" TEXT;

-- CreateTable
CREATE TABLE "HostMapping" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "hostname" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROVIDER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "canonicalTarget" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAccess" (
    "organizationId" UUID NOT NULL,
    "paidThrough" DATE,
    "trialGranted" BOOLEAN NOT NULL DEFAULT false,
    "trialStartedAt" TIMESTAMPTZ(6),
    "trialEndsAt" TIMESTAMPTZ(6),
    "periodVersion" INTEGER NOT NULL DEFAULT 0,
    "changedById" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAccess_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "VehicleCategory" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresSeats" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VehicleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleFeature" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "value" TEXT,

    CONSTRAINT "VehicleFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleImage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "alt" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "variants" JSONB,

    CONSTRAINT "VehicleImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "organizationId" UUID NOT NULL,
    "publicName" TEXT,
    "shortDescription" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "contactChannel" TEXT,
    "addressLine" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT,
    "mapLatitude" DECIMAL(9,6),
    "mapLongitude" DECIMAL(9,6),
    "contactHours" TEXT,
    "showPrices" BOOLEAN NOT NULL DEFAULT false,
    "featuredVehicleCount" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "privacyText" TEXT,
    "termsText" TEXT,
    "availabilityNotice" TEXT,
    "heroText" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "PublicMedia" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "alt" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "PublicMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlugRedirect" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "oldSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlugRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationReadCursor" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "lastMessageId" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationReadCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "safeChanges" JSONB,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lockedUntil" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationReceipt" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformLegalDocument" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformLegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostMapping_hostname_key" ON "HostMapping"("hostname");

-- CreateIndex
CREATE INDEX "HostMapping_organizationId_area_idx" ON "HostMapping"("organizationId", "area");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_issueKey_key" ON "Invitation"("issueKey");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_recipientEmail_idx" ON "Invitation"("organizationId", "recipientEmail");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCategory_code_key" ON "VehicleCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleFeature_organizationId_vehicleId_code_key" ON "VehicleFeature"("organizationId", "vehicleId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleImage_storageKey_key" ON "VehicleImage"("storageKey");

-- CreateIndex
CREATE INDEX "VehicleImage_organizationId_vehicleId_position_idx" ON "VehicleImage"("organizationId", "vehicleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PublicMedia_storageKey_key" ON "PublicMedia"("storageKey");

-- CreateIndex
CREATE INDEX "PublicMedia_organizationId_kind_position_idx" ON "PublicMedia"("organizationId", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SlugRedirect_organizationId_oldSlug_key" ON "SlugRedirect"("organizationId", "oldSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_organizationId_key" ON "Conversation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_organizationId_id_key" ON "Conversation"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ConversationReadCursor_organizationId_conversationId_idx" ON "ConversationReadCursor"("organizationId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationReadCursor_conversationId_userId_key" ON "ConversationReadCursor"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_organizationId_dedupeKey_key" ON "Job"("organizationId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "OperationReceipt_organizationId_actorId_area_operation_idem_key" ON "OperationReceipt"("organizationId", "actorId", "area", "operation", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformLegalDocument_code_key" ON "PlatformLegalDocument"("code");

-- CreateIndex
CREATE INDEX "Vehicle_organizationId_status_sortOrder_idx" ON "Vehicle"("organizationId", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_organizationId_slug_key" ON "Vehicle"("organizationId", "slug");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_organizationId_conversationId_fkey" FOREIGN KEY ("organizationId", "conversationId") REFERENCES "Conversation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostMapping" ADD CONSTRAINT "HostMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAccess" ADD CONSTRAINT "ServiceAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleFeature" ADD CONSTRAINT "VehicleFeature_organizationId_vehicleId_fkey" FOREIGN KEY ("organizationId", "vehicleId") REFERENCES "Vehicle"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleImage" ADD CONSTRAINT "VehicleImage_organizationId_vehicleId_fkey" FOREIGN KEY ("organizationId", "vehicleId") REFERENCES "Vehicle"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMedia" ADD CONSTRAINT "PublicMedia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlugRedirect" ADD CONSTRAINT "SlugRedirect_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlugRedirect" ADD CONSTRAINT "SlugRedirect_organizationId_vehicleId_fkey" FOREIGN KEY ("organizationId", "vehicleId") REFERENCES "Vehicle"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReadCursor" ADD CONSTRAINT "ConversationReadCursor_organizationId_conversationId_fkey" FOREIGN KEY ("organizationId", "conversationId") REFERENCES "Conversation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReadCursor" ADD CONSTRAINT "ConversationReadCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationReceipt" ADD CONSTRAINT "OperationReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express partial/expression indexes or these domain checks.
-- Keep the nullable fixture role until product onboarding (#12) owns the final account transition.
ALTER TABLE "user" ADD CONSTRAINT "user_role_scope" CHECK (
  "role" IS NULL OR
  ("role" = 'ADMIN_FIRMY' AND "organizationId" IS NOT NULL) OR
  ("role" = 'SUPERADMIN_AUTERVA' AND "organizationId" IS NULL)
);
CREATE UNIQUE INDEX "user_email_normalized_key" ON "user" (lower(btrim("email")));
CREATE UNIQUE INDEX "user_one_active_company_admin" ON "user" ("organizationId")
  WHERE "role" = 'ADMIN_FIRMY' AND "disabledAt" IS NULL;
CREATE UNIQUE INDEX "user_one_superadmin" ON "user" ("role")
  WHERE "role" = 'SUPERADMIN_AUTERVA';

CREATE UNIQUE INDEX "HostMapping_normalized_hostname_key" ON "HostMapping" (lower(btrim("hostname")));
ALTER TABLE "HostMapping" ADD CONSTRAINT "host_area_owner" CHECK (
  ("area" IN ('COMPANY_ADMIN', 'COMPANY_PUBLIC') AND "organizationId" IS NOT NULL) OR
  ("area" IN ('MARKETING', 'PLATFORM') AND "organizationId" IS NULL)
);

CREATE UNIQUE INDEX "Vehicle_normalized_slug_per_company" ON "Vehicle" ("organizationId", lower(btrim("slug")))
  WHERE "slug" IS NOT NULL;
ALTER TABLE "Vehicle" ADD CONSTRAINT "vehicle_activity_order" CHECK (
  "availableTo" IS NULL OR ("availableFrom" IS NOT NULL AND "availableFrom" <= "availableTo")
);
ALTER TABLE "Vehicle" ADD CONSTRAINT "vehicle_nonnegative_price" CHECK ("price" IS NULL OR "price" >= 0);
ALTER TABLE "Vehicle" ADD CONSTRAINT "vehicle_positive_seats" CHECK ("seats" IS NULL OR "seats" > 0);
ALTER TABLE "Vehicle" ADD CONSTRAINT "vehicle_version_nonnegative" CHECK ("version" >= 0);
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "availability_type_valid" CHECK ("type" IN ('RESERVED', 'MAINTENANCE', 'BLOCKED', 'OTHER'));
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "availability_source_valid" CHECK ("source" = 'MANUAL');

ALTER TABLE "VehicleImage" ADD CONSTRAINT "vehicle_image_limits" CHECK (
  "width" BETWEEN 1 AND 12000 AND "height" BETWEEN 1 AND 12000 AND "bytes" BETWEEN 1 AND 10485760
);
CREATE UNIQUE INDEX "VehicleImage_one_cover_per_vehicle" ON "VehicleImage" ("organizationId", "vehicleId")
  WHERE "isCover";

ALTER TABLE "ServiceAccess" ADD CONSTRAINT "service_trial_336h" CHECK (
  ("trialStartedAt" IS NULL AND "trialEndsAt" IS NULL) OR
  ("trialGranted" AND "trialStartedAt" IS NOT NULL AND "trialEndsAt" = "trialStartedAt" + INTERVAL '336 hours')
);
ALTER TABLE "ServiceAccess" ADD CONSTRAINT "service_version_nonnegative" CHECK ("periodVersion" >= 0);
ALTER TABLE "Invitation" ADD CONSTRAINT "invitation_168h" CHECK ("expiresAt" = "issuedAt" + INTERVAL '168 hours');
CREATE UNIQUE INDEX "Invitation_one_pending_recipient" ON "Invitation" ("organizationId", lower(btrim("recipientEmail")))
  WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;
ALTER TABLE "SiteSettings" ADD CONSTRAINT "site_featured_nonnegative" CHECK ("featuredVehicleCount" >= 0);
ALTER TABLE "SiteSettings" ADD CONSTRAINT "site_latitude_range" CHECK ("mapLatitude" IS NULL OR "mapLatitude" BETWEEN -90 AND 90);
ALTER TABLE "SiteSettings" ADD CONSTRAINT "site_longitude_range" CHECK ("mapLongitude" IS NULL OR "mapLongitude" BETWEEN -180 AND 180);
ALTER TABLE "ChatMessage" ADD CONSTRAINT "message_body_limit" CHECK (char_length("body") BETWEEN 1 AND 4000);
ALTER TABLE "Job" ADD CONSTRAINT "job_attempts_valid" CHECK ("attempts" >= 0 AND "maxAttempts" > 0);
CREATE UNIQUE INDEX "Job_global_dedupe_key" ON "Job" ("dedupeKey") WHERE "organizationId" IS NULL;
CREATE UNIQUE INDEX "OperationReceipt_global_idempotency" ON "OperationReceipt" ("actorId", "area", "operation", "idempotencyKey")
  WHERE "organizationId" IS NULL;
