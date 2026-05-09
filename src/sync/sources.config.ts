import { z } from "zod";
import generatedSources from "./sources.generated.json";

export const sheetColumnTypeSchema = z.enum([
  "text",
  "string",
  "number",
  "date",
  "datetime",
  "boolean",
  "json"
]);

export type SheetColumnType = z.infer<typeof sheetColumnTypeSchema>;

export const syncSourceConfigSchema = z.object({
  sourceName: z.string().min(1),
  appName: z.string().min(1),
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
  targetTable: z.literal("raw_appsheet_records").default("raw_appsheet_records"),
  primaryKeyColumn: z.string().min(1).optional(),
  updatedAtColumn: z.string().min(1).optional(),
  headerRow: z.number().int().positive().default(1),
  requiredColumns: z.array(z.string().min(1)).default([]),
  attachmentColumns: z.array(z.string().min(1)).default([]),
  columnMap: z.record(z.string().min(1)).default({}),
  typeMap: z.record(sheetColumnTypeSchema).default({}),
  isActive: z.boolean().default(true)
});

export type SyncSourceConfig = z.infer<typeof syncSourceConfigSchema>;

export const syncSources = z.array(syncSourceConfigSchema).parse(generatedSources);

export function getSyncSourceByName(sourceName: string): SyncSourceConfig | undefined {
  return syncSources.find((source) => source.sourceName === sourceName);
}
