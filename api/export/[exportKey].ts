import { methodAllowed, sendCsv, sendText } from "../../src/appServer/apiResponse";
import { rowsToCsv } from "../../src/appServer/csv";
import { getExportRows } from "../../src/appServer/qualityData";

function exportKeyFromRequest(request: any): string | null {
  const value = request.query?.exportKey;
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== "string" || !raw.endsWith(".csv")) {
    return null;
  }

  return raw.slice(0, -".csv".length);
}

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response)) {
    return;
  }

  try {
    const exportKey = exportKeyFromRequest(request);
    if (!exportKey) {
      sendText(response, 400, "Missing CSV export key.");
      return;
    }

    const exported = await getExportRows(exportKey);
    sendCsv(response, 200, rowsToCsv(exported.rows), exported.fileName);
  } catch (error) {
    sendText(response, 400, error instanceof Error ? error.message : String(error));
  }
}
