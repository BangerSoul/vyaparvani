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

export function loadEntries(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map((e) => ({
      ...e,
      ledgerAction:
        e?.ledgerAction === "credit_given" || e?.ledgerAction === "payment_received"
          ? e.ledgerAction
          : e?.type === "ledger"
            ? "credit_given"
            : null,
      missing: Array.isArray(e?.missing) ? e.missing : [],
    }));
  } catch {
    return [];
  }
}

export function saveEntries(entries: Entry[]) {
  localStorage.setItem(KEY, JSON.stringify(entries));
}
