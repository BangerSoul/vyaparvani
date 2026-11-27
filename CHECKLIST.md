# VyaparVani — Resumable P0–P3 Implementation Checklist

- **Last Updated**: 2026-11-27T16:28:00Z
- **Current Milestone**: M3 Complete (`REC-06`–`REC-10` + `scripts/test-m3.mjs` CI gate) -> Ready for M4 (`REC-11`–`REC-14`)
- **Next Resumable Step**: M4 — Implement `REC-11` (Expand `eval/golden.json` to 50–60 cases & strict `eval-parser.mjs`), `REC-12` (API/Store/Docker hardening), `REC-13` (UX polish & KPI), `REC-14` (90s finale E2E & final PDF sync)
- **Repository Branch**: `feat/round2-submission` (branched from `master` @ `42448d4`)

---

## M0 — Bootstrap, Resumable Checklist & CI Foundation
- [x] Clone `https://github.com/BangerSoul/vyaparvani.git` safely into `/home/bangersoul/Projects/vyaparvani` alongside untouched `vyaparvani-idea.pdf`
- [x] Create and checkout dedicated branch `feat/round2-submission` from `master`
- [x] Inspect `.gitignore`, `git status`, and `git log -n 3`
- [x] Create resumable P0–P3 `CHECKLIST.md` covering `REC-01`–`REC-14`, `REC-05` + Round 2 Req 3.3, and CI verification
- [x] Add `"typecheck": "tsc --noEmit"` to `package.json` scripts
- [x] Create `.github/workflows/ci.yml` (`typecheck-build-eval` in no-key Demo mode + `docker-build`)
- [x] Commit M0 files and push to `origin feat/round2-submission`
- [x] Verify baseline GitHub Actions CI run passes on `feat/round2-submission` (Run ID `45986618520`: `typecheck-build-eval` = `success`, `docker-build` = `success`)

---

## M1 — P0 Critical Demo-Savers (`REC-01`–`REC-04`)

### REC-01: Fix `MicControl` Stop Lifecycle, Transcript Accumulation & `SpeechInputAdapter`
- [x] Extract `SpeechInputAdapter` interface (`isSupported`, `start`, `stop`) in `src/lib/speech-adapter.ts` with `WebSpeechAdapter` implementation
- [x] Update `src/components/MicControl.tsx` so clicking Stop invokes `recRef.current?.stop()` / `adapter.stop()` before `onStop`
- [x] Accumulate finalized speech segments in `finalTextRef` across `e.resultIndex` events (resetting `finalTextRef.current = ""` on `start()`) and emit `(finalTextRef.current + interim).trim()`
- [x] Verify `src/app/page.tsx` transcript state updates cleanly without dropping prior finalized phrases

### REC-02: Harden `demo-parser.ts` & `route.ts` Error Boundary
- [x] Wrap `parseDemoUtterance(utterance)` in `src/app/api/parse/route.ts` inside `try/catch` returning structured `400`/`422` JSON instead of HTTP 500
- [x] Add Devanagari-to-Hinglish normalization (`०-९` -> `0-9`, `किलो`, `चावल`, `उधार`, `रुपये`, `भेज दो`, etc.) in `src/lib/demo-parser.ts`
- [x] Require mandatory `party` on ledger entries (`if (!party)` instead of `if (!party && !isLedger)`), emitting `missing: ["party"]`, `confidence <= 0.55`, and `"Kis ke khate mein likhna hai?"`
- [x] Pre-split attached currency/unit tokens (`250rs`, `₹500`, `500/-`, `5kg`) before tokenization/number parsing
- [x] Allow `NUM_WORDS` directly before `KNOWN_PRODUCTS` (e.g., `"paanch chawal Gupta store ko bhej do"`) while still guarding trailing verb `"do"`
- [x] Fix `lastProduct` binding for `<product> <qty> <unit>` before consuming subsequent items/parties
- [x] Fix price-order phrasing (`"50 rupaye ka tel"`, `"100 rs ki chini"`) so orders with prices are not misclassified as ledgers unless ledger intent words appear
- [x] Widen `partyMatch`/`nameMatch` (`se` postposition for `wasooli`, multi-word names, `mart`/`bhaiya`/`ji`, guard against `LEDGER_WORDS`/`UNITS`)
- [x] Add Indian fractions (`aadha`/`adha`, `paav`/`pao`, `sava`, `dedh`, `dhai`, `saadhe`)
- [x] Compute `relativeDate()` using IST (`Asia/Kolkata`) instead of UTC `toISOString()`

