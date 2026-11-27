#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:3000";

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 900 },
    acceptDownloads: true,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });

  const page = await context.newPage();
  const pageErrors = [];
  const serverErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("response", (res) => {
    if (res.status() >= 500) {
      serverErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  // Pre-check: Demo mode banner, empty #api-key, initial No-edit accuracy KPI
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByText("API key set nahi hai", { exact: false }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator("#api-key").inputValue(), "");
  const kpi = page.getByLabel("No-edit accuracy");
  await kpi.waitFor({ timeout: 10000 });
  assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: —");
  console.log("PASS  Pre-check: Demo banner, empty #api-key, No-edit accuracy: —");

  const input = page.locator("#typed");
  const submitBtn = page.getByRole("button", { name: "Bhejiye" });
  const stockPulse = page.getByLabel("Stock pulse");

  // Beat 1: Mixed order + udhaar + low-stock setup
  await input.fill("3 packet surf Gupta store ko bhej do aur unka 200 udhaar tha");
  await submitBtn.click();

  const guptaCard = page.locator("article", { hasText: "Gupta Store" }).first();
  await guptaCard.waitFor({ timeout: 10000 });
  assert.equal(await page.locator("article").count(), 1);
  await guptaCard.getByText("Order", { exact: true }).waitFor({ timeout: 5000 });
  await guptaCard.getByText("Udhaar diya (+₹)", { exact: true }).waitFor({ timeout: 5000 });
  await guptaCard.getByText("3 packet surf", { exact: true }).waitFor({ timeout: 5000 });
  await guptaCard.getByText("Raqam / Udhaar: ₹200", { exact: true }).waitFor({ timeout: 5000 });

  await guptaCard.getByRole("button", { name: "Confirm & save" }).click();
  await guptaCard.getByText("Confirmed", { exact: true }).waitFor({ timeout: 5000 });
  const savedBtn = guptaCard.getByRole("button", { name: "Save ho gaya" });
  await savedBtn.waitFor({ timeout: 5000 });
  assert.equal(await savedBtn.isDisabled(), true);

  assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: 100% (1/1)");
  await stockPulse.getByText("Low stock: surf (1 packet bacha)", { exact: true }).waitFor({ timeout: 5000 });
  const reorderHref = await stockPulse.getByRole("link", { name: "Reorder on WhatsApp" }).getAttribute("href");
  assert.ok(reorderHref && reorderHref.startsWith("https://wa.me/?text="));
  console.log("PASS  Beat 1: Mixed order + udhaar confirmed, 100% (1/1), low-stock surf pulse");

  // Beat 2: Incomplete utterance -> inline "Clarify kijiye" patch in place -> confirm
  const chipContainer = page.getByLabel("Sample Hinglish commands");
  await chipContainer.getByRole("button", { name: "chawal bhej do", exact: true }).click();
  const draftCard = page.locator("article", { hasText: "Ye entry pakki nahi hai" }).first();
  await draftCard.waitFor({ timeout: 10000 });
  assert.equal(await page.locator("article").count(), 2);

  await draftCard.getByRole("button", { name: "Clarify kijiye" }).click();
  const clarifyStatus = page.locator('[role="status"]', { hasText: "Clarifying draft:" });
  await clarifyStatus.waitFor({ timeout: 5000 });
  await draftCard.getByRole("button", { name: "Jawaab neeche likh rahe hain…" }).waitFor({ timeout: 5000 });

  await input.fill("5 kg Verma store");
  await submitBtn.click();

  const vermaCard = page.locator("article", { hasText: "Verma Store" }).first();
  await vermaCard.waitFor({ timeout: 10000 });
  assert.equal(await page.locator("article").count(), 2);
  await vermaCard.getByText("Verma Store", { exact: true }).waitFor({ timeout: 5000 });
  await vermaCard.getByText("5 kg chawal (rice)", { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await clarifyStatus.count(), 0);

  await vermaCard.getByRole("button", { name: "Confirm & save" }).click();
  await vermaCard.getByText("Confirmed", { exact: true }).waitFor({ timeout: 5000 });
  assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: 100% (2/2)");
  console.log("PASS  Beat 2: Inline Clarify patch in place, confirmed, No-edit accuracy 100% (2/2)");

  // Beat 3: Khata (Parties) net balance + Stock drawer + Reload persistence
  await page.getByRole("tab", { name: "Khata (Parties)" }).click();
  await page.locator("h2", { hasText: "Khata (Parties)" }).waitFor({ timeout: 5000 });

  const khataGupta = page.locator("article", { hasText: "Gupta Store" }).first();
  await khataGupta.waitFor({ timeout: 5000 });
  await khataGupta.getByText("Udhaar diya: ₹200 • Wasooli: ₹0 • 1 confirmed", { exact: true }).waitFor({
    timeout: 5000,
  });
  await khataGupta.getByText("₹200 baki", { exact: true }).waitFor({ timeout: 5000 });

  await stockPulse.getByRole("button", { name: "Manage stock" }).click();
  const surfTile = stockPulse
    .locator("div.rounded-card")
    .filter({ has: page.locator("span", { hasText: /^surf$/ }) });
  const chawalTile = stockPulse
    .locator("div.rounded-card")
    .filter({ has: page.locator("span", { hasText: /^chawal$/ }) });
  await surfTile.getByText("1 packet", { exact: true }).waitFor({ timeout: 5000 });
  await surfTile.getByText("Low", { exact: true }).waitFor({ timeout: 5000 });
  await chawalTile.getByText("20 kg", { exact: true }).waitFor({ timeout: 5000 });

  await page.reload({ waitUntil: "networkidle" });
  await stockPulse.getByText("Low stock: surf (1 packet bacha)", { exact: true }).waitFor({ timeout: 10000 });
  assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: 100% (2/2)");
  await stockPulse.getByRole("button", { name: "Manage stock" }).click();
  await chawalTile.getByText("20 kg", { exact: true }).waitFor({ timeout: 5000 });

  await page.getByRole("tab", { name: "Khata (Parties)" }).click();
  await khataGupta.getByText("₹200 baki", { exact: true }).waitFor({ timeout: 5000 });
  console.log("PASS  Beat 3: Khata balance, stock drawer (surf 1 packet Low, chawal 20 kg), reload persistence");

  // Beat 4: 1-tap WhatsApp pe bhejein slip + Distributor CSV export & clipboard
  const khataWaHref = await khataGupta.getByRole("link", { name: "WhatsApp pe bhejein" }).getAttribute("href");
  assert.ok(khataWaHref && khataWaHref.startsWith("https://wa.me/?text="));
  const khataText = new URL(khataWaHref).searchParams.get("text") || "";
  assert.ok(khataText.includes("Gupta Store"), `Unexpected Khata WA text: ${khataText}`);
  assert.ok(khataText.includes("₹200 baki"), `Unexpected Khata WA text: ${khataText}`);
  assert.ok(khataText.includes("Udhaar: ₹200"), `Unexpected Khata WA text: ${khataText}`);
  assert.ok(khataText.includes("VyaparVani"), `Unexpected Khata WA text: ${khataText}`);

  await page.getByRole("tab", { name: "Sab" }).click();
  const entryGupta = page.locator("article", { hasText: "Gupta Store" }).first();
  await entryGupta.waitFor({ timeout: 5000 });
  const entryWaHref = await entryGupta.getByRole("link", { name: "WhatsApp pe bhejein" }).getAttribute("href");
  assert.ok(entryWaHref && entryWaHref.startsWith("https://wa.me/?text="));
  const entryText = new URL(entryWaHref).searchParams.get("text") || "";
  assert.ok(entryText.includes("Gupta Store"), `Unexpected Entry WA text: ${entryText}`);
  assert.ok(entryText.includes("3 packet surf"), `Unexpected Entry WA text: ${entryText}`);
  assert.ok(entryText.includes("Udhaar / Baki: ₹200"), `Unexpected Entry WA text: ${entryText}`);
  assert.ok(entryText.includes("VyaparVani"), `Unexpected Entry WA text: ${entryText}`);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Distributor Order Sheet (CSV)" }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "vyaparvani-distributor-orders.csv");
  const dlPath = await download.path();
  assert.ok(dlPath, "Expected downloaded CSV path");
  const csvContent = await readFile(dlPath, "utf8");
  const lines = csvContent.trim().split(/\r?\n/);
  assert.equal(lines[0], "Product,TotalQuantity,Unit,Parties,LatestDueDate");
  assert.ok(lines.some((line) => line.startsWith("chawal (rice),5,kg,Verma Store,")), csvContent);
  assert.ok(lines.some((line) => line.startsWith("surf,3,packet,Gupta Store,")), csvContent);

  await page.getByRole("button", { name: "Copy CSV" }).click();
  await page
    .locator('[role="status"][aria-live="polite"]', { hasText: "Distributor Order Sheet CSV copied." })
    .waitFor({ timeout: 5000 });
  const copiedText = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (copiedText !== null) {
    assert.ok(copiedText.includes("Product,TotalQuantity,Unit,Parties,LatestDueDate"));
  }
  console.log("PASS  Beat 4: WhatsApp slips (Khata + EntryCard) and Distributor CSV export + copy");

  assert.deepEqual(pageErrors, [], `Unexpected pageerror(s): ${pageErrors.join("; ")}`);
  assert.deepEqual(serverErrors, [], `Unexpected >=500 response(s): ${serverErrors.join("; ")}`);
  console.log("\nAll 4-beat finale E2E checks passed with 0 pageerrors and 0 server 5xx responses!");
} finally {
  await browser.close();
}
