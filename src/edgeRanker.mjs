function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function termFrequencyScore(query, text) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const words = tokenize(text);
  if (!words.length) return 0;

  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);

  let score = 0;
  for (const qt of qTokens) {
    for (const [w, c] of counts.entries()) {
      if (w.startsWith(qt)) score += c;
    }
  }
  return score / Math.max(1, words.length);
}

function cosine(a, b) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("edge_timeout")), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function embedWithOllama(text, model, endpoint, timeoutMs) {
  const res = await withTimeout(
    fetch(`${endpoint.replace(/\/$/, "")}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: String(text || "")
      })
    }),
    timeoutMs
  );

  if (!res.ok) {
    throw new Error(`edge_http_${res.status}`);
  }

  const data = await res.json();
  const vec = Array.isArray(data?.embedding) ? data.embedding : null;
  if (!vec || vec.length === 0) {
    throw new Error("edge_empty_embedding");
  }
  return vec.map((n) => Number(n || 0));
}

export async function rankByRelevance({ query, candidates, topK = 5 }) {
  const q = String(query || "").trim();
  const items = Array.isArray(candidates)
    ? candidates.map((text) => String(text || "").trim()).filter(Boolean)
    : [];

  if (!q || items.length === 0) {
    return {
      method: "empty",
      model: null,
      ranked: []
    };
  }

  const edgeModel = String(process.env.ARTICLE_READER_EDGE_MODEL || "nomic-embed-text").trim();
  const edgeUrl = String(process.env.ARTICLE_READER_EDGE_URL || "http://127.0.0.1:11434").trim();
  const timeoutMs = Number(process.env.ARTICLE_READER_EDGE_TIMEOUT_MS || 5000);
  const isVercelRuntime = Boolean(
    String(process.env.VERCEL || "").trim() ||
      String(process.env.VERCEL_ENV || "").trim() ||
      String(process.env.NOW_REGION || "").trim()
  );
  const forceEdge = String(process.env.ARTICLE_READER_FORCE_EDGE || "").trim() === "1";

  // Serverless environments do not have local Ollama. Skip edge calls unless explicitly forced.
  if (isVercelRuntime && !forceEdge) {
    const scored = items.map((text, index) => ({
      index,
      text,
      score: termFrequencyScore(q, text)
    }));
    scored.sort((a, b) => b.score - a.score);
    return {
      method: "lexical-fallback",
      model: null,
      warning: "edge_disabled_on_vercel",
      ranked: scored.slice(0, Math.max(1, topK))
    };
  }

  try {
    const qVec = await embedWithOllama(q, edgeModel, edgeUrl, timeoutMs);
    const scored = [];
    for (let i = 0; i < items.length; i += 1) {
      const text = items[i];
      const vec = await embedWithOllama(text, edgeModel, edgeUrl, timeoutMs);
      const score = cosine(qVec, vec);
      scored.push({ index: i, text, score });
    }
    scored.sort((a, b) => b.score - a.score);

    return {
      method: "edge-ollama-embedding",
      model: edgeModel,
      endpoint: edgeUrl,
      ranked: scored.slice(0, Math.max(1, topK))
    };
  } catch (err) {
    const scored = items.map((text, index) => ({
      index,
      text,
      score: termFrequencyScore(q, text)
    }));
    scored.sort((a, b) => b.score - a.score);
    return {
      method: "lexical-fallback",
      model: null,
      warning: String(err?.message || err || "edge_model_failed"),
      ranked: scored.slice(0, Math.max(1, topK))
    };
  }
}
