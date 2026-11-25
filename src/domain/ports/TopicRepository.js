/**
 * Port interface for persisting hidden/snoozed topic states.
 */
export class TopicRepository {
  purgeExpired() {
    throw new Error("Not implemented");
  }
  get(_topicHash) {
    throw new Error("Not implemented");
  }
  setHidden(_record) {
    throw new Error("Not implemented");
  }
  unhide(_topicHash) {
    throw new Error("Not implemented");
  }
  close() {
    throw new Error("Not implemented");
  }
}
