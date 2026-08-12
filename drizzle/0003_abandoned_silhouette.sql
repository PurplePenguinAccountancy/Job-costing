CREATE TYPE "public"."allocation_source_context" AS ENUM('subcontractor_invoice', 'direct_payment', 'material_stock');--> statement-breakpoint
CREATE TYPE "public"."allocation_type" AS ENUM('percentage', 'fixed_amount', 'time_based');--> statement-breakpoint
CREATE TABLE "allocation_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_context" "allocation_source_context" NOT NULL,
	"default_allocation_type" "allocation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_defaults_tenant_context_unique" UNIQUE("tenant_id","source_context")
);
--> statement-breakpoint
ALTER TABLE "allocation_defaults" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "allocation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_context" "allocation_source_context" NOT NULL,
	"source_line_reference" text NOT NULL,
	"document_id" uuid,
	"job_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"allocation_type" "allocation_type" NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"expected_total_amount" numeric(14, 2) NOT NULL,
	"expected_total_hours" numeric(10, 2),
	"resulting_cost_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocation_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocation_defaults" ADD CONSTRAINT "allocation_defaults_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_lines" ADD CONSTRAINT "allocation_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_lines" ADD CONSTRAINT "allocation_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_lines" ADD CONSTRAINT "allocation_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_lines" ADD CONSTRAINT "allocation_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_lines" ADD CONSTRAINT "allocation_lines_resulting_cost_transaction_id_cost_transactions_id_fk" FOREIGN KEY ("resulting_cost_transaction_id") REFERENCES "public"."cost_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "allocation_defaults_select_within_tenant" ON "allocation_defaults" AS PERMISSIVE FOR SELECT TO "app_user" USING ("allocation_defaults"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "allocation_defaults_insert_within_tenant" ON "allocation_defaults" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("allocation_defaults"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "allocation_defaults_update_within_tenant" ON "allocation_defaults" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("allocation_defaults"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("allocation_defaults"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "allocation_defaults_delete_within_tenant" ON "allocation_defaults" AS PERMISSIVE FOR DELETE TO "app_user" USING ("allocation_defaults"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "allocation_lines_select_within_tenant" ON "allocation_lines" AS PERMISSIVE FOR SELECT TO "app_user" USING ("allocation_lines"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "allocation_lines_insert_within_tenant" ON "allocation_lines" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("allocation_lines"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "allocation_lines_update_within_tenant" ON "allocation_lines" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("allocation_lines"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("allocation_lines"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "allocation_lines_delete_within_tenant" ON "allocation_lines" AS PERMISSIVE FOR DELETE TO "app_user" USING ("allocation_lines"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);