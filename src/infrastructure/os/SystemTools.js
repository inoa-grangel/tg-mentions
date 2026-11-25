import fsSync from "node:fs";
import path from "node:path";

export function resolveSystemToolPath(tool) {
  if (process.platform === "win32") {
    const defaultRoot = "C:\\Windows";
    const envRoot = process.env.SystemRoot;
    let sysRoot = defaultRoot;

    if (
      typeof envRoot === "string" &&
      path.isAbsolute(envRoot) &&
      /^([A-Za-z]:\\Windows)$/i.test(path.normalize(envRoot)) &&
      fsSync.existsSync(path.join(envRoot, "System32"))
    ) {
      sysRoot = path.normalize(envRoot);
    }

    if (tool === "reg" || tool === "reg.exe") {
      return path.join(sysRoot, "System32", "reg.exe");
    }
    if (tool === "icacls" || tool === "icacls.exe") {
      return path.join(sysRoot, "System32", "icacls.exe");
    }
    if (tool === "powershell" || tool === "powershell.exe") {
      return path.join(
        sysRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
    }
  } else if (process.platform === "darwin") {
    if (tool === "security") return "/usr/bin/security";
    if (tool === "defaults") return "/usr/bin/defaults";
    if (tool === "open") return "/usr/bin/open";
  } else {
    if (tool === "secret-tool") return "/usr/bin/secret-tool";
    if (tool === "xdg-mime") return "/usr/bin/xdg-mime";
    if (tool === "xdg-open") return "/usr/bin/xdg-open";
  }
  return tool;
}
