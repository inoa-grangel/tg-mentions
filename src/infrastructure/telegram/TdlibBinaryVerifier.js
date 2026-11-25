import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getTdjson } from "prebuilt-tdlib";

// Replace with the exact SHA-256 digests of your audited prebuilt-tdlib@0.1008071.0 binaries
// Run `npm run verify:tdlib` on each corporate target platform and pin the verified digest here.
export const APPROVED_TDJSON_SHA256 = Object.freeze({
  "darwin-arm64": "REPLACE_WITH_VERIFIED_64_CHAR_HEX_SHA256",
  "darwin-x64": "REPLACE_WITH_VERIFIED_64_CHAR_HEX_SHA256",
  "linux-x64": "REPLACE_WITH_VERIFIED_64_CHAR_HEX_SHA256",
  "win32-x64":
    "f9a4426406de529dcfdb9b4bfb6ee18aa753b4ddee42d0a7aded7bdeb4f12c16",
});

export async function resolveVerifiedTdjson() {
  const tdjsonPath = fsSync.realpathSync(path.resolve(getTdjson()));
  const platformKey = `${process.platform}-${process.arch}`;

  if (!tdjsonPath.toLowerCase().includes("node_modules")) {
    throw new Error(
      `Refusing native TDLib binary outside node_modules: ${tdjsonPath}`,
    );
  }

  const expectedSha256 = APPROVED_TDJSON_SHA256[platformKey]?.toLowerCase();
  if (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error(
      `Unsupported or unapproved platform target (${platformKey}): no pinned TDLib SHA-256 configured.`,
    );
  }

  const binaryBytes = await fs.readFile(tdjsonPath);
  const actualSha256 = crypto
    .createHash("sha256")
    .update(binaryBytes)
    .digest("hex");

  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SECURITY ALERT: Native TDLib binary integrity check failed (${tdjsonPath}). ` +
        `Expected SHA-256 ${expectedSha256}, got ${actualSha256}.`,
    );
  }

  return tdjsonPath;
}
