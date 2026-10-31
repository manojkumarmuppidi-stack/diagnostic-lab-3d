# Changelog

All notable changes to the AED Hospital Financial, Accounting & Operational Analytics System.

## 0.26.0: Bank statement check
- Expense heads (migration `20261108000000_donations_head`, only when missing): Donations; Equipment (capital) → Vehicles; Salaries & Wages → Partner remuneration.
- Entries made from a bank line are tied to that line (its bill number), so two payments of the same amount never claim each other's entry; the reviewed list finds amounts with paise reliably, gives each of two identical payments its own line, and names any row it cannot find.
- Restore: re-enters lab payments from the bank that the duplicate check removed as "probable", from a chosen month on (picked by the reason saved on each removed entry, re-checked so none is entered twice); exact duplicates stay removed.
- "Lab entries from the bank — duplicate check": each lab payment entered from the bank is compared with the lab bills already in the core accounts (same supplier by the Laboratory rules, or any lab bill, up to 60 days before); when some bills add up exactly to the payment it is a duplicate, and "Remove" voids those entries (audited; optionally the probable ones too). Genuinely missing payments are kept.
- "Upload reviewed list": the bank payments sheet after review ("Enter as expense?" Yes, Expense head, optional Sub-head, Department, Description) — each Yes row is found by date, amount and narration and entered through the same re-check, so payments already in the core accounts are skipped; uploading it again enters nothing.
- "Enter as expenses" on a payee with payments not found in the core accounts: choose the expense head (and sub-head, department) and each payment becomes one expense on the bank's date, paid by UPI or bank, with the payee as vendor. Each is checked again first, so a payment that already matches an expense is skipped and nothing is entered twice; closed days need the Admin's "allow closed days" (their totals are refreshed).
- New page "Bank statement check" (Accounts): upload the bank's statements (SBI Account Statement .xls, several months at once; the running balance is checked line by line and the same line is never stored twice — a reversed-and-retried UPI payment is kept). Account numbers are kept as the last 4 digits only. Each line is classified (UPI/card settlements, UPI, cheques, NEFT/RTGS, rent, electricity, TDS/ESIC/PF, debit card, auto-debits, cash, transfers between AED's own accounts) with the payee read from the narration.
- Money in: UPI/card settlements that reached the bank against the UPI/card collections recorded (AED and pharmacy), month by month. Money out: each payment matched to an expense or pharmacy purchase of the same amount (dated 45 days before to 5 days after); failed UPI payments and their reversals cancel out; own transfers and cash withdrawals are shown apart. Payments not found in the core accounts are listed by payee, and everything downloads as Excel. Nothing is booked from the bank. Migration `20261107000000_bank_lines`.

## 0.25.0: Hormonal Pharmacy in department accounts
- New department "Hormonal Pharmacy" (migration `20261106000000_pharmacy_department`): income = medicine sales after discount and returns, costs = supplier purchases — both read from the core accounts, as the AED vs Pharmacy P&L measures it — plus the pharmacists' salaries entered for it, less the margin on medicines other departments already take (JJ Wellness's GLP injections), so nothing is counted twice. AED income totals are unchanged.

## 0.24.0: Mark IPD admissions fully paid in one go
- "Hospital expenses mentioning …" now ignores spaces and punctuation ("SN", "S N" and "S.N. Diagnostics" all match), and can take a share of those expenses ("% of those expenses", blank = all) — e.g. lab reagent suppliers booked to the Laboratory from the core expenses.
- IPD → Outstanding: filter by admission dates (this month by default), tick the patients who have paid in full, choose how they paid and when (each patient's discharge date — admission date if not discharged — or one date for all), and "Mark selected as fully paid". Each gets a final settlement for exactly its balance, recorded like any payment: IPD income in the month received, closed days refused, audited, and voidable from Payments & refunds. Reception and Accounts can do it.

## 0.23.0: Department accounts take their inputs from the core accounts
- Department Excel imports show "Uploading…" and a result box that stays until closed (each department and how many costs it got, or why nothing was saved), instead of a message that disappeared after a few seconds.
- The Admin can upload the all-departments workbook from any department's "Import from Excel": each tab goes to the department it names (before, tabs for other departments were refused and nothing was saved). Department heads still upload only their own tab.
- Print / download a department's account: "Print / download" on each statement opens an A4-landscape page (income lines, costs — one row per cost —, profit, margin and the JJ partner's share, month by month) to print or save as PDF, and "Download Excel" gives the same as a workbook. "Print / download all departments" does every department, one page each, with a summary tab in Excel. Heads get only their own department.
- First-floor cost pool (Department accounts → All departments, Admin): tick the core expense categories the first floor shares (rent, electricity, maintenance…) and its %; each department's space cost is its occupancy % of that pool, month by month. A preview shows the pool each choice gives and the % that matches the earlier ₹1,51,607.10. Until it is set, the fixed figure is used. New cost kind "occupancy % of the first-floor pool". Migration `20261105000000_first_floor_pool` turns the first-floor space rows into their occupancy % (amounts unchanged until the pool is set).
- Payroll uploads are checked against the salaries booked in the core accounts for the same month (main categories named "Salar…"). If the file total differs by more than 0.5%, or nothing is booked yet, nothing is saved and the Admin is asked to confirm; the result shows each month's check.

