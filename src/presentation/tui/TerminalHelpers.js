import termkit from "terminal-kit";

export const { terminal: term } = termkit;

export function formatTimestamp(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function padOrTruncate(str, width) {
  if (width <= 0) return "";
  // Iterate by Unicode code points ([...str]) so surrogate pairs (e.g., emojis) are never split
  const codePoints = [...str];
  if (codePoints.length > width) {
    return width > 1
      ? `${codePoints.slice(0, width - 1).join("")}…`
      : codePoints.slice(0, width).join("");
  }
  return str.padEnd(width, " ");
}

export async function promptLine(label, { echo = true } = {}) {
  term(label);
  const value = await term.inputField({
    echo,
    cancelable: true,
  }).promise;
  term("\n");
  if (value === undefined) {
    term.processExit(0);
  }
  return value;
}
