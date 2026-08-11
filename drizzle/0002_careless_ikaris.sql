CREATE TYPE "public"."document_extraction_status" AS ENUM('pending', 'succeeded', 'failed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."document_source" AS ENUM('email', 'manual_upload');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('open', 'partially_invoiced', 'closed');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text,
	"received_via" "document_source" NOT NULL,
	"extraction_status" "document_extraction_status" DEFAULT 'pending' NOT NULL,
	"extracted_vendor_name" text,
	"extracted_po_number" text,
	"extracted_amount" numeric(14, 2),
	"extracted_invoice_date" date,
	"extracted_confidence" numeric(4, 3),
	"raw_extraction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"po_number" text NOT NULL,
	"normalized_po_number" text NOT NULL,
	"vendor_name" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "purchase_order_status" DEFAULT 'open' NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_tenant_normalized_po_unique" UNIQUE("tenant_id","normalized_po_number")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "documents_select_within_tenant" ON "documents" AS PERMISSIVE FOR SELECT TO "app_user" USING ("documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "documents_insert_within_tenant" ON "documents" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "documents_update_within_tenant" ON "documents" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "documents_delete_within_tenant" ON "documents" AS PERMISSIVE FOR DELETE TO "app_user" USING ("documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "purchase_orders_select_within_tenant" ON "purchase_orders" AS PERMISSIVE FOR SELECT TO "app_user" USING ("purchase_orders"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "purchase_orders_insert_within_tenant" ON "purchase_orders" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("purchase_orders"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "purchase_orders_update_within_tenant" ON "purchase_orders" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("purchase_orders"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("purchase_orders"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "purchase_orders_delete_within_tenant" ON "purchase_orders" AS PERMISSIVE FOR DELETE TO "app_user" USING ("purchase_orders"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);