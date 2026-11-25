import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { resolveSystemToolPath } from "../os/SystemTools.js";

const SID_REGEX = /^S-1-(?:5|12-1)-(?:\d+-)+\d+$/;
let cachedWindowsUserSid = null;

function getWindowsCurrentUserSid() {
  if (cachedWindowsUserSid) return cachedWindowsUserSid;

  const sid = execFileSync(
    resolveSystemToolPath("powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    },
  ).trim();

  if (!SID_REGEX.test(sid)) {
    throw new Error(
      `Security policy violation: invalid Windows user SID format (${sid}).`,
    );
  }

  cachedWindowsUserSid = sid;
  return sid;
}

export function applyWindowsUserOnlyAcl(targetPath, isDirectory) {
  try {
    const sid = getWindowsCurrentUserSid();
    const principal = `*${sid}`;
    const permission = isDirectory
      ? `${principal}:(OI)(CI)F`
      : `${principal}:F`;

    execFileSync(
      resolveSystemToolPath("icacls.exe"),
      [targetPath, "/inheritance:r", "/grant:r", permission],
      { stdio: "ignore", windowsHide: true },
    );
  } catch (err) {
    throw new Error(
      `Security policy violation: failed to enforce owner-only NTFS ACL on ${targetPath} (${err.message}). Refusing insecure storage.`,
    );
  }
}

export function ensurePrivateDir(dirPath) {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  const lst = lstatSync(dirPath);
  if (lst.isSymbolicLink()) {
    throw new Error(
      `Security policy violation: refusing symlinked directory ${dirPath}.`,
    );
  }
  if (process.platform === "win32") {
    applyWindowsUserOnlyAcl(dirPath, true);
  } else {
    chmodSync(dirPath, 0o700);
    const mode = statSync(dirPath).mode & 0o777;
    if (mode !== 0o700) {
      throw new Error(
        `Security policy violation: directory ${dirPath} permissions are ${mode.toString(8)}, expected 700.`,
      );
    }
  }
}

export function enforcePrivateFile(filePath) {
  const lst = lstatSync(filePath);
  if (lst.isSymbolicLink()) {
    throw new Error(
      `Security policy violation: refusing symlinked file ${filePath}.`,
    );
  }
  if (process.platform === "win32") {
    applyWindowsUserOnlyAcl(filePath, false);
  } else {
    chmodSync(filePath, 0o600);
    const mode = statSync(filePath).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(
        `Security policy violation: file ${filePath} permissions are ${mode.toString(8)}, expected 600.`,
      );
    }
  }
}
