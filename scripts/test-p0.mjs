#!/usr/bin/env node
import assert from "node:assert/strict";

const base = process.argv[2] || "http://127.0.0.1:3000";

function istDate(daysAhead = 0) {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000 + daysAhead * 24 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

async function postParse(payload) {
  const res = await fetch(`${base}/api/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS  ${name}`);
}

// 1. Empty / invalid JSON returns 400
await test("empty utterance returns 400", async () => {
  const { status, data } = await postParse({ utterance: "   " });
  assert.equal(status, 400);
  assert.ok(typeof data.error === "string" && data.error.length > 0);
});

// 2. 0 kg chawal does NOT crash with 500; returns quantity === 0 and missing quantity
await test("0 kg chawal returns 200 with quantity 0 & missing quantity", async () => {
  const { status, data } = await postParse({ utterance: "0 kg chawal Gupta store ko bhej do" });
  assert.equal(status, 200);
  assert.equal(data.mode, "demo");
  assert.equal(data.entries.length, 1);
  const e = data.entries[0];
  assert.equal(e.type, "order");
  assert.equal(e.party, "Gupta Store");
  assert.equal(e.items.length, 1);
  assert.equal(e.items[0].quantity, 0);
  assert.ok(e.items[0].product.includes("chawal"));
  assert.ok(e.missing.includes("quantity"));
  assert.ok(e.confidence < 0.6);
});

// 3. Devanagari input
await test("Devanagari utterance parses cleanly", async () => {
  const { status, data } = await postParse({ utterance: "५ किलो चावल गुप्ता स्टोर को भेज दो" });
  assert.equal(status, 200);
  const e = data.entries[0];
  assert.equal(e.type, "order");
  assert.equal(e.party, "Gupta Store");
  assert.deepEqual(e.items, [{ product: "chawal (rice)", quantity: 5, unit: "kg" }]);
});

// 4. Nameless ledger requires party
await test("nameless ledger sets missing party and asks Khata clarification", async () => {
  const { status, data } = await postParse({ utterance: "500 rupaye udhaar likh do" });
  assert.equal(status, 200);
  const e = data.entries[0];
  assert.equal(e.type, "ledger");
  assert.equal(e.amount, 500);
  assert.equal(e.party, "");
  assert.ok(e.missing.includes("party"));
  assert.ok(e.confidence <= 0.55);
  assert.equal(e.clarification, "Kis ke khate mein likhna hai?");
});

// 5. Attached currency and units (250rs, ₹500, 500/-, 5kg)
await test("attached currency 250rs, ₹500, 500/- and unit 5kg", async () => {
  const r1 = await postParse({ utterance: "Gupta store ka 250rs udhaar likh do" });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.entries[0].type, "ledger");
  assert.equal(r1.data.entries[0].amount, 250);
  assert.equal(r1.data.entries[0].party, "Gupta Store");

  const r2 = await postParse({ utterance: "Gupta store ka ₹500 udhaar likh do" });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.entries[0].type, "ledger");
  assert.equal(r2.data.entries[0].amount, 500);
  assert.equal(r2.data.entries[0].party, "Gupta Store");

  const r3 = await postParse({ utterance: "5kg chawal Gupta store ko bhej do" });
  assert.equal(r3.status, 200);
  assert.deepEqual(r3.data.entries[0].items, [{ product: "chawal (rice)", quantity: 5, unit: "kg" }]);
});

// 6. Indian fractions (aadha, dedh, saadhe teen)
await test("Indian fractions aadha, dedh, saadhe teen", async () => {
  const r1 = await postParse({ utterance: "aadha kg chini Gupta store ko bhej do" });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.entries[0].items[0].quantity, 0.5);
  assert.ok(r1.data.entries[0].items[0].product.includes("chini"));

  const r2 = await postParse({ utterance: "dedh litre tel Gupta store ko bhej do" });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.entries[0].items[0].quantity, 1.5);
  assert.equal(r2.data.entries[0].items[0].unit, "litre");

  const r3 = await postParse({ utterance: "saadhe teen kg atta Sharma kirana ko bhej do" });
  assert.equal(r3.status, 200);
  assert.equal(r3.data.entries[0].items[0].quantity, 3.5);
  assert.equal(r3.data.entries[0].party, "Sharma Kirana");
});

// 7. NUM_WORDS directly before KNOWN_PRODUCTS without matching verb 'do'
await test("paanch chawal parses 5 chawal and ignores verb do", async () => {
  const { status, data } = await postParse({ utterance: "paanch chawal Gupta store ko bhej do" });
  assert.equal(status, 200);
  const e = data.entries[0];
  assert.equal(e.type, "order");
  assert.equal(e.party, "Gupta Store");
  assert.equal(e.items.length, 1);
  assert.equal(e.items[0].quantity, 5);
  assert.ok(e.items[0].product.includes("chawal"));
});

