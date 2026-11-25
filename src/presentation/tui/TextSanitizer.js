/**
 * Strips ANSI escape sequences, C0/C1 control characters, zero-width spoofing
 * characters, and Unicode bidirectional formatting/override characters (e.g., U+202E RLO)
 * from untrusted Telegram strings.
 */
export function sanitizeText(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, " ")
    .trim();
}
