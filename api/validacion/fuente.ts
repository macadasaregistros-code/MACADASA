import { methodAllowed, sendHtml, sendJson, sendText } from "../../src/appServer/apiResponse";
import { getRawValidationRecords } from "../../src/appServer/rawValidationData";
import { renderRawValidationRecords } from "../../src/appServer/renderValidation";
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
    const data = await getRawValidationRecords({
      page: queryValue(request.query?.page),
      pageSize: queryValue(request.query?.pageSize),
      query: queryValue(request.query?.q),
      sourceName: String(queryValue(request.query?.source) ?? "")
    });

    sendHtml(response, 200, renderRawValidationRecords(data));
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}
