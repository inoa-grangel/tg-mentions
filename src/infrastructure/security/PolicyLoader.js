import { CorporatePolicy } from "#domain/policies/CorporatePolicy.js";
import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import { resolveSystemToolPath } from "../os/SystemTools.js";

export class PolicyLoader {
  constructor() {
    this._cachedRaw = null;
  }

  getPolicyPath() {
    if (process.platform === "win32") {
      const programData = process.env.ProgramData || "C:\\ProgramData";
      return path.join(programData, "tg-mentions", "policy.json");
    }
    return "/etc/tg-mentions/policy.json";
  }

  verifyOwnershipAndPermissions(policyPath) {
    const policyDir = path.dirname(policyPath);
    const dirStat = fsSync.lstatSync(policyDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new Error(
        `Refusing symlinked or invalid corporate policy directory: ${policyDir}`,
      );
    }

    const fileStat = fsSync.lstatSync(policyPath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error(
        `Refusing symlinked or non-regular corporate policy file: ${policyPath}`,
      );
    }

    if (process.platform !== "win32") {
      if (dirStat.uid !== 0 || (dirStat.mode & 0o022) !== 0) {
        throw new Error(
          `Insecure corporate policy directory ${policyDir}: must be owned by root and not writable by group/others.`,
        );
      }
      if (fileStat.uid !== 0 || (fileStat.mode & 0o022) !== 0) {
        throw new Error(
          `Insecure corporate policy file ${policyPath}: must be owned by root and not writable by group/others.`,
        );
      }
    } else {
      const psScript = `
        $ErrorActionPreference = 'Stop'
        foreach ($p in @($env:TG_POLICY_DIR, $env:TG_POLICY_FILE)) {
          $acl = Get-Acl -LiteralPath $p
          $ownerSid = $acl.Owner
          $sidObj = (New-Object System.Security.Principal.NTAccount($ownerSid)).Translate([System.Security.Principal.SecurityIdentifier]).Value
          if ($sidObj -ne 'S-1-5-18' -and $sidObj -ne 'S-1-5-32-544') {
            throw "Untrusted owner SID $sidObj on $p"
          }
        }
      `;
      execFileSync(
        resolveSystemToolPath("powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        {
          env: {
            ...process.env,
            TG_POLICY_DIR: policyDir,
            TG_POLICY_FILE: policyPath,
          },
          stdio: "ignore",
          windowsHide: true,
        },
      );
    }
  }

  loadRawPolicy() {
    if (this._cachedRaw) return this._cachedRaw;

    const policyPath = this.getPolicyPath();
    if (fsSync.existsSync(policyPath)) {
      this.verifyOwnershipAndPermissions(policyPath);
      const rawPolicy = JSON.parse(fsSync.readFileSync(policyPath, "utf8"));
      if (
        !Array.isArray(rawPolicy.allowedChatIds) ||
        rawPolicy.allowedChatIds.length === 0
      ) {
        throw new Error(
          `Invalid corporate policy at ${policyPath}: allowedChatIds must be a non-empty array.`,
        );
      }
      const ids = rawPolicy.allowedChatIds
        .map((n) => Number(n))
        .filter((n) => Number.isSafeInteger(n) && n !== 0);
      if (ids.length === 0) {
        throw new Error(
          `Corporate policy at ${policyPath} contains no valid chat IDs.`,
        );
      }

      this._cachedRaw = {
        allowedChatIds: new Set(ids),
        enforcedByPolicy: true,
        requireDesktopApp: Boolean(rawPolicy.requireDesktopApp),
        lockConfigDir: Boolean(rawPolicy.lockConfigDir),
        proxy:
          rawPolicy.proxy && typeof rawPolicy.proxy === "object"
            ? rawPolicy.proxy
            : null,
      };
      return this._cachedRaw;
    }

    this._cachedRaw = {
      allowedChatIds: null,
      enforcedByPolicy: false,
      requireDesktopApp: false,
      lockConfigDir: false,
      proxy: null,
    };
    return this._cachedRaw;
  }

  buildCorporatePolicy(env = process.env) {
    const raw = this.loadRawPolicy();
    const allowedChatIds = raw.enforcedByPolicy
      ? raw.allowedChatIds
      : CorporatePolicy.parseChatIdCsv(env.TG_ALLOWED_CHAT_IDS);

    return new CorporatePolicy({
      ...raw,
      allowedChatIds,
      retentionDays: env.TG_RETENTION_DAYS,
    });
  }
}
