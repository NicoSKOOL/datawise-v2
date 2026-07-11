// Shared route helpers: the success/failure envelope, JSON body parsing,
// and the single error->response mapper every handler funnels through.
import type { ApiSuccess, ApiFailure } from '../contracts/api';
import { BlueprintApiError, NotFoundError, httpStatusFor } from '../domain/api-errors';
import { BlueprintValidationError } from '../domain/errors';

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function successEnvelope<T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> {
  return { requestId: crypto.randomUUID(), data, ...(meta ? { meta } : {}) };
}

export function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(successEnvelope(data)), { status, headers: JSON_HEADERS });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

// Reads and parses a JSON request body. An empty body parses to {} so
// routes with an optional/ignored body (estimates, retry) don't have to
// special-case "no body sent"; a body that fails to parse is a client error.
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BlueprintApiError('invalid_input', 'Malformed JSON request body');
  }
}

function fieldErrorsFromValidation(err: BlueprintValidationError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const fe of err.fieldErrors) {
    (fieldErrors[fe.path] ??= []).push(fe.message);
  }
  return fieldErrors;
}

// Single error->response mapper for every route handler. NotFoundError
// returns the plain invisible 404 body (matching router.ts's convention for
// unknown paths) so missing, cross-tenant, and soft-deleted resources are
// indistinguishable to the caller. Everything else returns the ApiFailure
// envelope with a fresh requestId.
export function failFrom(err: unknown): Response {
  if (err instanceof NotFoundError) {
    return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: JSON_HEADERS });
  }

  const requestId = crypto.randomUUID();

  if (err instanceof BlueprintValidationError) {
    const body: ApiFailure = {
      requestId,
      error: {
        code: 'invalid_input',
        message: err.message,
        retryable: false,
        fieldErrors: fieldErrorsFromValidation(err),
      },
    };
    return new Response(JSON.stringify(body), { status: 400, headers: JSON_HEADERS });
  }

  if (err instanceof BlueprintApiError) {
    const body: ApiFailure = {
      requestId,
      error: {
        code: err.code,
        message: err.message,
        retryable: err.options?.retryable ?? false,
        ...(err.options?.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.options.retryAfterSeconds } : {}),
        ...(err.options?.fieldErrors ? { fieldErrors: err.options.fieldErrors } : {}),
        ...(err.options?.stage ? { stage: err.options.stage } : {}),
      },
    };
    return new Response(JSON.stringify(body), { status: httpStatusFor(err.code), headers: JSON_HEADERS });
  }

  // Unknown/unexpected error: never leak internals (stack traces, driver
  // error text) to the client.
  const body: ApiFailure = {
    requestId,
    error: { code: 'internal_error', message: 'Unexpected error', retryable: false },
  };
  return new Response(JSON.stringify(body), { status: 500, headers: JSON_HEADERS });
}
