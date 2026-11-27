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
  (`drib`, `kalawa`, `peti`, `darjan`, Hinglish numerals…). One retry on rate
  limit, 15 s timeout, per-request log with model/tokens/latency.
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

## Eval set

`eval/golden.json` holds 26 golden Hinglish utterances — 21 order, 4 udhaar,
1 mixed order+udhaar — with expected structured entries, including noise cases
(missing quantity, missing product). Run against a live server:

```bash
npm run eval                       # against http://localhost:3000
node scripts/eval-parser.mjs http://localhost:3000
```

Measured results for this prototype run in demo mode (no API key configured):
see the output of `npm run eval` — results below are filled only from actual
runs, per case pass/fail plus aggregate accuracy and latency.

```
$ npm run eval   (demo mode, no API key, 2026-11-27)

26/26 exact-match (100%), median latency 9ms
```

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

Multi-stage build, non-root user, no secrets baked into the image. Pass the
API key at runtime: `OPENAI_API_KEY=sk-... docker compose up` (compose reads
it from the environment).
