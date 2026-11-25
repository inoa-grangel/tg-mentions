import { DeepLink } from "#domain/value-objects/DeepLink.js";
import { sanitizeText } from "#presentation/tui/TextSanitizer.js";
import { execFileSync, spawn } from "node:child_process";
import { resolveSystemToolPath } from "./SystemTools.js";

export function isTelegramDesktopInstalled({
  forceWeb = false,
  requireDesktopApp = false,
} = {}) {
  if (forceWeb && !requireDesktopApp) {
    return false;
  }

  try {
    if (process.platform === "win32") {
      const regExe = resolveSystemToolPath("reg.exe");
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
          execFileSync(regExe, args, { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      });
    }

    if (process.platform === "darwin") {
      const out = execFileSync(
        resolveSystemToolPath("defaults"),
        [
          "read",
          "com.apple.LaunchServices/com.apple.launchservices.secure",
          "LSHandlers",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out.includes("LSHandlerURLScheme = tg;");
    }

    const handler = execFileSync(
      resolveSystemToolPath("xdg-mime"),
      ["query", "default", "x-scheme-handler/tg"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return handler.length > 0;
  } catch {
    return false;
  }
}

export function openUri(
  uri,
  { requireDesktopApp = false, auditLogger = null, onAuditError = null } = {},
) {
  const link = new DeepLink(uri);

  if (requireDesktopApp && !link.isDesktopScheme) {
    throw new Error(
      "Blocked browser fallback: corporate policy requires Telegram Desktop (tg://) links.",
    );
  }

  let command;
  let args;
  let env = process.env;

  if (process.platform === "win32") {
    command = resolveSystemToolPath("rundll32.exe");
    args = ["url.dll,FileProtocolHandler", link.uri];
  } else if (process.platform === "darwin") {
    command = resolveSystemToolPath("open");
    args = [link.uri];
  } else {
    command = resolveSystemToolPath("xdg-open");
    args = [link.uri];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    env,
  });

  let stderrBuf = "";
  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderrBuf.length < 512) stderrBuf += chunk;
    });
  }

  child.on("error", (err) => {
    if (typeof onAuditError === "function") {
      onAuditError(new Error(`Launcher failed: ${err.message}`));
    }
  });

  child.on("exit", (exitCode) => {
    if (exitCode && exitCode !== 0 && typeof onAuditError === "function") {
      const detail = sanitizeText(stderrBuf) || `exit code ${exitCode}`;
      onAuditError(new Error(`Failed to open URI (${detail})`));
    }
  });

  if (auditLogger) {
    auditLogger.log("OPEN_TOPIC_URI", { uri: link.uri }, onAuditError);
  }
  child.unref();
}

export function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) {
    throw new Error("Nothing to copy");
  }

  if (process.platform === "win32") {
    execFileSync(resolveSystemToolPath("clip.exe"), [], {
      input: value,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return;
  }

  if (process.platform === "darwin") {
    execFileSync(resolveSystemToolPath("pbcopy"), [], {
      input: value,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return;
  }

  const linuxTools = [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ];

  for (const [bin, toolArgs] of linuxTools) {
    try {
      execFileSync(resolveSystemToolPath(bin), toolArgs, {
        input: value,
        stdio: ["pipe", "ignore", "ignore"],
      });
      return;
    } catch {
      // Try next clipboard utility
    }
  }

  throw new Error(
    "No clipboard utility found (install wl-copy, xclip, or xsel)",
  );
}
