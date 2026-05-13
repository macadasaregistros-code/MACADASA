import { methodAllowed, sendHtml, sendJson, sendText } from "../src/appServer/apiResponse";
import { getRawValidationSources } from "../src/appServer/rawValidationData";
import { renderRawValidationSources } from "../src/appServer/renderValidation";
import { checkValidationAuth } from "../src/appServer/validationAuth";

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

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response) || !requireAuth(request, response)) {
    return;
  }

  try {
    const sources = await getRawValidationSources();
    sendHtml(response, 200, renderRawValidationSources(sources));
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
