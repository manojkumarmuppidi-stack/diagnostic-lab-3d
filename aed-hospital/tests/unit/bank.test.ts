import { describe, expect, it } from "vitest";
import { classify, parseSbiStatement } from "@/lib/import/bank";

const T = (cells: string[]) => cells.join("\t");
const statement = (rows: string[][], opening = "1,000.00") =>
  [
    T(["Account Name       :", "AED"]),
    T(["Account Number     :", "_00000012345678901"]),
    T(["Opening Balance as on 1 Oct 2026        :", opening]),
    T(["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Branch Code", "        Debit", "Credit", "Balance", ""]),
    ...rows.map((r) => T([...r, ""])),
    "**This is a computer generated statement",
  ].join("\n");

describe("SBI bank statement", () => {
  it("reads the lines, masks account numbers and checks the running balance", () => {
    const st = parseSbiStatement(
      statement([
        ["1 Oct 2026", "1 Oct 2026", "   BY TRANSFER-NEFT*YESB0000001*YESAP123456789012*RESILIENT INNOVA--", "TRANSFER FROM 4897694162092 / ", "4430", " ", "500.50", "1,500.50"],
        ["3 Oct 2026", "3 Oct 2026", "   TO TRANSFER-UPI/DR/627612345678/BODA SPA/FDRL/spandanach/Payme--", "TRANSFER TO 4897694162092 / ", "10098", "100.00", " ", "1,400.50"],
      ]),
    );
    expect(st.account).toBe("8901");
    expect(st.rows.map((r) => [r.date, r.kind, r.party, r.debit, r.credit])).toEqual([
      ["2026-10-01", "SETTLEMENT", "BharatPe", 0, 500.5],
      ["2026-10-03", "UPI_OUT", "BODA SPA", 100, 0],
    ]);
    expect(st.rows.every((r) => !/\d{9,}/.test(r.description + r.reference))).toBe(true);
    expect(() => parseSbiStatement(statement([["1 Oct 2026", "1 Oct 2026", "x", "", "1", "10.00", " ", "999.00"]]))).toThrow(/balance does not follow/);
    expect(() => parseSbiStatement("not a statement")).toThrow(/No transactions/);
  });

  it("tells payments apart and names who was paid", () => {
    const c = (d: string, ref = "", debit = 1) => classify(d, ref, debit);
    expect(c("TO CLEARING-Chq 775612 Sess 2 TULASI SCIENTIFIC INS 26--775612")).toEqual({ kind: "CHEQUE", party: "TULASI SCIENTIFIC INS" });
    expect(c("CHEQUE WDL-CHEQUE TRANSFER TO--265401", "TRANSFER FROM 12345678901 Dr. AMARNATH KULKARNI / 265401")).toEqual({ kind: "CHEQUE", party: "Dr. AMARNATH KULKARNI" });
    expect(c("CHQ TRANSFER-RTGS UTR NO: SBINR52026--269020 NANESH AUTOMOTIVES PVT LTD")).toEqual({ kind: "CHEQUE", party: "NANESH AUTOMOTIVES PVT LTD" });
    expect(c("CHQ TRANSFER-RTGS UTR NO: SBINR52026--269017 ADVANCED ENDOCRINE AND DIABETES").kind).toBe("OWN_TRANSFER");
    expect(c("TO TRANSFER-INB Payment to Rent---", "SI907825 TRANSFER TO 12345678901 Mr. SATYANARAYANA RAJU /")).toEqual({ kind: "RENT", party: "Mr. SATYANARAYANA RAJU" });
    expect(c("DEBIT-Mar26_POS Rent_TID_ TS092677--")).toEqual({ kind: "OTHER_OUT", party: "SBI POS machine rent" });
    expect(c("TO TRANSFER-INB AP_ELECT Payments--").kind).toBe("ELECTRICITY");
    expect(c("CASH CHEQUE-CASH WITHDRAWAL BY CHQ--775").kind).toBe("CASH");
    expect(c("TO TRANSFER-TDS 194N ON CASH WDL--").kind).toBe("STATUTORY");
    expect(c("BULK POSTING-SBIP_CR_ADVANCED ENDOCRINE ANDTS076630        3009--", "", 0)).toEqual({ kind: "SETTLEMENT", party: "SBI POS / UPI" });
    expect(c("BY TRANSFER-UPI/CR/1234/GAURAV S/BARB/gaurav@ok/Payme--", "", 0)).toEqual({ kind: "UPI_IN", party: "GAURAV S" });
  });
});
