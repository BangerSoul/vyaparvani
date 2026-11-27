import type { EntryItem } from "./schema";

export type StockItem = {
  sku: string;
  label: string;
  quantity: number;
  unit: string;
  lowThreshold: number;
};

export const STOCK_KEY = "vyaparvani.stock.v1";

export const DEFAULT_STOCK: StockItem[] = [
  { sku: "chawal", label: "chawal (rice)", quantity: 25, unit: "kg", lowThreshold: 8 },
  { sku: "atta", label: "atta (flour)", quantity: 20, unit: "kg", lowThreshold: 6 },
  { sku: "chini", label: "chini (sugar)", quantity: 15, unit: "kg", lowThreshold: 5 },
  { sku: "dal", label: "dal", quantity: 12, unit: "kg", lowThreshold: 4 },
  { sku: "tel", label: "tel (oil)", quantity: 10, unit: "litre", lowThreshold: 3 },
  { sku: "surf", label: "surf", quantity: 4, unit: "packet", lowThreshold: 3 },
  { sku: "sabun", label: "sabun (soap)", quantity: 12, unit: "packet", lowThreshold: 4 },
  { sku: "namak", label: "namak (salt)", quantity: 10, unit: "kg", lowThreshold: 3 },
];

const KNOWN_DEFAULT_SKUS = new Set(DEFAULT_STOCK.map((s) => s.sku));

const SKU_ALIASES: Record<string, string> = {
  rice: "chawal",
  flour: "atta",
  sugar: "chini",
  oil: "tel",
  soap: "sabun",
  salt: "namak",
  milk: "dudh",
  biscuits: "biscuit",
};

export function normalizeSkuKey(product: string): string {
  const cleaned = product
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (cleaned.length === 0) return "";
  for (let i = 0; i < cleaned.length - 1; i++) {
    const pair = `${cleaned[i]} ${cleaned[i + 1]}`;
    if (KNOWN_DEFAULT_SKUS.has(pair)) return pair;
    if (SKU_ALIASES[pair]) return SKU_ALIASES[pair];
  }
  for (const tok of cleaned) {
    if (KNOWN_DEFAULT_SKUS.has(tok)) return tok;
    if (SKU_ALIASES[tok]) return SKU_ALIASES[tok];
  }
  return cleaned[0];
}

export function loadStock(): StockItem[] {
  if (typeof window === "undefined") return DEFAULT_STOCK.map((s) => ({ ...s }));
  try {
    const raw = localStorage.getItem(STOCK_KEY);
    if (!raw) return DEFAULT_STOCK.map((s) => ({ ...s }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_STOCK.map((s) => ({ ...s }));
    }
    return parsed
      .filter((item) => item && typeof item.sku === "string")
      .map((item) => ({
        sku: String(item.sku),
        label: typeof item.label === "string" && item.label ? item.label : String(item.sku),
        quantity: Number.isFinite(Number(item.quantity)) ? Math.max(0, Number(item.quantity)) : 0,
        unit: typeof item.unit === "string" ? item.unit : "",
        lowThreshold: Number.isFinite(Number(item.lowThreshold))
          ? Math.max(0, Number(item.lowThreshold))
          : 3,
      }));
  } catch {
    return DEFAULT_STOCK.map((s) => ({ ...s }));
  }
}

export function saveStock(items: StockItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STOCK_KEY, JSON.stringify(items));
  } catch {
    // best-effort local persistence
  }
}

export function getLowStockItems(stock: StockItem[]): StockItem[] {
  return stock.filter((s) => s.quantity <= s.lowThreshold);
}

