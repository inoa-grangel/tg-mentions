import crypto from "node:crypto";

export function deriveSubkey(masterKeyMaterial, info) {
  let keyBuf;
  if (Buffer.isBuffer(masterKeyMaterial)) {
    if (masterKeyMaterial.length !== 32) {
      throw new Error("Invalid 256-bit master key buffer length.");
    }
    keyBuf = masterKeyMaterial;
  } else if (
    typeof masterKeyMaterial === "string" &&
    /^[0-9a-fA-F]{64}$/.test(masterKeyMaterial)
  ) {
    keyBuf = Buffer.from(masterKeyMaterial, "hex");
  } else {
    throw new Error("Invalid 256-bit master key format.");
  }

  try {
    return Buffer.from(
      crypto.hkdfSync(
        "sha256",
        keyBuf,
        Buffer.alloc(0),
        Buffer.from(info, "utf8"),
        32,
      ),
    );
  } finally {
    if (!Buffer.isBuffer(masterKeyMaterial)) {
      keyBuf.fill(0);
    }
  }
}

export class CryptoService {
  constructor(masterKeyBuffer) {
    this.metadataKey = deriveSubkey(
      masterKeyBuffer,
      "tg-mentions-sqlite-metadata-v1",
    );
    this.sqliteIndexKey = deriveSubkey(
      masterKeyBuffer,
      "tg-mentions-sqlite-index-v1",
    );
    this.auditHmacKey = deriveSubkey(
      masterKeyBuffer,
      "tg-mentions-audit-hmac-v1",
    );
  }

  computeBlindIndex(value) {
    return crypto
      .createHmac("sha256", this.sqliteIndexKey)
      .update(String(value))
      .digest("hex");
  }

  signAuditPayload(canonicalJson) {
    if (!this.auditHmacKey) return "uninitialized";
    return crypto
      .createHmac("sha256", this.auditHmacKey)
      .update(canonicalJson)
      .digest("hex");
  }

  redactAuditIdentifier(value) {
    if (!this.auditHmacKey) return "[uninitialized]";
    return crypto
      .createHmac("sha256", this.auditHmacKey)
      .update(String(value))
      .digest("hex")
      .slice(0, 16);
  }

  encryptField(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.metadataKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(String(plaintext), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `enc:v1:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
  }

  decryptField(payload) {
    if (typeof payload !== "string" || !payload.startsWith("enc:v1:")) {
      throw new Error("Refusing unencrypted or unrecognized field format.");
    }
    const parts = payload.split(":");
    if (parts.length !== 5) {
      throw new Error("Malformed encrypted field.");
    }
    const iv = Buffer.from(parts[2], "base64");
    const authTag = Buffer.from(parts[3], "base64");
    const ciphertext = Buffer.from(parts[4], "base64");

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.metadataKey,
      iv,
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }

  zeroAll() {
    if (Buffer.isBuffer(this.metadataKey)) this.metadataKey.fill(0);
    if (Buffer.isBuffer(this.sqliteIndexKey)) this.sqliteIndexKey.fill(0);
    if (Buffer.isBuffer(this.auditHmacKey)) this.auditHmacKey.fill(0);
  }
}
