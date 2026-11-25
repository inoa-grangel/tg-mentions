import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export function validateConfigDir(targetPath) {
  const checkPath = path.resolve(targetPath);
  let probe = checkPath;
  while (!fsSync.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realAncestor = fsSync.realpathSync(probe);
  const canonicalPath = path.join(
    realAncestor,
    path.relative(probe, checkPath),
  );

  const normalized = canonicalPath.replace(/\\/g, "/").toLowerCase();
  const forbiddenSegments = [
    "/tmp/",
    "/var/tmp/",
    "/private/tmp/",
    "/private/var/tmp/",
    "/appdata/local/temp/",
    "/onedrive",
    "/dropbox",
    "/google drive",
    "/googledrive",
    "/icloud",
    "/mobile documents",
    "/box sync",
    "/nextcloud",
  ];

  if (
    normalized === "/tmp" ||
    normalized === "/var/tmp" ||
    normalized === "/private/tmp" ||
    forbiddenSegments.some((seg) => normalized.includes(seg))
  ) {
    throw new Error(
      `Refusing insecure TG_MENTIONS_HOME (${canonicalPath}): cannot reside in temporary or cloud-synced directories.`,
    );
  }
  return canonicalPath;
}

export function resolveAppPaths(lockConfigDir = false) {
  let configDir;
  if (process.env.TG_MENTIONS_HOME) {
    if (lockConfigDir) {
      throw new Error(
        "Security policy violation: TG_MENTIONS_HOME override is disabled by corporate policy.",
      );
    }
    configDir = validateConfigDir(path.resolve(process.env.TG_MENTIONS_HOME));
  } else if (process.platform === "win32") {
    const base =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    configDir = validateConfigDir(path.join(base, "tg-mentions"));
  } else {
    const base =
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    configDir = validateConfigDir(path.join(base, "tg-mentions"));
  }

  const dataDir = path.join(configDir, "data");
  return Object.freeze({
    configDir,
    envPath: path.join(configDir, ".env"),
    dbPath: path.join(configDir, "tdlib-db"),
    filesPath: path.join(configDir, "tdlib-files"),
    dataDir,
    sqlitePath: path.join(dataDir, "tg-mentions.sqlite"),
    auditLogPath: path.join(dataDir, "audit.jsonl"),
  });
}
