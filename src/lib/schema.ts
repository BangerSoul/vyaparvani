import { z } from "zod";

export const entryItemSchema = z.object({
  product: z.string().min(1),
  quantity: z.number().nonnegative(),
  unit: z.string().default(""),
});

export const parsedEntrySchema = z.object({
  type: z.enum(["order", "ledger"]),
  items: z.array(entryItemSchema).default([]),
  party: z.string().default(""),
  dueDate: z.string().default(""),
  amount: z.number().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  missing: z.array(z.string()).default([]),
  clarification: z.string().default(""),
});

export type ParsedEntry = z.infer<typeof parsedEntrySchema>;
export type EntryItem = z.infer<typeof entryItemSchema>;

// One utterance usually yields one entry, but can carry two instructions
// ("...ke liye 5 peti oil add karo, aur Suresh ka 500 udhaar likho").
export const parsedResponseSchema = z.object({
  entries: z.array(parsedEntrySchema).min(1).max(3),
});

// Trade glossary used in the model prompt and mirrored by the demo parser.
export const GLOSSARY = `
Units and trade terms (Hinglish / Hindi):
- kg, kgs, kilo = kilogram
- packet, packets, pkt = packet
- dibbi, dibba = box
- drib, dibi = small tin/case (local trade unit)
- kalawa = small bundle (local trade unit)
- peti = case/carton
- darjan = dozen
Hinglish numerals: ek=1, do=2, teen=3, chaar=4, paanch=5, chhe=6, saat=7, aath=8, nau=9, das=10, bees=20.
Common products: chawal (rice), atta (flour), dal, sugar/chini, tel (oil), namak, chai, dove, surf, sabun.
Ledger terms: udhaar, udhar, khata, credit, baki, lena, dena, jama, wasooli (collection).
Party words: "ko bhej do", "ke liye", store names like "Gupta store", "Sharma kirana".
`.trim();

export function getIstDate(daysAhead = 0, now: Date = new Date()): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffsetMs + daysAhead * dayMs).toISOString().slice(0, 10);
}

export function getIstTodayIso(now: Date = new Date()): string {
  return getIstDate(0, now);
}

export function buildSystemPrompt(istTodayIso: string = getIstTodayIso()): string {
  return `You extract structured retail entries from spoken-style Hinglish (or Devanagari Hindi) utterances by small-shop owners.
Today's date in IST (Asia/Kolkata) is ${istTodayIso}.
Each entry is type "order" (goods to send/deliver) or "ledger" (credit/udhaar/collection).
Usually an utterance is one entry; if it clearly contains two separate instructions (for example an order for one party and udhaar for another person), return both entries in spoken order. Never split a single instruction into multiple entries.
Rules:
- Use the glossary of local units and terms provided.
- Never invent a quantity, product or party that is not in the utterance. If a quantity is missing for an item, include the item with quantity 0 and list "quantity" or "items" in "missing".
- For ledger entries, require a party/customer name; if missing, list "party" in "missing".
- Set confidence below 0.6 when any word is ambiguous, a quantity is missing, or the party is unclear.
- When confidence is below 0.6, write one short Hinglish clarifying question in "clarification" (e.g. "Kitne kg chawal bhejne hain?").
- dueDate: ISO YYYY-MM-DD resolved from Today (${istTodayIso} IST) if a relative date like "aaj" (+0d), "kal" (+1d), or "parso" (+2d) is stated, else "".
- If an existing draft entry JSON is provided along with a clarification reply, merge the reply into the existing draft in place, clear resolved fields from "missing", and update confidence/clarification accordingly.
Glossary:
${GLOSSARY}`;
}

export const SYSTEM_PROMPT = buildSystemPrompt();
