-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING_CONFIRM', 'CONFIRMED', 'WAITLISTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuditTrigger" AS ENUM ('USER_ACTION', 'SYSTEM_TIMEOUT', 'WAITLIST_PROMOTED');

-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "start_time" TIMESTAMPTZ(3) NOT NULL,
    "end_time" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "max_per_user" INTEGER NOT NULL DEFAULT 1,
    "confirm_timeout_sec" INTEGER NOT NULL DEFAULT 600,
    "confirmed_count" INTEGER NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" VARCHAR(64) NOT NULL,
    "event_id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "status" "ReservationStatus" NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "waitlisted_at" TIMESTAMPTZ(3),
    "waitlist_seq" INTEGER,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "expired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_audit_logs" (
    "id" VARCHAR(64) NOT NULL,
    "reservation_id" VARCHAR(64) NOT NULL,
    "event_id" VARCHAR(64) NOT NULL,
    "from_status" "ReservationStatus",
    "to_status" "ReservationStatus" NOT NULL,
    "trigger" "AuditTrigger" NOT NULL,
    "actor_id" VARCHAR(64),
    "note" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_is_simulated_role_idx" ON "users"("is_simulated", "role");

-- CreateIndex
CREATE INDEX "events_start_time_idx" ON "events"("start_time");

-- CreateIndex
CREATE INDEX "events_created_at_idx" ON "events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "events_created_by_id_idx" ON "events"("created_by_id");

-- CreateIndex
CREATE INDEX "reservations_event_id_status_waitlist_seq_idx" ON "reservations"("event_id", "status", "waitlist_seq");

-- CreateIndex
CREATE INDEX "reservations_status_expires_at_idx" ON "reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "reservations_event_id_user_id_status_idx" ON "reservations"("event_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "reservations_user_id_updated_at_idx" ON "reservations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "reservations_event_id_updated_at_idx" ON "reservations"("event_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reservations_event_id_user_id_idempotency_key_key" ON "reservations"("event_id", "user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_event_id_waitlist_seq_key" ON "reservations"("event_id", "waitlist_seq");

-- CreateIndex
CREATE INDEX "reservation_audit_logs_reservation_id_created_at_id_idx" ON "reservation_audit_logs"("reservation_id", "created_at" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "reservation_audit_logs_event_id_created_at_idx" ON "reservation_audit_logs"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reservation_audit_logs_actor_id_idx" ON "reservation_audit_logs"("actor_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_audit_logs" ADD CONSTRAINT "reservation_audit_logs_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_audit_logs" ADD CONSTRAINT "reservation_audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_audit_logs" ADD CONSTRAINT "reservation_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Physical CHECK constraints for events (docs/database.md §3.3)
ALTER TABLE "events"
  ADD CONSTRAINT "events_capacity_positive_chk" CHECK ("capacity" > 0),
  ADD CONSTRAINT "events_max_per_user_positive_chk" CHECK ("max_per_user" > 0),
  ADD CONSTRAINT "events_timeout_min_chk" CHECK ("confirm_timeout_sec" >= 10),
  ADD CONSTRAINT "events_time_window_chk" CHECK ("end_time" > "start_time"),
  ADD CONSTRAINT "events_counts_non_negative_chk" CHECK ("confirmed_count" >= 0 AND "pending_count" >= 0),
  ADD CONSTRAINT "events_no_oversell_chk" CHECK ("confirmed_count" + "pending_count" <= "capacity");

-- Physical CHECK constraints for reservations (docs/database.md §3.4)
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_pending_expiry_invariant_chk"
    CHECK (
      ("status" = 'PENDING_CONFIRM' AND "expires_at" IS NOT NULL)
      OR ("status" <> 'PENDING_CONFIRM' AND "expires_at" IS NULL)
    ),
  ADD CONSTRAINT "reservations_waitlisted_requires_seq_chk"
    CHECK (
      "status" <> 'WAITLISTED'
      OR ("waitlisted_at" IS NOT NULL AND "waitlist_seq" IS NOT NULL AND "waitlist_seq" > 0)
    );
