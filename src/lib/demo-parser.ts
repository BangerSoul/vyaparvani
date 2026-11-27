import { getIstDate, parsedEntrySchema, type ParsedEntry } from "./schema";

// Demo-mode parser: keyword + number extraction, no model call.
// This is a fallback so the demo always works without an API key;
// it is explicitly NOT the real model and the UI labels it as such.

const NUM_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, chaar: 4, char: 4, paanch: 5, panch: 5, chhe: 6,
  che: 6, saat: 7, saath: 7, aath: 8, ath: 8, nau: 9, das: 10, daas: 10,
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16,
  satrah: 17, atharah: 18, unnees: 19, bees: 20,
  pachis: 25, pachchis: 25, tees: 30, chalis: 40, pachas: 50, pachaas: 50,
  sattar: 70, assi: 80, nabbe: 90, sau: 100, hazaar: 1000, hazar: 1000,
};

const FRACTION_WORDS: Record<string, number> = {
  aadha: 0.5, adha: 0.5, paav: 0.25, pao: 0.25,
  sava: 1.25, sawa: 1.25, dedh: 1.5, dhai: 2.5,
  saadhe: 0.5, sadhe: 0.5, paune: 0.75,
};

const UNITS = new Set([
  "kg", "kgs", "kilo", "kilos", "packet", "packets", "pkt",
  "dibbi", "dibba", "drib", "kalawa", "peti", "darjan",
  "litre", "litres", "ltr",
]);

const LEDGER_INTENT_WORDS = new Set([
  "udhaar", "udhar", "khata", "baki", "jama", "wasooli",
  "credit", "collection", "lena", "dena",
]);

const CURRENCY_WORDS = new Set([
  "rupaye", "rupees", "rupee", "rs", "paisa", "paise", "inr",
]);

const STOP = new Set([
  "bhej", "bhejo", "do", "dene", "dena", "chahiye", "ko", "ka", "ke", "ki",
  "se", "liye", "mujhe", "bhaiya", "please", "kar", "karo", "hai", "hain",
  "tha", "thi", "the", "ho", "gaya", "likh", "likho", "clear", "to", "for",
  "send", "add", "lo",
]);

const SEPARATORS = new Set(["aur", "and", ","]);

const VERB_BEFORE_DO = new Set([
  "bhej", "kar", "likh", "de", "bhejo", "likho", "karo", "rakh",
]);

const PARTY_SUFFIX = new Set([
  "store", "kirana", "shop", "traders", "trader", "mart", "bhandar", "agency",
]);

const PRODUCT_FIXES: Record<string, string> = {
  chawal: "chawal (rice)", atta: "atta (flour)", dal: "dal", chini: "chini (sugar)",
  sugar: "chini (sugar)", tel: "tel (oil)", oil: "tel (oil)", namak: "namak (salt)",
  chai: "chai", dove: "dove", surf: "surf", sabun: "sabun (soap)", ghee: "ghee",
  maggi: "maggi", biscuit: "biscuit", biscuits: "biscuit", britannia: "britannia",
  amul: "amul", dudh: "dudh (milk)", milk: "dudh (milk)", agarbatti: "agarbatti",
};

const KNOWN_PRODUCTS = new Set(Object.keys(PRODUCT_FIXES));

const TIME_WORDS = new Set(["kal", "aaj", "parso", "abhi", "tak", "tomorrow", "today"]);

const NON_PARTY_WORDS = new Set<string>([
  ...Object.keys(NUM_WORDS),
  ...Object.keys(FRACTION_WORDS),
  ...UNITS,
  ...LEDGER_INTENT_WORDS,
  ...CURRENCY_WORDS,
  ...STOP,
  ...SEPARATORS,
  ...KNOWN_PRODUCTS,
  ...TIME_WORDS,
  "unka", "unke", "unki", "mera", "meri", "aapka", "sab", "kuch", "koi",
  "ji", "new",
]);

// Note: "new" is allowed inside multi-word store names like "New Gupta Store",
// so keep a stricter set for Pass 1 store prefix vs Pass 3 bare name.
const NON_STORE_PREFIX = new Set<string>(
  [...NON_PARTY_WORDS].filter((w) => w !== "new"),
);

const DEVANAGARI_DIGITS: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

