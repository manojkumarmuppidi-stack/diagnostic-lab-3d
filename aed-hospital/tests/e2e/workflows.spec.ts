import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, login } from "./helpers";

test("login, dashboard KPIs and drill-down to transactions", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Executive Dashboard" })).toBeVisible();
  await page.getByLabel("Period", { exact: true }).selectOption("this_month");
  await expect(page.getByText("Net Operating Result").first()).toBeVisible();
  await page.getByRole("link", { name: /^Laboratory: .* view transactions/ }).click();
  await expect(page).toHaveURL(/\/lab\?from=/);
  await expect(page.getByRole("heading", { name: "Laboratory & Diagnostics" })).toBeVisible();
});

test("quick-add an OPD consultation and find it in the list", async ({ page }) => {
  await login(page);
  const code = `E2E-${Date.now()}`;
  await page.getByRole("button", { name: "Quick add" }).click();
  await page.getByRole("button", { name: "+ OPD" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Patient ID").fill(code);
  await dialog.getByLabel("Patient Name").fill("E2E Demo Patient");
  await dialog.getByLabel("Specialty").selectOption({ label: "Obesity" });
  await dialog.getByRole("radio", { name: "New" }).click();
  await dialog.getByLabel("Amount").fill("750");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/OPD Consultation saved/)).toBeVisible();
  await page.goto(`/opd?q=${code}&from=&to=`);
  await expect(page.getByRole("cell", { name: code })).toBeVisible();
});

test("reports export to PDF and Excel", async ({ page }) => {
  await login(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Monthly Report" })).toBeVisible();
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Excel" }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
});

test("historical Excel/CSV import: map, validate, confirm, see it in reports", async ({ page }) => {
  await login(page);
  const amt = 1000 + Math.floor(Math.random() * 9000);
  const csv = `Dt,Pt Name,Test Name,Amt,Mode\n15/03/2025,E2E Hist,ECG,${amt},Cash\n,Total,,${amt},\n`;
  await page.goto("/import");
  await page.getByLabel("What does the file contain?").selectOption("lab");
  await page.locator('input[type="file"]').setInputFiles({ name: "hist.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(/Map columns/)).toBeVisible();
  await expect(page.getByLabel("Column for Investigation")).toHaveValue("Test Name");
  await page.getByRole("button", { name: /Validate 2 rows/ }).click();
  await expect(page.getByText(/records found/)).toBeVisible();
  await expect(page.getByText("Looks like a totals row")).toBeVisible();
  await page.getByRole("button", { name: /Import 1 rows/ }).click();
  await page.getByRole("button", { name: "Import now" }).click();
  await expect(page.getByText(/Import complete — 1 records/)).toBeVisible();
  await page.goto("/lab?from=2025-03-15&to=2025-03-15");
  await expect(page.getByText("E2E Hist").first()).toBeVisible();
});

test("daily accounts show the statement and closing workflow", async ({ page }) => {
  await login(page);
  await page.goto("/daily-accounts");
  await expect(page.getByRole("cell", { name: "TOTAL INCOME" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "NET OPERATING RESULT" })).toBeVisible();
  await expect(page.getByText("Payment modes & reconciliation")).toBeVisible();
});

test("role-based access: reception cannot see or open expenses", async ({ page }) => {
  await login(page, "reception", DEMO_PASSWORD);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Expenses", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "OPD", exact: true })).toHaveCount(1);
  await page.goto("/expenses");
  await expect(page.getByText("You do not have access to this page")).toBeVisible();
  const res = await page.request.get("/api/tx/expense");
  expect(res.status()).toBe(403);
});

test("audit log records activity", async ({ page }) => {
  await login(page);
  await page.goto("/audit");
  await expect(page.getByRole("cell", { name: "LOGIN" }).first()).toBeVisible();
});

test("board meeting pack: slides, present mode and keyboard navigation", async ({ page }) => {
  await login(page);
  await page.goto("/meeting");
  await expect(page.getByRole("heading", { name: "What changed this period" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revenue mix and movement" })).toBeVisible();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.locator(".cover-title")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "What changed this period" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
});
