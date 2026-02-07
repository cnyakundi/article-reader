import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { rankByRelevance } from "./edgeRanker.mjs";

const execFileAsync = promisify(execFile);

const CANDIDATE_SELECTORS = [
  "article",
  "[itemprop='articleBody']",
  "main article",
  "main",
  ".article-body",
  ".article-content",
  ".story-body",
  ".post-content",
  ".entry-content",
  "#article-body",
  "#content"
];

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CF_VENV_DIR = path.join(PROJECT_ROOT, ".venv_cf");
const CF_PY_BIN = path.join(CF_VENV_DIR, "bin", "python");
const CF_FETCH_SCRIPT = path.join(PROJECT_ROOT, "src", "cf_fetch.py");
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const IS_VERCEL_RUNTIME = Boolean(
  String(process.env.VERCEL || "").trim() ||
    String(process.env.VERCEL_ENV || "").trim() ||
    String(process.env.NOW_REGION || "").trim()
);

function normalizeInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return text;
  if (text.startsWith("view-source:")) {
    return text.slice("view-source:".length).trim();
  }
  return text;
}

function stripTagsAndWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitParagraphs(text) {
  return stripTagsAndWhitespace(text)
    .split(/\n{2,}/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 40);
}

function isUrl(input) {
  return /^https?:\/\//i.test(String(input || "").trim());
}

function isLikelyHtml(input) {
  const s = String(input || "").toLowerCase();
  if (!s) return false;
  return (
    s.includes("<html") ||
    s.includes("<body") ||
    s.includes("<article") ||
    s.includes("<main") ||
    s.includes("<p>")
  );
}

function looksLikeAccessBlock(html) {
  const s = String(html || "").toLowerCase();
  if (!s) return false;
  if (s.includes("attention required") && s.includes("cloudflare")) return true;
  if (s.includes("just a moment...") && s.includes("cloudflare")) return true;
  if (s.includes("why have i been blocked")) return true;
  if (s.includes("enable javascript and cookies")) return true;
  return false;
}

async function ensureCloudscraperEnv() {
  try {
    await fs.stat(CF_PY_BIN);
  } catch {
    await execFileAsync("python3", ["-m", "venv", CF_VENV_DIR], {
      timeout: 120000
    });
  }

  try {
    await execFileAsync(CF_PY_BIN, ["-c", "import cloudscraper"], {
      timeout: 15000
    });
  } catch {
    await execFileAsync(CF_PY_BIN, ["-m", "pip", "install", "-q", "cloudscraper"], {
      timeout: 180000
    });
  }
}

async function fetchViaCloudscraper(url) {
  await ensureCloudscraperEnv();
  const { stdout } = await execFileAsync(
    CF_PY_BIN,
    [CF_FETCH_SCRIPT, String(url || "")],
    {
      timeout: 90000,
      maxBuffer: 15 * 1024 * 1024
    }
  );
  return String(stdout || "");
}

async function readInputSource(input) {
  const normalized = normalizeInput(input);
  if (!normalized) return { sourceType: "empty", source: "", body: "" };

  if (isUrl(normalized)) {
    let body = "";
    try {
      const res = await fetch(normalized, {
        headers: {
          "user-agent": BROWSER_UA,
          accept: "text/html,application/xhtml+xml"
        }
      });
      if (!res.ok) {
        throw new Error(`failed_to_fetch_url:${res.status}`);
      }
      body = await res.text();
    } catch {
      // Some sites fail TLS/anti-bot checks in fetch. Curl fallback is more tolerant.
      const { stdout } = await execFileAsync("curl", [
        "-L",
        "--compressed",
        "--max-time",
        "40",
        "-A",
        BROWSER_UA,
        normalized
      ]);
      body = String(stdout || "");
      if (!body.trim()) {
        throw new Error("failed_to_fetch_url:empty_body");
      }
    }

    // If the initial fetch is still blocked, retry with Cloudflare-aware scraper.
    // Skip this on Vercel because Python/cloudscraper setup is not suitable there.
    if (looksLikeAccessBlock(body) && !IS_VERCEL_RUNTIME) {
      try {
        const cfBody = await fetchViaCloudscraper(normalized);
        if (cfBody.trim()) body = cfBody;
      } catch {
        // Keep original blocked body; caller surfaces warning.
      }
    }

    return {
      sourceType: "url",
      source: normalized,
      body
    };
  }

  const possibleFile = path.resolve(process.cwd(), normalized);
  try {
    const st = await fs.stat(possibleFile);
    if (st.isFile()) {
      return {
        sourceType: "file",
        source: possibleFile,
        body: await fs.readFile(possibleFile, "utf8")
      };
    }
  } catch {}

  return {
    sourceType: isLikelyHtml(normalized) ? "html" : "text",
    source: "inline",
    body: normalized
  };
}

function collectDomCandidates(doc) {
  const out = [];
  const seen = new Set();
  for (const selector of CANDIDATE_SELECTORS) {
    const nodes = doc.querySelectorAll(selector);
    for (const node of nodes) {
      const text = stripTagsAndWhitespace(node.textContent || "");
      if (text.length < 350) continue;
      const key = text.slice(0, 240);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= 30) return out;
    }
  }
  return out;
}