const DEVANAGARI_PHRASES: Array<[string, string]> = [
  ["जमा हो गया", "jama ho gaya"],
  ["वसूली हो गया", "wasooli ho gaya"],
  ["वसूली हो गई", "wasooli ho gaya"],
  ["भेज दो", "bhej do"],
  ["लिख दो", "likh do"],
  ["लिख लो", "likh lo"],
  ["कर दो", "kar do"],
  ["हो गया", "ho gaya"],
  ["के लिए", "ke liye"],
];

const DEVANAGARI_WORDS: Record<string, string> = {
  किलोग्राम: "kg", किलो: "kg", पैकेट: "packet", डिब्बी: "dibbi", डिब्बा: "dibba",
  ड्रिब: "drib", कलावा: "kalawa", पेटी: "peti", दर्जन: "darjan", लीटर: "litre",
  चावल: "chawal", आटा: "atta", चीनी: "chini", शक्कर: "chini", दाल: "dal",
  तेल: "tel", नमक: "namak", चाय: "chai", साबुन: "sabun", घी: "ghee",
  दूध: "dudh", बिस्कुट: "biscuit", बिस्किट: "biscuit", सर्फ: "surf",
  मैगी: "maggi", अगरबत्ती: "agarbatti", डव: "dove", अमूल: "amul", ब्रिटानिया: "britannia",
  गुप्ता: "gupta", शर्मा: "sharma", मेहता: "mehta", वर्मा: "verma",
  सिंह: "singh", पटेल: "patel", रमेश: "ramesh", सुरेश: "suresh",
  श्याम: "shyam", रेड्डी: "reddy", नायर: "nair",
  स्टोर: "store", किराना: "kirana", शॉप: "shop", ट्रेडर्स: "traders",
  ट्रेडर: "trader", मार्ट: "mart", भैया: "bhaiya", जी: "ji",
  उधार: "udhaar", उधर: "udhaar", खाता: "khata", जमा: "jama",
  वसूली: "wasooli", बाकी: "baki", बाक़ी: "baki", रुपये: "rupaye",
  रुपए: "rupaye", रुपया: "rupaye", पैसे: "paisa", पैसा: "paisa",
  लेना: "lena", देना: "dena", क्लियर: "clear",
  आधा: "aadha", पाव: "paav", डेढ़: "dedh", ढाई: "dhai",
  सवा: "sava", साढ़े: "saadhe", पौने: "paune",
  एक: "ek", दो: "do", तीन: "teen", चार: "chaar", पाँच: "paanch",
  पांच: "paanch", छह: "chhe", छे: "chhe", सात: "saat", आठ: "aath",
  नौ: "nau", दस: "das", ग्यारह: "gyarah", बारह: "barah",
  पंद्रह: "pandrah", बीस: "bees", पच्चीस: "pachis", तीस: "tees",
  पचास: "pachas", सौ: "sau", हज़ार: "hazaar", हजार: "hazaar",
  कल: "kal", आज: "aaj", परसों: "parso", परसो: "parso",
  अभी: "abhi", तक: "tak", को: "ko", का: "ka", की: "ki",
  के: "ke", से: "se", और: "aur", भेजो: "bhejo", भेज: "bhej",
  लिखो: "likho", लिख: "likh", चाहिए: "chahiye", था: "tha",
  थी: "thi", थे: "the", है: "hai", हैं: "hain", हो: "ho",
  गया: "gaya", गई: "gaya", उनका: "unka", मुझे: "mujhe",
};

const DEV_VOWELS: Record<string, string> = {
  अ: "a", आ: "a", इ: "i", ई: "i", उ: "u", ऊ: "u", ए: "e", ऐ: "ai", ओ: "o", औ: "au",
};
const DEV_MATRAS: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ं": "n", "ँ": "n", "ः": "h",
};
const DEV_CONS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", च: "ch", छ: "chh", ज: "j", झ: "jh",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d",
  ध: "dh", न: "n", प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y",
  र: "r", ल: "l", व: "v", श: "sh", ष: "sh", स: "s", ह: "h",
  क़: "q", ख़: "kh", ग़: "g", ज़: "z", ड़: "d", ढ़: "dh", फ़: "f",
};

