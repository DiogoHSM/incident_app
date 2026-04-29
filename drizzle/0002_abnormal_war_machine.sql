CREATE TYPE "public"."incident_status" AS ENUM('triaging', 'investigating', 'identified', 'monitoring', 'resolved');--> statement-breakpoint
CREATE TABLE "incident_services" (
	"incident_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "incident_services_incident_id_service_id_pk" PRIMARY KEY("incident_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_slug" text NOT NULL,
	"team_id" uuid NOT NULL,
	"declared_by" uuid NOT NULL,
	"severity" "severity" NOT NULL,
	"status" "incident_status" DEFAULT 'investigating' NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"ic_user_id" uuid,
	"scribe_user_id" uuid,
	"comms_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_public_slug_uniq" UNIQUE("public_slug")
);
--> statement-breakpoint
ALTER TABLE "incident_services" ADD CONSTRAINT "incident_services_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_services" ADD CONSTRAINT "incident_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_ic_user_id_users_id_fk" FOREIGN KEY ("ic_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_scribe_user_id_users_id_fk" FOREIGN KEY ("scribe_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_comms_user_id_users_id_fk" FOREIGN KEY ("comms_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_services_service_idx" ON "incident_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "incidents_team_idx" ON "incidents" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_declared_at_idx" ON "incidents" USING btree ("declared_at");