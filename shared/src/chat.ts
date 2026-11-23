import { z } from "zod";
import { containsBlockedWord } from "./filter.js";

/**
 * Chat and player-safety rules (CLAUDE.md "Player safety rules"):
 * - profanity is masked for everyone;
 * - links are removed for everyone (scams);
 * - phone numbers, emails and social handles are removed in anything sent by
 *   a minor or shown to a minor;
 * - players can mute (on their device), block (server-side, saved) and report.
 */

export const CHAT_MAX = 200;
/** Local chat reaches players within this distance (world pixels): about a screen. */
export const LOCAL_CHAT_RANGE = 220;
export const PARTY_MAX = 5;

/** Public player id: who you mute, block, report or invite (never your account id). */
export const PlayerId = z.string().regex(/^[a-f0-9]{12}$/);

export const ChatMessage = z
  .object({
    channel: z.enum(["local", "party"]),
    text: z.string().min(1).max(CHAT_MAX),
  })
  .strict();

export const BlockMessage = z.object({ pid: PlayerId }).strict();

export const REPORT_REASONS = ["language", "bullying", "personal_info", "inappropriate", "cheating", "other"] as const;
export const ReportMessage = z
  .object({
    pid: PlayerId,
    reason: z.enum(REPORT_REASONS),
    note: z.string().max(300).default(""),
  })
  .strict();

export const PartyInviteMessage = z.object({ pid: PlayerId }).strict();
export const PartyRespondMessage = z.object({ accept: z.boolean() }).strict();
export const EmptyMessage = z.object({}).strict();

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

/** Replace blocked words with asterisks, keeping the rest of the message. */
export function maskProfanity(text: string): string {
  // Whole message check first: catches spaced-out words ("f u c k") that span tokens.
  const tokens = text.split(/(\s+)/);
  const masked = tokens.map((t) => {
    if (!/\S/.test(t) || !containsBlockedWord(t)) return t;
    // Keep punctuation around the word ("fuck," -> "****,").
    const [, lead = "", word = "", tail = ""] = /^([^\p{L}\p{N}@$|]*)(.*?)([.,;:?!]*)$/u.exec(t) ?? [];
    return lead + "*".repeat(Math.min(word.length, 8)) + tail;
  });
  let out = masked.join("");
  if (containsBlockedWord(out)) {
    // Something spread across several tokens: hide the runs of single letters too.
    out = out.replace(/(?:\b\p{L}\b[\s.\-_*]*){3,}/gu, (m) => "*".repeat(Math.min(m.replace(/\s/g, "").length, 8)) + (m.endsWith(" ") ? " " : ""));
    if (containsBlockedWord(out)) out = "***";
  }
  return out;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|net|org|io|gg|co|uk|me|tv|xyz|app|dev|ly|link|site|online|info|biz|us|ng|in|de|fr|ru|tk)\b(?:\/\S*)?/giu;
const EMAIL_RE = /\b[\w.+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[\w-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}\b/giu;
/** 7+ digits, allowing spaces/dashes/dots/brackets between them. */
const PHONE_RE = /(?:\+?\d[\s\-.()]*){7,}/g;
const HANDLE_RE = /(?:^|\s)@[\w.]{2,}/g;
/** A social platform name plus the next few words (where the handle usually is). */
const SOCIAL_RE = /\b(?:insta(?:gram)?|snap(?:chat)?|discord|whats\s*app|telegram|tiktok|kik|facebook|fb|twitter|youtube|twitch|signal|wechat|line\s*id)\b(?:[\s:=-]+[@\w.#-]+){0,3}/giu;

/** Remove web links and email addresses (everyone). */
export function stripLinks(text: string): string {
  return text.replace(EMAIL_RE, "[removed]").replace(URL_RE, "[link removed]");
}

/** Remove contact details: emails, phone numbers, social handles (minor safety). */
export function stripContactInfo(text: string): string {
  return stripLinks(text)
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 7 ? " [removed] " : m))
    .replace(SOCIAL_RE, "[removed]")
    .replace(HANDLE_RE, " [removed]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Tidy whitespace and strip control characters; empty result means "don't send". */
export function tidyChat(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX);
}
