#!/usr/bin/env node
import dotenv from "dotenv";
import crypto from "node:crypto";

import { resolveAppPaths } from "#infrastructure/os/AppPaths.js";
import {
  copyTextToClipboard,
  isTelegramDesktopInstalled,
  openUri,
} from "#infrastructure/os/UriLauncher.js";
import { EnvFileStore } from "#infrastructure/persistence/EnvFileStore.js";
import { SqliteTopicRepository } from "#infrastructure/persistence/SqliteTopicRepository.js";
import { CryptoService } from "#infrastructure/security/CryptoService.js";
import { ensurePrivateDir } from "#infrastructure/security/FilePermissions.js";
import { HashChainAuditLogger } from "#infrastructure/security/HashChainAuditLogger.js";
import { KeychainVault } from "#infrastructure/security/KeychainVault.js";
import { PolicyLoader } from "#infrastructure/security/PolicyLoader.js";
import { TdlibClientFactory } from "#infrastructure/telegram/TdlibClientFactory.js";
import { TdlibTelegramGateway } from "#infrastructure/telegram/TdlibTelegramGateway.js";
import { parseCliArgs } from "#presentation/cli/CliArgs.js";

import { ConfigureAllowlist } from "#application/ConfigureAllowlist.js";
import { FetchMentionedTopics } from "#application/FetchMentionedTopics.js";
import { HideTopic } from "#application/HideTopic.js";
import { PurgeLocalData } from "#application/PurgeLocalData.js";
import { UnhideTopic } from "#application/UnhideTopic.js";

import { runAllowlistChecklistTui } from "#presentation/tui/AllowlistChecklistTui.js";
import { createNpmSpinner } from "#presentation/tui/Spinner.js";
import { promptLine, term } from "#presentation/tui/TerminalHelpers.js";
import { runVimTui } from "#presentation/tui/TopicsVimTui.js";
import {} from "#infrastructure/os/UriLauncher.js";
// Suppress Node's ExperimentalWarning for built-in node:sqlite
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const msg = typeof warning === "string" ? warning : warning?.message || "";
  if (msg.includes("SQLite is an experimental feature")) return;
  return originalEmitWarning.call(process, warning, ...args);
};

const KEYCHAIN_ACCOUNT = "db-encryption-key";
const API_ID_ACCOUNT = "tg-api-id";
const API_HASH_ACCOUNT = "tg-api-hash";

const cliArgs = parseCliArgs(process.argv);
const policyLoader = new PolicyLoader();
const envPolicyConfig = policyLoader.loadRawPolicy();
const paths = resolveAppPaths(envPolicyConfig.lockConfigDir);

ensurePrivateDir(paths.configDir);
ensurePrivateDir(paths.dbPath);
ensurePrivateDir(paths.filesPath);
ensurePrivateDir(paths.dataDir);

dotenv.config({ path: paths.envPath, quiet: true });

const policy = policyLoader.buildCorporatePolicy(process.env);
const vault = new KeychainVault({ baseDir: paths.configDir });
const envStore = new EnvFileStore(paths.envPath);

if (cliArgs.purge) {
  const purgeUseCase = new PurgeLocalData({ vault, paths });
  const cleanedDirs = await purgeUseCase.execute();
  term.green(
    `Purged all local TDLib session data, caches, logs, and credentials in ${cleanedDirs.join(" and ")}\n`,
  );
  process.exit(0);
}

if (cliArgs.selectChats && policy.enforcedByPolicy) {
  throw new Error(
    `Corporate policy is enforced via ${policyLoader.getPolicyPath()}; interactive chat selection is disabled.`,
  );
}

// 1. Load or provision Telegram API credentials in OS Vault
let rawApiId = vault.getSecret(API_ID_ACCOUNT) || process.env.TG_API_ID?.trim();
let apiHash =
  vault.getSecret(API_HASH_ACCOUNT) || process.env.TG_API_HASH?.trim();
let apiId = Number(rawApiId);

if (!apiId || !apiHash) {
  term.bold("Telegram API credentials not found in OS credential store.\n");
  term("Get them at https://my.telegram.org -> API development tools\n\n");

  if (!apiId) {
    const inputId = (await promptLine("Enter your TG_API_ID: ")).trim();
    apiId = Number(inputId);
    if (!Number.isInteger(apiId) || apiId <= 0) {
      throw new Error("Invalid TG_API_ID: must be a positive integer.");
    }
    vault.setSecret(API_ID_ACCOUNT, String(apiId));
  }
  if (!apiHash) {
    apiHash = (await promptLine("Enter your TG_API_HASH: ")).trim();
    if (!/^[0-9a-fA-F]{32}$/.test(apiHash)) {
      throw new Error(
        "Invalid TG_API_HASH: expected a 32-character hex string.",
      );
    }
    vault.setSecret(API_HASH_ACCOUNT, apiHash);
  }
  term.green("Saved API credentials to OS credential store.\n\n");
} else {
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("Invalid TG_API_ID: must be a positive integer.");
  }
  if (!/^[0-9a-fA-F]{32}$/.test(apiHash)) {
    throw new Error("Invalid TG_API_HASH: expected a 32-character hex string.");
  }
  vault.setSecret(API_ID_ACCOUNT, String(apiId));
  vault.setSecret(API_HASH_ACCOUNT, apiHash);
  if (process.env.TG_API_ID || process.env.TG_API_HASH) {
    await envStore.removeKey("TG_API_ID");
    await envStore.removeKey("TG_API_HASH");
  }
}

