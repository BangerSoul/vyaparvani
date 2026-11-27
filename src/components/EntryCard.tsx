"use client";

import { useState } from "react";
import type { Entry } from "@/lib/store";

type Props = {
  entry: Entry;
  onUpdate: (id: string, patch: Partial<Entry>) => void;
  onDelete: (id: string) => void;
  onConfirm: (id: string) => void;
  onClarify: (entry: Entry) => void;
};

export default function EntryCard({ entry, onUpdate, onDelete, onConfirm, onClarify }: Props) {
  const [editing, setEditing] = useState(false);
  const lowConfidence = entry.confidence < 0.6;

  return (
    <article
      aria-label={entry.type === "order" ? "Order entry" : "Udhaar entry"}
      className={[
        "rounded-card border bg-card p-4 shadow-sm",
        lowConfidence && entry.status === "draft" ? "border-saffron" : "border-line",
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

      {lowConfidence && entry.status === "draft" && (
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
            Clarify kijiye
          </button>
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-3">
          <label className="block text-sm">
            <span className="font-medium text-inkSoft">Party / dukaan</span>
            <input
              className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-ink"
              value={entry.party}
              onChange={(e) => onUpdate(entry.id, { party: e.target.value })}
              placeholder="Gupta store"
            />
          </label>
          {entry.items.map((it, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                aria-label={`Product ${idx + 1}`}
                className="w-full rounded-card border border-line bg-surface px-3 py-2 text-ink"
                value={it.product}
                onChange={(e) => {
                  const items = entry.items.map((x, i) => (i === idx ? { ...x, product: e.target.value } : x));
                  onUpdate(entry.id, { items });
                }}
              />
              <input
                aria-label={`Quantity ${idx + 1}`}
                type="number"
                min="0"
                className="w-20 rounded-card border border-line bg-surface px-3 py-2 text-ink"
                value={it.quantity}
                onChange={(e) => {
                  const items = entry.items.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x));
                  onUpdate(entry.id, { items });
                }}
              />
              <input
                aria-label={`Unit ${idx + 1}`}
                className="w-20 rounded-card border border-line bg-surface px-3 py-2 text-ink"
                value={it.unit}
                placeholder="kg"
                onChange={(e) => {
                  const items = entry.items.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x));
                  onUpdate(entry.id, { items });
                }}
              />
            </div>
          ))}
          {entry.type === "ledger" && (
            <label className="block text-sm">
              <span className="font-medium text-inkSoft">Raqam (₹)</span>
              <input
                type="number"
                min="0"
                className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-ink"
                value={entry.amount ?? ""}
                onChange={(e) => onUpdate(entry.id, { amount: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-card bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Editing band kijiye
          </button>
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
            onClick={() => setEditing(true)}
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
