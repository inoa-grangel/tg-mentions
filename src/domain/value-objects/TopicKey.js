export class TopicKey {
  constructor(hash) {
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error("TopicKey must be a 64-character lowercase hex digest.");
    }
    this.value = hash;
    Object.freeze(this);
  }

  static fromCoordinates(chatId, topicId, hmacSigner) {
    const hash = hmacSigner(`${chatId}:${topicId}`);
    return new TopicKey(hash);
  }

  toString() {
    return this.value;
  }
}
