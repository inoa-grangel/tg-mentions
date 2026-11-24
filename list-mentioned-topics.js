#!/usr/bin/env node
import dotenv from "dotenv";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import readline from "node:readline";
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

function isTelegramDesktopInstalled() {
  if (process.argv.includes("--web")) return false;

  try {
    if (process.platform === "win32") {
      const registryChecks = [
        ["query", "HKEY_CLASSES_ROOT\\tg", "/v", "URL Protocol"],
        [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\tg\\UserChoice",
        ],
        [
          "query",
          "HKEY_CLASSES_ROOT\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\PackageRepository\\Extensions\\windows.protocol\\tg",
        ],
      ];

      return registryChecks.some((args) => {
        try {
          execFileSync("reg", args, { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      });
    }

    if (process.platform === "darwin") {
      const out = execFileSync(
        "defaults",
        ["read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      return out.includes("LSHandlerURLScheme = tg;");
    }

    const handler = execFileSync("xdg-mime", ["query", "default", "x-scheme-handler/tg"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return handler.length > 0;
  } catch {
    return false;
  }
}

function buildTopicLink({ useAppScheme, username, supergroupId, rawTopicId, rawMsgId }) {
  if (useAppScheme) {
    if (username) {
      return rawTopicId === 1
        ? `tg://resolve?domain=${username}&post=${rawMsgId}`
        : `tg://resolve?domain=${username}&post=${rawMsgId}&thread=${rawTopicId}`;
    }
    return rawTopicId === 1
      ? `tg://privatepost?channel=${supergroupId}&post=${rawMsgId}`
      : `tg://privatepost?channel=${supergroupId}&post=${rawMsgId}&thread=${rawTopicId}`;
  }

  const baseUrl = username
    ? `https://t.me/${username}`
    : `https://t.me/c/${supergroupId}`;

  return rawTopicId === 1
    ? `${baseUrl}/${rawMsgId}`
    : `${baseUrl}/${rawTopicId}/${rawMsgId}`;
}

function openUri(uri) {
  let command;
  let args;

  if (process.platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", uri];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [uri];
  } else {
    command = "xdg-open";
    args = [uri];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

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

function terminalLink(uri, label = uri) {
  return `\x1b]8;;${uri}\x1b\\${label}\x1b]8;;\x1b\\`;
}

function formatTimestamp(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Interactive arrow-key menu to open selected topics directly without exiting.
 */
function runInteractiveSelector(items) {
  if (!process.stdin.isTTY || items.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let cursor = 0;
    let statusMessage = "";
    let renderedLines = 0;

    const maxVisible = Math.min(
      items.length,
      Math.max(5, (process.stdout.rows || 24) - 6)
    );

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write("\x1b[?25l"); // Hide cursor

    const render = () => {
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A\x1b[J`);
      }

      const half = Math.floor(maxVisible / 2);
      let start = Math.max(0, cursor - half);
      if (start + maxVisible > items.length) {
        start = Math.max(0, items.length - maxVisible);
      }
      const end = Math.min(items.length, start + maxVisible);

      const lines = [
        "\x1b[2mUse ↑/↓ to navigate, Enter to open, q or Esc to quit:\x1b[0m",
      ];

      if (start > 0) {
        lines.push(`  \x1b[2m↑ ${start} more above\x1b[0m`);
      }

      for (let i = start; i < end; i++) {
        const item = items[i];
        const selected = i === cursor;
        const pointer = selected ? "\x1b[36m❯\x1b[0m" : " ";
        const title = selected
          ? `\x1b[1;36m${item.topicName}\x1b[0m`
          : item.topicName;
        const meta = `\x1b[2m[${item.groupTitle} • ${item.lastMsgFormatted} • unread: ${item.unreadCount}]\x1b[0m`;
        lines.push(`${pointer} ${title} ${meta}`);
      }

      if (end < items.length) {
        lines.push(`  \x1b[2m↓ ${items.length - end} more below\x1b[0m`);
      }

      if (statusMessage) {
        lines.push(`\x1b[32m${statusMessage}\x1b[0m`);
      }

      const output = `${lines.join("\n")}\n`;
      renderedLines = lines.length;
      process.stdout.write(output);
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.stdout.write("\x1b[?25h"); // Restore cursor
      resolve();
    };

    const onKeypress = (_str, key) => {
      if (!key) return;

      if (key.ctrl && key.name === "c") {
        cleanup();
        return;
      }

      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
      } else if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % items.length;
        render();
      } else if (key.name === "return" || key.name === "enter") {
        const chosen = items[cursor];
        openUri(chosen.link);
        statusMessage = `✓ Opened: ${chosen.topicName} (${chosen.groupTitle})`;
        render();
      } else if (key.name === "escape" || key.name === "q") {
        cleanup();
      }
    };

    process.stdin.on("keypress", onKeypress);
    console.log("");
    render();
  });
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

const useAppScheme = isTelegramDesktopInstalled();

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

const results = [];

for (let i = 0; i < chat_ids.length; i++) {
  const chat = await client.invoke({ _: "getChat", chat_id: chat_ids[i] });
  if (chat.type?._ !== "chatTypeSupergroup" || chat.type.is_channel) continue;

  const supergroup = await client.invoke({
    _: "getSupergroup",
    supergroup_id: chat.type.supergroup_id,
  });
  if (!supergroup.is_forum) continue;

  process.stderr.write(`\r\x1b[KScanning forum: ${chat.title}...`);

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

  const latestMentionByTopic = new Map();
  for (const msg of mentionRes.messages) {
    const topicId = getMessageTopicId(msg);
    if (topicId && !latestMentionByTopic.has(topicId)) {
      latestMentionByTopic.set(topicId, { id: msg.id, date: msg.date });
    }
  }

  if (latestMentionByTopic.size === 0) continue;

  const activeMentionedTopics = [];
  for (const [topicId, latestMention] of latestMentionByTopic) {
    try {
      const topic = await client.invoke({
        _: "getForumTopic",
        chat_id: chat.id,
        forum_topic_id: topicId,
      });
      if (!topic.info.is_closed) {
        const lastMessageDate =
          topic.last_message?.date ??
          latestMention.date ??
          topic.info.creation_date;

        activeMentionedTopics.push({
          topic,
          latestMsgId: latestMention.id,
          lastMessageDate,
        });
      }
    } catch {
      // Topic may have been deleted
    }
  }

  if (activeMentionedTopics.length > 0) {
    process.stderr.write("\r\x1b[K");

    // Sort per-group output by last message date (newest first)
    activeMentionedTopics.sort((a, b) => b.lastMessageDate - a.lastMessageDate);

    const username = supergroup.usernames?.active_usernames?.[0];

    console.log(`\nGroup: ${chat.title}`);
    for (const { topic, latestMsgId, lastMessageDate } of activeMentionedTopics) {
      const lastMsgFormatted = formatTimestamp(lastMessageDate);
      const rawMsgId = Math.floor(latestMsgId / 1048576);
      const rawTopicId = getRawTopicId(topic);

      const link = buildTopicLink({
        useAppScheme,
        username,
        supergroupId: supergroup.id,
        rawTopicId,
        rawMsgId,
      });

      results.push({
        groupTitle: chat.title,
        topicName: topic.info.name,
        lastMessageDate,
        lastMsgFormatted,
        unreadCount: topic.unread_mention_count,
        link,
      });

      console.log(
        `  - ${topic.info.name} (last msg: ${lastMsgFormatted}, unread mentions: ${topic.unread_mention_count})`
      );
      console.log(`    ${terminalLink(link)}`);
    }
  }
}

process.stderr.write("\r\x1b[K");

if (results.length === 0) {
  console.log("No mentions found in any active forum topics.");
  await client.close();
  process.exit(0);
}

// Sort the unified navigation options across all groups (newest first, oldest at the bottom)
results.sort((a, b) => b.lastMessageDate - a.lastMessageDate);

// 4. Open immediately with --open, or launch arrow-key selector
if (process.argv.includes("--open")) {
  const first = results[0];
  console.log(`\nOpening ${first.topicName}...`);
  openUri(first.link);
} else {
  await runInteractiveSelector(results);
}

await client.close();
process.exit(0);
