import { methodAllowed, sendHtml } from "../src/appServer/apiResponse";
import { getDashboardData } from "../src/appServer/dashboardData";
import { renderDashboard, renderError } from "../src/appServer/renderDashboard";

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response)) {
    return;
  }

  try {
    const data = await getDashboardData();
    sendHtml(response, 200, renderDashboard(data));
  } catch (error) {
    sendHtml(response, 500, renderError(error));
  }
}