### REC-03: Schema `nonnegative()` Quantity, UI Confirm Guard & Dynamic IST Prompt
- [x] Update `src/lib/schema.ts` `quantity` from `z.number().positive()` to `z.number().nonnegative()`
- [x] Propagate `missing: string[]` onto `Entry` in `src/lib/store.ts` (`toDraft`)
- [x] Guard `confirmEntry` in `src/app/page.tsx` when `items.some(it => it.quantity <= 0)`, `missing.length > 0`, empty items + null amount, or blank required `party` (with toast/edit guidance)
- [x] Replace static `SYSTEM_PROMPT` with dynamic `buildSystemPrompt(istTodayIso)` in `src/lib/schema.ts` and `src/app/api/parse/route.ts`

### REC-04: Structured Clarification Merge & Mixed `order`+`udhaar` Card Display/Edit
- [x] Track `clarifyingEntryId` in `src/app/page.tsx` and highlight the card being clarified
- [x] Extend `POST /api/parse` (`route.ts`) to accept `{ utterance, existingEntry? }`
- [x] Implement structured field-aware clarification merging in `demo-parser.ts` (patch `missing` fields like `party`, `items`, `quantity`, `product` in place without spawning orphan cards) and in LLM prompt (`route.ts`)
- [x] Update `EntryCard.tsx` read view to display `amount` (`Purana udhaar / Raqam: ₹...`) on mixed `order`+`udhaar` cards even when `items.length > 0`
- [x] Update `EntryCard.tsx` edit view to allow editing `Raqam (₹)` on any entry, adding/removing items (`+ Add item` / `× Remove`), toggling `type` (`order` <-> `ledger`), and editing `dueDate`
- [x] Verify M1 via GitHub Actions CI (`typecheck`, `build`, `eval`, `docker-build`) + `scripts/test-p0.mjs` (Run ID `45988574350`: `26/26 exact-match`, `14/14` P0 checks passed, `docker-build` = `success`)

---

## M2 — `vyaparvani-idea` Deck Pipeline Rebuild (`REC-05` & Round 2 Req 3.3)
- [x] Capture genuine rendered Counter Desk UI screenshot (`decks/assets/ui-screenshot.png`) via Playwright/Chromium in CI (or verified build pipeline) running the live app in Demo mode
- [x] Create deterministic native-text PDF build script `scripts/build-deck.py` (`reportlab` + `PIL`, 16:9 `960x540` pt, embedded TrueType fonts) driven by `decks/vyaparvani-idea.deck.json`
- [x] Fix Slide 3: render `decks/vyaparvani-idea.deck.json` `body` narrative cleanly
- [x] Fix Slide 4 (`REC-05`): replace diagonal-striped placeholder with the real UI screenshot (`decks/assets/ui-screenshot.png`)
- [x] Fix Slide 6 (`REC-05`): show accuracy % across categories with explicit sample sizes (`n=21`, `n=4`, `n=1`) and clearly distinguish Demo Regex Eval vs. Live `gpt-4o-mini` LLM Eval
- [x] Fix Slide 8 (Round 2 Req 3.3): add dependency cost estimates, rate-limit handling (1x 429 retry today; backoff in M4), and outage/no-key fallback details matching shipped code
- [x] Fix Slide 12 (REC-05): align "Wispr Flow" claim with shipped Web Speech + typed Hinglish workflow today and tag Wispr Flow Dictation Mode / Whisper fallback as (M3) until REC-06 ships
- [x] Generate `/home/bangersoul/Projects/vyaparvani/vyaparvani-idea.pdf` and verify `<= 10 MB`, 12 slides, non-empty `pdftotext` output on every slide (1–12), and visual inspection via `pdftoppm`

---

## M3 — P1 Differentiation & Core Product Loops (`REC-06`–`REC-10`)

### REC-06: Wispr Flow Dictation Mode + Whisper Audio Fallback (`/api/transcribe`)
- [x] Add `POST /api/transcribe` (`src/app/api/transcribe/route.ts`) accepting `multipart/form-data` audio blob for OpenAI Whisper transcription (server key or `x-openai-key`)
- [x] Implement `WhisperApiAdapter` (`MediaRecorder` -> `/api/transcribe`) in `src/lib/speech-adapter.ts` for Safari/Firefox and noisy-counter fallback when key is available
- [x] Add `"Wispr Flow Dictation Mode"` in `src/app/page.tsx` (auto-focus/pause-triggered auto-parse listener on `#typed` + documented kirana Hinglish custom dictionary/snippets drawer)

