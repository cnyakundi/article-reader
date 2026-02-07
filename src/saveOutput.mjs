import fs from "node:fs/promises";
import path from "node:path";
import { EXTRACTED_DIR } from "./projectPaths.mjs";

const IS_VERCEL_RUNTIME = Boolean(
  String(process.env.VERCEL || "").trim() ||
    String(process.env.VERCEL_ENV || "").trim() ||
    String(process.env.NOW_REGION || "").trim()
);

function safeSlug(raw, fallback = "article") {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return s || fallback;
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
      const jsonBlob = await withTimeout(
        put(`${prefix}/${jsonName}`, JSON.stringify(result, null, 2), {
          access: "public",
          contentType: "application/json; charset=utf-8"
        }),
        12000,
        "blob_put_json"
      );
      const textBlob = await withTimeout(
        put(`${prefix}/${textName}`, textPayload, {
          access: "public",
          contentType: "text/plain; charset=utf-8"
        }),
        12000,
        "blob_put_text"
      );
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

  const jsonPath = path.join(EXTRACTED_DIR, jsonName);
  const textPath = path.join(EXTRACTED_DIR, textName);
  try {
    await fs.mkdir(EXTRACTED_DIR, { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), "utf8");
    await fs.writeFile(textPath, textPayload, "utf8");
  } catch (err) {
    if (IS_VERCEL_RUNTIME) {
      return {
        storage: "memory",
        dir: "serverless-ephemeral",
        jsonName,
        textName,
        jsonPath: null,
        textPath: null,
        jsonUrl: null,
        textUrl: null,
        textPayload,
        warning: `save_fallback:${String(err?.message || err || "unknown_error")}`
      };
    }
    throw err;
  }

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
