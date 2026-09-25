import { expect, type Page } from "@playwright/test";

export const ADMIN = { username: "admin", password: process.env.E2E_ADMIN_PASSWORD || "Admin#12345" };
export const DEMO_PASSWORD = "Demo#12345";

export async function login(page: Page, username = ADMIN.username, password = ADMIN.password) {
  await page.goto("/login");
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