### REC-07: Signed Khata Direction (`ledgerAction`) & `Khata (Parties)` Tab
- [x] Add `ledgerAction: z.enum(["credit_given", "payment_received"]).nullable().default(null)` to `src/lib/schema.ts` and `Entry` in `src/lib/store.ts`
- [x] Parse `credit_given` (`udhaar`/`baki`/`likh`) vs `payment_received` (`wasooli`/`jama`/`clear`) in `src/lib/demo-parser.ts` and `buildSystemPrompt`
- [x] Compute live per-party net balances (`credit_given - payment_received`) in `src/lib/store.ts`
- [x] Add 4th tab `Khata (Parties)` in `src/app/page.tsx` displaying per-party net balances, settled status, filter by party, and 1-click `"Wasooli record karo"`

### REC-08: 1-Tap WhatsApp `wa.me` Slips & Distributor CSV Export
- [x] Add 1-tap `WhatsApp pe bhejein` (`https://wa.me/?text=...`) order/udhaar slip button on confirmed `EntryCard`s and `Khata (Parties)` rows
- [x] Add `Distributor Order Sheet (CSV)` export/copy action in `src/app/page.tsx` aggregating confirmed orders

### REC-09: Lightweight Voice-Driven Stock Deduction & Low-Stock Alerts
- [x] Create `src/lib/inventory.ts` with `localStorage`-persisted common kirana SKUs, order confirmation stock deduction, voice restock parsing/handling, and low-stock threshold alerts
- [x] Integrate stock view/alerts and low-stock reorder pulse into `src/app/page.tsx` (ensuring copy matches shipped scope 100%)

### REC-10: True Hands-Free Mode (Auto-Submit + `hi-IN` TTS Readback)
- [x] Add `"Hands-free mode"` toggle in `src/app/page.tsx` / `MicControl.tsx`
- [x] Auto-submit transcript on speech end and speak 1-second Hinglish summary via `window.speechSynthesis` (`lang="hi-IN"`)
- [ ] Verify M3 via GitHub Actions CI (`typecheck`, `build`, `eval`, `docker-build`)

---

## M4 — P2–P3 Hardening, Eval 50–60, UX Polish & Finale (`REC-11`–`REC-14`)

### REC-11: Expanded `eval/golden.json` (50–60 Cases) & Strict Eval + CI Gate
- [ ] Expand `eval/golden.json` from 26 to 50–60 cases (Devanagari `hi-IN`, zero-qty/nameless-ledger safety, Indian fractions, attached currency `250rs`/`₹500`, price-orders, multi-word parties/items, `ledgerAction`, `dueDate`)
- [ ] Upgrade `scripts/eval-parser.mjs` to assert full `product` string (not `split(" ")[0]`), `dueDate`, `ledgerAction`, and exit non-zero (`process.exitCode = 1`) on any failure
- [ ] Document both Demo mode and `gpt-4o-mini` mode eval scores + median/p95 latency in `README.md` and `decks/vyaparvani-idea.deck.json`

### REC-12: API, Storage & Standalone Docker Hardening
- [ ] Clean unused imports (`z`, `parsedEntrySchema`) in `src/app/api/parse/route.ts`
- [ ] Wire `AbortController` + `clearTimeout` into `generateObject({ abortSignal })`, add exponential backoff on `429`, and map `401` invalid key errors to HTTP `401`
- [ ] Add `GET /api/health` (`src/app/api/health/route.ts`) and update `Dockerfile` `HEALTHCHECK`
- [ ] Wrap `saveEntries` in `try/catch` and export `StorageAdapter` + JSON backup/import in `src/lib/store.ts`
- [ ] Enable `output: "standalone"` in `next.config.mjs` and slim `Dockerfile` runtime stage (copying `.next/standalone` + `.next/static`)

### REC-13: Judge-Friendly Sandbox UX, TS Cleanup & Telemetry
- [ ] Fix `saveKey` TS/form handler (`<button type="submit">` + `sk-` prefix validation) in `src/app/page.tsx`
- [ ] Add 4 clickable Hinglish sample chips below `#typed`
- [ ] Make toast `fixed bottom-4 left-1/2 -translate-x-1/2 z-50` and set `<html lang="hi-Latn">` in `src/app/layout.tsx`
- [ ] Group entries into `Aaj` vs `Pichhle din`
- [ ] Track `edited?: boolean` on `Entry` and render live `No-edit accuracy` KPI pill

### REC-14: 90-Second Finale Loop Verification & Final Sync
- [ ] Add automated Playwright E2E test (run in CI in no-key Demo mode) verifying the 4-beat 90-second finale flow: mixed entry -> inline clarification patch -> `Khata (Parties)` net balance + low-stock alert -> 1-tap WhatsApp slip
- [ ] Refresh `decks/assets/ui-screenshot.png` and rebuild `/home/bangersoul/Projects/vyaparvani/vyaparvani-idea.pdf` with final shipped UI and verified 50–60 eval metrics
- [ ] Final push to `origin feat/round2-submission` and confirm all GitHub Actions CI checks pass green
