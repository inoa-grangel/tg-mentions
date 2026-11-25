export class UnhideTopic {
  constructor({ topicRepository, auditLogger }) {
    this.topicRepository = topicRepository;
    this.auditLogger = auditLogger;
  }

  execute(topic, { onAuditError = null } = {}) {
    this.topicRepository.unhide(topic.key);
    topic.clearHide();
    this.auditLogger.log("UNHIDE_TOPIC", { topicKey: topic.key }, onAuditError);
  }
}
