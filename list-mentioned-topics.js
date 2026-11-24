#!/usr/bin/env node
import dotenv from "dotenv";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import input from "input";
import tdl from "tdl";
import { getTdjson } from "prebuilt-tdlib";

const ENV_PATH = fileURLToPath(new URL(".env", import.meta.url));
const DB_PATH = fileURLToPath(new URL("tdlib-db", import.meta.url));
const FILES_PATH = fileURLToPath(new URL("tdlib-files", import.meta.url));

dotenv.config({ path: ENV_PATH });

async function saveToEnv(updates) {
  let content = "";
  try {
    content = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    // .env does not exist yet
  }

  const lines = content ? content.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(updates)) {
    const formatted = `${key}="${String(value).replace(/"/g, '\\"')}"`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index !== -1) {
      lines[index] = formatted;
    } else {
      lines.push(formatted);
    }
  }

  const normalized = lines.filter((line, i) => line !== "" || i < lines.length - 1);
  await fs.writeFile(ENV_PATH, `${normalized.join("\n")}\n`, "utf8");
}

function getMessageTopicId(msg) {
  if (msg.topic_id?._ === "messageTopicForum") {
    return msg.topic_id.forum_topic_id;
  }
  return msg.message_thread_id || 0;
}

function getTopicId(topic) {
  return topic.info.forum_topic_id ?? topic.info.message_thread_id;
}

// 1. Load or prompt for Telegram API credentials
let apiId = Number(process.env.TG_API_ID);
let apiHash = process.env.TG_API_HASH?.trim();

if (!apiId || !apiHash) {
  console.log("Telegram API credentials not found in .env.");
  console.log("Get them at https://my.telegram.org -> API development tools\n");

  if (!apiId) apiId = Number(await input.text("Enter your TG_API_ID: "));
  if (!apiHash) apiHash = (await input.text("Enter your TG_API_HASH: ")).trim();

  await saveToEnv({ TG_API_ID: apiId, TG_API_HASH: apiHash });
  console.log("Saved TG_API_ID and TG_API_HASH to .env\n");
}

// 2. Initialize TDLib with C++ debug logs silenced
tdl.configure({
  tdjson: getTdjson(),
  verbosityLevel: 0,
});

const client = tdl.createClient({
  apiId,
  apiHash,
  databaseDirectory: DB_PATH,
  filesDirectory: FILES_PATH,
});

client.on("error", (err) => {
  console.error("TDLib error:", err);
});

await client.login({
  async getPhoneNumber(retry) {
    if (retry) console.log("Invalid phone number, please try again.");
    return await input.text("Phone number (with country code, e.g. +5522999999999): ");
  },
  async getAuthCode(retry) {
    if (retry) console.log("Invalid code, please try again.");
    return await input.text("Login code sent to your Telegram app: ");
  },
  async getPassword(passwordHint, retry) {
    if (retry) console.log("Invalid 2FA password, please try again.");
    const hint = passwordHint ? ` (hint: ${passwordHint})` : "";
    return await input.text(`2FA password${hint}: `);
  },
  async getName() {
    return { firstName: "User", lastName: "" };
  },
});

// 3. Load chat list
process.stderr.write("Loading chats...");
while (true) {
  try {
    await client.invoke({
      _: "loadChats",
      chat_list: { _: "chatListMain" },
      limit: 100,
    });
  } catch (err) {
    if (err?.code === 404) break;
    throw err;
  }
}

const { chat_ids } = await client.invoke({
  _: "getChats",
  chat_list: { _: "chatListMain" },
  limit: 500,
});

let foundAny = false;

for (let i = 0; i < chat_ids.length; i++) {
  const chat = await client.invoke({ _: "getChat", chat_id: chat_ids[i] });
  if (chat.type?._ !== "chatTypeSupergroup" || chat.type.is_channel) continue;

  const supergroup = await client.invoke({
    _: "getSupergroup",
    supergroup_id: chat.type.supergroup_id,
  });
  if (!supergroup.is_forum) continue;

  process.stderr.write(`\r\x1b[KScanning forum: ${chat.title}...`);

  // Step A: Search mentions FIRST so groups with 0 mentions are skipped instantly
  const mentionRes = await client.invoke({
    _: "searchChatMessages",
    chat_id: chat.id,
    query: "",
    from_message_id: 0,
    offset: 0,
    limit: 100,
    filter: { _: "searchMessagesFilterMention" },
  });

  if (!mentionRes.messages || mentionRes.messages.length === 0) continue;

  // Map each mentioned topic ID to its newest mention message ID
  const latestMentionByTopic = new Map();
  for (const msg of mentionRes.messages) {
    const topicId = getMessageTopicId(msg);
    if (topicId && !latestMentionByTopic.has(topicId)) {
      latestMentionByTopic.set(topicId, msg.id);
    }
  }

  if (latestMentionByTopic.size === 0) continue;

  // Step B: Fetch metadata ONLY for the topics where you were mentioned
  const activeMentionedTopics = [];
  for (const [topicId, latestMsgId] of latestMentionByTopic) {
    try {
      const topic = await client.invoke({
        _: "getForumTopic",
        chat_id: chat.id,
        forum_topic_id: topicId,
      });
      if (!topic.info.is_closed) {
        activeMentionedTopics.push({ topic, latestMsgId });
      }
    } catch {
      // Topic may have been deleted
    }
  }

  if (activeMentionedTopics.length > 0) {
    foundAny = true;
    process.stderr.write("\r\x1b[K");

    // Sort by topic creation date (newest first)
    activeMentionedTopics.sort(
      (a, b) => b.topic.info.creation_date - a.topic.info.creation_date
    );

    console.log(`\nGroup: ${chat.title}`);
    for (const { topic, latestMsgId } of activeMentionedTopics) {
      const createdDate = new Date(topic.info.creation_date * 1000)
        .toISOString()
        .split("T")[0];

      let link = "";
      try {
        const linkRes = await client.invoke({
          _: "getMessageLink",
          chat_id: chat.id,
          message_id: latestMsgId,
          media_timestamp: 0,
          for_album: false,
          in_message_thread: true,
        });
        link = linkRes.link;
      } catch {
        const topicId = getTopicId(topic);
        const rawMsgId = Math.floor(latestMsgId / 1048576);
        link =
          topicId === 1
            ? `https://t.me/c/${supergroup.id}/${rawMsgId}`
            : `https://t.me/c/${supergroup.id}/${topicId}/${rawMsgId}`;
      }

      console.log(
        `  - ${topic.info.name} (created: ${createdDate}, unread mentions: ${topic.unread_mention_count})`
      );
      console.log(`    ${link}`);
    }
  }
}

process.stderr.write("\r\x1b[K");

if (!foundAny) {
  console.log("No mentions found in any active forum topics.");
}

await client.close();
process.exit(0);
