import { methodAllowed, sendJson } from "../src/appServer/apiResponse";
import { getDashboardData } from "../src/appServer/dashboardData";

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response)) {
    return;
  }

  try {
    const data = await getDashboardData();
    sendJson(response, 200, data);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
