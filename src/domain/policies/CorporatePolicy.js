export class CorporatePolicy {
  constructor({
    allowedChatIds = null,
    enforcedByPolicy = false,
    requireDesktopApp = false,
    lockConfigDir = false,
    proxy = null,
    retentionDays = 90,
  }) {
    this.allowedChatIds = allowedChatIds;
    this.enforcedByPolicy = Boolean(enforcedByPolicy);
    this.requireDesktopApp = Boolean(requireDesktopApp);
    this.lockConfigDir = Boolean(lockConfigDir);
    this.proxy = proxy;
    this.retentionDays = Math.max(1, Number(retentionDays) || 90);
    this.retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
    Object.freeze(this);
  }

  isChatAllowed(chatId) {
    return Boolean(this.allowedChatIds && this.allowedChatIds.has(chatId));
  }

  static parseChatIdCsv(raw) {
    if (!raw || !raw.trim()) return null;
    const ids = raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isSafeInteger(n) && n !== 0);
    return ids.length > 0 ? new Set(ids) : null;
  }
}