## 0.22.0: Payroll → department salaries, expenses by name, long admissions
- Department monthly sheets: a row of typed 0s removes that cost for the sheet's months (blank cells still mean "not filled in"), so a cost booked by mistake can be taken out by uploading again.
- Excel Import (bills & expenses) refuses department accounts files — salary sheets, expenditure sheets, the staff list — and points to Department accounts → "Import costs for all departments"; before, their tabs were read as OPD/Diet/Lab bills with every row invalid.
- Staff → department list (Department accounts → All departments, Admin): import a sheet with Staff · Also written as · Department · % to that department · Second department. Anyone marked Hospital-wide / Others is not charged. Remove a person to stop charging them.
- Bank payroll files (NAME · AMOUNT · BANK · IFSC CODE · ACCOUNT NO) can be imported on Department accounts: the month comes from the file name ("November 2026 Salaries.xlsx") or the title above the table. Each mapped person's pay becomes "Salary — <name>" in their department(s) for that month; a corrected file for the same month replaces it. The toast lists who was not charged to any department. Payroll and the staff list are Admin-only. Department accounts only; the hospital's books do not change.
- New cost kind "Hospital expenses mentioning …" (e.g. Dr. Geetha Priya): every active hospital expense whose description or vendor contains the name (spellings separated by commas) is counted in that department, month by month. Also importable from a list sheet with an "Expenses containing" column (no amount column needed).
- Correction (migration `20261104010000_ipd_monthly_totals_long`): the Jan–Sep 2026 IPD monthly totals were long admissions; each is superseded and re-created under "Long Admission" with its payments, and audited. Amounts do not change; Long admissions in department accounts now shows those months.

## 0.21.1: Diet follow-ups and billed names
- Correction (migration `20261103010000_plus_named_consultations`): imported bills named with "+" (consultation + ₹200 wellness share) that were filed under the same name without "+" are corrected like a manual correction — the record is superseded and a copy under the right consultation type points back to it, with an audit entry. The original name comes from the import record; amounts do not change.
- OneGlance OP bill collection exported with "Bill Details: Particulars": the billed item (Particulars) is now the consultation name, specialty and New/Old, and decides Diet ("Diet Follow up") and SCP ("Sugar Control Plan"); Visit Purpose is used only when Particulars is empty.
- Without Particulars, a Visit Purpose naming the dietitian ("f/u by deepika", "deppika") is a diet follow-up, and misspelt SCP staff names ("spadana", "spanadana", "sapadana", "sheebha", "baghya") are SCP.
- Billed names that differ only by "+" stay different ("Old Thyroid & Diabetes+ Consultation" includes the ₹200 wellness share); they were matched to the name without "+".
- A diet bill whose OPD bill number is already in the app under OPD (or the reverse) is flagged as a duplicate.
- Correction (migration `20261103000000_diet_followups_from_opd`): diet follow-ups imported as OPD consultations are moved to Diet & Nutrition (the consultation is voided with the reason, both logged); consultation types with misspelt SCP names are marked SCP. Totals do not change, only the stream.

## 0.21.0: Department monthly expenditure sheets
- "Download blank sheet" on a department's statement (Admin and its head) and "Download sheet for all departments" (Admin): the expenditure sheet for the months selected on the page, ready to share with department heads and to import back.
- One shared workbook with a tab per department: a head can upload it from their statement with only their tab filled; other departments' blank tabs are skipped. Formulas a file was saved with but never calculated (e.g. Total rows of a generated sheet) count as blank.
- Department Excel import reads the monthly expenditure sheet: Category (Salaries, Maintenance & repair, Consumables, Groceries, Equipment, Other) · Name / item · one column per month, with "Department: …" above the table. Consecutive months with the same amount become one cost line; uploading a corrected sheet replaces that cost for the months it covers instead of adding it twice.
- Department heads can import their own department's costs (their statement's Import from Excel); they cannot overwrite what the Admin entered. Cost groups include Groceries.

## 0.20.0: Department insights and graphs
- "Import costs for all departments" (All departments): one sheet with Department · Type · What is it · Amount per month · From month · Until month books every department's salaries, repairs, consumables and other costs; Type is put in front of the name ("Salary — …") so costs group by kind. Cost groups now include Equipment, repairs & maintenance and Consumables & supplies.
- Department accounts: costs grouped into Salaries, Incentives, Space/rent/utilities and Other (tap to see and edit each item), like income.
- Insights and graphs in dropdowns for the selected department (findings, income vs costs, profit and margin trend, income by source and costs by kind, partner share vs AED) and for all departments (findings, profit by department, income vs costs by department). Tables and graphs fold away so the page stays short.

## 0.19.1: Incentives as a % of a department's income
- New role "Department head" with no other access: together with "Department head of" in Staff logins, the login sees only that department in Department accounts and lands there after sign-in.
- Department Excel import: the "% of department income" column is recognised (the % sign was dropped when matching headers).
- "Add cost" (and the Excel import, column "% of department income") can charge a % of the department's own billed income each month — packages, tests and consultations, not the injection margin — for incentives such as 3% each to three people.
- JJ Wellness: the automatic 1% on injection sales is switched off; the incentives entered each month already include it (migration `20261102010000_jj_injection_incentive_off`). It can be switched back on in Master Data → Income departments.

