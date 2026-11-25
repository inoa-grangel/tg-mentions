export class ConfigureAllowlist {
  constructor({ telegramGateway, envStore, auditLogger, selectForumsUi }) {
    this.telegramGateway = telegramGateway;
    this.envStore = envStore;
    this.auditLogger = auditLogger;
    this.selectForumsUi = selectForumsUi;
  }

  async execute(existingAllowedIds) {
    const forums = await this.telegramGateway.listForumSupergroups();
    if (forums.length === 0) {
      throw new Error(
        "No Telegram forum supergroups found on this account to add to TG_ALLOWED_CHAT_IDS.",
      );
    }

    const chosen = await this.selectForumsUi(forums, existingAllowedIds);
    if (!chosen || chosen.size === 0) {
      throw new Error(
        "Allowlist configuration cancelled or empty. TG_ALLOWED_CHAT_IDS was not modified.",
      );
    }

    await this.envStore.save({
      TG_ALLOWED_CHAT_IDS: Array.from(chosen).join(","),
    });
    await this.auditLogger.log("ALLOWLIST_UPDATED", {
      count: chosen.size,
    });

    return chosen;
  }
}
