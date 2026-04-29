CREATE TYPE "public"."postmortem_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."action_item_status" AS ENUM('open', 'in_progress', 'done', 'wontfix');--> statement-breakpoint
ALTER TYPE "public"."timeline_event_kind" ADD VALUE 'postmortem_link';--> statement-breakpoint
CREATE TABLE "postmortems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"markdown_body" text NOT NULL,
	"status" "postmortem_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"public_on_status_page" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postmortems_incident_id_unique" UNIQUE("incident_id")
);
--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"postmortem_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"title" text NOT NULL,
	"status" "action_item_status" DEFAULT 'open' NOT NULL,
	"due_date" date,
	"external_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_postmortem_id_postmortems_id_fk" FOREIGN KEY ("postmortem_id") REFERENCES "public"."postmortems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_items_postmortem_idx" ON "action_items" USING btree ("postmortem_id","created_at");