## 0.19.0: Incentives on income generated
- Department statement: "Import from Excel" (Admin) books salaries and other monthly costs (What is it · Amount per month · From month · Until month) and people with their incentive % and monthly income generated (Person · Incentive % · one column per month) in one upload; uploading again updates the same rows.
- Department statement: "People bringing income" — the Admin adds each person (or pair) with their incentive %, and records the income they generated each month. Their incentive (% × income generated) appears under the department's costs; the income generated is not added to the department's income, which comes from the bills. Heads see it; only the Admin changes it (migration `20261102000000_department_contributors`).

## 0.18.0: Department heads and day-by-day view
- Department statement: income lines are grouped by source (injections, tests, wellness share of combined bills, packages …; tap to expand), so the costs and profit are on the first screen; the card title shows income, costs and profit for the period.
- The USG & 2D Echo room is shared 80% USG scan room / 20% Cardiac (2D Echo). Reception & Administration and the Lobby serve the whole hospital and are no longer departments; profit is before those common costs (migration `20261101020000_room_split_common_areas`).
- Staff logins: an Admin can make any login the head of a department ("Department head of"). A head sees Department accounts for their own department only (no hospital-wide figures), adds its costs such as maintenance, and changes or removes the costs they added. Admins change any cost (migration `20261101010000_department_heads`).
- Department accounts: View "Day by day (one month)" (monthly costs spread evenly over the days of their month), and a "This year" shortcut for the year view.

## 0.17.1: First-floor space costs
- The first-floor expense pool (₹1,51,607.10 a month) is charged to departments by floor area from January 2026: Laboratory 15%, Reception & Administration 7%, Lobby 20%, Consultation chambers 25%, USG & 2D Echo room 5% (USG scan room), Ophthalmology 7%, ECG & TMT room 3% (Cardiac), JJ Wellness 6%, Dietetics 5% (Diet), Physiotherapy 5% (Foot exam, neuropathy & physiotherapy); 2% unallocated.
- New departments: Laboratory (lab tests no other department claims), Consultation chambers (consultations no other department claims), and the cost centres Reception & Administration and Lobby (migration `20261101000000_first_floor_allocation`).

## 0.17.0: Department statements
- Department accounts are an analysis on their own and never change the hospital's income or expenditure. Each department opens as a statement: income from every source (billed items, the ₹200 wellness share, packages, injection margin), then its costs, then profit, month by month, with Profit / Loss.
- A department's costs are only what the Admin allocates with "Add cost": a fixed ₹ per month (a staff salary, rent for its floor area) or a % of the hospital's spending in an expense category that month (10% of the power bill), from a month and optionally until a month; plus the incentive on its injections. Expenses are no longer swept in by expense department (migration `20261031020000_department_costs`).
- "Income patient by patient" lists everyone who paid the department and for what. "All departments at a glance" compares income, costs and profit.

## 0.16.0: Department profit
- JJ Wellness is one department (skin, hair, BMI, ₹200 wellness share, MMP packages and admissions, GLP injections, Wellness expenses, 20% share) (migration `20261031010000_jj_wellness_one_department`).
- Long admissions are their own department, next to Short admissions (migration `20261031000000_long_admissions`).
- Department accounts open with "Is each department making money?": billed income + margin on the department's pharmacy medicines (without GST, after purchase cost) − expenses booked to its expense department − staff incentive, with Profit / Loss per department and month. Expenses of departments no income department claims are shown as shared costs.
- JJ Wellness: GLP injections (Mounjaro, Yurpeak, Glipiq, Sema… brands, Sundae, Ozempic, Wegovy, Ozanta, Wyntide, Obeda, Extensior, Povizitra) from the Hormonal Pharmacy's medicine-wise sales count as its margin, with the 1% staff incentive on their sales as its cost; "Wellness" expenses are its costs; JJ Wellness's 20% share is worked out on the combined profit of its two departments, per month, on months in profit. All configurable in Master Data → Income departments (migration `20261030000000_department_profit`).

## 0.15.0: JJ Wellness
- Department accounts: combined OneGlance bills such as "New Thyroid + Wellness Consultation" or "Old Diabetes + Consultation" give JJ Wellness ₹200 per bill; the rest stays with the consultation. The stand-alone "Wellness Consultation" is JJ Wellness. Configurable in Master Data → Income departments (migration `20261029000000_department_addons`).
- Excel Import recognises the JJ Wellness workbook (Package_Payments tab) and imports MMP/GLP package payments as Other income "JJ Wellness MMP package", counted under JJ Wellness — MMP admissions. Dates that Excel flipped month-first are read day-first. The other tabs are not imported: consultations and BMI are OneGlance bills, and injections are Hormonal Pharmacy bills. Uploading the workbook again adds only new payments.
- Optional nightly sync of that workbook from Google Drive through a service account (VERCEL.md), with the result or error in the Admin's bell.

## 0.14.0: Department accounts
- New **Department accounts** page: AED income (pharmacy excluded) per department and month, with the billed services behind each department, bills/tests counts, share of AED income and a "Not in any department" list.
- Nine default departments (USG scan room; Foot exam, neuropathy & physiotherapy; Cardiac; JJ Wellness skin/hair/BMI; Ophthalmology; Diet; SCP; Short admissions; JJ Wellness MMP admissions), matched by keywords in the billed service name. Editable in Master Data → Income departments (migration `20261028000000_service_departments`).

## 0.13.5: Daily pharmacy upload reminder
- Pharmacy staff get a bell reminder (and phone notification, if allowed) once a day while pharmacy sales are more than 2 days behind, naming the dates to export from OneGlance.

