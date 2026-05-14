import { methodAllowed, sendHtml } from "../src/appServer/apiResponse";
import { getDashboardData } from "../src/appServer/dashboardData";
import { renderDashboard, renderError, resolveDashboardModule } from "../src/appServer/renderDashboard";

function moduleFromRequest(request: any): string | null {
  if (typeof request.query?.modulo === "string") {
    return request.query.modulo;
  }

  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  return requestUrl.searchParams.get("modulo");
}

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response)) {
    return;
  }

  try {
    const data = await getDashboardData();
    sendHtml(response, 200, renderDashboard(data, resolveDashboardModule(moduleFromRequest(request))));
  } catch (error) {
    sendHtml(response, 500, renderError(error));
  }
}