// 8. lastProduct binding across multiple <product> <qty> <unit> items
await test("lastProduct binds chawal 5 kg aur dal 2 kg", async () => {
  const { status, data } = await postParse({ utterance: "chawal 5 kg aur dal 2 kg Gupta store ko" });
  assert.equal(status, 200);
  const e = data.entries[0];
  assert.equal(e.type, "order");
  assert.equal(e.party, "Gupta Store");
  assert.deepEqual(e.items, [
    { product: "chawal (rice)", quantity: 5, unit: "kg" },
    { product: "dal", quantity: 2, unit: "kg" },
  ]);
});

// 9. Price-order misclassification fix
await test("50 rupaye ka chawal parses as order with amount 50", async () => {
  const { status, data } = await postParse({ utterance: "50 rupaye ka chawal Gupta store ko bhej do" });
  assert.equal(status, 200);
  const e = data.entries[0];
  assert.equal(e.type, "order");
  assert.equal(e.party, "Gupta Store");
  assert.equal(e.amount, 50);
  assert.equal(e.items.length, 1);
  assert.ok(e.items[0].product.includes("chawal"));
});

// 10. Ledger party extraction: amount-first + 'se' + multi-word party
await test("amount-first ledger and se postposition party extraction", async () => {
  const r1 = await postParse({ utterance: "500 rupaye ka udhaar Ramesh ka likh do" });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.entries[0].type, "ledger");
  assert.equal(r1.data.entries[0].party, "Ramesh");
  assert.equal(r1.data.entries[0].amount, 500);

  const r2 = await postParse({ utterance: "Sharma se 300 wasooli" });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.entries[0].type, "ledger");
  assert.equal(r2.data.entries[0].party, "Sharma");
  assert.equal(r2.data.entries[0].amount, 300);

  const r3 = await postParse({ utterance: "5 kg dal New Patel Mart ko bhej do" });
  assert.equal(r3.status, 200);
  assert.equal(r3.data.entries[0].party, "New Patel Mart");
});

// 11. IST dueDate
await test("kal resolves to IST tomorrow", async () => {
  const { status, data } = await postParse({ utterance: "5 kg chawal Gupta store ko kal bhej do" });
  assert.equal(status, 200);
  assert.equal(data.entries[0].dueDate, istDate(1));
});

// 12. Structured clarification merges (REC-04)
await test("clarify merge: chawal bhej do -> 5 kg -> Gupta store", async () => {
  const step1 = await postParse({ utterance: "chawal bhej do" });
  assert.equal(step1.status, 200);
  const e1 = step1.data.entries[0];
  assert.ok(e1.confidence < 0.6);

  const step2 = await postParse({
    utterance: "5 kg",
    existingEntry: { ...e1, source: "chawal bhej do" },
  });
  assert.equal(step2.status, 200);
  const e2 = step2.data.entries[0];
  assert.deepEqual(e2.items, [{ product: "chawal (rice)", quantity: 5, unit: "kg" }]);
  assert.ok(e2.missing.includes("party"));

  const step3 = await postParse({
    utterance: "Gupta store",
    existingEntry: { ...e2, source: "chawal bhej do — 5 kg" },
  });
  assert.equal(step3.status, 200);
  const e3 = step3.data.entries[0];
  assert.deepEqual(e3.items, [{ product: "chawal (rice)", quantity: 5, unit: "kg" }]);
  assert.equal(e3.party, "Gupta Store");
  assert.deepEqual(e3.missing, []);
  assert.ok(e3.confidence >= 0.6);
});

await test("clarify merge: 5 kg bhej do Gupta store ko -> chawal", async () => {
  const step1 = await postParse({ utterance: "5 kg bhej do Gupta store ko" });
  assert.equal(step1.status, 200);
  const e1 = step1.data.entries[0];
  assert.equal(e1.party, "Gupta Store");
  assert.ok(e1.missing.includes("product"));

  const step2 = await postParse({
    utterance: "chawal",
    existingEntry: { ...e1, source: "5 kg bhej do Gupta store ko" },
  });
  assert.equal(step2.status, 200);
  const e2 = step2.data.entries[0];
  assert.deepEqual(e2.items, [{ product: "chawal (rice)", quantity: 5, unit: "kg" }]);
  assert.equal(e2.party, "Gupta Store");
  assert.deepEqual(e2.missing, []);
  assert.ok(e2.confidence >= 0.6);
});

await test("clarify merge: 500 udhaar likh do -> Ramesh", async () => {
  const step1 = await postParse({ utterance: "500 udhaar likh do" });
  assert.equal(step1.status, 200);
  const e1 = step1.data.entries[0];
  assert.equal(e1.type, "ledger");
  assert.equal(e1.amount, 500);
  assert.ok(e1.missing.includes("party"));

  const step2 = await postParse({
    utterance: "Ramesh",
    existingEntry: { ...e1, source: "500 udhaar likh do" },
  });
  assert.equal(step2.status, 200);
  const e2 = step2.data.entries[0];
  assert.equal(e2.type, "ledger");
  assert.equal(e2.amount, 500);
  assert.equal(e2.party, "Ramesh");
  assert.deepEqual(e2.missing, []);
  assert.ok(e2.confidence >= 0.6);
});

console.log(`\nAll ${passed} P0 verification checks passed!`);
