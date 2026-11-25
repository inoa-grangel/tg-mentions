/**
 * Port interface for Telegram forum & mention queries.
 */
export class TelegramGateway {
  async listForumSupergroups() {
    throw new Error("Not implemented");
  }
  async fetchMentionedTopicsInForums(_allowedChatIds, _onProgress) {
    throw new Error("Not implemented");
  }
}
