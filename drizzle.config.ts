import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.MIGRATIONS_DATABASE_URL) {
  throw new Error("MIGRATIONS_DATABASE_URL is not set");
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MIGRATIONS_DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
