"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MicControl from "@/components/MicControl";
import EntryCard from "@/components/EntryCard";
import {
  buildWasooliEntry,
  computePartyBalances,
  loadEntries,
  saveEntries,
  toDraft,
  type Entry,
} from "@/lib/store";
import {
  buildDistributorCsv,
  buildKhataWhatsAppUrl,
} from "@/lib/share";
import type { ParsedEntry } from "@/lib/schema";
import {
  WebSpeechAdapter,
  WhisperApiAdapter,
  type SpeechInputAdapter,
} from "@/lib/speech-adapter";

type Status = "idle" | "listening" | "parsing" | "error";

const KIRANA_DICTIONARY_TERMS = [
  "drib",
  "kalawa",
  "peti",
  "darjan",
  "wasooli",
  "udhaar",
  "chawal",
  "atta",
  "Gupta Store",
  "Sharma Kirana",
];

const WISPR_SNIPPETS = [
  "5 kg chawal Gupta store ko bhej do",
  "1 drib tel Verma store ke liye",
  "8 kalawa agarbatti Sharma kirana ko",
  "Sharma kirana se 300 wasooli",
];

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState<"all" | "order" | "ledger" | "khata">("all");
  const [selectedPartyKey, setSelectedPartyKey] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [hasServerKey, setHasServerKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [clarifyingEntryId, setClarifyingEntryId] = useState<string | null>(null);
  const [wisprMode, setWisprMode] = useState(false);
  const [showDictionary, setShowDictionary] = useState(false);
  const [useWhisperFallback, setUseWhisperFallback] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);
  const wisprTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  const clearWisprTimer = useCallback(() => {
    if (wisprTimerRef.current) {
      clearTimeout(wisprTimerRef.current);
      wisprTimerRef.current = null;
    }
  }, []);

  const clarifyingEntry = useMemo(
    () => entries.find((e) => e.id === clarifyingEntryId) ?? null,
    [entries, clarifyingEntryId],
  );

  useEffect(() => {
    setMounted(true);
    try {
      setApiKey(sessionStorage.getItem("vyaparvani.key") || "");
    } catch {
      setApiKey("");
    }
    fetch("/api/parse")
      .then((r) => r.json())
      .then((d) => setHasServerKey(Boolean(d.hasServerKey)))
      .catch(() => setHasServerKey(false));
  }, []);

  const keyReady = Boolean(apiKey) || hasServerKey;

  const webSpeechSupported = useMemo(
    () => (mounted ? new WebSpeechAdapter("hi-IN").isSupported() : true),
    [mounted],
  );

  const speechAdapter = useMemo<SpeechInputAdapter>(() => {
    if (mounted && keyReady && (!webSpeechSupported || useWhisperFallback)) {
      return new WhisperApiAdapter({ getApiKey: () => apiKeyRef.current });
    }
    return new WebSpeechAdapter("hi-IN");
  }, [mounted, keyReady, webSpeechSupported, useWhisperFallback]);

  const usingWhisper = mounted && keyReady && (!webSpeechSupported || useWhisperFallback);

  useEffect(() => {
    if (wisprMode) {
      textRef.current?.focus();
    } else {
      clearWisprTimer();
    }
  }, [wisprMode, clearWisprTimer]);

  useEffect(() => () => clearWisprTimer(), [clearWisprTimer]);

  function saveKey(e: React.FormEvent) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    try {
      sessionStorage.setItem("vyaparvani.key", key);
    } catch {
      // session-only key is best-effort; keep it in memory regardless
    }
    setApiKey(key);
    setKeyInput("");
    setToast("API key set — ab real model se parsing hogi.");
  }

  function removeKey() {
    try {
      sessionStorage.removeItem("vyaparvani.key");
    } catch {
      // ignore
    }
    setApiKey("");
    setToast("API key hatadi — demo parser wapas chal raha hai.");
  }

  useEffect(() => {
    setEntries(loadEntries());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveEntries(entries);
  }, [entries, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 12000);
    return () => clearTimeout(t);
  }, [toast]);

  const partyBalances = useMemo(() => computePartyBalances(entries), [entries]);

  const confirmedOrderItemsCount = useMemo(
    () =>
      entries.filter(
        (e) => e.status === "confirmed" && e.type === "order" && e.items.length > 0,
      ).length,
    [entries],
  );

  function downloadDistributorCsv() {
    const csv = buildDistributorCsv(entries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vyaparvani-distributor-orders.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast("Distributor Order Sheet CSV download ho gaya.");
  }

  function copyDistributorCsv() {
    const csv = buildDistributorCsv(entries);
    navigator.clipboard?.writeText(csv);
    setToast("Distributor Order Sheet CSV copied.");
  }

  const filtered = useMemo(
    () =>
      entries
        .filter((e) => {
          if (filter !== "all" && filter !== "khata" && e.type !== filter) return false;
          if (selectedPartyKey && (e.party || "").trim().toLowerCase() !== selectedPartyKey) {
            return false;
          }
          return true;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [entries, filter, selectedPartyKey],
  );

  const readTyped = () => (textRef.current?.value || "").trim();

  async function parseAndAdd(text: string) {
    clearWisprTimer();
    const utterance = text.trim();
    if (!utterance) return;
    setStatus("parsing");
    setErrorMsg("");
    const activeClarify = clarifyingEntry;
    try {
      const payload = activeClarify
        ? {
            utterance,
            existingEntry: {
              type: activeClarify.type,
              ledgerAction: activeClarify.ledgerAction,
              items: activeClarify.items,
              party: activeClarify.party,
              dueDate: activeClarify.dueDate,
              amount: activeClarify.amount,
              confidence: activeClarify.confidence,
              missing: activeClarify.missing,
              clarification: activeClarify.clarification,
              source: activeClarify.source,
            },
          }
        : { utterance };
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-openai-key": apiKey } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `Server ne ${res.status} bheja`);
      }
      const parsed: { entries: ParsedEntry[]; mode?: "demo" | "model" } = await res.json();
      const mode = parsed.mode === "model" ? "model" : "demo";

      if (activeClarify && parsed.entries.length > 0) {
        const patched = parsed.entries[0];
        setEntries((prev) =>
          prev.map((e) =>
            e.id === activeClarify.id
              ? {
                  ...e,
                  type: patched.type,
                  ledgerAction:
                    patched.ledgerAction ?? (patched.type === "ledger" ? "credit_given" : null),
                  items: patched.items,
                  party: patched.party,
                  dueDate: patched.dueDate,
                  amount: patched.amount,
                  confidence: patched.confidence,
                  missing: Array.isArray(patched.missing) ? patched.missing : [],
                  clarification: patched.clarification,
                  source: `${e.source} — ${utterance}`,
                  mode,
                  status: "draft",
                }
              : e,
          ),
        );
        setClarifyingEntryId(null);
        setTranscript("");
        if (textRef.current) {
          textRef.current.value = "";
          if (wisprMode) textRef.current.focus();
        }
        setStatus("idle");
        const stillUnsure = patched.confidence < 0.6 || (patched.missing?.length ?? 0) > 0;
        setToast(
          stillUnsure
            ? "Entry update hui — ek aur sawaal baaki hai."
            : "Entry clear ho gayi, confirm kijiye.",
        );
        return;
      }

      const drafts = parsed.entries.map((e) => toDraft(e, utterance, mode));
      setEntries((prev) => [...drafts, ...prev]);
      setTranscript("");
      if (textRef.current) {
        textRef.current.value = "";
        if (wisprMode) textRef.current.focus();
      }
      setStatus("idle");
      const unsure = drafts.some((d) => d.confidence < 0.6 || d.missing.length > 0);
      setToast(unsure ? "Entry bani hai — ek sawaal poochhna hai." : "Entry ban gayi, confirm kijiye.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Kuch galat ho gaya");
      setStatus("error");
    }
  }

  function updateEntry(id: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function deleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (clarifyingEntryId === id) setClarifyingEntryId(null);
    setToast("Entry delete ho gayi.");
  }

  function confirmEntry(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    if (!entry.party.trim()) {
      setToast("Party / dukaan ka naam zaroori hai — Edit ya Clarify kijiye.");
      return;
    }
    if (entry.items.some((it) => !Number.isFinite(it.quantity) || it.quantity <= 0)) {
      setToast("Har item ki matra 0 se zyada honi chahiye — Edit karke sahi matra daaliye.");
      return;
    }
    if (entry.missing.length > 0) {
      setToast("Entry adhuri hai — pehle Edit ya Clarify kijiye.");
      return;
    }
    if (entry.items.length === 0 && (entry.amount === null || entry.amount <= 0)) {
      setToast("Koi item ya raqam daaliye pehle.");
      return;
    }
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, status: "confirmed", confidence: Math.max(e.confidence, 1), missing: [] }
          : e,
      ),
    );
    if (clarifyingEntryId === id) setClarifyingEntryId(null);
    setToast("Entry save ho gayi.");
  }

  function clarify(entry: Entry) {
    setClarifyingEntryId(entry.id);
    setTranscript("");
    setStatus("idle");
    const el = textRef.current;
    if (el) {
      el.value = "";
      el.focus();
    }
    setToast(entry.clarification || "Bataiye — kya aur kitna?");
  }

  const listening = status === "listening";

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-inkSoft">VyaparVani</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-ink sm:text-4xl">
          Bolo, samajh gaya, likh diya.
        </h1>
        <p className="mt-3 max-w-xl text-base text-inkSoft">
          Speak naturally in Hinglish — ‘5 kg chawal Gupta store ko bhej do’ — and VyaparVani turns it
          into a confirmed order or ledger entry. No typing while customers wait.
        </p>
      </header>

      {/* API key status: the app must start fully usable with no key (demo parser) */}
      {mounted && !keyReady && (
        <section
          aria-label="API key setup"
          className="mt-6 rounded-card border border-[#E4C88A] bg-[#FBF3DF] p-4"
        >
          <p className="text-sm font-semibold text-[#7A5A12]">
            API key set nahi hai — abhi demo parser chal raha hai.
          </p>
          <p className="mt-1 text-sm text-[#8A6B22]">
            Voice processing ke liye apni OpenAI key yahan daaliye. Key sirf is browser session mein
            rehti hai, server par save nahi hoti.
          </p>
          <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={saveKey}>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-card border border-[#E4C88A] bg-white px-3 py-2 text-base text-ink"
            />
            <button
              type="button"
              onClick={saveKey}
              className="shrink-0 rounded-card bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Key save kijiye
            </button>
          </form>
        </section>
      )}
      {mounted && apiKey && !hasServerKey && (
        <p className="mt-6 flex items-center justify-between gap-3 rounded-card border border-[#B9D3B0] bg-[#EFF5EC] p-3 text-sm text-[#3C6B2F]">
          <span>API key set — ab real model se parsing hogi.</span>
          <button
            type="button"
            onClick={removeKey}
            className="shrink-0 text-xs font-semibold underline hover:opacity-80"
          >
            Key hatayein
          </button>
        </p>
      )}

      {/* Mic control: the dominant element on the counter */}
      <section
        aria-label="Voice entry"
        className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm"
      >
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between">
          <MicControl
            listening={listening}
            disabled={!mounted || status === "parsing"}
            adapter={speechAdapter}
            onStart={() => {
              setStatus("listening");
              setErrorMsg("");
            }}
            onStop={() => setStatus((s) => (s === "listening" ? "idle" : s))}
            onResult={(final, interim) => setTranscript((final + interim).trim())}
            onError={(m) => {
              setErrorMsg(m === "not-allowed" ? "Mic ki permission nahi mili." : `Mic error: ${m}`);
              if (m !== "no-speech") setStatus("error");
            }}
          />
          <div className="w-full sm:max-w-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-inkSoft">Live transcript</h2>
              {mounted && keyReady && (
                <button
                  type="button"
                  aria-pressed={usingWhisper}
                  onClick={() => setUseWhisperFallback((v) => !v)}
                  disabled={!webSpeechSupported}
                  className={[
                    "rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
                    usingWhisper
                      ? "border-saffron bg-[#FBF1E3] text-saffronDeep"
                      : "border-line bg-surface text-inkSoft hover:bg-[#F3EDE0]",
                    !webSpeechSupported ? "cursor-default" : "",
                  ].join(" ")}
                >
                  {usingWhisper ? "Whisper ASR ON" : "Whisper ASR"}
                </button>
              )}
            </div>
            <p
              aria-live="polite"
              className="mt-2 min-h-[3.5rem] rounded-card bg-surface p-3 text-base leading-relaxed text-ink"
            >
              {transcript || <span className="text-inkSoft">Bolna shuru kijiye…</span>}
            </p>
            {transcript && (
              <button
                type="button"
                onClick={() => parseAndAdd(transcript)}
                disabled={!mounted || status === "parsing"}
                className="mt-3 w-full rounded-card bg-saffron px-4 py-2.5 text-sm font-semibold text-white hover:bg-saffronDeep disabled:opacity-40"
              >
                {status === "parsing" ? "Samajh raha hoon…" : "Samajh ke likh dijiye"}
              </button>
            )}
          </div>
        </div>

        <form
          className="mt-5 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            clearWisprTimer();
            parseAndAdd(readTyped());
          }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
              <input
                type="checkbox"
                checked={wisprMode}
                onChange={(e) => setWisprMode(e.target.checked)}
                className="h-4 w-4 rounded border-line accent-saffron"
              />
              <span>Wispr Flow Dictation Mode</span>
              <span className="font-normal text-inkSoft">
                (auto-focus + pause auto-parse)
              </span>
            </label>
            <button
              type="button"
              aria-expanded={showDictionary}
              onClick={() => setShowDictionary((v) => !v)}
              className="rounded-card border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-[#F3EDE0]"
            >
              Kirana dictionary (Wispr Flow)
            </button>
          </div>
          {showDictionary && (
            <div className="mb-3 rounded-card border border-line bg-surface p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">
                  Wispr Flow custom dictionary terms (Hinglish kirana)
                </p>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(KIRANA_DICTIONARY_TERMS.join(", "));
                    setToast("Kirana dictionary copied.");
                  }}
                  className="rounded-card border border-line bg-white px-2.5 py-1 font-semibold text-ink hover:bg-[#F3EDE0]"
                >
                  Copy dictionary
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {KIRANA_DICTIONARY_TERMS.map((term) => (
                  <span
                    key={term}
                    className="rounded-full border border-line bg-white px-2 py-0.5 text-inkSoft"
                  >
                    {term}
                  </span>
                ))}
              </div>
              <p className="mt-2.5 font-semibold text-inkSoft">Quick dictation snippets:</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {WISPR_SNIPPETS.map((snippet) => (
                  <button
                    key={snippet}
                    type="button"
                    onClick={() => {
                      clearWisprTimer();
                      if (textRef.current) {
                        textRef.current.value = snippet;
                        textRef.current.focus();
                      }
                    }}
                    className="rounded-card border border-line bg-white px-2.5 py-1 text-left text-ink hover:border-saffron hover:bg-[#FBF1E3]"
                  >
                    {snippet}
                  </button>
                ))}
              </div>
            </div>
          )}
          {clarifyingEntry && (
            <div
              role="status"
              className="mb-3 flex items-center justify-between gap-2 rounded-card border border-saffron bg-[#FBF1E3] px-3 py-2 text-sm text-saffronDeep"
            >
              <span>
                Clarifying draft:{" "}
                <strong className="font-semibold">“{clarifyingEntry.source}”</strong>
                {clarifyingEntry.clarification ? ` — ${clarifyingEntry.clarification}` : ""}
              </span>
              <button
                type="button"
                onClick={() => setClarifyingEntryId(null)}
                className="shrink-0 rounded border border-saffron/40 bg-white px-2.5 py-1 text-xs font-semibold text-saffronDeep hover:bg-[#F6EBDD]"
              >
                Cancel
              </button>
            </div>
          )}
          <label htmlFor="typed" className="block text-sm font-medium text-inkSoft">
            {clarifyingEntry
              ? "Is entry ka jawaab boliye ya type kijiye"
              : wisprMode
                ? "Wispr Flow active — seedha boliye, rukne par auto-parse hoga"
                : "Ya type karke boliye (mic na chale to)"}
          </label>
          <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <input
              id="typed"
              ref={textRef}
              onChange={(e) => {
                clearWisprTimer();
                if (!wisprMode || status === "parsing") return;
                const val = e.target.value.trim();
                const words = val.split(/\s+/).filter(Boolean).length;
                if (words >= 2 || /[.!?।]$/.test(val)) {
                  wisprTimerRef.current = setTimeout(() => {
                    const current = readTyped();
                    if (current) void parseAndAdd(current);
                  }, 1100);
                }
              }}
              className="w-full rounded-card border border-line bg-surface px-3 py-2 text-base text-ink"
              placeholder="5 kg chawal Gupta store ko bhej do"
              defaultValue=""
            />
            <button
              type="submit"
              disabled={!mounted || status === "parsing"}
              className="shrink-0 rounded-card bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              Bhejiye
            </button>
          </div>
        </form>

        {status === "error" && (
          <p role="alert" className="mt-4 rounded-card border border-[#D8A49A] bg-[#F8E9E5] p-3 text-sm text-[#A03325]">
            {errorMsg} — dobara koshish kijiye.
          </p>
        )}
      </section>

      {/* Entries */}
      <section className="mt-10" aria-label="Entries">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-ink">Aaj ki entries</h2>
          <div role="tablist" aria-label="Filter entries" className="flex flex-wrap gap-1 rounded-card border border-line bg-card p-1">
            {(["all", "order", "ledger", "khata"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={[
                  "rounded-[9px] px-3 py-1 text-sm font-semibold",
                  filter === f ? "bg-ink text-white" : "text-inkSoft hover:bg-surface",
                ].join(" ")}
              >
                {f === "all"
                  ? "Sab"
                  : f === "order"
                    ? "Orders"
                    : f === "ledger"
                      ? "Udhaar"
                      : "Khata (Parties)"}
              </button>
            ))}
          </div>
        </div>

        {confirmedOrderItemsCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={downloadDistributorCsv}
              className="rounded-card border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:bg-[#F3EDE0]"
            >
              Distributor Order Sheet (CSV)
            </button>
            <button
              type="button"
              onClick={copyDistributorCsv}
              className="rounded-card border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-inkSoft hover:bg-[#F3EDE0]"
            >
              Copy CSV
            </button>
          </div>
        )}

        {selectedPartyKey && filter !== "khata" && (
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-saffron bg-[#FBF1E3] px-3 py-1 text-xs font-semibold text-saffronDeep">
              Party filter: {partyBalances.find((p) => p.partyKey === selectedPartyKey)?.party ?? selectedPartyKey}
              <button
                type="button"
                aria-label="Clear party filter"
                onClick={() => setSelectedPartyKey(null)}
                className="font-bold hover:opacity-75"
              >
                ×
              </button>
            </span>
          </div>
        )}

        {status === "parsing" && (
          <p className="mt-4 rounded-card border border-line bg-card p-4 text-sm text-inkSoft" role="status">
            Aapki baat samajh raha hoon…
          </p>
        )}

        {!hydrated ? null : filter === "khata" ? (
          partyBalances.length === 0 ? (
            <div className="mt-4 rounded-card border border-dashed border-line bg-card p-8 text-center">
              <p className="text-base font-semibold text-ink">Abhi kisi party ka confirmed khata nahi hai.</p>
              <p className="mt-1 text-sm text-inkSoft">
                Udhaar ya wasooli entry confirm karne par party-wise net balance yahan dikhega.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {partyBalances.map((summary) => (
                <article
                  key={summary.partyKey}
                  aria-label={`Khata summary for ${summary.party}`}
                  className="rounded-card border border-line bg-card p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-ink">{summary.party}</h3>
                      <p className="mt-0.5 text-xs text-inkSoft">
                        Udhaar diya: ₹{summary.creditTotal} • Wasooli: ₹{summary.paidTotal} •{" "}
                        {summary.entryCount} confirmed
                      </p>
                    </div>
                    <span
                      className={[
                        "rounded-full px-3 py-1 text-xs font-bold",
                        summary.netBalance > 0
                          ? "bg-[#FBF1E3] text-saffronDeep"
                          : summary.netBalance === 0
                            ? "bg-[#E5F0E4] text-[#2E6B2E]"
                            : "bg-[#EEF3EC] text-ink",
                      ].join(" ")}
                    >
                      {summary.netBalance > 0
                        ? `₹${summary.netBalance} baki`
                        : summary.netBalance === 0
                          ? "Settled"
                          : `₹${Math.abs(summary.netBalance)} advance`}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPartyKey(summary.partyKey);
                        setFilter("all");
                      }}
                      className="rounded-card border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-[#F3EDE0]"
                    >
                      Entries dekhein
                    </button>
                    {summary.netBalance > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const wasooli = buildWasooliEntry(summary.party, summary.netBalance);
                          setEntries((prev) => [wasooli, ...prev]);
                          setToast(`${summary.party} ka ₹${summary.netBalance} wasooli record ho gaya.`);
                        }}
                        className="rounded-card bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                      >
                        Wasooli record karo
                      </button>
                    )}
                    <a
                      href={buildKhataWhatsAppUrl(summary)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-card border border-[#2E6B2E]/30 bg-[#E5F0E4] px-3 py-1.5 text-xs font-semibold text-[#2E6B2E] hover:opacity-90"
                    >
                      WhatsApp pe bhejein
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-line bg-card p-8 text-center">
            <p className="text-base font-semibold text-ink">Abhi koi entry nahi hai.</p>
            <p className="mt-1 text-sm text-inkSoft">
              Mic dabaake boliye — ‘3 packet surf Gupta store ko bhej do’ — entry yahan dikhegi.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {filtered.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                isClarifying={entry.id === clarifyingEntryId}
                onUpdate={updateEntry}
                onDelete={deleteEntry}
                onConfirm={confirmEntry}
                onClarify={clarify}
              />
            ))}
          </div>
        )}
      </section>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 rounded-card bg-ink px-4 py-3 text-center text-sm font-semibold text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
