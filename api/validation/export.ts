import { methodAllowed, sendCsv, sendJson, sendText } from "../../src/appServer/apiResponse";
import { rowsToCsvWithColumns } from "../../src/appServer/csv";
import { getRawValidationExport } from "../../src/appServer/rawValidationData";
import { checkValidationAuth } from "../../src/appServer/validationAuth";

function requireAuth(request: any, response: any): boolean {
  const result = checkValidationAuth(request.headers);

  if (result.ok) {
    return true;
  }

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }

  sendText(response, result.statusCode, result.body);
  return false;
}

function queryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response) || !requireAuth(request, response)) {
    return;
  }

  try {
    const exported = await getRawValidationExport({
      query: queryValue(request.query?.q),
      sourceName: String(queryValue(request.query?.source) ?? "")
    });

    sendCsv(
      response,
      200,
      rowsToCsvWithColumns(exported.rows, exported.columns),
      exported.fileName
    );
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}
