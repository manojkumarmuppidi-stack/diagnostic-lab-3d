import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("mobile: bottom navigation, quick add sheet and stacked cards", async ({ page }) => {
  await login(page);
  const nav = page.getByRole("navigation", { name: "Quick navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "Quick add" }).click();
  await expect(page.getByRole("button", { name: "+ Expense" })).toBeVisible();
  await page.getByRole("button", { name: "+ Expense" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Take photo")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  // No horizontal page scroll on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
