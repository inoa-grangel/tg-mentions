#!/usr/bin/env node
import crypto from "node:crypto";
import dotenv from "dotenv";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import termkit from "terminal-kit";
import tdl from "tdl";
import { getTdjson } from "prebuilt-tdlib";

const { terminal: term } = termkit;

// Suppress Node's ExperimentalWarning for built-in node:sqlite
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const msg = typeof warning === "string" ? warning : warning?.message || "";
  if (msg.includes("SQLite is an experimental feature")) return;
  return originalEmitWarning.call(process, warning, ...args);
};

function getAppConfigDir() {
  if (process.env.TG_MENTIONS_HOME) {
    return path.resolve(process.env.TG_MENTIONS_HOME);
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "tg-mentions");
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "tg-mentions");
}

function ensurePrivateDir(dirPath) {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try {
      chmodSync(dirPath, 0o700);
    } catch {
      // Ignore if filesystem does not support POSIX permissions
    }
  }
}

function enforcePrivateFile(filePath) {
  if (process.platform !== "win32") {
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Ignore if filesystem does not support POSIX permissions
    }
  }
}

const CONFIG_DIR = getAppConfigDir();
ensurePrivateDir(CONFIG_DIR);

const ENV_PATH = path.join(CONFIG_DIR, ".env");
const DB_PATH = path.join(CONFIG_DIR, "tdlib-db");
const FILES_PATH = path.join(CONFIG_DIR, "tdlib-files");
const DATA_DIR = path.join(CONFIG_DIR, "data");
const SQLITE_PATH = path.join(DATA_DIR, "tg-mentions.sqlite");

ensurePrivateDir(DB_PATH);
ensurePrivateDir(FILES_PATH);
ensurePrivateDir(DATA_DIR);

const HIDE_MENU_OPTIONS = [
  { type: "forever", key: "1", label: "Hide forever" },
  { type: "until_message", key: "2", label: "Hide until it gets a new message" },
  { type: "snooze", key: "3", label: "Hide until new message or after a date..." },
];

