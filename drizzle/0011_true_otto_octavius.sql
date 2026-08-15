CREATE TYPE "public"."milestone_allocation_type" AS ENUM('percentage', 'fixed_amount');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'complete', 'billed');--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"allocation_type" "milestone_allocation_type" NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"expected_total_amount" numeric(14, 2) NOT NULL,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"xero_invoice_id" text,
	"completed_at" timestamp with time zone,
	"billed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_tenant_job_sequence_unique" UNIQUE("tenant_id","job_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "milestones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"sales_account_code" text,
	"auto_create_draft_invoice_on_complete" boolean DEFAULT true NOT NULL,
	"gp_margin_alert_threshold_pct" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "milestones_select_within_tenant" ON "milestones" AS PERMISSIVE FOR SELECT TO "app_user" USING ("milestones"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "milestones_insert_within_tenant" ON "milestones" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("milestones"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "milestones_update_within_tenant" ON "milestones" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("milestones"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("milestones"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "milestones_delete_within_tenant" ON "milestones" AS PERMISSIVE FOR DELETE TO "app_user" USING ("milestones"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "billing_settings_select_within_tenant" ON "billing_settings" AS PERMISSIVE FOR SELECT TO "app_user" USING ("billing_settings"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "billing_settings_insert_within_tenant" ON "billing_settings" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("billing_settings"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "billing_settings_update_within_tenant" ON "billing_settings" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("billing_settings"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("billing_settings"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "billing_settings_delete_within_tenant" ON "billing_settings" AS PERMISSIVE FOR DELETE TO "app_user" USING ("billing_settings"."tenant_id" = nullif(current_setting('app.current_tenant_id', true), '')::uuid);