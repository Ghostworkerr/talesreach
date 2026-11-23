/**
 * Text safety helpers shared by names and chat. The server always decides;
 * the client uses the same checks to explain problems before sending.
 *
 * The lists are short and conservative (clearly offensive words and slurs) and
 * are matched on a normalised form, so l33t-speak, repeated letters and spacing
 * tricks are caught. Short words are matched as whole words only, so innocent
 * words that happen to contain them (Essex, Dickens, Scunthorpe) are allowed.
 * Extend the lists in one place: here.
 */

/** Blocked wherever they appear (no innocent word contains these). */
const BLOCKED_ANYWHERE = [
  "fuck", "shit", "cunt", "bitch", "bastard", "pussy", "whore", "slut", "nigger", "nigga", "faggot",
  "retard", "tranny", "porn", "penis", "vagina", "wank", "twat", "pedo", "paedo", "molest", "hitler",
];

/** Blocked only as whole words. */
const BLOCKED_WORDS = new Set([
  "sex", "sexy", "dick", "dicks", "cock", "cocks", "anal", "cum", "fag", "fags", "spic", "paki", "tits", "tit",
  "boob", "boobs", "nude", "nudes", "rape", "raped", "rapist", "rapists", "chink", "kike", "spastic", "nazi", "nazis", "ass", "arse",
  "piss", "crap", "hoe", "hoes", "milf", "horny", "dildo", "jizz", "clit", "smut",
]);

const LOOKALIKES: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i", "|": "i",
};

/** Remove accents (é -> e) using Unicode decomposition. */
const stripAccents = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "");

/** Squeeze any run of the same letter to one ("fuuuck" -> "fuck"). */
const squeeze = (s: string) => s.replace(/(.)\1+/g, "$1");

/** Lowercase, map look-alike characters to letters, and drop everything that isn't a-z. */
export function normaliseForFilter(text: string): string {
  return stripAccents(text.toLowerCase())
    .replace(/[013457@$!|]/g, (c) => LOOKALIKES[c] ?? c)
    .replace(/[^a-z]/g, "");
}

/** Words in the text, normalised; runs of single letters ("s e x") are joined into one word. */
function words(text: string): string[] {
  const raw = text.split(/[^\p{L}\p{N}@$!|]+/u).map(normaliseForFilter).filter(Boolean);
  const out: string[] = [];
  let run = "";
  for (const w of raw) {
    if (w.length === 1) {
      run += w;
      continue;
    }
    if (run) out.push(run);
    run = "";
    out.push(w);
  }
  if (run) out.push(run);
  return out;
}

/** True if the text contains a blocked word. */
export function containsBlockedWord(text: string): boolean {
  const all = normaliseForFilter(text);
  const allSqueezed = squeeze(all);
  if (BLOCKED_ANYWHERE.some((w) => all.includes(w) || allSqueezed.includes(squeeze(w)))) return true;
  return words(text).some((w) => BLOCKED_WORDS.has(w) || BLOCKED_WORDS.has(squeeze(w)));
}

/** Character names: letters with single spaces, apostrophes or hyphens between them; 3–16 long. */
export const NAME_PATTERN = /^\p{L}(?:\p{L}|[ '-](?=\p{L})){2,15}$/u;

export type NameProblem = "length" | "characters" | "blocked";

/** Tidy a name (trim, single spaces) and say what's wrong with it, if anything. */
export function checkName(raw: string): { name: string; problem: NameProblem | null } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 16) return { name, problem: "length" };
  if (!NAME_PATTERN.test(name)) return { name, problem: "characters" };
  if (containsBlockedWord(name)) return { name, problem: "blocked" };
  return { name, problem: null };
}

/** Friendly suggestions for the creator's "random name" button. */
export const NAME_IDEAS = [
  "Aldric", "Brenna", "Cedric", "Dalla", "Edric", "Fenna", "Garrick", "Hilde", "Isolde", "Jory", "Kestrel", "Linnea",
  "Maren", "Nils", "Odessa", "Perrin", "Quill", "Rowena", "Soren", "Tamsin", "Ulric", "Vesna", "Wren", "Yara",
  "Alys", "Bram", "Corin", "Delphine", "Elric", "Freya", "Gideon", "Hollis", "Ivo", "Juniper", "Kael", "Lark",
  "Mira", "Nessa", "Orin", "Pell", "Rhosyn", "Sable", "Tobin", "Una", "Vale", "Wynn", "Ash", "Briar",
  "Cass", "Dorian", "Ember", "Flint", "Greer", "Hazel", "Ines", "Jasper", "Kit", "Lyra", "Morrow", "Nim",
];
