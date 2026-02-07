# ArticleReader

Extract the relevant article body from:
1. A normal URL.
2. A `view-source:` URL.
3. Pasted HTML.
4. Pasted plain text.
5. A local file path.

Two-stage extraction algorithm:
1. Deterministic parsing (`Readability` + DOM candidate blocks).
2. Edge relevance ranking (Ollama embeddings), with lexical fallback when embeddings are unavailable.

## Install

```bash
cd /Users/cn/Projects/ArticleReader
npm install
```

## Local run

### Web UI

```bash
cd /Users/cn/Projects/ArticleReader
npm run web
```

Open `http://localhost:4317`.

### CLI extraction

```bash
npm run extract -- --input "view-source:https://www.businessdailyafrica.com/bd/corporate/technology/telcos-eye-fraud-fight-boost-on-new-biometric-rule-5297942"
```

```bash
npm run extract -- --input "https://example.com/article" --query "fraud biometric regulation"
```

```bash
pbpaste | npm run extract -- --query "fraud biometric telcos"
```

## Saved output location

Local runs always auto-save both `.json` and `.txt` files into:
- `/Users/cn/Projects/ArticleReader/Extracted Articles`

Optional extra output files:

```bash
npm run extract -- \
  --input "https://example.com/article" \
  --json-out ./article.json \
  --text-out ./article.txt
```

## Vercel deployment

This project now includes:
- `index.html` static frontend.
- `api/extract.js` serverless extraction endpoint.
- `api/health.js` health endpoint.
- `vercel.json` function config.

### Deploy

```bash
cd /Users/cn/Projects/ArticleReader
npm i -g vercel
vercel
```

### Required Vercel env vars

- `BLOB_READ_WRITE_TOKEN` for persistent file storage in Vercel Blob.

Optional:
- `ARTICLE_READER_STORAGE=local` to force local FS (not persistent on Vercel).
- `ARTICLE_READER_EDGE_URL` (default `http://127.0.0.1:11434`)
- `ARTICLE_READER_EDGE_MODEL` (default `nomic-embed-text`)
- `ARTICLE_READER_EDGE_TIMEOUT_MS` (default `5000`)

## Backend vs pure JS

Pure browser JS can render UI, but reliable extraction from arbitrary links requires a backend because:
- Browser CORS blocks many cross-site fetches.
- Some publishers require custom headers, redirects, and anti-bot handling.
- Secrets/tokens (like Blob storage) cannot safely live in frontend code.

## Output fields

- `title`, `byline`, `excerpt`
- `articleText`
- `relevantPassages[]` (scored)
- `ranking.method`
  - `edge-ollama-embedding` when Ollama embeddings run
  - `lexical-fallback` when embeddings are unavailable

## Notes and limitations

- Optional local edge model setup:
  - Install Ollama.
  - `ollama pull nomic-embed-text`
  - Start Ollama before running extraction.
- Protected-site fallback in local runtime:
  - Cloudflare-aware fallback uses `cloudscraper` in `.venv_cf`.
- On Vercel:
  - Python fallback is skipped.
  - Some Cloudflare-protected pages may still return block pages from datacenter IPs.
  - If blocked, paste raw article HTML/text for guaranteed extraction.
