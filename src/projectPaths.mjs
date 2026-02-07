import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(THIS_DIR, "..");
export const EXTRACTED_DIR = path.join(PROJECT_ROOT, "Extracted Articles");
