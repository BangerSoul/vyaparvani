# VyaparVani

Voice-first inventory, order and khata assistant for India's small retailers.
Speak naturally in Hinglish — *"5 kg chawal Gupta store ko bhej do"* — and
VyaparVani turns it into a structured, editable order or ledger entry. No
typing while customers wait.

## How to run

```bash
npm install
npm run dev        # http://localhost:3000
```

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
  (keyword + number extraction). Cards are labelled "Demo parser" in that
  case. This is a demo fallback, **not** the real model — expect it to handle
  the common patterns only.

## Saving and confirmations

Entries start as drafts. Confirm ("Confirm & save") writes them to
`localStorage` and they survive a reload; edit and delete are always on the
card. When confidence is low (missing quantity, unclear party), the app asks a
short Hinglish clarifying question instead of guessing.

## Eval set

`eval/golden.json` holds 25 golden Hinglish/regional utterances with expected
structured entries, including noise cases (missing quantity, missing product,
mixed order+ledger). Run against a live server:

```bash
npm run eval                       # against http://localhost:3000
node scripts/eval-parser.mjs http://localhost:3000
```

Measured results for this prototype run in demo mode (no API key configured):
see the output of `npm run eval` — results below are filled only from actual
runs, per case pass/fail plus aggregate accuracy and latency.

```
$ npm run eval   (demo mode, no API key, 2026-11-27)

25/25 exact-match (100%), median latency 7ms
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
