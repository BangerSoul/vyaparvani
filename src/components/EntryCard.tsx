"use client";

import { useState } from "react";
import type { Entry } from "@/lib/store";
import type { EntryItem, LedgerAction } from "@/lib/schema";
import { buildEntryWhatsAppUrl } from "@/lib/share";

type Props = {
  entry: Entry;
  isClarifying?: boolean;
  onUpdate: (id: string, patch: Partial<Entry>) => void;
  onDelete: (id: string) => void;
  onConfirm: (id: string) => void;
  onClarify: (entry: Entry) => void;
};

type EditDraft = {
  type: "order" | "ledger";
  ledgerAction: LedgerAction;
  party: string;
  items: EntryItem[];
  amount: number | null;
  dueDate: string;
};

function computeMissingFromFields(draft: EditDraft): string[] {
  const missing: string[] = [];
  if (!draft.party.trim()) {
    missing.push("party");
  }
  if (draft.type === "order") {
    if (draft.items.length === 0 && draft.amount === null) {
      missing.push("items");
    } else {
      if (draft.items.some((it) => !it.product.trim())) {
        missing.push("product");
      }
      if (draft.items.some((it) => !Number.isFinite(it.quantity) || it.quantity <= 0)) {
        missing.push("quantity");
      }
    }
  } else {
    if (draft.amount === null || !Number.isFinite(draft.amount) || draft.amount <= 0) {
      missing.push("amount");
    }
  }
  return missing;
}

