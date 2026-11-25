import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export class PurgeLocalData {
  constructor({ vault, paths }) {
    this.vault = vault;
    this.paths = paths;
  }

  async execute() {
    const tdjsonSecretAccount = `tdjson-sha256-${process.platform}-${process.arch}`;
    this.vault.purgeAll([
      "db-encryption-key",
      "tg-api-id",
      "tg-api-hash",
      tdjsonSecretAccount,
    ]);

    const dirsToClean = new Set([this.paths.configDir]);
    if (process.platform === "win32") {
      const defaultWinDir = path.join(
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
        "tg-mentions",
      );
      dirsToClean.add(path.resolve(defaultWinDir));
    }

    for (const dir of dirsToClean) {
      for (const rel of [
        "tdlib-db",
        "tdlib-files",
        path.join("data", "tg-mentions.sqlite"),
        path.join("data", "tg-mentions.sqlite-wal"),
        path.join("data", "tg-mentions.sqlite-shm"),
        path.join("data", "audit.jsonl"),
        ".env",
      ]) {
        await fs.rm(path.join(dir, rel), { recursive: true, force: true });
      }

      try {
        const entries = await fs.readdir(dir);
        for (const entry of entries) {
          if (entry.endsWith(".dpapi")) {
            await fs.rm(path.join(dir, entry), { force: true });
          }
        }
      } catch {
        // Directory may not exist
      }
    }

    return Array.from(dirsToClean);
  }
}
