import fs from "node:fs/promises";
import path from "node:path";
import { EXTRACTED_DIR } from "./projectPaths.mjs";

function safeSlug(raw, fallback = "article") {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return s || fallback;
}

export async function saveExtractionResult(result) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const titleSlug = safeSlug(result?.title || "");
  const baseName = `${stamp}__${titleSlug}`;
  const jsonName = `${baseName}.json`;
  const textName = `${baseName}.txt`;
  const textPayload = `${result?.title || ""}\n\n${result?.articleText || ""}\n`;

  const allowBlob =
    String(process.env.ARTICLE_READER_STORAGE || "").trim().toLowerCase() !== "local" &&
    Boolean(process.env.BLOB_READ_WRITE_TOKEN);

  if (allowBlob) {
    try {
      const { put } = await import("@vercel/blob");
      const prefix = "extracted-articles";
      const jsonBlob = await put(`${prefix}/${jsonName}`, JSON.stringify(result, null, 2), {
        access: "public",
        contentType: "application/json; charset=utf-8"
      });
      const textBlob = await put(`${prefix}/${textName}`, textPayload, {
        access: "public",
        contentType: "text/plain; charset=utf-8"
      });
      return {
        storage: "blob",
        dir: "vercel-blob",
        jsonName,
        textName,
        jsonPath: jsonBlob.url,
        textPath: textBlob.url,
        jsonUrl: jsonBlob.url,
        textUrl: textBlob.url,
        textPayload
      };
    } catch {
      // Fall through to local fs for non-Vercel/dev environments.
    }
  }

  await fs.mkdir(EXTRACTED_DIR, { recursive: true });
  const jsonPath = path.join(EXTRACTED_DIR, jsonName);
  const textPath = path.join(EXTRACTED_DIR, textName);
  await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(textPath, textPayload, "utf8");

  return {
    storage: "local",
    dir: EXTRACTED_DIR,
    jsonName,
    textName,
    jsonPath,
    textPath,
    jsonUrl: null,
    textUrl: null,
    textPayload
  };
}