function transliterateDevanagariWord(word: string): string {
  let out = "";
  const chars = Array.from(word);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch in DEV_VOWELS) {
      out += DEV_VOWELS[ch];
    } else if (ch in DEV_MATRAS) {
      out += DEV_MATRAS[ch];
    } else if (ch === "्") {
      // virama suppresses implicit vowel
    } else if (ch in DEV_CONS) {
      out += DEV_CONS[ch];
      const next = chars[i + 1];
      const hasExplicitVowel = next && (next in DEV_MATRAS || next === "्");
      if (!hasExplicitVowel && i < chars.length - 1) {
        out += "a";
      }
    } else {
      out += ch;
    }
  }
  return out;
}

export function normalizeDevanagari(input: string): string {
  let s = input.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d);
  s = s.replace(/[।॥]/g, " ");
  if (!/[\u0900-\u097F]/.test(s)) return s;

  for (const [dev, rom] of DEVANAGARI_PHRASES) {
    s = s.split(dev).join(` ${rom} `);
  }
  // Replace contiguous Devanagari runs via dictionary or fallback transliteration.
  s = s.replace(/[\u0900-\u097F]+/g, (tok) => {
    const mapped = DEVANAGARI_WORDS[tok];
    return ` ${mapped ?? transliterateDevanagariWord(tok)} `;
  });
  return s.replace(/\s+/g, " ").trim();
}

function preprocessTokens(input: string): string[] {
  let s = normalizeDevanagari(input).toLowerCase();
  // Pre-split attached currency symbols/suffixes and units before tokenization.
  s = s.replace(/₹\s*(\d+(?:\.\d+)?)/g, " $1 rupaye ");
  s = s.replace(/(\d+(?:\.\d+)?)\s*\/-/g, " $1 rupaye ");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(rs\.?|rupaye|rupees|rupee|inr)(?=\s|,|[.!?]|$)/g, " $1 $2 ");
  s = s.replace(
    /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|packets?|pkt|dibbi|dibba|drib|kalawa|peti|darjan|litres?|ltr|l)(?=\s|,|[.!?]|$)/g,
    (_, n, u) => ` ${n} ${u === "l" || u === "ltr" ? "litre" : u} `,
  );
  s = s.replace(/\brs\.(?=\s|,|$)/g, "rs");
  s = s.replace(/,/g, " , ");
  s = s.replace(/[.!?]+(?=\s|$)/g, " ");
  return s.split(/\s+/).filter(Boolean);
}

function normalizeNumberToken(tok: string): number | null {
  if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
  const w = tok.toLowerCase();
  if (w in NUM_WORDS) return NUM_WORDS[w];
  if (w in FRACTION_WORDS) return FRACTION_WORDS[w];
  return null;
}

function consumeQuantityAt(
  tokens: string[],
  i: number,
): { qty: number; nextIndex: number; isWord: boolean } | null {
  const tok = tokens[i];
  if (tok === "do" && i > 0 && VERB_BEFORE_DO.has(tokens[i - 1])) {
    return null;
  }

  if (tok === "saadhe" || tok === "sadhe") {
    const nextVal = i + 1 < tokens.length ? normalizeNumberToken(tokens[i + 1]) : null;
    if (nextVal !== null && !(tokens[i + 1] in FRACTION_WORDS)) {
      return { qty: nextVal + 0.5, nextIndex: i + 2, isWord: true };
    }
    return { qty: 0.5, nextIndex: i + 1, isWord: true };
  }

  if (tok === "sava" || tok === "sawa") {
    const nextVal = i + 1 < tokens.length ? normalizeNumberToken(tokens[i + 1]) : null;
    if (nextVal !== null && nextVal >= 2 && !(tokens[i + 1] in FRACTION_WORDS)) {
      return { qty: nextVal + 0.25, nextIndex: i + 2, isWord: true };
    }
    return { qty: 1.25, nextIndex: i + 1, isWord: true };
  }

  if (tok === "paune") {
    const nextVal = i + 1 < tokens.length ? normalizeNumberToken(tokens[i + 1]) : null;
    if (nextVal !== null && nextVal >= 1 && !(tokens[i + 1] in FRACTION_WORDS)) {
      return { qty: Math.max(0.25, nextVal - 0.25), nextIndex: i + 2, isWord: true };
    }
    return { qty: 0.75, nextIndex: i + 1, isWord: true };
  }

  let qty = normalizeNumberToken(tok);
  if (qty === null) return null;

  const isWord = !/^\d/.test(tok);
  let nextIndex = i + 1;
  if (nextIndex < tokens.length) {
    const multTok = tokens[nextIndex];
    if (multTok === "sau" && qty > 0 && qty < 100) {
      qty *= 100;
      nextIndex++;
    } else if ((multTok === "hazaar" || multTok === "hazar") && qty > 0 && qty < 1000) {
      qty *= 1000;
      nextIndex++;
    }
  }
  return { qty, nextIndex, isWord };
}

