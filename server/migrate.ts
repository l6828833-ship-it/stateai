import "dotenv/config";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run database migrations");
}

const client = postgres(databaseUrl, { max: 1, prepare: false });
const db = drizzle(client);
const migrationsFolder = fileURLToPath(
  new URL("../drizzle", import.meta.url)
);

try {
  console.log("[Database] Applying pending migrations...");
  await migrate(db, {
    migrationsFolder,
    migrationsSchema: "drizzle",
    migrationsTable: "__drizzle_migrations",
  });
  console.log("[Database] Migrations are up to date");
} finally {
  await client.end();
}
