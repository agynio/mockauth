import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

const testEnvPath = path.resolve(process.cwd(), ".env.test");
if (existsSync(testEnvPath)) {
  config({ path: testEnvPath });
} else {
  config();
}

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
