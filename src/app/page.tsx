"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MicControl from "@/components/MicControl";
import EntryCard from "@/components/EntryCard";
import { loadEntries, saveEntries, toDraft, type Entry } from "@/lib/store";
import type { ParsedEntry } from "@/lib/schema";

type Status = "idle" | "listening" | "parsing" | "error";

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState<"all" | "order" | "ledger">("all");
  const [mounted, setMounted] = useState(false);
  const [hasServerKey, setHasServerKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const textRef = useRef<HTMLInputElement>(null);

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

  const filtered = useMemo(
    () =>
      entries
        .filter((e) => filter === "all" || e.type === filter)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [entries, filter],
  );

  const readTyped = () => (textRef.current?.value || "").trim();

  async function parseAndAdd(text: string) {
    const utterance = text.trim();
    if (!utterance) return;
    setStatus("parsing");
    setErrorMsg("");
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-openai-key": apiKey } : {}),
        },
        body: JSON.stringify({ utterance }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `Server ne ${res.status} bheja`);
      }
      const parsed: { entries: ParsedEntry[]; mode?: "demo" | "model" } = await res.json();
      const mode = parsed.mode === "model" ? "model" : "demo";
      const drafts = parsed.entries.map((e) => toDraft(e, utterance, mode));
      setEntries((prev) => [...drafts, ...prev]);
      setTranscript("");
      if (textRef.current) textRef.current.value = "";
      setStatus("idle");
      const unsure = drafts.some((d) => d.confidence < 0.6);
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
    setToast("Entry delete ho gayi.");
  }

  function confirmEntry(id: string) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: "confirmed", confidence: Math.max(e.confidence, 1) } : e)),
    );
    setToast("Entry save ho gayi.");
  }

  function clarify(entry: Entry) {
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
            <h2 className="text-sm font-semibold text-inkSoft">Live transcript</h2>
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
            parseAndAdd(readTyped());
          }}
        >
          <label htmlFor="typed" className="block text-sm font-medium text-inkSoft">
            Ya type karke boliye (mic na chale to)
          </label>
          <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <input
              id="typed"
              ref={textRef}
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
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink">Aaj ki entries</h2>
          <div role="tablist" aria-label="Filter entries" className="flex gap-1 rounded-card border border-line bg-card p-1">
            {(["all", "order", "ledger"] as const).map((f) => (
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
                {f === "all" ? "Sab" : f === "order" ? "Orders" : "Udhaar"}
              </button>
            ))}
          </div>
        </div>

        {status === "parsing" && (
          <p className="mt-4 rounded-card border border-line bg-card p-4 text-sm text-inkSoft" role="status">
            Aapki baat samajh raha hoon…
          </p>
        )}

        {!hydrated ? null : filtered.length === 0 ? (
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
