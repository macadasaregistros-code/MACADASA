import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { rowsToCsv } from "../src/appServer/csv";
import { getDashboardData } from "../src/appServer/dashboardData";
import { getExportRows, getQualityData } from "../src/appServer/qualityData";
import { renderDashboard, renderError } from "../src/appServer/renderDashboard";
import { renderQuality } from "../src/appServer/renderQuality";

config();

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "127.0.0.1";
const publicDir = path.resolve(process.cwd(), "public");

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function send(response: ServerResponse, statusCode: number, body: string | Buffer, contentType: string): void {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType
  });
  response.end(body);
}

function sendDownload(
  response: ServerResponse,
  statusCode: number,
  body: string | Buffer,
  contentType: string,
  fileName: string
): void {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Content-Type": contentType
  });
  response.end(body);
}

function notFound(response: ServerResponse): void {
  send(response, 404, "Not found", "text/plain; charset=utf-8");
}

function resolvePublicPath(urlPath: string): string | null {
  const normalizedPath = urlPath === "/manifest.webmanifest" || urlPath === "/sw.js" || urlPath === "/icon.svg"
    ? urlPath
    : urlPath.startsWith("/assets/")
      ? urlPath
      : "";

  if (!normalizedPath) {
    return null;
  }

  const filePath = path.resolve(publicDir, `.${normalizedPath}`);
  return filePath.startsWith(publicDir) ? filePath : null;
}

async function serveStatic(urlPath: string, response: ServerResponse): Promise<boolean> {
  const filePath = resolvePublicPath(urlPath);

  if (!filePath) {
    return false;
  }

  try {
    const file = await readFile(filePath);
    send(response, 200, file, mimeTypes[path.extname(filePath)] ?? "application/octet-stream");
  } catch {
    notFound(response);
  }

  return true;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  const urlPath = requestUrl.pathname;

  if (request.method !== "GET") {
    send(response, 405, "Method not allowed", "text/plain; charset=utf-8");
    return;
  }

  if (await serveStatic(urlPath, response)) {
    return;
  }

  if (urlPath === "/health") {
    send(response, 200, JSON.stringify({ ok: true, timestamp: new Date().toISOString() }), "application/json; charset=utf-8");
    return;
  }

  if (urlPath === "/api/dashboard-data") {
    try {
      const data = await getDashboardData();
      send(response, 200, JSON.stringify(data, null, 2), "application/json; charset=utf-8");
    } catch (error) {
      send(
        response,
        500,
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        "application/json; charset=utf-8"
      );
    }
    return;
  }

  if (urlPath === "/api/quality-data") {
    try {
      const data = await getQualityData();
      send(response, 200, JSON.stringify(data, null, 2), "application/json; charset=utf-8");
    } catch (error) {
      send(
        response,
        500,
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        "application/json; charset=utf-8"
      );
    }
    return;
  }

  if (urlPath.startsWith("/api/export/") && urlPath.endsWith(".csv")) {
    try {
      const exportKey = path.basename(urlPath, ".csv");
      const exported = await getExportRows(exportKey);
      sendDownload(
        response,
        200,
        rowsToCsv(exported.rows),
        "text/csv; charset=utf-8",
        exported.fileName
      );
    } catch (error) {
      send(
        response,
        400,
        error instanceof Error ? error.message : String(error),
        "text/plain; charset=utf-8"
      );
    }
    return;
  }

  if (urlPath === "/" || urlPath === "/index.html") {
    try {
      const data = await getDashboardData();
      send(response, 200, renderDashboard(data), "text/html; charset=utf-8");
    } catch (error) {
      send(response, 500, renderError(error), "text/html; charset=utf-8");
    }
    return;
  }

  if (urlPath === "/calidad") {
    try {
      const data = await getQualityData();
      send(response, 200, renderQuality(data), "text/html; charset=utf-8");
    } catch (error) {
      send(response, 500, renderError(error), "text/html; charset=utf-8");
    }
    return;
  }

  notFound(response);
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    send(
      response,
      500,
      error instanceof Error ? error.message : String(error),
      "text/plain; charset=utf-8"
    );
  });
});

server.listen(port, host, () => {
  console.log(`MACADASA dashboard running at http://${host}:${port}`);
});
