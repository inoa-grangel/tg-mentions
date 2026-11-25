import { term } from "#presentation/tui/TerminalHelpers.js";
import { sanitizeText } from "#presentation/tui/TextSanitizer.js";
import tdl from "tdl";
import { resolveVerifiedTdjson } from "./TdlibBinaryVerifier.js";

export class TdlibClientFactory {
  constructor({ dbPath, filesPath, proxy = null }) {
    this.dbPath = dbPath;
    this.filesPath = filesPath;
    this.proxy = proxy;
  }

  async createAndLogin({ masterKeyBuf, apiId, apiHash, promptLine }) {
    const verifiedTdjson = await resolveVerifiedTdjson();
    tdl.configure({
      tdjson: verifiedTdjson,
      verbosityLevel: 0,
    });

    const base64DbKey = masterKeyBuf.toString("base64");
    masterKeyBuf.fill(0);

    const client = tdl.createClient({
      apiId,
      apiHash,
      databaseDirectory: this.dbPath,
      filesDirectory: this.filesPath,
      databaseEncryptionKey: base64DbKey,
      useFileDatabase: false,
      useChatInfoDatabase: false,
      useMessageDatabase: false,
    });

    if (this.proxy) {
      await client.invoke({
        _: "addProxy",
        server: String(this.proxy.server || ""),
        port: Number(this.proxy.port || 1080),
        enable: true,
        type: this.proxy.type || { _: "proxyTypeSocks5" },
      });
    }

    client.on("error", (err) => {
      term.red(`TDLib error: ${sanitizeText(err.message || String(err))}\n`);
    });

    await client.login({
      async getPhoneNumber(retry) {
        if (retry) term.yellow("Invalid phone number, please try again.\n");
        return await promptLine(
          "Phone number (with country code, e.g. +5522999999999): ",
        );
      },
      async getAuthCode(retry) {
        if (retry) term.yellow("Invalid code, please try again.\n");
        return await promptLine("Login code sent to your Telegram app: ");
      },
      async getPassword(passwordHint, retry) {
        if (retry) term.yellow("Invalid 2FA password, please try again.\n");
        const hint = passwordHint
          ? ` (hint: ${sanitizeText(passwordHint)})`
          : "";
        return await promptLine(`2FA password${hint}: `, { echo: false });
      },
      async getName() {
        return { firstName: "User", lastName: "" };
      },
    });

    return client;
  }
}