export function applyOrderStockDeduction(
  stock: StockItem[],
  items: EntryItem[],
): {
  nextStock: StockItem[];
  deducted: Array<{ sku: string; label: string; quantity: number; remaining: number; unit: string }>;
  lowStock: StockItem[];
} {
  const nextStock = stock.map((s) => ({ ...s }));
  const deducted: Array<{
    sku: string;
    label: string;
    quantity: number;
    remaining: number;
    unit: string;
  }> = [];

  for (const it of items) {
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) continue;
    const skuKey = normalizeSkuKey(it.product);
    if (!skuKey) continue;
    const match = nextStock.find((s) => s.sku === skuKey);
    if (!match) continue;
    match.quantity = Math.max(0, Number((match.quantity - it.quantity).toFixed(3)));
    deducted.push({
      sku: match.sku,
      label: match.label,
      quantity: it.quantity,
      remaining: match.quantity,
      unit: match.unit || it.unit,
    });
  }

  return {
    nextStock,
    deducted,
    lowStock: getLowStockItems(nextStock),
  };
}

export function parseRestockIntent(utterance: string): boolean {
  const s = utterance.trim();
  if (!s) return false;
  // Reject customer orders / dispatches from stock or addressed to a store/party.
  if (/\b(?:stock|inventory)\s*me(?:in)?\s+se\b/i.test(s)) return false;
  if (/\b(?:bhej|bhejo|bhejna|deliver|dispatch)\b/i.test(s)) return false;
  if (/\bstock\s+(?:store|kirana|shop|traders|trader|mart|bhandar|agency)\b/i.test(s)) return false;
  if (/\b(?:store|kirana|shop|traders|trader|mart|bhandar|agency)\s+(?:ko|ke\s+liye)\b/i.test(s)) {
    return false;
  }
  if (/\b(?:restock|stock\s*mein|stock\s*me|stock\s*add|inventory\s*mein|inventory\s*me)\b/i.test(s)) {
    return true;
  }
  return /\bstock\b/i.test(s) && /\b(?:add|daal|dalo|daalo|bhar|badhao|plus)\b/i.test(s);
}

export function stripRestockBoilerplate(utterance: string): string {
  return utterance
    .replace(/\b(?:restock|inventory\s*me(?:in)?|stock\s*me(?:in)?)\b/gi, " ")
    .replace(/\b(?:stock)\b/gi, " ")
    .replace(/\b(?:add\s+karo|add\s+kar\s+do|add|daal\s+do|daalo|dalo|bhar\s+do|badhao|karo)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyRestock(
  stock: StockItem[],
  items: EntryItem[],
): {
  nextStock: StockItem[];
  updated: Array<{ sku: string; label: string; added: number; quantity: number; unit: string }>;
} {
  const nextStock = stock.map((s) => ({ ...s }));
  const updated: Array<{
    sku: string;
    label: string;
    added: number;
    quantity: number;
    unit: string;
  }> = [];

  for (const it of items) {
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) continue;
    const skuKey = normalizeSkuKey(it.product);
    if (!skuKey) continue;
    const existing = nextStock.find((s) => s.sku === skuKey);
    if (existing) {
      existing.quantity = Number((existing.quantity + it.quantity).toFixed(3));
      updated.push({
        sku: existing.sku,
        label: existing.label,
        added: it.quantity,
        quantity: existing.quantity,
        unit: existing.unit || it.unit,
      });
    } else {
      const created: StockItem = {
        sku: skuKey,
        label: it.product.trim() || skuKey,
        quantity: Number(it.quantity.toFixed(3)),
        unit: it.unit.trim() || "unit",
        lowThreshold: Math.max(2, Math.round(it.quantity * 0.25)),
      };
      nextStock.push(created);
      updated.push({
        sku: created.sku,
        label: created.label,
        added: it.quantity,
        quantity: created.quantity,
        unit: created.unit,
      });
    }
  }

  return { nextStock, updated };
}

export function buildReorderWhatsAppUrl(lowStock: StockItem[]): string {
  const list = lowStock
    .map((s) => `${s.sku} (${s.quantity} ${s.unit} bacha)`.trim())
    .join(", ");
  const msg = lowStock.length
    ? `Namaste distributor ji, kirana stock reorder bhejna hai: ${list}. Kripya rate aur delivery time bataiye. — VyaparVani`
    : "Namaste distributor ji, kirana stock status check kar rahe hain. — VyaparVani";
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}
