import { users } from "@shared/schema";

export const USERS_SAFE_COLUMNS = {
  id: users.id,
  username: users.username,
  password: users.password,
  role: users.role,
  name: users.name,
  company: users.company,
  department: users.department,
  position: users.position,
  email: users.email,
  phone: users.phone,
  office: users.office,
  address: users.address,
  addressDetail: users.addressDetail,
  emailEnc: users.emailEnc,
  phoneEnc: users.phoneEnc,
  addressEnc: users.addressEnc,
  addressDetailEnc: users.addressDetailEnc,
  emailHash: users.emailHash,
  phoneHash: users.phoneHash,
  businessRegistrationNumber: users.businessRegistrationNumber,
  representativeName: users.representativeName,
  bankName: users.bankName,
  accountNumber: users.accountNumber,
  accountHolder: users.accountHolder,
  serviceRegions: users.serviceRegions,
  accountType: users.accountType,
  isSuperAdmin: users.isSuperAdmin,
  status: users.status,
  mustChangePassword: users.mustChangePassword,
  currentSessionId: users.currentSessionId,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
} as const;

export const USERS_AUTH_COLUMNS = {
  id: users.id,
  username: users.username,
  password: users.password,
  role: users.role,
  name: users.name,
  company: users.company,
  isSuperAdmin: users.isSuperAdmin,
  status: users.status,
  mustChangePassword: users.mustChangePassword,
  currentSessionId: users.currentSessionId,
  lastLoginAt: users.lastLoginAt,
} as const;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[TIMEOUT] ${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export const DB_QUERY_TIMEOUT = 30000;
export const AUTH_QUERY_TIMEOUT = 10000;
export const SESSION_OP_TIMEOUT = 5000;
