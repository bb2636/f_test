import { defineConfig } from "drizzle-kit";

const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';

const databaseUrl = isProduction
  ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL)
  : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);

if (!databaseUrl) {
  throw new Error(
    isProduction
      ? "PROD_DATABASE_URL (or DATABASE_URL) must be set for production."
      : "DEV_DATABASE_URL (or DATABASE_URL) must be set for development."
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
