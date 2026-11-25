import { TopicRepository } from "#domain/ports/TopicRepository.js";
import { sanitizeText } from "#presentation/tui/TextSanitizer.js";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  enforcePrivateFile,
  ensurePrivateDir,
} from "../security/FilePermissions.js";

export class SqliteTopicRepository extends TopicRepository {
  constructor({ dbPath, retentionMs, cryptoService }) {
    super();
    this.retentionMs = retentionMs;
    this.cryptoService = cryptoService;

    ensurePrivateDir(path.dirname(dbPath));
    this.db = new DatabaseSync(dbPath);
    enforcePrivateFile(dbPath);

    const cols = this.db.prepare(`PRAGMA table_info(hidden_topics)`).all();
    if (cols.some((c) => c.name === "chat_id" || c.name === "topic_id")) {
      this.db.exec(`DROP TABLE hidden_topics;`);
    }

    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS hidden_topics (
        topic_hash TEXT PRIMARY KEY,
        encrypted_payload TEXT NOT NULL,
        hide_mode TEXT NOT NULL,
        hide_until INTEGER,
        last_message_date_at_hide INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    enforcePrivateFile(`${dbPath}-wal`);
    enforcePrivateFile(`${dbPath}-shm`);

    this.getStmt = this.db.prepare(`
      SELECT
        topic_hash,
        encrypted_payload,
        hide_mode,
        hide_until,
        last_message_date_at_hide
      FROM hidden_topics
      WHERE topic_hash = ?
    `);

    this.upsertStmt = this.db.prepare(`
      INSERT INTO hidden_topics (
        topic_hash,
        encrypted_payload,
        hide_mode,
        hide_until,
        last_message_date_at_hide,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic_hash) DO UPDATE SET
        encrypted_payload = excluded.encrypted_payload,
        hide_mode = excluded.hide_mode,
        hide_until = excluded.hide_until,
        last_message_date_at_hide = excluded.last_message_date_at_hide,
        created_at = excluded.created_at
    `);

    this.deleteStmt = this.db.prepare(
      `DELETE FROM hidden_topics WHERE topic_hash = ?`,
    );

    this.purgeExpiredStmt = this.db.prepare(`
      DELETE FROM hidden_topics
      WHERE (hide_mode = 'snooze' AND hide_until IS NOT NULL AND hide_until <= ?)
         OR (hide_mode = 'forever' AND created_at <= ?)
    `);

    this.purgeExpired();
  }

  purgeExpired() {
    const now = Date.now();
    this.purgeExpiredStmt.run(now, now - this.retentionMs);
  }

  get(topicHash) {
    const row = this.getStmt.get(topicHash);
    if (!row) return null;

    const meta = JSON.parse(
      this.cryptoService.decryptField(row.encrypted_payload),
    );
    return {
      topicHash: row.topic_hash,
      chatId: meta.chatId,
      topicId: meta.topicId,
      topicName: meta.topicName,
      groupTitle: meta.groupTitle,
      hideMode: row.hide_mode,
      hideUntil: row.hide_until,
      lastMessageDateAtHide: row.last_message_date_at_hide,
    };
  }

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
    const payload = JSON.stringify({
      chatId: Number(chatId),
      topicId: Number(topicId),
      topicName: sanitizeText(topicName),
      groupTitle: sanitizeText(groupTitle),
    });

    this.upsertStmt.run(
      topicKey,
      this.cryptoService.encryptField(payload),
      hideMode,
      hideUntil,
      lastMessageDateAtHide,
      Date.now(),
    );
  }

  unhide(topicKey) {
    this.deleteStmt.run(topicKey);
  }

  close() {
    this.db.close();
  }
}
