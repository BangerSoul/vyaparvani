import type { ParsedEntry, EntryItem } from "./schema";

export type Entry = {
  id: string;
  createdAt: string;
  status: "draft" | "confirmed";
  type: "order" | "ledger";
  items: EntryItem[];
  party: string;
  dueDate: string;
  amount: number | null;
  confidence: number;
  clarification: string;
  source: string; // original utterance
  mode: "demo" | "model";
};

export function toDraft(parsed: ParsedEntry, source: string, mode: "demo" | "model"): Entry {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    status: "draft",
    type: parsed.type,
    items: parsed.items,
    party: parsed.party,
    dueDate: parsed.dueDate,
    amount: parsed.amount,
    confidence: parsed.confidence,
    clarification: parsed.clarification,
    source,
    mode,
  };
}

const KEY = "vyaparvani.entries.v1";

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadEntries(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveEntries(entries: Entry[]) {
  localStorage.setItem(KEY, JSON.stringify(entries));
}
