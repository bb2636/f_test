CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"case_group_prefix" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"damage_prevention_estimate" text,
	"damage_prevention_approved" text,
	"property_repair_estimate" text,
	"property_repair_approved" text,
	"field_dispatch_amount" text,
	"total_approved_amount" text,
	"deductible" text,
	"submission_date" text,
	"approved_by" varchar,
	"approved_at" text,
	"settlement_status" text,
	"remarks" text,
	"created_at" text NOT NULL,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "labor_rate_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"min_ratio" integer NOT NULL,
	"rate_multiplier" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"settlement_amount" text NOT NULL,
	"settlement_date" text NOT NULL,
	"commission" text,
	"discount" text,
	"deductible" text,
	"invoice_date" text,
	"memo" text,
	"bank" text,
	"created_by" varchar NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "report_approval_decision" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "report_approval_comment" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "report_approved_at" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "report_approved_by" varchar;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "invoice_damage_prevention_amount" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "invoice_property_repair_amount" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "invoice_remarks" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "field_dispatch_invoice_amount" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "field_dispatch_invoice_remarks" text;--> statement-breakpoint
ALTER TABLE "estimate_rows" ADD COLUMN "work_type" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_report_approved_by_users_id_fk" FOREIGN KEY ("report_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;