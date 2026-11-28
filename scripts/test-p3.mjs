#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:3000";

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS  ${name}`);
}

const SAMPLE_CHIPS = [
  "5 kg chawal Gupta store ko bhej do",
  "Sharma kirana se 300 wasooli",
  "chawal bhej do",
  "Shyam Trader ko 5 peti tel aur Suresh ka 500 udhaar",
];

await test("REC-13: html[lang='hi-Latn'], saveKey sk- validation + Enter submit, chips + resetClarify, fixed toast + dismiss, Aaj/Pichhle din", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });

    // 1. <html lang="hi-Latn">
    const lang = await page.locator("html").getAttribute("lang");
    assert.equal(lang, "hi-Latn");

    // 2. saveKey validation + <button type="submit"> + Key hatayein
    await page.getByText("API key set nahi hai", { exact: false }).waitFor({ timeout: 10000 });
    const apiKeyInput = page.locator("#api-key");
    const saveKeyBtn = page.getByRole("button", { name: "Key save kijiye" });
    assert.equal(await saveKeyBtn.getAttribute("type"), "submit");

    // Empty submit via Enter
    await apiKeyInput.press("Enter");
    await page.locator("#api-key-error").waitFor({ timeout: 5000 });
    assert.equal(await apiKeyInput.getAttribute("aria-invalid"), "true");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("vyaparvani.key")), null);

    // Invalid prefix "test"
    await apiKeyInput.fill("test");
    await saveKeyBtn.click();
    const errText1 = await page.locator("#api-key-error").innerText();
    assert.ok(errText1.includes("sk-"));
    assert.equal(await page.evaluate(() => sessionStorage.getItem("vyaparvani.key")), null);

    // Too short "sk-"
    await apiKeyInput.fill("sk-");
    await saveKeyBtn.click();
    await page.locator("#api-key-error").waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem("vyaparvani.key")), null);

    // Typing valid key clears inline error; Enter submits form
    await apiKeyInput.fill("sk-validtestkey123");
    assert.equal(await page.locator("#api-key-error").count(), 0);
    await apiKeyInput.press("Enter");
    await page.getByRole("button", { name: "Key hatayein" }).waitFor({ timeout: 5000 });
    await page.locator("p", { hasText: "API key set — ab real model se parsing hogi." }).waitFor({ timeout: 5000 });
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("vyaparvani.key")),
      "sk-validtestkey123",
    );

    // Key hatayein restores Demo mode
    await page.getByRole("button", { name: "Key hatayein" }).click();
    await page.getByText("API key set nahi hai", { exact: false }).waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem("vyaparvani.key")), null);

    // 3. 4 clickable Hinglish sample chips below #typed + resetClarify
    const chipContainer = page.getByLabel("Sample Hinglish commands");
    for (const chip of SAMPLE_CHIPS) {
      await chipContainer.getByRole("button", { name: chip, exact: true }).waitFor({ timeout: 5000 });
    }

    // Click ambiguous chip -> activate Clarify -> click mixed chip (must NOT merge into draft)
    await chipContainer.getByRole("button", { name: "chawal bhej do", exact: true }).click();
    const draftCard = page.locator("article", { hasText: "Ye entry pakki nahi hai" }).first();
    await draftCard.waitFor({ timeout: 10000 });
    await draftCard.getByRole("button", { name: "Clarify kijiye" }).click();
    await page.getByText("Clarifying draft:", { exact: false }).waitFor({ timeout: 5000 });

    await chipContainer
      .getByRole("button", { name: "Shyam Trader ko 5 peti tel aur Suresh ka 500 udhaar", exact: true })
      .click();
    await page.locator("article", { hasText: "Shyam Trader" }).first().waitFor({ timeout: 10000 });
    await page.locator("article", { hasText: "Suresh" }).first().waitFor({ timeout: 10000 });
    assert.equal(await page.getByText("Clarifying draft:", { exact: false }).count(), 0);
    // Original ambiguous draft must remain unmerged with missing items/party
    await draftCard.getByText("Ye entry pakki nahi hai", { exact: false }).waitFor({ timeout: 5000 });

    // 4. Toast position: fixed + zIndex: 50 + dismiss button
    const toast = page.locator('[role="status"][aria-live="polite"]');
    await toast.waitFor({ timeout: 5000 });
    const toastStyle = await toast.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, zIndex: cs.zIndex };
    });
    assert.equal(toastStyle.position, "fixed");
    assert.equal(toastStyle.zIndex, "50");

    await page.getByRole("button", { name: "Dismiss notification" }).click();
    assert.equal(await toast.count(), 0);

    // 5. Aaj vs Pichhle din IST grouping across reload
    await page.evaluate(() => {
      const raw = localStorage.getItem("vyaparvani.entries.v1") || "[]";
      const list = JSON.parse(raw);
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      list.push({
        id: "older-ist-entry",
        createdAt: threeDaysAgo,
        status: "confirmed",
        type: "order",
        ledgerAction: null,
        items: [{ product: "atta", quantity: 10, unit: "kg" }],
        party: "Purana Store",
        dueDate: "",
        amount: null,
        confidence: 1,
        missing: [],
        clarification: "",
        source: "10 kg atta Purana store ko bhej do",
        mode: "demo",
      });
      localStorage.setItem("vyaparvani.entries.v1", JSON.stringify(list));
    });
    await page.reload({ waitUntil: "networkidle" });

    await page.locator("h2", { hasText: "Entries" }).waitFor({ timeout: 10000 });
    await page.locator("h3", { hasText: "Aaj" }).waitFor({ timeout: 5000 });
    await page.locator("h3", { hasText: "Pichhle din" }).waitFor({ timeout: 5000 });

    // On Khata (Parties) tab, h2 updates to Khata (Parties) and Aaj/Pichhle din do not show
    await page.getByRole("tab", { name: "Khata (Parties)" }).click();
    await page.locator("h2", { hasText: "Khata (Parties)" }).waitFor({ timeout: 5000 });
    assert.equal(await page.locator("h3", { hasText: "Pichhle din" }).count(), 0);
  } finally {
    await browser.close();
  }
});

await test("REC-13: edited?: boolean & No-edit accuracy KPI pill (clarify stays unedited, manual edit counts, persists across reload)", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });

    const kpi = page.getByLabel("No-edit accuracy");
    await kpi.waitFor({ timeout: 10000 });
    assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: —");

    const chipContainer = page.getByLabel("Sample Hinglish commands");

    // 1st entry: sample chip confirmed without edit -> 100% (1/1)
    await chipContainer
      .getByRole("button", { name: "5 kg chawal Gupta store ko bhej do", exact: true })
      .click();
    const guptaCard = page.locator("article", { hasText: "Gupta Store" }).first();
    await guptaCard.waitFor({ timeout: 10000 });
    await guptaCard.getByRole("button", { name: "Confirm & save" }).click();
    await guptaCard.getByText("Confirmed", { exact: true }).waitFor({ timeout: 5000 });
    assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: 100% (1/1)");

    // 2nd entry: guided inline clarification + confirm must NOT count as edited -> 100% (2/2)
    await chipContainer.getByRole("button", { name: "chawal bhej do", exact: true }).click();
    const clarifyCard = page.locator("article", { hasText: "Ye entry pakki nahi hai" }).first();
    await clarifyCard.waitFor({ timeout: 10000 });
    await clarifyCard.getByRole("button", { name: "Clarify kijiye" }).click();
    await page.locator("#typed").fill("2 kg Verma store");
    await page.getByRole("button", { name: "Bhejiye" }).click();
    const vermaCard = page.locator("article", { hasText: "Verma Store" }).first();
    await vermaCard.waitFor({ timeout: 10000 });
    await vermaCard.getByRole("button", { name: "Confirm & save" }).click();
    await vermaCard.getByText("Confirmed", { exact: true }).waitFor({ timeout: 5000 });
    assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: 100% (2/2)");

    // 3rd entry: manual Edit -> Save edits -> Confirm -> edited: true -> 67% (2/3)
    await chipContainer
      .getByRole("button", { name: "Sharma kirana se 300 wasooli", exact: true })
      .click();
    const sharmaCard = page.locator("article", { hasText: "Sharma Kirana" }).first();
    await sharmaCard.waitFor({ timeout: 10000 });
    await sharmaCard.getByRole("button", { name: "Edit" }).click();
    const editingCard = page.locator("article", { hasText: "Save edits" }).first();
    await editingCard.getByPlaceholder("Gupta store").fill("Sharma Kirana Edited");
    await editingCard.getByRole("button", { name: "Save edits" }).click();
    const editedCard = page.locator("article", { hasText: "Sharma Kirana Edited" }).first();
    await editedCard.waitFor({ timeout: 5000 });
    await editedCard.getByRole("button", { name: "Confirm & save" }).click();
    await editedCard.getByText("Confirmed", { exact: true }).waitFor({ timeout: 5000 });
    assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: 67% (2/3)");

    // Reload and verify edited?: boolean & KPI persist via normalizeEntry()
    await page.reload({ waitUntil: "networkidle" });
    await kpi.waitFor({ timeout: 10000 });
    assert.equal((await kpi.innerText()).trim(), "No-edit accuracy: 67% (2/3)");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("vyaparvani.entries.v1") || "[]"),
    );
    const editedEntry = stored.find((e) => e.party === "Sharma Kirana Edited");
    const uneditedEntry = stored.find((e) => e.party === "Gupta Store");
    const clarifiedEntry = stored.find((e) => e.party === "Verma Store");
    assert.equal(editedEntry?.edited, true);
    assert.notEqual(uneditedEntry?.edited, true);
    assert.notEqual(clarifiedEntry?.edited, true);
  } finally {
    await browser.close();
  }
});

await test("Demo resilience: 'kg chawal gupta ji ko bhejdo', inline card Update, and Demo Voice Mic in unsupported browser", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });

    // 1. "kg chawal gupta ji ko bhejdo" keeps Gupta Ji + 0 kg chawal (rice) and clarifies inline
    await page.locator("#typed").fill("kg chawal gupta ji ko bhejdo");
    await page.getByRole("button", { name: "Bhejiye" }).click();

    const guptaCard = page.locator("article", { hasText: "Gupta Ji" }).first();
    await guptaCard.waitFor({ timeout: 10000 });
    await guptaCard.getByText("0 kg chawal (rice)", { exact: false }).waitFor({ timeout: 5000 });

    await guptaCard.getByRole("button", { name: "Clarify kijiye" }).click();
    await guptaCard.getByPlaceholder("Yahan jawaab likhein", { exact: false }).fill("5");
    await guptaCard.getByRole("button", { name: "Update" }).click();
    await guptaCard.getByText("5 kg chawal (rice)", { exact: true }).waitFor({ timeout: 5000 });

    // 2. Demo Voice Mic pill + Hands-free auto-submit
    await page.getByLabel(/Hands-free mode/i).check();
    const demoMicToggle = page.getByRole("button", { name: "Demo Voice Mic", exact: true });
    await demoMicToggle.click();
    await page.getByRole("button", { name: "Demo Voice Mic ON", exact: true }).waitFor({ timeout: 5000 });

    const micBtn = page.getByRole("button", { name: "Start recording" });
    assert.equal(await micBtn.isDisabled(), false);
    await micBtn.click();

    // Default first Demo Voice phrase creates Gupta Store 3 packet surf + 200 udhaar
    const streamedCard = page.locator("article", { hasText: "Gupta Store" }).first();
    await streamedCard.waitFor({ timeout: 15000 });
    await streamedCard.getByText("3 packet surf", { exact: true }).waitFor({ timeout: 5000 });

    // 3. Simulate Brave cloud speech 'network' error -> 1-click auto-fallback to Demo Voice Mic
    await page.evaluate(() => {
      class FakeBlockedSpeechRecognition {
        lang = "hi-IN";
        interimResults = true;
        continuous = true;
        onresult = null;
        onend = null;
        onerror = null;
        start() {
          setTimeout(() => {
            this.onerror?.({ error: "network" });
            this.onend?.();
          }, 50);
        }
        stop() {}
        abort() {}
      }
      window.SpeechRecognition = FakeBlockedSpeechRecognition;
      window.webkitSpeechRecognition = FakeBlockedSpeechRecognition;
    });
    // Switch Demo Voice Mic back off to return to Browser Speech adapter, then click Mic
    await page.getByRole("button", { name: "Demo Voice Mic ON", exact: true }).click();
    await page.getByRole("button", { name: "Demo Voice Mic", exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Start recording" }).click();

    // Auto-fallback runs phrase #2 ("5 kg chawal Verma store ko bhej do") without any red error box
    const fallbackCard = page.locator("article", { hasText: "Verma Store" }).first();
    await fallbackCard.waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[role="alert"]').filter({ hasText: "Mic error" }).count(), 0);
  } finally {
    await browser.close();
  }
});

console.log(`\nAll ${passed} REC-13 (test-p3) verification checks passed!`);