&
- Reception and Reception + expenses may view, enter and import IPD admissions and payments (migration `20261010000000_reception_ipd`).

&
- Reception and Reception + expenses may view, enter and import Hormonal Pharmacy records (migration `20261007000000_reception_pharmacy`). Pharmacy logins already could.

&
- The Laboratory test-by-test slides list every test performed in either period (not only the top 16), with tests and amount for both periods, the change, and totals; as many slides as needed (18 tests each).

&
- `ADMIN_RESET_PASSWORD` (Vercel environment variable + redeploy) resets the `admin` login once, forces a new password at sign-in and is logged. See VERCEL.md.

## 0.13.0: SCP as its own income
- SCP (Sugar Control Plans and short admissions) is a separate AED income line everywhere: Dashboard, Daily Accounts, AED vs Pharmacy P&L, Analytics, reports and PDFs. SCP bills come from the OneGlance OPD report; the billing name ("Sugar Control Plan", "f/u by bhagya" …) is kept and flagged SCP, so every past month moves automatically (migration `20261006000000_scp_income_stream`).
- SCP bills are not consultations: consultation counts, OPD analytics and averages leave them out; patients still count.
- Analytics → Revenue: SCP by billing name, month by month. Master Data → Consultation Types: SCP tick per billing name.

## 0.12.6: OneGlance drug-wise Purchase/Sales summary
- The drug-wise summary version of the OneGlance Purchase/Sales Report (Drug Name, Total Qty, Sales Value, Taxable Value, Purchase Value, Profit — no bill numbers or dates) is recognised. The period is read from the report heading ("Period: … To: …"); one calendar month per file; lines are dated on the last day; cost is taken ex-GST so the margin matches OneGlance's profit.
- A disabled Admin can be given another role.

## 0.12.5: Analytics PDF; AED-only income trend
- Analytics: Download PDF / Share for the open tab (Revenue → Income vs Expense report, OPD, IPD, Lab, Hormonal Pharmacy, Expenses, Profitability), for the selected period.
- Fix: the income trend (Dashboard trend, Analytics Revenue and Profitability, daily summary, report trend tables) no longer adds Hormonal Pharmacy sales into AED income and net result.
- Report definitions updated to the AED-only totals.

## 0.12.4: Shareable P&L PDF
- AED vs Pharmacy P&L: Download PDF (and Share on phones) — both entities, month by month, costs and insights.
- Insights no longer treat a month still in progress as the weakest month.
- Report PDFs no longer end with a blank page.

## 0.12.3: Dashboard explains spread expenses; doctor fees per visit
- Dashboard shows the expenses entered in the period next to Total Expenses when monthly items (salaries, rent…) are counted as a daily share.
- "Doctor fees" is a per-visit head: picking it no longer spreads the fee over the month; such October entries are put back on their day (migration `20261005020000_doctor_fees_per_visit`).

## 0.12.2: Reception bills and imports lab
- Reception roles may view, enter and import laboratory transactions (migration `20261005010000_reception_lab`).

## 0.12.1: Reception and pharmacy can import their own reports
- Import is limited to the modules a role may enter by hand: Reception → OPD and Diet; Pharmacy → pharmacy sales, returns, purchases, medicine lines and supplier payments. Importing expenses needs approval rights (imported expenses count at once). The type list on Excel Import shows only what the person may import.
- Staff who cannot see the accounts see only the import files they uploaded (history, rows, error sheet).
- Reception, Reception + expenses and Pharmacy roles get "import.run" (migration `20261005000000_import_for_reception_pharmacy`).
- Daily Accounts: tap an entry under a figure to correct or void it.
- Pop-up forms no longer lose the cursor after each key press; the staff-login form is no longer autofilled with the admin's own email and password.

## 0.12.0: Team logins, routine expenses, notifications; tap-to-see entries
- **Daily Accounts:** tap any figure (IPD, Lab, Hospital expenses, …) to list the entries behind it on that day, with mode and reference; spread monthly items show as the day's share of the month.
- **New roles** (created on the next deploy): *Accounts head* (everything Accounts does, plus approving staff expenses) and *Reception + expenses* (reception work plus entering expenses, which wait for approval). Admin / CEO creates logins and sets first passwords under Users & Permissions; each person must change the password at first sign-in.
- **Expense privacy:** new permission `expense.view_all`. Without it a person sees only the expenses they entered (no salaries, totals, month-wise or checklist). Every role that could see expenses before keeps seeing all of them (migration `20261004000000_expense_view_all_and_heads`).
- **Routine expenses:** new heads found in the Jan–Sep 2026 books (visiting doctors by specialty, vegetables, provisions, consumables, glucose strips, medicines, Sunday duty, transport, refunds, uniforms, utensils, foot care, miscellaneous). Imported and older expenses are linked to their head automatically, so the monthly checklist and "last month" know them. The quick pick lists the monthly routine heads before anything is typed; one letter narrows them. Day-to-day heads fill the description without a month.
- **Notifications:** a bell in the top bar with what needs attention: expenses waiting for approval, your rejected entries, monthly bills not booked by the 5th, accounts not updated, days to reconcile and close. New items pop up in the app and, once allowed on the device, as phone/desktop notifications while the app is open.

