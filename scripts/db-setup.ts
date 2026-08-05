import "dotenv/config";
import postgres from "postgres";

/**
 * Applies the parts of the app_user role that must never live in
 * version-controlled migration SQL: LOGIN + PASSWORD, and table/sequence
 * GRANTs. Run once after `db:migrate` (and again after any migration that
 * adds a new table, since GRANTs don't apply retroactively to new tables).
 *
 * RLS policies alone do not grant access — Postgres requires both the
 * table-level GRANT *and* a passing RLS policy. This script provides the
 * former; schema/*.ts provides the latter.
 */
async function main() {
  const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is not set");
  if (!appUrl) throw new Error("DATABASE_URL is not set");

  const appUserPassword = new URL(appUrl).password;
  if (!appUserPassword) {
    throw new Error("DATABASE_URL must include the app_user password");
  }

  const sql = postgres(migrationsUrl);
  try {
    await sql.unsafe(
      `ALTER ROLE app_user WITH LOGIN PASSWORD '${appUserPassword.replace(/'/g, "''")}';`,
    );
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO app_user;`);
    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;`,
    );
    await sql.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;`,
    );
    console.log("app_user role configured: LOGIN enabled, table grants applied.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
