import { methodAllowed, sendJson } from "../src/appServer/apiResponse";

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response)) {
    return;
  }

  sendJson(response, 200, { ok: true, timestamp: new Date().toISOString() });
}
