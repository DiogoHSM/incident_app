CREATE TYPE "public"."severity" AS ENUM('SEV1', 'SEV2', 'SEV3', 'SEV4');--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_team_slug_uniq" UNIQUE("team_id","slug")
);
--> statement-breakpoint
CREATE TABLE "runbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"severity" "severity" NOT NULL,
	"markdown_body" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runbooks_service_severity_uniq" UNIQUE("service_id","severity")
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;