## 0.11.0: AED Hospital and Hormonal Pharmacy fully separated
- Every hospital total is now **AED Hospital only**: Total Income = OPD + IPD + Lab + Diet + Other; Total Expenses = hospital + other expenses; Net Result = the difference. This applies to the Dashboard, Daily Accounts, the daily PDF, Analytics, Reports, insights and the Board Meeting pack.
- Hormonal Pharmacy sales, stock purchases and **expenses booked to department "Pharmacy"** (pharmacy staff) are reported only in the pharmacy's own places: Daily Accounts' separate "Hormonal Pharmacy — separate entity" card, Hormonal Pharmacy → accounts, Analytics → Hormonal Pharmacy and the AED vs Pharmacy P&L.
- Daily reconciliation covers AED collections and payments only; the pharmacy counter's collections by mode are shown separately.
- Closing drift on days closed before this change re-totals the stored snapshot the AED way, so no false "changed since closing" warnings.
- Daily Accounts shows how much of the day's expenses is its share of spread monthly expenses.
- Migration `20261003010000_pharmacy_department_costs`.

## 0.10.2: Historical backfill into closed days; import all sheets at once
- Admin option on Excel Import, **Import into closed days (historical backfill)**: rows on closed days become warnings instead of errors and are imported; each closed day stays closed, its closing totals are refreshed, and a BACKFILL entry is written to the day's history and the audit log.
- Closing drift ("changed since closing") ignores the day's share of spread monthly expenses.
- "Check all / Import all" now works for any multi-sheet file whose columns all match (e.g. one sheet per month), not only OneGlance reports.
- The expense importer now reads the "Spread over month" column.

## 0.10.1: Monthly expenses spread over the month
- Expenses can be marked **Spread over the month** (form checkbox, ticked automatically for monthly heads such as rent and salaries; import column "Spread over month" = Yes). In every day-level figure (Daily Accounts, daily PDF, day trends, week ranges) such an expense is split evenly over the days of its month; month and year totals are unchanged.
- Spread expenses are left out of "expenses paid" by payment mode in daily reconciliation, since their real payment day is not known.
- Migration `20261003000000_expense_spread_month` adds the flag and marks the month-end lines already imported from the monthly register (`REG-…`, `HP-REM-…`, `HP-SAL-…`). On AED's data, 30 Sep fell from ₹29.46 L of expenses to ₹98,187 (every September day now carries its share).

## 0.10.0: AED Hospital and Hormonal Pharmacy as separate entities
- New page **AED vs Pharmacy P&L** (`/entities`): for any range of months, income, expenses, profit/loss and margin of each entity, month by month, with a chart, the biggest cost lines and plain-language insights.
  - **AED Hospital** = consultations (OPD), laboratory and IPD, plus diet and other hospital income; all hospital expenses.
  - **Hormonal Pharmacy** = pharmacy sales net of returns; stock purchases plus expenses tagged to the Pharmacy department.
- A month with expenses but no income is marked "income not recorded" and left out of the profit figure, so missing imports are not mistaken for losses.
- Dashboard "By entity" cards use the same calculation and link to the page.

## 0.9.5: "Accounts not up to date" warning
- For OPD, Laboratory, Hormonal Pharmacy sales, Expenses, pharmacy purchases, IPD collections and Diet, the app finds the last date with entries. When it is older than allowed (2 days for OPD/lab/pharmacy, 3 for expenses, 7 for purchases/IPD/diet), a warning banner lists it with the number of missing days and a link to fix it.
- Shown on the Dashboard, Analytics, Board Meeting, Hormonal Pharmacy and printed on the daily summary PDF. For a past period it checks up to the end of that period, so a complete February shows no warning.

## 0.9.4: Pick a month by name
- Every Period menu has a **Month** group: the last 18 months by name (October 2026, September 2026 … ). A month compares with the whole previous month (February vs January), and any range of whole months compares with the same number of months before.

## 0.9.3: OneGlance pharmacy bill collection (bill-wise)
- The bill-wise pharmacy collection export (Bill No, Bill Date, Patientid, Total/Bill/Paid Amount, Cash, Card, Cheque, Online, Phone Pay, G Pay…) is recognised: one Hormonal Pharmacy sale per bill (`PHB-<bill no>`) with its exact payment mode — PhonePe and GPay kept apart. Bills paid from an IPD deposit are reduced by that part (already IPD income); bills paid fully from deposit are skipped.
- A day already held as pharmacy daily totals is not imported again as bills (and the reverse): those rows are flagged as duplicates.

## 0.9.2: OneGlance OP bill collection export; exact payment modes
- A second OneGlance OPD export (BillNo, Bill Date, Visit Purpose, Cash / Online / Cheque / OneGlance Wallet) is recognised. It converts to OPD (and Diet) **with payment modes**: Online → UPI, Wallet → Other. A bill paid in two modes goes under the larger one, with the split in Remarks.
- That export has no consultation name. Specialty is General unless Visit Purpose names one. New/Old comes from the patient registration number: a bill whose patient ID is higher than every ID billed before it is a new registration.
- **Exact payment modes**: new modes **GPay** and **PhonePe** (both reconcile under UPI), alongside Cash, Card, UPI, Bank Transfer and Cheque. Imports record "cheque", "Google Pay" and "Phone Pe" as Cheque / GPay / PhonePe instead of the generic Bank / UPI.
- Expenses → Month-wise has a **by payment mode** view.
- Import duplicate check: a OneGlance OPD/diet bill already in the app (same `OP-<bill no>` on the same date) is flagged as a duplicate, even when the two exports disagree on specialty.

