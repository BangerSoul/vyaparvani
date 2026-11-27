#!/usr/bin/env node
// Runs the golden utterance set against the /api/parse endpoint.
// Usage: node scripts/eval-parser.mjs [baseUrl]
// Without OPENAI_API_KEY on the server it measures the demo parser.

const base = process.argv[2] || "http://localhost:3000";
const CASES = JSON.parse((await import("node:fs")).readFileSync(new URL("../eval/golden.json", import.meta.url), "utf8"));

let pass = 0;
const rows = [];
for (const c of CASES) {
  const started = Date.now();
  let parsed = null, err = null;
  try {
    const res = await fetch(`${base}/api/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utterance: c.utterance }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    parsed = await res.json();
  } catch (e) { err = e.message; }
  const latency = Date.now() - started;
  const ok = !err && parsed && check(parsed, c.expect);
  if (ok) pass++;
  rows.push({ n: c.n, utterance: c.utterance, ok, err, latency, parsed });
}

function check(got, exp) {
  const entries = Array.isArray(got?.entries) ? got.entries : [got];
  if (exp.multi) {
    if (entries.length !== exp.multi.length) return false;
    return exp.multi.every((e, i) => checkOne(entries[i], e));
  }
  if (entries.length !== 1) return false;
  return checkOne(entries[0], exp);
}

function checkOne(got, exp) {
  if ((got.type ?? null) !== (exp.type ?? null)) return false;
  if (exp.party !== undefined && (got.party ?? "").toLowerCase() !== exp.party.toLowerCase()) return false;
  if (exp.amount !== undefined && (got.amount ?? null) !== exp.amount) return false;
  if ((got.confidence < 0.6) !== !!exp.needsClarification) return false;
  const gotItems = (got.items ?? []).map(it => [it.product.split(" ")[0], it.quantity, it.unit || ""]);
  const expItems = (exp.items ?? []).map(it => [it[0], it[1], it[2] || ""]);
  return JSON.stringify(gotItems) === JSON.stringify(expItems);
}

for (const r of rows) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  #${String(r.n).padStart(2)} ${r.utterance}${r.err ? " — " + r.err : ""}`);
  if (!r.ok && r.parsed) console.log(`      got: ${JSON.stringify(r.parsed)}`);
}
const total = CASES.length;
console.log(`\n${pass}/${total} exact-match (${Math.round((pass / total) * 100)}%), median latency ${rows.map(r => r.latency).sort((a, b) => a - b)[Math.floor(total / 2)]}ms`);

