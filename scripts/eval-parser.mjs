#!/usr/bin/env node
// Runs the golden utterance set against the /api/parse endpoint.
// Usage: node scripts/eval-parser.mjs [baseUrl] [--llm] [--delay-ms=150]
// Without --llm (or OPENAI_API_KEY on the server), it benchmarks the demo parser.
// With --llm and OPENAI_API_KEY set, it forwards x-openai-key to benchmark gpt-4o-mini.

import fs from "node:fs";

const args = process.argv.slice(2);
let base = "http://localhost:3000";
let useLlm = false;
let delayMs = 0;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--llm") {
    useLlm = true;
  } else if (arg.startsWith("--delay-ms=")) {
    delayMs = Math.max(0, Number(arg.slice("--delay-ms=".length)) || 0);
  } else if (arg === "--delay-ms" && i + 1 < args.length) {
    delayMs = Math.max(0, Number(args[++i]) || 0);
  } else if (!arg.startsWith("--")) {
    base = arg;
  }
}

const apiKey = process.env.OPENAI_API_KEY || "";
if (useLlm && !apiKey) {
  console.error("ERROR: --llm requires OPENAI_API_KEY to be set in the environment.");
  process.exit(1);
}

const CASES = JSON.parse(fs.readFileSync(new URL("../eval/golden.json", import.meta.url), "utf8"));

function getIstDate(daysAhead = 0) {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  return new Date(Date.now() + istOffsetMs + daysAhead * dayMs).toISOString().slice(0, 10);
}

function resolveDueDate(val) {
  if (typeof val !== "string") return "";
  const m = /^IST\+(\d+)$/.exec(val.trim());
  if (m) return getIstDate(Number(m[1]));
  return val;
}

function normProduct(p) {
  return String(p ?? "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function checkOne(got, exp, label = "") {
  const diffs = [];
  const prefix = label ? `${label} ` : "";

  if ((got?.type ?? null) !== (exp.type ?? null)) {
    diffs.push(`${prefix}type: expected ${JSON.stringify(exp.type ?? null)}, got ${JSON.stringify(got?.type ?? null)}`);
  }
  if (exp.ledgerAction !== undefined && (got?.ledgerAction ?? null) !== exp.ledgerAction) {
    diffs.push(`${prefix}ledgerAction: expected ${JSON.stringify(exp.ledgerAction)}, got ${JSON.stringify(got?.ledgerAction ?? null)}`);
  }
  if (exp.party !== undefined && (got?.party ?? "").toLowerCase() !== exp.party.toLowerCase()) {
    diffs.push(`${prefix}party: expected ${JSON.stringify(exp.party)}, got ${JSON.stringify(got?.party ?? "")}`);
  }
  if (exp.dueDate !== undefined) {
    const expDue = resolveDueDate(exp.dueDate);
    const gotDue = got?.dueDate ?? "";
    if (gotDue !== expDue) {
      diffs.push(`${prefix}dueDate: expected ${JSON.stringify(expDue)}, got ${JSON.stringify(gotDue)}`);
    }
  }
  if (exp.amount !== undefined && (got?.amount ?? null) !== exp.amount) {
    diffs.push(`${prefix}amount: expected ${JSON.stringify(exp.amount)}, got ${JSON.stringify(got?.amount ?? null)}`);
  }
  if ((got?.confidence < 0.6) !== !!exp.needsClarification) {
    diffs.push(`${prefix}needsClarification: expected ${!!exp.needsClarification}, got confidence=${got?.confidence}`);
  }
  if (Array.isArray(exp.missingIncludes)) {
    const gm = Array.isArray(got?.missing) ? got.missing : [];
    const absent = exp.missingIncludes.filter((k) => !gm.includes(k));
    if (absent.length > 0) {
      diffs.push(`${prefix}missingIncludes: expected ${JSON.stringify(exp.missingIncludes)} in ${JSON.stringify(gm)}`);
    }
  }

  const gotItems = (got?.items ?? []).map((it) => [normProduct(it.product), it.quantity, it.unit || ""]);
  const expItems = (exp.items ?? []).map((it) => [normProduct(it[0]), it[1], it[2] || ""]);
  if (JSON.stringify(gotItems) !== JSON.stringify(expItems)) {
    diffs.push(`${prefix}items: expected ${JSON.stringify(expItems)}, got ${JSON.stringify(gotItems)}`);
  }

  return diffs;
}

function check(got, exp) {
  const entries = Array.isArray(got?.entries) ? got.entries : [got];
  if (exp.multi) {
    if (entries.length !== exp.multi.length) {
      return [`entries.length: expected ${exp.multi.length}, got ${entries.length}`];
    }
    const diffs = [];
    exp.multi.forEach((e, i) => {
      diffs.push(...checkOne(entries[i], e, `[${i}]`));
    });
    return diffs;
  }
  if (entries.length !== 1) {
    return [`entries.length: expected 1, got ${entries.length}`];
  }
  return checkOne(entries[0], exp);
}

let pass = 0;
const rows = [];
for (let idx = 0; idx < CASES.length; idx++) {
  const c = CASES[idx];
  const started = Date.now();
  let parsed = null;
  let err = null;
  try {
    const headers = { "Content-Type": "application/json" };
    if (useLlm) headers["x-openai-key"] = apiKey;
    const res = await fetch(`${base}/api/parse`, {
      method: "POST",
      headers,
      body: JSON.stringify({ utterance: c.utterance }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    parsed = await res.json();
  } catch (e) {
    err = e.message;
  }
  const latency = Date.now() - started;
  const diffs = !err && parsed ? check(parsed, c.expect) : [];
  const ok = !err && !!parsed && diffs.length === 0;
  if (ok) pass++;
  rows.push({ n: c.n, utterance: c.utterance, ok, err, diffs, latency, parsed });

  if (delayMs > 0 && idx < CASES.length - 1) {
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

for (const r of rows) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  #${String(r.n).padStart(2)} ${r.utterance}${r.err ? " — " + r.err : ""}`);
  if (!r.ok) {
    for (const d of r.diffs) console.log(`      diff: ${d}`);
    if (r.parsed) console.log(`      got: ${JSON.stringify(r.parsed)}`);
  }
}

const total = CASES.length;
const sortedLatencies = rows.map((r) => r.latency).sort((a, b) => a - b);
const p50 = sortedLatencies[Math.floor(total / 2)] ?? 0;
const p95 = sortedLatencies[Math.min(total - 1, Math.ceil(total * 0.95) - 1)] ?? 0;
const modeSet = [...new Set(rows.map((r) => r.parsed?.mode).filter(Boolean))];
const modeLabel = modeSet.length > 0 ? modeSet.join(",") : useLlm ? "model" : "demo";

console.log(
  `\n${pass}/${total} exact-match (${Math.round((pass / total) * 100)}%), mode=${modeLabel}, median (p50) latency ${p50}ms, p95 latency ${p95}ms`,
);
process.exitCode = pass === total ? 0 : 1;
