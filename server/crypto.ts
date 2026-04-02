import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SEPARATOR = ":";

function getEncryptionKey(): Buffer {
  const keyHex = process.env.PII_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error("PII_ENCRYPTION_KEY environment variable is not set. Must be a 64-char hex string (32 bytes).");
  }
  if (keyHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(`PII_ENCRYPTION_KEY must be exactly 64 hex characters (0-9, a-f). Got ${keyHex.length} characters.`);
  }
  const buf = Buffer.from(keyHex, "hex");
  if (buf.length !== 32) {
    throw new Error(`PII_ENCRYPTION_KEY decoded to ${buf.length} bytes, expected 32.`);
  }
  return buf;
}

export function encryptPii(plaintext: string | null | undefined): string | null {
  if (!plaintext || plaintext.trim() === "") return null;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted,
  ].join(SEPARATOR);
}

export function decryptPii(encryptedValue: string | null | undefined): string | null {
  if (!encryptedValue || encryptedValue.trim() === "") return null;

  const parts = encryptedValue.split(SEPARATOR);
  if (parts.length !== 3) {
    return encryptedValue;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], "base64");
    const authTag = Buffer.from(parts[1], "base64");
    const ciphertext = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export function hashPii(value: string | null | undefined, type: "email" | "phone"): string | null {
  if (!value || value.trim() === "") return null;

  let normalized: string;
  if (type === "email") {
    normalized = normalizeEmail(value);
  } else {
    normalized = normalizePhone(value);
  }

  if (normalized === "") return null;

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(SEPARATOR);
  if (parts.length !== 3) return false;
  try {
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    return iv.length === IV_LENGTH && tag.length === AUTH_TAG_LENGTH;
  } catch {
    return false;
  }
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
