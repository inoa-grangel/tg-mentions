import { sanitizeText } from "#presentation/tui/TextSanitizer.js";

export class HideTopic {
  constructor({ topicRepository, auditLogger }) {
    this.topicRepository = topicRepository;
    this.auditLogger = auditLogger;
  }

  execute(topic, { hideMode, hideUntil = null, onAuditError = null }) {
    this.topicRepository.setHidden({
      topicKey: topic.key,
      chatId: topic.chatId,
      topicId: topic.topicId,
      topicName: sanitizeText(topic.topicName),
      groupTitle: sanitizeText(topic.groupTitle),
      hideMode,
      hideUntil,
      lastMessageDateAtHide: topic.lastMessageDate,
    });

    topic.applyHide(hideMode, hideUntil);

    this.auditLogger.log(
      "HIDE_TOPIC",
      {
        topicKey: topic.key,
        hideMode,
        hideUntil,
      },
      onAuditError,
    );
  }
}
