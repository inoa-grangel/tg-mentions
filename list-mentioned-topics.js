#!/usr/bin/env node
import dotenv from "dotenv";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import input from "input";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const ENV_PATH = fileURLToPath(new URL(".env", import.meta.url));
dotenv.config({ path: ENV_PATH });

/**
 * Creates or updates key-value pairs in the local .env file without overwriting other variables.
 */
async function saveToEnv(updates) {
  let content = "";
  try {
    content = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    // .env does not exist yet; it will be created
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

// 1. Load or prompt for Telegram API credentials
let apiId = Number(process.env.TG_API_ID);
let apiHash = process.env.TG_API_HASH?.trim();
const savedSession = process.env.TG_SESSION?.trim() || "";

if (!apiId || !apiHash) {
  console.log("Telegram API credentials not found in .env.");
  console.log("Get them at https://my.telegram.org -> API development tools\n");

  if (!apiId) {
    apiId = Number(await input.text("Enter your TG_API_ID: "));
  }
  if (!apiHash) {
    apiHash = (await input.text("Enter your TG_API_HASH: ")).trim();
  }

  await saveToEnv({ TG_API_ID: apiId, TG_API_HASH: apiHash });
  console.log("Saved TG_API_ID and TG_API_HASH to .env\n");
}

// 2. Connect and prompt for login if TG_SESSION is missing or expired
const client = new TelegramClient(new StringSession(savedSession), apiId, apiHash, {
  connectionRetries: 5,
});

if (!savedSession) {
  console.log("No TG_SESSION token found in .env. Starting interactive login...\n");
}

await client.start({
  phoneNumber: async () => await input.text("Phone number (with country code, e.g. +5522999999999): "),
  password: async () => await input.text("2FA password (press Enter if none): "),
  phoneCode: async () => await input.text("Login code sent to your Telegram app: "),
  onError: (err) => console.error("Authentication error:", err),
});

const currentSession = client.session.save();
if (currentSession && currentSession !== savedSession) {
  await saveToEnv({ TG_SESSION: currentSession });
  console.log("Saved TG_SESSION token to .env for future runs.\n");
}

// 3. Iterate through all supergroups that have Topics (forum) enabled
const dialogs = await client.getDialogs({});
const forumGroups = dialogs.filter(
  (d) => d.entity instanceof Api.Channel && d.entity.megagroup && d.entity.forum
);

let foundAny = false;

for (const dialog of forumGroups) {
  const group = dialog.entity;

  // Fetch all active (non-closed) topics in this group
  const activeTopics = new Map();
  let offsetDate = 0;
  let offsetId = 0;
  let offsetTopic = 0;

  while (true) {
    const res = await client.invoke(
      new Api.channels.GetForumTopics({
        channel: group,
        q: "",
        offsetDate,
        offsetId,
        offsetTopic,
        limit: 100,
      })
    );

    const validTopics = res.topics.filter((t) => t instanceof Api.ForumTopic);
    for (const topic of validTopics) {
      if (!topic.closed) {
        activeTopics.set(topic.id, topic);
      }
    }

    if (res.topics.length < 100 || validTopics.length === 0) break;
    const last = validTopics[validTopics.length - 1];
    offsetDate = last.date;
    offsetId = last.topMessage;
    offsetTopic = last.id;
  }

  if (activeTopics.size === 0) continue;

  // Fetch messages mentioning you in this group (newest first)
  const mentions = await client.getMessages(group, {
    filter: new Api.InputMessagesFilterMyMentions(),
    limit: 100,
  });

  // Map each active topic ID to its most recent mention message ID
  const latestMentionByTopic = new Map();
  for (const msg of mentions) {
    const topicId = msg.replyTo?.forumTopic
      ? msg.replyTo.replyToTopId || msg.replyTo.replyToMsgId
      : 1;

    if (activeTopics.has(topicId) && !latestMentionByTopic.has(topicId)) {
      latestMentionByTopic.set(topicId, msg.id);
    }
  }

  if (latestMentionByTopic.size > 0) {
    foundAny = true;

    // Sort topics by creation date (newest first)
    const sortedTopics = [...latestMentionByTopic.entries()]
      .map(([topicId, latestMsgId]) => ({
        topic: activeTopics.get(topicId),
        latestMsgId,
      }))
      .sort((a, b) => b.topic.date - a.topic.date);

    // Build base URL for public (@username) vs. private (t.me/c/<id>) supergroups
    const username = group.username || group.usernames?.[0]?.username;
    const channelId = group.id.toString().replace(/^-100/, "");
    const baseUrl = username
      ? `https://t.me/${username}`
      : `https://t.me/c/${channelId}`;

    console.log(`\nGroup: ${group.title}`);
    for (const { topic, latestMsgId } of sortedTopics) {
      const createdDate = new Date(topic.date * 1000).toISOString().split("T")[0];
      const link =
        topic.id === 1
          ? `${baseUrl}/${latestMsgId}`
          : `${baseUrl}/${topic.id}/${latestMsgId}`;

      console.log(
        `  - ${topic.title} (created: ${createdDate}, unread mentions: ${topic.unreadMentionsCount})`
      );
      console.log(`    ${link}`);
    }
  }
}

if (!foundAny) {
  console.log("No mentions found in any active forum topics.");
}

await client.disconnect();
process.exit(0);
