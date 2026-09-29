import { createRequire } from "node:module";

// Read at runtime so the version is maintained in package.json only; the file
// ships next to dist/ in every install, including the Docker image.
const packageJson = createRequire(import.meta.url)("../package.json") as { version: string };

export const APP_VERSION = packageJson.version;
