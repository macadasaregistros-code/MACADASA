import { timingSafeEqual } from "node:crypto";

export const VALIDATION_USERNAME = "gerencia";

export type HeaderBag = Record<string, string | string[] | undefined>;

export type ValidationAuthResult =
  | { ok: true }
  | {
      ok: false;
      body: string;
      headers?: Record<string, string>;
      statusCode: number;
    };

function headerValue(headers: HeaderBag | undefined, name: string): string | null {
  if (!headers) {
    return null;
  }

  const value = headers[name] ?? headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function validationPassword(): string | null {
  const password = process.env.MACADASA_VALIDATION_PASSWORD?.trim();
  return password && password.length > 0 ? password : null;
}

export function checkValidationAuth(headers: HeaderBag | undefined): ValidationAuthResult {
  const password = validationPassword();

  if (!password) {
    return {
      ok: false,
      body: "MACADASA_VALIDATION_PASSWORD is not configured in the server environment.",
      statusCode: 503
    };
  }

  const authorization = headerValue(headers, "authorization");

  if (!authorization?.startsWith("Basic ")) {
    return unauthorized();
  }

  const encoded = authorization.slice("Basic ".length).trim();
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex < 0) {
    return unauthorized();
  }

  const username = decoded.slice(0, separatorIndex);
  const providedPassword = decoded.slice(separatorIndex + 1);

  if (!safeEqual(username, VALIDATION_USERNAME) || !safeEqual(providedPassword, password)) {
    return unauthorized();
  }

  return { ok: true };
}

function unauthorized(): ValidationAuthResult {
  return {
    ok: false,
    body: "Authentication required.",
    headers: {
      "WWW-Authenticate": 'Basic realm="MACADASA Validacion", charset="UTF-8"'
    },
    statusCode: 401
  };
}
