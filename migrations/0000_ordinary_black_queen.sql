CREATE TABLE "case_change_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"changed_by" varchar,
	"changed_by_name" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"change_type" text NOT NULL,
	"changes" json,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "case_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"category" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_data" text,
	"storage_key" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"checksum" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" text,
	"case_group_id" text,
	"status" text DEFAULT '배당대기' NOT NULL,
	"recovery_type" text,
	"manager_id" varchar,
	"accident_date" text,
	"insurance_company" text,
	"insurance_policy_no" text,
	"insurance_accident_no" text,
	"client_residence" text,
	"client_department" text,
	"client_name" text,
	"client_contact" text,
	"assessor_id" text,
	"assessor_department" text,
	"assessor_team" text,
	"assessor_contact" text,
	"assessor_email" text,
	"investigator_team" text,
	"investigator_department" text,
	"investigator_team_name" text,
	"investigator_contact" text,
	"investigator_email" text,
	"policy_holder_name" text,
	"policy_holder_id_number" text,
	"policy_holder_address" text,
	"insured_name" text,
	"insured_id_number" text,
	"insured_contact" text,
	"insured_address" text,
	"insured_address_detail" text,
	"same_as_policy_holder" text,
	"victim_name" text,
	"victim_contact" text,
	"victim_address" text,
	"victim_address_detail" text,
	"additional_victims" text,
	"visit_date" text,
	"visit_time" text,
	"accompanied_person" text,
	"travel_distance" text,
	"dispatch_location" text,
	"accident_time" text,
	"accident_category" text,
	"processing_types" text,
	"processing_type_other" text,
	"recovery_method_type" text,
	"field_survey_status" text DEFAULT 'draft',
	"client_phone" text,
	"client_address" text,
	"accident_location" text,
	"accident_description" text,
	"accident_type" text,
	"accident_cause" text,
	"restoration_method" text,
	"other_vendor_estimate" text,
	"damage_items" text,
	"damage_prevention_cost" text,
	"victim_incident_assistance" text,
	"assigned_partner" text,
	"assigned_partner_manager" text,
	"assigned_partner_contact" text,
	"urgency" text,
	"special_requests" text,
	"progress_status" text,
	"special_notes" text,
	"special_notes_confirmed_by" varchar,
	"additional_notes" text,
	"voc_content" text,
	"partner_notes_history" text,
	"admin_notes_history" text,
	"partner_notes_acked_by_admin" text,
	"admin_notes_acked_by_partner" text,
	"reception_date" text,
	"inspection_date" text,
	"assignment_date" text,
	"site_visit_date" text,
	"field_survey_date" text,
	"site_investigation_submit_date" text,
	"first_inspection_date" text,
	"first_approval_date" text,
	"second_approval_date" text,
	"first_invoice_date" text,
	"approval_request_date" text,
	"approval_date" text,
	"approval_completion_date" text,
	"construction_start_date" text,
	"construction_completion_date" text,
	"construction_report_submit_date" text,
	"total_work_date" text,
	"contractor_report_date" text,
	"contractor_repair_date" text,
	"completion_date" text,
	"claim_date" text,
	"payment_completed_date" text,
	"partial_payment_date" text,
	"settlement_completed_date" text,
	"review_decision" text,
	"review_comment" text,
	"reviewed_at" text,
	"reviewed_by" varchar,
	"report_approval_decision" text,
	"report_approval_comment" text,
	"report_approved_at" text,
	"report_approved_by" varchar,
	"estimate_amount" text,
	"initial_estimate_amount" text,
	"initial_prevention_estimate_amount" text,
	"initial_property_estimate_amount" text,
	"approved_amount" text,
	"invoice_damage_prevention_amount" text,
	"invoice_property_repair_amount" text,
	"invoice_remarks" text,
	"field_dispatch_invoice_amount" text,
	"field_dispatch_invoice_remarks" text,
	"invoice_confirm_date" text,
	"tax_invoice_confirm_date" text,
	"invoice_pdf_generated" text,
	"assigned_to" varchar,
	"created_by" varchar NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE TABLE "drawings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"uploaded_images" json DEFAULT '[]' NOT NULL,
	"rectangles" json DEFAULT '[]' NOT NULL,
	"accident_areas" json DEFAULT '[]' NOT NULL,
	"leak_markers" json DEFAULT '[]' NOT NULL,
	"canvas_image" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drawings_case_id_unique" UNIQUE("case_id")
);
--> statement-breakpoint
CREATE TABLE "estimate_rows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" varchar NOT NULL,
	"category" text NOT NULL,
	"location" text,
	"work_type" text,
	"work_name" text,
	"damage_width" numeric(20, 4),
	"damage_height" numeric(20, 4),
	"damage_area" numeric(20, 4),
	"repair_width" numeric(20, 4),
	"repair_height" numeric(20, 4),
	"repair_area" numeric(20, 4),
	"note" text,
	"row_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "estimate_rows_estimate_id_row_order_unique" UNIQUE("estimate_id","row_order")
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" varchar NOT NULL,
	"labor_cost_data" json,
	"material_cost_data" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "estimates_case_id_version_unique" UNIQUE("case_id","version")
);
--> statement-breakpoint
CREATE TABLE "excel_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"headers" json NOT NULL,
	"data" json NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "type_title_unique" UNIQUE("type","title")
);
--> statement-breakpoint
CREATE TABLE "field_survey_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_group_id" text NOT NULL,
	"visit_date" text,
	"visit_time" text,
	"accompanied_person" text,
	"travel_distance" text,
	"dispatch_location" text,
	"accident_time" text,
	"accident_category" text,
	"processing_types" text,
	"processing_type_other" text,
	"recovery_method_type" text,
	"field_survey_status" text DEFAULT 'draft',
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_survey_data_case_group_id_unique" UNIQUE("case_group_id")
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT '대기' NOT NULL,
	"response_title" text,
	"response" text,
	"responded_by" varchar,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "labor_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"work_name" text NOT NULL,
	"detail_work" text NOT NULL,
	"detail_item" text,
	"price_standard" text NOT NULL,
	"unit" text NOT NULL,
	"standard_price" integer NOT NULL,
	"standard_work_quantity" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "master_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"tag" text DEFAULT '공통',
	"is_active" text DEFAULT 'true' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "master_data_category_value_unique" UNIQUE("category","value")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_type" text NOT NULL,
	"material_name" text NOT NULL,
	"specification" text DEFAULT '' NOT NULL,
	"unit" text NOT NULL,
	"standard_price" integer NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "materials_work_type_material_name_specification_unique" UNIQUE("work_type","material_name","specification")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"author_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_updates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"content" text NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_name" text NOT NULL,
	"permissions" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "role_permissions_role_name_unique" UNIQUE("role_name")
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
	"closing_date" text,
	"partner_payment_amount" text,
	"partner_payment_date" text,
	"deposit_entries" json,
	"created_by" varchar NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_drawings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_group_id" text NOT NULL,
	"uploaded_images" json DEFAULT '[]' NOT NULL,
	"rectangles" json DEFAULT '[]' NOT NULL,
	"accident_areas" json DEFAULT '[]' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shared_drawings_case_group_id_unique" UNIQUE("case_group_id")
);
--> statement-breakpoint
CREATE TABLE "unit_price_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"work_name" text NOT NULL,
	"labor_item" text NOT NULL,
	"standard_work_quantity" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unit_price_overrides_category_work_name_labor_item_unique" UNIQUE("category","work_name","labor_item")
);
--> statement-breakpoint
CREATE TABLE "user_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"menu_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_favorites_user_id_menu_name_unique" UNIQUE("user_id","menu_name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT '사원' NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"department" text,
	"position" text,
	"email" text,
	"phone" text,
	"office" text,
	"address" text,
	"address_detail" text,
	"business_registration_number" text,
	"representative_name" text,
	"bank_name" text,
	"account_number" text,
	"account_holder" text,
	"service_regions" text[],
	"attachments" text[],
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
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
ALTER TABLE "case_change_logs" ADD CONSTRAINT "case_change_logs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_change_logs" ADD CONSTRAINT "case_change_logs_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_special_notes_confirmed_by_users_id_fk" FOREIGN KEY ("special_notes_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_report_approved_by_users_id_fk" FOREIGN KEY ("report_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_rows" ADD CONSTRAINT "estimate_rows_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_survey_data" ADD CONSTRAINT "field_survey_data_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_updates" ADD CONSTRAINT "progress_updates_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_updates" ADD CONSTRAINT "progress_updates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_drawings" ADD CONSTRAINT "shared_drawings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;