const STORE_MODIFIERS = new Set(["new", "sri", "shri", "sai", "om", "jai", "maa", "royal", "super", "fresh"]);

function extractPartySpan(tokens: string[]): { party: string; span: [number, number] | null } {
  // Pass 1: "<name...> store/kirana/shop/traders/mart"
  for (let i = 0; i < tokens.length; i++) {
    if (PARTY_SUFFIX.has(tokens[i])) {
      let start = i;
      if (
        start > 0 &&
        /^[a-z]+$/.test(tokens[start - 1]) &&
        !NON_STORE_PREFIX.has(tokens[start - 1])
      ) {
        start--;
        // Allow leading store modifier (e.g. "New Gupta Store", "New Patel Mart")
        if (start > 0 && STORE_MODIFIERS.has(tokens[start - 1])) {
          start--;
        }
      }
      if (start < i) {
        return {
          party: titleCase(tokens.slice(start, i + 1).join(" ")),
          span: [start, i],
        };
      }
    }
  }

  // Pass 2: "<Name> bhaiya/ji" followed by postposition (ko/ka/ki/se)
  for (let i = 1; i < tokens.length; i++) {
    if ((tokens[i] === "bhaiya" || tokens[i] === "ji") &&
      i + 1 < tokens.length &&
      ["ko", "ka", "ki", "se", "ke"].includes(tokens[i + 1])
    ) {
      let start = i;
      while (
        start > 0 &&
        i - start < 2 &&
        /^[a-z]+$/.test(tokens[start - 1]) &&
        !NON_PARTY_WORDS.has(tokens[start - 1])
      ) {
        start--;
      }
      if (start < i) {
        const slice = tokens[i] === "ji" ? tokens.slice(start, i) : tokens.slice(start, i + 1);
        return {
          party: titleCase(slice.join(" ")),
          span: [start, i],
        };
      }
    }
  }

  // Pass 3: "<Name> ka/ki/se/ko/ke liye"
  for (let i = 1; i < tokens.length; i++) {
    const isPost =
      tokens[i] === "ka" ||
      tokens[i] === "ki" ||
      tokens[i] === "se" ||
      tokens[i] === "ko" ||
      (tokens[i] === "ke" && tokens[i + 1] === "liye");
    if (!isPost) continue;

    let start = i;
    while (
      start > 0 &&
      i - start < 2 &&
      /^[a-z]+$/.test(tokens[start - 1]) &&
      !NON_PARTY_WORDS.has(tokens[start - 1])
    ) {
      start--;
    }
    if (start < i) {
      return {
        party: titleCase(tokens.slice(start, i).join(" ")),
        span: [start, i - 1],
      };
    }
  }

  return { party: "", span: null };
}

function normalizeUnit(u: string): string {
  if (u === "kgs") return "kg";
  if (u === "kilos") return "kilo";
  if (u === "litres" || u === "ltr") return "litre";
  return u;
}

