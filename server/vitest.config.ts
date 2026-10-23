import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The tests run the Worker in workerd with a fresh local D1 database,
// migrated by test/setup.ts.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ADMIN_SECRET: "test admin secret", GROUP_NAME: "Test Group" },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
