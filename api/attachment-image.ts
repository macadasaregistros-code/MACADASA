import { getAttachmentImage } from "../src/appServer/attachmentImage";
import { methodAllowed, sendText } from "../src/appServer/apiResponse";

function attachmentIdFromRequest(request: any): string | null {
  if (typeof request.query?.id === "string") {
    return request.query.id;
  }

  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  return requestUrl.searchParams.get("id");
}

export default async function handler(request: any, response: any): Promise<void> {
  if (!methodAllowed(request, response)) {
    return;
  }

  const attachmentId = attachmentIdFromRequest(request);
  if (!attachmentId) {
    sendText(response, 400, "Missing attachment id.");
    return;
  }

  try {
    const image = await getAttachmentImage(attachmentId);
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.setHeader("Content-Type", image.contentType);
    response.status(200).send(image.body);
  } catch (error) {
    sendText(response, 404, error instanceof Error ? error.message : String(error));
  }
}
