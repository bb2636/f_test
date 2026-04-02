import { db } from "./db";
import { users, cases } from "@shared/schema";
import { encryptPii, hashPii, isEncrypted } from "./crypto";
import { eq, isNull } from "drizzle-orm";

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

export async function backfillUsersPii(): Promise<{ updated: number; skipped: number }> {
  if (!process.env.PII_ENCRYPTION_KEY) {
    console.log("[PII Backfill] PII_ENCRYPTION_KEY not set, skipping user backfill");
    return { updated: 0, skipped: 0 };
  }

  const allUsers = await db.select().from(users);
  let updated = 0;
  let skipped = 0;

  for (const user of allUsers) {
    const updates: Record<string, any> = {};
    let needsUpdate = false;

    for (const field of USER_PII_FIELDS) {
      const plainValue = (user as any)[field.plain];
      const encValue = (user as any)[field.enc];

      if (plainValue && !encValue) {
        updates[field.enc] = encryptPii(plainValue);
        if (field.hash && field.hashType) {
          updates[field.hash] = hashPii(plainValue, field.hashType);
        }
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await db.update(users).set(updates).where(eq(users.id, user.id));
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`[PII Backfill] Users: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped };
}

export async function backfillCasesPii(): Promise<{ updated: number; skipped: number }> {
  if (!process.env.PII_ENCRYPTION_KEY) {
    console.log("[PII Backfill] PII_ENCRYPTION_KEY not set, skipping case backfill");
    return { updated: 0, skipped: 0 };
  }

  const allCases = await db.select().from(cases);
  let updated = 0;
  let skipped = 0;

  for (const caseRow of allCases) {
    const updates: Record<string, any> = {};
    let needsUpdate = false;

    for (const field of CASE_PII_FIELDS) {
      const plainValue = (caseRow as any)[field.plain];
      const encValue = (caseRow as any)[field.enc];

      if (plainValue && !encValue) {
        updates[field.enc] = encryptPii(plainValue);
        if (field.hash && field.hashType) {
          updates[field.hash] = hashPii(plainValue, field.hashType);
        }
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await db.update(cases).set(updates).where(eq(cases.id, caseRow.id));
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`[PII Backfill] Cases: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped };
}

export async function runPiiBackfill(): Promise<void> {
  console.log("[PII Backfill] Starting PII encryption backfill...");
  const startTime = Date.now();

  const userResult = await backfillUsersPii();
  const caseResult = await backfillCasesPii();

  const elapsed = Date.now() - startTime;
  console.log(`[PII Backfill] Complete in ${elapsed}ms. Users: ${userResult.updated} encrypted. Cases: ${caseResult.updated} encrypted.`);
}
