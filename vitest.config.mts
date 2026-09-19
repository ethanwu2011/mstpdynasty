import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests never touch the network: every Sleeper / FantasyCalc / ESPN call replays fixtures/.
    // Paid / external services are blanked so a key in your shell can never be used by a test.
    env: {
      DATA_SOURCE: "fixtures",
      STORE_BACKEND: "memory",
      TZ: "America/New_York",
      ANTHROPIC_API_KEY: "",
      RESEND_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      IMAGE_PROVIDER: "none",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      LEAGUE_WEEK_OVERRIDE: "",
    },
    testTimeout: 30_000,
  },
});