## 0.9.1: Cash book repeats are kept
- Cash-book lines without a cheque number get the cash-book row as their reference (`CB-412`). Genuine repeats on one day (three ₹10,000 payments to one doctor, several ₹1,000 per-case charges) are no longer dropped as duplicates; re-uploading the same cash book is still caught.

## 0.9.0: Hormonal Pharmacy as its own segment
- The pharmacy is now **Hormonal Pharmacy** everywhere (income stream, purchases, Analytics tab, reports, navigation).
- New page **Hormonal Pharmacy → accounts** (`/hormonal-pharmacy`), built for phones:
  - For any month: net sales, purchases, **profit = Sale − Purchase** and **profit %** (of net sales), compared with last month. For the current month the comparison is against the same days of last month.
  - Month by month for 12 months (chart + table with a 12-month total) and day by day with a running month-so-far profit and profit %.
  - Where medicine lines are imported, the **margin on medicines actually sold** (ex-GST) is shown beside it, with a note when stock build-up or sell-down makes Sale − Purchase misleading.
- Dashboard **By segment**: Hospital (without Hormonal Pharmacy) income, expenses, net; Hormonal Pharmacy net sales, purchases, profit and %. The consolidated Financial result is unchanged and equals the two added together.
- Cash book: staff token payments (salary top-ups, performance bonus) go to Salaries & Wages → **Incentives & bonus**; new head "Staff incentives & bonus".

## 0.8.0: Expense heads, approval and month-wise expenses
- **Expense heads** (Masters → Expense heads): recurring items such as rent, electricity, salaries, ESI/PF, TDS, milk, gas, oxygen and water cans. Each head has keywords, category/subcategory, payee, default payment mode, an optional typical amount and a "monthly" flag. The seed adds 36 generic heads with no amounts or names; the Admin fills those in.
- **One-word quick pick** in the expense form. Typing "rent", "milk" or "esi" shows the matching heads. Picking one fills the category, payee, description ("Milk – Sep 2026"), typical amount and payment mode.
- **Payment mode suggestion** from the amount: below ₹3,000 Cash, above ₹1,00,000 Bank Transfer, otherwise Card. The suggestion stops once staff pick a mode themselves.
- **Admin approval.** Expenses entered by staff (anyone without the new permission `expense.approve`) wait in Expenses → Waiting approval and are not counted until approved.
  - Approve counts the expense. Reject voids it with the reason.
  - Both are audited, and the dashboard shows an alert to approvers.
  - A day with waiting expenses cannot be closed.
  - The database guard allows only PENDING → ACTIVE/VOIDED.
- **Monthly checklist**: for any month, every recurring head marked as entered, waiting approval or not entered, with last month's amount and an Add button.
- **Month-wise** view: approved expenses by category, subcategory or head × month (pharmacy purchases as their own line), with CSV download.
- **Cash book import**: a cash book with Date/Description/Debit/Credit/Balance columns is recognised.
  - Debit lines become expenses, split by month, with the category taken from the description.
  - Dates that Excel had read month-first are corrected from the neighbouring rows.
  - The payment mode is estimated from the amount.
  - Verified on AED's Jan–Aug 2026 cash book: 1,452 payments, ₹35.36 L, 82 dates corrected.
- **Wellness programme costs**: new department "Wellness" and two monthly heads tagged to it, "Wellness – revenue share" (JJ Wellness, paid a share of wellness-patient revenue under an MOU) and "Wellness – staff salaries". Analytics → Expenses → by department shows them together.
- **No double counting of pharmacy stock**: cash-book payments to a pharmacy supplier whose invoices come from OneGlance (Vijaya Pharma — surgicals, mostly IPD) import as supplier payments, not expenses (₹29,761 in the Jan–Aug cash book).
- New categories: MOU partners (with subcategory Revenue share), Doctor & consultant fees, Referral fees, Outsourced lab tests, Taxes & compliance, Staff welfare, Equipment (capital), Patient refunds. New subcategories: OT technicians, Security, Uniforms, Bio-medical waste.

## 0.7.0: One-page daily summary PDF
- New **Daily summary** page (`/daily-summary?date=…`), opened from the Dashboard button **Day summary PDF**. It is one A4 portrait page on white paper, whatever the screen theme. It shows:
  - total income vs the same weekday last week, vs yesterday, and vs a typical weekday (average of the last four with activity)
  - patients, consultations (New/Old), lab tests, pharmacy bills and margin, admissions, expenses and net
  - income by stream vs last week, collections by payment mode, the last 14 days, stream split, top tests and top medicines
  - up to 6 plain-language insights
- It has previous/next day and a date picker. `?print=1` opens the print dialog automatically (choose "Save as PDF").
- Board Meeting PDF fix: with real data, slides spilled onto a second page (24 pages for 15 slides) and printed in the narrow layout. Now each slide is exactly one landscape page: tall slides are zoomed to fit and the wide layout is pinned in print. The daily sheet uses a named portrait page, and the deck's dark print background is scoped to the deck.

## 0.6.1: Fix Analytics crash when switching tabs
- Switching from one Analytics tab to another rendered the new tab with the previous tab's data for a moment and crashed ("Application error: a client-side exception"). The API now tags each response with its `kind`, and the page only renders data for the tab that is open.
- New E2E test switches every tab on every tabbed page and fails on any client-side exception.

