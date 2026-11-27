import { z } from "zod";

export const entryItemSchema = z.object({
  product: z.string().min(1),
  quantity: z.number().positive(),
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

export const SYSTEM_PROMPT = `You extract structured retail entries from spoken-style Hinglish utterances by small-shop owners.
Each entry is type "order" (goods to send/deliver) or "ledger" (credit/udhaar/collection).
Usually an utterance is one entry; if it clearly contains two separate instructions (for example an order for one party and udhaar for another person), return both entries in spoken order. Never split a single instruction into multiple entries.
Rules:
- Use the glossary of local units and terms provided.
- Never invent a quantity, product or party that is not in the utterance. If a quantity is missing for an item, include the item with quantity 0... prefer instead to list the field name in "missing".
- Set confidence below 0.6 when any word is ambiguous, a quantity is missing, or the party is unclear.
- When confidence is below 0.6, write one short Hinglish clarifying question in "clarification" (e.g. "Kitne kg chawal bhejne hain?").
- dueDate: ISO YYYY-MM-DD if a relative date like "kal" (tomorrow) is stated, else "".
Glossary:
${GLOSSARY}`;
