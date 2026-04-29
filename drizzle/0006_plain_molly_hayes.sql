CREATE TYPE "public"."webhook_source_type" AS ENUM('generic', 'sentry', 'datadog', 'grafana');--> statement-breakpoint
ALTER TYPE "public"."timeline_event_kind" ADD VALUE 'webhook';--> statement-breakpoint
CREATE TABLE "webhook_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"type" "webhook_source_type" NOT NULL,
	"name" text NOT NULL,
	"secret_material" jsonb NOT NULL,
	"default_severity" "severity" NOT NULL,
	"default_service_id" uuid,
	"auto_promote_threshold" integer DEFAULT 3 NOT NULL,
	"auto_promote_window_seconds" integer DEFAULT 600 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_sources_team_name_uniq" UNIQUE("team_id","name")
);
--> statement-breakpoint
CREATE TABLE "dead_letter_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"headers" jsonb NOT NULL,
	"body" text NOT NULL,
	"error" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incidents" ALTER COLUMN "declared_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "external_fingerprints" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_sources" ADD CONSTRAINT "webhook_sources_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_sources" ADD CONSTRAINT "webhook_sources_default_service_id_services_id_fk" FOREIGN KEY ("default_service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_webhooks" ADD CONSTRAINT "dead_letter_webhooks_source_id_webhook_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."webhook_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_sources_team_idx" ON "webhook_sources" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "dead_letter_webhooks_received_at_idx" ON "dead_letter_webhooks" USING btree ("received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_external_fingerprints_gin" ON "incidents" USING gin ("external_fingerprints");