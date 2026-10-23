// Tokens, codes and names.

export const now = (): number => Math.floor(Date.now() / 1000);

// A secret: `bytes` random bytes in base64url.
export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Tokens are stored only as their SHA-256.
export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Codes people type or read off a screen: no 0/O, 1/I/L.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(length = 8): string {
  // Bytes past the largest multiple of the alphabet's size are drawn again,
  // so every character is equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";
  while (out.length < length)
    for (const x of crypto.getRandomValues(new Uint8Array(length)))
      if (x < limit && out.length < length) out += CODE_ALPHABET[x % CODE_ALPHABET.length];
  return out;
}

// "ABCD-EFGH" or "abcdefgh" back to "ABCDEFGH".
export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sameSecret(a: string, b: string): boolean {
  // Constant time over the longer length.
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// The characters the game's vector font draws (123 glyphs in the
// original's executable at 0x821826A0): printable ASCII but & @ ` { } ~,
// and Latin-1 capitals but Î and Ð. Lower case is drawn as small capitals.
const FONT =
  " !\"#$%'()*+,-./0123456789:;<=>?ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_|abcdefghijklmnopqrstuvwxyz" +
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÏÑÒÓÔÕÖØÙÚÛÜßàáâãäåæçèéêëìíïñòóôõöøùúûü";
const FONT_SET = new Set([...FONT]);
export const NAME_MAX = 20;

// A name as typed, tidied: spaces collapsed and trimmed. Returns the name,
// or an error to show.
export function checkName(raw: string): { name: string } | { error: string } {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name) return { error: "Choose a name." };
  if ([...name].length > NAME_MAX) return { error: `Names are at most ${NAME_MAX} characters.` };
  const bad = [...new Set([...name].filter((c) => !FONT_SET.has(c)))];
  if (bad.length) return { error: `The game can't show ${bad.map((c) => `"${c}"`).join(", ")} in a name.` };
  return { name };
}

export const nameKey = (name: string): string => name.toLowerCase();

// A device's name as the game sends it ("Steam Deck", "PC"): anything
// printable, short.
export function cleanDeviceName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  return (s || "A device").slice(0, 40);
}
