import { describe, expect, it } from "vitest";
import { defaultGranularity, precedingRange, resolvePeriod, startOfQuarter, startOfYear } from "@/lib/periods";
import { addMonths, daysBetweenInclusive, startOfWeek, todayISO } from "@/lib/dates";

const today = "2026-09-24"; // a Thursday

describe("resolvePeriod", () => {
  it("today vs yesterday", () => {
    const p = resolvePeriod({ preset: "today", today });
    expect(p.current).toMatchObject({ from: today, to: today });
    expect(p.previous).toMatchObject({ from: "2026-09-23", to: "2026-09-23" });
  });
  it("this week is Monday→today and compared like-for-like with last week", () => {
    const p = resolvePeriod({ preset: "this_week", today });
    expect(p.current).toMatchObject({ from: "2026-09-21", to: today });
    expect(p.previous).toMatchObject({ from: "2026-09-14", to: "2026-09-17" });
  });
  it("full comparison mode uses the whole previous week", () => {
    const p = resolvePeriod({ preset: "this_week", today, compareMode: "full" });
    expect(p.previous).toMatchObject({ from: "2026-09-14", to: "2026-09-20" });
  });
  it("last week vs the week before", () => {
    const p = resolvePeriod({ preset: "last_week", today });
    expect(p.current).toMatchObject({ from: "2026-09-14", to: "2026-09-20" });
    expect(p.previous).toMatchObject({ from: "2026-09-07", to: "2026-09-13" });
  });
  it("this month vs last month (like-for-like clips at month end)", () => {
    expect(resolvePeriod({ preset: "this_month", today }).previous).toMatchObject({ from: "2026-08-01", to: "2026-08-24" });
    const march = resolvePeriod({ preset: "this_month", today: "2026-03-31" });
    expect(march.previous).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("last month vs the month before", () => {
    const p = resolvePeriod({ preset: "last_month", today });
    expect(p.current).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(p.previous).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });
  it("calendar quarter and Indian fiscal quarter", () => {
    expect(resolvePeriod({ preset: "this_quarter", today }).current.from).toBe("2026-07-01");
    expect(resolvePeriod({ preset: "last_quarter", today }).current).toMatchObject({ from: "2026-04-01", to: "2026-06-30" });
    expect(startOfQuarter("2026-02-10", 4)).toBe("2026-01-01");
    expect(startOfQuarter("2026-05-10", 4)).toBe("2026-04-01");
  });
  it("financial year starting in April", () => {
    expect(startOfYear("2026-03-31", 4)).toBe("2025-04-01");
    expect(startOfYear("2026-04-01", 4)).toBe("2026-04-01");
    const p = resolvePeriod({ preset: "previous_year", today, fyStartMonth: 4 });
    expect(p.current).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
  });
  it("custom ranges compare with the preceding equal-length range", () => {
    const p = resolvePeriod({ preset: "custom", today, from: "2026-09-01", to: "2026-09-10" });
    expect(p.previous).toMatchObject({ from: "2026-08-22", to: "2026-08-31" });
  });
  it("explicit comparison range (e.g. year-on-year)", () => {
    const p = resolvePeriod({ preset: "this_month", today, compareFrom: "2025-09-01", compareTo: "2025-09-24" });
    expect(p.previous).toMatchObject({ from: "2025-09-01", to: "2025-09-24" });
  });
  it("rejects an invalid custom range", () => {
    expect(() => resolvePeriod({ preset: "custom", today, from: "2026-09-10", to: "2026-09-01" })).toThrow();
  });
});

describe("date helpers", () => {
  it("weeks start on Monday", () => {
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21"); // Sunday
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });
  it("addMonths clamps to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("preceding range has equal length", () => {
    const r = precedingRange({ from: "2026-09-01", to: "2026-09-30" });
    expect(daysBetweenInclusive(r.from, r.to)).toBe(30);
  });
  it("today is computed in IST, not UTC", () => {
    expect(todayISO(new Date("2026-09-24T20:00:00Z"))).toBe("2026-09-25"); // 01:30 IST next day
  });
  it("granularity follows range length", () => {
    expect(defaultGranularity("2026-09-01", "2026-09-30")).toBe("day");
    expect(defaultGranularity("2026-06-01", "2026-09-30")).toBe("week");
    expect(defaultGranularity("2025-10-01", "2026-09-30")).toBe("month");
  });
});
