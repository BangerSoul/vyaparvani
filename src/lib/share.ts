import type { Entry, PartyKhataSummary } from "./store";

export function buildEntryWhatsAppMessage(entry: Entry): string {
  const party = entry.party.trim() || "ji";
  const parts: string[] = [`Namaste ${party},`];

  if (entry.items.length > 0) {
    const itemList = entry.items
      .map((it) => [it.quantity, it.unit, it.product].filter(Boolean).join(" "))
      .join(", ");
    parts.push(`Order: ${itemList}.`);
  }

  if (entry.dueDate) {
    parts.push(`Delivery: ${entry.dueDate}.`);
  }

  if (entry.amount !== null && entry.amount > 0) {
    if (entry.ledgerAction === "payment_received") {
      parts.push(`Wasooli / Jama: ₹${entry.amount} prapt hue.`);
    } else if (entry.ledgerAction === "credit_given") {
      parts.push(`Udhaar / Baki: ₹${entry.amount}.`);
    } else {
      parts.push(`Raqam: ₹${entry.amount}.`);
    }
  }

  parts.push("— VyaparVani");
  return parts.join(" ");
}

export function buildEntryWhatsAppUrl(entry: Entry): string {
  return `https://wa.me/?text=${encodeURIComponent(buildEntryWhatsAppMessage(entry))}`;
}

export function buildKhataWhatsAppMessage(summary: PartyKhataSummary): string {
  if (summary.netBalance > 0) {
    return `Namaste ${summary.party} ji, aapke khate mein kul ₹${summary.netBalance} baki hain (Udhaar: ₹${summary.creditTotal}, Jama: ₹${summary.paidTotal}). Kripya bhugtan ki jaankari dein. — VyaparVani`;
  }
  if (summary.netBalance === 0) {
    return `Namaste ${summary.party} ji, aapka khata bilkul clear (Settled) hai. Dhanyavaad! — VyaparVani`;
  }
  return `Namaste ${summary.party} ji, aapke khate mein ₹${Math.abs(summary.netBalance)} advance jama hai. Dhanyavaad! — VyaparVani`;
}

export function buildKhataWhatsAppUrl(summary: PartyKhataSummary): string {
  return `https://wa.me/?text=${encodeURIComponent(buildKhataWhatsAppMessage(summary))}`;
}

export function escapeCsvCell(value: string): string {
  const raw = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) || /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildDistributorCsv(entries: Entry[]): string {
  type Agg = {
    product: string;
    totalQuantity: number;
    unit: string;
    parties: Set<string>;
    latestDueDate: string;
  };

  const map = new Map<string, Agg>();
  for (const e of entries) {
    if (e.status !== "confirmed" || e.type !== "order") continue;
    for (const it of e.items) {
      const product = (it.product || "").trim();
      if (!product) continue;
      const unit = (it.unit || "").trim();
      const key = `${product.toLowerCase()}||${unit.toLowerCase()}`;
      const agg = map.get(key) ?? {
        product,
        totalQuantity: 0,
        unit,
        parties: new Set<string>(),
        latestDueDate: "",
      };
      agg.totalQuantity += Number.isFinite(it.quantity) ? it.quantity : 0;
      if (e.party.trim()) agg.parties.add(e.party.trim());
      if (e.dueDate && e.dueDate > agg.latestDueDate) {
        agg.latestDueDate = e.dueDate;
      }
      map.set(key, agg);
    }
  }

  const header = ["Product", "TotalQuantity", "Unit", "Parties", "LatestDueDate"]
    .map(escapeCsvCell)
    .join(",");

  const rows = Array.from(map.values())
    .sort((a, b) => a.product.localeCompare(b.product))
    .map((agg) =>
      [
        agg.product,
        String(Number(agg.totalQuantity.toFixed(3))),
        agg.unit,
        Array.from(agg.parties).sort().join("; "),
        agg.latestDueDate,
      ]
        .map(escapeCsvCell)
        .join(","),
    );

  return [header, ...rows].join("\r\n");
}
