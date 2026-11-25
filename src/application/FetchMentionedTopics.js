import {
  MentionedTopic,
  evaluateHideState,
} from "#domain/entities/MentionedTopic.js";
import { DeepLink } from "#domain/value-objects/DeepLink.js";
import { TopicKey } from "#domain/value-objects/TopicKey.js";
import { formatTimestamp } from "#presentation/tui/TerminalHelpers.js";
import { sanitizeText } from "#presentation/tui/TextSanitizer.js";

export class FetchMentionedTopics {
  constructor({
    telegramGateway,
    topicRepository,
    cryptoService,
    auditLogger,
  }) {
    this.telegramGateway = telegramGateway;
    this.topicRepository = topicRepository;
    this.cryptoService = cryptoService;
    this.auditLogger = auditLogger;
  }

  async execute({ allowedChatIds, useAppScheme, onProgress }) {
    this.topicRepository.purgeExpired();
    onProgress?.("Loading Telegram chats...");

    const rawMentions = await this.telegramGateway.fetchMentionedTopicsInForums(
      allowedChatIds,
      onProgress,
    );

    const results = [];
    for (const item of rawMentions) {
      const topicKey = TopicKey.fromCoordinates(
        item.chatId,
        item.topicId,
        (input) => this.cryptoService.computeBlindIndex(input),
      );
      const keyStr = topicKey.toString();

      const hiddenRecord = this.topicRepository.get(keyStr);
      const activeHide = evaluateHideState(hiddenRecord, item.lastMessageDate);

      if (hiddenRecord && !activeHide) {
        this.topicRepository.unhide(keyStr);
        await this.auditLogger.log("UNHIDE_TOPIC", { topicKey: keyStr });
      }

      const appLink = DeepLink.build({
        useAppScheme,
        username: item.username,
        supergroupId: item.supergroupId,
        rawTopicId: item.rawTopicId,
        rawMsgId: item.rawMsgId,
      });

      const webLink = DeepLink.build({
        useAppScheme: false,
        username: item.username,
        supergroupId: item.supergroupId,
        rawTopicId: item.rawTopicId,
        rawMsgId: item.rawMsgId,
      });

      results.push(
        new MentionedTopic({
          key: keyStr,
          chatId: item.chatId,
          topicId: item.topicId,
          groupTitle: sanitizeText(item.groupTitle) || `Group ${item.chatId}`,
          topicName: sanitizeText(item.topicName) || `Topic ${item.topicId}`,
          lastMessageDate: item.lastMessageDate,
          lastMsgFormatted: formatTimestamp(item.lastMessageDate),
          unreadCount: item.unreadCount,
          hideMode: activeHide?.mode ?? null,
          hideUntil: activeHide?.hideUntil ?? null,
          link: appLink.toString(),
          webLink: webLink.toString(),
        }),
      );
    }

    results.sort((a, b) => b.lastMessageDate - a.lastMessageDate);
    return results;
  }
}
