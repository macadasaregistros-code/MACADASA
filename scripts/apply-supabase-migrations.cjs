const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
require("dotenv").config();

const migrationsDir = path.resolve(__dirname, "../supabase/migrations");
const connectionString =
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!connectionString || !connectionString.trim()) {
  console.error(
    "Missing SUPABASE_DB_URL. Add the Postgres connection string from Supabase Dashboard > Connect to .env."
  );
  process.exit(1);
}

function getMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      name: file,
      path: path.join(migrationsDir, file),
      sql: fs.readFileSync(path.join(migrationsDir, file), "utf8")
    }));
}

function safeDecodeUriComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildPgClientConfig(rawConnectionString) {
  const ssl = rawConnectionString.includes("sslmode=disable")
    ? false
    : {
        rejectUnauthorized: false
      };

  try {
    new URL(rawConnectionString);
    return {
      connectionString: rawConnectionString,
      ssl
    };
  } catch {
    const match = rawConnectionString.match(/^(postgres(?:ql)?:\/\/)(.*)@([^/?#]+)(\/[^?#]*)/);

    if (!match) {
      throw new Error(
        "SUPABASE_DB_URL is not a valid Postgres URI. Copy the URI connection string from Supabase Dashboard > Connect."
      );
    }

    const userInfo = match[2];
    const hostPort = match[3];
    const database = match[4].replace(/^\//, "") || "postgres";
    const separatorIndex = userInfo.indexOf(":");

    if (separatorIndex < 0) {
      throw new Error("SUPABASE_DB_URL is missing username/password in the URI.");
    }

    const user = safeDecodeUriComponent(userInfo.slice(0, separatorIndex));
    const password = safeDecodeUriComponent(userInfo.slice(separatorIndex + 1));
    const [host, portRaw] = hostPort.split(":");
    const port = portRaw ? Number(portRaw) : 5432;

    if (!host || !Number.isInteger(port)) {
      throw new Error("SUPABASE_DB_URL has an invalid host or port.");
    }

    return {
      user,
      password,
      host,
      port,
      database,
      ssl
    };
  }
}

async function ensureMigrationTable(client) {
  await client.query(`
    create table if not exists public.app_schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query("select version from public.app_schema_migrations;");
  return new Set(result.rows.map((row) => row.version));
}

async function applyMigration(client, migration) {
  console.log(`Applying ${migration.name}...`);
  await client.query("begin;");

  try {
    await client.query(migration.sql);
    await client.query(
      "insert into public.app_schema_migrations (version) values ($1) on conflict (version) do nothing;",
      [migration.name]
    );
    await client.query("commit;");
  } catch (error) {
    await client.query("rollback;");
    throw error;
  }
}

async function main() {
  const client = new Client(buildPgClientConfig(connectionString));

  await client.connect();

  try {
    await ensureMigrationTable(client);
    const applied = await getAppliedMigrations(client);
    const migrations = getMigrationFiles();

    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        console.log(`Skipping ${migration.name}; already applied.`);
        continue;
      }

      await applyMigration(client, migration);
    }

    console.log("Migrations finished.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
