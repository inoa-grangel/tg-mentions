import fs from "node:fs/promises";
import { enforcePrivateFile } from "../security/FilePermissions.js";

export class EnvFileStore {
  constructor(envPath) {
    this.envPath = envPath;
  }

  async save(updates) {
    let content = "";
    try {
      content = await fs.readFile(this.envPath, "utf8");
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

    const normalized = lines.filter(
      (line, i) => line !== "" || i < lines.length - 1,
    );
    await fs.writeFile(this.envPath, `${normalized.join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    enforcePrivateFile(this.envPath);
  }

  async removeKey(keyToRemove) {
    try {
      const content = await fs.readFile(this.envPath, "utf8");
      const filtered = content
        .split(/\r?\n/)
        .filter((line) => !line.startsWith(`${keyToRemove}=`));
      await fs.writeFile(this.envPath, `${filtered.join("\n").trim()}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      enforcePrivateFile(this.envPath);
    } catch {
      // .env may not exist
    }
  }
}
