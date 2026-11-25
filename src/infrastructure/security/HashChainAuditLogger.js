import { AuditLogger } from "#domain/ports/AuditLogger.js";
import fs from "node:fs/promises";
import os from "node:os";
import { enforcePrivateFile } from "./FilePermissions.js";

const MAX_AUDIT_BYTES = 5 * 1024 * 1024; // 5 MB rotation cap

export class HashChainAuditLogger extends AuditLogger {
  constructor({ auditLogPath, retentionMs, cryptoService }) {
    super();
    this.auditLogPath = auditLogPath;
    this.retentionMs = retentionMs;
    this.cryptoService = cryptoService;
    this.lastChainHash = "0".repeat(64);
    this.failureNotified = false;
  }

  async init() {
    try {
      const raw = await fs.readFile(this.auditLogPath, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      if (lines.length > 0) {
        const lastParsed = JSON.parse(lines[lines.length - 1]);
        if (
          typeof lastParsed.hmac === "string" &&
          /^[0-9a-f]{64}$/.test(lastParsed.hmac)
        ) {
          this.lastChainHash = lastParsed.hmac;
        }
      }
    } catch {
      // Audit file does not exist yet
    }
  }

  async _rotateIfNeeded() {
    try {
      const stat = await fs.stat(this.auditLogPath);
      if (stat.size < MAX_AUDIT_BYTES) return;

      const raw = await fs.readFile(this.auditLogPath, "utf8");
      const cutoff = Date.now() - this.retentionMs;
      const kept = raw
        .split("\n")
        .filter(Boolean)
        .filter((line) => {
          try {
            const parsed = JSON.parse(line);
            return Date.parse(parsed.ts) >= cutoff;
          } catch {
            return false;
          }
        })
        .slice(-2000);

      const tmpAuditPath = `${this.auditLogPath}.${process.pid}.tmp`;
      await fs.writeFile(
        tmpAuditPath,
        kept.length ? `${kept.join("\n")}\n` : "",
        { encoding: "utf8", mode: 0o600 },
      );
      enforcePrivateFile(tmpAuditPath);
      await fs.rename(tmpAuditPath, this.auditLogPath);
      enforcePrivateFile(this.auditLogPath);
    } catch {
      // Audit file does not exist yet or concurrent rotation occurred
    }
  }

  async log(action, details = {}, onError = null) {
    try {
      await this._rotateIfNeeded();
      const safeDetails = { ...details };
      if ("topicKey" in safeDetails) {
        safeDetails.topicHash = this.cryptoService.redactAuditIdentifier(
          safeDetails.topicKey,
        );
        delete safeDetails.topicKey;
      }
      if ("uri" in safeDetails) {
        safeDetails.uriHash = this.cryptoService.redactAuditIdentifier(
          safeDetails.uri,
        );
        delete safeDetails.uri;
      }

      const payloadObj = {
        ts: new Date().toISOString(),
        user: os.userInfo().username,
        pid: process.pid,
        action,
        prevHash: this.lastChainHash,
        ...safeDetails,
      };
      const canonicalPayload = JSON.stringify(payloadObj);
      const entryHmac = this.cryptoService.signAuditPayload(canonicalPayload);

      const entry = JSON.stringify({
        ...payloadObj,
        hmac: entryHmac,
      });
      await fs.appendFile(this.auditLogPath, `${entry}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      enforcePrivateFile(this.auditLogPath);

      if (/^[0-9a-f]{64}$/.test(entryHmac)) {
        this.lastChainHash = entryHmac;
      }
    } catch (err) {
      if (typeof onError === "function") {
        onError(err);
      } else if (!this.failureNotified) {
        this.failureNotified = true;
        process.stderr.write(
          `[SECURITY WARNING] Failed to write corporate audit log: ${err?.message || err}\n`,
        );
      }
    }
  }
}
