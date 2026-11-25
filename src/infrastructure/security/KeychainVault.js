import { SecretVault } from "#domain/ports/SecretVault.js";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSystemToolPath } from "../os/SystemTools.js";
import { enforcePrivateFile, ensurePrivateDir } from "./FilePermissions.js";

export const SERVICE_NAME = "com.corp.tg-mentions";
const ACCOUNT_REGEX = /^[a-zA-Z0-9._-]{1,64}$/;

export function validateAccount(account) {
  if (typeof account !== "string" || !ACCOUNT_REGEX.test(account)) {
    throw new Error(
      "Invalid account identifier: must be 1-64 alphanumeric, dot, underscore, or hyphen characters.",
    );
  }
  return account;
}

export class KeychainVault extends SecretVault {
  constructor({ baseDir } = {}) {
    super();
    this.baseDir = baseDir;
  }

  _resolveWindowsDpapiPath(account, overrideBaseDir = this.baseDir) {
    const safeAccount = validateAccount(account);
    const root =
      overrideBaseDir ||
      path.join(
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
        "tg-mentions",
      );
    ensurePrivateDir(root);
    return path.join(root, `${safeAccount}.dpapi`);
  }

  getSecret(account) {
    const safeAccount = validateAccount(account);

    try {
      if (process.platform === "darwin") {
        const raw = execFileSync(
          resolveSystemToolPath("security"),
          [
            "find-generic-password",
            "-s",
            SERVICE_NAME,
            "-a",
            safeAccount,
            "-w",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();

        if (!raw) return null;
        if (raw.startsWith("hex:v1:")) {
          return Buffer.from(raw.slice(7), "hex").toString("utf8");
        }
        return raw;
      }

      if (process.platform === "linux") {
        return (
          execFileSync(
            resolveSystemToolPath("secret-tool"),
            ["lookup", "service", SERVICE_NAME, "account", safeAccount],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
          ).trim() || null
        );
      }

      if (process.platform === "win32") {
        const dpapiPath = this._resolveWindowsDpapiPath(safeAccount);
        const psScript = `
          $ErrorActionPreference = 'Stop'
          if (-not (Test-Path -LiteralPath $env:TG_DPAPI_PATH)) { exit 1 }
          Add-Type -AssemblyName System.Security
          $enc = [System.IO.File]::ReadAllBytes($env:TG_DPAPI_PATH)
          $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
          )
          [System.Text.Encoding]::UTF8.GetString($dec)
        `;
        return (
          execFileSync(
            resolveSystemToolPath("powershell.exe"),
            ["-NoProfile", "-NonInteractive", "-Command", psScript],
            {
              encoding: "utf8",
              env: { ...process.env, TG_DPAPI_PATH: dpapiPath },
              stdio: ["ignore", "pipe", "ignore"],
              windowsHide: true,
            },
          ).trim() || null
        );
      }
    } catch {
      return null;
    }
    return null;
  }

  setSecret(account, secretValue) {
    const safeAccount = validateAccount(account);
    if (typeof secretValue !== "string" || secretValue.length === 0) {
      throw new Error("Secret value must be a non-empty string.");
    }

    if (process.platform === "darwin") {
      const hexPayload = Buffer.from(secretValue, "utf8").toString("hex");
      const encodedPayload = `hex:v1:${hexPayload}`;
      if (!/^hex:v1:[0-9a-f]+$/.test(encodedPayload)) {
        throw new Error("Invalid encoded secret payload.");
      }
      const interactiveCmd = `add-generic-password -U -s ${SERVICE_NAME} -a ${safeAccount} -w ${encodedPayload}\n`;
      execFileSync(resolveSystemToolPath("security"), ["-i"], {
        input: interactiveCmd,
        encoding: "utf8",
        stdio: ["pipe", "ignore", "ignore"],
      });
      return;
    }

    if (process.platform === "linux") {
      execFileSync(
        resolveSystemToolPath("secret-tool"),
        [
          "store",
          "--label",
          `${SERVICE_NAME} (${safeAccount})`,
          "service",
          SERVICE_NAME,
          "account",
          safeAccount,
        ],
        { input: secretValue, stdio: ["pipe", "ignore", "ignore"] },
      );
      return;
    }

    if (process.platform === "win32") {
      const dpapiPath = this._resolveWindowsDpapiPath(safeAccount);
      const psScript = `
        $ErrorActionPreference = 'Stop'
        Add-Type -AssemblyName System.Security
        $rawSecret = [Console]::In.ReadToEnd()
        if ([string]::IsNullOrEmpty($rawSecret)) { exit 1 }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($rawSecret)
        $enc = [System.Security.Cryptography.ProtectedData]::Protect(
          $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        [System.IO.File]::WriteAllBytes($env:TG_DPAPI_PATH, $enc)
      `;
      execFileSync(
        resolveSystemToolPath("powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        {
          input: secretValue,
          encoding: "utf8",
          env: { ...process.env, TG_DPAPI_PATH: dpapiPath },
          stdio: ["pipe", "ignore", "ignore"],
          windowsHide: true,
        },
      );
      enforcePrivateFile(dpapiPath);
      return;
    }

    throw new Error(
      `Unsupported platform for secure secret storage: ${process.platform}`,
    );
  }

  deleteSecret(account, overrideBaseDir = this.baseDir) {
    const safeAccount = validateAccount(account);
    try {
      if (process.platform === "darwin") {
        execFileSync(
          resolveSystemToolPath("security"),
          ["delete-generic-password", "-s", SERVICE_NAME, "-a", safeAccount],
          { stdio: "ignore" },
        );
      } else if (process.platform === "linux") {
        execFileSync(
          resolveSystemToolPath("secret-tool"),
          ["clear", "service", SERVICE_NAME, "account", safeAccount],
          { stdio: "ignore" },
        );
      } else if (process.platform === "win32") {
        const dpapiPath = this._resolveWindowsDpapiPath(
          safeAccount,
          overrideBaseDir,
        );
        rmSync(dpapiPath, { force: true });
      }
    } catch {
      // Ignore if entry does not exist
    }
  }

  purgeLegacySecrets(account, overrideBaseDir = this.baseDir) {
    const safeAccount = validateAccount(account);
    const LEGACY_SERVICE = "tg-mentions-corp";
    try {
      if (process.platform === "darwin") {
        execFileSync(
          resolveSystemToolPath("security"),
          ["delete-generic-password", "-s", LEGACY_SERVICE, "-a", safeAccount],
          { stdio: "ignore" },
        );
      } else if (process.platform === "linux") {
        execFileSync(
          resolveSystemToolPath("secret-tool"),
          ["clear", "service", LEGACY_SERVICE, "account", safeAccount],
          { stdio: "ignore" },
        );
      } else if (process.platform === "win32") {
        const dpapiPath = this._resolveWindowsDpapiPath(
          safeAccount,
          overrideBaseDir,
        );
        rmSync(dpapiPath, { force: true });
      }
    } catch {
      // Ignore if no legacy entry exists
    }
  }

  getMasterKeyBuffer(account) {
    const hex = this.getSecret(account);
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
      return null;
    }
    return Buffer.from(hex, "hex");
  }

  setMasterKeyBuffer(account, keyBuf) {
    if (!Buffer.isBuffer(keyBuf) || keyBuf.length !== 32) {
      throw new Error("Invalid 256-bit key buffer");
    }
    this.setSecret(account, keyBuf.toString("hex"));
    return true;
  }

  purgeAll(accounts) {
    for (const account of accounts) {
      this.deleteSecret(account);
      this.purgeLegacySecrets(account);
      if (process.platform === "win32") {
        this.deleteSecret(account, null);
        this.purgeLegacySecrets(account, null);
      }
    }
  }
}
