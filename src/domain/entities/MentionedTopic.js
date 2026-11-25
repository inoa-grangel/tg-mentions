export class MentionedTopic {
  constructor({
    key,
    chatId,
    topicId,
    groupTitle,
    topicName,
    lastMessageDate,
    lastMsgFormatted,
    unreadCount,
    hideMode = null,
    hideUntil = null,
    link,
    webLink,
  }) {
    this.key = key;
    this.chatId = chatId;
    this.topicId = topicId;
    this.groupTitle = groupTitle;
    this.topicName = topicName;
    this.lastMessageDate = lastMessageDate;
    this.lastMsgFormatted = lastMsgFormatted;
    this.unreadCount = unreadCount;
    this.hideMode = hideMode;
    this.hideUntil = hideUntil;
    this.link = link;
    this.webLink = webLink;
  }

  get isHidden() {
    return this.hideMode !== null;
  }

  applyHide(hideMode, hideUntil = null) {
    this.hideMode = hideMode;
    this.hideUntil = hideUntil;
  }

  clearHide() {
    this.hideMode = null;
    this.hideUntil = null;
  }
}

export function evaluateHideState(
  record,
  currentLastMessageDate,
  now = Date.now(),
) {
  if (!record) return null;

  if (record.hideMode === "forever") {
    return { mode: "forever", hideUntil: null };
  }

  if (currentLastMessageDate > record.lastMessageDateAtHide) {
    return null;
  }

  if (record.hideMode === "until_message") {
    return { mode: "until_message", hideUntil: null };
  }

  if (record.hideMode === "snooze") {
    if (record.hideUntil && now >= record.hideUntil) {
      return null;
    }
    return { mode: "snooze", hideUntil: record.hideUntil };
  }

  return null;
}
