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

    await page.getByText("Low stock: surf (1 packet bacha)").waitFor({ timeout: 5000 });
    const reorderHref = await page.getByRole("link", { name: "Reorder on WhatsApp" }).getAttribute("href");
    assert.ok(reorderHref && reorderHref.startsWith("https://wa.me/?text="));

    // Confirmed EntryCard WhatsApp slip + Distributor CSV buttons
    const cardWaHref = await guptaCard.getByRole("link", { name: "WhatsApp pe bhejein" }).getAttribute("href");
    assert.ok(cardWaHref && cardWaHref.startsWith("https://wa.me/?text="));
    await page.getByRole("button", { name: "Distributor Order Sheet (CSV)" }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Copy CSV" }).waitFor({ timeout: 5000 });

    // Khata (Parties) tab net balance + Wasooli record karo
    await page.getByRole("tab", { name: "Khata (Parties)" }).click();
    const khataCard = page.locator("article", { hasText: "Gupta Store" }).first();
    await khataCard.getByText("₹200 baki").waitFor({ timeout: 5000 });
    const khataWaHref = await khataCard.getByRole("link", { name: "WhatsApp pe bhejein" }).getAttribute("href");
    assert.ok(khataWaHref && khataWaHref.startsWith("https://wa.me/?text="));

    await khataCard.getByRole("button", { name: "Wasooli record karo" }).click();
    await khataCard.getByText("Settled").waitFor({ timeout: 5000 });

    // Voice restock clears low-stock surf alert
    await input.fill("5 packet surf stock mein add karo");
    await submitBtn.click();
    await page.getByText("Stock updated:", { exact: false }).waitFor({ timeout: 10000 });
    const lowCount = await page.getByText("Low stock: surf", { exact: false }).count();
    assert.equal(lowCount, 0);
  } finally {
    await browser.close();
  }
});

console.log(`\nAll ${passed} M3 verification checks passed!`);
