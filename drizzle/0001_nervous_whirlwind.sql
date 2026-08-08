CREATE TYPE "public"."cost_type" AS ENUM('materials', 'labour', 'subcontractor', 'plant');--> statement-breakpoint
CREATE TABLE "cost_type_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_type" "cost_type" NOT NULL,
	"xero_account_code" text NOT NULL,
	"xero_account_id" text,
	"is_wayleave_managed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_type_accounts_tenant_type_unique" UNIQUE("tenant_id","cost_type")
);
--> statement-breakpoint
ALTER TABLE "cost_type_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD COLUMN "cost_type" "cost_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_type_accounts" ADD CONSTRAINT "cost_type_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "cost_type_accounts_select_within_tenant" ON "cost_type_accounts" AS PERMISSIVE FOR SELECT TO "app_user" USING ("cost_type_accounts"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_type_accounts_insert_within_tenant" ON "cost_type_accounts" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("cost_type_accounts"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_type_accounts_update_within_tenant" ON "cost_type_accounts" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("cost_type_accounts"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("cost_type_accounts"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cost_type_accounts_delete_within_tenant" ON "cost_type_accounts" AS PERMISSIVE FOR DELETE TO "app_user" USING ("cost_type_accounts"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);