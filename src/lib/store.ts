import type { ParsedEntry, EntryItem, LedgerAction } from "./schema";

export type Entry = {
  id: string;
  createdAt: string;
  status: "draft" | "confirmed";
  type: "order" | "ledger";
  ledgerAction: LedgerAction;
  items: EntryItem[];
  party: string;
  dueDate: string;
  amount: number | null;
  confidence: number;
  missing: string[];
  clarification: string;
  source: string; // original utterance
  mode: "demo" | "model";
  stockDeducted?: boolean;
  edited?: boolean;
};

export function toDraft(parsed: ParsedEntry, source: string, mode: "demo" | "model"): Entry {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    status: "draft",
    type: parsed.type,
    ledgerAction:
      parsed.ledgerAction ?? (parsed.type === "ledger" ? "credit_given" : null),
    items: parsed.items,
    party: parsed.party,
    dueDate: parsed.dueDate,
    amount: parsed.amount,
    confidence: parsed.confidence,
    missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    clarification: parsed.clarification,
    source,
    mode,
  };
}

export function buildWasooliEntry(party: string, amount: number): Entry {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    status: "confirmed",
    type: "ledger",
    ledgerAction: "payment_received",
    items: [],
    party: party.trim(),
    dueDate: "",
    amount,
    confidence: 1,
    missing: [],
    clarification: "",
    source: `${party.trim()} se ₹${amount} wasooli record`,
    mode: "demo",
  };
}

export type PartyKhataSummary = {
  partyKey: string;
  party: string;
  creditTotal: number;
  paidTotal: number;
  netBalance: number;
  entryCount: number;
  lastUpdated: string;
};

export function computePartyBalances(entries: Entry[]): PartyKhataSummary[] {
  const byParty = new Map<string, PartyKhataSummary>();
  for (const e of entries) {
    if (e.status !== "confirmed") continue;
    const partyName = (e.party || "").trim();
    if (!partyName) continue;
    if (e.amount === null || !Number.isFinite(e.amount) || e.amount <= 0) continue;
    if (e.type !== "ledger" && e.ledgerAction === null) continue;

    const key = partyName.toLowerCase();
    const acc = byParty.get(key) ?? {
      partyKey: key,
      party: partyName,
      creditTotal: 0,
      paidTotal: 0,
      netBalance: 0,
      entryCount: 0,
      lastUpdated: e.createdAt,
    };

    const action = e.ledgerAction ?? "credit_given";
    if (action === "payment_received") {
      acc.paidTotal += e.amount;
    } else {
      acc.creditTotal += e.amount;
    }
    acc.netBalance = acc.creditTotal - acc.paidTotal;
    acc.entryCount += 1;
    if (e.createdAt > acc.lastUpdated) {
      acc.lastUpdated = e.createdAt;
      acc.party = partyName;
    }
    byParty.set(key, acc);
  }

  return Array.from(byParty.values()).sort((a, b) => {
    if (b.netBalance !== a.netBalance) return b.netBalance - a.netBalance;
    return b.lastUpdated.localeCompare(a.lastUpdated);
  });
}

const KEY = "vyaparvani.entries.v1";

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface StorageAdapter {
  load(): Entry[];
  save(entries: Entry[]): boolean | void;
  exportJson?(entries?: Entry[]): string;
  importJson?(raw: string): Entry[];
}

function normalizeEntry(raw: unknown): Entry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const type: "order" | "ledger" = e.type === "ledger" ? "ledger" : "order";
  const status: "draft" | "confirmed" = e.status === "confirmed" ? "confirmed" : "draft";
  const ledgerAction: LedgerAction =
    e.ledgerAction === "credit_given" || e.ledgerAction === "payment_received"
      ? e.ledgerAction
      : type === "ledger"
        ? "credit_given"
        : null;

  const items: EntryItem[] = Array.isArray(e.items)
    ? e.items
        .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === "object"))
        .map((it) => ({
          product: typeof it.product === "string" ? it.product : "",
          quantity:
            typeof it.quantity === "number" && Number.isFinite(it.quantity) && it.quantity >= 0
              ? it.quantity
              : 0,
          unit: typeof it.unit === "string" ? it.unit : "",
        }))
        .filter((it) => it.product.trim().length > 0)
    : [];

  return {
    id: typeof e.id === "string" && e.id.trim() ? e.id : newId(),
    createdAt:
      typeof e.createdAt === "string" && e.createdAt.trim()
        ? e.createdAt
        : new Date().toISOString(),
    status,
    type,
    ledgerAction,
    items,
    party: typeof e.party === "string" ? e.party : "",
    dueDate: typeof e.dueDate === "string" ? e.dueDate : "",
    amount: typeof e.amount === "number" && Number.isFinite(e.amount) ? e.amount : null,
    confidence:
      typeof e.confidence === "number" && Number.isFinite(e.confidence)
        ? Math.min(1, Math.max(0, e.confidence))
        : 0.5,
    missing: Array.isArray(e.missing)
      ? e.missing.filter((m): m is string => typeof m === "string")
      : [],
    clarification: typeof e.clarification === "string" ? e.clarification : "",
    source: typeof e.source === "string" ? e.source : "",
    mode: e.mode === "model" ? "model" : "demo",
    ...(typeof e.stockDeducted === "boolean" ? { stockDeducted: e.stockDeducted } : {}),
    ...(typeof e.edited === "boolean" ? { edited: e.edited } : {}),
  };
}

function normalizeEntries(list: unknown[]): Entry[] {
  const out: Entry[] = [];
  for (const item of list) {
    const normalized = normalizeEntry(item);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function exportEntriesJson(entries: Entry[]): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2,
  );
}

export function importEntriesJson(raw: string): Entry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON backup");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : null;
  if (!list) {
    throw new Error("Backup JSON must be an Entry[] or { version: 1, entries: Entry[] }");
  }
  return normalizeEntries(list);
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly storageKey = KEY) {}

  load(): Entry[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return [];
      const list: unknown = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return normalizeEntries(list);
    } catch {
      return [];
    }
  }

  save(entries: Entry[]): boolean {
    if (typeof window === "undefined") return false;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(entries));
      return true;
    } catch (err: unknown) {
      console.warn("Failed to save entries to localStorage:", err);
      return false;
    }
  }

  exportJson(entries?: Entry[]): string {
    return exportEntriesJson(entries ?? this.load());
  }

  importJson(raw: string): Entry[] {
    return importEntriesJson(raw);
  }
}

export const defaultStorageAdapter = new LocalStorageAdapter();

export function loadEntries(): Entry[] {
  return defaultStorageAdapter.load();
}

export function saveEntries(entries: Entry[]): boolean {
  return defaultStorageAdapter.save(entries);
}
