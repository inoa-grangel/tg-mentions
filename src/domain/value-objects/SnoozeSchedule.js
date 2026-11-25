export const HIDE_MENU_OPTIONS = Object.freeze([
  { type: "forever", key: "1", label: "Hide forever" },
  {
    type: "until_message",
    key: "2",
    label: "Hide until it gets a new message",
  },
  {
    type: "snooze",
    key: "3",
    label: "Hide until new message or after a date...",
  },
]);

export function getNextMorning(hour, now = new Date()) {
  const target = new Date(now.getTime());
  target.setDate(target.getDate() + 1);
  target.setHours(hour, 0, 0, 0);
  return target.getTime();
}

export const SNOOZE_PRESETS = Object.freeze([
  { key: "30m", label: "30 minutes", ms: 30 * 60 * 1000 },
  { key: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { key: "3h", label: "3 hours", ms: 3 * 60 * 60 * 1000 },
  { key: "1d", label: "Tomorrow (9:00 AM)", getUntil: () => getNextMorning(9) },
  { key: "3d", label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { key: "1w", label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
]);

export function parseDateOrDurationInput(raw, now = Date.now()) {
  const value = raw.trim();
  const lower = value.toLowerCase();

  const preset = SNOOZE_PRESETS.find((item) => item.key === lower);
  if (preset) {
    return preset.getUntil ? preset.getUntil() : now + preset.ms;
  }

  const relMatch = lower.match(/^(\d+)\s*(m|min|h|hr|d|w)$/);
  if (relMatch) {
    const amount = Number(relMatch[1]);
    const unit = relMatch[2];
    const multipliers = {
      m: 60 * 1000,
      min: 60 * 1000,
      h: 60 * 60 * 1000,
      hr: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    };
    return now + amount * multipliers[unit];
  }

  const timeMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hh = Number(timeMatch[1]);
    const mm = Number(timeMatch[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      const target = new Date(now);
      target.setHours(hh, mm, 0, 0);
      if (target.getTime() <= now) {
        target.setDate(target.getDate() + 1);
      }
      return target.getTime();
    }
  }

  const dateMatch = value.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?$/,
  );
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const day = Number(dateMatch[3]);
    const hh = dateMatch[4] !== undefined ? Number(dateMatch[4]) : 9;
    const mm = dateMatch[5] !== undefined ? Number(dateMatch[5]) : 0;
    const target = new Date(year, month, day, hh, mm, 0, 0);
    if (!Number.isNaN(target.getTime()) && target.getTime() > now) {
      return target.getTime();
    }
  }

  return null;
}
