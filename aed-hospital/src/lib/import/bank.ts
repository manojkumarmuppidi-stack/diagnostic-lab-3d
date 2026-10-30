/**
 * Bank statements, read to check the core accounts against the bank (they are not booked).
 * SBI's "Account Statement" download (.xls that is really tab-separated text): a header block, then
 * Txn Date · Value Date · Description · Ref No./Cheque No. · Branch Code · Debit · Credit · Balance.
 * Account numbers are cut to their last 4 digits wherever they appear.
 */

export interface BankRow {
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number;
  kind: BankKind;
  party: string | null;
}

export type BankKind =
  | "SETTLEMENT" // card/UPI collections settled by BharatPe or SBI
  | "UPI_IN"
  | "OTHER_IN"
  | "REVERSAL"
  | "OWN_TRANSFER" // between AED's own accounts: neither income nor expense
  | "RENT"
  | "ELECTRICITY"
  | "UPI_OUT"
  | "TRANSFER_OUT" // NEFT / RTGS / IMPS / internet banking
  | "CHEQUE"
  | "CASH"
  | "CARD"
  | "ACH"
  | "STATUTORY" // TDS, ESIC, GST, PF
  | "OTHER_OUT";

export const BANK_KIND_LABELS: Record<BankKind, string> = {
  SETTLEMENT: "UPI / card settlements",
  UPI_IN: "UPI received",
  OTHER_IN: "Other money in",
  REVERSAL: "Reversals",
  OWN_TRANSFER: "Transfers between AED's own accounts",
  RENT: "Rent",
  ELECTRICITY: "Electricity",
  UPI_OUT: "UPI payments",
  TRANSFER_OUT: "NEFT / RTGS / net banking",
  CHEQUE: "Cheques",
  CASH: "Cash withdrawals",
  CARD: "Debit card",
  ACH: "Auto-debits (ACH)",
  STATUTORY: "TDS / ESIC / GST",
  OTHER_OUT: "Other payments",
};

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function dateOf(v: string): string | null {
  const m = /^(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{4})$/.exec(v.trim());
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  const n = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  return n ? `${n[3]}-${n[2].padStart(2, "0")}-${n[1].padStart(2, "0")}` : null;
}

const money = (v: string | undefined) => {
  const s = (v ?? "").replace(/,/g, "").trim();
  return s ? Number(s) : 0;
};

/** Long digit runs (account numbers, UTRs) → "…1234". */
export const maskDigits = (s: string) => s.replace(/\d{9,}/g, (d) => `…${d.slice(-4)}`);

