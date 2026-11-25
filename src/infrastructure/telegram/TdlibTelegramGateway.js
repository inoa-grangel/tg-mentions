import { TelegramGateway } from "#domain/ports/TelegramGateway.js";
import { sanitizeText } from "#presentation/tui/TextSanitizer.js";

function getMessageTopicId(msg) {
  if (msg.topic_id?._ === "messageTopicForum") {
    return msg.topic_id.forum_topic_id;
  }
  return msg.message_thread_id || 0;
}

function getRawTopicId(topic) {
  return (
    topic.info.forum_topic_id ??
    Math.floor(topic.info.message_thread_id / 1048576)
  );
}

export class TdlibTelegramGateway extends TelegramGateway {
  constructor(client) {
    super();
    this.client = client;
  }

  async _loadAllMainChats() {
    while (true) {
      try {
        await this.client.invoke({
          _: "loadChats",
          chat_list: { _: "chatListMain" },
          limit: 100,
        });
      } catch (err) {
        if (err?.code === 404) break;
        throw err;
      }
    }

    const { chat_ids } = await this.client.invoke({
      _: "getChats",
      chat_list: { _: "chatListMain" },
      limit: 500,
    });
    return chat_ids;
  }

  async listForumSupergroups() {
    const chatIds = await this._loadAllMainChats();
    const forums = [];

    for (const chatId of chatIds) {
      const chat = await this.client.invoke({ _: "getChat", chat_id: chatId });
      if (chat.type?._ !== "chatTypeSupergroup" || chat.type.is_channel)
        continue;

      const supergroup = await this.client.invoke({
        _: "getSupergroup",
        supergroup_id: chat.type.supergroup_id,
      });
      if (!supergroup.is_forum) continue;

      forums.push({
        chatId: chat.id,
        title: sanitizeText(chat.title) || `Group ${chat.id}`,
      });
    }
    return forums;
  }

  async fetchMentionedTopicsInForums(allowedChatIds, onProgress) {
    const chatIds = await this._loadAllMainChats();
    const rawResults = [];

    for (let i = 0; i < chatIds.length; i++) {
      const chatId = chatIds[i];
      if (!allowedChatIds.has(chatId)) continue;

      const chat = await this.client.invoke({ _: "getChat", chat_id: chatId });
      if (chat.type?._ !== "chatTypeSupergroup" || chat.type.is_channel)
        continue;

      const supergroup = await this.client.invoke({
        _: "getSupergroup",
        supergroup_id: chat.type.supergroup_id,
      });
      if (!supergroup.is_forum) continue;

      const safeGroupTitle = sanitizeText(chat.title) || `Group ${chat.id}`;
      onProgress?.(`Scanning ${safeGroupTitle}...`);

      const mentionRes = await this.client.invoke({
        _: "searchChatMessages",
        chat_id: chat.id,
        query: "",
        from_message_id: 0,
        offset: 0,
        limit: 100,
        filter: { _: "searchMessagesFilterMention" },
      });

      if (!mentionRes.messages || mentionRes.messages.length === 0) continue;

      const latestMentionByTopic = new Map();
      for (const msg of mentionRes.messages) {
        const topicId = getMessageTopicId(msg);
        if (topicId && !latestMentionByTopic.has(topicId)) {
          latestMentionByTopic.set(topicId, { id: msg.id, date: msg.date });
        }
      }

      if (latestMentionByTopic.size === 0) continue;

      const username = supergroup.usernames?.active_usernames?.[0];

      for (const [topicId, latestMention] of latestMentionByTopic) {
        try {
          const topic = await this.client.invoke({
            _: "getForumTopic",
            chat_id: chat.id,
            forum_topic_id: topicId,
          });

          if (topic.info.is_closed) continue;

          const lastMessageDate =
            topic.last_message?.date ??
            latestMention.date ??
            topic.info.creation_date;

          rawResults.push({
            chatId: chat.id,
            topicId,
            groupTitle: safeGroupTitle,
            topicName: topic.info.name,
            lastMessageDate,
            unreadCount: topic.unread_mention_count,
            username,
            supergroupId: supergroup.id,
            rawTopicId: getRawTopicId(topic),
            rawMsgId: Math.floor(latestMention.id / 1048576),
          });
        } catch {
          // Topic may have been deleted
        }
      }
    }

    return rawResults;
  }
}