const SNOOZE_PRESETS = [
  { key: "30m", label: "30 minutes", ms: 30 * 60 * 1000 },
  { key: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { key: "3h", label: "3 hours", ms: 3 * 60 * 60 * 1000 },
  { key: "1d", label: "Tomorrow (9:00 AM)", getUntil: () => getNextMorning(9) },
  { key: "3d", label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { key: "1w", label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
];

dotenv.config({ path: ENV_PATH, quiet: true });

/**
 * Strips C0/C1 control characters and ANSI escape sequences from untrusted Telegram strings.
 */
function sanitizeText(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, " ")
    .trim();
}

function parseAllowedChatIds(raw) {
  if (!raw || !raw.trim()) return null;
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
  return ids.length > 0 ? new Set(ids) : null;
}

function initTopicStore(dbPath) {
  ensurePrivateDir(path.dirname(dbPath));
  const db = new DatabaseSync(dbPath);
  enforcePrivateFile(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS hidden_topics (
      topic_key TEXT PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      topic_id INTEGER NOT NULL,
      topic_name TEXT NOT NULL,
      group_title TEXT NOT NULL,
      hide_mode TEXT NOT NULL,
      hide_until INTEGER,
      last_message_date_at_hide INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const legacyTables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('snoozed_topics', 'archived_topics')`
    )
    .all()
    .map((r) => r.name);

  if (legacyTables.includes("snoozed_topics")) {
    db.exec(`
      INSERT OR IGNORE INTO hidden_topics (
        topic_key, chat_id, topic_id, topic_name, group_title,
        hide_mode, hide_until, last_message_date_at_hide, created_at
      )
      SELECT
        topic_key, chat_id, topic_id, topic_name, group_title,
        'snooze', snooze_until, last_message_date_at_snooze, created_at
      FROM snoozed_topics;
      DROP TABLE snoozed_topics;
    `);
  }

  if (legacyTables.includes("archived_topics")) {
    db.exec(`
      INSERT OR IGNORE INTO hidden_topics (
        topic_key, chat_id, topic_id, topic_name, group_title,
        hide_mode, hide_until, last_message_date_at_hide, created_at
      )
      SELECT
        topic_key, chat_id, topic_id, topic_name, group_title,
        'forever', NULL, 0, archived_at
      FROM archived_topics;
      DROP TABLE archived_topics;
    `);
  }

  const getStmt = db.prepare(`
    SELECT
      topic_key,
      chat_id,
      topic_id,
      topic_name,
      group_title,
      hide_mode,
      hide_until,
      last_message_date_at_hide
    FROM hidden_topics
    WHERE topic_key = ?
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO hidden_topics (
      topic_key,
      chat_id,
      topic_id,
      topic_name,
      group_title,
      hide_mode,
      hide_until,
      last_message_date_at_hide,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(topic_key) DO UPDATE SET
      topic_name = excluded.topic_name,
      group_title = excluded.group_title,
      hide_mode = excluded.hide_mode,
      hide_until = excluded.hide_until,
      last_message_date_at_hide = excluded.last_message_date_at_hide,
      created_at = excluded.created_at
  `);

  const deleteStmt = db.prepare(`DELETE FROM hidden_topics WHERE topic_key = ?`);
  const purgeExpiredStmt = db.prepare(
    `DELETE FROM hidden_topics WHERE hide_mode = 'snooze' AND hide_until IS NOT NULL AND hide_until <= ?`
  );

  purgeExpiredStmt.run(Date.now());

  return {
    purgeExpired() {
      purgeExpiredStmt.run(Date.now());
    },
    get(topicKey) {
      return getStmt.get(topicKey) ?? null;
    },
    setHidden({
      topicKey,
      chatId,
      topicId,
      topicName,
      groupTitle,
      hideMode,
      hideUntil = null,
      lastMessageDateAtHide,
    }) {
      upsertStmt.run(
        topicKey,
        Number(chatId),
        Number(topicId),
        sanitizeText(topicName),
        sanitizeText(groupTitle),
        hideMode,
        hideUntil,
        lastMessageDateAtHide,
        Date.now()
      );
    },
    unhide(topicKey) {
      deleteStmt.run(topicKey);
    },
    close() {
      db.close();
    },
  };
}

function getNextMorning(hour) {
  const target = new Date();
  target.setDate(target.getDate() + 1);
  target.setHours(hour, 0, 0, 0);
  return target.getTime();
}

function parseDateOrDurationInput(raw) {
  const value = raw.trim();
  const lower = value.toLowerCase();

  const preset = SNOOZE_PRESETS.find((item) => item.key === lower);
  if (preset) {
    return preset.getUntil ? preset.getUntil() : Date.now() + preset.ms;
  }

  const relMatch = lower.match(/^(\d+)\s*(m|min|h|hr|d|w)$/);
  if (relMatch) {
    const amount = Number(relMatch[1]);
    const unit = relMatch[2];
    const multipliers = {
      m: 60 * 1000,
      min: 60 * 1000,
      h: 60 * 60 * 1000,
      hr: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    };
    return Date.now() + amount * multipliers[unit];
  }

  const timeMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hh = Number(timeMatch[1]);
    const mm = Number(timeMatch[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      const target = new Date();
      target.setHours(hh, mm, 0, 0);
      if (target.getTime() <= Date.now()) {
        target.setDate(target.getDate() + 1);
      }
      return target.getTime();
    }
  }

  const dateMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?$/);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const day = Number(dateMatch[3]);
    const hh = dateMatch[4] !== undefined ? Number(dateMatch[4]) : 9;
    const mm = dateMatch[5] !== undefined ? Number(dateMatch[5]) : 0;
    const target = new Date(year, month, day, hh, mm, 0, 0);
    if (!Number.isNaN(target.getTime()) && target.getTime() > Date.now()) {
      return target.getTime();
    }
  }

  return null;
}

function getTopicKey(chatId, topicId) {
  return `${chatId}:${topicId}`;
}

function evaluateHideState(row, currentLastMessageDate) {
  if (!row) return null;

  if (row.hide_mode === "forever") {
    return { mode: "forever", hideUntil: null };
  }

  if (currentLastMessageDate > row.last_message_date_at_hide) {
    return null;
  }

  if (row.hide_mode === "until_message") {
    return { mode: "until_message", hideUntil: null };
  }

  if (row.hide_mode === "snooze") {
    if (row.hide_until && Date.now() >= row.hide_until) {
      return null;
    }
    return { mode: "snooze", hideUntil: row.hide_until };
  }

  return null;
}

async function promptLine(label, { echo = true } = {}) {
  term(label);
  const value = await term.inputField({
    echo,
    cancelable: true,
  }).promise;
  term("\n");
  if (value === undefined) {
    term.processExit(0);
  }
  return value;
}

async function saveToEnv(updates) {
  let content = "";
  try {
    content = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    // .env does not exist yet
  }

  const lines = content ? content.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(updates)) {
    if (!/^[A-Z0-9_]+$/.test(key)) {
      throw new Error(`Invalid environment variable key: ${key}`);
    }
    const cleanValue = String(value)
      .replace(/[\r\n\0]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const formatted = `${key}="${cleanValue}"`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index !== -1) {
      lines[index] = formatted;
    } else {
      lines.push(formatted);
    }
  }

  const normalized = lines.filter((line, i) => line !== "" || i < lines.length - 1);
  await fs.writeFile(ENV_PATH, `${normalized.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  enforcePrivateFile(ENV_PATH);
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
  const safeUsername =
    typeof username === "string" && /^[a-zA-Z0-9_]{3,64}$/.test(username) ? username : null;
  const sgId = Number(supergroupId);
  const tId = Number(rawTopicId);
  const mId = Number(rawMsgId);

  if (!Number.isSafeInteger(sgId) || !Number.isSafeInteger(tId) || !Number.isSafeInteger(mId)) {
    throw new Error("Invalid numeric identifier in Telegram link");
  }

  if (useAppScheme) {
    if (safeUsername) {
      return tId === 1
        ? `tg://resolve?domain=${safeUsername}&post=${mId}`
        : `tg://resolve?domain=${safeUsername}&post=${mId}&thread=${tId}`;
    }
    return tId === 1
      ? `tg://privatepost?channel=${sgId}&post=${mId}`
      : `tg://privatepost?channel=${sgId}&post=${mId}&thread=${tId}`;
  }

  const baseUrl = safeUsername ? `https://t.me/${safeUsername}` : `https://t.me/c/${sgId}`;
  return tId === 1 ? `${baseUrl}/${mId}` : `${baseUrl}/${tId}/${mId}`;
}

function openUri(uri) {
  if (!/^(tg:\/\/|https:\/\/t\.me\/)[a-zA-Z0-9_/?=&-]+$/.test(uri)) {
    throw new Error("Blocked unexpected URI format");
  }

  let command;
  let args;

  if (process.platform === "win32") {
    command = "cmd.exe";
    args = ["/c", "start", "", uri];
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
    windowsHide: true,
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

function formatTimestamp(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function createNpmSpinner() {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let text = "Initializing...";
  let timer = null;

  const draw = () => {
    const cols = term.width || 80;
    const line = `${frames[frameIndex]} ${text}`.slice(0, cols - 1);
    term.column(1).eraseLine();
    term.cyan(line);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  return {
    start(initialText) {
      if (initialText) text = initialText;
      term.clear();
      term.hideCursor(true);
      draw();
      timer = setInterval(draw, 80);
    },
    update(nextText) {
      text = sanitizeText(nextText);
    },
    stop() {
      if (timer) clearInterval(timer);
      term.column(1).eraseLine();
      term.hideCursor(false);
    },
  };
}

function padOrTruncate(str, width) {
  if (width <= 0) return "";
  if (str.length > width) {
    return width > 1 ? `${str.slice(0, width - 1)}…` : str.slice(0, width);
  }
  return str.padEnd(width, " ");
}

/**
 * Fetches active mentioned forum topics from TDLib, constrained by allowedChatIds if configured.
 */
async function fetchMentionedTopics(
  client,
  topicStore,
  useAppScheme,
  allowedChatIds,
  onProgress
) {
  topicStore.purgeExpired();
  onProgress?.("Loading Telegram chats...");

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
    const chatId = chat_ids[i];
    if (allowedChatIds && !allowedChatIds.has(chatId)) continue;

    const chat = await client.invoke({ _: "getChat", chat_id: chatId });
    if (chat.type?._ !== "chatTypeSupergroup" || chat.type.is_channel) continue;

    const supergroup = await client.invoke({
      _: "getSupergroup",
      supergroup_id: chat.type.supergroup_id,
    });
    if (!supergroup.is_forum) continue;

    const safeGroupTitle = sanitizeText(chat.title) || `Group ${chat.id}`;
    onProgress?.(`Scanning ${safeGroupTitle}...`);

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

    const username = supergroup.usernames?.active_usernames?.[0];

    for (const [topicId, latestMention] of latestMentionByTopic) {
      try {
        const topic = await client.invoke({
          _: "getForumTopic",
          chat_id: chat.id,
          forum_topic_id: topicId,
        });

        if (topic.info.is_closed) continue;

        const safeTopicName = sanitizeText(topic.info.name) || `Topic ${topicId}`;
        const lastMessageDate =
          topic.last_message?.date ??
          latestMention.date ??
          topic.info.creation_date;

        const key = getTopicKey(chat.id, topicId);
        const hiddenRow = topicStore.get(key);
        const activeHide = evaluateHideState(hiddenRow, lastMessageDate);

        if (hiddenRow && !activeHide) {
          topicStore.unhide(key);
        }

        const rawMsgId = Math.floor(latestMention.id / 1048576);
        const rawTopicId = getRawTopicId(topic);

        const link = buildTopicLink({
          useAppScheme,
          username,
          supergroupId: supergroup.id,
          rawTopicId,
          rawMsgId,
        });

        results.push({
          key,
          chatId: chat.id,
          topicId,
          groupTitle: safeGroupTitle,
          topicName: safeTopicName,
          lastMessageDate,
          lastMsgFormatted: formatTimestamp(lastMessageDate),
          unreadCount: topic.unread_mention_count,
          hideMode: activeHide?.mode ?? null,
          hideUntil: activeHide?.hideUntil ?? null,
          link,
        });
      } catch {
        // Topic may have been deleted
      }
    }
  }

  results.sort((a, b) => b.lastMessageDate - a.lastMessageDate);
  return results;
}

/**
 * Full-screen Vim-style TUI powered by terminal-kit.
 */
function runVimTui(initialItems, topicStore, initialShowAll, onReload) {
  if (!process.stdin.isTTY) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let allItems = [...initialItems];
    let showHidden = initialShowAll;
    let isReloading = false;
    let mode = "NORMAL";
    let commandBuffer = "";
    let searchQuery = "";
    let pendingG = false;
    let cursor = 0;
    let scrollOffset = 0;
    let hideMenuCursor = 0;
    let snoozeCursor = 0;
    let statusMsg = "j/k: move • Enter: open • h: hide options • r: reload • a: show hidden";
    let statusIsError = false;

    const getVisibleItems = () => {
      const q = searchQuery.trim().toLowerCase();
      return allItems.filter((item) => {
        if (!showHidden && item.hideMode !== null) return false;
        if (!q) return true;
        return (
          item.topicName.toLowerCase().includes(q) ||
          item.groupTitle.toLowerCase().includes(q)
        );
      });
    };

    const setStatus = (msg, isError = false) => {
      statusMsg = sanitizeText(msg);
      statusIsError = isError;
    };

    const render = () => {
      const cols = Math.max(40, term.width || 80);
      const rows = Math.max(12, term.height || 24);
      const visible = getVisibleItems();

      if (cursor >= visible.length) {
        cursor = Math.max(0, visible.length - 1);
      }

      const viewportHeight = Math.max(3, rows - 3);
      if (cursor < scrollOffset) scrollOffset = cursor;
      if (cursor >= scrollOffset + viewportHeight) {
        scrollOffset = cursor - viewportHeight + 1;
      }

      term.hideCursor(true);
      term.moveTo(1, 1);

      const filterBadge = searchQuery ? ` [/${searchQuery}]` : "";
      const hiddenBadge = showHidden ? " [+hidden]" : "";
      const reloadBadge = isReloading ? " [reloading...]" : "";
      const headerText = ` tg-mentions (${visible.length}/${allItems.length})${filterBadge}${hiddenBadge}${reloadBadge}`;
      term.bgWhite.black.bold(padOrTruncate(headerText, cols));
      term.styleReset();

      if (mode === "HIDE_MENU" && visible[cursor]) {
        const target = visible[cursor];
        const menuRows = [
          {
            type: "title",
            text: padOrTruncate(`  Hide: ${target.topicName}`, cols),
          },
          {
            type: "sub",
            text: padOrTruncate(`  Group: ${target.groupTitle}`, cols),
          },
          { type: "blank", text: "" },
          ...HIDE_MENU_OPTIONS.map((opt, i) => ({
            type: "option",
            active: i === hideMenuCursor,
            text: `[${opt.key}] ${opt.label}`,
          })),
          { type: "blank", text: "" },
          {
            type: "sub",
            text: padOrTruncate(
              "  Shortcuts: d = forever • m = until new message • s = until message or date",
              cols
            ),
          },
        ];

        for (let r = 0; r < viewportHeight; r++) {
          term.moveTo(1, 2 + r).eraseLine();
          const row = menuRows[r];
          if (!row) {
            term.blue("~");
          } else if (row.type === "title") {
            term.yellow.bold(row.text);
          } else if (row.type === "sub") {
            term.dim(row.text);
          } else if (row.type === "option") {
            const caret = row.active ? "> " : "  ";
            const body = padOrTruncate(row.text, cols - 2);
            if (row.active) {
              term.yellow.bold(caret);
              term.bgYellow.black.bold(body);
            } else {
              term(caret);
              term(body);
            }
          }
          term.styleReset();
        }
      } else if (mode === "SNOOZE_DATE" && visible[cursor]) {
        const target = visible[cursor];
        const snoozeRows = [
          {
            type: "title",
            text: padOrTruncate(`  Hide until new message or date: ${target.topicName}`, cols),
          },
          {
            type: "sub",
            text: padOrTruncate(
              "  Wakes early if a new message arrives, or once the selected date/time passes",
              cols
            ),
          },
          { type: "blank", text: "" },
          ...SNOOZE_PRESETS.map((p, i) => ({
            type: "preset",
            active: i === snoozeCursor,
            text: `[${p.key.padEnd(3)}] ${p.label}`,
          })),
          { type: "blank", text: "" },
          {
            type: "sub",
            text: padOrTruncate(
              "  Or type :snooze 2026-11-30 09:00 | :snooze 18:30 | :snooze 45m",
              cols
            ),
          },
        ];

        for (let r = 0; r < viewportHeight; r++) {
          term.moveTo(1, 2 + r).eraseLine();
          const row = snoozeRows[r];
          if (!row) {
            term.blue("~");
          } else if (row.type === "title") {
            term.yellow.bold(row.text);
          } else if (row.type === "sub") {
            term.dim(row.text);
          } else if (row.type === "preset") {
            const caret = row.active ? "> " : "  ";
            const body = padOrTruncate(row.text, cols - 2);
            if (row.active) {
              term.yellow.bold(caret);
              term.bgYellow.black.bold(body);
            } else {
              term(caret);
              term(body);
            }
          }
          term.styleReset();
        }
      } else {
        for (let r = 0; r < viewportHeight; r++) {
          term.moveTo(1, 2 + r).eraseLine();
          const idx = scrollOffset + r;

          if (idx >= visible.length) {
            if (visible.length === 0 && r === 0) {
              term.dim(
                padOrTruncate(
                  "  No topics match current view. Press 'a' to show hidden, 'r' to reload, or Esc to clear filter.",
                  cols
                )
              );
            } else {
              term.blue("~");
            }
            term.styleReset();
            continue;
          }

          const item = visible[idx];
          const selected = idx === cursor;
          let stateTag = "";
          if (item.hideMode === "forever") stateTag = " [forever]";
          else if (item.hideMode === "until_message") stateTag = " [until-msg]";
          else if (item.hideMode === "snooze") stateTag = " [zzz]";

          const unreadTag = item.unreadCount > 0 ? ` (${item.unreadCount} unread)` : "";
          const rightMeta = ` ${item.groupTitle} │ ${item.lastMsgFormatted}${unreadTag}${stateTag}`;
          const maxTitleWidth = Math.max(12, cols - 2 - rightMeta.length);
          const leftTitle = padOrTruncate(item.topicName, maxTitleWidth);
          const paddedMeta = padOrTruncate(rightMeta, cols - 2 - leftTitle.length);

          if (selected) {
            term.cyan.bold("> ");
            term.cyan.bold(leftTitle);
            term.cyan(paddedMeta);
          } else if (item.hideMode !== null) {
            term("  ");
            term.dim(leftTitle + paddedMeta);
          } else {
            term("  ");
            term(leftTitle);
            term.dim(paddedMeta);
          }
          term.styleReset();
        }
      }

      term.moveTo(1, rows - 1).eraseLine();
      const badgeText =
        mode === "HIDE_MENU"
          ? " HIDE "
          : mode === "SNOOZE_DATE"
            ? " SNOOZE "
            : ` ${mode} `;
      if (mode === "NORMAL") term.bgCyan.black.bold(badgeText);
      else if (mode === "SEARCH") term.bgMagenta.black.bold(badgeText);
      else term.bgYellow.black.bold(badgeText);
      term.styleReset();

      const posLabel =
        visible.length > 0 ? ` ${cursor + 1}/${visible.length} ` : " 0/0 ";
      const middleWidth = Math.max(0, cols - badgeText.length - posLabel.length);
      const middleText = padOrTruncate(` ${statusMsg}`, middleWidth);

      if (statusIsError) {
        term.bgBlack.red(middleText);
      } else {
        term.bgBlack.white(middleText);
      }
      term.styleReset();
      term.bgWhite.black.bold(posLabel);
      term.styleReset();

      term.moveTo(1, rows).eraseLine();
      if (mode === "COMMAND") {
        term(`:${commandBuffer}`);
        term.moveTo(Math.min(cols, commandBuffer.length + 2), rows);
        term.hideCursor(false);
      } else if (mode === "SEARCH") {
        term(`/${commandBuffer}`);
        term.moveTo(Math.min(cols, commandBuffer.length + 2), rows);
        term.hideCursor(false);
      } else if (mode === "HIDE_MENU") {
        term.dim("1-3 or ↑/↓: choose hide option • Enter: confirm • Esc: cancel");
        term.styleReset();
      } else if (mode === "SNOOZE_DATE") {
        term.dim("↑/↓ or j/k: select date/duration • Enter: confirm • Esc: cancel");
        term.styleReset();
      } else {
        term.dim("h: hide menu • d: forever • m: until msg • s: msg/date • u: unhide • r: reload");
        term.styleReset();
      }
    };

    const cleanup = () => {
      term.removeListener("key", onKey);
      term.removeListener("resize", render);
      term.grabInput(false);
      term.hideCursor(false);
      term.alternateScreenBuffer(false);
      resolve();
    };

    const applyHide = (target, hideMode, hideUntil = null) => {
      topicStore.setHidden({
        topicKey: target.key,
        chatId: target.chatId,
        topicId: target.topicId,
        topicName: target.topicName,
        groupTitle: target.groupTitle,
        hideMode,
        hideUntil,
        lastMessageDateAtHide: target.lastMessageDate,
      });
      target.hideMode = hideMode;
      target.hideUntil = hideUntil;

      if (hideMode === "forever") {
        setStatus(`Hidden forever: "${target.topicName}"`);
      } else if (hideMode === "until_message") {
        setStatus(`Hidden until new message: "${target.topicName}"`);
      } else if (hideMode === "snooze" && hideUntil) {
        const untilStr = formatTimestamp(Math.floor(hideUntil / 1000));
        setStatus(`Hidden until new message or ${untilStr}: "${target.topicName}"`);
      }
    };

    const triggerReload = async () => {
      if (isReloading) return;
      isReloading = true;
      const previousKey = getVisibleItems()[cursor]?.key;
      setStatus("Reloading topics from Telegram...");
      render();

      try {
        const refreshed = await onReload((progressText) => {
          setStatus(progressText);
          render();
        });
        allItems = refreshed;

        const nextVisible = getVisibleItems();
        if (previousKey) {
          const keptIdx = nextVisible.findIndex((item) => item.key === previousKey);
          cursor = keptIdx !== -1 ? keptIdx : 0;
        } else {
          cursor = 0;
        }
        scrollOffset = 0;

        const activeCount = allItems.filter((i) => i.hideMode === null).length;
        const timeStr = formatTimestamp(Math.floor(Date.now() / 1000)).split(" ")[1];
        setStatus(`Reloaded at ${timeStr} (${activeCount} active)`);
      } catch (err) {
        setStatus(`Reload failed: ${err?.message || err}`, true);
      } finally {
        isReloading = false;
        render();
      }
    };

    const executeCommand = async (rawCmd) => {
      const trimmed = rawCmd.trim();
      const [cmd, ...args] = trimmed.split(/\s+/);
      const argStr = args.join(" ");
      const visible = getVisibleItems();
      const current = visible[cursor];

      switch (cmd) {
        case "":
          break;
        case "q":
        case "quit":
        case "exit":
          cleanup();
          return;
        case "r":
        case "reload":
        case "refresh":
          mode = "NORMAL";
          await triggerReload();
          return;
        case "o":
        case "open":
          if (!current) {
            setStatus("No topic selected", true);
          } else {
            openUri(current.link);
            setStatus(`Opened: ${current.topicName}`);
          }
          break;
        case "h":
        case "hide":
          if (!current) {
            setStatus("No topic selected", true);
          } else if (!argStr) {
            hideMenuCursor = 0;
            mode = "HIDE_MENU";
            render();
            return;
          } else if (argStr === "forever" || argStr === "1") {
            applyHide(current, "forever");
          } else if (argStr === "msg" || argStr === "message" || argStr === "2") {
            applyHide(current, "until_message");
          } else {
            const until = parseDateOrDurationInput(argStr);
            if (!until) {
              setStatus(
                `Invalid option "${argStr}" (use forever, msg, 1h, 18:30, or 2026-11-30)`,
                true
              );
            } else {
              applyHide(current, "snooze", until);
            }
          }
          break;
        case "d":
        case "archive":
          if (!current) {
            setStatus("No topic selected", true);
          } else {
            applyHide(current, "forever");
          }
          break;
        case "m":
          if (!current) {
            setStatus("No topic selected", true);
          } else {
            applyHide(current, "until_message");
          }
          break;
        case "s":
        case "snooze":
          if (!current) {
            setStatus("No topic selected", true);
          } else if (!argStr) {
            snoozeCursor = 0;
            mode = "SNOOZE_DATE";
            render();
            return;
          } else {
            const until = parseDateOrDurationInput(argStr);
            if (!until) {
              setStatus(
                `Invalid date/duration "${argStr}" (try 30m, 2h, 18:30, 2026-11-30 09:00)`,
                true
              );
            } else {
              applyHide(current, "snooze", until);
            }
          }
          break;
        case "u":
        case "unhide":
        case "unsnooze":
        case "unarchive":
          if (!current || current.hideMode === null) {
            setStatus("Selected topic is not hidden", true);
          } else {
            topicStore.unhide(current.key);
            current.hideMode = null;
            current.hideUntil = null;
            setStatus(`Unhidden: ${current.topicName}`);
          }
          break;
        case "a":
        case "all":
          showHidden = !showHidden;
          setStatus(showHidden ? "Showing hidden topics" : "Hiding hidden topics");
          break;
        case "clear":
          searchQuery = "";
          setStatus("Filter cleared");
          break;
        case "help":
          setStatus(":hide [forever|msg|1h|2026-11-30] | :unhide | :all | :reload | :q");
          break;
        default:
          if (/^\d+$/.test(cmd)) {
            const targetIdx = Number(cmd) - 1;
            if (targetIdx >= 0 && targetIdx < visible.length) {
              cursor = targetIdx;
              setStatus(`Jumped to line ${cmd}`);
            } else {
              setStatus(`Line ${cmd} out of range`, true);
            }
          } else {
            setStatus(`Unknown command: :${cmd}`, true);
          }
      }

      mode = "NORMAL";
      render();
    };

    const onKey = async (name, matches, data) => {
      if (name === "CTRL_C") {
        cleanup();
        return;
      }

      if (isReloading) return;

      if (mode === "COMMAND" || mode === "SEARCH") {
        if (name === "ESCAPE") {
          if (mode === "SEARCH") searchQuery = "";
          commandBuffer = "";
          mode = "NORMAL";
          render();
          return;
        }
        if (name === "ENTER" || name === "KP_ENTER") {
          const entered = commandBuffer;
          commandBuffer = "";
          if (mode === "SEARCH") {
            searchQuery = entered;
            cursor = 0;
            scrollOffset = 0;
            mode = "NORMAL";
            setStatus(entered ? `Filter: /${entered}` : "Filter cleared");
            render();
          } else {
            await executeCommand(entered);
          }
          return;
        }
        if (name === "BACKSPACE") {
          if (commandBuffer.length === 0) {
            mode = "NORMAL";
          } else {
            commandBuffer = commandBuffer.slice(0, -1);
            if (mode === "SEARCH") {
              searchQuery = commandBuffer;
              cursor = 0;
              scrollOffset = 0;
            }
          }
          render();
          return;
        }
        if (data?.isCharacter && name.length === 1) {
          commandBuffer += name;
          if (mode === "SEARCH") {
            searchQuery = commandBuffer;
            cursor = 0;
            scrollOffset = 0;
          }
          render();
        }
        return;
      }

      if (mode === "HIDE_MENU") {
        const visible = getVisibleItems();
        const target = visible[cursor];

        const selectHideOption = (optionIndex) => {
          const opt = HIDE_MENU_OPTIONS[optionIndex];
          if (!opt || !target) {
            mode = "NORMAL";
            render();
            return;
          }

          if (opt.type === "forever") {
            applyHide(target, "forever");
            mode = "NORMAL";
            render();
          } else if (opt.type === "until_message") {
            applyHide(target, "until_message");
            mode = "NORMAL";
            render();
          } else if (opt.type === "snooze") {
            snoozeCursor = 0;
            mode = "SNOOZE_DATE";
            render();
          }
        };

        if (name === "UP" || name === "k") {
          hideMenuCursor =
            (hideMenuCursor - 1 + HIDE_MENU_OPTIONS.length) % HIDE_MENU_OPTIONS.length;
          render();
        } else if (name === "DOWN" || name === "j") {
          hideMenuCursor = (hideMenuCursor + 1) % HIDE_MENU_OPTIONS.length;
          render();
        } else if (name === "1" || name === "2" || name === "3") {
          selectHideOption(Number(name) - 1);
        } else if (name === "ENTER" || name === "KP_ENTER") {
          selectHideOption(hideMenuCursor);
        } else if (name === "ESCAPE" || name === "q") {
          mode = "NORMAL";
          setStatus("Cancelled");
          render();
        }
        return;
      }

      if (mode === "SNOOZE_DATE") {
        if (name === "UP" || name === "k") {
          snoozeCursor = (snoozeCursor - 1 + SNOOZE_PRESETS.length) % SNOOZE_PRESETS.length;
          render();
        } else if (name === "DOWN" || name === "j") {
          snoozeCursor = (snoozeCursor + 1) % SNOOZE_PRESETS.length;
          render();
        } else if (name === "ESCAPE" || name === "q") {
          mode = "NORMAL";
          setStatus("Cancelled");
          render();
        } else if (name === "ENTER" || name === "KP_ENTER") {
          const visible = getVisibleItems();
          const target = visible[cursor];
          const preset = SNOOZE_PRESETS[snoozeCursor];
          const until = preset.getUntil ? preset.getUntil() : Date.now() + preset.ms;
          if (target) {
            applyHide(target, "snooze", until);
          }
          mode = "NORMAL";
          render();
        }
        return;
      }

      const visible = getVisibleItems();

      if (name === "g") {
        if (pendingG) {
          cursor = 0;
          pendingG = false;
          render();
        } else {
          pendingG = true;
        }
        return;
      }
      pendingG = false;

      if (name === "G") {
        cursor = Math.max(0, visible.length - 1);
        render();
      } else if (name === "UP" || name === "k") {
        if (visible.length > 0) {
          cursor = (cursor - 1 + visible.length) % visible.length;
          render();
        }
      } else if (name === "DOWN" || name === "j") {
        if (visible.length > 0) {
          cursor = (cursor + 1) % visible.length;
          render();
        }
      } else if (name === "ENTER" || name === "KP_ENTER" || name === "o") {
        const chosen = visible[cursor];
        if (chosen) {
          openUri(chosen.link);
          setStatus(`Opened: ${chosen.topicName}`);
          render();
        }
      } else if (name === "r") {
        await triggerReload();
      } else if (name === "h") {
        if (visible[cursor]) {
          hideMenuCursor = 0;
          mode = "HIDE_MENU";
          render();
        }
      } else if (name === "d") {
        const target = visible[cursor];
        if (target) {
          applyHide(target, "forever");
          render();
        }
      } else if (name === "m") {
        const target = visible[cursor];
        if (target) {
          applyHide(target, "until_message");
          render();
        }
      } else if (name === "s") {
        if (visible[cursor]) {
          snoozeCursor = 0;
          mode = "SNOOZE_DATE";
          render();
        }
      } else if (name === "u") {
        const target = visible[cursor];
        if (target && target.hideMode !== null) {
          topicStore.unhide(target.key);
          target.hideMode = null;
          target.hideUntil = null;
          setStatus(`Unhidden: ${target.topicName}`);
          render();
        }
      } else if (name === "a") {
        showHidden = !showHidden;
        setStatus(showHidden ? "Showing hidden topics" : "Hiding hidden topics");
        render();
      } else if (name === ":") {
        mode = "COMMAND";
        commandBuffer = "";
        render();
      } else if (name === "/") {
        mode = "SEARCH";
        commandBuffer = searchQuery;
        render();
      } else if (name === "ESCAPE") {
        if (searchQuery) {
          searchQuery = "";
          setStatus("Filter cleared");
          render();
        }
      } else if (name === "q") {
        cleanup();
      }
    };

    term.alternateScreenBuffer(true);
    term.grabInput(true);
    term.on("key", onKey);
    term.on("resize", render);
    render();
  });
}

const topicStore = initTopicStore(SQLITE_PATH);

// 1. Load or prompt for Telegram API credentials & DB encryption key
let apiId = Number(process.env.TG_API_ID);
let apiHash = process.env.TG_API_HASH?.trim();
let dbEncryptionKeyHex = process.env.TG_DB_ENCRYPTION_KEY?.trim();
const allowedChatIds = parseAllowedChatIds(process.env.TG_ALLOWED_CHAT_IDS);

const envUpdates = {};

if (!apiId || !apiHash) {
  term.bold(`Telegram API credentials not found in ${ENV_PATH}.\n`);
  term("Get them at https://my.telegram.org -> API development tools\n\n");

  if (!apiId) {
    apiId = Number((await promptLine("Enter your TG_API_ID: ")).trim());
    envUpdates.TG_API_ID = apiId;
  }
  if (!apiHash) {
    apiHash = (await promptLine("Enter your TG_API_HASH: ")).trim();
    envUpdates.TG_API_HASH = apiHash;
  }
}

if (!dbEncryptionKeyHex || !/^[0-9a-fA-F]{64}$/.test(dbEncryptionKeyHex)) {
  dbEncryptionKeyHex = crypto.randomBytes(32).toString("hex");
  envUpdates.TG_DB_ENCRYPTION_KEY = dbEncryptionKeyHex;
}

if (Object.keys(envUpdates).length > 0) {
  await saveToEnv(envUpdates);
  term.green(`Saved configuration securely to ${ENV_PATH}\n\n`);
}

const databaseEncryptionKey = Buffer.from(dbEncryptionKeyHex, "hex").toString("base64");

// 2. Initialize TDLib with encrypted local database & C++ debug logs silenced
tdl.configure({
  tdjson: getTdjson(),
  verbosityLevel: 0,
});

const client = tdl.createClient({
  apiId,
  apiHash,
  databaseDirectory: DB_PATH,
  filesDirectory: FILES_PATH,
  databaseEncryptionKey,
});

client.on("error", (err) => {
  term.red(`TDLib error: ${sanitizeText(err.message || String(err))}\n`);
});

await client.login({
  async getPhoneNumber(retry) {
    if (retry) term.yellow("Invalid phone number, please try again.\n");
    return await promptLine("Phone number (with country code, e.g. +5522999999999): ");
  },
  async getAuthCode(retry) {
    if (retry) term.yellow("Invalid code, please try again.\n");
    return await promptLine("Login code sent to your Telegram app: ");
  },
  async getPassword(passwordHint, retry) {
    if (retry) term.yellow("Invalid 2FA password, please try again.\n");
    const hint = passwordHint ? ` (hint: ${sanitizeText(passwordHint)})` : "";
    return await promptLine(`2FA password${hint}: `, { echo: false });
  },
  async getName() {
    return { firstName: "User", lastName: "" };
  },
});

const spinner = createNpmSpinner();
spinner.start("Loading Telegram chats...");

const useAppScheme = isTelegramDesktopInstalled();
const showHiddenOnStart = process.argv.includes("--all");

let allResults;
try {
  allResults = await fetchMentionedTopics(
    client,
    topicStore,
    useAppScheme,
    allowedChatIds,
    (msg) => spinner.update(msg)
  );
} catch (err) {
  spinner.stop();
  topicStore.close();
  throw err;
}

spinner.stop();

if (allResults.length === 0) {
  term("No active mentioned topics found.\n");
  topicStore.close();
  await client.close();
  process.exit(0);
}

if (process.argv.includes("--open")) {
  const first = allResults.find((r) => r.hideMode === null) ?? allResults[0];
  term(`Opening ${first.topicName}...\n`);
  openUri(first.link);
} else {
  await runVimTui(
    allResults,
    topicStore,
    showHiddenOnStart,
    (onProgress) =>
      fetchMentionedTopics(client, topicStore, useAppScheme, allowedChatIds, onProgress)
  );
}

topicStore.close();
await client.close();
process.exit(0);
