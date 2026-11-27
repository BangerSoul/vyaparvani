#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:3000";

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

// 1. /api/transcribe error handling (never 500)
await test("POST /api/transcribe rejects non-multipart body with 400", async () => {
  const res = await fetch(`${base}/api/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(typeof data.error === "string" && data.error.length > 0);
});

await test("POST /api/transcribe rejects missing audio field with 400", async () => {
  const form = new FormData();
  const res = await fetch(`${base}/api/transcribe`, {
    method: "POST",
    body: form,
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(typeof data.error === "string" && data.error.length > 0);
});

await test("POST /api/transcribe returns 400 when API key is missing", async () => {
  const form = new FormData();
  form.append("audio", new Blob(["dummy-webm-bytes"], { type: "audio/webm" }), "recording.webm");
  const res = await fetch(`${base}/api/transcribe`, {
    method: "POST",
    body: form,
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(typeof data.error === "string" && data.error.length > 0);
});

// 2. ledgerAction parsing semantics (REC-07)
await test("POST /api/parse sets ledgerAction=credit_given on udhaar", async () => {
  const { status, data } = await postParse({ utterance: "Gupta store ka 250 rs udhaar likh do" });
  assert.equal(status, 200);
  assert.equal(data.entries[0].type, "ledger");
  assert.equal(data.entries[0].ledgerAction, "credit_given");
  assert.equal(data.entries[0].amount, 250);
});

await test("POST /api/parse prioritizes payment_received on 'udhaar jama ho gaya'", async () => {
  const { status, data } = await postParse({
    utterance: "Sharma kirana ka 500 rupaye udhaar jama ho gaya",
  });
  assert.equal(status, 200);
  assert.equal(data.entries[0].type, "ledger");
  assert.equal(data.entries[0].ledgerAction, "payment_received");
  assert.equal(data.entries[0].amount, 500);
});

await test("POST /api/parse sets payment_received on wasooli", async () => {
  const { status, data } = await postParse({
    utterance: "Sharma kirana se 300 ka wasooli ho gaya",
  });
  assert.equal(status, 200);
  assert.equal(data.entries[0].type, "ledger");
  assert.equal(data.entries[0].ledgerAction, "payment_received");
});

await test("POST /api/parse keeps ledgerAction=null on price-denominated order", async () => {
  const { status, data } = await postParse({
    utterance: "50 rupaye ka chawal Gupta store ko bhej do",
  });
  assert.equal(status, 200);
  assert.equal(data.entries[0].type, "order");
  assert.equal(data.entries[0].amount, 50);
  assert.equal(data.entries[0].ledgerAction, null);
});

await test("POST /api/parse sets credit_given on mixed order+udhaar", async () => {
  const { status, data } = await postParse({
    utterance: "Gupta store ko 5 kg chawal bhej do aur unka 200 udhaar tha",
  });
  assert.equal(status, 200);
  assert.equal(data.entries[0].type, "order");
  assert.equal(data.entries[0].amount, 200);
  assert.equal(data.entries[0].ledgerAction, "credit_given");
});

await test("POST /api/parse handles mila, clear, dena/lena price-orders, and Hinglish amount clarification", async () => {
  const rMila = await postParse({ utterance: "Sharma se 500 mila" });
  assert.equal(rMila.status, 200);
  assert.equal(rMila.data.entries[0].type, "ledger");
  assert.equal(rMila.data.entries[0].ledgerAction, "payment_received");
  assert.equal(rMila.data.entries[0].amount, 500);
  assert.equal(rMila.data.entries[0].party, "Sharma");
  assert.deepEqual(rMila.data.entries[0].items, []);

  const rClear = await postParse({ utterance: "Gupta store ka 750 clear ho gaya" });
  assert.equal(rClear.status, 200);
  assert.equal(rClear.data.entries[0].type, "ledger");
  assert.equal(rClear.data.entries[0].ledgerAction, "payment_received");
  assert.equal(rClear.data.entries[0].amount, 750);
  assert.equal(rClear.data.entries[0].party, "Gupta Store");

  const rDenaOrder = await postParse({ utterance: "50 rupaye ka chawal Gupta store ko dena" });
  assert.equal(rDenaOrder.status, 200);
  assert.equal(rDenaOrder.data.entries[0].type, "order");
  assert.equal(rDenaOrder.data.entries[0].amount, 50);
  assert.equal(rDenaOrder.data.entries[0].ledgerAction, null);

  const rLenaOrder = await postParse({ utterance: "100 rs ki chini Gupta store se lena" });
  assert.equal(rLenaOrder.status, 200);
  assert.equal(rLenaOrder.data.entries[0].type, "order");
  assert.equal(rLenaOrder.data.entries[0].amount, 100);
  assert.equal(rLenaOrder.data.entries[0].ledgerAction, null);

  const rUdhaarDena = await postParse({ utterance: "Gupta store ko 500 rupaye udhaar dena" });
  assert.equal(rUdhaarDena.status, 200);
  assert.equal(rUdhaarDena.data.entries[0].type, "ledger");
  assert.equal(rUdhaarDena.data.entries[0].ledgerAction, "credit_given");
  assert.equal(rUdhaarDena.data.entries[0].amount, 500);

  const rMissingAmt = await postParse({ utterance: "Gupta store ka udhaar" });
  assert.equal(rMissingAmt.status, 200);
  const e1 = rMissingAmt.data.entries[0];
  assert.equal(e1.type, "ledger");
  assert.equal(e1.amount, null);
  assert.ok(e1.missing.includes("amount"));

  const rClarified = await postParse({
    utterance: "paanch sau",
    existingEntry: { ...e1, source: "Gupta store ka udhaar" },
  });
  assert.equal(rClarified.status, 200);
  assert.equal(rClarified.data.entries[0].amount, 500);
  assert.deepEqual(rClarified.data.entries[0].missing, []);

  const rProductFirstRestock = await postParse({ utterance: "chawal 10 kg stock mein add karo" });
  assert.equal(rProductFirstRestock.status, 200);
  assert.equal(rProductFirstRestock.data.entries[0].items.length, 1);
  assert.ok(rProductFirstRestock.data.entries[0].items[0].product.includes("chawal"));
  assert.equal(rProductFirstRestock.data.entries[0].items[0].quantity, 10);
});

// 3. Playwright M3 Demo-mode UI verification
await test("Playwright M3 UI flows: Wispr/Hands-free defaults, stock deduction, Khata, WhatsApp, CSV", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });

    // Toggles must default to false so automation is never hijacked
    const wisprToggle = page.getByLabel(/Wispr Flow Dictation Mode/i);
    const handsFreeToggle = page.getByLabel(/Hands-free mode/i);
    await wisprToggle.waitFor({ timeout: 10000 });
    assert.equal(await wisprToggle.isChecked(), false);
    assert.equal(await handsFreeToggle.isChecked(), false);

    // Toggleable ON and OFF
    await wisprToggle.check();
    assert.equal(await wisprToggle.isChecked(), true);
    await wisprToggle.uncheck();
    assert.equal(await wisprToggle.isChecked(), false);

    await handsFreeToggle.check();
    assert.equal(await handsFreeToggle.isChecked(), true);
    await handsFreeToggle.uncheck();
    assert.equal(await handsFreeToggle.isChecked(), false);

    // Dictionary drawer expands
    await page.getByRole("button", { name: "Kirana dictionary (Wispr Flow)" }).click();
    await page.getByText("drib", { exact: true }).waitFor({ timeout: 5000 });

    // Confirm 3 packet surf order + 200 udhaar -> deducts surf (4 -> 1) -> low-stock alert
    const input = page.locator("#typed");
    const submitBtn = page.getByRole("button", { name: "Bhejiye" });
    await input.fill("3 packet surf Gupta store ko bhej do aur unka 200 udhaar tha");
    await submitBtn.click();

    const guptaCard = page.locator("article", { hasText: "Gupta Store" }).first();
    await guptaCard.waitFor({ timeout: 10000 });
    await guptaCard.getByRole("button", { name: "Confirm & save" }).click();

    const stockPulse = page.getByLabel("Stock pulse");
    await stockPulse.getByText("Low stock: surf (1 packet bacha)", { exact: true }).waitFor({ timeout: 5000 });
    const reorderHref = await stockPulse.getByRole("link", { name: "Reorder on WhatsApp" }).getAttribute("href");
    assert.ok(reorderHref && reorderHref.startsWith("https://wa.me/?text="));

    // Confirmed EntryCard WhatsApp slip + Distributor CSV buttons
    const cardWaHref = await guptaCard.getByRole("link", { name: "WhatsApp pe bhejein" }).getAttribute("href");
    assert.ok(cardWaHref && cardWaHref.startsWith("https://wa.me/?text="));
    await page.getByRole("button", { name: "Distributor Order Sheet (CSV)" }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Copy CSV" }).waitFor({ timeout: 5000 });

    // Khata (Parties) tab net balance + Wasooli record karo
    await page.getByRole("tab", { name: "Khata (Parties)" }).click();
    const khataCard = page.locator("article", { hasText: "Gupta Store" }).first();
    await khataCard.getByText("₹200 baki", { exact: true }).waitFor({ timeout: 5000 });
    const khataWaHref = await khataCard.getByRole("link", { name: "WhatsApp pe bhejein" }).getAttribute("href");
    assert.ok(khataWaHref && khataWaHref.startsWith("https://wa.me/?text="));

    await khataCard.getByRole("button", { name: "Wasooli record karo" }).click();
    await khataCard.getByText("Settled", { exact: true }).waitFor({ timeout: 5000 });

    // Voice restock clears low-stock surf alert
    await input.fill("5 packet surf stock mein add karo");
    await submitBtn.click();
    await page.getByText("Stock updated:", { exact: false }).first().waitFor({ timeout: 10000 });
    const lowCount = await stockPulse.getByText("Low stock: surf", { exact: false }).count();
    assert.equal(lowCount, 0);
  } finally {
    await browser.close();
  }
});

await test("Playwright M3 remediation flows: multi-word SKU, product-first restock, New Stock Store, Wasooli double-click, confirmed-edit draft revert", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });

    const input = page.locator("#typed");
    const submitBtn = page.getByRole("button", { name: "Bhejiye" });
    const stockPulse = page.getByLabel("Stock pulse");

    // Open stock drawer and check initial chawal = 25 kg
    await stockPulse.getByRole("button", { name: "Manage stock" }).click();
    await stockPulse.getByText("25 kg", { exact: true }).waitFor({ timeout: 5000 });

    // Multi-word SKU "basmati chawal" deducts chawal stock (25 -> 23)
    await input.fill("2 kg basmati chawal Gupta store ko bhej do");
    await submitBtn.click();
    const guptaCard = page.locator("article", { hasText: "Gupta Store" }).first();
    await guptaCard.waitFor({ timeout: 10000 });
    await guptaCard.getByRole("button", { name: "Confirm & save" }).click();
    await stockPulse.getByText("23 kg", { exact: true }).waitFor({ timeout: 5000 });

    // Product-first restock updates chawal (23 -> 33) and does NOT create bogus "stock" SKU
    await input.fill("chawal 10 kg stock mein add karo");
    await submitBtn.click();
    await stockPulse.getByText("33 kg", { exact: true }).waitFor({ timeout: 10000 });
    await stockPulse.getByText("8 SKUs tracked", { exact: true }).waitFor({ timeout: 5000 });

    // Customer order for "New Stock Store" creates an order card (not restock)
    await input.fill("New Stock Store ke liye 5 peti oil add karo");
    await submitBtn.click();
    const newStockCard = page.locator("article", { hasText: "New Stock Store" }).first();
    await newStockCard.waitFor({ timeout: 10000 });

    // Editing a confirmed entry to quantity 0 reverts status to Draft
    await newStockCard.getByRole("button", { name: "Confirm & save" }).click();
    await newStockCard.getByText("Confirmed", { exact: true }).waitFor({ timeout: 5000 });
    const topOrderCard = page.locator("article", { hasText: "Order" }).first();
    await topOrderCard.getByRole("button", { name: "Edit" }).click();
    await topOrderCard.getByLabel("Quantity 1").fill("0");
    await topOrderCard.getByRole("button", { name: "Save edits" }).click();
    await newStockCard.getByText("Draft", { exact: true }).waitFor({ timeout: 5000 });

    // Rapid double-click on Wasooli record karo creates only 1 payment entry -> Settled
    await input.fill("Mehta store ka 300 udhaar likh do");
    await submitBtn.click();
    const mehtaOrderCard = page.locator("article", { hasText: "Mehta Store" }).first();
    await mehtaOrderCard.waitFor({ timeout: 10000 });
    await mehtaOrderCard.getByRole("button", { name: "Confirm & save" }).click();
    await mehtaOrderCard.getByText("Confirmed", { exact: true }).waitFor({ timeout: 5000 });

    await page.getByRole("tab", { name: "Khata (Parties)" }).click();
    const mehtaKhataCard = page.locator("article", { hasText: "Mehta Store" }).first();
    await mehtaKhataCard.getByText("₹300 baki", { exact: true }).waitFor({ timeout: 5000 });

    const wasooliBtn = mehtaKhataCard.getByRole("button", { name: "Wasooli record karo" });
    await wasooliBtn.waitFor({ timeout: 5000 });
    await wasooliBtn.evaluate((el) => {
      el.click();
      el.click();
    });

    await mehtaKhataCard.getByText("Settled", { exact: true }).waitFor({ timeout: 5000 });
    await mehtaKhataCard.getByText("Wasooli: ₹300", { exact: false }).waitFor({ timeout: 5000 });
    await mehtaKhataCard.getByText("2 confirmed", { exact: false }).waitFor({ timeout: 5000 });
    assert.equal(await mehtaKhataCard.getByText("advance", { exact: false }).count(), 0);
  } finally {
    await browser.close();
  }
});

console.log(`\nAll ${passed} M3 verification checks passed!`);
