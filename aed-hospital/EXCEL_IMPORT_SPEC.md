# Excel Import Specification

## 1. Supported files
`.xlsx` (ExcelJS), `.xls` (SheetJS) and `.csv` (built-in parser; comma, semicolon or tab, BOM-aware). Max 10 MB (`MAX_UPLOAD_MB`) and 50,000 rows per sheet. Type is verified by magic bytes. Every visible sheet becomes its own **batch**. The import type is guessed from the sheet name (`OPD`, `Lab Register`, `Expenses`…) or chosen by the user.

## 2. Import types
OPD · IPD · Laboratory · Pharmacy (sales with optional Return and Purchases columns) · Pharmacy Returns · Pharmacy Purchases · Diet · Other Income · Expenses · **Combined Income** (a `Stream` column routes each row to OPD/IPD/LAB/PHARMACY/DIET/OTHER) · **Combined Expenditure** (a `Type` column separates expenses from pharmacy purchases) · **Complete hospital workbook** (multi-sheet; one batch per sheet).

Templates (`/api/templates/<type>`) have exactly the columns listed in the brief, a clearly fictional sample row and an Instructions sheet.

## 3. Workflow
1. **Upload** → the header row is auto-detected (skips title rows), rows are stored as `ImportRecord.raw`, and a `fileHash` is saved. If the same file/sheet was imported before, a warning is shown.
2. **Map** → `suggestMapping()` scores each header against field labels and aliases (exact, token overlap, Levenshtein) and assigns greedily. The user can change any column or set a **fixed value for every row** (e.g. "New/Old = Old"). A sheet with a single money column maps it to **Net Amount** (the amount collected).
3. **Validate** → each row is normalised, then checked with the module's Zod schema, the closed-day rule and duplicate detection.
4. **Review** → summary (records found, valid, need approval, duplicates, errors, missing dates, missing amounts, unknown services, unknown categories, invalid payment modes, totals rows), a row list with problems, and a downloadable **error file** (original columns + row number + status + errors + warnings).
5. **Confirm** → explicit confirmation. Rows with warnings are imported **only** if "approve warnings" is ticked. Duplicates are skipped unless an **Admin** chooses "import anyway" (per row or all).
6. **Commit** → one DB transaction per batch. Rows reuse `insertRecord()`. New master entries are created only for approved rows. Batch totals are stored and the commit is audited.
7. **History** → file, user, time, found / imported / rejected / duplicates, total amount, status. **Reverse** (Admin, reason required) marks every row of the batch `REVERSED`.

## 4. Row rules
| Situation | Result |
|---|---|
| Missing / invalid / future date | **Error** |
| No amount in any money column | **Error** |
| Negative amount | **Error** (record refunds/returns as their own rows) |
| Row containing "Total", "Grand Total", "Sub total"… | **Error**: a totals row would double count |
| Discount > amount | **Error** |
| Day already CLOSED | **Error** (reopen the day first) |
| Amount − Discount ≠ Net | Warning: Net kept (it is what was collected), Amount recomputed |
| Unknown doctor / test / category / specialty | Warning: added to master data on approval (new tests get rate 0 until the Admin sets it) |
| Name close to a master ("Diab Profile", "Diabetic Profle") | Warning: matched to the master (abbreviation or ≥ 84 % similarity; ambiguous abbreviations never match) |
| Blank / unknown payment mode ("crypto") | Warning: recorded as **Other** (counted in *invalid payment modes*) |
| Blank specialty / diet service / admission type | Warning: recorded as General / Diet Counselling / Other |
| Month-first date (e.g. 09/25/2026) | Warning: read month-first only when day-first is impossible |
| IPD row without payment columns | Treated as **fully settled on the admission date** (FINAL_SETTLEMENT of the net) |
| Pharmacy row with Return / Purchases | Creates separate `PharmacyReturn` / `PharmacyPurchase` records |

Parsed formats: dates `DD/MM/YYYY`, `DD-MM-YY`, `DD.MM.YYYY`, `YYYY-MM-DD`, `01-Sep-2026`, `Sep 1, 2026`, Excel serials and real Excel dates. Amounts `₹1,25,000.50`, `Rs.300/-`, `(250)`. Payment modes Cash, Card/Debit/Credit/POS, UPI/GPay/PhonePe/Paytm/BHIM, Bank/NEFT/RTGS/IMPS/Cheque. New/Old: New, N, First visit / Old, O, Follow up, F/U, Review, Revisit.

## 5. Mapping aliases (examples)
`Consult → Consultation Type`, `Amt → Net Amount`, `Test Name → Investigation`, `UHID/MRN/Reg No → Patient ID`, `Ref By → Referring Doctor`, `Mode/MOP → Payment Mode`, `N/O → New/Old`, `Particulars → Description/Service`. The full list is in `src/lib/modules.ts` (`aliases`).

## 6. Duplicate detection
`fingerprint = module | date | patient ID or name | invoice/reference | service id | net amount` (normalised). It is checked against ACTIVE database rows and against earlier rows in the same file. Manual entry uses the same key and asks "Save anyway?". A re-uploaded file produces 100 % duplicates. The `fileHash` also flags the re-upload up front.

## 7. Historical behaviour
Imported rows are ordinary transactions: they use their **own transaction date**, appear immediately in every dashboard, analytics view and report, and support month-on-month, quarter and year comparisons. The Historical Comparison report shows 12 months side by side.

## 8. Security
Import needs `import.run`. Importing duplicates needs `import.override_duplicates` and reversal needs `import.reverse` (Admin only by default). Uploads are size-limited and magic-byte checked. Staging rows of a cancelled batch are deleted; nothing reaches financial tables until commit.

## 9. Not supported (by design)
**Daily-total spreadsheets** (one row per day with "OPD total", "Lab total"…) are not imported as transactions. Doing so would fabricate patient, test and consultation counts. Options: import them as Other Income per stream (amounts only, no volumes), or add a dedicated summary table. This decision belongs to the hospital.

## 10. Known dependency risk
The npm build of SheetJS (`xlsx@0.18.5`, used only for legacy `.xls`) has published advisories (prototype pollution, ReDoS) fixed in versions distributed only from cdn.sheetjs.com. Mitigations: `.xlsx`/`.csv` never touch it, uploads need an authenticated user with `import.run`, and files are size-capped. For production, install `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` or ask users to save `.xls` as `.xlsx`.
