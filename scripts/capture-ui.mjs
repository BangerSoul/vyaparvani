#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.argv[2] || "http://127.0.0.1:3000";
const outPath = process.argv[3] || "decks/assets/ui-screenshot.png";
const resolvedOut = resolve(outPath);

mkdirSync(dirname(resolvedOut), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 860, height: 940 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // Wait for Demo mode banner
  await page.getByText("API key set nahi hai", { exact: false }).waitFor({ timeout: 15000 });

  const input = page.locator("#typed");
  const submitBtn = page.getByRole("button", { name: "Bhejiye" });

  // 1. Create a confirmed mixed order + udhaar entry
  await input.fill("Gupta store ko 5 kg chawal bhej do aur unka 200 udhaar tha");
  await submitBtn.click();

  const guptaCard = page.locator("article", { hasText: "Gupta Store" }).first();
  await guptaCard.waitFor({ timeout: 15000 });
  await guptaCard.getByRole("button", { name: "Confirm & save" }).click();
  await guptaCard.getByText("Confirmed").waitFor({ timeout: 10000 });

  // 2. Create a draft entry with an inline Hinglish clarification question
  await input.fill("chawal bhej do");
  await submitBtn.click();

  const draftCard = page.locator("article", { hasText: "Ye entry pakki nahi hai" }).first();
  await draftCard.waitFor({ timeout: 15000 });
  await draftCard.getByRole("button", { name: "Clarify kijiye" }).waitFor({ timeout: 10000 });

  // Clean up input, focus, and scroll before capturing
  await input.fill("");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);

  await page.screenshot({ path: resolvedOut, fullPage: false });
  console.log(`Captured UI screenshot to ${resolvedOut}`);
} finally {
  await browser.close();
}
