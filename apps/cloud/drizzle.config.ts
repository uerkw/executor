import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/services/schema.ts", "../../packages/core/storage-postgres/src/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
});
