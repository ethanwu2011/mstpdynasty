import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { isTransientError } from "@/lib/roast/llm";

const apiError = (status: number) => Anthropic.APIError.generate(status, { error: { type: "x", message: "m" } }, "m", new Headers());

describe("which writer errors are worth retrying later", () => {
  it("rate limits, overloads, server errors and dropped connections are transient", () => {
    for (const status of [408, 409, 429, 500, 502, 503, 529]) expect(isTransientError(apiError(status)), String(status)).toBe(true);
    expect(isTransientError(new Anthropic.APIConnectionError({ message: "reset" }))).toBe(true);
    expect(isTransientError(new Anthropic.APIConnectionTimeoutError())).toBe(true);
  });

  it("a bad request, a bad key, no permission or a retired model is not: the item falls back and counts", () => {
    for (const status of [400, 401, 403, 404, 413, 422]) expect(isTransientError(apiError(status)), String(status)).toBe(false);
  });
});
