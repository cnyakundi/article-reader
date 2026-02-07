import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { extractRelevantArticle } from "./extractor.mjs";
import { saveExtractionResult } from "./saveOutput.mjs";
import { EXTRACTED_DIR } from "./projectPaths.mjs";

const PORT = Number(process.env.ARTICLE_READER_PORT || 4317);
const INDEX_FILE = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url))), "ui", "index.html");

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  const body = String(text || "");
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > limit) throw new Error("payload_too_large");
    chunks.push(piece);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function normalizeFileName(name) {
  let raw = String(name || "").trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {}
  const file = path.basename(raw);
  if (!file) return "";
  return file;
}

function fileContentType(fileName) {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function handleExtract(req, res) {
  try {
    const body = await readJsonBody(req);
    const input = String(body?.input || "").trim();
    const query = String(body?.query || "").trim();
    const topRaw = Number(body?.top || 6);
    const top = Number.isFinite(topRaw) ? Math.max(1, Math.min(12, Math.floor(topRaw))) : 6;

    if (!input) {
      sendJson(res, 400, { ok: false, error: "missing_input" });
      return;
    }

    const result = await extractRelevantArticle({ input, query, topK: top });
    if (!result.ok) {
      sendJson(res, 400, { ok: false, error: result.error || "extract_failed" });
      return;
    }

    const saved = await saveExtractionResult(result);
    sendJson(res, 200, {
      ok: true,
      result,
      saved: {
        storage: saved.storage,
        dir: saved.dir,
        jsonName: saved.jsonName,
        textName: saved.textName,
        jsonPath: saved.jsonPath,
        textPath: saved.textPath,
        jsonUrl: saved.jsonUrl || `/files/${encodeURIComponent(saved.jsonName)}`,
        textUrl: saved.textUrl || `/files/${encodeURIComponent(saved.textName)}`
      }
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message || err || "server_error") });
  }
}

async function handleFile(req, res, pathname) {
  const fileName = normalizeFileName(pathname.replace(/^\/files\//, ""));
  if (!fileName) {
    sendJson(res, 400, { ok: false, error: "invalid_file" });
    return;
  }
  const abs = path.join(EXTRACTED_DIR, fileName);
  if (!abs.startsWith(EXTRACTED_DIR)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return;
  }
  try {
    const data = await fs.readFile(abs, "utf8");
    sendText(res, 200, data, fileContentType(fileName));
  } catch {
    sendJson(res, 404, { ok: false, error: "not_found" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/") {
    try {
      const html = await fs.readFile(INDEX_FILE, "utf8");
      sendText(res, 200, html, "text/html; charset=utf-8");
    } catch {
      sendText(res, 500, "Failed to load UI.");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/extract") {
    await handleExtract(req, res);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/files/")) {
    await handleFile(req, res, pathname);
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, () => {
  process.stdout.write(`ArticleReader web UI running at http://localhost:${PORT}\n`);
});
