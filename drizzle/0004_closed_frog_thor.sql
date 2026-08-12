CREATE TYPE "public"."employee_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."employee_rate_type" AS ENUM('actual', 'standard');--> statement-breakpoint
ALTER TYPE "public"."cost_type" ADD VALUE 'labour_variance';--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_identifier" text NOT NULL,
	"name" text NOT NULL,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_tenant_identifier_unique" UNIQUE("tenant_id","employee_identifier")
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"rate_type" "employee_rate_type" NOT NULL,
	"hourly_rate" numeric(10, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_rates_employee_type_effective_unique" UNIQUE("employee_id","rate_type","effective_from")
);
--> statement-breakpoint
ALTER TABLE "employee_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "labour_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"import_batch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "labour_time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "labour_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"costing_method" "employee_rate_type" DEFAULT 'standard' NOT NULL,
	"default_labour_cost_code_id" uuid,
	"default_variance_cost_code_id" uuid,
	"overhead_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "labour_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rates" ADD CONSTRAINT "employee_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rates" ADD CONSTRAINT "employee_rates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labour_time_entries" ADD CONSTRAINT "labour_time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labour_time_entries" ADD CONSTRAINT "labour_time_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labour_time_entries" ADD CONSTRAINT "labour_time_entries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labour_settings" ADD CONSTRAINT "labour_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labour_settings" ADD CONSTRAINT "labour_settings_default_labour_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("default_labour_cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labour_settings" ADD CONSTRAINT "labour_settings_default_variance_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("default_variance_cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labour_settings" ADD CONSTRAINT "labour_settings_overhead_job_id_jobs_id_fk" FOREIGN KEY ("overhead_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "employees_select_within_tenant" ON "employees" AS PERMISSIVE FOR SELECT TO "app_user" USING ("employees"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "employees_insert_within_tenant" ON "employees" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("employees"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "employees_update_within_tenant" ON "employees" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("employees"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("employees"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "employees_delete_within_tenant" ON "employees" AS PERMISSIVE FOR DELETE TO "app_user" USING ("employees"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "employee_rates_select_within_tenant" ON "employee_rates" AS PERMISSIVE FOR SELECT TO "app_user" USING ("employee_rates"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "employee_rates_insert_within_tenant" ON "employee_rates" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("employee_rates"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "employee_rates_update_within_tenant" ON "employee_rates" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("employee_rates"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("employee_rates"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "employee_rates_delete_within_tenant" ON "employee_rates" AS PERMISSIVE FOR DELETE TO "app_user" USING ("employee_rates"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "labour_time_entries_select_within_tenant" ON "labour_time_entries" AS PERMISSIVE FOR SELECT TO "app_user" USING ("labour_time_entries"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "labour_time_entries_insert_within_tenant" ON "labour_time_entries" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("labour_time_entries"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "labour_time_entries_update_within_tenant" ON "labour_time_entries" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("labour_time_entries"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("labour_time_entries"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "labour_time_entries_delete_within_tenant" ON "labour_time_entries" AS PERMISSIVE FOR DELETE TO "app_user" USING ("labour_time_entries"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "labour_settings_select_within_tenant" ON "labour_settings" AS PERMISSIVE FOR SELECT TO "app_user" USING ("labour_settings"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "labour_settings_insert_within_tenant" ON "labour_settings" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("labour_settings"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "labour_settings_update_within_tenant" ON "labour_settings" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("labour_settings"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("labour_settings"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "labour_settings_delete_within_tenant" ON "labour_settings" AS PERMISSIVE FOR DELETE TO "app_user" USING ("labour_settings"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);