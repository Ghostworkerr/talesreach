import { z } from "zod";

/**
 * Account and age rules (CLAUDE.md "Player safety rules").
 * - Date of birth is asked before any account exists.
 * - Under 13: not allowed. 13–17: minor account. 18+: adult.
 * The server always decides; these helpers are shared so the client can
 * explain the rules with the same logic.
 */

export const MIN_AGE = 13;
export const ADULT_AGE = 18;
export const MAX_AGE = 120;

export type AgeGroup = "child" | "minor" | "adult";

/** Whole years between a YYYY-MM-DD birth date and `now` (UTC dates). */
export function ageOn(dob: string, now: Date = new Date()): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}

export function ageGroup(dob: string, now: Date = new Date()): AgeGroup {
  const age = ageOn(dob, now);
  if (age < MIN_AGE) return "child";
  if (age < ADULT_AGE) return "minor";
  return "adult";
}

/** A real calendar date, in the past, for someone at most 120 years old. */
export const DateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "not a real date")
  .refine((s) => {
    const age = ageOn(s);
    return age >= 0 && age <= MAX_AGE && new Date(`${s}T00:00:00Z`).getTime() <= Date.now();
  }, "date out of range");

/** Recovery ("save") codes: 3 groups of 4 letters/digits, no look-alike characters. */
export const SAVE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export const SaveCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-KMNP-TV-Z2-9]{4}-?[A-HJ-KMNP-TV-Z2-9]{4}-?[A-HJ-KMNP-TV-Z2-9]{4}$/, "not a save code")
  .transform((s) => s.replace(/-/g, ""));

export const GuestRequest = z.object({ dob: DateOfBirth }).strict();
export const LoginRequest = z.object({ code: SaveCode }).strict();

/** What the server tells a client about its own account (never other players'). */
export interface AccountInfo {
  id: string;
  ageGroup: Exclude<AgeGroup, "child">;
  hasSaveCode: boolean;
  createdAt: string;
}

export function formatSaveCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
