import { describe, expect, it } from "vitest";
import { ApiError } from "@monadeo.com/grimoire-core";
import { describeError } from "./output.js";

describe("describeError", () => {
  it("names the status and the proxy's reason instead of printing its HTML page", () => {
    const page =
      '<!DOCTYPE html><html><head><title>Error</title></head><body><script>window.POMERIUM_DATA = {"page":"Error","status":"503","statusText":"upstream_reset_before_response_started{delayed_connect_error:_Connection_refused}"};</script></body></html>';
    expect(describeError(new ApiError(503, "error", page))).toBe(
      "error: the API is unreachable — the proxy answered HTTP 503 (upstream_reset_before_response_started{delayed_connect_error:_Connection_refused})",
    );
  });

  it("keeps the API's own error text", () => {
    expect(describeError(new ApiError(401, "unauthorized", "unknown or revoked machine token"))).toBe(
      "error: unauthorized — unknown or revoked machine token",
    );
    expect(describeError(new ApiError(404, "not_found", { detail: "job not found" }))).toBe(
      'error: not_found — {"detail":"job not found"}',
    );
  });
});
