import { config } from "dotenv";
import { getSupabaseAdminClient } from "../src/lib/supabaseAdmin";
import { transformMasters, type TransformMastersSummary } from "../src/transform/masters";

config();

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  only?: Set<string>;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--only") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --only.");
      }
      options.only = new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }

    if (arg?.startsWith("--only=")) {
      options.only = new Set(
        arg
          .slice("--only=".length)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      );
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage:
  npm run transform:masters
  npm run transform:masters:dry
  npm run transform:masters -- --dry-run
  npm run transform:masters -- --only items
  npm run transform:masters -- --only categories,items,third_parties

Stages:
  categories
  sales_channels
  locations
  cost_centers
  warehouses
  poultry_houses
  items
  production_lots
  users
  third_parties
  third_party_roles
  stores
  third_party_details
  transfer_types
  attachments
`);
}

async function startTransformRun(dryRun: boolean): Promise<string | null> {
  if (dryRun) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("transform_runs")
    .insert({
      transform_name: "masters",
      mode: "live",
      status: "running",
      metadata: {
        started_by: "scripts/transform-raw-to-management.ts"
      }
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not create transform_run: ${error.message}`);
  }

  return data.id as string;
}

async function finishTransformRun(
  runId: string | null,
  status: "success" | "partial_success" | "failed",
  summary: TransformMastersSummary | null,
  errorMessage?: string
): Promise<void> {
  if (!runId) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("transform_runs")
    .update({
      finished_at: new Date().toISOString(),
      status,
      records_processed: summary?.totals.processed ?? 0,
      records_inserted: summary?.totals.inserted ?? 0,
      records_updated: summary?.totals.updated ?? 0,
      records_failed: summary?.totals.errors ?? (status === "failed" ? 1 : 0),
      error_message: errorMessage,
      metadata: {
        raw_records_read: summary?.rawRecordsRead ?? 0,
        dry_run: summary?.dryRun ?? false,
        unchanged: summary?.totals.unchanged ?? 0,
        references_upserted: summary?.totals.referencesUpserted ?? 0,
        stages: summary?.stages ?? []
      }
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`Could not finish transform_run ${runId}: ${error.message}`);
  }
}

function printSummary(summary: TransformMastersSummary): void {
  console.log("\nTransform masters summary");
  console.log(`Mode: ${summary.dryRun ? "dry-run" : "live"}`);
  console.log(`Raw records read: ${summary.rawRecordsRead}`);
  console.log(`Processed: ${summary.totals.processed}`);
  console.log(`Inserted: ${summary.totals.inserted}`);
  console.log(`Updated: ${summary.totals.updated}`);
  console.log(`Unchanged: ${summary.totals.unchanged}`);
  console.log(`External references: ${summary.totals.referencesUpserted}`);
  console.log(`Errors: ${summary.totals.errors}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const supabase = getSupabaseAdminClient();
  const runId = await startTransformRun(options.dryRun);
  let summary: TransformMastersSummary | null = null;

  try {
    console.log(options.dryRun ? "Starting masters transform in dry-run mode." : "Starting masters transform.");
    if (options.only && options.only.size > 0) {
      console.log(`Stages filter: ${[...options.only].join(", ")}`);
    }

    summary = await transformMasters(supabase, {
      dryRun: options.dryRun,
      only: options.only
    });

    const status = summary.totals.errors > 0 ? "partial_success" : "success";
    await finishTransformRun(runId, status, summary);
    printSummary(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTransformRun(runId, "failed", summary, message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
