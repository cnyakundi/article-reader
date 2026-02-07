import fs from "node:fs/promises";
import process from "node:process";
import { extractRelevantArticle } from "./extractor.mjs";
import { saveExtractionResult } from "./saveOutput.mjs";

function parseArgs(argv) {
  const out = {
    input: "",
    query: "",
    top: 6,
    jsonOut: "",
    textOut: ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" || token === "-i") {
      out.input = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--query" || token === "-q") {
      out.query = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--top") {
      const n = Number(argv[i + 1] || "6");
      out.top = Number.isFinite(n) ? Math.max(1, Math.min(12, Math.floor(n))) : 6;
      i += 1;
      continue;
    }
    if (token === "--json-out") {
      out.jsonOut = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--text-out") {
      out.textOut = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
  }

  return out;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printHelp() {
  const lines = [
    "ArticleReader CLI",
    "",
    "Usage:",
    "  node src/cli.mjs --input <url|view-source:url|html|text> [--query <text>] [--top <n>]",
    "  cat page.html | node src/cli.mjs --query \"fraud biometrics\"",
    "",
    "Options:",
    "  --input, -i     URL, view-source URL, raw HTML, plain text, or local file path",
    "  --query, -q     Relevance query (optional; auto-generated if omitted)",
    "  --top           Number of relevant passages to keep (default: 6, max: 12)",
    "  --json-out      Optional additional JSON output file path",
    "  --text-out      Optional additional text output file path",
    "                 Note: files are always saved to ./Extracted Articles/",
    "  --help, -h      Show this help"
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

function compactText(s, max = 900) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 3)}...`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const stdin = await readStdin();
  const input = String(args.input || stdin || "").trim();
  if (!input) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const result = await extractRelevantArticle({
    input,
    query: args.query,
    topK: args.top
  });

  if (!result.ok) {
    process.stderr.write(`Extraction failed: ${result.error || "unknown"}\n`);
    process.exitCode = 1;
    return;
  }

  const saved = await saveExtractionResult(result);

  if (args.jsonOut) {
    await fs.writeFile(args.jsonOut, JSON.stringify(result, null, 2), "utf8");
  }
  if (args.textOut) {
    await fs.writeFile(args.textOut, saved.textPayload, "utf8");
  }

  const preview = [
    `Title: ${result.title || "(none)"}`,
    `Byline: ${result.byline || "(none)"}`,
    `Source: ${result.normalizedSource || result.source || "(inline)"}`,
    `Ranking: ${result.ranking?.method || "unknown"}${result.ranking?.model ? ` (${result.ranking.model})` : ""}`,
    result.warning ? `Warning: ${result.warning}` : null,
    `Paragraphs: ${result.paragraphCount || 0}`,
    "",
    "Top relevant passages:",
    ...(result.relevantPassages || []).map(
      (p, idx) => `${idx + 1}. [${Number(p.score || 0).toFixed(4)}] ${compactText(p.text, 280)}`
    ),
    "",
    "Saved files:",
    `- ${saved.jsonPath}`,
    `- ${saved.textPath}`,
    "",
    "Extracted article preview:",
    compactText(result.articleText || "", 1200)
  ].filter(Boolean);
  process.stdout.write(preview.join("\n") + "\n");
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err || "unknown_error")}\n`);
  process.exitCode = 1;
});
