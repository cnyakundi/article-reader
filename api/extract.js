import { extractRelevantArticle } from "../src/extractor.mjs";
import { saveExtractionResult } from "../src/saveOutput.mjs";

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

async function readJsonBody(req, limit = 4 * 1024 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

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

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

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
    const onVercel = String(process.env.VERCEL || "").trim() === "1";

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
        jsonUrl: saved.jsonUrl || null,
        textUrl: saved.textUrl || null
      },
      warning:
        onVercel && saved.storage !== "blob"
          ? "No Blob token configured. Files are temporary in serverless runtime."
          : null
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message || err || "server_error") });
  }
}