## 0.6.0: Supplier payments, open invoices and product search
- New `SupplierPayment` table (migration `20261001010000_supplier_payments`, DB-guarded). Payments are **not** expenses, because the purchase invoices already are.
- The OneGlance **Pharmacy Invoice Report** is recognised. The cheque/UTR and the invoice numbers are read from "Details", tolerating typos like "INVOICDE NO".
- Analytics → Pharmacy → **Suppliers — purchased vs paid**. Per supplier it shows invoices, purchased, paid, open invoices and value, oldest open invoice, last payment, and the average days from invoice to payment. An invoice is "paid" when a payment to that supplier lists its number.
- Global search finds **medicines** (units sold in the last 30 days → opens the medicine's units per week/month) and **test counts** (opens the test's week/month counts). Analytics accepts `?medicine=` and `?investigationId=` deep links.
- The analytics-only import path is generalised (medicine lines, supplier payments share validation, duplicate detection, commit and reversal).
- Verified on AED data: 126 payments (₹71.75 L) settle 403 invoices, mostly from before April. The average credit taken is 56 days.

## 0.5.0: Medicine-wise pharmacy analytics
- New `PharmacyItem` / `PharmacyItemLine` tables (migration `20261001000000_pharmacy_items`) with the same DB guards (no deletes, immutable values, final reversal). Medicine lines are analytics only: pharmacy income stays collections and purchase expense stays invoices, so nothing is counted twice.
- The OneGlance **Purchase/Sales Report** is recognised in both views. **Sales view** becomes medicine lines: units, bill, value incl. GST, taxable value and cost. **Purchase view** becomes one pharmacy purchase (expense) per supplier invoice, plus medicine purchase lines (supplier, manufacturer, batch, expiry, free units). New import type "Pharmacy medicine lines" with its own template for other sources.
- Analytics → Pharmacy:
  - Real bill count and average bill value.
  - Margin on medicines sold (sale value − cost, ex-GST).
  - A searchable medicine table with units, previous period, bills, value and margin.
  - Search such as "janumet" totals all strengths and shows units per day/week/month.
  - Top medicines and purchases by supplier.
- Board Meeting: the pharmacy section uses real bills and margin, plus slides for top medicines by sales value and by units.
- Verified on AED's Apr–Sep 2026 export: 49,239 lines in 14,681 bills. Monthly totals match the Pharmacy Collection Report's billed amount (e.g. Jun ₹46,80,663 vs ₹46,80,669).

## 0.4.1: Test-wise lab counts
- Analytics → Laboratory → **Test-wise counts**: every test performed in the period with this period vs previous, change, revenue and average. It has a search box ("ECG") and sort by volume, revenue, biggest change or least performed. Tests done last period but not this one are listed with 0.
- Click a test to see it day by day, week by week or month by month (follows "Group by"). The panel shows total, revenue, average per week and the busiest week, and links to the transactions.
- Board Meeting: new slide "Laboratory — tests performed, test by test". It shows the top 16 tests with this period, previous, change and per-week average.

## 0.4.0: OneGlance HMS import
- The importer recognises OneGlance exports (Outpatient Collection, Bill Item Wise Collection, Pharmacy Collection) and converts them to OPD/Diet, Lab and Pharmacy records, split by month. Lab Bill Collection is refused with guidance. See EXCEL_IMPORT_SPEC.md §8a.
- "Check all months → Import all months" panel for recognised reports.
- Browser gzips uploads over 1 MB, so large HMS exports fit Vercel's request limit (40 MB uncompressed max).
- Fix: new master names longer than about 20 characters were rejected during import validation.
- Fix: fuzzy matching no longer matches across meaning-changing words or numbers ("New" ↔ "Old", "T3" ↔ "T4").
- Import results count only master entries actually created.
- Verified on AED's Apr–Sep 2026 exports: OPD, lab and pharmacy monthly totals match OneGlance to the rupee.

## 0.3.1: Zero-terminal Vercel setup
- `vercel-build` applies migrations and the idempotent base seed before `next build`, so importing the repo on Vercel sets up a fresh Neon database without a terminal.
- The build fails fast when `DIRECT_URL` is missing, `DIRECT_URL` is a pooler URL, or demo data is enabled on production.

## [0.3.0] — 2026-09-25 — Vercel deployment
### Added
- **Private Vercel Blob storage** for bill attachments (automatic when `BLOB_READ_WRITE_TOKEN` is set); files are only streamed to signed-in users. Refuses to write to Vercel's ephemeral disk rather than silently losing bills.
- Browser-side photo compression (≤ 2000 px JPEG) before upload; upload limit 4 MB on Vercel.
- `DIRECT_URL` for migrations so the app can use Neon's pooled connection (`pgbouncer=true`) on serverless.
- VERCEL.md step-by-step guide; `check:deploy` validates pooled/direct URLs and Blob connectivity (`--vercel`).
### Changed
- Import commit is batched (cached lookups within the operation, one INSERT per 500 rows, bulk staging-row rewrite): 5,000 rows 38 s → ~4 s, largely independent of database latency.
- 60 s function time limit declared on import, report, export and board-pack routes; pdfkit font files bundled for serverless.

