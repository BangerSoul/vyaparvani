import { parsedEntrySchema, type ParsedEntry } from "./schema";

// Demo-mode parser: keyword + number extraction, no model call.
// This is a fallback so the demo always works without an API key;
// it is explicitly NOT the real model and the UI labels it as such.

const NUM_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, chaar: 4, char: 4, paanch: 5, panch: 5, chhe: 6,
  che: 6, saat: 7, saath: 7, aath: 8, nau: 9, das: 10, daas: 10,
  pandrah: 15, bees: 20,
};

const UNITS = new Set(["kg", "kgs", "kilo", "kilos", "packet", "packets", "pkt", "dibbi", "dibba", "drib", "kalawa", "peti", "darjan", "litre", "litres"]);

const LEDGER_WORDS = new Set(["udhaar", "udhar", "khata", "baki", "jama", "wasooli", "credit", "collection", "lena", "dena", "paisa", "rupaye", "rupees", "rs", "rs."]);

const STOP = new Set(["aur", "and", "bhej", "bhejo", "do", "dene", "dena", "chahiye", "ko", "ka", "ke", "ki", "se", "liye", "mujhe", "bhaiya", "please", "kar", "karo", "hai", "hain", "tha", "thi", "the", "ho", "gaya", "likh", "clear", "to", "for", "send"]);

const PARTY_SUFFIX = new Set(["store", "kirana", "shop", "traders", "trader"]);

const PRODUCT_FIXES: Record<string, string> = {
  chawal: "chawal (rice)", atta: "atta (flour)", dal: "dal", chini: "chini (sugar)",
  sugar: "chini (sugar)", tel: "tel (oil)", oil: "tel (oil)", namak: "namak (salt)",
  chai: "chai", dove: "dove", surf: "surf", sabun: "sabun (soap)", ghee: "ghee",
  maggi: "maggi", biscuit: "biscuit", biscuits: "biscuit", britannia: "britannia",
  amul: "amul", dudh: "dudh (milk)", milk: "dudh (milk)",
};

const KNOWN_PRODUCTS = new Set(Object.keys(PRODUCT_FIXES));

function normalizeNumberToken(tok: string): number | null {
  if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
  const w = tok.toLowerCase();
  if (w in NUM_WORDS) return NUM_WORDS[w];
  return null;
}

