const VALID_TG_URI =
  /^tg:\/\/(resolve\?domain=[a-zA-Z0-9_]{3,64}&post=\d+(&thread=\d+)?|privatepost\?channel=\d+&post=\d+(&thread=\d+)?)$/;
const VALID_HTTPS_URI =
  /^https:\/\/t\.me\/(c\/\d+\/\d+(\/\d+)?|[a-zA-Z0-9_]{3,64}\/\d+(\/\d+)?)$/;

export class DeepLink {
  constructor(uri) {
    if (typeof uri !== "string" || uri.length > 256) {
      throw new Error("Blocked unexpected URI length or type");
    }
    if (!VALID_TG_URI.test(uri) && !VALID_HTTPS_URI.test(uri)) {
      throw new Error("Blocked unexpected URI format");
    }
    this.uri = uri;
    Object.freeze(this);
  }

  get isDesktopScheme() {
    return VALID_TG_URI.test(this.uri);
  }

  get isWebScheme() {
    return VALID_HTTPS_URI.test(this.uri);
  }

  static build({ useAppScheme, username, supergroupId, rawTopicId, rawMsgId }) {
    const safeUsername =
      typeof username === "string" && /^[a-zA-Z0-9_]{3,64}$/.test(username)
        ? username
        : null;
    const rawSg = Math.abs(Number(supergroupId));
    const sgId =
      String(rawSg).startsWith("100") && rawSg > 1000000000000
        ? Number(String(rawSg).slice(3))
        : rawSg;
    const tId = Number(rawTopicId);
    const mId = Number(rawMsgId);

    if (
      !Number.isSafeInteger(sgId) ||
      sgId <= 0 ||
      !Number.isSafeInteger(tId) ||
      tId <= 0 ||
      !Number.isSafeInteger(mId) ||
      mId <= 0
    ) {
      throw new Error(
        `Invalid numeric identifier in Telegram link (sg=${sgId}, t=${tId}, m=${mId})`,
      );
    }

    if (useAppScheme) {
      const uri = safeUsername
        ? tId === 1
          ? `tg://resolve?domain=${safeUsername}&post=${mId}`
          : `tg://resolve?domain=${safeUsername}&post=${mId}&thread=${tId}`
        : tId === 1
          ? `tg://privatepost?channel=${sgId}&post=${mId}`
          : `tg://privatepost?channel=${sgId}&post=${mId}&thread=${tId}`;
      return new DeepLink(uri);
    }

    const baseUrl = safeUsername
      ? `https://t.me/${safeUsername}`
      : `https://t.me/c/${sgId}`;
    const uri = tId === 1 ? `${baseUrl}/${mId}` : `${baseUrl}/${tId}/${mId}`;
    return new DeepLink(uri);
  }

  toString() {
    return this.uri;
  }
}
