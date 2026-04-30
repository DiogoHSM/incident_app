ALTER TYPE "public"."timeline_event_kind" ADD VALUE 'status_update_published';--> statement-breakpoint
CREATE TABLE "status_snapshots" (
	"scope" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