// 2. Provision Master Encryption Key & Derived Subkeys
let dbMasterKeyBuf = vault.getMasterKeyBuffer(KEYCHAIN_ACCOUNT);
if (!dbMasterKeyBuf) {
  const legacyEnvKey = process.env.TG_DB_ENCRYPTION_KEY?.trim();
  dbMasterKeyBuf =
    legacyEnvKey && /^[0-9a-fA-F]{64}$/.test(legacyEnvKey)
      ? Buffer.from(legacyEnvKey, "hex")
      : crypto.randomBytes(32);

  try {
    vault.setMasterKeyBuffer(KEYCHAIN_ACCOUNT, dbMasterKeyBuf);
    if (legacyEnvKey) {
      await envStore.removeKey("TG_DB_ENCRYPTION_KEY");
      term.green(
        "Migrated TG_DB_ENCRYPTION_KEY from .env to OS credential store.\n",
      );
    }
  } catch (err) {
    dbMasterKeyBuf.fill(0);
    throw new Error(
      `Refusing to store DB encryption key in plaintext .env: OS credential store unavailable (${err.message}). ` +
        `Ensure macOS Keychain, Windows DPAPI, or Linux secret-tool (libsecret) is available.`,
    );
  }
}

const cryptoService = new CryptoService(dbMasterKeyBuf);
const auditLogger = new HashChainAuditLogger({
  auditLogPath: paths.auditLogPath,
  retentionMs: policy.retentionMs,
  cryptoService,
});
await auditLogger.init();

const topicRepository = new SqliteTopicRepository({
  dbPath: paths.sqlitePath,
  retentionMs: policy.retentionMs,
  cryptoService,
});

// 3. Initialize Verified TDLib Client & Login
const clientFactory = new TdlibClientFactory({
  dbPath: paths.dbPath,
  filesPath: paths.filesPath,
  proxy: policy.proxy,
});

const client = await clientFactory.createAndLogin({
  masterKeyBuf: dbMasterKeyBuf,
  apiId,
  apiHash,
  promptLine,
});
apiHash = null;

function cleanupSecrets() {
  if (Buffer.isBuffer(dbMasterKeyBuf)) dbMasterKeyBuf.fill(0);
  cryptoService.zeroAll();
}

process.on("SIGINT", () => {
  cleanupSecrets();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupSecrets();
  process.exit(143);
});

const telegramGateway = new TdlibTelegramGateway(client);

// 4. Configure Corporate Allowlist if missing or requested
let allowedChatIds = policy.allowedChatIds;
if (cliArgs.selectChats || !allowedChatIds) {
  if (!allowedChatIds && !cliArgs.selectChats) {
    term.yellow(
      `Corporate policy: TG_ALLOWED_CHAT_IDS is not configured in ${paths.envPath}.\nLaunching interactive group selector...\n`,
    );
  }

  const configureAllowlist = new ConfigureAllowlist({
    telegramGateway,
    envStore,
    auditLogger,
    selectForumsUi: runAllowlistChecklistTui,
  });

  try {
    allowedChatIds = await configureAllowlist.execute(allowedChatIds);
    term.green(
      `Saved ${allowedChatIds.size} corporate chat ID(s) to TG_ALLOWED_CHAT_IDS in ${paths.envPath}\n\n`,
    );
  } catch (err) {
    topicRepository.close();
    await client.close();
    cleanupSecrets();
    throw err;
  }

  if (cliArgs.selectChats) {
    topicRepository.close();
    await client.close();
    cleanupSecrets();
    process.exit(0);
  }
}

// 5. Fetch Mentioned Topics & Launch TUI
const useAppScheme = isTelegramDesktopInstalled({
  forceWeb: cliArgs.web,
  requireDesktopApp: policy.requireDesktopApp,
});

const fetchMentionedTopics = new FetchMentionedTopics({
  telegramGateway,
  topicRepository,
  cryptoService,
  auditLogger,
});
const hideTopic = new HideTopic({ topicRepository, auditLogger });
const unhideTopic = new UnhideTopic({ topicRepository, auditLogger });

const spinner = createNpmSpinner();
spinner.start("Loading Telegram chats...");

let allResults;
try {
  allResults = await fetchMentionedTopics.execute({
    allowedChatIds,
    useAppScheme,
    onProgress: (msg) => spinner.update(msg),
  });
} catch (err) {
  spinner.stop();
  topicRepository.close();
  cleanupSecrets();
  throw err;
}

spinner.stop();

if (allResults.length === 0) {
  term("No active mentioned topics found.\n");
  topicRepository.close();
  await client.close();
  cleanupSecrets();
  process.exit(0);
}

try {
  if (cliArgs.open) {
    const first = allResults.find((r) => r.hideMode === null) ?? allResults[0];
    term(`Opening ${first.topicName}...\n`);
    openUri(first.link, {
      requireDesktopApp: policy.requireDesktopApp,
      auditLogger,
    });
  } else {
    await runVimTui({
      initialItems: allResults,
      initialShowAll: cliArgs.all,
      onReload: (onProgress) =>
        fetchMentionedTopics.execute({
          allowedChatIds,
          useAppScheme,
          onProgress,
        }),
      onHide: (topic, hideMode, hideUntil, onAuditError) =>
        hideTopic.execute(topic, { hideMode, hideUntil, onAuditError }),
      onUnhide: (topic, onAuditError) =>
        unhideTopic.execute(topic, { onAuditError }),
      onOpenUri: (uri, onAuditError) =>
        openUri(uri, {
          requireDesktopApp: policy.requireDesktopApp,
          auditLogger,
          onAuditError,
        }),
      onCopyLink: (url) => copyTextToClipboard(url),
    });
  }
} finally {
  topicRepository.close();
  await client.close();
  cleanupSecrets();
}
process.exit(0);
