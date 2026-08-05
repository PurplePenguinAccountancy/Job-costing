import { pgRole } from "drizzle-orm/pg-core";

/**
 * The only role the application ever connects as. Table owners and
 * superusers bypass RLS entirely, so policies are worthless unless every
 * query runs as this role. Deliberately least-privilege: no CREATEROLE, no
 * CREATEDB — this role must never be able to provision or alter other
 * roles. Migrations run as the postgres superuser; LOGIN/PASSWORD and table
 * GRANTs are applied by a separate post-migration setup step (not baked
 * into version-controlled migration SQL, since that would commit a
 * password), see scripts/db-setup.ts.
 */
export const appUser = pgRole("app_user", {
  createRole: false,
  createDb: false,
  inherit: true,
});