export function parseDemo(input: string): ParsedEntry {
  const tokensAll = preprocessTokens(input);
  const lower = tokensAll.join(" ");

  const hasLedgerIntent = tokensAll.some((t) => LEDGER_INTENT_WORDS.has(t));
  const hasCurrency = tokensAll.some((t) => CURRENCY_WORDS.has(t));
  const missing: string[] = [];

  // Due date from the normalized text, before time words are stripped.
  let dueDate = "";
  if (/\bparso\b/.test(lower)) dueDate = getIstDate(2);
  else if (/\bkal\b|\btomorrow\b/.test(lower)) dueDate = getIstDate(1);
  else if (/\baaj\b|\btoday\b/.test(lower)) dueDate = getIstDate(0);

  // Time words are never products or quantities.
  const tokens = tokensAll.filter((t) => !TIME_WORDS.has(t));
  const { party, span: partySpan } = extractPartySpan(tokens);

  const items: ParsedEntry["items"] = [];
  const amountTokens: number[] = [];
  let lastProduct: string | null = null;
  let sawOrphanQty = false;

  function isPartyLeading(j: number): boolean {
    if (j >= tokens.length) return false;
    if (partySpan && j >= partySpan[0] && j <= partySpan[1]) return true;
    if (["ko", "ke", "ka", "ki", "se", "liye"].includes(tokens[j])) return true;
    return PARTY_SUFFIX.has(tokens[j]) || (j + 1 < tokens.length && PARTY_SUFFIX.has(tokens[j + 1]));
  }

  let i = 0;
  while (i < tokens.length) {
    if (partySpan && i >= partySpan[0] && i <= partySpan[1]) {
      i = partySpan[1] + 1;
      continue;
    }

    const tok = tokens[i];

    if (KNOWN_PRODUCTS.has(tok)) {
      lastProduct = PRODUCT_FIXES[tok] ?? tok;
      i++;
      continue;
    }

    const consumed = consumeQuantityAt(tokens, i);
    if (consumed !== null) {
      const { qty, nextIndex, isWord } = consumed;
      const nextTok = nextIndex < tokens.length ? tokens[nextIndex] : "";
      const nextIsUnit = nextIndex < tokens.length && UNITS.has(nextTok);
      const nextIsProduct = nextIndex < tokens.length && KNOWN_PRODUCTS.has(nextTok);
      const nextIsMoney =
        nextIndex < tokens.length &&
        (CURRENCY_WORDS.has(nextTok) || LEDGER_INTENT_WORDS.has(nextTok));

      // Spoken numerals count with a unit, product, currency, or ledger keyword right after,
      // so the verb "do" in "bhej do" never becomes a quantity.
      if (isWord && !nextIsUnit && !nextIsProduct && !nextIsMoney) {
        i++;
        continue;
      }

      let j = nextIndex;
      let unit = "";
      if (nextIsUnit) {
        unit = normalizeUnit(tokens[j]);
        j++;
      }
      const afterQtyUnit = j;

      while (j < tokens.length && STOP.has(tokens[j])) j++;

      // "<qty> <currency> [ka/ki/ke] <product>" -> price-denominated order item + amount
      if (!nextIsUnit && j < tokens.length && CURRENCY_WORDS.has(tokens[j])) {
        amountTokens.push(qty);
        let k = j + 1;
        while (k < tokens.length && ["ka", "ki", "ke"].includes(tokens[k])) k++;
        if (k < tokens.length && KNOWN_PRODUCTS.has(tokens[k])) {
          const prod = PRODUCT_FIXES[tokens[k]] ?? tokens[k];
          items.push({ product: prod, quantity: 1, unit: "" });
          lastProduct = null;
          i = k + 1;
          continue;
        }
        i = j + 1;
        continue;
      }

      // "<qty> udhaar/wasooli/..." is money, not an item quantity.
      if (!nextIsUnit && j < tokens.length && LEDGER_INTENT_WORDS.has(tokens[j])) {
        amountTokens.push(qty);
        i = j + 1;
        continue;
      }

      // If clause separator ("aur", "and", ",") or end or party follows, bind lastProduct if pending.
      const atBoundary =
        j >= tokens.length ||
        SEPARATORS.has(tokens[j]) ||
        isPartyLeading(j) ||
        (lastProduct !== null &&
          j + 1 < tokens.length &&
          consumeQuantityAt(tokens, j + 1) !== null);

      if (atBoundary) {
        if (lastProduct) {
          items.push({ product: lastProduct, quantity: qty, unit });
          lastProduct = null;
        } else {
          sawOrphanQty = true;
          if (!missing.includes("product")) missing.push("product");
        }
        i = j < tokens.length && SEPARATORS.has(tokens[j]) ? j : afterQtyUnit > i ? afterQtyUnit : i + 1;
        continue;
      }

      if (j < tokens.length && !SEPARATORS.has(tokens[j])) {
        const raw = tokens[j];
        items.push({ product: PRODUCT_FIXES[raw] ?? raw, quantity: qty, unit });
        lastProduct = null;
        i = j + 1;
        continue;
      }

      sawOrphanQty = true;
      if (!missing.includes("product")) missing.push("product");
      i = j > i ? j : i + 1;
      continue;
    }

    i++;
  }

  let amount: number | null = null;
  if (amountTokens.length > 0) amount = amountTokens[0];

  const type = items.length > 0 ? "order" : (hasLedgerIntent || (amount !== null && hasCurrency)) ? "ledger" : "order";

  let confidence = 0.75;
  if (items.length === 0 && amount === null) {
    if (!missing.includes("items")) missing.push("items");
    confidence = 0.3;
  }
  if (sawOrphanQty || missing.includes("product")) {
    confidence = Math.min(confidence, 0.5);
  }
  if (items.some((it) => it.quantity <= 0)) {
    if (!missing.includes("quantity")) missing.push("quantity");
    confidence = Math.min(confidence, 0.5);
  }
  if (items.some((it) => !it.unit)) {
    confidence = Math.min(confidence, 0.65);
  }
  if (!party) {
    confidence = Math.min(confidence, 0.55);
    if (!missing.includes("party")) missing.push("party");
  }

  let clarification = "";
  if (confidence < 0.6) {
    if (missing.includes("items")) {
      clarification = "Kya aur kitna chahiye? Jaise '5 kg chawal'.";
    } else if (missing.includes("quantity")) {
      clarification = "Kitni matra chahiye?";
    } else if (missing.includes("product")) {
      clarification = "Kaunsa saaman chahiye?";
    } else if (missing.includes("party")) {
      clarification =
        type === "ledger"
          ? "Kis ke khate mein likhna hai?"
          : "Kis ko bhejna hai — dukaan ka naam bataiye.";
    } else {
      clarification = "Thoda detail mein bataiye — kya aur kitna?";
    }
  }

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

export type ExistingDraftInput = Partial<ParsedEntry> & {
  source?: string;
};

function extractOrphanProductFromSource(source: string): string | null {
  const tokens = preprocessTokens(source).filter((t) => !TIME_WORDS.has(t));
  for (const tok of tokens) {
    if (KNOWN_PRODUCTS.has(tok)) {
      return PRODUCT_FIXES[tok] ?? tok;
    }
  }
  return null;
}

function extractOrphanQtyFromSource(source: string): { quantity: number; unit: string } | null {
  const tokens = preprocessTokens(source).filter((t) => !TIME_WORDS.has(t));
  for (let i = 0; i < tokens.length; i++) {
    const c = consumeQuantityAt(tokens, i);
    if (!c) continue;
    const nextIsUnit = c.nextIndex < tokens.length && UNITS.has(tokens[c.nextIndex]);
    const unit = nextIsUnit ? normalizeUnit(tokens[c.nextIndex]) : "";
    if (!c.isWord || nextIsUnit) {
      return { quantity: c.qty, unit };
    }
  }
  return null;
}

function extractClarificationParty(utterance: string): string {
  const tokens = preprocessTokens(utterance).filter((t) => !TIME_WORDS.has(t));
  const { party } = extractPartySpan(tokens);
  if (party) return party;
  // Bare name/store reply like "Gupta store" or "Ramesh"
  const kept = tokens.filter(
    (t) =>
      /^[a-z]+$/.test(t) &&
      !UNITS.has(t) &&
      !KNOWN_PRODUCTS.has(t) &&
      !LEDGER_INTENT_WORDS.has(t) &&
      !CURRENCY_WORDS.has(t) &&
      !STOP.has(t) &&
      !SEPARATORS.has(t) &&
      !(t in NUM_WORDS) &&
      !(t in FRACTION_WORDS),
  );
  if (kept.length > 0 && kept.length <= 4) {
    return titleCase(kept.join(" "));
  }
  return "";
}

export function mergeDemoClarification(
  utterance: string,
  existing: ExistingDraftInput,
): ParsedEntry {
  const replyParsed = parseDemo(utterance);
  const replyTokens = preprocessTokens(utterance).filter((t) => !TIME_WORDS.has(t));

  let type: "order" | "ledger" = existing.type === "ledger" ? "ledger" : "order";
  let items: ParsedEntry["items"] = Array.isArray(existing.items)
    ? existing.items.map((it) => ({ ...it }))
    : [];
  let party = (existing.party ?? "").trim();
  let dueDate = existing.dueDate ?? "";
  let amount: number | null = existing.amount ?? null;
  const source = existing.source ?? "";

  // 1. Patch items / quantity / product
  if (replyParsed.items.length > 0) {
    if (items.length === 0) {
      items = replyParsed.items;
    } else if (items.some((it) => it.quantity <= 0)) {
      // Replace zero-quantity placeholders
      const rest = items.filter((it) => it.quantity > 0);
      items = [...rest, ...replyParsed.items];
    } else {
      items = [...items, ...replyParsed.items];
    }
    type = "order";
  } else {
    // Check if reply supplied bare "<qty> [unit]" for a pending product
    const replyQty = extractOrphanQtyFromSource(utterance);
    const replyProduct = extractOrphanProductFromSource(utterance);

    if (replyQty && items.some((it) => it.quantity <= 0)) {
      const targetIdx = items.findIndex((it) => it.quantity <= 0);
      items[targetIdx] = {
        ...items[targetIdx],
        quantity: replyQty.quantity,
        unit: items[targetIdx].unit || replyQty.unit,
      };
    } else if (replyQty && items.length === 0) {
      const sourceProduct = source ? extractOrphanProductFromSource(source) : null;
      if (sourceProduct) {
        items.push({
          product: sourceProduct,
          quantity: replyQty.quantity,
          unit: replyQty.unit,
        });
        type = "order";
      }
    } else if (replyProduct && items.length === 0) {
      const sourceQty = source ? extractOrphanQtyFromSource(source) : null;
      if (sourceQty) {
        items.push({
          product: replyProduct,
          quantity: sourceQty.quantity,
          unit: sourceQty.unit,
        });
      } else {
        items.push({ product: replyProduct, quantity: 0, unit: "" });
      }
      type = "order";
    } else if (
      items.length === 0 &&
      replyTokens.length === 1 &&
      /^[a-z]+$/.test(replyTokens[0]) &&
      !NON_PARTY_WORDS.has(replyTokens[0]) &&
      (existing.missing ?? []).includes("product")
    ) {
      // Unlisted product reply like "poha" when product was missing
      const sourceQty = source ? extractOrphanQtyFromSource(source) : null;
      if (sourceQty) {
        items.push({
          product: replyTokens[0],
          quantity: sourceQty.quantity,
          unit: sourceQty.unit,
        });
        type = "order";
      }
    }
  }

  // 2. Patch party if missing
  if (!party) {
    if (replyParsed.party) {
      party = replyParsed.party;
    } else {
      const candidate = extractClarificationParty(utterance);
      if (candidate) party = candidate;
    }
  }

  // 3. Patch amount if missing
  if (amount === null) {
    if (replyParsed.amount !== null) {
      amount = replyParsed.amount;
    } else if (type === "ledger" && replyTokens.length === 1) {
      const bareNum = normalizeNumberToken(replyTokens[0]);
      if (bareNum !== null) amount = bareNum;
    }
  }

  // 4. Patch dueDate if missing
  if (!dueDate && replyParsed.dueDate) {
    dueDate = replyParsed.dueDate;
  }

  // 5. Recompute missing, confidence, clarification cleanly
  const missing: string[] = [];
  if (type === "order" && items.length === 0 && amount === null) {
    missing.push("items");
  }
  if (items.some((it) => it.quantity <= 0)) {
    missing.push("quantity");
  }
  if (type === "ledger" && amount === null) {
    missing.push("amount");
  }
  if (!party) {
    missing.push("party");
  }

  let confidence = 0.75;
  if (missing.includes("items")) confidence = 0.3;
  else if (missing.includes("quantity")) confidence = 0.5;
  else if (missing.includes("amount")) confidence = 0.5;
  else if (missing.includes("party")) confidence = 0.55;
  else if (items.some((it) => !it.unit)) confidence = 0.65;

  let clarification = "";
  if (confidence < 0.6) {
    if (missing.includes("items")) clarification = "Kya aur kitna chahiye? Jaise '5 kg chawal'.";
    else if (missing.includes("quantity")) clarification = "Kitni matra chahiye?";
    else if (missing.includes("amount")) clarification = "Kitne rupaye likhne hain?";
    else if (missing.includes("party")) {
      clarification =
        type === "ledger"
          ? "Kis ke khate mein likhna hai?"
          : "Kis ko bhejna hai — dukaan ka naam bataiye.";
    }
  }

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
  const normalizedForSplit = normalizeDevanagari(input);
  const clauses = normalizedForSplit
    .split(/\s+(?:aur|and)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
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