export function parseDemo(input: string): ParsedEntry {
  const text = input.trim();
  const lower = text.toLowerCase();

  // Ledger detection on whole tokens ("traders" must not match "rs").
  const tokensRaw = lower.replace(/,/g, " , ").split(/\s+/).filter(Boolean);
  const isLedger = tokensRaw.some((t) => LEDGER_WORDS.has(t));
  const missing: string[] = [];

  // Party: "<name> store/kirana/..." followed by ko/ke liye/ka/ki/se.
  let party = "";
  const partyMatch = lower.match(/([a-z]+\s+(?:store|kirana|shop|traders|trader))\s*(?:ko|ke liye|ka|ki|se)/) ||
    lower.match(/(?:ko|ke liye)\s*([a-z]+\s+(?:store|kirana|shop|traders|trader))/);
  if (partyMatch) party = titleCase(partyMatch[1]);
  // Ledger without a store suffix: "suresh ka 500 udhaar" — the name before ka/ki.
  if (!party && isLedger) {
    const nameMatch = lower.match(/\b([a-z]+)\s+(?:ka|ki)\s+/);
    if (nameMatch) party = titleCase(nameMatch[1]);
  }

  // Due date from the original text, before time words are stripped.
  const dueDate = /\bkal\b|\btomorrow\b/.test(lower) ? relativeDate(1) : "";

  // Time words are never products or quantities.
  const tokens = lower.replace(/\b(kal|aaj|parso|abhi|tak)\b/g, " ").replace(/,/g, " , ").split(/\s+/).filter(Boolean);

  const items: ParsedEntry["items"] = [];
  const amountTokens: number[] = [];
  let lastProduct: string | null = null;

  function isPartyLeading(j: number): boolean {
    if (j >= tokens.length) return false;
    if (["ko", "ke", "ka", "ki", "se", "liye"].includes(tokens[j])) return true;
    return PARTY_SUFFIX.has(tokens[j]) || (j + 1 < tokens.length && PARTY_SUFFIX.has(tokens[j + 1]));
  }

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];

    if (KNOWN_PRODUCTS.has(tok)) {
      lastProduct = PRODUCT_FIXES[tok] ?? tok;
      i++;
      continue;
    }

    const qty = normalizeNumberToken(tok);
    if (qty !== null) {
      const isWord = !/^\d/.test(tok);
      const nextIsUnit = i + 1 < tokens.length && UNITS.has(tokens[i + 1]);

      // Spoken numerals count only with a unit right after ("do kg dal"),
      // so the verb "do" in "bhej do" never becomes a quantity.
      if (isWord && !nextIsUnit) {
        i++;
        continue;
      }

      let j = i + 1;
      let unit = "";
      if (nextIsUnit) {
        unit = tokens[j] === "kgs" ? "kg" : tokens[j] === "kilos" ? "kilo" : tokens[j];
        j++;
      }
      while (j < tokens.length && STOP.has(tokens[j])) j++;

      // "<qty> rupaye/rs/udhaar/..." is money, not an item quantity.
      if (j < tokens.length && LEDGER_WORDS.has(tokens[j])) {
        amountTokens.push(qty);
        i = j + 1;
        continue;
      }

      // "<qty> <unit> ... Gupta store ko" — party, not product.
      if (isPartyLeading(j)) {
        if (lastProduct) {
          items.push({ product: lastProduct, quantity: qty, unit });
          lastProduct = null;
        } else {
          missing.push("product");
        }
        i = j;
        continue;
      }

      if (j < tokens.length && tokens[j] !== ",") {
        const raw = tokens[j];
        items.push({ product: PRODUCT_FIXES[raw] ?? raw, quantity: qty, unit });
        lastProduct = null;
        i = j + 1;
        continue;
      }

      // Quantity with no product anywhere near it.
      missing.push("product");
      i = j > i ? j : i + 1;
      continue;
    }

    i++;
  }

  let amount: number | null = null;
  if (amountTokens.length > 0) amount = amountTokens[0];

  let confidence = 0.75;
  if (items.length === 0 && amount === null) {
    missing.push("items");
    confidence = 0.3;
  }
  if (missing.includes("product")) confidence = Math.min(confidence, 0.5);
  if (items.some((it) => !it.unit)) confidence = Math.min(confidence, 0.65);
  if (!party && !isLedger) {
    confidence = Math.min(confidence, 0.55);
    missing.push("party");
  }

  let clarification = "";
  if (confidence < 0.6) {
    if (missing.includes("items")) {
      clarification = "Kya aur kitna chahiye? Jaise '5 kg chawal'.";
    } else if (missing.includes("party")) {
      clarification = "Kis ko bhejna hai — dukaan ka naam bataiye.";
    } else if (missing.includes("product")) {
      clarification = "Kaunsa saaman chahiye?";
    } else {
      clarification = "Thoda detail mein bataiye — kya aur kitna?";
    }
  }

  // Goods mentioned → order, even if an udhaar was also spoken;
  // money/collection with no goods → ledger entry.
  const type = items.length > 0 ? "order" : isLedger ? "ledger" : "order";

  return parsedEntrySchema.parse({
    type,
    items,
    party,
    dueDate,
    amount,
    confidence,
    missing,
    clarification,
  });
}

// One utterance can carry two instructions ("...order karo aur ... udhaar likho").
// Split on aur/and and accept the split only when every clause parses cleanly on
// its own (confident, nothing missing, party known) — otherwise keep one entry,
// which is what mixed single-instruction utterances like
// "Gupta store ko 5 kg chawal bhej do aur unka 200 udhaar tha" must stay as.
export function parseDemoUtterance(input: string): ParsedEntry[] {
  const clauses = input.split(/\s+(?:aur|and)\s+/i).map((s) => s.trim()).filter(Boolean);
  if (clauses.length > 1) {
    const parsed = clauses.map((c) => {
      try {
        return parseDemo(c);
      } catch {
        return null;
      }
    });
    if (parsed.every((p) => p && p.confidence >= 0.6 && p.missing.length === 0 && p.party)) {
      return parsed as ParsedEntry[];
    }
  }
  return [parseDemo(input)];
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function relativeDate(daysAhead: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
