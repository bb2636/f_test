import { encryptPii, decryptPii, hashPii, isEncrypted } from "./crypto";

const PII_ENABLED = (): boolean => !!process.env.PII_ENCRYPTION_KEY;

const USER_PII_FIELDS = [
  { plain: "email", enc: "emailEnc", hash: "emailHash", hashType: "email" as const },
  { plain: "phone", enc: "phoneEnc", hash: "phoneHash", hashType: "phone" as const },
  { plain: "address", enc: "addressEnc", hash: null, hashType: null },
  { plain: "addressDetail", enc: "addressDetailEnc", hash: null, hashType: null },
];

const CASE_PII_FIELDS = [
  { plain: "clientPhone", enc: "clientPhoneEnc", hash: "clientPhoneHash", hashType: "phone" as const },
  { plain: "clientContact", enc: "clientContactEnc", hash: null, hashType: null },
  { plain: "clientAddress", enc: "clientAddressEnc", hash: null, hashType: null },
  { plain: "assessorContact", enc: "assessorContactEnc", hash: null, hashType: null },
  { plain: "assessorEmail", enc: "assessorEmailEnc", hash: "assessorEmailHash", hashType: "email" as const },
  { plain: "investigatorContact", enc: "investigatorContactEnc", hash: null, hashType: null },
  { plain: "investigatorEmail", enc: "investigatorEmailEnc", hash: "investigatorEmailHash", hashType: "email" as const },
  { plain: "policyHolderIdNumber", enc: "policyHolderIdNumberEnc", hash: null, hashType: null },
  { plain: "policyHolderAddress", enc: "policyHolderAddressEnc", hash: null, hashType: null },
  { plain: "insuredIdNumber", enc: "insuredIdNumberEnc", hash: null, hashType: null },
  { plain: "insuredContact", enc: "insuredContactEnc", hash: null, hashType: null },
  { plain: "insuredAddress", enc: "insuredAddressEnc", hash: null, hashType: null },
  { plain: "insuredAddressDetail", enc: "insuredAddressDetailEnc", hash: null, hashType: null },
  { plain: "victimContact", enc: "victimContactEnc", hash: null, hashType: null },
  { plain: "victimAddress", enc: "victimAddressEnc", hash: null, hashType: null },
  { plain: "victimAddressDetail", enc: "victimAddressDetailEnc", hash: null, hashType: null },
  { plain: "assignedPartnerContact", enc: "assignedPartnerContactEnc", hash: null, hashType: null },
];

export function encryptUserFields(userData: Record<string, any>): Record<string, any> {
  if (!PII_ENABLED()) return userData;

  const result = { ...userData };
  for (const field of USER_PII_FIELDS) {
    if (!(field.plain in result)) continue;
    const plainValue = result[field.plain];
    if (plainValue !== undefined && plainValue !== null && plainValue !== "") {
      result[field.enc] = encryptPii(plainValue);
      if (field.hash && field.hashType) {
        result[field.hash] = hashPii(plainValue, field.hashType);
      }
    } else {
      result[field.enc] = null;
      if (field.hash) {
        result[field.hash] = null;
      }
    }
  }
  return result;
}

export function decryptUserFields(dbRow: Record<string, any> | null): Record<string, any> | null {
  if (!dbRow) return null;
  if (!PII_ENABLED()) return dbRow;

  const result = { ...dbRow };
  for (const field of USER_PII_FIELDS) {
    const encValue = result[field.enc];
    if (encValue && isEncrypted(encValue)) {
      const decrypted = decryptPii(encValue);
      if (decrypted) {
        result[field.plain] = decrypted;
      }
    }
  }
  return result;
}

export function encryptCaseFields(caseData: Record<string, any>): Record<string, any> {
  if (!PII_ENABLED()) return caseData;

  const result = { ...caseData };
  for (const field of CASE_PII_FIELDS) {
    if (!(field.plain in result)) continue;
    const plainValue = result[field.plain];
    if (plainValue !== undefined && plainValue !== null && plainValue !== "") {
      result[field.enc] = encryptPii(plainValue);
      if (field.hash && field.hashType) {
        result[field.hash] = hashPii(plainValue, field.hashType);
      }
    } else {
      result[field.enc] = null;
      if (field.hash) {
        result[field.hash] = null;
      }
    }
  }
  return result;
}

export function decryptCaseFields(dbRow: Record<string, any> | null): Record<string, any> | null {
  if (!dbRow) return null;
  if (!PII_ENABLED()) return dbRow;

  const result = { ...dbRow };
  for (const field of CASE_PII_FIELDS) {
    const encValue = result[field.enc];
    if (encValue && isEncrypted(encValue)) {
      const decrypted = decryptPii(encValue);
      if (decrypted) {
        result[field.plain] = decrypted;
      }
    }
  }
  return result;
}

export function stripEncryptedColumns(row: Record<string, any>): Record<string, any> {
  if (!row) return row;
  const result = { ...row };
  const allEncFields = [...USER_PII_FIELDS, ...CASE_PII_FIELDS];
  for (const field of allEncFields) {
    delete result[field.enc];
    if (field.hash) {
      delete result[field.hash];
    }
  }
  return result;
}

export function getUserEmailHash(email: string): string | null {
  return hashPii(email, "email");
}

export function getUserPhoneHash(phone: string): string | null {
  return hashPii(phone, "phone");
}

export { USER_PII_FIELDS, CASE_PII_FIELDS };
