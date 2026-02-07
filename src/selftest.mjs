import { extractRelevantArticle } from "./extractor.mjs";

const sampleHtml = `
<!doctype html>
<html>
  <head>
    <title>Sample - Fraud Detection</title>
  </head>
  <body>
    <header>
      <nav>Home | Business | Markets</nav>
    </header>
    <main>
      <article>
        <h1>Telcos eye fraud fight boost on new biometric rule</h1>
        <p>Mobile operators are preparing for tighter anti-fraud controls after new biometric identity rules were introduced.</p>
        <p>The policy is expected to reduce identity theft and improve fraud tracing for SIM registration.</p>
        <p>Industry executives said implementation must balance privacy and compliance costs.</p>
      </article>
    </main>
    <footer>Copyright 2026</footer>
  </body>
</html>
`;

const result = await extractRelevantArticle({
  input: sampleHtml,
  query: "fraud biometric identity"
});

if (!result.ok) {
  throw new Error(`selftest_failed:${result.error || "unknown"}`);
}

if (!String(result.title || "").toLowerCase().includes("fraud")) {
  throw new Error("selftest_failed:title_not_extracted");
}

if (!String(result.articleText || "").toLowerCase().includes("biometric")) {
  throw new Error("selftest_failed:article_text_missing");
}

if (!Array.isArray(result.relevantPassages) || result.relevantPassages.length === 0) {
  throw new Error("selftest_failed:no_relevant_passages");
}

process.stdout.write("selftest_ok\n");