## [0.2.1] — 2026-09-25 — Deployment readiness
### Added
- `npm run check:deploy`: read-only readiness check of env vars, database version/latency, migrations, accounting views, guard triggers, role ownership, seed state, master rates and demo data (PASS/WARN/FAIL, exit code 1 on FAIL).
- `/api/health` probe, production `Dockerfile` + `.dockerignore`, `engines` (Node ≥ 20.9).
- DEPLOYMENT.md: step-by-step for your own PostgreSQL (direct vs pooled URLs, SSL, restricted app role).
### Verified
- Fresh clone → `npm ci` → migrate → seed → build → run as a restricted role: all workflows succeed; the role cannot truncate, delete, edit amounts, disable triggers or drop views.

## [0.2.0] — 2026-09-25 — Insights & Board Meeting pack

### Added
- **Insight engine** (`src/lib/insights.ts`): plain-English findings from current-vs-previous figures — biggest riser/faller, concentration risk, mix shift, activity that stopped, KPI moves, costs growing faster than revenue, operating loss. Every insight shows the numbers behind it and links to the transactions.
- **Insights & comparison panels** on OPD, IPD, Laboratory, Pharmacy, Diet, Expenses, every Analytics tab and Daily Accounts (vs the same weekday last week): KPI deltas, comparison bars (current vs previous) and share pies with a table view for every chart.
- **Dashboard**: key-insights strip and comparison bars + pies for income by stream, expenditure and payment modes.
- **Board Meeting pack** (`/meeting`): 12-slide presentation — cover, executive summary, six-month trend, revenue mix (pies this vs last period), operations & collections, one slide per department, key findings with method notes. Full-screen slideshow (← → keys, Esc), prints one slide per A4-landscape page (Save as PDF).
- Month-to-date ranges compare with the same days of the previous month; compact period labels ("1–25 Sep 2026").
- 7 new unit/integration tests (117 total).

### Changed
- Removed the old per-module KPI strip (superseded by the comparison KPIs).
- Compact currency drops trailing zeros (₹60 L, not ₹60.00 L); chart legends use text colours; pie slices beyond the sixth fold into "Other" with a distinct neutral.
- Demo seed posts monthly bills even when the 5th falls on a Sunday.

## [0.1.0] — 2026-09-25

### Phase 1 — Project setup
- Next.js 15 (App Router) + TypeScript + Tailwind + PostgreSQL/Prisma project in `aed-hospital/`, alongside the existing 3D lab viewer (unchanged).
- Design documents: PROJECT_SPEC, ARCHITECTURE, DATABASE_SCHEMA, ACCOUNTING_RULES, EXCEL_IMPORT_SPEC, TESTING_PLAN, DEPLOYMENT, BACKUP_RECOVERY.
- Database-backed session authentication (bcrypt, hashed tokens, login throttling), base layout with sidebar, mobile bottom navigation, PWA manifest and service worker.

### Phase 2 — Master data & users
- Masters: departments, specialties, doctors/dieticians, consultation types, admission types, IPD packages, lab investigations, diet services, 2-level expense categories, payment modes. Deactivate-only (no deletes).
- Seven roles with a runtime-editable permission matrix, enforced server-side; patient-name masking.

### Phase 3 — Transactions
- OPD, IPD (admissions + advance/payment/settlement/refund), laboratory, pharmacy (sales/returns/purchases), diet, other income. Generic create / correct / void with duplicate warnings and master-rate auto-fill.

### Phase 4 — Expenses & accounting
- Expenses with bill/receipt attachments (camera capture on phones, magic-byte validated).
- SQL views `v_income_line` / `v_expense_line` as the single accounting definition; pharmacy purchases counted once.

### Phase 5 — Daily closing & reconciliation
- OPEN → REVIEW → RECONCILED → CLOSED workflow, reconciliation by Cash/Card/UPI/Bank/Other with mandatory variance explanations, Admin reopen with reason, closing snapshot, correction requests with approval.
- DB triggers forbid deleting financial rows and editing their amounts.

### Phase 6 — Excel import/export
- Import centre: xlsx/xls/csv, multi-sheet, header detection, smart mapping with fixed values, validation summary, error workbook, duplicate detection (in-file + DB + file hash), warnings approval, Admin duplicate override, import history, batch reversal.
- Templates for every module plus combined income/expenditure; raw transaction export (Excel/CSV).

### Phase 7 — Analytics & dashboards
- Executive dashboard with 12 period presets, like-for-like comparison, KPI drill-down, alerts.
- Analytics: revenue, OPD, IPD, laboratory, pharmacy, expense, profitability — interactive charts with table views and click-to-drill.

### Phase 8 — Reports
- 13 reports (daily … historical comparison) with on-screen preview and Excel / CSV / PDF export.

### Phase 9 — Audit & security
- Append-only audit log with before/after diff, IP and device; audit viewer. CSRF origin checks, security headers, CSV formula-injection protection.

### Phase 10 — Testing & deployment
- 110 Vitest unit/integration tests (real PostgreSQL) and 8 Playwright E2E tests (desktop + mobile).
- Deployment, backup and recovery documentation; realistic, clearly fictional demo seed (~4 months).

### Fixed during verification
- `round2(1.005)` returned 1.00 (binary float noise) → precision-corrected rounding.
- Recharts axes wrapped in fragments were not rendered → axes are now direct children.
- A wide table on the dashboard caused horizontal scroll (and zoom-out) on phones → grid cards can shrink (`min-width: 0`).
- Abbreviated test names ("Diab Profile") did not match masters during import → unique token-prefix matching.