function makeReadabilityCandidate(html, sourceUrl) {
  try {
    const dom = new JSDOM(html, {
      url: sourceUrl || "https://local.article.reader/"
    });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    if (!parsed) return null;
    const text = stripTagsAndWhitespace(parsed.textContent || "");
    if (text.length < 350) return null;
    return {
      title: stripTagsAndWhitespace(parsed.title || ""),
      byline: stripTagsAndWhitespace(parsed.byline || ""),
      excerpt: stripTagsAndWhitespace(parsed.excerpt || ""),
      text
    };
  } catch {
    return null;
  }
}

function composeQuery({ explicitQuery, title, excerpt, source }) {
  const eq = String(explicitQuery || "").trim();
  if (eq) return eq;
  const parts = [title, excerpt, source]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return parts.join(" ");
}

function createRelevantPassages(text, ranked, maxPassages = 6) {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return [];
  const used = new Set();
  const out = [];

  for (const row of ranked) {
    const candidate = String(row?.text || "").trim();
    const needle = candidate.slice(0, 80);
    for (const p of paragraphs) {
      if (!needle || !p.includes(needle)) continue;
      const key = p.slice(0, 180);
      if (used.has(key)) continue;
      used.add(key);
      out.push({
        score: Number(row.score || 0),
        text: p
      });
      break;
    }
    if (out.length >= maxPassages) break;
  }

  if (out.length > 0) return out;
  return paragraphs.slice(0, Math.min(maxPassages, paragraphs.length)).map((p) => ({
    score: 0,
    text: p
  }));
}

function detectAccessBlock({ title, text }) {
  const t = String(title || "").toLowerCase();
  const b = String(text || "").toLowerCase();
  if (t.includes("attention required") && b.includes("cloudflare")) return true;
  if (b.includes("why have i been blocked") && b.includes("security service")) return true;
  if (b.includes("enable javascript and cookies")) return true;
  return false;
}

export async function extractRelevantArticle({
  input,
  query,
  topK = 6
}) {
  const src = await readInputSource(input);
  const body = String(src.body || "");
  if (!body.trim()) {
    return {
      ok: false,
      error: "empty_input"
    };
  }

  if (src.sourceType === "text") {
    const text = stripTagsAndWhitespace(body);
    const q = composeQuery({
      explicitQuery: query,
      title: "",
      excerpt: "",
      source: text.slice(0, 240)
    });
    const rankedPassages = await rankByRelevance({
      query: q,
      candidates: splitParagraphs(text),
      topK
    });
    return {
      ok: true,
      sourceType: src.sourceType,
      source: src.source,
      title: "",
      byline: "",
      excerpt: "",
      articleText: text,
      paragraphCount: splitParagraphs(text).length,
      relevantPassages: rankedPassages.ranked.map((r) => ({
        score: Number(r.score || 0),
        text: r.text
      })),
      ranking: {
        method: rankedPassages.method,
        model: rankedPassages.model || null,
        warning: rankedPassages.warning || null
      }
    };
  }

  const sourceUrl = src.sourceType === "url" ? src.source : "https://local.article.reader/";
  const readability = makeReadabilityCandidate(body, sourceUrl);
  const dom = new JSDOM(body, { url: sourceUrl });
  const titleFromDom = stripTagsAndWhitespace(
    dom.window.document.querySelector("h1")?.textContent ||
      dom.window.document.title ||
      ""
  );
  const candidates = collectDomCandidates(dom.window.document);

  if (readability?.text) {
    candidates.unshift(readability.text);
  }

  const deDuped = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = c.slice(0, 240);
    if (seen.has(key)) continue;
    seen.add(key);
    deDuped.push(c);
  }

  if (deDuped.length === 0) {
    const text = stripTagsAndWhitespace(dom.window.document.body?.textContent || body);
    deDuped.push(text);
  }

  const queryText = composeQuery({
    explicitQuery: query,
    title: readability?.title || titleFromDom,
    excerpt: readability?.excerpt || "",
    source: src.source
  });

  const ranked = await rankByRelevance({
    query: queryText,
    candidates: deDuped,
    topK: Math.max(topK, 6)
  });

  const best = ranked.ranked[0] || { text: deDuped[0], score: 0 };
  const articleText = stripTagsAndWhitespace(best.text || "");
  const passages = createRelevantPassages(
    articleText,
    ranked.ranked,
    Math.max(3, Math.min(8, topK))
  );
  const blocked = detectAccessBlock({
    title: readability?.title || titleFromDom || "",
    text: articleText
  });

  return {
    ok: true,
    sourceType: src.sourceType,
    source: src.source,
    normalizedSource:
      src.sourceType === "url" ? normalizeInput(input) : src.source,
    title: readability?.title || titleFromDom || "",
    byline: readability?.byline || "",
    excerpt: readability?.excerpt || "",
    articleText,
    paragraphCount: splitParagraphs(articleText).length,
    relevantPassages: passages,
    candidatesAnalyzed: deDuped.length,
    blocked,
    warning:
      blocked && src.sourceType === "url"
        ? IS_VERCEL_RUNTIME
          ? "Remote site returned an anti-bot/access-block page. This host may block datacenter traffic; paste raw article HTML/text for full extraction."
          : "Remote site returned an anti-bot/access-block page. Paste the raw article HTML/text to extract the real content."
        : null,
    ranking: {
      method: ranked.method,
      model: ranked.model || null,
      warning: ranked.warning || null
    }
  };
}
