import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Tests use a separate database so they never touch real data.
    env: { MYSQL_DATABASE: "videogenerator_test", NODE_ENV: "test" },
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    // The default worker pool intermittently loads two copies of vitest on this Windows setup ("Cannot read
    // properties of undefined (reading 'config')" / "failed to find the runner"). A VM context per file avoids it.
    pool: "vmForks",
  },
});
