CREATE TYPE "public"."membership_role" AS ENUM('editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."budget_source" AS ENUM('manual', 'quote_conversion', 'import');--> statement-breakpoint
CREATE TYPE "public"."cost_transaction_approval_status" AS ENUM('draft', 'pending_approval', 'approved', 'posted');--> statement-breakpoint
CREATE TYPE "public"."cost_transaction_source_type" AS ENUM('bill', 'bank_transaction', 'manual_journal', 'subcontractor_invoice', 'labour_allocation', 'other');--> statement-breakpoint
CREATE TYPE "public"."cost_transaction_type" AS ENUM('committed', 'actual');--> statement-breakpoint
CREATE ROLE "app_user";--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_tenant_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cost_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_codes_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "cost_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"source" "budget_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cost_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"type" "cost_transaction_type" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"approval_status" "cost_transaction_approval_status" DEFAULT 'draft' NOT NULL,
	"source_type" "cost_transaction_source_type" NOT NULL,
	"source_reference" text,
	"xero_reference" text,
	"description" text,
	"transaction_date" date NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_id_jobs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "memberships_visible_to_self_or_within_tenant" ON "tenant_memberships" AS PERMISSIVE FOR SELECT TO "app_user" USING (
        "tenant_memberships"."user_id" = current_setting('app.current_user_id', true)::uuid
        or "tenant_memberships"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
      );--> statement-breakpoint
CREATE POLICY "memberships_write_within_tenant" ON "tenant_memberships" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("tenant_memberships"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "memberships_update_within_tenant" ON "tenant_memberships" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("tenant_memberships"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("tenant_memberships"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "memberships_delete_within_tenant" ON "tenant_memberships" AS PERMISSIVE FOR DELETE TO "app_user" USING ("tenant_memberships"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "jobs_select_within_tenant" ON "jobs" AS PERMISSIVE FOR SELECT TO "app_user" USING ("jobs"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "jobs_insert_within_tenant" ON "jobs" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("jobs"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "jobs_update_within_tenant" ON "jobs" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("jobs"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("jobs"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "jobs_delete_within_tenant" ON "jobs" AS PERMISSIVE FOR DELETE TO "app_user" USING ("jobs"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_codes_select_within_tenant" ON "cost_codes" AS PERMISSIVE FOR SELECT TO "app_user" USING ("cost_codes"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_codes_insert_within_tenant" ON "cost_codes" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("cost_codes"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_codes_update_within_tenant" ON "cost_codes" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("cost_codes"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("cost_codes"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_codes_delete_within_tenant" ON "cost_codes" AS PERMISSIVE FOR DELETE TO "app_user" USING ("cost_codes"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "budgets_select_within_tenant" ON "budgets" AS PERMISSIVE FOR SELECT TO "app_user" USING ("budgets"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "budgets_insert_within_tenant" ON "budgets" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("budgets"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "budgets_update_within_tenant" ON "budgets" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("budgets"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("budgets"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "budgets_delete_within_tenant" ON "budgets" AS PERMISSIVE FOR DELETE TO "app_user" USING ("budgets"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_transactions_select_within_tenant" ON "cost_transactions" AS PERMISSIVE FOR SELECT TO "app_user" USING ("cost_transactions"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_transactions_insert_within_tenant" ON "cost_transactions" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("cost_transactions"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_transactions_update_within_tenant" ON "cost_transactions" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("cost_transactions"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("cost_transactions"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_transactions_delete_within_tenant" ON "cost_transactions" AS PERMISSIVE FOR DELETE TO "app_user" USING ("cost_transactions"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);