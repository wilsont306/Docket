CREATE TYPE "public"."theme" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" "theme" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_confirm_enabled" boolean DEFAULT false NOT NULL;