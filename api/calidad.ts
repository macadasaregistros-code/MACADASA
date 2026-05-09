import { methodAllowed, sendHtml } from "../src/appServer/apiResponse";
import { getQualityData } from "../src/appServer/qualityData";
import { renderError } from "../src/appServer/renderDashboard";
import { renderQuality } from "../src/appServer/renderQuality";

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response)) {
    return;
  }

  try {
    const data = await getQualityData();
    sendHtml(response, 200, renderQuality(data));
  } catch (error) {
    sendHtml(response, 500, renderError(error));
  }
}
