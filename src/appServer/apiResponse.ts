type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  send(body: string): void;
  json(body: unknown): void;
};

export function sendJson(response: ResponseLike, statusCode: number, body: unknown): void {
  response.setHeader("Cache-Control", "no-store");
  response.status(statusCode).json(body);
}

export function sendHtml(response: ResponseLike, statusCode: number, body: string): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.status(statusCode).send(body);
}

export function sendCsv(
  response: ResponseLike,
  statusCode: number,
  body: string,
  fileName: string
): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.status(statusCode).send(body);
}

export function sendText(response: ResponseLike, statusCode: number, body: string): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.status(statusCode).send(body);
}

export function methodAllowed(request: { method?: string }, response: ResponseLike): boolean {
  if (request.method === "GET") {
    return true;
  }

  sendText(response, 405, "Method not allowed");
  return false;
}
