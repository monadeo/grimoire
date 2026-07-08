import { ApiError } from "./errors.js";

export const REQUEST_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ApiError(408, "timeout", `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}
