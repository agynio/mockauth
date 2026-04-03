import { execFileSync } from "node:child_process";

import { Pool } from "pg";

const log = (message: string) => {
  console.log(`[migrate] ${message}`);
};

const logError = (message: string) => {
  console.error(`[migrate] ${message}`);
};

const databaseUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  logError("DATABASE_DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const prismaResolveCommand = (migrationName: string) => {
  log(`Resolving failed migration ${migrationName} as rolled back.`);
  execFileSync("npx", ["prisma", "migrate", "resolve", "--rolled-back", migrationName], { stdio: "inherit" });
};

const prismaDeployCommand = () => {
  log("Running prisma migrate deploy.");
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
};

const resolveFailedMigrations = async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    log("Checking for _prisma_migrations table.");
    const tableCheck = await pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations') AS \"exists\"",
    );
    const hasMigrationsTable = tableCheck.rows[0]?.exists ?? false;
    if (!hasMigrationsTable) {
      log("No _prisma_migrations table found; skipping resolve step.");
      return;
    }

    log("Looking for failed migrations.");
    const failedMigrations = await pool.query<{ migration_name: string }>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at ASC",
    );

    if (failedMigrations.rows.length === 0) {
      log("No failed migrations detected.");
      return;
    }

    for (const { migration_name: migrationName } of failedMigrations.rows) {
      prismaResolveCommand(migrationName);
    }
  } finally {
    await pool.end();
    log("Disconnected from database.");
  }
};

async function main() {
  await resolveFailedMigrations();
  prismaDeployCommand();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  logError(message);
  const exitCode =
    typeof (error as { status?: number }).status === "number" ? (error as { status?: number }).status : 1;
  process.exit(exitCode);
});