const clean = (s: string) => maskDigits(s.replace(/\s+/g, " ").trim());
const tidy = (s: string | undefined | null) => {
  const t = (s ?? "")
    .replace(/[…\d]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t : null;
};

/** What kind of line it is and who the money went to / came from. */
export function classify(description: string, reference: string | null, debit: number): { kind: BankKind; party: string | null } {
  const d = description.toUpperCase();
  const ref = reference ?? "";
  const upi = /UPI\/(?:DR|CR)\/[^/]*\/([^/]*)\/[^/]*\/[^/]*\/([^-]*)/i.exec(description);
  if (/ADVANCED ENDOCRINE|ADVANCED ENDOCRINE HOSPITAL/.test(d.replace(/ANDTS\d+|SBIP_CR_ADVANCED/g, "")) || /ADVANCED ENDOCRINE/i.test(ref))
    if (!/SBIP_CR|BULK POSTING/.test(d)) return { kind: "OWN_TRANSFER", party: "AED (own account)" };
  if (!debit) {
    if (/RESILIENT|BHARAT ?PE/.test(d)) return { kind: "SETTLEMENT", party: "BharatPe" };
    if (/SBIP_|BULK POSTING|-UPI TS/.test(d)) return { kind: "SETTLEMENT", party: "SBI POS / UPI" };
    if (/UPI\/REV/.test(d)) return { kind: "REVERSAL", party: null };
    if (upi) return { kind: "UPI_IN", party: tidy(upi[1]) };
    const neft = /NEFT\*[^*]*\*[^*]*\*([^-]*)/i.exec(description);
    return { kind: "OTHER_IN", party: tidy(neft?.[1]) ?? tidy(description.split("--")[1]) };
  }
  if (/POS[ _]?RENT/.test(d)) return { kind: "OTHER_OUT", party: "SBI POS machine rent" };
  if (/CHQ RET|CHARGES|CHGS/.test(d)) return { kind: "OTHER_OUT", party: "Bank charges" };
  if (/RENT|OWNER|NEWAED/.test(d)) {
    const who = /TRANSFER TO \S+\s+(.+?) \//i.exec(ref)?.[1] ?? /--([A-Za-z].*?)$/.exec(description)?.[1];
    return { kind: "RENT", party: tidy(who) };
  }
  if (/ELECT/.test(d)) return { kind: "ELECTRICITY", party: "Electricity (TGSPDCL)" };
  if (/TDS|ESIC|GST|CBDT|EPFO|PROVIDENT|ESIC/.test(d + " " + ref.toUpperCase()))
    return { kind: "STATUTORY", party: tidy(/TRANSFER TO \S+\s+(.+?) \//i.exec(ref)?.[1]) ?? tidy(d.split("-").slice(1).join("-").replace(/--.*/, "")) };
  if (upi) return { kind: "UPI_OUT", party: tidy(upi[1]) };
  const clearing = /CLEARING-(?:CHQ \S+ SESS \d+ )?(.+?)(?: \S*\d\S*)?--/i.exec(description);
  if (clearing) return { kind: "CHEQUE", party: tidy(clearing[1]) };
  if (/CASH CHEQUE|CASH WITHDRAWAL|ATM/.test(d)) {
    const who = /CASH CHEQUE-(.+?)--/i.exec(description)?.[1];
    return { kind: "CASH", party: who && !/CASH WITHDRAWAL/i.test(who) ? tidy(who) : "Cash" };
  }
  if (/CHEQUE|CHQ/.test(d)) return { kind: "CHEQUE", party: tidy(/TRANSFER FROM \S+\s+(.+?) \//i.exec(ref)?.[1]) ?? tidy(/--\d*\s*([A-Za-z].*)$/.exec(description)?.[1]) };
  if (/DEBIT CARD|OTHPOS|POS /.test(d)) return { kind: "CARD", party: tidy(/OTHPOS\S*?(?:\d+)?([A-Z][^-]*)/i.exec(description)?.[1]) };
  if (/ACH/.test(d)) return { kind: "ACH", party: tidy(/ACHDR \S+ (.+?)--/i.exec(description)?.[1]) ?? "Auto-debit" };
  if (/NEFT|RTGS|IMPS|INB/.test(d)) {
    const who = /--(.+?)$/.exec(description)?.[1] ?? /TRANSFER TO \S+\s+(.+?) \//i.exec(ref)?.[1] ?? /INB (.+?)--/i.exec(description)?.[1];
    return { kind: "TRANSFER_OUT", party: tidy(who) };
  }
  return { kind: "OTHER_OUT", party: null };
}

export interface ParsedStatement {
  account: string; // last 4 digits
  opening: number | null;
  rows: BankRow[];
}

/** Reads an SBI statement; the running balance is checked line by line so a damaged file is refused. */
export function parseSbiStatement(text: string): ParsedStatement {
  const lines = text.split(/\r?\n/);
  let account = "";
  let opening: number | null = null;
  let header = false;
  const rows: BankRow[] = [];
  for (const line of lines) {
    const c = line.split("\t");
    const label = c[0].trim().toLowerCase();
    if (label.startsWith("account number")) account = (c.slice(1).join("").replace(/\D/g, "") || "").slice(-4);
    if (label.startsWith("opening balance")) opening = money(c[c.length - 1]);
    if (label === "txn date") {
      header = true;
      continue;
    }
    if (!header || c.length < 8) continue;
    const date = dateOf(c[0]);
    if (!date) continue;
    const description = clean(c[2]);
    const reference = clean(c[3]) || null;
    const debit = money(c[5]);
    const credit = money(c[6]);
    const { kind, party } = classify(c[2].replace(/\s+/g, " ").trim(), c[3].replace(/\s+/g, " ").trim(), debit);
    rows.push({ date, description, reference, debit, credit, balance: money(c[7]), kind, party: party ? maskDigits(party) : null });
  }
  if (!rows.length) throw new Error("No transactions found. Use SBI's Account Statement download (the .xls file).");
  let bal = opening;
  rows.forEach((r, i) => {
    if (bal !== null && Math.abs(Math.round((bal - r.debit + r.credit) * 100) / 100 - r.balance) > 0.01)
      throw new Error(`Line ${i + 1} (${r.date}): the balance does not follow from the previous line — the file looks damaged or edited`);
    bal = r.balance;
  });
  return { account, opening, rows };
}