export default function EntryCard({
  entry,
  isClarifying = false,
  onUpdate,
  onDelete,
  onConfirm,
  onClarify,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>({
    type: entry.type,
    ledgerAction: entry.ledgerAction ?? (entry.type === "ledger" ? "credit_given" : null),
    party: entry.party,
    items: entry.items.map((it) => ({ ...it })),
    amount: entry.amount,
    dueDate: entry.dueDate,
  });

  const lowConfidence = entry.confidence < 0.6 || entry.missing.length > 0;

  function beginEdit() {
    setDraft({
      type: entry.type,
      ledgerAction: entry.ledgerAction ?? (entry.type === "ledger" ? "credit_given" : null),
      party: entry.party,
      items: entry.items.map((it) => ({ ...it })),
      amount: entry.amount,
      dueDate: entry.dueDate,
    });
    setEditing(true);
  }

  function saveEdit() {
    const cleanedItems: EntryItem[] = draft.items
      .filter((it) => it.product.trim() !== "" || it.quantity > 0 || it.unit.trim() !== "")
      .map((it) => ({
        product: it.product.trim(),
        quantity: Number.isFinite(it.quantity) && it.quantity >= 0 ? it.quantity : 0,
        unit: it.unit.trim(),
      }));
    const normalizedAmount =
      draft.amount !== null && Number.isFinite(draft.amount) ? draft.amount : null;
    const normalizedAction: LedgerAction =
      draft.type === "ledger"
        ? draft.ledgerAction ?? "credit_given"
        : normalizedAmount !== null && normalizedAmount > 0
          ? draft.ledgerAction
          : null;
    const cleaned: EditDraft = {
      type: draft.type,
      ledgerAction: normalizedAction,
      party: draft.party.trim(),
      items: cleanedItems,
      amount: normalizedAmount,
      dueDate: draft.dueDate.trim(),
    };
    const missing = computeMissingFromFields(cleaned);
    const confidence = missing.length === 0 ? Math.max(entry.confidence, 0.85) : Math.min(entry.confidence, 0.5);
    const clarification =
      missing.length === 0
        ? ""
        : missing.includes("party")
          ? "Party / dukaan ka naam daaliye."
          : missing.includes("quantity")
            ? "Har item ki matra 0 se zyada rakhiye."
            : "Kripya adhuri jaankari bhariye.";

    onUpdate(entry.id, {
      ...cleaned,
      missing,
      confidence,
      clarification,
    });
    setEditing(false);
  }

  return (
    <article
      aria-label={entry.type === "order" ? "Order entry" : "Udhaar entry"}
      className={[
        "rounded-card border bg-card p-4 shadow-sm",
        isClarifying
          ? "border-2 border-saffron ring-2 ring-saffron/20"
          : lowConfidence && entry.status === "draft"
            ? "border-saffron"
            : "border-line",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={[
              "rounded-full px-2.5 py-0.5 text-xs font-semibold",
              entry.type === "order" ? "bg-[#EEF3EC] text-ink" : "bg-[#F6EBDD] text-saffronDeep",
            ].join(" ")}
          >
            {entry.type === "order" ? "Order" : "Udhaar / khata"}
          </span>
          {entry.ledgerAction && (
            <span
              className={[
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                entry.ledgerAction === "payment_received"
                  ? "bg-[#E5F0E4] text-[#2E6B2E]"
                  : "bg-[#FBF1E3] text-saffronDeep",
              ].join(" ")}
            >
              {entry.ledgerAction === "payment_received"
                ? "Wasooli / Jama (-₹)"
                : "Udhaar diya (+₹)"}
            </span>
          )}
          {entry.status === "confirmed" ? (
            <span className="rounded-full bg-[#E5F0E4] px-2.5 py-0.5 text-xs font-semibold text-[#2E6B2E]">
              Confirmed
            </span>
          ) : (
            <span className="rounded-full bg-[#F3EDE0] px-2.5 py-0.5 text-xs font-semibold text-inkSoft">
              Draft
            </span>
          )}
          {entry.mode === "demo" && (
            <span className="hidden rounded-full bg-[#EFEAE0] px-2.5 py-0.5 text-xs text-inkSoft sm:inline">
              Demo parser
            </span>
          )}
        </div>
        <span className="text-xs text-inkSoft">
          {new Date(entry.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {lowConfidence && entry.status === "draft" && !editing && (
        <div className="mt-3 rounded-card border border-saffron bg-[#FBF1E3] p-3">
          <p className="text-sm text-saffronDeep">
            Ye entry pakki nahi hai.{" "}
            {entry.clarification ? `Sawaal: ${entry.clarification}` : "Kripya check kijiye."}
          </p>
          <button
            type="button"
            onClick={() => onClarify(entry)}
            className="mt-2 rounded-card bg-saffron px-3 py-1.5 text-sm font-semibold text-white hover:bg-saffronDeep"
          >
            {isClarifying ? "Jawaab neeche likh rahe hain…" : "Clarify kijiye"}
          </button>
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-inkSoft">Type:</span>
            <button
              type="button"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  type: "order",
                }))
              }
              className={[
                "rounded-card border px-3 py-1 text-xs font-semibold",
                draft.type === "order"
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-surface text-inkSoft",
              ].join(" ")}
            >
              Order
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  type: "ledger",
                  ledgerAction: d.ledgerAction ?? "credit_given",
                }))
              }
              className={[
                "rounded-card border px-3 py-1 text-xs font-semibold",
                draft.type === "ledger"
                  ? "border-saffronDeep bg-saffronDeep text-white"
                  : "border-line bg-surface text-inkSoft",
              ].join(" ")}
            >
              Udhaar / khata
            </button>
          </div>

          {(draft.type === "ledger" || (draft.amount !== null && draft.amount > 0) || draft.ledgerAction !== null) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-inkSoft">Khata direction:</span>
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, ledgerAction: "credit_given" }))}
                className={[
                  "rounded-card border px-3 py-1 text-xs font-semibold",
                  draft.ledgerAction === "credit_given"
                    ? "border-saffronDeep bg-saffronDeep text-white"
                    : "border-line bg-surface text-inkSoft",
                ].join(" ")}
              >
                Udhaar diya (+₹)
              </button>
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, ledgerAction: "payment_received" }))}
                className={[
                  "rounded-card border px-3 py-1 text-xs font-semibold",
                  draft.ledgerAction === "payment_received"
                    ? "border-[#2E6B2E] bg-[#2E6B2E] text-white"
                    : "border-line bg-surface text-inkSoft",
                ].join(" ")}
              >
                Wasooli / Jama (-₹)
              </button>
              {draft.type === "order" && (
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, ledgerAction: null }))}
                  className={[
                    "rounded-card border px-3 py-1 text-xs font-semibold",
                    draft.ledgerAction === null
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-surface text-inkSoft",
                  ].join(" ")}
                >
                  Price only
                </button>
              )}
            </div>
          )}

          <label className="block text-sm">
            <span className="font-medium text-inkSoft">Party / dukaan</span>
            <input
              className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-ink"
              value={draft.party}
              onChange={(e) => setDraft((d) => ({ ...d, party: e.target.value }))}
              placeholder="Gupta store"
            />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-inkSoft">Items</span>
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    items: [...d.items, { product: "", quantity: 1, unit: "kg" }],
                  }))
                }
                className="rounded-card border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-[#F3EDE0]"
              >
                + Add item
              </button>
            </div>
            {draft.items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  aria-label={`Product ${idx + 1}`}
                  className="w-full rounded-card border border-line bg-surface px-3 py-2 text-ink"
                  value={it.product}
                  placeholder="chawal"
                  onChange={(e) => {
                    const items = draft.items.map((x, i) =>
                      i === idx ? { ...x, product: e.target.value } : x,
                    );
                    setDraft((d) => ({ ...d, items }));
                  }}
                />
                <input
                  aria-label={`Quantity ${idx + 1}`}
                  type="number"
                  min="0"
                  step="any"
                  className="w-20 rounded-card border border-line bg-surface px-3 py-2 text-ink"
                  value={it.quantity}
                  onChange={(e) => {
                    const val = e.target.value === "" ? 0 : Number(e.target.value);
                    const items = draft.items.map((x, i) =>
                      i === idx ? { ...x, quantity: Number.isFinite(val) ? val : 0 } : x,
                    );
                    setDraft((d) => ({ ...d, items }));
                  }}
                />
                <input
                  aria-label={`Unit ${idx + 1}`}
                  className="w-20 rounded-card border border-line bg-surface px-3 py-2 text-ink"
                  value={it.unit}
                  placeholder="kg"
                  onChange={(e) => {
                    const items = draft.items.map((x, i) =>
                      i === idx ? { ...x, unit: e.target.value } : x,
                    );
                    setDraft((d) => ({ ...d, items }));
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove item ${idx + 1}`}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      items: d.items.filter((_, i) => i !== idx),
                    }))
                  }
                  className="shrink-0 rounded-card border border-line bg-surface px-2.5 py-2 text-xs font-semibold text-[#A03325] hover:bg-[#F8E9E5]"
                >
                  × Remove
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-inkSoft">Raqam (₹)</span>
              <input
                type="number"
                min="0"
                step="any"
                className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-ink"
                value={draft.amount ?? ""}
                placeholder="Optional (e.g. 200)"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    amount: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-inkSoft">Delivery date (YYYY-MM-DD)</span>
              <input
                type="date"
                className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-ink"
                value={draft.dueDate}
                onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              className="rounded-card bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Save edits
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-[#F3EDE0]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {entry.party && <p className="text-base font-semibold text-ink">{entry.party}</p>}
          {entry.items.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {entry.items.map((it, idx) => (
                <li key={idx} className="text-base text-ink">
                  {it.quantity} {it.unit} {it.product}
                  {it.quantity === 0 && (
                    <span className="ml-2 rounded bg-[#FBF1E3] px-1.5 py-0.5 text-xs font-semibold text-saffronDeep">
                      matra? (kam confidence)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : entry.amount !== null ? (
            <p className="mt-1 text-lg font-semibold text-ink">₹{entry.amount}</p>
          ) : (
            <p className="mt-1 text-base text-inkSoft">Koi item ya raqam samajh nahi aayi.</p>
          )}
          {entry.items.length > 0 && entry.amount !== null && (
            <p className="mt-1.5 text-sm font-semibold text-saffronDeep">
              Raqam / Udhaar: ₹{entry.amount}
            </p>
          )}
          {entry.dueDate && (
            <p className="mt-1 text-sm text-inkSoft">Delivery: {entry.dueDate}</p>
          )}
          <p className="mt-2 line-clamp-2 text-xs italic text-inkSoft">“{entry.source}”</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!editing && (
          <button
            type="button"
            onClick={beginEdit}
            className="rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-[#F3EDE0]"
          >
            Edit
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(entry.id)}
          className="rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-[#A03325] hover:bg-[#F8E9E5]"
        >
          Delete
        </button>
        {entry.status === "confirmed" && !editing && (
          <a
            href={buildEntryWhatsAppUrl(entry)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-card border border-[#2E6B2E]/30 bg-[#E5F0E4] px-4 py-2 text-sm font-semibold text-[#2E6B2E] hover:opacity-90"
          >
            WhatsApp pe bhejein
          </a>
        )}
        <button
          type="button"
          onClick={() => onConfirm(entry.id)}
          disabled={entry.status === "confirmed"}
          className="rounded-card bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 sm:ml-auto"
        >
          {entry.status === "confirmed" ? "Save ho gaya" : "Confirm & save"}
        </button>
      </div>
    </article>
  );
}
