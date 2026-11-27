# VyaparVani

Voice-first inventory, order and khata assistant for India's small retailers.
Speak naturally in Hinglish — *"5 kg chawal Gupta store ko bhej do"* — and
VyaparVani turns it into a structured, editable order or ledger entry. No
typing while customers wait.

## How to run

The submission path is Docker Compose — one command, no extra steps:

```bash
docker compose up --build     # http://localhost:3000
```

Works with no environment variables: without an API key the app starts in demo
mode with the local rule-based parser (see below). For local development
without Docker:

```bash
npm install
npm run dev        # http://localhost:3000
```

## Environment variables

Both are **optional**; the container starts and serves the full flow without
them.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | No | unset | Enables real model parsing in `/api/parse`. Unset → demo parser. Read from the server env; never commit it. |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model id used when a key is present (`src/app/api/parse/route.ts`). |

```bash
OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-4o-mini docker compose up
```

`docker-compose.yml` reads both from the host environment, so nothing is baked
into the image. A key can also be pasted into the in-app key box, where it
stays in that browser session only and is sent per-request as a header.

## Voice capture

The mic button uses the browser's **Web Speech API** (Chrome/Edge). In other
browsers the flow still works by typing the same Hinglish utterance into the
text box — parsing, cards, clarification and saving are identical either way.
The mic needs permission on first use; nothing is uploaded by the capture step
(the transcript is sent to the parse endpoint only when you press
"Samajh ke likh dijiye").

## Parsing: real model vs demo mode

- **With `OPENAI_API_KEY` set** (server env; store the value in your secret
  manager, never in the repo): `/api/parse` calls the model with a zod
  structured-output schema and a glossary of local trade terms and units
  (`drib`, `kalawa`, `peti`, `darjan`, Hinglish numerals…). Per-attempt
  `AbortController` (15 s timeout within a 25 s budget), bounded `429`
  exponential backoff (up to 2 retries; immediate `429` on `insufficient_quota`),
  `401` invalid-key detection, and per-request logs with model/tokens/latency.
- **Without a key** the app runs in **demo mode**: a local rule-based parser
  (keyword + number extraction). The home screen shows an "API key set nahi
  hai" banner with a key box — paste a key there (kept in the browser session
  only, sent per-request as a header, never stored server-side) to switch to
  real model parsing; remove it any time with "Key hatayein". Cards are
  labelled "Demo parser" in demo mode. This is a demo fallback, **not** the
  real model — expect it to handle the common patterns only.
- **Two instructions in one breath** are split into two cards when both sides
  parse cleanly, e.g. *"Shyam Trader ke liye 5 peti oil add karo aur Suresh ka
  500 udhaar likho"* → one order for Shyam Trader + one udhaar entry for
  Suresh. A single mixed instruction stays as one entry.

## Saving and confirmations

Entries start as drafts. Confirm ("Confirm & save") writes them to
`localStorage` and they survive a reload; edit and delete are always on the
card. When confidence is low (missing quantity, unclear party), the app asks a
short Hinglish clarifying question instead of guessing.

Confirming an order also deducts matching kirana SKUs in lightweight local
stock (`localStorage`, `vyaparvani.stock.v1`), surfaces low-stock alerts with
a 1-tap distributor WhatsApp reorder link, and supports voice restock
(e.g. *"10 kg chawal stock mein add karo"*). Confirmed khata entries roll up
into the `Khata (Parties)` net balance tab with 1-tap `WhatsApp pe bhejein`
slips and `Distributor Order Sheet (CSV)` export.

## Eval set

`eval/golden.json` holds **60 golden utterances** across Hinglish and Devanagari
(`hi-IN`):
- **36** confident orders (including Indian fractions `aadha`/`paav`/`sava`/`dedh`/`dhai`/`saadhe`, attached units `5kg`, price-denominated orders, branded multi-word items like `Britannia biscuits`/`Amul dudh`/`Amul butter`/`Tata namak`/`basmati chawal`, multi-word parties, and IST `dueDate` `aaj`/`kal`/`parso`)
- **11** confident ledger entries (`credit_given` for `udhaar`/`baki`/`udhaar dena` and `payment_received` for `wasooli`/`jama`/`clear`/`mila`, including attached currency `250rs`/`₹500`/`500/-`)
- **4** multi-intent entries (**2** mixed `order`+`udhaar` + **2** `aur` multi-instruction splits across Hinglish & Devanagari)
- **9** safety & clarification cases (zero-qty, nameless ledger, missing amount, missing items/product/party with `missingIncludes` assertions)

`scripts/eval-parser.mjs` asserts the full normalized `product` name (stripping
only parenthetical English glosses), `ledgerAction`, IST `dueDate` (`IST+0`/`IST+1`/`IST+2`),
`missingIncludes`, and reports `mode`, `median (p50)`, and `p95` latency,
exiting non-zero (`process.exitCode = 1`) on any mismatch.

Run against a live server:

```bash
# Demo mode (no API key required)
npm run eval                       # against http://localhost:3000
node scripts/eval-parser.mjs http://localhost:3000

# Live gpt-4o-mini mode (forwards OPENAI_API_KEY via x-openai-key)
OPENAI_API_KEY=sk-... node scripts/eval-parser.mjs http://localhost:3000 --llm --delay-ms=150
```

Measured results (filled only from observed runs — no unmeasured LLM scores or latencies claimed):

| Mode | Pass Rate | Latency (`p50` / `p95`) | Status |
| --- | --- | --- | --- |
| **Demo regex parser** (no API key) | **60/60 exact-match (100%)** | Measured per run (`p50`/`p95` printed by `eval-parser.mjs`; 26-case baseline `p50 = 9ms`) | CI-verified (`typecheck-build-eval`) |
| **`gpt-4o-mini` (`--llm`)** | Pending live `OPENAI_API_KEY` run | Pending live `OPENAI_API_KEY` run | Harness wired via `--llm` + `x-openai-key` |

Demo-mode numbers measure the rule-based fallback only, not the model.

## Scope and limits

- Single-user prototype: no auth, entries live in this browser's
  `localStorage`.
- Hinglish is the verified path; other regional languages are targets, not
  verified features.
- No impact numbers are claimed until measured.

## Docker

```bash
docker compose up --build
```

Multi-stage Next.js `output: "standalone"` build (`node server.js`), non-root
`app` user, no secrets baked into the image, and a `HEALTHCHECK` probing
`GET /api/health` (`{ ok: true, status: "healthy", mode: "demo" | "model", timestamp }`).
Pass the API key at runtime: `OPENAI_API_KEY=sk-... docker compose up` (compose
reads it from the environment).
