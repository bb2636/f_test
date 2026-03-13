import {
  type User,
  type InsertUser,
  users,
  type Case,
  type CaseWithLatestProgress,
  type InsertCase,
  cases,
  type ProgressUpdate,
  type InsertProgressUpdate,
  progressUpdates,
  type RolePermission,
  type InsertRolePermission,
  rolePermissions,
  type ExcelData,
  type InsertExcelData,
  excelData,
  type Inquiry,
  type InsertInquiry,
  type UpdateInquiry,
  inquiries,
  type Drawing,
  type InsertDrawing,
  drawings,
  type SharedDrawing,
  type InsertSharedDrawing,
  sharedDrawings,
  type FieldSurveyData,
  type InsertFieldSurveyData,
  fieldSurveyData,
  type CaseDocument,
  type InsertCaseDocument,
  caseDocuments,
  type MasterData,
  type InsertMasterData,
  masterData,
  type Estimate,
  type InsertEstimate,
  estimates,
  type EstimateRow,
  type InsertEstimateRow,
  estimateRows,
  type LaborCost,
  type InsertLaborCost,
  laborCosts,
  type Material,
  type InsertMaterial,
  materials,
  type UserFavorite,
  type InsertUserFavorite,
  userFavorites,
  type Notice,
  type InsertNotice,
  notices,
  type CaseChangeLog,
  type InsertCaseChangeLog,
  caseChangeLogs,
  type Settlement,
  type InsertSettlement,
  settlements,
  type LaborRateTier,
  type InsertLaborRateTier,
  type UpdateLaborRateTier,
  laborRateTiers,
  DEFAULT_LABOR_RATE_TIERS,
  type Invoice,
  type InsertInvoice,
  invoices,
  type UnitPriceOverride,
  type InsertUnitPriceOverride,
  unitPriceOverrides,
  type EstimateExclusion,
  type InsertEstimateExclusion,
  estimateExclusions,
  type CaseStatusHistory,
  type InsertCaseStatusHistory,
  caseStatusHistory,
} from "@shared/schema";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { db, pool } from "./db";
import { eq, asc, desc, and, or, like, sql } from "drizzle-orm";

const SALT_ROUNDS = 10;

const USERS_CACHE_TTL = 5 * 60 * 1000;
let usersCache: User[] | null = null;
let usersCacheTime = 0;
let usersCacheFetching: Promise<User[]> | null = null;

function invalidateUsersCache() {
  usersCache = null;
  usersCacheTime = 0;
}

async function getCachedUsers(): Promise<User[]> {
  const now = Date.now();
  if (usersCache && (now - usersCacheTime) < USERS_CACHE_TTL) {
    return usersCache;
  }
  if (usersCacheFetching) {
    return usersCacheFetching;
  }
  usersCacheFetching = (async () => {
    try {
      const result = await db
        .select()
        .from(users)
        .where(eq(users.status, "active"));
      usersCache = result;
      usersCacheTime = Date.now();
      return result;
    } finally {
      usersCacheFetching = null;
    }
  })();
  return usersCacheFetching;
}

const CASES_CACHE_TTL = 30 * 1000;
let casesRawCache: { cases: any[]; progress: any[]; ts: number } | null = null;
let casesRawFetching: Promise<{ cases: any[]; progress: any[] }> | null = null;

async function getCachedCasesRaw(): Promise<{ cases: any[]; progress: any[] }> {
  const now = Date.now();
  if (casesRawCache && (now - casesRawCache.ts) < CASES_CACHE_TTL) {
    return { cases: casesRawCache.cases, progress: casesRawCache.progress };
  }
  if (casesRawFetching) {
    return casesRawFetching;
  }
  casesRawFetching = (async () => {
    try {
      const [allCases, allProgress] = await Promise.all([
        db.select().from(cases).orderBy(asc(cases.createdAt)),
        db.select().from(progressUpdates),
      ]);
      casesRawCache = { cases: allCases, progress: allProgress, ts: Date.now() };
      return { cases: allCases, progress: allProgress };
    } finally {
      casesRawFetching = null;
    }
  })();
  return casesRawFetching;
}

export function invalidateCasesCache() {
  casesRawCache = null;
}

export function warmUpUsersCache() {
  getCachedUsers().then(() => {
    console.log("[CACHE] Users cache warmed up successfully");
  }).catch((err) => {
    console.error("[CACHE] Users cache warm-up failed:", err);
  });
}

export function warmUpCasesCache() {
  getCachedCasesRaw().then(() => {
    console.log("[CACHE] Cases cache warmed up successfully");
  }).catch((err) => {
    console.error("[CACHE] Cases cache warm-up failed:", err);
  });
}

// Get current date in KST (Korea Standard Time, UTC+9)
function getKSTDate(): string {
  const kstDate = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  );
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getKSTTimestamp(): string {
  const now = new Date();
  const kstDate = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  );

  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getDate()).padStart(2, "0");
  const hours = String(kstDate.getHours()).padStart(2, "0");
  const minutes = String(kstDate.getMinutes()).padStart(2, "0");
  const seconds = String(kstDate.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`;
}

// Check if user has team leader level authority (팀장, 부장, 차장, 과장)
function isTeamLeader(position: string | null): boolean {
  if (!position) return false;
  return ["팀장", "부장", "차장", "과장"].includes(position);
}

export interface PartnerStats {
  partnerName: string;
  dailyCount: number; // 일배당건수
  monthlyCount: number; // 월배당건수
  inProgressCount: number; // 진행건수
  pendingCount: number; // 미결건수
}

export interface StatisticsFilters {
  insuranceCompanies: string[];
  assessors: string[];
  investigators: string[];
  partners: string[];
  settlementManagers: string[];
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  verifyPassword(username: string, password: string): Promise<User | null>;
  updatePassword(username: string, newPassword: string): Promise<User | null>;
  reactivateAccount(username: string): Promise<User | null>;
  updateUser(userId: string, userData: Partial<Omit<User, 'id' | 'username' | 'password' | 'company' | 'createdAt' | 'status'>>): Promise<User | null>;
  updateUserMustChangePassword(userId: string, mustChangePassword: boolean): Promise<User | null>;
  deleteAccount(username: string): Promise<User | null>;
  getNextCaseSequence(
    date: string,
    insuranceAccidentNo?: string,
  ): Promise<{ prefix: string; suffix: number }>;
  createCase(
    caseData: Omit<InsertCase, "caseNumber"> & {
      caseNumber: string;
      createdBy: string;
    },
  ): Promise<Case>;
  getCaseById(caseId: string): Promise<Case | null>;
  getAssignedCasesForUser(user: User, search?: string): Promise<Case[]>;
  getAllCases(user?: User): Promise<CaseWithLatestProgress[]>;
  updateCase(
    caseId: string,
    caseData: Partial<InsertCase> & { caseNumber?: string },
  ): Promise<Case | null>;
  deleteCase(caseId: string): Promise<void>;
  updateCaseStatus(caseId: string, status: string): Promise<Case | null>;
  updateCaseSpecialNotes(
    caseId: string,
    specialNotes: string | null,
  ): Promise<Case | null>;
  confirmCaseSpecialNotes(
    caseId: string,
    confirmedBy: string,
  ): Promise<Case | null>;
  updateCaseAdditionalNotes(
    caseId: string,
    additionalNotes: string | null,
  ): Promise<Case | null>;
  updateCaseEstimateAmount(
    caseId: string,
    estimateAmount: string,
  ): Promise<Case | null>;
  submitFieldSurvey(caseId: string, estimateInfo?: { estimateTotal: string; isPrevention: boolean }): Promise<Case | null>;
  reviewCase(
    caseId: string,
    decision: "승인" | "비승인",
    reviewComment: string | null,
    reviewedBy: string,
  ): Promise<Case | null>;
  approveReport(
    caseId: string,
    decision: "승인" | "비승인",
    approvalComment: string | null,
    approvedBy: string,
  ): Promise<Case | null>;
  getPartnerStats(): Promise<PartnerStats[]>;
  createProgressUpdate(data: InsertProgressUpdate): Promise<ProgressUpdate>;
  getProgressUpdatesByCaseId(caseId: string): Promise<ProgressUpdate[]>;
  getStatisticsFilters(): Promise<StatisticsFilters>;
  getRolePermission(roleName: string): Promise<RolePermission | undefined>;
  saveRolePermission(data: InsertRolePermission): Promise<RolePermission>;
  deleteRolePermission(roleName: string): Promise<boolean>;
  getAllRolePermissions(): Promise<RolePermission[]>;
  listExcelData(type: string): Promise<ExcelData[]>;
  getExcelDataById(id: string): Promise<ExcelData | null>;
  saveExcelData(data: InsertExcelData): Promise<ExcelData>;
  updateExcelData(
    id: string,
    headers: string[],
    data: any[][],
  ): Promise<ExcelData | null>;
  deleteExcelDataById(id: string): Promise<boolean>;
  // Legacy methods (deprecated, for backward compatibility during migration)
  getExcelData(type: string): Promise<ExcelData | null>;
  deleteExcelData(type: string): Promise<void>;
  createInquiry(data: InsertInquiry): Promise<Inquiry>;
  getAllInquiries(): Promise<Inquiry[]>;
  getInquiriesByUserId(userId: string): Promise<Inquiry[]>;
  updateInquiry(
    id: string,
    data: Partial<UpdateInquiry>,
  ): Promise<Inquiry | null>;
  // Field Survey Data methods (shared by case group)
  getFieldSurveyData(caseGroupId: string): Promise<FieldSurveyData | null>;
  saveFieldSurveyData(data: InsertFieldSurveyData): Promise<FieldSurveyData>;
  updateFieldSurveyData(
    caseGroupId: string,
    data: Partial<InsertFieldSurveyData>,
  ): Promise<FieldSurveyData | null>;
  // Shared Drawing methods (shared by case group)
  getSharedDrawing(caseGroupId: string): Promise<SharedDrawing | null>;
  saveSharedDrawing(data: InsertSharedDrawing): Promise<SharedDrawing>;
  updateSharedDrawing(
    caseGroupId: string,
    data: Partial<InsertSharedDrawing>,
  ): Promise<SharedDrawing | null>;
  // Individual Drawing methods (case-specific leak markers)
  saveDrawing(data: InsertDrawing): Promise<Drawing>;
  getDrawing(id: string): Promise<Drawing | null>;
  getDrawingByCaseId(caseId: string): Promise<Drawing | null>;
  updateDrawing(
    id: string,
    data: Partial<InsertDrawing>,
  ): Promise<Drawing | null>;
  // Case group methods
  getCasesByGroupId(caseGroupId: string): Promise<Case[]>;
  // Same accident number methods (for field survey sync)
  getCasesByAccidentNo(
    accidentNo: string,
    excludeCaseId?: string,
  ): Promise<Case[]>;
  syncFieldSurveyToRelatedCases(
    sourceCaseId: string,
    fieldData: Partial<InsertCase>,
  ): Promise<number>;
  // Real-time sync methods for all field survey data (drawing, documents, estimates)
  syncDrawingToRelatedCases(sourceCaseId: string): Promise<number>;
  syncDocumentsToRelatedCases(
    sourceCaseId: string,
    newDocument: CaseDocument,
  ): Promise<number>;
  syncEstimateToRelatedCases(sourceCaseId: string): Promise<number>;
  // Case number helpers
  getPreventionCaseByPrefix(prefix: string): Promise<Case | null>;
  getNextVictimSuffix(prefix: string): Promise<number>;
  // Same prefix case sync (for intake data synchronization)
  getCasesByPrefix(prefix: string, excludeCaseId?: string): Promise<Case[]>;
  syncIntakeDataToRelatedCases(sourceCaseId: string): Promise<number>;
  // Copy field survey data from existing related case to new case
  copyFieldSurveyFromRelatedCase(newCaseId: string): Promise<boolean>;
  // Case helper for drawing persistence
  getOrCreateActiveCase(userId: string): Promise<Case>;
  // Document methods
  saveDocument(data: InsertCaseDocument): Promise<CaseDocument>;
  getDocument(id: string): Promise<CaseDocument | null>;
  getDocumentFileData(id: string): Promise<string | null>;
  getDocumentsByCaseId(caseId: string): Promise<CaseDocument[]>;
  deleteDocument(id: string): Promise<void>;
  deleteDocumentsByCaseId(caseId: string): Promise<number>;
  deleteDrawingByCaseId(caseId: string): Promise<boolean>;
  deleteEstimatesByCaseId(caseId: string): Promise<number>;
  resetCaseFieldSurveyData(caseId: string): Promise<void>;
  updateDocumentCategory(
    id: string,
    category: string,
  ): Promise<CaseDocument | null>;
  // Object Storage 기반 문서 업로드 메서드
  createPendingDocument(data: {
    caseId: string;
    category: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    storageKey: string;
    displayOrder?: number;
    createdBy: string;
  }): Promise<CaseDocument>;
  updateDocumentStatus(
    id: string,
    status: "pending" | "ready" | "failed",
    checksum?: string,
  ): Promise<CaseDocument | null>;
  // Estimate methods
  createEstimateVersion(
    caseId: string,
    userId: string,
    rows: Omit<InsertEstimateRow, "estimateId">[],
    laborCostData?: any | null,
    materialCostData?: any | null,
    vatIncluded?: boolean,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] }>;
  getLatestEstimate(
    caseId: string,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null>;
  getEstimateVersion(
    caseId: string,
    version: number,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null>;
  listEstimateVersions(caseId: string): Promise<Estimate[]>;
  // Master data methods
  getMasterData(
    category?: string,
    includeInactive?: boolean,
  ): Promise<MasterData[]>;
  createMasterData(data: InsertMasterData): Promise<MasterData>;
  deleteMasterData(id: string): Promise<void>;
  updateMasterData(
    id: string,
    data: Partial<InsertMasterData>,
  ): Promise<MasterData | null>;
  // Labor cost methods
  getLaborCosts(filters?: {
    category?: string;
    workName?: string;
    detailWork?: string;
  }): Promise<LaborCost[]>;
  getLaborCostOptions(): Promise<{
    categories: string[];
    workNamesByCategory: Record<string, string[]>;
    detailWorksByWork: Record<string, string[]>;
  }>;
  createLaborCost(data: InsertLaborCost): Promise<LaborCost>;
  deleteLaborCost(id: string): Promise<void>;
  // Material methods
  listMaterials(workType?: string): Promise<Material[]>;
  createMaterial(data: InsertMaterial): Promise<Material>;
  deleteMaterial(id: string): Promise<void>;
  // Excel-based materials catalog
  getMaterialsCatalog(): Promise<
    Array<{
      workType: string; // 공종
      workName: string; // 공사명
      materialName: string; // 자재항목
      specification: string;
      unit: string;
      standardPrice: number | string; // can be "입력" or number
    }>
  >;
  // User favorites methods
  getUserFavorites(userId: string): Promise<UserFavorite[]>;
  addFavorite(data: InsertUserFavorite): Promise<UserFavorite>;
  removeFavorite(userId: string, menuName: string): Promise<void>;
  // Notice methods
  getAllNotices(): Promise<Notice[]>;
  createNotice(data: InsertNotice): Promise<Notice>;
  updateNotice(
    id: string,
    data: { title: string; content: string },
  ): Promise<Notice | null>;
  deleteNotice(id: string): Promise<void>;
  deleteInquiry(id: string): Promise<void>;
  // Asset cloning methods (for syncing from related cases)
  getRelatedCaseWithDrawing(
    caseId: string,
  ): Promise<{ caseId: string; caseNumber: string } | null>;
  getAllRelatedCasesWithDrawings(
    caseId: string,
  ): Promise<Array<{ caseId: string; caseNumber: string; status: string | null }>>;
  getRelatedCaseWithEstimate(
    caseId: string,
  ): Promise<{ caseId: string; caseNumber: string } | null>;
  getRelatedCaseWithDocuments(
    caseId: string,
  ): Promise<{
    caseId: string;
    caseNumber: string;
    documentCount: number;
  } | null>;
  cloneDrawingFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<Drawing | null>;
  cloneEstimateFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null>;
  cloneDocumentsFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<CaseDocument[]>;
  // Case change log methods
  createCaseChangeLog(data: InsertCaseChangeLog): Promise<CaseChangeLog>;
  getCaseChangeLogs(caseId: string): Promise<CaseChangeLog[]>;
  getAllCaseChangeLogs(filters?: {
    caseNumber?: string;
    changedBy?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<(CaseChangeLog & { caseNumber: string })[]>;
  // Settlement methods
  createSettlement(data: InsertSettlement, createdBy: string): Promise<Settlement>;
  updateSettlement(id: string, data: Partial<InsertSettlement>): Promise<Settlement | null>;
  getSettlementsByCaseId(caseId: string): Promise<Settlement[]>;
  getLatestSettlementByCaseId(caseId: string): Promise<Settlement | null>;
  getAllSettlements(): Promise<Settlement[]>;
  // Labor rate tiers methods
  getLaborRateTiers(): Promise<LaborRateTier[]>;
  updateLaborRateTiers(tiers: UpdateLaborRateTier[]): Promise<LaborRateTier[]>;
  initializeLaborRateTiers(): Promise<void>;
  // Invoice methods
  createInvoice(data: InsertInvoice, createdBy: string): Promise<Invoice>;
  updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | null>;
  getInvoiceById(id: string): Promise<Invoice | null>;
  getInvoiceByCaseId(caseId: string): Promise<Invoice | null>;
  getInvoiceByCaseGroupPrefix(caseGroupPrefix: string): Promise<Invoice | null>;
  getAllInvoices(): Promise<Invoice[]>;
  getApprovedInvoices(): Promise<Invoice[]>;
  // Estimate exclusions methods (철거공사 노무비 삭제 영속화)
  getEstimateExclusions(caseId: string, exclusionType: string): Promise<EstimateExclusion[]>;
  addEstimateExclusion(data: InsertEstimateExclusion): Promise<EstimateExclusion>;
  removeEstimateExclusion(caseId: string, exclusionType: string, deletionKey: string): Promise<boolean>;
  recordStatusChange(caseId: string, previousStatus: string, newStatus: string): Promise<CaseStatusHistory>;
  getStatusHistoryByCaseId(caseId: string): Promise<CaseStatusHistory[]>;
  getAllStatusHistory(): Promise<CaseStatusHistory[]>;
}

// @deprecated - MemStorage is not used in production. Use DbStorage instead.
// Kept only for backward compatibility with functional in-memory implementations.
export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private cases: Map<string, Case>;
  private progressUpdates: Map<string, ProgressUpdate>;
  private rolePermissions: Map<string, RolePermission>;
  private excelData: Map<string, ExcelData>;
  private inquiries: Map<string, Inquiry>;
  private drawings: Map<string, Drawing>;
  private documents: Map<string, CaseDocument>;

  constructor() {
    this.users = new Map();
    this.cases = new Map();
    this.progressUpdates = new Map();
    this.rolePermissions = new Map();
    this.excelData = new Map();
    this.inquiries = new Map();
    this.drawings = new Map();
    this.documents = new Map();
    this.seedTestUser();
    this.seedTestCases();
  }

  private async seedTestUser() {
    const hashedPassword = await bcrypt.hash("1234", SALT_ROUNDS);
    const currentDate = getKSTDate();

    const testUsers: User[] = [
      // ===== 관리자 5명 =====
      {
        id: randomUUID(),
        username: "admin01",
        password: hashedPassword,
        role: "관리자",
        name: "김블락",
        company: "플록슨",
        department: "개발팀",
        position: "팀장",
        email: "admin01@floxn.com",
        phone: "010-1001-1001",
        office: "02-1001-1001",
        address: "서울 강남구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "admin02",
        password: hashedPassword,
        role: "관리자",
        name: "박영희",
        company: "플록슨",
        department: "기획팀",
        position: "부장",
        email: "admin02@floxn.com",
        phone: "010-1002-1002",
        office: "02-1002-1002",
        address: "서울 송파구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "admin03",
        password: hashedPassword,
        role: "관리자",
        name: "이현우",
        company: "플록슨",
        department: "인사팀",
        position: "차장",
        email: "admin03@floxn.com",
        phone: "010-1003-1003",
        office: "02-1003-1003",
        address: "서울 종로구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "admin04",
        password: hashedPassword,
        role: "관리자",
        name: "최지원",
        company: "플록슨",
        department: "운영팀",
        position: "과장",
        email: "admin04@floxn.com",
        phone: "010-1004-1004",
        office: "02-1004-1004",
        address: "서울 마포구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "admin05",
        password: hashedPassword,
        role: "관리자",
        name: "정수현",
        company: "플록슨",
        department: "총무팀",
        position: "대리",
        email: "admin05@floxn.com",
        phone: "010-1005-1005",
        office: "02-1005-1005",
        address: "서울 서초구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },

      // ===== 보험사 5명 =====
      {
        id: randomUUID(),
        username: "insure01",
        password: hashedPassword,
        role: "보험사",
        name: "김민준",
        company: "삼성화재",
        department: "사고접수팀",
        position: "팀장",
        email: "insure01@samsung.com",
        phone: "010-2001-2001",
        office: "02-2001-2001",
        address: "서울 강남구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "insure02",
        password: hashedPassword,
        role: "보험사",
        name: "이서윤",
        company: "현대해상",
        department: "보상팀",
        position: "차장",
        email: "insure02@hyundai.com",
        phone: "010-2002-2002",
        office: "02-2002-2002",
        address: "서울 중구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "insure03",
        password: hashedPassword,
        role: "보험사",
        name: "박도현",
        company: "DB손해보험",
        department: "사고처리팀",
        position: "과장",
        email: "insure03@db.com",
        phone: "010-2003-2003",
        office: "02-2003-2003",
        address: "서울 영등포구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "insure04",
        password: hashedPassword,
        role: "보험사",
        name: "최하은",
        company: "KB손해보험",
        department: "보상심사팀",
        position: "부장",
        email: "insure04@kb.com",
        phone: "010-2004-2004",
        office: "02-2004-2004",
        address: "서울 종로구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "insure05",
        password: hashedPassword,
        role: "보험사",
        name: "정예준",
        company: "메리츠화재",
        department: "사고조사팀",
        position: "대리",
        email: "insure05@meritz.com",
        phone: "010-2005-2005",
        office: "02-2005-2005",
        address: "서울 강동구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },

      // ===== 협력사 5명 =====
      {
        id: randomUUID(),
        username: "partner01",
        password: hashedPassword,
        role: "협력사",
        name: "강지훈",
        company: "AERO 파트너스",
        department: "현장조사팀",
        position: "팀장",
        email: "partner01@aero.com",
        phone: "010-9038-8918",
        office: "02-3001-3001",
        address: "서울 서초구",
        bankName: "국민은행",
        accountNumber: "123-456-000001",
        accountHolder: "강지훈",
        serviceRegions: ["서울시/강남구", "서초구", "송파구"],
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "partner02",
        password: hashedPassword,
        role: "협력사",
        name: "윤소희",
        company: "누수닥터",
        department: "복구팀",
        position: "차장",
        email: "partner02@doctor.com",
        phone: "010-3002-3002",
        office: "02-3002-3002",
        address: "서울 용산구",
        bankName: "신한은행",
        accountNumber: "234-567-000002",
        accountHolder: "윤소희",
        serviceRegions: ["서울시/종로구", "중구", "용산구"],
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "partner03",
        password: hashedPassword,
        role: "협력사",
        name: "장민서",
        company: "클린워터",
        department: "기술팀",
        position: "과장",
        email: "partner03@cleanwater.com",
        phone: "010-3003-3003",
        office: "02-3003-3003",
        address: "서울 마포구",
        bankName: "우리은행",
        accountNumber: "345-678-000003",
        accountHolder: "장민서",
        serviceRegions: ["서울시/마포구", "서대문구", "은평구"],
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "partner04",
        password: hashedPassword,
        role: "협력사",
        name: "임채원",
        company: "수리마스터",
        department: "시공팀",
        position: "팀장",
        email: "partner04@master.com",
        phone: "010-3004-3004",
        office: "02-3004-3004",
        address: "서울 강북구",
        bankName: "하나은행",
        accountNumber: "456-789-000004",
        accountHolder: "임채원",
        serviceRegions: ["서울시/강북구", "성북구", "노원구"],
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "partner05",
        password: hashedPassword,
        role: "협력사",
        name: "한유진",
        company: "복구전문가",
        department: "견적팀",
        position: "부장",
        email: "partner05@expert.com",
        phone: "010-3005-3005",
        office: "02-3005-3005",
        address: "경기 성남시",
        bankName: "농협은행",
        accountNumber: "567-890-000005",
        accountHolder: "한유진",
        serviceRegions: ["경기/성남시", "분당구", "수정구"],
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },

      // ===== 심사사 5명 =====
      {
        id: randomUUID(),
        username: "assessor01",
        password: hashedPassword,
        role: "심사사",
        name: "신동욱",
        company: "플록슨",
        department: "심사팀",
        position: "수석심사사",
        email: "assessor01@floxn.com",
        phone: "010-4001-4001",
        office: "02-4001-4001",
        address: "서울 강남구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "assessor02",
        password: hashedPassword,
        role: "심사사",
        name: "오서현",
        company: "플록슨",
        department: "심사팀",
        position: "책임심사사",
        email: "assessor02@floxn.com",
        phone: "010-4002-4002",
        office: "02-4002-4002",
        address: "서울 서초구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "assessor03",
        password: hashedPassword,
        role: "심사사",
        name: "배준영",
        company: "플록슨",
        department: "심사팀",
        position: "선임심사사",
        email: "assessor03@floxn.com",
        phone: "010-4003-4003",
        office: "02-4003-4003",
        address: "서울 송파구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "assessor04",
        password: hashedPassword,
        role: "심사사",
        name: "황시우",
        company: "플록슨",
        department: "심사팀",
        position: "심사사",
        email: "assessor04@floxn.com",
        phone: "010-4004-4004",
        office: "02-4004-4004",
        address: "서울 마포구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "assessor05",
        password: hashedPassword,
        role: "심사사",
        name: "서은비",
        company: "플록슨",
        department: "심사팀",
        position: "심사사",
        email: "assessor05@floxn.com",
        phone: "010-4005-4005",
        office: "02-4005-4005",
        address: "서울 강동구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },

      // ===== 조사사 5명 =====
      {
        id: randomUUID(),
        username: "investigator01",
        password: hashedPassword,
        role: "조사사",
        name: "안재현",
        company: "플록슨",
        department: "조사팀",
        position: "수석조사사",
        email: "investigator01@floxn.com",
        phone: "010-5001-5001",
        office: "02-5001-5001",
        address: "서울 강남구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "investigator02",
        password: hashedPassword,
        role: "조사사",
        name: "조아라",
        company: "플록슨",
        department: "조사팀",
        position: "책임조사사",
        email: "investigator02@floxn.com",
        phone: "010-5002-5002",
        office: "02-5002-5002",
        address: "서울 성동구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "investigator03",
        password: hashedPassword,
        role: "조사사",
        name: "홍민재",
        company: "플록슨",
        department: "조사팀",
        position: "선임조사사",
        email: "investigator03@floxn.com",
        phone: "010-5003-5003",
        office: "02-5003-5003",
        address: "서울 광진구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "investigator04",
        password: hashedPassword,
        role: "조사사",
        name: "허지안",
        company: "플록슨",
        department: "조사팀",
        position: "조사사",
        email: "investigator04@floxn.com",
        phone: "010-5004-5004",
        office: "02-5004-5004",
        address: "경기 성남시",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
      {
        id: randomUUID(),
        username: "investigator05",
        password: hashedPassword,
        role: "조사사",
        name: "송다빈",
        company: "플록슨",
        department: "조사팀",
        position: "조사사",
        email: "investigator05@floxn.com",
        phone: "010-5005-5005",
        office: "02-5005-5005",
        address: "서울 용산구",
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        serviceRegions: null,
        attachments: null,
        status: "active",
        createdAt: currentDate,
      },
    ];

    testUsers.forEach((user) => {
      this.users.set(user.id, user);
    });
  }

  private async seedTestCases() {
    const currentDate = getKSTDate();
    const usersArray = Array.from(this.users.values());

    // Get specific users for case assignment
    const adminUser = usersArray.find((u) => u.username === "admin01");
    const insuranceUser1 = usersArray.find((u) => u.username === "insure01");
    const insuranceUser2 = usersArray.find((u) => u.username === "insure02");
    const partner1 = usersArray.find((u) => u.username === "partner01");
    const partner2 = usersArray.find((u) => u.username === "partner02");
    const assessor1 = usersArray.find((u) => u.username === "assessor01");
    const assessor2 = usersArray.find((u) => u.username === "assessor02");

    if (!adminUser) return;

    const testCases: Case[] = [
      {
        id: randomUUID(),
        caseNumber: "CLM-25145136",
        status: "제출",
        accidentDate: "2025-01-15",
        insuranceCompany: "MG손해보험",
        insurancePolicyNo: "MG2024-12345",
        insuranceAccidentNo: "25219943",
        clientResidence: "서울 강남구",
        clientDepartment: "보상팀",
        clientName: "김블락",
        clientContact: "010-1234-5678",
        assessorId: assessor1?.id || null,
        assessorDepartment: "심사팀",
        assessorTeam: "1팀",
        assessorContact: "010-5555-6666",
        investigatorTeam: "조사1팀",
        investigatorDepartment: "현장조사",
        investigatorTeamName: "플록슨 조사팀",
        investigatorContact: "02-7777-8888",
        policyHolderName: "김블락",
        policyHolderIdNumber: "800101-1******",
        policyHolderAddress: "서울 강남구 테헤란로 123",
        insuredName: "김블락",
        insuredIdNumber: "800101-1******",
        insuredContact: "010-1234-5678",
        insuredAddress: "서울 강남구 테헤란로 123",
        victimName: "이웃집",
        victimContact: "010-9999-8888",
        clientPhone: "010-1234-5678",
        clientAddress: "서울 강남구 테헤란로 123",
        accidentLocation: "서울 강남구 테헤란로 123 아파트 1001호",
        accidentDescription: "화장실 배관 누수로 인한 천장 침수 피해",
        accidentType: "급배수 누수",
        accidentCause: "배관 노후",
        restorationMethod: "선견적요청",
        otherVendorEstimate: null,
        damageItems: JSON.stringify(["천장", "벽면", "바닥"]),
        assignedPartner: partner1?.company || null,
        assignedPartnerManager: partner1?.name || null,
        assignedPartnerContact: partner1?.phone || null,
        urgency: "보통",
        specialRequests: null,
        progressStatus: "서류보완요청",
        specialNotes: null,
        assignmentDate: null,
        siteVisitDate: null,
        fieldSurveyDate: null,
        firstInspectionDate: null,
        approvalCompletionDate: null,
        totalWorkDate: null,
        contractorReportDate: null,
        contractorRepairDate: null,
        completionDate: null,
        assignedTo: partner1?.id || null,
        createdBy: adminUser.id,
        createdAt: "2025-01-15",
        updatedAt: "2025-01-15",
      },
      {
        id: randomUUID(),
        caseNumber: "CLM-25145135",
        status: "검토중",
        accidentDate: "2025-01-14",
        insuranceCompany: "삼성화재",
        insurancePolicyNo: "SS2024-67890",
        insuranceAccidentNo: "25219942",
        clientResidence: "서울 서초구",
        clientDepartment: "보상팀",
        clientName: "박철수",
        clientContact: "010-2345-6789",
        assessorId: assessor2?.id || null,
        assessorDepartment: "심사팀",
        assessorTeam: "2팀",
        assessorContact: "010-6666-7777",
        investigatorTeam: "조사2팀",
        investigatorDepartment: "현장조사",
        investigatorTeamName: "플록슨 조사팀",
        investigatorContact: "02-8888-9999",
        policyHolderName: "박철수",
        policyHolderIdNumber: "750505-1******",
        policyHolderAddress: "서울 서초구 강남대로 456",
        insuredName: "박철수",
        insuredIdNumber: "750505-1******",
        insuredContact: "010-2345-6789",
        insuredAddress: "서울 서초구 강남대로 456",
        victimName: "아래층 주민",
        victimContact: "010-7777-6666",
        clientPhone: "010-2345-6789",
        clientAddress: "서울 서초구 강남대로 456",
        accidentLocation: "서울 서초구 강남대로 456 빌라 202호",
        accidentDescription: "싱크대 하수 배관 파손으로 인한 누수",
        accidentType: "급배수 누수",
        accidentCause: "부주의",
        restorationMethod: "플랫폼 복구",
        otherVendorEstimate: null,
        damageItems: JSON.stringify(["부엌", "벽면"]),
        assignedPartner: partner2?.company || null,
        assignedPartnerManager: partner2?.name || null,
        assignedPartnerContact: partner2?.phone || null,
        urgency: "긴급",
        specialRequests: null,
        progressStatus: "서류보완요청",
        specialNotes: null,
        assignmentDate: null,
        siteVisitDate: null,
        fieldSurveyDate: null,
        firstInspectionDate: null,
        approvalCompletionDate: null,
        totalWorkDate: null,
        contractorReportDate: null,
        contractorRepairDate: null,
        completionDate: null,
        assignedTo: partner2?.id || null,
        createdBy: adminUser.id,
        createdAt: "2025-01-14",
        updatedAt: "2025-01-14",
      },
      {
        id: randomUUID(),
        caseNumber: "CLM-25145134",
        status: "작성중",
        accidentDate: "2025-01-13",
        insuranceCompany: "현대해상",
        insurancePolicyNo: "HD2024-11111",
        insuranceAccidentNo: "25219941",
        clientResidence: "경기 성남시",
        clientDepartment: "보상팀",
        clientName: "이미라",
        clientContact: "010-3456-7890",
        assessorId: assessor1?.id || null,
        assessorDepartment: "심사팀",
        assessorTeam: "1팀",
        assessorContact: "010-5555-6666",
        investigatorTeam: "조사1팀",
        investigatorDepartment: "현장조사",
        investigatorTeamName: "플록슨 조사팀",
        investigatorContact: "02-7777-8888",
        policyHolderName: "이미라",
        policyHolderIdNumber: "900303-2******",
        policyHolderAddress: "경기 성남시 분당구 789",
        insuredName: "이미라",
        insuredIdNumber: "900303-2******",
        insuredContact: "010-3456-7890",
        insuredAddress: "경기 성남시 분당구 789",
        victimName: "옆집",
        victimContact: "010-5555-4444",
        clientPhone: "010-3456-7890",
        clientAddress: "경기 성남시 분당구 789",
        accidentLocation: "경기 성남시 분당구 789 아파트 506호",
        accidentDescription: "보일러 배관 동파로 인한 누수 사고",
        accidentType: "난방 누수",
        accidentCause: "동파",
        restorationMethod: "없음",
        otherVendorEstimate: null,
        damageItems: JSON.stringify(["보일러실", "복도", "바닥"]),
        assignedPartner: partner1?.company || null,
        assignedPartnerManager: partner1?.name || null,
        assignedPartnerContact: partner1?.phone || null,
        urgency: "낮음",
        specialRequests: "겨울철 동파 예방 조치 필요",
        progressStatus: "선견적요청",
        specialNotes: null,
        assignmentDate: null,
        siteVisitDate: null,
        fieldSurveyDate: null,
        firstInspectionDate: null,
        approvalCompletionDate: null,
        totalWorkDate: null,
        contractorReportDate: null,
        contractorRepairDate: null,
        completionDate: null,
        assignedTo: partner1?.id || null,
        createdBy: adminUser.id,
        createdAt: "2025-01-13",
        updatedAt: "2025-01-13",
      },
    ];

    testCases.forEach((testCase) => {
      this.cases.set(testCase.id, testCase);
    });
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getAllUsers(): Promise<User[]> {
    // Return all active users (not soft-deleted)
    return Array.from(this.users.values()).filter(
      (user) => user.status === "active",
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const hashedPassword = await bcrypt.hash(insertUser.password, SALT_ROUNDS);
    const id = randomUUID();
    const createdAt = getKSTDate();
    const user: User = {
      id,
      username: insertUser.username,
      password: hashedPassword,
      role: insertUser.role || "사원",
      name: insertUser.name,
      company: insertUser.company,
      department: insertUser.department || null,
      position: insertUser.position || null,
      email: insertUser.email || null,
      phone: insertUser.phone || null,
      office: insertUser.office || null,
      address: insertUser.address || null,
      bankName: insertUser.bankName || null,
      accountNumber: insertUser.accountNumber || null,
      accountHolder: insertUser.accountHolder || null,
      serviceRegions: insertUser.serviceRegions || null,
      attachments: insertUser.attachments || null,
      status: insertUser.status || "active",
      createdAt,
    };
    this.users.set(id, user);
    return user;
  }

  async verifyPassword(
    username: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return null;
    }

    // Block login for deleted accounts (soft delete)
    if (user.status === "deleted") {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    return isValid ? user : null;
  }

  async updatePassword(
    username: string,
    newPassword: string,
  ): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return null;
    }

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const updatedUser: User = {
      ...user,
      password: hashedPassword,
    };
    this.users.set(user.id, updatedUser);
    return updatedUser;
  }

  async reactivateAccount(username: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return null;
    }

    const reactivatedUser: User = {
      ...user,
      status: "active",
    };
    this.users.set(user.id, reactivatedUser);
    return reactivatedUser;
  }

  async updateUser(userId: string, userData: Partial<Omit<User, 'id' | 'username' | 'password' | 'company' | 'createdAt' | 'status'>>): Promise<User | null> {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }

    const updatedUser: User = {
      ...user,
      ...userData,
    };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async updateUserMustChangePassword(userId: string, mustChangePassword: boolean): Promise<User | null> {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }

    const updatedUser: User = {
      ...user,
      mustChangePassword,
    };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async deleteAccount(username: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return null;
    }

    // Soft delete: update status to "deleted" instead of removing from storage
    const deletedUser: User = {
      ...user,
      status: "deleted",
    };
    this.users.set(user.id, deletedUser);
    return deletedUser;
  }

  async getCaseById(caseId: string): Promise<Case | null> {
    return this.cases.get(caseId) || null;
  }

  async getAssignedCasesForUser(user: User, search?: string): Promise<Case[]> {
    const allCases = Array.from(this.cases.values());

    // Filter by role (accountType: "개인" = 본인 건만, "회사" = 회사 전체건)
    let filtered = allCases;
    const isPersonal = user.accountType === "개인";
    switch (user.role) {
      case "심사사":
        if (isPersonal) {
          filtered = allCases.filter((c) => c.assessorId === user.company && c.assessorTeam === user.name);
        } else {
          filtered = allCases.filter((c) => c.assessorId === user.company);
        }
        break;
      case "협력사":
        if (isPersonal) {
          filtered = allCases.filter((c) =>
            c.assignedPartner === user.company && c.status !== "배당대기" &&
            (c.assignedPartnerManager === user.name || c.createdBy === user.id || c.assignedTo === user.id)
          );
        } else {
          filtered = allCases.filter(
            (c) => c.assignedPartner === user.company && c.status !== "배당대기",
          );
        }
        break;
      case "조사사":
        if (isPersonal) {
          filtered = allCases.filter((c) => c.investigatorTeam === user.company && c.investigatorTeamName === user.name);
        } else {
          filtered = allCases.filter(
            (c) => c.investigatorTeam === user.company,
          );
        }
        break;
      case "보험사":
        if (isPersonal) {
          filtered = allCases.filter((c) =>
            c.insuranceCompany === user.company &&
            (c.managerId === user.id || c.createdBy === user.id)
          );
        } else {
          filtered = allCases.filter((c) => c.insuranceCompany === user.company);
        }
        break;
      case "관리자":
        break;
      default:
        return [];
    }

    // Apply search if provided
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.caseNumber?.toLowerCase().includes(searchLower) ||
          c.insuredName?.toLowerCase().includes(searchLower) ||
          c.insuranceCompany?.toLowerCase().includes(searchLower),
      );
    }

    return filtered;
  }

  async getNextCaseSequence(
    date: string,
    insuranceAccidentNo?: string,
  ): Promise<{ prefix: string; suffix: number }> {
    // Step 1: Check if there are existing cases with the same insurance accident number
    if (insuranceAccidentNo) {
      const existingCases = await db
        .select({ caseNumber: cases.caseNumber })
        .from(cases)
        .where(eq(cases.insuranceAccidentNo, insuranceAccidentNo));

      if (existingCases.length > 0) {
        // Extract prefix from first existing case (yyMMddxxx part)
        const firstCaseNumber = existingCases[0].caseNumber;
        if (firstCaseNumber) {
          const parts = firstCaseNumber.split("-");
          if (parts.length >= 2) {
            const prefix = parts[0]; // "251124001"

            // Find max suffix for this prefix
            let maxSuffix = -1;
            for (const c of existingCases) {
              if (c.caseNumber && c.caseNumber.startsWith(prefix + "-")) {
                const suffixStr = c.caseNumber.split("-")[1];
                const suffix = parseInt(suffixStr, 10);
                if (!isNaN(suffix) && suffix > maxSuffix) {
                  maxSuffix = suffix;
                }
              }
            }

            return { prefix, suffix: maxSuffix + 1 };
          }
        }
      }
    }

    // Step 2: No existing cases with same accident number - generate new prefix
    // Convert YYYY-MM-DD to yyMMdd (6 digits)
    const dateParts = date.split("-");
    const year = dateParts[0].substring(2); // YY (last 2 digits)
    const month = dateParts[1]; // MM
    const day = dateParts[2]; // dd
    const datePrefix = year + month + day; // yyMMdd

    // Query database for cases with case numbers starting with datePrefix
    const allCases = await db
      .select({ caseNumber: cases.caseNumber })
      .from(cases)
      .where(sql`${cases.caseNumber} LIKE ${datePrefix + "%"}`);

    let maxSequence = 0;
    for (const c of allCases) {
      if (c.caseNumber && c.caseNumber.startsWith(datePrefix)) {
        const parts = c.caseNumber.split("-");
        if (parts.length >= 1) {
          const sequencePart = parts[0].substring(6); // Extract XXX from yyMMddxxx
          const seq = parseInt(sequencePart, 10);
          if (!isNaN(seq) && seq > maxSequence) {
            maxSequence = seq;
          }
        }
      }
    }

    const nextSequence = maxSequence + 1;
    const seqStr = String(nextSequence).padStart(3, "0");
    const prefix = `${datePrefix}${seqStr}`; // e.g., "251124001"

    return { prefix, suffix: 0 };
  }

  async createCase(
    caseData: Omit<InsertCase, "caseNumber"> & {
      caseNumber: string;
      createdBy: string;
    },
  ): Promise<Case> {
    const currentDate = getKSTDate();
    const status = caseData.status || "작성중";

    // 상태에 따라 자동으로 날짜 기록 (케이스 생성 시)
    let autoReceptionDate = caseData.receptionDate || null;
    let autoAssignmentDate = caseData.assignmentDate || null;

    if (status === "접수완료") {
      // 접수완료 상태로 생성 시 접수일과 배당일 자동 기록 (기존 값 없을 때만)
      if (!autoReceptionDate) {
        autoReceptionDate = currentDate;
      }
      if (!autoAssignmentDate) {
        autoAssignmentDate = currentDate;
      }
    }

    // Insert into database and get the created case
    const [newCase] = await db
      .insert(cases)
      .values({
        caseNumber: caseData.caseNumber,
        status: status,
        accidentDate: caseData.accidentDate || null,
        insuranceCompany: caseData.insuranceCompany || null,
        insurancePolicyNo: caseData.insurancePolicyNo || null,
        insuranceAccidentNo: caseData.insuranceAccidentNo || null,
        clientResidence: caseData.clientResidence || null,
        clientDepartment: caseData.clientDepartment || null,
        clientName: caseData.clientName || null,
        clientContact: caseData.clientContact || null,
        assessorId: caseData.assessorId || null,
        assessorDepartment: caseData.assessorDepartment || null,
        assessorTeam: caseData.assessorTeam || null,
        assessorContact: caseData.assessorContact || null,
        investigatorTeam: caseData.investigatorTeam || null,
        investigatorDepartment: caseData.investigatorDepartment || null,
        investigatorTeamName: caseData.investigatorTeamName || null,
        investigatorContact: caseData.investigatorContact || null,
        policyHolderName: caseData.policyHolderName || null,
        policyHolderIdNumber: caseData.policyHolderIdNumber || null,
        policyHolderAddress: caseData.policyHolderAddress || null,
        insuredName: caseData.insuredName || null,
        insuredIdNumber: caseData.insuredIdNumber || null,
        insuredContact: caseData.insuredContact || null,
        insuredAddress: caseData.insuredAddress || null,
        insuredAddressDetail: caseData.insuredAddressDetail || null,
        sameAsPolicyHolder:
          caseData.sameAsPolicyHolder != null
            ? String(caseData.sameAsPolicyHolder)
            : null,
        victimName: caseData.victimName || null,
        victimContact: caseData.victimContact || null,
        victimAddress: caseData.victimAddress || null,
        victimAddressDetail: caseData.victimAddressDetail || null,
        additionalVictims: caseData.additionalVictims || null,
        clientPhone: caseData.clientPhone || null,
        clientAddress: caseData.clientAddress || null,
        accidentLocation: caseData.accidentLocation || null,
        accidentDescription: caseData.accidentDescription || null,
        accidentType: caseData.accidentType || null,
        accidentCause: caseData.accidentCause || null,
        recoveryType: caseData.recoveryType || null,
        restorationMethod: caseData.restorationMethod || null,
        otherVendorEstimate: caseData.otherVendorEstimate || null,
        damagePreventionCost: caseData.damagePreventionCost || null,
        victimIncidentAssistance: caseData.victimIncidentAssistance || null,
        damageItems: caseData.damageItems || null,
        assignedPartner: caseData.assignedPartner || null,
        assignedPartnerManager: caseData.assignedPartnerManager || null,
        assignedPartnerContact: caseData.assignedPartnerContact || null,
        urgency: caseData.urgency || null,
        specialRequests: caseData.specialRequests || null,
        progressStatus: caseData.progressStatus || null,
        specialNotes: caseData.specialNotes || null,
        receptionDate: autoReceptionDate,
        assignmentDate: autoAssignmentDate,
        siteVisitDate: caseData.siteVisitDate || null,
        fieldSurveyDate: caseData.fieldSurveyDate || null,
        firstInspectionDate: caseData.firstInspectionDate || null,
        approvalCompletionDate: caseData.approvalCompletionDate || null,
        totalWorkDate: caseData.totalWorkDate || null,
        contractorReportDate: caseData.contractorReportDate || null,
        contractorRepairDate: caseData.contractorRepairDate || null,
        completionDate: caseData.completionDate || null,
        assignedTo: caseData.assignedTo || null,
        managerId: caseData.managerId || null,
        createdBy: caseData.createdBy,
        createdAt: currentDate,
        updatedAt: currentDate,
      })
      .returning();

    return newCase;
  }

  async getAllCases(user?: User): Promise<CaseWithLatestProgress[]> {
    // Fetch all cases from database instead of memory
    let allCases = await db.select().from(cases);

    // 권한별 필터링 (accountType: "개인" = 본인 건만, "회사" = 회사 전체건)
    if (user) {
      const isPersonal = user.accountType === "개인";
      switch (user.role) {
        case "관리자":
          break;
        case "협력사":
          if (isPersonal) {
            allCases = allCases.filter((c) =>
              c.assignedPartner === user.company &&
              (c.assignedPartnerManager === user.name || c.createdBy === user.id || c.assignedTo === user.id)
            );
          } else {
            allCases = allCases.filter((c) => c.assignedPartner === user.company);
          }
          break;
        case "보험사":
          if (isPersonal) {
            allCases = allCases.filter((c) =>
              c.insuranceCompany === user.company &&
              (c.managerId === user.id || c.createdBy === user.id)
            );
          } else {
            allCases = allCases.filter((c) => c.insuranceCompany === user.company);
          }
          break;
        case "심사사":
          if (isPersonal) {
            allCases = allCases.filter((c) => c.assessorId === user.company && c.assessorTeam === user.name);
          } else {
            allCases = allCases.filter((c) => c.assessorId === user.company);
          }
          break;
        case "조사사":
          if (isPersonal) {
            allCases = allCases.filter((c) => c.investigatorTeam === user.company && c.investigatorTeamName === user.name);
          } else {
            allCases = allCases.filter((c) => c.investigatorTeam === user.company);
          }
          break;
        case "의뢰사":
          if (isPersonal) {
            allCases = allCases.filter((c) => c.clientName === user.name);
          } else {
            allCases = allCases.filter((c) => c.clientResidence === user.company);
          }
          break;
        default:
          allCases = [];
      }
    }

    // createdAt 기준 오름차순 정렬 (가장 오래된 것부터)
    allCases.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // 모든 사용자 정보 가져오기 (담당자 이름 조회용)
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    // 각 케이스의 최신 진행상황 및 담당자 이름 찾기
    const casesWithProgress: CaseWithLatestProgress[] = allCases.map(
      (caseItem) => {
        // 해당 케이스의 모든 진행상황 찾기
        const caseUpdates = Array.from(this.progressUpdates.values())
          .filter((update) => update.caseId === caseItem.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // 최신순 정렬

        // 최신 진행상황
        const latestUpdate = caseUpdates[0];

        // 담당자 이름 조회
        const manager = caseItem.managerId
          ? userMap.get(caseItem.managerId)
          : null;

        return {
          ...caseItem,
          latestProgress: latestUpdate
            ? {
                content: latestUpdate.content,
                createdAt: latestUpdate.createdAt,
              }
            : null,
          managerName: manager?.name || null,
        };
      },
    );

    return casesWithProgress;
  }

  async updateCase(
    caseId: string,
    caseData: Partial<InsertCase> & { caseNumber?: string },
  ): Promise<Case | null> {
    const caseItem = this.cases.get(caseId);
    if (!caseItem) {
      return null;
    }

    const currentDate = getKSTDate();

    // 배당 협력사 저장 시 assignmentDate 자동 기록 (기존 값이 없을 때만)
    const additionalUpdates: Partial<Case> = {};
    if (caseData.assignedPartner && !caseItem.assignmentDate) {
      additionalUpdates.assignmentDate = currentDate;
    }

    const updatedCase: Case = {
      ...caseItem,
      ...caseData,
      ...additionalUpdates,
      updatedAt: currentDate,
    };

    this.cases.set(caseId, updatedCase);
    return updatedCase;
  }

  async deleteCase(caseId: string): Promise<void> {
    this.cases.delete(caseId);
  }

  async updateCaseStatus(caseId: string, status: string): Promise<Case | null> {
    const caseItem = this.cases.get(caseId);
    if (!caseItem) {
      return null;
    }

    const currentDate = getKSTDate();

    // 미복구 선택 시 자동으로 출동비 청구로 정규화
    const normalizedStatus = status === "미복구" ? "출동비 청구" : status;

    // 상태에 따라 자동으로 날짜 기록 (기존 값이 없을 때만)
    const dateUpdates: Partial<Case> = {};

    switch (normalizedStatus) {
      case "접수완료":
        // 접수일과 배당일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.receptionDate) {
          dateUpdates.receptionDate = currentDate;
        }
        if (!caseItem.assignmentDate) {
          dateUpdates.assignmentDate = currentDate;
        }
        break;
      case "현장방문":
        // 현장방문일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.siteVisitDate) {
          dateUpdates.siteVisitDate = currentDate;
        }
        break;
      case "현장정보입력":
      case "현장정보제출":
        // 현장자료 제출일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.siteInvestigationSubmitDate) {
          dateUpdates.siteInvestigationSubmitDate = currentDate;
        }
        break;
      case "1차승인":
        // 1차 승인일(내부) 자동 기록 (기존 값 없을 때만)
        if (!caseItem.firstApprovalDate) {
          dateUpdates.firstApprovalDate = currentDate;
        }
        break;
      case "복구요청(2차승인)":
        // 2차 승인일(복구 요청일) 자동 기록 (기존 값 없을 때만)
        if (!caseItem.secondApprovalDate) {
          dateUpdates.secondApprovalDate = currentDate;
        }
        // 2차 승인 시점의 견적금액을 승인금액으로 자동 저장 (항상 덮어씀)
        if (caseItem.estimateAmount) {
          dateUpdates.approvedAmount = caseItem.estimateAmount;
        }
        break;
      case "직접복구":
      case "청구자료제출(복구)":
        // 직접복구/청구자료제출 시 복구완료일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.constructionCompletionDate) {
          dateUpdates.constructionCompletionDate = currentDate;
        }
        break;
      case "선견적요청":
      case "출동비청구(선견적)":
        // 선견적요청은 실제 복구를 하지 않으므로 복구완료일은 공란으로 유지
        // 청구일만 자동 기록 (기존 값 없을 때만)
        if (!caseItem.claimDate) {
          dateUpdates.claimDate = currentDate;
        }
        break;
      case "청구":
        // 청구일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.claimDate) {
          dateUpdates.claimDate = currentDate;
        }
        break;
      case "입금완료":
        // 입금완료일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.paymentCompletedDate) {
          dateUpdates.paymentCompletedDate = currentDate;
        }
        break;
      case "부분입금":
        // 일부입금일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.partialPaymentDate) {
          dateUpdates.partialPaymentDate = currentDate;
        }
        break;
      case "정산완료":
        // 정산완료일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.settlementCompletedDate) {
          dateUpdates.settlementCompletedDate = currentDate;
        }
        break;
      case "접수취소":
        // 접수취소일 자동 기록 (기존 값 없을 때만)
        if (!caseItem.cancellationDate) {
          dateUpdates.cancellationDate = currentDate;
        }
        break;
    }

    // 상태에 따라 recoveryType 자동 설정
    let recoveryTypeUpdate: Partial<Case> = {};
    if (normalizedStatus === "직접복구" || normalizedStatus === "청구자료제출(복구)") {
      recoveryTypeUpdate.recoveryType = "직접복구";
    } else if (normalizedStatus === "선견적요청" || normalizedStatus === "출동비청구(선견적)") {
      recoveryTypeUpdate.recoveryType = "선견적요청";
    }

    const updatedCase: Case = {
      ...caseItem,
      status: normalizedStatus,
      updatedAt: currentDate,
      ...dateUpdates,
      ...recoveryTypeUpdate,
    };

    this.cases.set(caseId, updatedCase);
    return updatedCase;
  }

  async updateCaseSpecialNotes(
    caseId: string,
    specialNotes: string | null,
  ): Promise<Case | null> {
    const caseItem = this.cases.get(caseId);
    if (!caseItem) {
      return null;
    }

    const updatedCase: Case = {
      ...caseItem,
      specialNotes,
      specialNotesConfirmedBy: null, // Reset confirmation when notes are updated
      updatedAt: getKSTDate(),
    };

    this.cases.set(caseId, updatedCase);
    return updatedCase;
  }

  async confirmCaseSpecialNotes(
    caseId: string,
    confirmedBy: string,
  ): Promise<Case | null> {
    const caseItem = this.cases.get(caseId);
    if (!caseItem) {
      return null;
    }

    const updatedCase: Case = {
      ...caseItem,
      specialNotesConfirmedBy: confirmedBy,
      updatedAt: getKSTDate(),
    };

    this.cases.set(caseId, updatedCase);
    return updatedCase;
  }

  async updateCaseAdditionalNotes(
    caseId: string,
    additionalNotes: string | null,
  ): Promise<Case | null> {
    const caseItem = this.cases.get(caseId);
    if (!caseItem) {
      return null;
    }

    const updatedCase: Case = {
      ...caseItem,
      additionalNotes,
      updatedAt: getKSTDate(),
    };

    this.cases.set(caseId, updatedCase);
    return updatedCase;
  }

  async updateCaseEstimateAmount(
    caseId: string,
    estimateAmount: string,
  ): Promise<Case | null> {
    const caseItem = this.cases.get(caseId);
    if (!caseItem) {
      return null;
    }

    const updatedCase: Case = {
      ...caseItem,
      estimateAmount,
      updatedAt: getKSTDate(),
    };

    this.cases.set(caseId, updatedCase);
    return updatedCase;
  }

  async submitFieldSurvey(caseId: string, estimateInfo?: { estimateTotal: string; isPrevention: boolean }): Promise<Case | null> {
    const caseItem = this.cases.get(caseId);
    if (!caseItem) {
      return null;
    }

    // 최초 견적금액 기록 (MemStorage - 기존 estimateAmount 사용)
    let initialEstimateAmount = caseItem.initialEstimateAmount;
    if (!initialEstimateAmount && caseItem.estimateAmount) {
      initialEstimateAmount = caseItem.estimateAmount;
    }
    
    // 초기 손해방지/대물비용 기록 (첫 제출 시점만)
    let initialPreventionEstimateAmount = caseItem.initialPreventionEstimateAmount;
    let initialPropertyEstimateAmount = caseItem.initialPropertyEstimateAmount;
    
    if (estimateInfo) {
      if (estimateInfo.isPrevention && !initialPreventionEstimateAmount) {
        initialPreventionEstimateAmount = estimateInfo.estimateTotal;
      } else if (!estimateInfo.isPrevention && !initialPropertyEstimateAmount) {
        initialPropertyEstimateAmount = estimateInfo.estimateTotal;
      }
    }

    const updatedCase: Case = {
      ...caseItem,
      fieldSurveyStatus: "submitted",
      status: "검토중",
      // 재제출 시 심사 정보 초기화 (관리자가 다시 심사할 수 있도록)
      reviewDecision: null,
      reviewComment: null,
      reviewedAt: null,
      reviewedBy: null,
      // 재제출 시 보고서 승인 정보도 초기화 (2차 심사도 다시 진행하도록)
      reportApprovalDecision: null,
      reportApprovalComment: null,
      reportApprovedAt: null,
      reportApprovedBy: null,
      initialEstimateAmount: initialEstimateAmount,
      initialPreventionEstimateAmount: initialPreventionEstimateAmount,
      initialPropertyEstimateAmount: initialPropertyEstimateAmount,
      updatedAt: getKSTDate(),
    };

    this.cases.set(caseId, updatedCase);
    return updatedCase;
  }

  async reviewCase(
    caseId: string,
    decision: "승인" | "비승인",
    reviewComment: string | null,
    reviewedBy: string,
  ): Promise<Case | null> {
    const caseItem = this.cases.get(caseId);
    if (!caseItem) {
      return null;
    }

    // 1차승인 시 승인금액 확정 (최신 견적 총액을 승인금액으로)
    // MemStorage에서는 getLatestEstimate가 구현되지 않으므로 estimateAmount 사용
    let approvedAmount = caseItem.approvedAmount;
    if (decision === "승인" && !caseItem.firstApprovalDate) {
      // MemStorage에서는 견적 기능이 없으므로 기존 estimateAmount 사용
      if (caseItem.estimateAmount) {
        approvedAmount = caseItem.estimateAmount;
      }
    }

    const updatedCase: Case = {
      ...caseItem,
      reviewDecision: decision,
      reviewComment: reviewComment || null,
      reviewedAt: getKSTTimestamp(),
      reviewedBy: reviewedBy,
      status: decision === "승인" ? "1차승인" : "반려",
      firstApprovalDate: decision === "승인" && !caseItem.firstApprovalDate ? getKSTDate() : caseItem.firstApprovalDate,
      approvedAmount: approvedAmount,
      updatedAt: getKSTDate(),
    };

    this.cases.set(caseId, updatedCase);
    return updatedCase;
  }

  async getPartnerStats(): Promise<PartnerStats[]> {
    const allCases = Array.from(this.cases.values());
    const allUsers = Array.from(this.users.values());
    const partners = allUsers.filter((u) => u.role === "협력사");

    const today = getKSTDate();
    const currentMonth = today.substring(0, 7); // YYYY-MM

    return partners.map((partner) => {
      const partnerCases = allCases.filter(
        (c) => c.assignedPartner === partner.company,
      );

      const dailyCount = partnerCases.filter(
        (c) => c.createdAt === today,
      ).length;
      const monthlyCount = partnerCases.filter((c) =>
        c.createdAt?.startsWith(currentMonth),
      ).length;
      const inProgressCount = partnerCases.filter(
        (c) => c.status !== "작성중" && c.status !== "완료",
      ).length;
      const pendingCount = partnerCases.filter(
        (c) => c.status !== "완료",
      ).length;

      return {
        partnerName: partner.company,
        dailyCount,
        monthlyCount,
        inProgressCount,
        pendingCount,
      };
    });
  }

  async createProgressUpdate(
    data: InsertProgressUpdate,
  ): Promise<ProgressUpdate> {
    const id = randomUUID();
    const currentTimestamp = getKSTTimestamp();

    const newUpdate: ProgressUpdate = {
      id,
      caseId: data.caseId,
      content: data.content,
      createdBy: data.createdBy,
      createdAt: currentTimestamp,
    };

    this.progressUpdates.set(id, newUpdate);
    return newUpdate;
  }

  async getProgressUpdatesByCaseId(caseId: string): Promise<ProgressUpdate[]> {
    const updates = Array.from(this.progressUpdates.values()).filter(
      (u) => u.caseId === caseId,
    );
    return updates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getStatisticsFilters(): Promise<StatisticsFilters> {
    // Get unique insurance companies from cases
    const insuranceCompaniesSet = new Set<string>();
    Array.from(this.cases.values()).forEach((caseItem) => {
      if (caseItem.insuranceCompany) {
        insuranceCompaniesSet.add(caseItem.insuranceCompany);
      }
    });

    // Get unique company names by role from users
    const assessorsSet = new Set<string>();
    const investigatorsSet = new Set<string>();
    const partnersSet = new Set<string>();
    const settlementManagersSet = new Set<string>();

    Array.from(this.users.values()).forEach((user) => {
      if (user.status !== "active") return; // Only include active users

      if (user.role === "심사사" && user.company) {
        assessorsSet.add(user.company);
      } else if (user.role === "조사사" && user.company) {
        investigatorsSet.add(user.company);
      } else if (user.role === "협력사" && user.company) {
        partnersSet.add(user.company);
      }

      // Add all active users as potential settlement managers
      if (user.name) {
        settlementManagersSet.add(user.name);
      }
    });

    // Convert to sorted arrays
    return {
      insuranceCompanies: Array.from(insuranceCompaniesSet).sort(),
      assessors: Array.from(assessorsSet).sort(),
      investigators: Array.from(investigatorsSet).sort(),
      partners: Array.from(partnersSet).sort(),
      settlementManagers: Array.from(settlementManagersSet).sort(),
    };
  }

  async getRolePermission(
    roleName: string,
  ): Promise<RolePermission | undefined> {
    return this.rolePermissions.get(roleName);
  }

  async saveRolePermission(
    data: InsertRolePermission,
  ): Promise<RolePermission> {
    const currentDate = getKSTTimestamp();
    const existing = this.rolePermissions.get(data.roleName);

    const rolePermission: RolePermission = {
      id: existing?.id || randomUUID(),
      roleName: data.roleName,
      permissions: data.permissions,
      createdAt: existing?.createdAt || currentDate,
      updatedAt: currentDate,
    };

    this.rolePermissions.set(data.roleName, rolePermission);
    return rolePermission;
  }

  async deleteRolePermission(roleName: string): Promise<boolean> {
    return this.rolePermissions.delete(roleName);
  }

  async getAllRolePermissions(): Promise<RolePermission[]> {
    return Array.from(this.rolePermissions.values());
  }

  // Excel Data methods (in-memory implementation)
  async listExcelData(type: string): Promise<ExcelData[]> {
    const allData = Array.from(this.excelData.values());
    return allData
      .filter((item) => item.type === type)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }

  async getExcelDataById(id: string): Promise<ExcelData | null> {
    return this.excelData.get(id) || null;
  }

  async deleteExcelDataById(id: string): Promise<boolean> {
    return this.excelData.delete(id);
  }

  async saveExcelData(data: InsertExcelData): Promise<ExcelData> {
    const currentDate = new Date();
    const newData: ExcelData = {
      id: randomUUID(),
      type: data.type,
      title: data.title,
      headers: data.headers as any,
      data: data.data as any,
      uploadedAt: currentDate,
      updatedAt: currentDate,
    };
    this.excelData.set(newData.id, newData);
    return newData;
  }

  async updateExcelData(
    id: string,
    headers: string[],
    data: any[][],
  ): Promise<ExcelData | null> {
    const existing = this.excelData.get(id);
    if (!existing) return null;
    const updated: ExcelData = {
      ...existing,
      headers: headers as any,
      data: data as any,
      updatedAt: new Date(),
    };
    this.excelData.set(id, updated);
    return updated;
  }

  // Legacy methods
  async getExcelData(type: string): Promise<ExcelData | null> {
    const versions = await this.listExcelData(type);
    return versions[0] || null;
  }

  async deleteExcelData(type: string): Promise<void> {
    const allData = Array.from(this.excelData.values());
    const toDelete = allData.filter((item) => item.type === type);
    toDelete.forEach((item) => this.excelData.delete(item.id));
  }

  // Inquiry methods (in-memory implementation)
  async createInquiry(data: InsertInquiry): Promise<Inquiry> {
    const currentDate = new Date();
    const newInquiry: Inquiry = {
      id: randomUUID(),
      userId: data.userId,
      title: data.title,
      content: data.content,
      status: data.status || "대기",
      response: data.response || null,
      respondedBy: data.respondedBy || null,
      respondedAt: data.respondedAt || null,
      createdAt: currentDate,
      updatedAt: currentDate,
    };
    this.inquiries.set(newInquiry.id, newInquiry);
    return newInquiry;
  }

  async getAllInquiries(): Promise<Inquiry[]> {
    return Array.from(this.inquiries.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async getInquiriesByUserId(userId: string): Promise<Inquiry[]> {
    const allInquiries = Array.from(this.inquiries.values());
    return allInquiries
      .filter((inquiry) => inquiry.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async updateInquiry(
    id: string,
    data: Partial<UpdateInquiry>,
  ): Promise<Inquiry | null> {
    const existing = this.inquiries.get(id);
    if (!existing) {
      return null;
    }
    const updated: Inquiry = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.inquiries.set(id, updated);
    return updated;
  }

  async saveDrawing(data: InsertDrawing): Promise<Drawing> {
    const id = Math.random().toString(36).substr(2, 9);
    const drawing: Drawing = {
      id,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.drawings.set(id, drawing);
    return drawing;
  }

  async getDrawing(id: string): Promise<Drawing | null> {
    return this.drawings.get(id) || null;
  }

  async getDrawingByCaseId(caseId: string): Promise<Drawing | null> {
    for (const drawing of this.drawings.values()) {
      if (drawing.caseId === caseId) {
        return drawing;
      }
    }
    return null;
  }

  async updateDrawing(
    id: string,
    data: Partial<InsertDrawing>,
  ): Promise<Drawing | null> {
    const existing = this.drawings.get(id);
    if (!existing) {
      return null;
    }
    const updated: Drawing = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.drawings.set(id, updated);
    return updated;
  }

  async getOrCreateActiveCase(userId: string): Promise<Case> {
    // Find existing active case (작성중) for this user
    for (const caseItem of this.cases.values()) {
      if (caseItem.createdBy === userId && caseItem.status === "작성중") {
        return caseItem;
      }
    }

    // Create new active case for drawing purposes
    const caseNumber = `CLM-DRAW-${Date.now()}`;
    const newCase: Case = {
      id: randomUUID(),
      caseNumber,
      status: "작성중",
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      accidentDate: null,
      insuranceCompany: null,
      insurancePolicyNo: null,
      insuranceAccidentNo: null,
      clientResidence: null,
      clientDepartment: null,
      clientName: null,
      clientContact: null,
      assessorId: null,
      assessorDepartment: null,
      assessorTeam: null,
      assessorContact: null,
      investigatorTeam: null,
      investigatorDepartment: null,
      investigatorTeamName: null,
      investigatorContact: null,
      policyHolderName: null,
      policyHolderIdNumber: null,
      policyHolderAddress: null,
      insuredName: null,
      insuredIdNumber: null,
      insuredContact: null,
      insuredAddress: null,
      victimName: null,
      victimContact: null,
      clientPhone: null,
      clientAddress: null,
      accidentLocation: null,
      accidentDescription: null,
      accidentType: null,
      accidentTime: null,
      victimDamageItems: null,
      specialNotes: null,
      partnerCompany: null,
      repairCompanyName: null,
      assignedAt: null,
      targetCompletionDate: null,
      acceptedAt: null,
      rejectionReason: null,
      surveyScheduledAt: null,
      surveyCompletedAt: null,
      damageScope: null,
      repairMethod: null,
      surveyNotes: null,
      estimateAmount: null,
      estimateSubmittedAt: null,
      estimateApprovedAt: null,
      estimateRejectionReason: null,
      workStartedAt: null,
      workCompletedAt: null,
      finalReportSubmittedAt: null,
      settlementAmount: null,
      settlementCompletedAt: null,
      paymentRequestedAt: null,
      paymentCompletedAt: null,
    };

    this.cases.set(newCase.id, newCase);
    return newCase;
  }

  // Document methods
  async saveDocument(data: InsertCaseDocument): Promise<CaseDocument> {
    const id = randomUUID();
    const document: CaseDocument = {
      id,
      ...data,
      createdAt: new Date(),
    };
    this.documents.set(id, document);
    return document;
  }

  async getDocument(id: string): Promise<CaseDocument | null> {
    return this.documents.get(id) || null;
  }

  async getDocumentFileData(id: string): Promise<string | null> {
    const doc = this.documents.get(id);
    return doc?.fileData || null;
  }

  async getDocumentsByCaseId(caseId: string): Promise<CaseDocument[]> {
    const result: CaseDocument[] = [];
    for (const doc of this.documents.values()) {
      if (doc.caseId === caseId) {
        result.push(doc);
      }
    }
    return result;
  }

  async deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async updateDocumentCategory(
    id: string,
    category: string,
  ): Promise<CaseDocument | null> {
    const existing = this.documents.get(id);
    if (!existing) {
      return null;
    }
    const updated: CaseDocument = {
      ...existing,
      category,
    };
    this.documents.set(id, updated);
    return updated;
  }

  async createPendingDocument(data: {
    caseId: string;
    category: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    storageKey: string;
    displayOrder?: number;
    createdBy: string;
  }): Promise<CaseDocument> {
    const id = randomUUID();
    const document: CaseDocument = {
      id,
      caseId: data.caseId,
      category: data.category,
      fileName: data.fileName,
      fileType: data.fileType,
      fileSize: data.fileSize,
      fileData: null,
      storageKey: data.storageKey,
      status: "pending",
      checksum: null,
      displayOrder: data.displayOrder ?? 0,
      createdBy: data.createdBy,
      createdAt: new Date(),
    };
    this.documents.set(id, document);
    return document;
  }

  async updateDocumentStatus(
    id: string,
    status: "pending" | "ready" | "failed",
    checksum?: string,
  ): Promise<CaseDocument | null> {
    const existing = this.documents.get(id);
    if (!existing) {
      return null;
    }
    const updated: CaseDocument = {
      ...existing,
      status,
      checksum: checksum ?? existing.checksum,
    };
    this.documents.set(id, updated);
    return updated;
  }

  // Estimate methods (stub - not implemented for MemStorage)
  async createEstimateVersion(
    caseId: string,
    userId: string,
    rows: Omit<InsertEstimateRow, "estimateId">[],
    laborCostData?: any | null,
    materialCostData?: any | null,
    vatIncluded?: boolean,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] }> {
    throw new Error("Estimate methods not implemented in MemStorage");
  }

  async getLatestEstimate(
    caseId: string,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null> {
    throw new Error("Estimate methods not implemented in MemStorage");
  }

  async getEstimateVersion(
    caseId: string,
    version: number,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null> {
    throw new Error("Estimate methods not implemented in MemStorage");
  }

  async listEstimateVersions(caseId: string): Promise<Estimate[]> {
    throw new Error("Estimate methods not implemented in MemStorage");
  }

  async getMasterData(
    category?: string,
    includeInactive?: boolean,
  ): Promise<MasterData[]> {
    throw new Error("Master data methods not implemented in MemStorage");
  }

  async createMasterData(data: InsertMasterData): Promise<MasterData> {
    throw new Error("Master data methods not implemented in MemStorage");
  }

  async deleteMasterData(id: string): Promise<void> {
    throw new Error("Master data methods not implemented in MemStorage");
  }

  async updateMasterData(
    id: string,
    data: Partial<InsertMasterData>,
  ): Promise<MasterData | null> {
    throw new Error("Master data methods not implemented in MemStorage");
  }

  async getLaborCosts(filters?: {
    category?: string;
    workName?: string;
    detailWork?: string;
  }): Promise<LaborCost[]> {
    throw new Error("Labor cost methods not implemented in MemStorage");
  }

  async getLaborCostOptions(): Promise<{
    categories: string[];
    workNamesByCategory: Record<string, string[]>;
    detailWorksByWork: Record<string, string[]>;
  }> {
    throw new Error("Labor cost methods not implemented in MemStorage");
  }

  async createLaborCost(data: InsertLaborCost): Promise<LaborCost> {
    throw new Error("Labor cost methods not implemented in MemStorage");
  }

  async deleteLaborCost(id: string): Promise<void> {
    throw new Error("Labor cost methods not implemented in MemStorage");
  }

  async listMaterials(workType?: string): Promise<Material[]> {
    throw new Error("Material methods not implemented in MemStorage");
  }

  async createMaterial(data: InsertMaterial): Promise<Material> {
    throw new Error("Material methods not implemented in MemStorage");
  }

  async deleteMaterial(id: string): Promise<void> {
    throw new Error("Material methods not implemented in MemStorage");
  }

  async getMaterialsCatalog(): Promise<
    Array<{
      workType: string;
      workName: string;
      materialName: string;
      specification: string;
      unit: string;
      standardPrice: number | string;
    }>
  > {
    throw new Error("Materials catalog not implemented in MemStorage");
  }

  async getUserFavorites(userId: string): Promise<UserFavorite[]> {
    throw new Error("User favorites methods not implemented in MemStorage");
  }

  async addFavorite(data: InsertUserFavorite): Promise<UserFavorite> {
    throw new Error("User favorites methods not implemented in MemStorage");
  }

  async removeFavorite(userId: string, menuName: string): Promise<void> {
    throw new Error("User favorites methods not implemented in MemStorage");
  }

  async getAllNotices(): Promise<Notice[]> {
    throw new Error("Notice methods not implemented in MemStorage");
  }

  async createNotice(data: InsertNotice): Promise<Notice> {
    throw new Error("Notice methods not implemented in MemStorage");
  }

  async updateNotice(
    id: string,
    data: { title: string; content: string },
  ): Promise<Notice | null> {
    throw new Error("Notice methods not implemented in MemStorage");
  }

  async deleteNotice(id: string): Promise<void> {
    throw new Error("Notice methods not implemented in MemStorage");
  }

  async deleteInquiry(id: string): Promise<void> {
    this.inquiries.delete(id);
  }

  // Asset cloning methods (stub)
  async getRelatedCaseWithDrawing(
    caseId: string,
  ): Promise<{ caseId: string; caseNumber: string } | null> {
    throw new Error("Asset cloning methods not implemented in MemStorage");
  }

  async getAllRelatedCasesWithDrawings(
    caseId: string,
  ): Promise<Array<{ caseId: string; caseNumber: string; status: string | null }>> {
    throw new Error("Asset cloning methods not implemented in MemStorage");
  }

  async getRelatedCaseWithEstimate(
    caseId: string,
  ): Promise<{ caseId: string; caseNumber: string } | null> {
    throw new Error("Asset cloning methods not implemented in MemStorage");
  }

  async getRelatedCaseWithDocuments(
    caseId: string,
  ): Promise<{
    caseId: string;
    caseNumber: string;
    documentCount: number;
  } | null> {
    throw new Error("Asset cloning methods not implemented in MemStorage");
  }

  async cloneDrawingFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<Drawing | null> {
    throw new Error("Asset cloning methods not implemented in MemStorage");
  }

  async cloneEstimateFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null> {
    throw new Error("Asset cloning methods not implemented in MemStorage");
  }

  async cloneDocumentsFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<CaseDocument[]> {
    throw new Error("Asset cloning methods not implemented in MemStorage");
  }

  // Case change log methods (stub)
  async createCaseChangeLog(data: InsertCaseChangeLog): Promise<CaseChangeLog> {
    throw new Error("Case change log methods not implemented in MemStorage");
  }

  async getCaseChangeLogs(caseId: string): Promise<CaseChangeLog[]> {
    throw new Error("Case change log methods not implemented in MemStorage");
  }

  async getAllCaseChangeLogs(filters?: {
    caseNumber?: string;
    changedBy?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<(CaseChangeLog & { caseNumber: string })[]> {
    throw new Error("Case change log methods not implemented in MemStorage");
  }

  // Field Survey Data methods (stub)
  async getFieldSurveyData(
    caseGroupId: string,
  ): Promise<FieldSurveyData | null> {
    throw new Error("Field survey data methods not implemented in MemStorage");
  }

  async saveFieldSurveyData(
    data: InsertFieldSurveyData,
  ): Promise<FieldSurveyData> {
    throw new Error("Field survey data methods not implemented in MemStorage");
  }

  async updateFieldSurveyData(
    caseGroupId: string,
    data: Partial<InsertFieldSurveyData>,
  ): Promise<FieldSurveyData | null> {
    throw new Error("Field survey data methods not implemented in MemStorage");
  }

  // Shared Drawing methods (stub)
  async getSharedDrawing(caseGroupId: string): Promise<SharedDrawing | null> {
    throw new Error("Shared drawing methods not implemented in MemStorage");
  }

  async saveSharedDrawing(data: InsertSharedDrawing): Promise<SharedDrawing> {
    throw new Error("Shared drawing methods not implemented in MemStorage");
  }

  async updateSharedDrawing(
    caseGroupId: string,
    data: Partial<InsertSharedDrawing>,
  ): Promise<SharedDrawing | null> {
    throw new Error("Shared drawing methods not implemented in MemStorage");
  }

  // Case group methods (stub)
  async getCasesByGroupId(caseGroupId: string): Promise<Case[]> {
    throw new Error("Case group methods not implemented in MemStorage");
  }

  // Same accident number methods (stub)
  async getCasesByAccidentNo(
    accidentNo: string,
    excludeCaseId?: string,
  ): Promise<Case[]> {
    throw new Error(
      "Same accident number methods not implemented in MemStorage",
    );
  }

  async syncFieldSurveyToRelatedCases(
    sourceCaseId: string,
    fieldData: Partial<InsertCase>,
  ): Promise<number> {
    throw new Error(
      "Same accident number methods not implemented in MemStorage",
    );
  }

  async syncDrawingToRelatedCases(sourceCaseId: string): Promise<number> {
    throw new Error(
      "Sync drawing to related cases not implemented in MemStorage",
    );
  }

  async syncDocumentsToRelatedCases(
    sourceCaseId: string,
    newDocument: CaseDocument,
  ): Promise<number> {
    throw new Error(
      "Sync documents to related cases not implemented in MemStorage",
    );
  }

  async syncEstimateToRelatedCases(sourceCaseId: string): Promise<number> {
    throw new Error(
      "Sync estimate to related cases not implemented in MemStorage",
    );
  }

  // Case number helpers (stub)
  async getPreventionCaseByPrefix(prefix: string): Promise<Case | null> {
    throw new Error("Case number helper methods not implemented in MemStorage");
  }

  async getNextVictimSuffix(prefix: string): Promise<number> {
    throw new Error("Case number helper methods not implemented in MemStorage");
  }

  // Same prefix case sync methods (stub)
  async getCasesByPrefix(
    prefix: string,
    excludeCaseId?: string,
  ): Promise<Case[]> {
    throw new Error("getCasesByPrefix not implemented in MemStorage");
  }

  async syncIntakeDataToRelatedCases(sourceCaseId: string): Promise<number> {
    throw new Error(
      "syncIntakeDataToRelatedCases not implemented in MemStorage",
    );
  }

  async copyFieldSurveyFromRelatedCase(newCaseId: string): Promise<boolean> {
    throw new Error(
      "copyFieldSurveyFromRelatedCase not implemented in MemStorage",
    );
  }

  // Settlement methods (stub)
  async createSettlement(data: InsertSettlement, createdBy: string): Promise<Settlement> {
    throw new Error("createSettlement not implemented in MemStorage");
  }

  async updateSettlement(id: string, data: Partial<InsertSettlement>): Promise<Settlement | null> {
    throw new Error("updateSettlement not implemented in MemStorage");
  }

  async getSettlementsByCaseId(caseId: string): Promise<Settlement[]> {
    throw new Error("getSettlementsByCaseId not implemented in MemStorage");
  }

  async getLatestSettlementByCaseId(caseId: string): Promise<Settlement | null> {
    throw new Error("getLatestSettlementByCaseId not implemented in MemStorage");
  }

  async getAllSettlements(): Promise<Settlement[]> {
    throw new Error("getAllSettlements not implemented in MemStorage");
  }

  async getLaborRateTiers(): Promise<LaborRateTier[]> {
    throw new Error("getLaborRateTiers not implemented in MemStorage");
  }

  async updateLaborRateTiers(tiers: UpdateLaborRateTier[]): Promise<LaborRateTier[]> {
    throw new Error("updateLaborRateTiers not implemented in MemStorage");
  }

  async initializeLaborRateTiers(): Promise<void> {
    throw new Error("initializeLaborRateTiers not implemented in MemStorage");
  }

  // Invoice methods (stub)
  async createInvoice(data: InsertInvoice, createdBy: string): Promise<Invoice> {
    throw new Error("createInvoice not implemented in MemStorage");
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | null> {
    throw new Error("updateInvoice not implemented in MemStorage");
  }

  async getInvoiceById(id: string): Promise<Invoice | null> {
    throw new Error("getInvoiceById not implemented in MemStorage");
  }

  async getInvoiceByCaseId(caseId: string): Promise<Invoice | null> {
    throw new Error("getInvoiceByCaseId not implemented in MemStorage");
  }

  async getInvoiceByCaseGroupPrefix(caseGroupPrefix: string): Promise<Invoice | null> {
    throw new Error("getInvoiceByCaseGroupPrefix not implemented in MemStorage");
  }

  async getAllInvoices(): Promise<Invoice[]> {
    throw new Error("getAllInvoices not implemented in MemStorage");
  }

  async getApprovedInvoices(): Promise<Invoice[]> {
    throw new Error("getApprovedInvoices not implemented in MemStorage");
  }

  async getEstimateExclusions(caseId: string, exclusionType: string): Promise<EstimateExclusion[]> {
    throw new Error("getEstimateExclusions not implemented in MemStorage");
  }

  async addEstimateExclusion(data: InsertEstimateExclusion): Promise<EstimateExclusion> {
    throw new Error("addEstimateExclusion not implemented in MemStorage");
  }

  async removeEstimateExclusion(caseId: string, exclusionType: string, deletionKey: string): Promise<boolean> {
    throw new Error("removeEstimateExclusion not implemented in MemStorage");
  }

  async recordStatusChange(caseId: string, previousStatus: string, newStatus: string): Promise<CaseStatusHistory> {
    throw new Error("recordStatusChange not implemented in MemStorage");
  }

  async getStatusHistoryByCaseId(caseId: string): Promise<CaseStatusHistory[]> {
    throw new Error("getStatusHistoryByCaseId not implemented in MemStorage");
  }

  async getAllStatusHistory(): Promise<CaseStatusHistory[]> {
    throw new Error("getAllStatusHistory not implemented in MemStorage");
  }
}

export class DbStorage implements IStorage {
  constructor() {
    this.initDatabase();
  }

  private async initDatabase() {
    try {
      // Check if we have any users
      const existingUsers = await db.select().from(users);

      // Seed users if no users exist (only for fresh database)
      if (existingUsers.length === 0) {
        await this.seedTestUsers();
      }

      // Always ensure essential role permissions exist
      await this.ensureEssentialPermissions();

      // Seed baseline status history for existing cases (one-time)
      await this.seedBaselineStatusHistory();
    } catch (error) {
      console.error("Database initialization error:", error);
    }
  }

  private async seedBaselineStatusHistory() {
    try {
      const existingHistory = await db.select({ id: caseStatusHistory.id }).from(caseStatusHistory).limit(1);
      if (existingHistory.length > 0) {
        return;
      }

      const allCases = await db.select({ id: cases.id, status: cases.status, createdAt: cases.createdAt }).from(cases);
      if (allCases.length === 0) return;

      const records = allCases.map((c) => ({
        caseId: c.id,
        previousStatus: "배당대기",
        newStatus: c.status,
        changedAt: c.createdAt || getKSTTimestamp(),
      }));

      for (let i = 0; i < records.length; i += 100) {
        const batch = records.slice(i, i + 100);
        await db.insert(caseStatusHistory).values(batch);
      }

      console.log(`[StatusHistory] Seeded baseline status history for ${allCases.length} existing cases`);
    } catch (error) {
      console.error("[StatusHistory] Error seeding baseline status history:", error);
    }
  }

  private async ensureEssentialPermissions() {
    console.log("[Essential Permissions] Checking and creating essential role permissions...");
    const currentDate = getKSTTimestamp();

    // 관리자 전체 권한 구조
    const fullPermissions = {
      "홈": { enabled: true, items: {} },
      "새로운접수": { enabled: true, items: {} },
      "종합진행관리": { enabled: true, items: { "종합진행관리": true, "접수건 삭제 권한": true } },
      "정산 및 통계": { enabled: true, items: { "통계": true, "정산조회": true } },
      "관리자 설정": { enabled: true, items: {} }
    };

    // 관리자 역할만 기본값 설정 (다른 역할은 관리자가 직접 부여한 권한만 적용)
    const rolePermissionsData = [
      {
        roleName: "관리자",
        permissions: JSON.stringify(fullPermissions)
      }
    ];

    // 자동 시딩된 비관리자 역할 권한 레코드 정리 (관리자가 직접 설정하지 않은 기본값 제거)
    const autoSeededDefaults: Record<string, string> = {
      "보험사": JSON.stringify({
        "홈": { enabled: true, items: {} },
        "새로운접수": { enabled: true, items: {} },
        "종합진행관리": { enabled: true, items: {} },
        "정산 및 통계": { enabled: true, items: {} },
        "관리자 설정": { enabled: false, items: {} }
      }),
      "협력사": JSON.stringify({
        "홈": { enabled: true, items: {} },
        "새로운접수": { enabled: false, items: {} },
        "현장조사": { enabled: true, items: { "현장입력": true, "도면작성": true, "증빙자료 업로드": true, "견적서 작성": true, "보고서 작성": true } },
        "종합진행관리": { enabled: true, items: {} },
        "정산 및 통계": { enabled: false, items: { "통계": false, "정산조회": false, "정산하기": false } },
        "관리자 설정": { enabled: false, items: { "계정관리": false, "DB관리": false, "기준정보 관리": false, "접근권한관리": false } }
      }),
      "심사사": JSON.stringify({
        "홈": { enabled: true, items: {} },
        "새로운접수": { enabled: true, items: {} },
        "종합진행관리": { enabled: true, items: {} },
        "정산 및 통계": { enabled: false, items: {} },
        "관리자 설정": { enabled: false, items: {} }
      }),
      "조사사": JSON.stringify({
        "홈": { enabled: false, items: {} },
        "새로운접수": { enabled: false, items: {} },
        "종합진행관리": { enabled: true, items: {} },
        "정산 및 통계": { enabled: false, items: {} },
        "관리자 설정": { enabled: false, items: {} }
      }),
      "의뢰사": JSON.stringify({
        "홈": { enabled: false, items: {} },
        "새로운접수": { enabled: false, items: {} },
        "종합진행관리": { enabled: false, items: {} },
        "정산 및 통계": { enabled: false, items: {} },
        "관리자 설정": { enabled: false, items: {} }
      })
    };

    // 일회성 마이그레이션: 자동 시딩된 비관리자 역할 권한 레코드 삭제
    // (_migration_cleanup_v1 레코드가 없을 때만 실행)
    const migrationKey = "_migration_cleanup_v1";
    const migrationDone = await this.getRolePermission(migrationKey);
    if (!migrationDone) {
      for (const [roleName] of Object.entries(autoSeededDefaults)) {
        try {
          const existing = await this.getRolePermission(roleName);
          if (existing) {
            await db.delete(rolePermissions).where(eq(rolePermissions.roleName, roleName));
            console.log(`[Essential Permissions] Migration: removed auto-seeded default for: ${roleName}`);
          }
        } catch (error) {
          console.error(`[Essential Permissions] Error cleaning up ${roleName}:`, error);
        }
      }
      // 마이그레이션 완료 플래그 저장
      await db.insert(rolePermissions).values({
        id: randomUUID(),
        roleName: migrationKey,
        permissions: JSON.stringify({ done: true }),
        createdAt: currentDate,
        updatedAt: currentDate
      });
      console.log(`[Essential Permissions] Migration cleanup_v1 completed`);
    }

    let createdCount = 0;
    let existingCount = 0;

    for (const roleData of rolePermissionsData) {
      try {
        const existing = await this.getRolePermission(roleData.roleName);
        if (!existing) {
          await db.insert(rolePermissions).values({
            id: randomUUID(),
            roleName: roleData.roleName,
            permissions: roleData.permissions,
            createdAt: currentDate,
            updatedAt: currentDate
          });
          console.log(`[Essential Permissions] Created: ${roleData.roleName}`);
          createdCount++;
        } else {
          // Check if existing permissions are corrupted (contains indexed characters like "0":"{")
          const isCorrupted = typeof existing.permissions === 'string' && 
            existing.permissions.includes('"0":"') && 
            existing.permissions.includes('"1":"');
          
          if (isCorrupted) {
            console.log(`[Essential Permissions] CORRUPTED data detected for ${roleData.roleName}, replacing...`);
            await db.update(rolePermissions)
              .set({ 
                permissions: roleData.permissions,
                updatedAt: currentDate
              })
              .where(eq(rolePermissions.roleName, roleData.roleName));
            console.log(`[Essential Permissions] Replaced corrupted: ${roleData.roleName}`);
            existingCount++;
            continue;
          }

          console.log(`[Essential Permissions] Already up-to-date: ${roleData.roleName}`);
          existingCount++;
        }
      } catch (error) {
        console.error(`[Essential Permissions] Error creating ${roleData.roleName}:`, error);
      }
    }

    console.log(`[Essential Permissions] Summary: ${createdCount} created, ${existingCount} updated`);
  }

  private async seedTestCases() {
    const currentDate = getKSTDate();

    // Get users for case assignment
    const allUsers = await db.select().from(users);
    const admin01 = allUsers.find((u) => u.username === "admin01");
    const assessor01 = allUsers.find((u) => u.username === "assessor01");
    const assessor02 = allUsers.find((u) => u.username === "assessor02");
    const partner01 = allUsers.find((u) => u.username === "partner01");
    const partner02 = allUsers.find((u) => u.username === "partner02");

    if (!admin01) return;

    const statuses = ["제출", "검토중", "1차승인", "완료", "청구", "정산완료"];
    const insuranceCompanies = [
      "MG손해보험",
      "삼성화재",
      "현대해상",
      "DB손해보험",
      "KB손해보험",
    ];

    const testCases = [];

    // 지난달 (2024년 10월) 케이스 - 145건
    for (let i = 1; i <= 145; i++) {
      const day = ((i % 28) + 1).toString().padStart(2, "0");
      const status = statuses[i % statuses.length];
      const insurance = insuranceCompanies[i % insuranceCompanies.length];

      testCases.push({
        caseNumber: `CLM-2024100${i.toString().padStart(5, "0")}`,
        status,
        accidentDate: `2024-10-${day}`,
        insuranceCompany: insurance,
        insurancePolicyNo: `${insurance.substring(0, 2)}2024-${i.toString().padStart(5, "0")}`,
        insuranceAccidentNo: `24100${i.toString().padStart(4, "0")}`,
        clientResidence: "서울 강남구",
        clientDepartment: "보상팀",
        clientName: `고객${i}`,
        clientContact: "010-0000-0000",
        assessorId: (i % 2 === 0 ? assessor01?.id : assessor02?.id) || null,
        assessorDepartment: "심사팀",
        assessorTeam: i % 2 === 0 ? "1팀" : "2팀",
        assessorContact: "010-4001-4001",
        investigatorTeam: "조사1팀",
        investigatorDepartment: "현장조사",
        investigatorTeamName: "플록슨 조사팀",
        investigatorContact: "02-5001-5001",
        policyHolderName: `고객${i}`,
        policyHolderIdNumber: "800101-1******",
        policyHolderAddress: "서울 강남구",
        insuredName: `고객${i}`,
        insuredIdNumber: "800101-1******",
        insuredContact: "010-0000-0000",
        insuredAddress: "서울 강남구",
        victimName: "이웃집",
        victimContact: "010-9999-8888",
        clientPhone: "010-0000-0000",
        clientAddress: "서울 강남구",
        accidentLocation: `서울 강남구 아파트 ${i}호`,
        accidentDescription: "누수 피해",
        assignedTo: (i % 2 === 0 ? partner01?.id : partner02?.id) || null,
        createdBy: admin01.id,
        createdAt: `2024-10-${day}`,
        updatedAt: `2024-10-${day}`,
      });
    }

    // 이번달 (2024년 11월) 케이스 - 167건 (전월 대비 +15.2% 증가, 22건 증가)
    for (let i = 1; i <= 167; i++) {
      const day = ((i % 28) + 1).toString().padStart(2, "0");
      const status = statuses[i % statuses.length];
      const insurance = insuranceCompanies[i % insuranceCompanies.length];

      testCases.push({
        caseNumber: `CLM-2024110${i.toString().padStart(5, "0")}`,
        status,
        accidentDate: `2024-11-${day}`,
        insuranceCompany: insurance,
        insurancePolicyNo: `${insurance.substring(0, 2)}2024-${i.toString().padStart(5, "0")}`,
        insuranceAccidentNo: `24110${i.toString().padStart(4, "0")}`,
        clientResidence: "서울 서초구",
        clientDepartment: "보상팀",
        clientName: `고객${i}`,
        clientContact: "010-1111-1111",
        assessorId: (i % 2 === 0 ? assessor01?.id : assessor02?.id) || null,
        assessorDepartment: "심사팀",
        assessorTeam: i % 2 === 0 ? "1팀" : "2팀",
        assessorContact: "010-4001-4001",
        investigatorTeam: "조사1팀",
        investigatorDepartment: "현장조사",
        investigatorTeamName: "플록슨 조사팀",
        investigatorContact: "02-5001-5001",
        policyHolderName: `고객${i}`,
        policyHolderIdNumber: "800101-1******",
        policyHolderAddress: "서울 서초구",
        insuredName: `고객${i}`,
        insuredIdNumber: "800101-1******",
        insuredContact: "010-1111-1111",
        insuredAddress: "서울 서초구",
        victimName: "이웃집",
        victimContact: "010-9999-8888",
        clientPhone: "010-1111-1111",
        clientAddress: "서울 서초구",
        accidentLocation: `서울 서초구 아파트 ${i}호`,
        accidentDescription: "누수 피해",
        assignedTo: (i % 2 === 0 ? partner01?.id : partner02?.id) || null,
        createdBy: admin01.id,
        createdAt: `2024-11-${day}`,
        updatedAt: `2024-11-${day}`,
      });
    }

    // 기존 샘플 케이스 3건 추가 (이번달)
    testCases.push(
      {
        caseNumber: "CLM-25145136",
        status: "제출",
        accidentDate: "2024-11-15",
        insuranceCompany: "MG손해보험",
        insurancePolicyNo: "MG2024-12345",
        insuranceAccidentNo: "25219943",
        clientResidence: "서울 강남구",
        clientDepartment: "보상팀",
        clientName: "김블락",
        clientContact: "010-1234-5678",
        assessorId: assessor01?.id || null,
        assessorDepartment: "심사팀",
        assessorTeam: "1팀",
        assessorContact: "010-4001-4001",
        investigatorTeam: "조사1팀",
        investigatorDepartment: "현장조사",
        investigatorTeamName: "플록슨 조사팀",
        investigatorContact: "02-5001-5001",
        policyHolderName: "김블락",
        policyHolderIdNumber: "800101-1******",
        policyHolderAddress: "서울 강남구 테헤란로 123",
        insuredName: "김블락",
        insuredIdNumber: "800101-1******",
        insuredContact: "010-1234-5678",
        insuredAddress: "서울 강남구 테헤란로 123",
        victimName: "이웃집",
        victimContact: "010-9999-8888",
        clientPhone: "010-1234-5678",
        clientAddress: "서울 강남구 테헤란로 123",
        accidentLocation: "서울 강남구 테헤란로 123 아파트 1001호",
        accidentDescription: "화장실 배관 누수로 인한 천장 침수 피해",
        assignedTo: partner01?.id || null,
        createdBy: admin01.id,
        createdAt: "2024-11-15",
        updatedAt: "2024-11-15",
      },
      {
        caseNumber: "CLM-25145135",
        status: "검토중",
        accidentDate: "2024-11-14",
        insuranceCompany: "삼성화재",
        insurancePolicyNo: "SS2024-67890",
        insuranceAccidentNo: "25219942",
        clientResidence: "서울 서초구",
        clientDepartment: "보상팀",
        clientName: "박철수",
        clientContact: "010-2345-6789",
        assessorId: assessor02?.id || null,
        assessorDepartment: "심사팀",
        assessorTeam: "2팀",
        assessorContact: "010-4002-4002",
        investigatorTeam: "조사2팀",
        investigatorDepartment: "현장조사",
        investigatorTeamName: "플록슨 조사팀",
        investigatorContact: "02-5002-5002",
        policyHolderName: "박철수",
        policyHolderIdNumber: "750505-1******",
        policyHolderAddress: "서울 서초구 강남대로 456",
        insuredName: "박철수",
        insuredIdNumber: "750505-1******",
        insuredContact: "010-2345-6789",
        insuredAddress: "서울 서초구 강남대로 456",
        victimName: "아래층 주민",
        victimContact: "010-7777-6666",
        clientPhone: "010-2345-6789",
        clientAddress: "서울 서초구 강남대로 456",
        accidentLocation: "서울 서초구 강남대로 456 빌라 202호",
        accidentDescription: "싱크대 하수 배관 파손으로 인한 누수",
        assignedTo: partner02?.id || null,
        createdBy: admin01.id,
        createdAt: "2024-11-14",
        updatedAt: "2024-11-14",
      },
      {
        caseNumber: "CLM-25145134",
        status: "작성중",
        accidentDate: "2024-11-13",
        insuranceCompany: "현대해상",
        insurancePolicyNo: "HD2024-11111",
        insuranceAccidentNo: "25219941",
        clientResidence: "경기 성남시",
        clientDepartment: "보상팀",
        clientName: "이미라",
        clientContact: "010-3456-7890",
        assessorId: assessor01?.id || null,
        assessorDepartment: "심사팀",
        assessorTeam: "1팀",
        assessorContact: "010-4001-4001",
        investigatorTeam: "조사1팀",
        investigatorDepartment: "현장조사",
        investigatorTeamName: "플록슨 조사팀",
        investigatorContact: "02-5001-5001",
        policyHolderName: "이미라",
        policyHolderIdNumber: "900303-2******",
        policyHolderAddress: "경기 성남시 분당구 789",
        insuredName: "이미라",
        insuredIdNumber: "900303-2******",
        insuredContact: "010-3456-7890",
        insuredAddress: "경기 성남시 분당구 789",
        victimName: "옆집",
        victimContact: "010-5555-4444",
        clientPhone: "010-3456-7890",
        clientAddress: "경기 성남시 분당구 789",
        accidentLocation: "경기 성남시 분당구 789 아파트 506호",
        accidentDescription: "보일러 배관 동파로 인한 누수 사고",
        assignedTo: partner01?.id || null,
        createdBy: admin01.id,
        createdAt: "2024-11-13",
        updatedAt: "2024-11-13",
      },
    );

    await db.insert(cases).values(testCases);
  }

  private async seedTestEstimates() {
    try {
      // Get all cases with status "완료" or "청구"
      const completedCases = await db
        .select()
        .from(cases)
        .where(sql`${cases.status} IN ('완료', '청구')`);

      if (completedCases.length === 0) {
        console.log("No completed or billed cases found for estimate seeding");
        return;
      }

      // Get admin user for createdBy
      const adminUsers = await db
        .select()
        .from(users)
        .where(sql`${users.role} = '관리자'`);
      const admin01 = adminUsers.find((u) => u.username === "admin01");

      if (!admin01) {
        console.log("No admin user found for estimate seeding");
        return;
      }

      // Create sample estimate data for each completed case
      const estimateRecords = completedCases.map((caseRecord, index) => {
        // Generate varied labor cost data
        const laborCostData = [
          {
            id: `labor-${index}-1`,
            category: "도배공사",
            workName: "도배",
            detailWork: "벽지",
            standardPrice: 15000,
            quantity: 20,
            amount: 300000,
            includeInEstimate: false, // 경비 제외
          },
          {
            id: `labor-${index}-2`,
            category: "장판공사",
            workName: "장판",
            detailWork: "PVC 장판",
            standardPrice: 12000,
            quantity: 15,
            amount: 180000,
            includeInEstimate: false, // 경비 제외
          },
        ];

        // Generate varied material cost data
        const materialCostData = [
          {
            id: `material-${index}-1`,
            materialName: "벽지",
            specification: "폭 92cm",
            unit: "m",
            standardPrice: 8000,
            quantity: 25,
            금액: 200000,
          },
        ];

        return {
          caseId: caseRecord.id,
          version: 1,
          status: "submitted",
          createdBy: admin01.id,
          laborCostData: laborCostData as any,
          materialCostData: materialCostData as any,
        };
      });

      // Insert estimates
      await db.insert(estimates).values(estimateRecords);

      console.log(
        `Seeded ${estimateRecords.length} estimates for completed/billed cases`,
      );
    } catch (error) {
      console.error("Error seeding test estimates:", error);
    }
  }

  private async seedTestUsers() {
    const hashedPassword = await bcrypt.hash("1234", SALT_ROUNDS);
    const currentDate = getKSTDate();

    const testUsers = [
      // ===== 관리자 5명 =====
      {
        username: "admin01",
        password: hashedPassword,
        role: "관리자",
        name: "김블락",
        company: "플록슨",
        department: "개발팀",
        position: "팀장",
        email: "admin01@floxn.com",
        phone: "010-1001-1001",
        office: "02-1001-1001",
        address: "서울 강남구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "admin02",
        password: hashedPassword,
        role: "관리자",
        name: "박영희",
        company: "플록슨",
        department: "기획팀",
        position: "부장",
        email: "admin02@floxn.com",
        phone: "010-1002-1002",
        office: "02-1002-1002",
        address: "서울 송파구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "admin03",
        password: hashedPassword,
        role: "관리자",
        name: "이현우",
        company: "플록슨",
        department: "인사팀",
        position: "차장",
        email: "admin03@floxn.com",
        phone: "010-1003-1003",
        office: "02-1003-1003",
        address: "서울 종로구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "admin04",
        password: hashedPassword,
        role: "관리자",
        name: "최지원",
        company: "플록슨",
        department: "운영팀",
        position: "과장",
        email: "admin04@floxn.com",
        phone: "010-1004-1004",
        office: "02-1004-1004",
        address: "서울 마포구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "admin05",
        password: hashedPassword,
        role: "관리자",
        name: "정수현",
        company: "플록슨",
        department: "총무팀",
        position: "대리",
        email: "admin05@floxn.com",
        phone: "010-1005-1005",
        office: "02-1005-1005",
        address: "서울 서초구",
        status: "active",
        createdAt: currentDate,
      },

      // ===== 보험사 5명 =====
      {
        username: "insure01",
        password: hashedPassword,
        role: "보험사",
        name: "김민준",
        company: "삼성화재",
        department: "사고접수팀",
        position: "팀장",
        email: "insure01@samsung.com",
        phone: "010-2001-2001",
        office: "02-2001-2001",
        address: "서울 강남구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "insure02",
        password: hashedPassword,
        role: "보험사",
        name: "이서윤",
        company: "현대해상",
        department: "보상팀",
        position: "차장",
        email: "insure02@hyundai.com",
        phone: "010-2002-2002",
        office: "02-2002-2002",
        address: "서울 중구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "insure03",
        password: hashedPassword,
        role: "보험사",
        name: "박도현",
        company: "DB손해보험",
        department: "사고처리팀",
        position: "과장",
        email: "insure03@db.com",
        phone: "010-2003-2003",
        office: "02-2003-2003",
        address: "서울 영등포구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "insure04",
        password: hashedPassword,
        role: "보험사",
        name: "최하은",
        company: "KB손해보험",
        department: "보상심사팀",
        position: "부장",
        email: "insure04@kb.com",
        phone: "010-2004-2004",
        office: "02-2004-2004",
        address: "서울 종로구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "insure05",
        password: hashedPassword,
        role: "보험사",
        name: "정예준",
        company: "메리츠화재",
        department: "사고조사팀",
        position: "대리",
        email: "insure05@meritz.com",
        phone: "010-2005-2005",
        office: "02-2005-2005",
        address: "서울 강동구",
        status: "active",
        createdAt: currentDate,
      },

      // ===== 협력사 5명 =====
      {
        username: "partner01",
        password: hashedPassword,
        role: "협력사",
        name: "강지훈",
        company: "AERO 파트너스",
        department: "현장조사팀",
        position: "팀장",
        email: "partner01@aero.com",
        phone: "010-3001-3001",
        office: "02-3001-3001",
        address: "서울 서초구",
        bankName: "국민은행",
        accountNumber: "123-456-000001",
        accountHolder: "강지훈",
        serviceRegions: ["서울시/강남구", "서초구", "송파구"],
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "partner02",
        password: hashedPassword,
        role: "협력사",
        name: "윤소희",
        company: "누수닥터",
        department: "복구팀",
        position: "차장",
        email: "partner02@doctor.com",
        phone: "010-3002-3002",
        office: "02-3002-3002",
        address: "서울 용산구",
        bankName: "신한은행",
        accountNumber: "234-567-000002",
        accountHolder: "윤소희",
        serviceRegions: ["서울시/종로구", "중구", "용산구"],
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "partner03",
        password: hashedPassword,
        role: "협력사",
        name: "장민서",
        company: "클린워터",
        department: "기술팀",
        position: "과장",
        email: "partner03@cleanwater.com",
        phone: "010-3003-3003",
        office: "02-3003-3003",
        address: "서울 마포구",
        bankName: "우리은행",
        accountNumber: "345-678-000003",
        accountHolder: "장민서",
        serviceRegions: ["서울시/마포구", "서대문구", "은평구"],
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "partner04",
        password: hashedPassword,
        role: "협력사",
        name: "임채원",
        company: "수리마스터",
        department: "시공팀",
        position: "팀장",
        email: "partner04@master.com",
        phone: "010-3004-3004",
        office: "02-3004-3004",
        address: "서울 강북구",
        bankName: "하나은행",
        accountNumber: "456-789-000004",
        accountHolder: "임채원",
        serviceRegions: ["서울시/강북구", "성북구", "노원구"],
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "partner05",
        password: hashedPassword,
        role: "협력사",
        name: "한유진",
        company: "복구전문가",
        department: "견적팀",
        position: "부장",
        email: "partner05@expert.com",
        phone: "010-3005-3005",
        office: "02-3005-3005",
        address: "경기 성남시",
        bankName: "농협은행",
        accountNumber: "567-890-000005",
        accountHolder: "한유진",
        serviceRegions: ["경기/성남시", "분당구", "수정구"],
        status: "active",
        createdAt: currentDate,
      },

      // ===== 심사사 5명 =====
      {
        username: "assessor01",
        password: hashedPassword,
        role: "심사사",
        name: "신동욱",
        company: "플록슨",
        department: "심사팀",
        position: "수석심사사",
        email: "assessor01@floxn.com",
        phone: "010-4001-4001",
        office: "02-4001-4001",
        address: "서울 강남구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "assessor02",
        password: hashedPassword,
        role: "심사사",
        name: "오서현",
        company: "플록슨",
        department: "심사팀",
        position: "책임심사사",
        email: "assessor02@floxn.com",
        phone: "010-4002-4002",
        office: "02-4002-4002",
        address: "서울 서초구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "assessor03",
        password: hashedPassword,
        role: "심사사",
        name: "배준영",
        company: "플록슨",
        department: "심사팀",
        position: "선임심사사",
        email: "assessor03@floxn.com",
        phone: "010-4003-4003",
        office: "02-4003-4003",
        address: "서울 송파구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "assessor04",
        password: hashedPassword,
        role: "심사사",
        name: "황시우",
        company: "플록슨",
        department: "심사팀",
        position: "심사사",
        email: "assessor04@floxn.com",
        phone: "010-4004-4004",
        office: "02-4004-4004",
        address: "서울 마포구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "assessor05",
        password: hashedPassword,
        role: "심사사",
        name: "서은비",
        company: "플록슨",
        department: "심사팀",
        position: "심사사",
        email: "assessor05@floxn.com",
        phone: "010-4005-4005",
        office: "02-4005-4005",
        address: "서울 강동구",
        status: "active",
        createdAt: currentDate,
      },

      // ===== 조사사 5명 =====
      {
        username: "investigator01",
        password: hashedPassword,
        role: "조사사",
        name: "안재현",
        company: "플록슨",
        department: "조사팀",
        position: "수석조사사",
        email: "investigator01@floxn.com",
        phone: "010-5001-5001",
        office: "02-5001-5001",
        address: "서울 강남구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "investigator02",
        password: hashedPassword,
        role: "조사사",
        name: "조아라",
        company: "플록슨",
        department: "조사팀",
        position: "책임조사사",
        email: "investigator02@floxn.com",
        phone: "010-5002-5002",
        office: "02-5002-5002",
        address: "서울 성동구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "investigator03",
        password: hashedPassword,
        role: "조사사",
        name: "홍민재",
        company: "플록슨",
        department: "조사팀",
        position: "선임조사사",
        email: "investigator03@floxn.com",
        phone: "010-5003-5003",
        office: "02-5003-5003",
        address: "서울 광진구",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "investigator04",
        password: hashedPassword,
        role: "조사사",
        name: "허지안",
        company: "플록슨",
        department: "조사팀",
        position: "조사사",
        email: "investigator04@floxn.com",
        phone: "010-5004-5004",
        office: "02-5004-5004",
        address: "경기 성남시",
        status: "active",
        createdAt: currentDate,
      },
      {
        username: "investigator05",
        password: hashedPassword,
        role: "조사사",
        name: "송다빈",
        company: "플록슨",
        department: "조사팀",
        position: "조사사",
        email: "investigator05@floxn.com",
        phone: "010-5005-5005",
        office: "02-5005-5005",
        address: "서울 용산구",
        status: "active",
        createdAt: currentDate,
      },
    ];

    await db.insert(users).values(testUsers);
  }

  async getUser(id: string): Promise<User | undefined> {
    const cached = await getCachedUsers();
    const found = cached.find(u => u.id === id);
    if (found) return found;
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const cached = await getCachedUsers();
    const found = cached.find(u => u.username === username);
    if (found) return found;
    const result = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    return getCachedUsers();
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const hashedPassword = await bcrypt.hash(insertUser.password, SALT_ROUNDS);
    const createdAt = getKSTDate();

    const newUser = {
      username: insertUser.username,
      password: hashedPassword,
      role: insertUser.role || "사원",
      name: insertUser.name,
      company: insertUser.company,
      department: insertUser.department || null,
      position: insertUser.position || null,
      email: insertUser.email || null,
      phone: insertUser.phone || null,
      office: insertUser.office || null,
      address: insertUser.address || null,
      addressDetail: insertUser.addressDetail || null,
      businessRegistrationNumber: insertUser.businessRegistrationNumber || null,
      representativeName: insertUser.representativeName || null,
      bankName: insertUser.bankName || null,
      accountNumber: insertUser.accountNumber || null,
      accountHolder: insertUser.accountHolder || null,
      serviceRegions: insertUser.serviceRegions || null,
      attachments: insertUser.attachments || null,
      status: insertUser.status || "active",
      createdAt,
    };

    const result = await db.insert(users).values(newUser).returning();
    invalidateUsersCache();
    return result[0];
  }

  async verifyPassword(
    username: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      console.log("[VERIFY PASSWORD] User not found:", username);
      return null;
    }

    // Block login for deleted accounts (soft delete)
    if (user.status === "deleted") {
      console.log("[VERIFY PASSWORD] Account deleted:", username);
      return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    console.log("[VERIFY PASSWORD]", { 
      username, 
      userExists: true, 
      status: user.status,
      passwordValid: isValid,
      hasPasswordHash: !!user.password
    });
    return isValid ? user : null;
  }

  async updatePassword(
    username: string,
    newPassword: string,
  ): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return null;
    }

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const result = await db
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.username, username))
      .returning();

    invalidateUsersCache();
    return result[0] || null;
  }

  async reactivateAccount(username: string): Promise<User | null> {
    // Reactivate a deleted account by setting status back to "active"
    const result = await db
      .update(users)
      .set({ status: "active" })
      .where(eq(users.username, username))
      .returning();

    console.log(`[REACTIVATE ACCOUNT] ${username}:`, result[0] ? 'SUCCESS' : 'NOT FOUND');
    invalidateUsersCache();
    return result[0] || null;
  }

  async updateUser(userId: string, userData: Partial<Omit<User, 'id' | 'username' | 'password' | 'company' | 'createdAt' | 'status'>>): Promise<User | null> {
    const existingUser = await this.getUser(userId);
    if (!existingUser) {
      return null;
    }

    const result = await db
      .update(users)
      .set(userData)
      .where(eq(users.id, userId))
      .returning();

    invalidateUsersCache();
    return result[0] || null;
  }

  async updateUserMustChangePassword(userId: string, mustChangePassword: boolean): Promise<User | null> {
    const existingUser = await this.getUser(userId);
    if (!existingUser) {
      return null;
    }

    const result = await db
      .update(users)
      .set({ mustChangePassword })
      .where(eq(users.id, userId))
      .returning();

    invalidateUsersCache();
    return result[0] || null;
  }

  async deleteAccount(username: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return null;
    }

    // Soft delete: update status to "deleted"
    const result = await db
      .update(users)
      .set({ status: "deleted" })
      .where(eq(users.username, username))
      .returning();

    invalidateUsersCache();
    return result[0] || null;
  }

  async getCaseById(caseId: string): Promise<Case | null> {
    const result = await db
      .select()
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    
    if (!result[0]) return null;
    
    const caseData = result[0];
    
    // 협력사가 배당되어 있지만 담당자 정보가 없는 경우 자동 채우기
    if (caseData.assignedPartner && (!caseData.assignedPartnerManager || !caseData.assignedPartnerContact)) {
      const partnerUsers = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.company, caseData.assignedPartner),
            eq(users.role, "협력사")
          )
        )
        .limit(1);
      
      if (partnerUsers.length > 0) {
        const partnerUser = partnerUsers[0];
        const updatedFields: Partial<Case> = {};
        
        if (!caseData.assignedPartnerManager && partnerUser.name) {
          updatedFields.assignedPartnerManager = partnerUser.name;
        }
        if (!caseData.assignedPartnerContact && partnerUser.phone) {
          updatedFields.assignedPartnerContact = partnerUser.phone;
        }
        
        if (Object.keys(updatedFields).length > 0) {
          // 데이터베이스 업데이트
          const updated = await db
            .update(cases)
            .set(updatedFields)
            .where(eq(cases.id, caseId))
            .returning();
          
          if (updated.length > 0) {
            return updated[0];
          }
        }
      }
    }
    
    return caseData;
  }

  async getAssignedCasesForUser(user: User, search?: string): Promise<Case[]> {
    let allCases = await db.select().from(cases);

    // 권한별 필터링 (accountType: "개인" = 본인 건만, "회사" = 회사 전체건)
    const isPersonal = user.accountType === "개인";
    switch (user.role) {
      case "심사사":
        if (isPersonal) {
          allCases = allCases.filter((c) => c.assessorId === user.company && c.assessorTeam === user.name);
        } else {
          allCases = allCases.filter((c) => c.assessorId === user.company);
        }
        break;
      case "협력사":
        if (isPersonal) {
          allCases = allCases.filter((c) =>
            c.assignedPartner === user.company &&
            (c.assignedPartnerManager === user.name || c.createdBy === user.id || c.assignedTo === user.id)
          );
        } else {
          allCases = allCases.filter((c) => c.assignedPartner === user.company);
        }
        break;
      case "조사사":
        if (isPersonal) {
          allCases = allCases.filter((c) => c.investigatorTeam === user.company && c.investigatorTeamName === user.name);
        } else {
          allCases = allCases.filter((c) => c.investigatorTeam === user.company);
        }
        break;
      case "보험사":
        if (isPersonal) {
          allCases = allCases.filter((c) =>
            c.insuranceCompany === user.company &&
            (c.managerId === user.id || c.createdBy === user.id)
          );
        } else {
          allCases = allCases.filter((c) => c.insuranceCompany === user.company);
        }
        break;
      case "관리자":
        break;
      default:
        return [];
    }

    // Apply search filter if provided
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      allCases = allCases.filter(
        (c) =>
          c.caseNumber?.toLowerCase().includes(searchLower) ||
          c.insuredName?.toLowerCase().includes(searchLower) ||
          c.insuranceCompany?.toLowerCase().includes(searchLower),
      );
    }

    return allCases;
  }

  async getNextCaseSequence(
    date: string,
    insuranceAccidentNo?: string,
  ): Promise<{ prefix: string; suffix: number }> {
    // Step 1: Check if there are existing cases with the same insurance accident number
    if (insuranceAccidentNo) {
      const existingCases = await db
        .select({ caseNumber: cases.caseNumber })
        .from(cases)
        .where(eq(cases.insuranceAccidentNo, insuranceAccidentNo));

      if (existingCases.length > 0) {
        // Extract prefix from first existing case (yyMMddxxx part)
        const firstCaseNumber = existingCases[0].caseNumber;
        if (firstCaseNumber) {
          const parts = firstCaseNumber.split("-");
          if (parts.length >= 2) {
            const prefix = parts[0]; // "251124001"

            // Find max suffix for this prefix
            let maxSuffix = -1;
            for (const c of existingCases) {
              if (c.caseNumber && c.caseNumber.startsWith(prefix + "-")) {
                const suffixStr = c.caseNumber.split("-")[1];
                const suffix = parseInt(suffixStr, 10);
                if (!isNaN(suffix) && suffix > maxSuffix) {
                  maxSuffix = suffix;
                }
              }
            }

            return { prefix, suffix: maxSuffix + 1 };
          }
        }
      }
    }

    // Step 2: No existing cases with same accident number - generate new prefix
    // Convert YYYY-MM-DD to yyMMdd (6 digits)
    const dateParts = date.split("-");
    const year = dateParts[0].substring(2); // YY (last 2 digits)
    const month = dateParts[1]; // MM
    const day = dateParts[2]; // dd
    const datePrefix = year + month + day; // yyMMdd

    // Query database for cases with case numbers starting with datePrefix
    const allCases = await db
      .select({ caseNumber: cases.caseNumber })
      .from(cases)
      .where(sql`${cases.caseNumber} LIKE ${datePrefix + "%"}`);

    let maxSequence = 0;
    for (const c of allCases) {
      if (c.caseNumber && c.caseNumber.startsWith(datePrefix)) {
        const parts = c.caseNumber.split("-");
        if (parts.length >= 1) {
          const sequencePart = parts[0].substring(6); // Extract XXX from yyMMddxxx
          const seq = parseInt(sequencePart, 10);
          if (!isNaN(seq) && seq > maxSequence) {
            maxSequence = seq;
          }
        }
      }
    }

    const nextSequence = maxSequence + 1;
    const seqStr = String(nextSequence).padStart(3, "0");
    const prefix = `${datePrefix}${seqStr}`; // e.g., "251124001"

    return { prefix, suffix: 0 };
  }

  async createCase(
    caseData: Omit<InsertCase, "caseNumber"> & {
      caseNumber: string;
      createdBy: string;
    },
  ): Promise<Case> {
    const currentDate = getKSTDate();
    const status = caseData.status || "작성중";

    // 상태에 따라 자동으로 날짜 기록 (케이스 생성 시)
    let autoReceptionDate = caseData.receptionDate || null;
    let autoAssignmentDate = caseData.assignmentDate || null;

    if (status === "접수완료") {
      // 접수완료 상태로 생성 시 접수일과 배당일 자동 기록 (기존 값 없을 때만)
      if (!autoReceptionDate) {
        autoReceptionDate = currentDate;
      }
      if (!autoAssignmentDate) {
        autoAssignmentDate = currentDate;
      }
    }

    const newCase = {
      caseNumber: caseData.caseNumber,
      status: status,
      accidentDate: caseData.accidentDate || null,
      insuranceCompany: caseData.insuranceCompany || null,
      insurancePolicyNo: caseData.insurancePolicyNo || null,
      insuranceAccidentNo: caseData.insuranceAccidentNo || null,
      clientResidence: caseData.clientResidence || null,
      clientDepartment: caseData.clientDepartment || null,
      clientName: caseData.clientName || null,
      clientContact: caseData.clientContact || null,
      assessorId: caseData.assessorId || null,
      assessorDepartment: caseData.assessorDepartment || null,
      assessorTeam: caseData.assessorTeam || null,
      assessorContact: caseData.assessorContact || null,
      investigatorTeam: caseData.investigatorTeam || null,
      investigatorDepartment: caseData.investigatorDepartment || null,
      investigatorTeamName: caseData.investigatorTeamName || null,
      investigatorContact: caseData.investigatorContact || null,
      policyHolderName: caseData.policyHolderName || null,
      policyHolderIdNumber: caseData.policyHolderIdNumber || null,
      policyHolderAddress: caseData.policyHolderAddress || null,
      insuredName: caseData.insuredName || null,
      insuredIdNumber: caseData.insuredIdNumber || null,
      insuredContact: caseData.insuredContact || null,
      insuredAddress: caseData.insuredAddress || null,
      insuredAddressDetail: caseData.insuredAddressDetail || null,
      victimName: caseData.victimName || null,
      victimContact: caseData.victimContact || null,
      victimAddress: caseData.victimAddress || null,
      victimAddressDetail: caseData.victimAddressDetail || null,
      sameAsPolicyHolder:
        caseData.sameAsPolicyHolder != null
          ? String(caseData.sameAsPolicyHolder)
          : null,
      clientPhone: caseData.clientPhone || null,
      clientAddress: caseData.clientAddress || null,
      accidentLocation: caseData.accidentLocation || null,
      accidentDescription: caseData.accidentDescription || null,
      accidentType: caseData.accidentType?.trim() || null,
      accidentCause: caseData.accidentCause?.trim() || null,
      restorationMethod: caseData.restorationMethod?.trim() || null,
      otherVendorEstimate: caseData.otherVendorEstimate?.trim() || null,
      damageItems: caseData.damageItems || null,
      damagePreventionCost: caseData.damagePreventionCost || null,
      victimIncidentAssistance: caseData.victimIncidentAssistance || null,
      assignedPartner: caseData.assignedPartner || null,
      assignedPartnerManager: caseData.assignedPartnerManager || null,
      assignedPartnerContact: caseData.assignedPartnerContact || null,
      urgency: caseData.urgency || null,
      specialRequests: caseData.specialRequests || null,
      progressStatus: caseData.progressStatus || null,
      specialNotes: caseData.specialNotes || null,
      receptionDate: autoReceptionDate,
      assignmentDate: autoAssignmentDate,
      siteVisitDate: caseData.siteVisitDate || null,
      assignedTo: caseData.assignedTo || null,
      managerId: caseData.managerId || null,
      createdBy: caseData.createdBy,
      createdAt: currentDate,
      updatedAt: getKSTTimestamp(),
    };

    const result = await db.insert(cases).values(newCase).returning();
    invalidateCasesCache();
    return result[0];
  }

  async getAllCases(user?: User): Promise<CaseWithLatestProgress[]> {
    const rawData = await getCachedCasesRaw();
    let allCases = [...rawData.cases];

    if (user) {
      const isPersonal = user.accountType === "개인";
      switch (user.role) {
        case "관리자":
          break;
        case "협력사":
          if (isPersonal) {
            allCases = allCases.filter((c: any) =>
              c.assignedPartner === user.company &&
              (c.assignedPartnerManager === user.name || c.createdBy === user.id || c.assignedTo === user.id)
            );
          } else {
            allCases = allCases.filter((c: any) => c.assignedPartner === user.company);
          }
          break;
        case "보험사":
          if (isPersonal) {
            allCases = allCases.filter((c: any) =>
              c.insuranceCompany === user.company &&
              (c.managerId === user.id || c.createdBy === user.id)
            );
          } else {
            allCases = allCases.filter((c: any) => c.insuranceCompany === user.company);
          }
          break;
        case "심사사":
          if (isPersonal) {
            allCases = allCases.filter((c: any) => c.assessorId === user.company && c.assessorTeam === user.name);
          } else {
            allCases = allCases.filter((c: any) => c.assessorId === user.company);
          }
          break;
        case "조사사":
          if (isPersonal) {
            allCases = allCases.filter((c: any) => c.investigatorTeam === user.company && c.investigatorTeamName === user.name);
          } else {
            allCases = allCases.filter((c: any) => c.investigatorTeam === user.company);
          }
          break;
        case "의뢰사":
          if (isPersonal) {
            allCases = allCases.filter((c: any) => c.clientName === user.name);
          } else {
            allCases = allCases.filter((c: any) => c.clientResidence === user.company);
          }
          break;
        default:
          return [];
      }
    }
    const allProgressUpdates = rawData.progress;

    const allUsers = await getCachedUsers();
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    // 각 케이스의 최신 진행상황 찾기
    const casesWithProgress: CaseWithLatestProgress[] = allCases.map(
      (caseItem) => {
        // 해당 케이스의 모든 진행상황 찾기
        const caseUpdates = allProgressUpdates
          .filter((update) => update.caseId === caseItem.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // 최신순 정렬

        // 최신 진행상황
        const latestUpdate = caseUpdates[0];

        // 담당자 이름 조회 (managerId로 users 테이블에서 찾기)
        const manager = caseItem.managerId
          ? userMap.get(caseItem.managerId)
          : null;


        return {
          ...caseItem,
          latestProgress: latestUpdate
            ? {
                content: latestUpdate.content,
                createdAt: latestUpdate.createdAt,
              }
            : null,
          managerName: manager?.name || null,
        };
      },
    );

    return casesWithProgress;
  }

  async updateCase(
    caseId: string,
    caseData: Partial<InsertCase> & { caseNumber?: string },
  ): Promise<Case | null> {
    const currentDate = getKSTDate();
    const currentTimestamp = getKSTTimestamp();

    // 배당 협력사 저장 시 assignmentDate 자동 기록 (기존 값이 없을 때만)
    const existingCase = await this.getCaseById(caseId);
    const additionalUpdates: Partial<typeof cases.$inferInsert> = {};

    if (
      caseData.assignedPartner &&
      existingCase &&
      !existingCase.assignmentDate
    ) {
      additionalUpdates.assignmentDate = currentDate;
    }

    // 접수취소 상태로 변경 시 접수취소일 자동 기록 (기존 값 없을 때만)
    if (
      caseData.status === "접수취소" &&
      existingCase &&
      !existingCase.cancellationDate
    ) {
      additionalUpdates.cancellationDate = currentDate;
    }

    // caseNumber도 업데이트 대상에 포함 (updatedAt은 타임스탬프로 저장)
    const updateData: any = { ...caseData, ...additionalUpdates, updatedAt: currentTimestamp };
    
    // id는 업데이트 대상에서 제외 (duplicate key 오류 방지)
    delete updateData.id;
    
    // managerId가 빈 문자열이면 null로 변환 (외래 키 제약 조건 방지)
    if (updateData.managerId === '') {
      updateData.managerId = null;
    }
    
    // Select 필드 값들 trim 처리
    if (updateData.accidentType) {
      updateData.accidentType = updateData.accidentType.trim();
    }
    if (updateData.accidentCause) {
      updateData.accidentCause = updateData.accidentCause.trim();
    }
    if (updateData.restorationMethod) {
      updateData.restorationMethod = updateData.restorationMethod.trim();
    }
    if (updateData.otherVendorEstimate) {
      updateData.otherVendorEstimate = updateData.otherVendorEstimate.trim();
    }

    const result = await db
      .update(cases)
      .set(updateData)
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    if (existingCase && caseData.status && caseData.status !== existingCase.status) {
      try {
        await this.recordStatusChange(caseId, existingCase.status, caseData.status);
      } catch (e) {
        console.error("[StatusHistory] Failed to record status change in updateCase:", e);
      }
    }

    invalidateCasesCache();
    return result[0];
  }

  async deleteCase(caseId: string): Promise<void> {
    // 1. 먼저 해당 케이스의 견적서 ID 목록 가져오기
    const caseEstimates = await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(eq(estimates.caseId, caseId));

    // 2. 각 견적서의 estimateRows 삭제
    for (const estimate of caseEstimates) {
      await db
        .delete(estimateRows)
        .where(eq(estimateRows.estimateId, estimate.id));
    }

    // 3. 견적서 삭제
    await db.delete(estimates).where(eq(estimates.caseId, caseId));

    // 4. 케이스 문서 삭제
    await db.delete(caseDocuments).where(eq(caseDocuments.caseId, caseId));

    // 5. 진행상황 업데이트 삭제
    await db.delete(progressUpdates).where(eq(progressUpdates.caseId, caseId));

    // 6. 도면 삭제 (drawings 테이블)
    await db.delete(drawings).where(eq(drawings.caseId, caseId));

    // 7. 마지막으로 케이스 삭제
    await db.delete(cases).where(eq(cases.id, caseId));
    invalidateCasesCache();
  }

  async updateCaseStatus(caseId: string, status: string): Promise<Case | null> {
    const currentDate = getKSTDate();

    // 미복구 선택 시 자동으로 출동비 청구로 정규화 (모든 경로에서 일관성 보장)
    const normalizedStatus = status === "미복구" ? "출동비 청구" : status;

    // 먼저 기존 케이스 데이터를 가져와서 일자가 이미 설정되어 있는지 확인
    const existingCase = await this.getCaseById(caseId);
    if (!existingCase) {
      return null;
    }

    // 상태에 따라 자동으로 날짜 기록 (기존 값이 없을 때만)
    const dateUpdates: Partial<typeof cases.$inferInsert> = {};

    switch (normalizedStatus) {
      case "접수완료":
        // 접수일과 배당일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.receptionDate) {
          dateUpdates.receptionDate = currentDate;
        }
        if (!existingCase.assignmentDate) {
          dateUpdates.assignmentDate = currentDate;
        }
        break;
      case "현장방문":
        // 현장방문일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.siteVisitDate) {
          dateUpdates.siteVisitDate = currentDate;
        }
        break;
      case "현장정보입력":
      case "현장정보제출":
        // 현장자료 제출일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.siteInvestigationSubmitDate) {
          dateUpdates.siteInvestigationSubmitDate = currentDate;
        }
        break;
      case "1차승인":
        // 1차 승인일(내부) 자동 기록 (기존 값 없을 때만)
        if (!existingCase.firstApprovalDate) {
          dateUpdates.firstApprovalDate = currentDate;
        }
        break;
      case "복구요청(2차승인)":
        // 2차 승인일(복구 요청일) 자동 기록 (기존 값 없을 때만)
        if (!existingCase.secondApprovalDate) {
          dateUpdates.secondApprovalDate = currentDate;
        }
        // 2차 승인 시점의 견적금액을 승인금액으로 자동 저장 (항상 덮어씀)
        if (existingCase.estimateAmount) {
          dateUpdates.approvedAmount = existingCase.estimateAmount;
        }
        break;
      case "청구자료제출(복구)":
        // 청구자료제출(복구) 시 복구완료일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.constructionCompletionDate) {
          dateUpdates.constructionCompletionDate = currentDate;
        }
        break;
      case "선견적요청":
      case "출동비청구(선견적)":
        // 선견적요청은 실제 복구를 하지 않으므로 복구완료일은 공란으로 유지
        // 청구일만 자동 기록 (기존 값 없을 때만)
        if (!existingCase.claimDate) {
          dateUpdates.claimDate = currentDate;
        }
        break;
      case "청구":
        // 청구일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.claimDate) {
          dateUpdates.claimDate = currentDate;
        }
        break;
      case "입금완료":
        // 입금완료일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.paymentCompletedDate) {
          dateUpdates.paymentCompletedDate = currentDate;
        }
        break;
      case "부분입금":
      case "부분지급":
        // 일부지급일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.partialPaymentDate) {
          dateUpdates.partialPaymentDate = currentDate;
        }
        break;
      case "지급완료":
        // 지급완료일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.paymentCompletedDate) {
          dateUpdates.paymentCompletedDate = currentDate;
        }
        break;
      case "정산완료":
        // 정산완료일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.settlementCompletedDate) {
          dateUpdates.settlementCompletedDate = currentDate;
        }
        break;
      case "접수취소":
        // 접수취소일 자동 기록 (기존 값 없을 때만)
        if (!existingCase.cancellationDate) {
          dateUpdates.cancellationDate = currentDate;
        }
        break;
    }

    // 상태에 따라 recoveryType 자동 설정
    let recoveryTypeUpdate: { recoveryType?: string } = {};
    if (normalizedStatus === "직접복구" || normalizedStatus === "청구자료제출(복구)") {
      recoveryTypeUpdate.recoveryType = "직접복구";
    } else if (normalizedStatus === "선견적요청" || normalizedStatus === "출동비청구(선견적)") {
      recoveryTypeUpdate.recoveryType = "선견적요청";
    }

    const result = await db
      .update(cases)
      .set({
        status: normalizedStatus,
        updatedAt: getKSTTimestamp(),
        ...dateUpdates,
        ...recoveryTypeUpdate,
      })
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    if (existingCase && normalizedStatus !== existingCase.status) {
      try {
        await this.recordStatusChange(caseId, existingCase.status, normalizedStatus);
      } catch (e) {
        console.error("[StatusHistory] Failed to record status change in updateCaseStatus:", e);
      }
    }

    invalidateCasesCache();
    return result[0];
  }

  async updateCaseSpecialNotes(
    caseId: string,
    specialNotes: string | null,
  ): Promise<Case | null> {
    const result = await db
      .update(cases)
      .set({
        specialNotes,
        specialNotesConfirmedBy: null,
        updatedAt: getKSTTimestamp(),
      }) // Reset confirmation when notes are updated
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async confirmCaseSpecialNotes(
    caseId: string,
    confirmedBy: string,
  ): Promise<Case | null> {
    const result = await db
      .update(cases)
      .set({ specialNotesConfirmedBy: confirmedBy, updatedAt: getKSTTimestamp() })
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async updateCaseAdditionalNotes(
    caseId: string,
    additionalNotes: string | null,
  ): Promise<Case | null> {
    const result = await db
      .update(cases)
      .set({ additionalNotes, updatedAt: getKSTTimestamp() })
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async updateCaseEstimateAmount(
    caseId: string,
    estimateAmount: string,
  ): Promise<Case | null> {
    const result = await db
      .update(cases)
      .set({ estimateAmount, updatedAt: getKSTTimestamp() })
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async submitFieldSurvey(caseId: string, estimateInfo?: { estimateTotal: string; isPrevention: boolean }): Promise<Case | null> {
    const currentDate = getKSTDate();

    // 현장자료 제출일 자동 기록 (기존 값이 없을 때만)
    const existingCase = await this.getCaseById(caseId);
    const additionalUpdates: Partial<typeof cases.$inferInsert> = {};

    if (existingCase && !existingCase.siteInvestigationSubmitDate) {
      additionalUpdates.siteInvestigationSubmitDate = currentDate;
    }

    // 최초 견적금액 기록 (기존 값이 없을 때만 - 첫 제출 시점의 견적금액을 영구 저장)
    // estimateAmount는 견적 저장 시 updateCaseEstimateAmount()에 의해 이미 저장되어 있음
    if (existingCase && !existingCase.initialEstimateAmount && existingCase.estimateAmount) {
      additionalUpdates.initialEstimateAmount = existingCase.estimateAmount;
    }
    
    // 초기 손해방지비용/대물비용 기록 (첫 제출 시점만)
    if (existingCase && estimateInfo) {
      if (estimateInfo.isPrevention && !existingCase.initialPreventionEstimateAmount) {
        additionalUpdates.initialPreventionEstimateAmount = estimateInfo.estimateTotal;
      } else if (!estimateInfo.isPrevention && !existingCase.initialPropertyEstimateAmount) {
        additionalUpdates.initialPropertyEstimateAmount = estimateInfo.estimateTotal;
      }
    }

    const result = await db
      .update(cases)
      .set({
        fieldSurveyStatus: "submitted",
        status: "검토중",
        // 재제출 시 심사 정보 초기화 (관리자가 다시 심사할 수 있도록)
        reviewDecision: null,
        reviewComment: null,
        reviewedAt: null,
        reviewedBy: null,
        // 재제출 시 보고서 승인 정보도 초기화 (2차 심사도 다시 진행하도록)
        reportApprovalDecision: null,
        reportApprovalComment: null,
        reportApprovedAt: null,
        reportApprovedBy: null,
        ...additionalUpdates,
        updatedAt: getKSTTimestamp(),
      })
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async reviewCase(
    caseId: string,
    decision: "승인" | "비승인",
    reviewComment: string | null,
    reviewedBy: string,
  ): Promise<Case | null> {
    const currentDate = getKSTDate();
    const currentTimestamp = getKSTTimestamp();

    // 승인 시 1차 승인일(내부) 자동 기록 (기존 값이 없을 때만)
    // 승인금액은 2차승인 시 확정 (approveReport에서 처리)
    const existingCase = await this.getCaseById(caseId);
    const additionalUpdates: Partial<typeof cases.$inferInsert> = {};

    if (
      decision === "승인" &&
      existingCase &&
      !existingCase.firstApprovalDate
    ) {
      additionalUpdates.firstApprovalDate = currentDate;
    }

    const result = await db
      .update(cases)
      .set({
        reviewDecision: decision,
        reviewComment: reviewComment || null,
        reviewedAt: currentTimestamp,
        reviewedBy: reviewedBy,
        status: decision === "승인" ? "1차승인" : "반려",
        ...additionalUpdates,
        updatedAt: currentTimestamp,
      })
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async approveReport(
    caseId: string,
    decision: "승인" | "비승인",
    approvalComment: string | null,
    approvedBy: string,
  ): Promise<Case | null> {
    const currentDate = getKSTDate();
    const currentTimestamp = getKSTTimestamp();

    // 현재 케이스 조회
    const existingCase = await this.getCaseById(caseId);
    
    // 현장정보제출 상태가 아니면 보고서 승인 불가
    if (!existingCase || existingCase.status !== "현장정보제출") {
      return null;
    }
    
    // 승인 시 2차 승인일 및 승인금액 확정
    const additionalUpdates: Partial<typeof cases.$inferInsert> = {};

    if (decision === "승인" && existingCase) {
      // 2차 승인일 기록 (기존 값이 없을 때만)
      if (!existingCase.secondApprovalDate) {
        additionalUpdates.secondApprovalDate = currentDate;
      }
      // 2차승인 시 승인금액 확정 (현재 견적 총액을 승인금액으로 저장 - 매번 갱신)
      // 협력사가 견적을 수정한 후 재승인 받으면 최신 금액이 저장됨
      if (existingCase.estimateAmount) {
        additionalUpdates.approvedAmount = existingCase.estimateAmount;
      }
    }

    const result = await db
      .update(cases)
      .set({
        reportApprovalDecision: decision,
        reportApprovalComment: approvalComment || null,
        reportApprovedAt: currentTimestamp,
        reportApprovedBy: approvedBy,
        // 승인 시 상태를 "복구요청(2차승인)"으로, 비승인(반려) 시 "반려"로 변경
        // 반려 시 협력사가 수정 후 재제출할 수 있도록 status를 "반려"로 설정
        status: decision === "승인" ? "복구요청(2차승인)" : "반려",
        ...additionalUpdates,
        updatedAt: currentTimestamp,
      })
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async updateCaseFieldSurvey(
    caseId: string,
    fieldData: {
      visitDate?: string | null;
      visitTime?: string | null;
      travelDistance?: string | null;
      dispatchLocation?: string | null;
      accompaniedPerson?: string | null;
      accidentDate?: string | null;
      accidentTime?: string | null;
      accidentCategory?: string | null;
      accidentCause?: string | null;
      specialNotes?: string | null;
      vocContent?: string | null; // VOC(고객의 소리) - 협력사 특이사항과 분리
      victimName?: string | null;
      victimContact?: string | null;
      victimAddress?: string | null;
      victimAddressDetail?: string | null;
      additionalVictims?: string | null;
      specialRequests?: string | null;
      processingTypes?: string | null;
      processingTypeOther?: string | null;
      recoveryMethodType?: string | null;
      fieldSurveyStatus?: string | null;
      status?: string | null; // 케이스 상태 자동 변경용
    },
  ): Promise<Case | null> {
    const currentDate = getKSTDate();

    // 현장방문일 저장 시 siteVisitDate 자동 기록 (기존 값이 없을 때만)
    const existingCase = await this.getCaseById(caseId);
    const additionalUpdates: Partial<typeof cases.$inferInsert> = {};

    if (fieldData.visitDate && existingCase && !existingCase.siteVisitDate) {
      additionalUpdates.siteVisitDate = currentDate;
    }

    // fieldSurveyStatus가 "submitted"로 변경될 때 status도 함께 "검토중"으로 변경
    // 데이터 일관성 보장: 두 상태 값이 불일치하는 것을 방지
    if (fieldData.fieldSurveyStatus === "submitted" && !fieldData.status) {
      additionalUpdates.status = "검토중";
    }

    const result = await db
      .update(cases)
      .set({ ...fieldData, ...additionalUpdates, updatedAt: getKSTTimestamp() })
      .where(eq(cases.id, caseId))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async getPartnerStats(): Promise<PartnerStats[]> {
    const allCases = await db.select().from(cases);
    const allUsers = await db
      .select()
      .from(users)
      .where(eq(users.role, "협력사"));

    const today = getKSTDate();
    const currentMonth = today.substring(0, 7); // YYYY-MM

    return allUsers.map((partner) => {
      const partnerCases = allCases.filter(
        (c) => c.assignedPartner === partner.company,
      );

      const dailyCount = partnerCases.filter(
        (c) => c.createdAt === today,
      ).length;
      const monthlyCount = partnerCases.filter((c) =>
        c.createdAt?.startsWith(currentMonth),
      ).length;
      const inProgressCount = partnerCases.filter(
        (c) => c.status !== "작성중" && c.status !== "완료",
      ).length;
      const pendingCount = partnerCases.filter(
        (c) => c.status !== "완료",
      ).length;

      return {
        partnerName: partner.company,
        dailyCount,
        monthlyCount,
        inProgressCount,
        pendingCount,
      };
    });
  }

  async createProgressUpdate(
    data: InsertProgressUpdate,
  ): Promise<ProgressUpdate> {
    const currentTimestamp = getKSTTimestamp();

    const newUpdate = {
      caseId: data.caseId,
      content: data.content,
      createdBy: data.createdBy,
      createdAt: currentTimestamp,
    };

    const result = await db
      .insert(progressUpdates)
      .values(newUpdate)
      .returning();
    invalidateCasesCache();
    return result[0];
  }

  async getProgressUpdatesByCaseId(caseId: string): Promise<ProgressUpdate[]> {
    const result = await db
      .select()
      .from(progressUpdates)
      .where(eq(progressUpdates.caseId, caseId))
      .orderBy(asc(progressUpdates.createdAt));
    return result;
  }

  async getStatisticsFilters(): Promise<StatisticsFilters> {
    // Get all cases and users
    const allCases = await db.select().from(cases);
    const allUsers = await db
      .select()
      .from(users)
      .where(eq(users.status, "active"));

    // Get unique insurance companies from cases
    const insuranceCompaniesSet = new Set<string>();
    allCases.forEach((caseItem) => {
      if (caseItem.insuranceCompany) {
        insuranceCompaniesSet.add(caseItem.insuranceCompany);
      }
    });

    // Get unique company names by role from users
    const assessorsSet = new Set<string>();
    const investigatorsSet = new Set<string>();
    const partnersSet = new Set<string>();
    const settlementManagersSet = new Set<string>();

    allUsers.forEach((user) => {
      if (user.role === "심사사" && user.company) {
        assessorsSet.add(user.company);
      } else if (user.role === "조사사" && user.company) {
        investigatorsSet.add(user.company);
      } else if (user.role === "협력사" && user.company) {
        partnersSet.add(user.company);
      }

      // Add all active users as potential settlement managers
      if (user.name) {
        settlementManagersSet.add(user.name);
      }
    });

    // Convert to sorted arrays
    return {
      insuranceCompanies: Array.from(insuranceCompaniesSet).sort(),
      assessors: Array.from(assessorsSet).sort(),
      investigators: Array.from(investigatorsSet).sort(),
      partners: Array.from(partnersSet).sort(),
      settlementManagers: Array.from(settlementManagersSet).sort(),
    };
  }

  async getRolePermission(
    roleName: string,
  ): Promise<RolePermission | undefined> {
    const result = await db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleName, roleName));
    return result[0];
  }

  async saveRolePermission(
    data: InsertRolePermission,
  ): Promise<RolePermission> {
    const currentDate = getKSTTimestamp();
    const existing = await this.getRolePermission(data.roleName);

    if (existing) {
      // Update existing
      const updated = await db
        .update(rolePermissions)
        .set({
          permissions: data.permissions,
          updatedAt: currentDate,
        })
        .where(eq(rolePermissions.roleName, data.roleName))
        .returning();
      return updated[0];
    } else {
      // Create new
      const created = await db
        .insert(rolePermissions)
        .values({
          roleName: data.roleName,
          permissions: data.permissions,
          createdAt: currentDate,
          updatedAt: currentDate,
        })
        .returning();
      return created[0];
    }
  }

  async deleteRolePermission(roleName: string): Promise<boolean> {
    const deleted = await db
      .delete(rolePermissions)
      .where(eq(rolePermissions.roleName, roleName))
      .returning();
    return deleted.length > 0;
  }

  async getAllRolePermissions(): Promise<RolePermission[]> {
    return await db.select().from(rolePermissions);
  }

  // New methods for multi-version support
  async listExcelData(type: string): Promise<ExcelData[]> {
    const result = await db
      .select()
      .from(excelData)
      .where(eq(excelData.type, type))
      .orderBy(desc(excelData.uploadedAt));
    return result;
  }

  async getExcelDataById(id: string): Promise<ExcelData | null> {
    const result = await db
      .select()
      .from(excelData)
      .where(eq(excelData.id, id))
      .limit(1);
    return result[0] || null;
  }

  async deleteExcelDataById(id: string): Promise<boolean> {
    const deleted = await db
      .delete(excelData)
      .where(eq(excelData.id, id))
      .returning();
    return deleted.length > 0;
  }

  async saveExcelData(data: InsertExcelData): Promise<ExcelData> {
    console.log("[DB] saveExcelData called with:", {
      type: data.type,
      title: data.title,
    });

    // Create new version (no longer overwrites existing)
    const created = await db
      .insert(excelData)
      .values({
        type: data.type,
        title: data.title,
        headers: data.headers as any,
        data: data.data as any,
      })
      .returning();

    console.log("[DB] saveExcelData result:", {
      id: created[0]?.id,
      type: created[0]?.type,
    });

    // Verify the insert worked
    const verify = await db
      .select()
      .from(excelData)
      .where(eq(excelData.id, created[0].id));
    console.log(
      "[DB] saveExcelData verification:",
      verify.length > 0 ? "EXISTS" : "MISSING",
    );

    return created[0];
  }

  async updateExcelData(
    id: string,
    headers: string[],
    newData: any[][],
  ): Promise<ExcelData | null> {
    const updated = await db
      .update(excelData)
      .set({
        headers: headers as any,
        data: newData as any,
        updatedAt: new Date(),
      })
      .where(eq(excelData.id, id))
      .returning();
    return updated[0] || null;
  }

  // Legacy methods (deprecated, for backward compatibility during migration)
  async getExcelData(type: string): Promise<ExcelData | null> {
    // Use listExcelData to get the latest version (already ordered by uploadedAt DESC)
    const versions = await this.listExcelData(type);
    return versions[0] || null;
  }

  async deleteExcelData(type: string): Promise<void> {
    // Delete all versions of this type
    await db.delete(excelData).where(eq(excelData.type, type));
  }

  async createInquiry(data: InsertInquiry): Promise<Inquiry> {
    const created = await db
      .insert(inquiries)
      .values({
        userId: data.userId,
        title: data.title,
        content: data.content,
        status: data.status || "대기",
        response: data.response || null,
        respondedBy: data.respondedBy || null,
        respondedAt: data.respondedAt || null,
      })
      .returning();
    return created[0];
  }

  async getAllInquiries(): Promise<Inquiry[]> {
    return await db.select().from(inquiries).orderBy(asc(inquiries.createdAt));
  }

  async getInquiriesByUserId(userId: string): Promise<Inquiry[]> {
    return await db
      .select()
      .from(inquiries)
      .where(eq(inquiries.userId, userId))
      .orderBy(asc(inquiries.createdAt));
  }

  async updateInquiry(
    id: string,
    data: Partial<UpdateInquiry>,
  ): Promise<Inquiry | null> {
    const updated = await db
      .update(inquiries)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(inquiries.id, id))
      .returning();
    return updated[0] || null;
  }

  async saveDrawing(data: InsertDrawing): Promise<Drawing> {
    const created = await db
      .insert(drawings)
      .values({
        caseId: data.caseId,
        uploadedImages: data.uploadedImages,
        rectangles: data.rectangles,
        accidentAreas: data.accidentAreas,
        leakMarkers: data.leakMarkers,
        createdBy: data.createdBy,
        canvasImage: data.canvasImage || null, // PDF 출력용 캔버스 스냅샷
      })
      .returning();
    return created[0];
  }

  async getDrawing(id: string): Promise<Drawing | null> {
    const result = await db
      .select()
      .from(drawings)
      .where(eq(drawings.id, id))
      .limit(1);
    return result[0] || null;
  }

  async getDrawingByCaseId(caseId: string): Promise<Drawing | null> {
    const result = await db
      .select()
      .from(drawings)
      .where(eq(drawings.caseId, caseId))
      .limit(1);
    return result[0] || null;
  }

  async updateDrawing(
    id: string,
    data: Partial<InsertDrawing>,
  ): Promise<Drawing | null> {
    const updated = await db
      .update(drawings)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(drawings.id, id))
      .returning();
    return updated[0] || null;
  }

  async getOrCreateActiveCase(userId: string): Promise<Case> {
    // Find existing active case (작성중) for this user
    const existing = await db
      .select()
      .from(cases)
      .where(and(eq(cases.createdBy, userId), eq(cases.status, "작성중")))
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    // Create new active case for drawing purposes
    const caseNumber = `CLM-DRAW-${Date.now()}`;
    const newCase = await db
      .insert(cases)
      .values({
        caseNumber,
        status: "작성중",
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return newCase[0];
  }

  // Document methods
  async saveDocument(data: InsertCaseDocument): Promise<CaseDocument> {
    const created = await db
      .insert(caseDocuments)
      .values({
        caseId: data.caseId,
        category: data.category,
        fileName: data.fileName,
        fileType: data.fileType,
        fileSize: data.fileSize,
        fileData: data.fileData,
        createdBy: data.createdBy,
      })
      .returning();
    return created[0];
  }

  async getDocument(id: string): Promise<CaseDocument | null> {
    const result = await db
      .select()
      .from(caseDocuments)
      .where(eq(caseDocuments.id, id))
      .limit(1);
    return result[0] || null;
  }

  async getDocumentFileData(id: string): Promise<string | null> {
    const result = await db
      .select({ fileData: caseDocuments.fileData })
      .from(caseDocuments)
      .where(eq(caseDocuments.id, id))
      .limit(1);
    return result[0]?.fileData || null;
  }

  async getDocumentsByCaseId(caseId: string): Promise<CaseDocument[]> {
    // fileData 컬럼을 제외하고 메타데이터만 가져옴 (메모리 효율)
    // 모든 이미지는 /api/documents/:id/image API를 통해 불러옴
    const result = await db
      .select({
        id: caseDocuments.id,
        caseId: caseDocuments.caseId,
        category: caseDocuments.category,
        fileName: caseDocuments.fileName,
        fileType: caseDocuments.fileType,
        fileSize: caseDocuments.fileSize,
        storageKey: caseDocuments.storageKey,
        status: caseDocuments.status,
        checksum: caseDocuments.checksum,
        displayOrder: caseDocuments.displayOrder,
        createdBy: caseDocuments.createdBy,
        createdAt: caseDocuments.createdAt,
      })
      .from(caseDocuments)
      .where(eq(caseDocuments.caseId, caseId))
      .orderBy(desc(caseDocuments.createdAt));
    
    // fileData는 null로 설정 (프론트엔드에서 API로 불러옴)
    return result.map(doc => ({ ...doc, fileData: null }));
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(caseDocuments).where(eq(caseDocuments.id, id));
  }

  async deleteDocumentsByCaseId(caseId: string): Promise<number> {
    const deleted = await db
      .delete(caseDocuments)
      .where(eq(caseDocuments.caseId, caseId))
      .returning({ id: caseDocuments.id });
    return deleted.length;
  }

  async deleteDrawingByCaseId(caseId: string): Promise<boolean> {
    const deleted = await db
      .delete(drawings)
      .where(eq(drawings.caseId, caseId))
      .returning({ id: drawings.id });
    return deleted.length > 0;
  }

  async deleteEstimatesByCaseId(caseId: string): Promise<number> {
    // 먼저 해당 케이스의 모든 견적서 ID 가져오기
    const estimateList = await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(eq(estimates.caseId, caseId));
    
    if (estimateList.length === 0) return 0;
    
    // 각 견적서에 연결된 견적행 삭제
    for (const est of estimateList) {
      await db.delete(estimateRows).where(eq(estimateRows.estimateId, est.id));
    }
    
    // 견적서 삭제
    const deleted = await db
      .delete(estimates)
      .where(eq(estimates.caseId, caseId))
      .returning({ id: estimates.id });
    
    return deleted.length;
  }

  async resetCaseFieldSurveyData(caseId: string): Promise<void> {
    console.log(`[resetCaseFieldSurveyData] Starting reset for case: ${caseId}`);
    
    // 1. 증빙자료/문서 삭제
    const docsDeleted = await this.deleteDocumentsByCaseId(caseId);
    console.log(`[resetCaseFieldSurveyData] Deleted ${docsDeleted} documents`);
    
    // 2. 도면 삭제
    const drawingDeleted = await this.deleteDrawingByCaseId(caseId);
    console.log(`[resetCaseFieldSurveyData] Drawing deleted: ${drawingDeleted}`);
    
    // 3. 견적서 삭제
    const estimatesDeleted = await this.deleteEstimatesByCaseId(caseId);
    console.log(`[resetCaseFieldSurveyData] Deleted ${estimatesDeleted} estimates`);
    
    // 4. 현장조사 관련 필드 초기화 (케이스 테이블 필드)
    await db
      .update(cases)
      .set({
        // 현장조사 필드 초기화
        surveyDate: null,
        surveyManager: null,
        buildingName: null,
        buildingType: null,
        buildingArea: null,
        buildingFloor: null,
        damageLocation: null,
        damageFloor: null,
        damageArea: null,
        damageCause: null,
        damageDescription: null,
        repairMethod: null,
        repairPeriod: null,
        repairCost: null,
        surveyNotes: null,
        // 승인 관련 필드 초기화
        approvedAmount: null,
        approvedAt: null,
        approvedBy: null,
        // 이메일 전송 관련 초기화
        emailSentAt: null,
        emailSentTo: null,
        // 인보이스 관련 초기화
        invoiceDamagePreventionAmount: null,
        invoicePropertyRepairAmount: null,
        invoiceRemarks: null,
        fieldDispatchInvoiceAmount: null,
        fieldDispatchInvoiceRemarks: null,
      })
      .where(eq(cases.id, caseId));
    
    console.log(`[resetCaseFieldSurveyData] Reset completed for case: ${caseId}`);
  }

  async updateDocumentCategory(
    id: string,
    category: string,
  ): Promise<CaseDocument | null> {
    const updated = await db
      .update(caseDocuments)
      .set({ category })
      .where(eq(caseDocuments.id, id))
      .returning();
    return updated[0] || null;
  }

  async createPendingDocument(data: {
    caseId: string;
    category: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    storageKey: string;
    displayOrder?: number;
    createdBy: string;
  }): Promise<CaseDocument> {
    const created = await db
      .insert(caseDocuments)
      .values({
        caseId: data.caseId,
        category: data.category,
        fileName: data.fileName,
        fileType: data.fileType,
        fileSize: data.fileSize,
        fileData: null,
        storageKey: data.storageKey,
        status: "pending",
        displayOrder: data.displayOrder ?? 0,
        createdBy: data.createdBy,
      })
      .returning();
    return created[0];
  }

  async updateDocumentStatus(
    id: string,
    status: "pending" | "ready" | "failed",
    checksum?: string,
  ): Promise<CaseDocument | null> {
    const updateData: { status: string; checksum?: string } = { status };
    if (checksum) {
      updateData.checksum = checksum;
    }
    const updated = await db
      .update(caseDocuments)
      .set(updateData)
      .where(eq(caseDocuments.id, id))
      .returning();
    return updated[0] || null;
  }

  // Estimate methods
  async createEstimateVersion(
    caseId: string,
    userId: string,
    rows: Omit<InsertEstimateRow, "estimateId">[],
    laborCostData: any | null = null,
    materialCostData: any | null = null,
    vatIncluded: boolean = true,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] }> {
    return await db.transaction(async (tx) => {
      // 1. 현재 최대 버전 조회 (row-level locking으로 동시성 제어)
      const existingEstimates = await tx
        .select({ version: estimates.version })
        .from(estimates)
        .where(eq(estimates.caseId, caseId))
        .orderBy(desc(estimates.version))
        .limit(1)
        .for("update"); // row-level lock 추가

      const nextVersion =
        existingEstimates.length > 0 ? existingEstimates[0].version + 1 : 1;

      // 2. 새 견적 레코드 생성 (노무비/자재비 데이터 포함, vatIncluded는 materialCostData에 같이 저장)
      // materialCostData에 vatIncluded 옵션을 함께 저장 (배열이 아닌 객체 형태로 감싸서)
      const enrichedMaterialCostData = {
        rows: materialCostData || [],
        vatIncluded, // VAT 포함/별도 옵션 저장
      };

      const [newEstimate] = await tx
        .insert(estimates)
        .values({
          caseId,
          version: nextVersion,
          status: "draft",
          createdBy: userId,
          laborCostData: Array.isArray(laborCostData) ? laborCostData : null,
          materialCostData: enrichedMaterialCostData,
        })
        .returning();

      // 3. 견적 행들을 배치로 삽입
      if (rows.length > 0) {
        // rowOrder 정규화: 정렬 후 1부터 순차적으로 할당
        const sortedInputRows = [...rows].sort((a, b) => {
          const orderA = a.rowOrder ?? 0;
          const orderB = b.rowOrder ?? 0;
          return orderA - orderB;
        });

        const rowsWithEstimateId = sortedInputRows.map((row, index) => ({
          ...row,
          estimateId: newEstimate.id,
          rowOrder: index + 1, // 1부터 시작하는 순차적 번호
        }));

        // Raw SQL insert를 사용하여 drizzle-orm의 bigint 타입 추론 문제 우회
        const insertedRows: EstimateRow[] = [];
        
        // [C] 서버 로깅: DB insert 직전
        if (rowsWithEstimateId.length > 0) {
          console.log("========================================");
          console.log("[C] 서버: DB insert 직전");
          console.log("첫 번째 행 데이터:");
          console.log("  repairWidth:", rowsWithEstimateId[0].repairWidth, "타입:", typeof rowsWithEstimateId[0].repairWidth);
          console.log("  repairHeight:", rowsWithEstimateId[0].repairHeight, "타입:", typeof rowsWithEstimateId[0].repairHeight);
          console.log("  repairArea:", rowsWithEstimateId[0].repairArea, "타입:", typeof rowsWithEstimateId[0].repairArea);
          console.log("  damageWidth:", rowsWithEstimateId[0].damageWidth, "타입:", typeof rowsWithEstimateId[0].damageWidth);
          console.log("  damageHeight:", rowsWithEstimateId[0].damageHeight, "타입:", typeof rowsWithEstimateId[0].damageHeight);
          console.log("  damageArea:", rowsWithEstimateId[0].damageArea, "타입:", typeof rowsWithEstimateId[0].damageArea);
          console.log("========================================");
        }
        
        for (const row of rowsWithEstimateId) {
          // Raw SQL INSERT 사용 - Drizzle의 타입 추론 문제를 완전히 우회
          const toNumber = (val: number | string | null | undefined): number | null => {
            if (val === null || val === undefined) return null;
            const num = typeof val === 'string' ? parseFloat(val) : val;
            return isNaN(num) ? null : num;
          };
          
          // 소수점 값을 문자열로 명시적 변환 (4자리 보장)
          const toNumericStr = (val: number | null): string | null => {
            if (val === null) return null;
            // 소수점 4자리까지 보장하여 PostgreSQL NUMERIC 정확도 유지
            return val.toFixed(4);
          };
          
          const rowId = randomUUID();
          const damageWidth = toNumber(row.damageWidth);
          const damageHeight = toNumber(row.damageHeight);
          const damageArea = toNumber(row.damageArea);
          const repairWidth = toNumber(row.repairWidth);
          const repairHeight = toNumber(row.repairHeight);
          const repairArea = toNumber(row.repairArea);
          
          // Raw SQL INSERT로 Drizzle의 타입 변환 문제 우회 - 명시적 문자열 캐스팅
          const damageWidthStr = toNumericStr(damageWidth);
          const damageHeightStr = toNumericStr(damageHeight);
          const damageAreaStr = toNumericStr(damageArea);
          const repairWidthStr = toNumericStr(repairWidth);
          const repairHeightStr = toNumericStr(repairHeight);
          const repairAreaStr = toNumericStr(repairArea);
          
          // 명시적 NUMERIC 캐스팅으로 소수점 정확도 보장
          await tx.execute(sql`
            INSERT INTO estimate_rows (
              id, estimate_id, category, location, work_type, work_name,
              damage_width, damage_height, damage_area,
              repair_width, repair_height, repair_area,
              note, row_order, created_at
            ) VALUES (
              ${rowId},
              ${row.estimateId},
              ${row.category || ''},
              ${row.location || null},
              ${row.workType || null},
              ${row.workName || null},
              ${damageWidthStr !== null ? sql`CAST(${damageWidthStr} AS NUMERIC(20,4))` : sql`NULL`},
              ${damageHeightStr !== null ? sql`CAST(${damageHeightStr} AS NUMERIC(20,4))` : sql`NULL`},
              ${damageAreaStr !== null ? sql`CAST(${damageAreaStr} AS NUMERIC(20,4))` : sql`NULL`},
              ${repairWidthStr !== null ? sql`CAST(${repairWidthStr} AS NUMERIC(20,4))` : sql`NULL`},
              ${repairHeightStr !== null ? sql`CAST(${repairHeightStr} AS NUMERIC(20,4))` : sql`NULL`},
              ${repairAreaStr !== null ? sql`CAST(${repairAreaStr} AS NUMERIC(20,4))` : sql`NULL`},
              ${row.note || null},
              ${row.rowOrder},
              NOW()
            )
          `);
          
          // [C-2] DB INSERT 결과 로깅
          if (row.rowOrder === 1) {
            console.log("========================================");
            console.log("[C-2] 서버: Raw SQL INSERT 완료");
            console.log("  repairWidth:", repairWidth, "→ DB:", repairWidthStr);
            console.log("  repairHeight:", repairHeight, "→ DB:", repairHeightStr);
            console.log("  repairArea:", repairArea, "→ DB:", repairAreaStr);
            console.log("========================================");
          }
          
          insertedRows.push({
            id: rowId,
            estimateId: row.estimateId,
            category: row.category || '',
            location: row.location || null,
            workType: row.workType || null,
            workName: row.workName || null,
            damageWidth: damageWidth,
            damageHeight: damageHeight,
            damageArea: damageArea,
            repairWidth: repairWidth,
            repairHeight: repairHeight,
            repairArea: repairArea,
            note: row.note || null,
            rowOrder: row.rowOrder,
          });
        }

        // rowOrder로 정렬하여 반환
        const sortedRows = insertedRows.sort((a, b) => a.rowOrder - b.rowOrder);

        return { estimate: newEstimate, rows: sortedRows };
      }

      return { estimate: newEstimate, rows: [] };
    });
  }

  async getLatestEstimate(
    caseId: string,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null> {
    // 최신 버전의 견적 조회
    const latestEstimate = await db
      .select()
      .from(estimates)
      .where(eq(estimates.caseId, caseId))
      .orderBy(desc(estimates.version))
      .limit(1);

    if (latestEstimate.length === 0) {
      return null;
    }

    const estimate = latestEstimate[0];

    // 해당 견적의 행들을 조회
    const rawRows = await db
      .select()
      .from(estimateRows)
      .where(eq(estimateRows.estimateId, estimate.id))
      .orderBy(asc(estimateRows.rowOrder));

    // numeric 타입은 문자열로 반환되므로 숫자로 파싱
    const parseNumeric = (val: any): number | null => {
      if (val === null || val === undefined) return null;
      const num = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(num) ? null : num;
    };

    const rows = rawRows.map(row => ({
      ...row,
      damageWidth: parseNumeric(row.damageWidth),
      damageHeight: parseNumeric(row.damageHeight),
      damageArea: parseNumeric(row.damageArea),
      repairWidth: parseNumeric(row.repairWidth),
      repairHeight: parseNumeric(row.repairHeight),
      repairArea: parseNumeric(row.repairArea),
    }));

    return { estimate, rows };
  }

  async getEstimateVersion(
    caseId: string,
    version: number,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null> {
    // 특정 버전의 견적 조회
    const result = await db
      .select()
      .from(estimates)
      .where(and(eq(estimates.caseId, caseId), eq(estimates.version, version)))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const estimate = result[0];

    // 해당 견적의 행들을 조회
    const rawRows = await db
      .select()
      .from(estimateRows)
      .where(eq(estimateRows.estimateId, estimate.id))
      .orderBy(asc(estimateRows.rowOrder));

    // numeric 타입은 문자열로 반환되므로 숫자로 파싱
    const parseNumeric = (val: any): number | null => {
      if (val === null || val === undefined) return null;
      const num = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(num) ? null : num;
    };

    const rows = rawRows.map(row => ({
      ...row,
      damageWidth: parseNumeric(row.damageWidth),
      damageHeight: parseNumeric(row.damageHeight),
      damageArea: parseNumeric(row.damageArea),
      repairWidth: parseNumeric(row.repairWidth),
      repairHeight: parseNumeric(row.repairHeight),
      repairArea: parseNumeric(row.repairArea),
    }));

    return { estimate, rows };
  }

  async listEstimateVersions(caseId: string): Promise<Estimate[]> {
    // 모든 버전의 견적 리스트 조회 (최신 버전부터)
    const allVersions = await db
      .select()
      .from(estimates)
      .where(eq(estimates.caseId, caseId))
      .orderBy(desc(estimates.version));

    return allVersions;
  }

  // Master data methods
  async getMasterData(
    category?: string,
    includeInactive: boolean = false,
  ): Promise<MasterData[]> {
    if (category) {
      if (includeInactive) {
        // 특정 카테고리의 모든 데이터 조회 (관리자용)
        return await db
          .select()
          .from(masterData)
          .where(eq(masterData.category, category))
          .orderBy(asc(masterData.displayOrder), asc(masterData.value));
      } else {
        // 특정 카테고리의 활성 데이터만 조회 (displayOrder 순서로)
        return await db
          .select()
          .from(masterData)
          .where(
            and(
              eq(masterData.category, category),
              eq(masterData.isActive, "true"),
            ),
          )
          .orderBy(asc(masterData.displayOrder), asc(masterData.value));
      }
    } else {
      if (includeInactive) {
        // 모든 데이터 조회 (관리자용)
        return await db
          .select()
          .from(masterData)
          .orderBy(
            asc(masterData.category),
            asc(masterData.displayOrder),
            asc(masterData.value),
          );
      } else {
        // 모든 활성 데이터 조회
        return await db
          .select()
          .from(masterData)
          .where(eq(masterData.isActive, "true"))
          .orderBy(
            asc(masterData.category),
            asc(masterData.displayOrder),
            asc(masterData.value),
          );
      }
    }
  }

  async createMasterData(data: InsertMasterData): Promise<MasterData> {
    const [created] = await db.insert(masterData).values(data).returning();
    return created;
  }

  async deleteMasterData(id: string): Promise<void> {
    // Hard delete: 실제로 데이터를 삭제
    await db
      .delete(masterData)
      .where(eq(masterData.id, id));
  }

  async updateMasterData(
    id: string,
    data: Partial<InsertMasterData>,
  ): Promise<MasterData | null> {
    const [updated] = await db
      .update(masterData)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(masterData.id, id))
      .returning();

    return updated || null;
  }

  // Labor cost methods
  async getLaborCosts(filters?: {
    category?: string;
    workName?: string;
    detailWork?: string;
  }): Promise<LaborCost[]> {
    let query = db.select().from(laborCosts);

    const conditions = [];
    if (filters?.category) {
      conditions.push(eq(laborCosts.category, filters.category));
    }
    if (filters?.workName) {
      conditions.push(eq(laborCosts.workName, filters.workName));
    }
    if (filters?.detailWork) {
      conditions.push(eq(laborCosts.detailWork, filters.detailWork));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(
      asc(laborCosts.category),
      asc(laborCosts.workName),
    );
  }

  async getLaborCostOptions(): Promise<{
    categories: string[];
    workNamesByCategory: Record<string, string[]>;
    detailWorksByWork: Record<string, string[]>;
  }> {
    const allCosts = await db
      .select()
      .from(laborCosts)
      .orderBy(asc(laborCosts.category), asc(laborCosts.workName));

    const categories = new Set<string>();
    const workNamesByCategory: Record<string, Set<string>> = {};
    const detailWorksByWork: Record<string, Set<string>> = {};

    for (const cost of allCosts) {
      const category = cost.category?.trim();
      const workName = cost.workName?.trim();
      const detailWork = cost.detailWork?.trim();

      if (!category || !workName || !detailWork) continue;

      categories.add(category);

      if (!workNamesByCategory[category]) {
        workNamesByCategory[category] = new Set();
      }
      workNamesByCategory[category].add(workName);

      const workKey = `${category}|${workName}`;
      if (!detailWorksByWork[workKey]) {
        detailWorksByWork[workKey] = new Set();
      }
      detailWorksByWork[workKey].add(detailWork);
    }

    return {
      categories: Array.from(categories),
      workNamesByCategory: Object.fromEntries(
        Object.entries(workNamesByCategory).map(([k, v]) => [k, Array.from(v)]),
      ),
      detailWorksByWork: Object.fromEntries(
        Object.entries(detailWorksByWork).map(([k, v]) => [k, Array.from(v)]),
      ),
    };
  }

  async createLaborCost(data: InsertLaborCost): Promise<LaborCost> {
    const [created] = await db.insert(laborCosts).values(data).returning();
    return created;
  }

  async deleteLaborCost(id: string): Promise<void> {
    await db.delete(laborCosts).where(eq(laborCosts.id, Number(id)));
  }

  // Material methods
  async listMaterials(workType?: string): Promise<Material[]> {
    let query = db.select().from(materials);

    if (workType) {
      query = query.where(
        and(eq(materials.isActive, "true"), eq(materials.workType, workType)),
      );
    } else {
      query = query.where(eq(materials.isActive, "true"));
    }

    return query.orderBy(
      asc(materials.workType),
      asc(materials.materialName),
      asc(materials.specification),
    );
  }

  async createMaterial(data: InsertMaterial): Promise<Material> {
    const [created] = await db.insert(materials).values(data).returning();
    return created;
  }

  async deleteMaterial(id: string): Promise<void> {
    await db.delete(materials).where(eq(materials.id, Number(id)));
  }

  async getMaterialsCatalog(): Promise<
    Array<{
      workType: string;
      workName: string;
      materialName: string;
      specification: string;
      unit: string;
      standardPrice: number | string;
    }>
  > {
    // Get 자재비 data from excel_data table, sorted by upload date (최신 데이터 먼저)
    const excelRows = await db
      .select()
      .from(excelData)
      .where(eq(excelData.type, "자재비"))
      .orderBy(sql`${excelData.uploadedAt} DESC`);

    if (excelRows.length === 0) {
      return [];
    }

    // Take the most recent upload (first in DESC order)
    const latestExcelData = excelRows[0];
    const headers = latestExcelData.headers as string[];
    const data = latestExcelData.data as any[][];

    console.log("[getMaterialsCatalog] 자재비 Excel 헤더:", headers);

    // Find column indices - flexible matching for various Excel formats
    // 공종: 첫 번째 컬럼 (공종, 공종명)
    const workTypeIdx = headers.findIndex((h) => h.trim() === "공종" || h.trim() === "공종명" || h.includes("공종"));
    // 공사명: 두 번째 컬럼 (공사명) - 자재항목보다 먼저 찾기
    const workNameIdx = headers.findIndex((h) => h.trim() === "공사명" || (h.includes("공사") && !h.includes("자재")));
    // 자재항목: 세 번째 컬럼 (자재항목, 자재명)
    const materialNameIdx = headers.findIndex((h) => h.trim() === "자재항목" || h.trim() === "자재명" || h.includes("자재"));
    const specIdx = headers.findIndex((h) => h.includes("규격"));
    const unitIdx = headers.findIndex((h) => h.trim() === "단위" || h.includes("단위"));
    const priceIdx = headers.findIndex((h) => h.trim().includes("단가"));

    console.log("[getMaterialsCatalog] 컬럼 인덱스:", { workTypeIdx, workNameIdx, materialNameIdx, specIdx, unitIdx, priceIdx });

    if (materialNameIdx === -1 || unitIdx === -1 || priceIdx === -1) {
      console.error("Missing required columns in excel_data 자재비", { 
        headers, 
        workNameIdx,
        materialNameIdx, 
        unitIdx, 
        priceIdx 
      });
      return [];
    }

    // Forward-fill processing
    let lastWorkType = "";
    let lastWorkName = "";
    let lastMaterialName = "";
    let lastSpecification = "";

    const catalog: Array<{
      workType: string;
      workName: string;
      materialName: string;
      specification: string;
      unit: string;
      standardPrice: number | string;
    }> = [];

    for (const row of data) {
      // Skip empty rows or rows with invalid structure
      if (!row || row.length === 0) continue;

      // Get values with forward-fill
      const workType =
        workTypeIdx !== -1 && row[workTypeIdx]
          ? String(row[workTypeIdx]).trim()
          : lastWorkType;
      const workName =
        workNameIdx !== -1 && row[workNameIdx]
          ? String(row[workNameIdx]).trim()
          : lastWorkName;
      const materialName = row[materialNameIdx] ? String(row[materialNameIdx]).trim() : lastMaterialName;
      const specification = row[specIdx] ? String(row[specIdx]).trim() : lastSpecification;
      const unit = row[unitIdx] ? String(row[unitIdx]).trim() : "";
      const price = row[priceIdx];

      // Skip if essential fields are missing
      if (
        !workType ||
        !workName ||
        !materialName ||
        !unit ||
        price === undefined ||
        price === null
      ) {
        continue;
      }

      // Update last values for forward-fill
      if (workTypeIdx !== -1 && row[workTypeIdx]) lastWorkType = workType;
      if (workNameIdx !== -1 && row[workNameIdx]) lastWorkName = workName;
      if (row[materialNameIdx]) lastMaterialName = materialName;
      if (row[specIdx] !== null && row[specIdx] !== undefined)
        lastSpecification = specification;

      // Parse price: if it's "입력", keep as string; otherwise convert to number
      let standardPrice: number | string = price;
      if (typeof price === "string") {
        // Remove commas and try to parse
        const cleaned = price.replace(/,/g, "");
        const parsed = parseFloat(cleaned);
        standardPrice = isNaN(parsed) ? price : parsed;
      }

      catalog.push({
        workType,
        workName,
        materialName,
        specification: specification || "-",
        unit,
        standardPrice,
      });
    }

    console.log("[getMaterialsCatalog] 총 카탈로그 개수:", catalog.length);
    if (catalog.length > 0) {
      console.log("[getMaterialsCatalog] 샘플:", catalog.slice(0, 3));
    }

    return catalog;
  }

  // User favorites methods
  async getUserFavorites(userId: string): Promise<UserFavorite[]> {
    const favorites = await db
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.userId, userId))
      .orderBy(asc(userFavorites.createdAt));
    return favorites;
  }

  async addFavorite(data: InsertUserFavorite): Promise<UserFavorite> {
    const [favorite] = await db.insert(userFavorites).values(data).returning();
    return favorite;
  }

  async removeFavorite(userId: string, menuName: string): Promise<void> {
    await db
      .delete(userFavorites)
      .where(
        and(
          eq(userFavorites.userId, userId),
          eq(userFavorites.menuName, menuName),
        ),
      );
  }

  // Notice methods
  async getAllNotices(): Promise<Notice[]> {
    const allNotices = await db
      .select()
      .from(notices)
      .orderBy(desc(notices.createdAt));
    return allNotices;
  }

  async createNotice(data: InsertNotice): Promise<Notice> {
    const [created] = await db.insert(notices).values(data).returning();
    return created;
  }

  async updateNotice(
    id: string,
    data: { title: string; content: string },
  ): Promise<Notice | null> {
    const [updated] = await db
      .update(notices)
      .set({
        title: data.title,
        content: data.content,
        updatedAt: new Date(),
      })
      .where(eq(notices.id, id))
      .returning();
    return updated || null;
  }

  async deleteNotice(id: string): Promise<void> {
    await db.delete(notices).where(eq(notices.id, id));
  }

  async deleteInquiry(id: string): Promise<void> {
    await db.delete(inquiries).where(eq(inquiries.id, id));
  }

  // Asset cloning methods (for syncing from related cases)
  async getRelatedCaseWithDrawing(
    caseId: string,
  ): Promise<{ caseId: string; caseNumber: string } | null> {
    // Get the source case to find its accident number or policy number
    const sourceCase = await this.getCaseById(caseId);
    if (!sourceCase) return null;

    let relatedCases: Case[] = [];

    // 1차: 사고번호가 있으면 사고번호 기준으로 검색
    if (sourceCase.insuranceAccidentNo) {
      relatedCases = await this.getCasesByAccidentNo(
        sourceCase.insuranceAccidentNo,
        caseId,
      );
    }
    // 2차: 사고번호가 없고 증권번호가 있으면 증권번호 기준으로 검색
    else if (sourceCase.insurancePolicyNo) {
      const allCasesWithPolicyNo = await db
        .select()
        .from(cases)
        .where(eq(cases.insurancePolicyNo, sourceCase.insurancePolicyNo))
        .orderBy(asc(cases.caseNumber));
      
      relatedCases = allCasesWithPolicyNo.filter((c) => c.id !== caseId);
    }

    // Find the first related case that has a drawing
    for (const relatedCase of relatedCases) {
      const drawing = await this.getDrawingByCaseId(relatedCase.id);
      if (drawing) {
        return {
          caseId: relatedCase.id,
          caseNumber: relatedCase.caseNumber || "",
        };
      }
    }
    return null;
  }

  async getAllRelatedCasesWithDrawings(
    caseId: string,
  ): Promise<Array<{ caseId: string; caseNumber: string; status: string | null }>> {
    // Get the source case to find its accident number or policy number
    const sourceCase = await this.getCaseById(caseId);
    if (!sourceCase) return [];

    let relatedCases: Case[] = [];

    // 1차: 사고번호가 있으면 사고번호 기준으로 검색
    if (sourceCase.insuranceAccidentNo) {
      relatedCases = await this.getCasesByAccidentNo(
        sourceCase.insuranceAccidentNo,
        caseId,
      );
    }
    // 2차: 사고번호가 없고 증권번호가 있으면 증권번호 기준으로 검색
    else if (sourceCase.insurancePolicyNo) {
      const allCasesWithPolicyNo = await db
        .select()
        .from(cases)
        .where(eq(cases.insurancePolicyNo, sourceCase.insurancePolicyNo))
        .orderBy(asc(cases.caseNumber));
      
      // 현재 케이스 제외
      relatedCases = allCasesWithPolicyNo.filter((c) => c.id !== caseId);
    }

    // Return ALL related cases (not just those with drawings)
    const allRelatedCases: Array<{ caseId: string; caseNumber: string; status: string | null }> = [];
    for (const relatedCase of relatedCases) {
      allRelatedCases.push({
        caseId: relatedCase.id,
        caseNumber: relatedCase.caseNumber || "",
        status: relatedCase.status,
      });
    }
    return allRelatedCases;
  }

  async getRelatedCaseWithEstimate(
    caseId: string,
  ): Promise<{ caseId: string; caseNumber: string } | null> {
    // Get the source case to find its accident number or policy number
    const sourceCase = await this.getCaseById(caseId);
    if (!sourceCase) return null;

    let relatedCases: Case[] = [];

    // 1차: 사고번호가 있으면 사고번호 기준으로 검색
    if (sourceCase.insuranceAccidentNo) {
      relatedCases = await this.getCasesByAccidentNo(
        sourceCase.insuranceAccidentNo,
        caseId,
      );
    }
    // 2차: 사고번호가 없고 증권번호가 있으면 증권번호 기준으로 검색
    else if (sourceCase.insurancePolicyNo) {
      const allCasesWithPolicyNo = await db
        .select()
        .from(cases)
        .where(eq(cases.insurancePolicyNo, sourceCase.insurancePolicyNo))
        .orderBy(asc(cases.caseNumber));
      
      relatedCases = allCasesWithPolicyNo.filter((c) => c.id !== caseId);
    }

    // Find the first related case that has an estimate
    for (const relatedCase of relatedCases) {
      const estimate = await this.getLatestEstimate(relatedCase.id);
      if (estimate) {
        return {
          caseId: relatedCase.id,
          caseNumber: relatedCase.caseNumber || "",
        };
      }
    }
    return null;
  }

  async getRelatedCaseWithDocuments(
    caseId: string,
  ): Promise<{
    caseId: string;
    caseNumber: string;
    documentCount: number;
  } | null> {
    // Get the source case to find its accident number or policy number
    const sourceCase = await this.getCaseById(caseId);
    if (!sourceCase) return null;

    let relatedCases: Case[] = [];

    // 1차: 사고번호가 있으면 사고번호 기준으로 검색
    if (sourceCase.insuranceAccidentNo) {
      relatedCases = await this.getCasesByAccidentNo(
        sourceCase.insuranceAccidentNo,
        caseId,
      );
    }
    // 2차: 사고번호가 없고 증권번호가 있으면 증권번호 기준으로 검색
    else if (sourceCase.insurancePolicyNo) {
      const allCasesWithPolicyNo = await db
        .select()
        .from(cases)
        .where(eq(cases.insurancePolicyNo, sourceCase.insurancePolicyNo))
        .orderBy(asc(cases.caseNumber));
      
      relatedCases = allCasesWithPolicyNo.filter((c) => c.id !== caseId);
    }

    // Find the first related case that has documents
    for (const relatedCase of relatedCases) {
      const docs = await this.getDocumentsByCaseId(relatedCase.id);
      if (docs && docs.length > 0) {
        return {
          caseId: relatedCase.id,
          caseNumber: relatedCase.caseNumber || "",
          documentCount: docs.length,
        };
      }
    }
    return null;
  }

  async cloneDrawingFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<Drawing | null> {
    // Get source drawing
    const sourceDrawing = await this.getDrawingByCaseId(sourceCaseId);
    if (!sourceDrawing) return null;

    // Check if target already has a drawing
    const existingDrawing = await this.getDrawingByCaseId(targetCaseId);
    if (existingDrawing) {
      // Update existing drawing with source data
      const updated = await this.updateDrawing(existingDrawing.id, {
        uploadedImages: sourceDrawing.uploadedImages,
        rectangles: sourceDrawing.rectangles,
        accidentAreas: sourceDrawing.accidentAreas,
        leakMarkers: sourceDrawing.leakMarkers,
      });
      return updated;
    }

    // Create new drawing for target case
    const newDrawing = await this.saveDrawing({
      caseId: targetCaseId,
      uploadedImages: sourceDrawing.uploadedImages,
      rectangles: sourceDrawing.rectangles,
      accidentAreas: sourceDrawing.accidentAreas,
      leakMarkers: sourceDrawing.leakMarkers,
      createdBy: userId,
    });
    return newDrawing;
  }

  async cloneEstimateFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<{ estimate: Estimate; rows: EstimateRow[] } | null> {
    // Get source estimate with rows
    const sourceEstimate = await this.getLatestEstimate(sourceCaseId);
    if (!sourceEstimate) return null;

    // Create new estimate for target case (version 1)
    const rowsData = sourceEstimate.rows.map((row) => ({
      category: row.category,
      location: row.location,
      workName: row.workName,
      damageWidth: row.damageWidth,
      damageHeight: row.damageHeight,
      damageArea: row.damageArea,
      repairWidth: row.repairWidth,
      repairHeight: row.repairHeight,
      repairArea: row.repairArea,
      note: row.note,
      rowOrder: row.rowOrder,
    }));

    const newEstimate = await this.createEstimateVersion(
      targetCaseId,
      userId,
      rowsData,
      sourceEstimate.estimate.laborCostData,
      sourceEstimate.estimate.materialCostData,
    );

    return newEstimate;
  }

  async cloneDocumentsFromCase(
    sourceCaseId: string,
    targetCaseId: string,
    userId: string,
  ): Promise<CaseDocument[]> {
    // Get source documents
    const sourceDocuments = await this.getDocumentsByCaseId(sourceCaseId);
    if (!sourceDocuments || sourceDocuments.length === 0) return [];

    // Clone each document
    const clonedDocuments: CaseDocument[] = [];
    for (const doc of sourceDocuments) {
      const newDoc = await this.saveDocument({
        caseId: targetCaseId,
        category: doc.category,
        fileName: doc.fileName,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        fileData: doc.fileData,
        createdBy: userId,
      });
      clonedDocuments.push(newDoc);
    }
    return clonedDocuments;
  }

  // Field Survey Data methods
  async getFieldSurveyData(
    caseGroupId: string,
  ): Promise<FieldSurveyData | null> {
    const [result] = await db
      .select()
      .from(fieldSurveyData)
      .where(eq(fieldSurveyData.caseGroupId, caseGroupId))
      .limit(1);
    return result || null;
  }

  async saveFieldSurveyData(
    data: InsertFieldSurveyData,
  ): Promise<FieldSurveyData> {
    const [created] = await db.insert(fieldSurveyData).values(data).returning();
    return created;
  }

  async updateFieldSurveyData(
    caseGroupId: string,
    data: Partial<InsertFieldSurveyData>,
  ): Promise<FieldSurveyData | null> {
    const [updated] = await db
      .update(fieldSurveyData)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(fieldSurveyData.caseGroupId, caseGroupId))
      .returning();
    return updated || null;
  }

  // Shared Drawing methods
  async getSharedDrawing(caseGroupId: string): Promise<SharedDrawing | null> {
    const [result] = await db
      .select()
      .from(sharedDrawings)
      .where(eq(sharedDrawings.caseGroupId, caseGroupId))
      .limit(1);
    return result || null;
  }

  async saveSharedDrawing(data: InsertSharedDrawing): Promise<SharedDrawing> {
    const [created] = await db.insert(sharedDrawings).values(data).returning();
    return created;
  }

  async updateSharedDrawing(
    caseGroupId: string,
    data: Partial<InsertSharedDrawing>,
  ): Promise<SharedDrawing | null> {
    const [updated] = await db
      .update(sharedDrawings)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(sharedDrawings.caseGroupId, caseGroupId))
      .returning();
    return updated || null;
  }

  // Case group methods
  async getCasesByGroupId(caseGroupId: string): Promise<Case[]> {
    const result = await db
      .select()
      .from(cases)
      .where(eq(cases.caseGroupId, caseGroupId))
      .orderBy(asc(cases.caseNumber));
    return result;
  }

  // Same accident number methods (for field survey sync)
  async getCasesByAccidentNo(
    accidentNo: string,
    excludeCaseId?: string,
  ): Promise<Case[]> {
    if (!accidentNo) return [];

    const conditions = [eq(cases.insuranceAccidentNo, accidentNo)];

    const result = await db
      .select()
      .from(cases)
      .where(and(...conditions))
      .orderBy(asc(cases.caseNumber));

    // Filter out the excluded case if provided
    if (excludeCaseId) {
      return result.filter((c) => c.id !== excludeCaseId);
    }
    return result;
  }

  // 접수번호 prefix를 기준으로 관련 케이스 조회 (예: 251203001 -> 251203001, 251203001-1, 251203001-2)
  async getCasesByCaseNumberPrefix(
    caseNumber: string,
    excludeCaseId?: string,
  ): Promise<Case[]> {
    if (!caseNumber) return [];

    // Extract prefix from case number (e.g., "251203001-1" -> "251203001")
    const prefix = caseNumber.split("-")[0];
    if (!prefix) return [];

    // Find all cases that start with this prefix
    const result = await db
      .select()
      .from(cases)
      .where(sql`${cases.caseNumber} LIKE ${prefix + "%"}`)
      .orderBy(asc(cases.caseNumber));

    // Filter out the excluded case if provided
    if (excludeCaseId) {
      return result.filter((c) => c.id !== excludeCaseId);
    }
    return result;
  }

  async syncFieldSurveyToRelatedCases(
    sourceCaseId: string,
    fieldData: Partial<InsertCase>,
  ): Promise<number> {
    // Get source case to find its case number prefix
    const sourceCase = await this.getCaseById(sourceCaseId);
    if (!sourceCase || !sourceCase.caseNumber) {
      console.log(
        `[Field Survey Sync] Source case ${sourceCaseId} not found or no case number`,
      );
      return 0;
    }

    // Get all related cases by case number prefix (e.g., 251203001 -> 251203001, 251203001-1, 251203001-2)
    const relatedCases = await this.getCasesByCaseNumberPrefix(
      sourceCase.caseNumber,
      sourceCaseId,
    );

    if (relatedCases.length === 0) {
      console.log(
        `[Field Survey Sync] No related cases found for ${sourceCase.caseNumber}`,
      );
      return 0;
    }

    console.log(
      `[Field Survey Sync] Syncing field data from ${sourceCase.caseNumber} to ${relatedCases.length} related cases:`,
      relatedCases.map((c) => c.caseNumber).join(", "),
    );

    // Update all related cases with the field survey data
    let updatedCount = 0;
    for (const relatedCase of relatedCases) {
      try {
        await db
          .update(cases)
          .set(fieldData)
          .where(eq(cases.id, relatedCase.id));
        updatedCount++;
        console.log(
          `[Field Survey Sync] Updated case ${relatedCase.caseNumber}`,
        );
      } catch (error) {
        console.error(
          `Failed to sync field survey to case ${relatedCase.id}:`,
          error,
        );
      }
    }

    return updatedCount;
  }

  // Real-time sync for drawings to all related cases (same case number prefix)
  async syncDrawingToRelatedCases(sourceCaseId: string): Promise<number> {
    const sourceCase = await this.getCaseById(sourceCaseId);
    if (!sourceCase || !sourceCase.caseNumber) {
      console.log(
        `[Drawing Sync] Source case ${sourceCaseId} not found or no case number`,
      );
      return 0;
    }

    const relatedCases = await this.getCasesByCaseNumberPrefix(
      sourceCase.caseNumber,
      sourceCaseId,
    );
    if (relatedCases.length === 0) {
      console.log(
        `[Drawing Sync] No related cases found for ${sourceCase.caseNumber}`,
      );
      return 0;
    }

    // Get source drawing
    const sourceDrawing = await this.getDrawingByCaseId(sourceCaseId);
    if (!sourceDrawing) {
      console.log(
        `[Drawing Sync] No drawing found for source case ${sourceCaseId}`,
      );
      return 0;
    }

    console.log(
      `[Drawing Sync] Syncing drawing from ${sourceCase.caseNumber} to ${relatedCases.length} related cases:`,
      relatedCases.map((c) => c.caseNumber).join(", "),
    );

    let syncedCount = 0;
    for (const relatedCase of relatedCases) {
      try {
        // Check if related case already has a drawing
        const existingDrawing = await this.getDrawingByCaseId(relatedCase.id);

        if (existingDrawing) {
          // Update existing drawing with source data
          await db
            .update(drawings)
            .set({
              uploadedImages: sourceDrawing.uploadedImages,
              rectangles: sourceDrawing.rectangles,
              accidentAreas: sourceDrawing.accidentAreas,
              leakMarkers: sourceDrawing.leakMarkers,
            })
            .where(eq(drawings.id, existingDrawing.id));
        } else {
          // Create new drawing for related case
          await db.insert(drawings).values({
            id: randomUUID(),
            caseId: relatedCase.id,
            uploadedImages: sourceDrawing.uploadedImages,
            rectangles: sourceDrawing.rectangles,
            accidentAreas: sourceDrawing.accidentAreas,
            leakMarkers: sourceDrawing.leakMarkers,
            createdBy: sourceDrawing.createdBy,
            createdAt: getKSTDate(),
          });
        }
        syncedCount++;
        console.log(`[Drawing Sync] Updated case ${relatedCase.caseNumber}`);
      } catch (error) {
        console.error(
          `Failed to sync drawing to case ${relatedCase.id}:`,
          error,
        );
      }
    }

    console.log(
      `[Drawing Sync] Synced drawing from case ${sourceCase.caseNumber} to ${syncedCount} related cases`,
    );
    return syncedCount;
  }

  // Real-time sync for new documents to all related cases (same case number prefix)
  async syncDocumentsToRelatedCases(
    sourceCaseId: string,
    newDocument: CaseDocument,
  ): Promise<number> {
    const sourceCase = await this.getCaseById(sourceCaseId);
    if (!sourceCase || !sourceCase.caseNumber) {
      console.log(
        `[Document Sync] Source case ${sourceCaseId} not found or no case number`,
      );
      return 0;
    }

    const relatedCases = await this.getCasesByCaseNumberPrefix(
      sourceCase.caseNumber,
      sourceCaseId,
    );
    if (relatedCases.length === 0) {
      console.log(
        `[Document Sync] No related cases found for ${sourceCase.caseNumber}`,
      );
      return 0;
    }

    console.log(
      `[Document Sync] Syncing document "${newDocument.fileName}" from ${sourceCase.caseNumber} to ${relatedCases.length} related cases:`,
      relatedCases.map((c) => c.caseNumber).join(", "),
    );

    let syncedCount = 0;
    for (const relatedCase of relatedCases) {
      try {
        // Create the same document for related case (duplicate with new id)
        await db.insert(caseDocuments).values({
          id: randomUUID(),
          caseId: relatedCase.id,
          category: newDocument.category,
          fileName: newDocument.fileName,
          fileType: newDocument.fileType,
          fileSize: newDocument.fileSize,
          base64Data: newDocument.base64Data,
          description: newDocument.description,
          uploadedBy: newDocument.uploadedBy,
          uploadedAt: getKSTDate(),
        });
        syncedCount++;
        console.log(`[Document Sync] Synced to case ${relatedCase.caseNumber}`);
      } catch (error) {
        console.error(
          `Failed to sync document to case ${relatedCase.id}:`,
          error,
        );
      }
    }

    console.log(
      `[Document Sync] Synced document "${newDocument.fileName}" from case ${sourceCase.caseNumber} to ${syncedCount} related cases`,
    );
    return syncedCount;
  }

  // Real-time sync for estimates to all related cases (same case number prefix)
  async syncEstimateToRelatedCases(sourceCaseId: string): Promise<number> {
    const sourceCase = await this.getCaseById(sourceCaseId);
    if (!sourceCase || !sourceCase.caseNumber) {
      console.log(
        `[Estimate Sync] Source case ${sourceCaseId} not found or no case number`,
      );
      return 0;
    }

    const relatedCases = await this.getCasesByCaseNumberPrefix(
      sourceCase.caseNumber,
      sourceCaseId,
    );
    if (relatedCases.length === 0) {
      return 0;
    }

    // Get source estimate with rows
    const sourceEstimate = await this.getLatestEstimate(sourceCaseId);
    if (!sourceEstimate) {
      return 0;
    }

    let syncedCount = 0;
    for (const relatedCase of relatedCases) {
      try {
        // Get next version for related case
        const existingVersions = await db
          .select({ version: estimates.version })
          .from(estimates)
          .where(eq(estimates.caseId, relatedCase.id))
          .orderBy(desc(estimates.version))
          .limit(1);

        const nextVersion = (existingVersions[0]?.version || 0) + 1;
        const newEstimateId = randomUUID();

        // Create new estimate version for related case
        await db.insert(estimates).values({
          id: newEstimateId,
          caseId: relatedCase.id,
          version: nextVersion,
          createdBy: sourceEstimate.estimate.createdBy,
          createdAt: new Date(), // Use Date object for timestamp column
          laborCostData: sourceEstimate.estimate.laborCostData,
          materialCostData: sourceEstimate.estimate.materialCostData,
          vatIncluded: sourceEstimate.estimate.vatIncluded,
        });

        // Copy all rows
        for (let i = 0; i < sourceEstimate.rows.length; i++) {
          const row = sourceEstimate.rows[i];
          await db.insert(estimateRows).values({
            id: randomUUID(),
            estimateId: newEstimateId,
            rowOrder: i + 1,
            category: row.category,
            location: row.location,
            workType: row.workType,
            workName: row.workName,
            damageWidthMm: row.damageWidthMm,
            damageHeightMm: row.damageHeightMm,
            damageAreaMm2: row.damageAreaMm2,
            repairWidthMm: row.repairWidthMm,
            repairHeightMm: row.repairHeightMm,
            repairAreaMm2: row.repairAreaMm2,
            note: row.note,
          });
        }

        // Update case's estimate amount if available (최초 제출 시에만 - 이미 값이 있으면 덮어쓰지 않음)
        if (sourceCase.estimateAmount && (!relatedCase.estimateAmount || relatedCase.estimateAmount === "0")) {
          await db
            .update(cases)
            .set({ estimateAmount: sourceCase.estimateAmount })
            .where(eq(cases.id, relatedCase.id));
        }

        syncedCount++;
      } catch (error: any) {
        console.error(
          `[Estimate Sync Error] Failed to sync to case ${relatedCase.id}:`,
          {
            message: error?.message || "Unknown error",
            code: error?.code || "No error code",
            stack:
              error?.stack?.split("\n").slice(0, 5).join("\n") || "No stack",
            sourceCaseId,
            targetCaseId: relatedCase.id,
          },
        );
      }
    }

    console.log(
      `[Estimate Sync] Synced estimate from case ${sourceCaseId} to ${syncedCount} related cases`,
    );
    return syncedCount;
  }

  // Case number helpers
  // 손해방지 케이스 확인 (prefix-0 형식 = 손해방지, 기존 prefix만 있는 것도 체크)
  async getPreventionCaseByPrefix(prefix: string): Promise<Case | null> {
    // 새 형식 (prefix-0) 먼저 확인
    const newFormat = await db
      .select()
      .from(cases)
      .where(eq(cases.caseNumber, `${prefix}-0`))
      .limit(1);
    if (newFormat[0]) return newFormat[0];
    
    // 기존 형식 (prefix만) 호환성 체크
    const oldFormat = await db
      .select()
      .from(cases)
      .where(eq(cases.caseNumber, prefix))
      .limit(1);
    return oldFormat[0] || null;
  }

  // 피해세대복구 다음 suffix 계산
  async getNextVictimSuffix(prefix: string): Promise<number> {
    // Find all cases with this prefix (including prefix itself and prefix-N)
    const allCases = await db
      .select({ caseNumber: cases.caseNumber })
      .from(cases)
      .where(sql`${cases.caseNumber} LIKE ${prefix + "%"}`);

    // Find the maximum suffix used
    let maxSuffix = 0;
    for (const c of allCases) {
      if (c.caseNumber && c.caseNumber.startsWith(prefix + "-")) {
        const suffixStr = c.caseNumber.split("-")[1];
        const suffix = parseInt(suffixStr, 10);
        if (!isNaN(suffix) && suffix > maxSuffix) {
          maxSuffix = suffix;
        }
      }
    }

    return maxSuffix + 1;
  }

  // 같은 prefix를 가진 케이스들 조회 (예: 251102001, 251102001-1, 251102001-2)
  async getCasesByPrefix(
    prefix: string,
    excludeCaseId?: string,
  ): Promise<Case[]> {
    // Find all cases with this prefix (including prefix itself and prefix-N)
    const allCases = await db
      .select()
      .from(cases)
      .where(
        sql`${cases.caseNumber} = ${prefix} OR ${cases.caseNumber} LIKE ${prefix + "-%"}`,
      );

    // Exclude the source case if specified
    if (excludeCaseId) {
      return allCases.filter((c) => c.id !== excludeCaseId);
    }

    return allCases;
  }

  // 접수 정보를 같은 prefix 케이스들에 동기화
  async syncIntakeDataToRelatedCases(sourceCaseId: string): Promise<number> {
    const sourceCase = await this.getCaseById(sourceCaseId);
    if (!sourceCase || !sourceCase.caseNumber) {
      return 0;
    }

    // Extract prefix from case number (e.g., "251102001" from "251102001-1")
    const prefix = sourceCase.caseNumber.split("-")[0];

    const relatedCases = await this.getCasesByPrefix(prefix, sourceCaseId);
    if (relatedCases.length === 0) {
      return 0;
    }

    // 동기화할 접수 정보 필드들 (caseNumber, status, id 제외)
    const syncData: Partial<Case> = {
      // 담당자 정보
      managerId: sourceCase.managerId,
      // 기본 정보
      accidentDate: sourceCase.accidentDate,
      insuranceCompany: sourceCase.insuranceCompany,
      insurancePolicyNo: sourceCase.insurancePolicyNo,
      insuranceAccidentNo: sourceCase.insuranceAccidentNo,
      // 의뢰사 정보
      clientResidence: sourceCase.clientResidence,
      clientDepartment: sourceCase.clientDepartment,
      clientName: sourceCase.clientName,
      clientContact: sourceCase.clientContact,
      // 심사사 정보
      assessorId: sourceCase.assessorId,
      assessorDepartment: sourceCase.assessorDepartment,
      assessorTeam: sourceCase.assessorTeam,
      assessorContact: sourceCase.assessorContact,
      assessorEmail: sourceCase.assessorEmail, // 심사사 이메일 동기화 추가
      // 조사사 정보
      investigatorTeam: sourceCase.investigatorTeam,
      investigatorDepartment: sourceCase.investigatorDepartment,
      investigatorTeamName: sourceCase.investigatorTeamName,
      investigatorContact: sourceCase.investigatorContact,
      investigatorEmail: sourceCase.investigatorEmail, // 조사사 이메일 동기화 추가
      // 보험계약자 정보
      policyHolderName: sourceCase.policyHolderName,
      policyHolderIdNumber: sourceCase.policyHolderIdNumber,
      policyHolderAddress: sourceCase.policyHolderAddress,
      // 피보험자 정보 (이름, 연락처 동기화 - 주소는 별도 처리)
      insuredName: sourceCase.insuredName,
      insuredIdNumber: sourceCase.insuredIdNumber,
      insuredContact: sourceCase.insuredContact,
      // 피보험자 주소: 모든 케이스에 동기화 (피해세대는 victimAddress로도 복사)
      insuredAddress: sourceCase.insuredAddress,
      insuredAddressDetail: sourceCase.insuredAddressDetail,
      sameAsPolicyHolder: sourceCase.sameAsPolicyHolder,
      // 피해자 정보 - 동기화에서 제외 (각 케이스별로 개별 관리)
      // victimName, victimContact는 각 케이스에서 독립적으로 관리
      // victimAddress, victimAddressDetail은 -0 케이스 업데이트 시 별도 처리
      // 사고 정보 - accidentCause는 현장조사에서 입력하므로 접수 동기화에서 제외
      accidentType: sourceCase.accidentType,
      // accidentCause는 현장조사 정보이므로 syncFieldSurveyToRelatedCases에서 별도 관리
      accidentDescription: sourceCase.accidentDescription,
      restorationMethod: sourceCase.restorationMethod,
      otherVendorEstimate: sourceCase.otherVendorEstimate,
      // 협력사 배당 정보
      assignedPartner: sourceCase.assignedPartner,
      assignedPartnerManager: sourceCase.assignedPartnerManager,
      assignedPartnerContact: sourceCase.assignedPartnerContact,
      // 기타
      urgency: sourceCase.urgency,
      specialRequests: sourceCase.specialRequests,
    };

    // 소스 케이스가 -0 (손해방지) 케이스인지 확인
    const sourceSuffix = sourceCase.caseNumber.includes("-") 
      ? sourceCase.caseNumber.split("-")[1] 
      : null;
    const sourceIsDamagePrevention = sourceSuffix === "0";

    // null이나 빈 값은 동기화에서 제외 (기존 값 유지)
    const filteredSyncData: Partial<Case> = {};
    for (const [key, value] of Object.entries(syncData)) {
      if (value !== null && value !== undefined && value !== "") {
        (filteredSyncData as any)[key] = value;
      }
    }
    
    console.log(`[Intake Sync] Syncing ${Object.keys(filteredSyncData).length} non-empty fields from case ${sourceCase.caseNumber}`);
    
    let syncedCount = 0;
    for (const relatedCase of relatedCases) {
      try {
        // 기본 동기화 데이터 (null/빈 값 제외)
        const updateData: Partial<Case> = {
          ...filteredSyncData,
          updatedAt: getKSTDate(),
        };
        
        // -0 케이스에서 피보험자 주소가 변경된 경우, -1+ 케이스의 victimAddress도 업데이트
        if (sourceIsDamagePrevention && relatedCase.caseNumber) {
          const relatedSuffix = relatedCase.caseNumber.includes("-") 
            ? relatedCase.caseNumber.split("-")[1] 
            : null;
          const relatedIsVictim = relatedSuffix && parseInt(relatedSuffix) >= 1;
          
          if (relatedIsVictim) {
            // 피해세대 케이스: victimAddress를 피보험자 주소로 업데이트
            updateData.victimAddress = sourceCase.insuredAddress || "";
            
            // 피해자 정보가 없는 경우에만 victimAddressDetail도 업데이트
            const hasVictimInfo = !!(relatedCase.victimName || relatedCase.victimContact || relatedCase.victimAddressDetail);
            if (!hasVictimInfo) {
              updateData.victimAddressDetail = sourceCase.insuredAddressDetail || "";
            }
            
            console.log(
              `[Intake Sync] Updating victimAddress for victim case ${relatedCase.caseNumber} with insuredAddress from -0 case`,
            );
          }
        }
        
        await db
          .update(cases)
          .set(updateData)
          .where(eq(cases.id, relatedCase.id));
        syncedCount++;
      } catch (error) {
        console.error(
          `Failed to sync intake data to case ${relatedCase.id}:`,
          error,
        );
      }
    }

    console.log(
      `[Intake Sync] Synced intake data from case ${sourceCaseId} (${sourceCase.caseNumber}) to ${syncedCount} related cases`,
    );
    return syncedCount;
  }

  // 새로 생성된 피해자 케이스에 기존 관련 케이스(-0)의 현장입력 데이터 복사
  async copyFieldSurveyFromRelatedCase(newCaseId: string): Promise<boolean> {
    const newCase = await this.getCaseById(newCaseId);
    if (!newCase || !newCase.caseNumber) {
      console.log(`[Field Survey Copy] New case ${newCaseId} not found or no case number`);
      return false;
    }

    // Extract prefix from case number (e.g., "251102001-1" -> "251102001")
    const prefix = newCase.caseNumber.split("-")[0];
    
    // Find source case with field survey data (prefer -0 case)
    const relatedCases = await this.getCasesByPrefix(prefix, newCaseId);
    if (relatedCases.length === 0) {
      console.log(`[Field Survey Copy] No related cases found for ${newCase.caseNumber}`);
      return false;
    }

    // Find the -0 case or any case with field survey data
    let sourceCase: Case | null = null;
    
    // First try to find -0 case
    for (const c of relatedCases) {
      if (c.caseNumber?.endsWith("-0")) {
        sourceCase = c;
        break;
      }
    }
    
    // If no -0 case, find any case with field survey data
    if (!sourceCase) {
      for (const c of relatedCases) {
        if (c.accidentCause || c.visitDate || c.accidentCategory) {
          sourceCase = c;
          break;
        }
      }
    }

    if (!sourceCase) {
      console.log(`[Field Survey Copy] No source case with field survey data found for ${newCase.caseNumber}`);
      return false;
    }

    // Field survey fields to copy (excluding victim-specific info and status fields)
    const fieldSurveyData: Partial<Case> = {
      visitDate: sourceCase.visitDate,
      visitTime: sourceCase.visitTime,
      travelDistance: sourceCase.travelDistance,
      dispatchLocation: sourceCase.dispatchLocation,
      accompaniedPerson: sourceCase.accompaniedPerson,
      accidentTime: sourceCase.accidentTime,
      accidentCategory: sourceCase.accidentCategory,
      accidentCause: sourceCase.accidentCause,
      specialNotes: sourceCase.specialNotes,
      vocContent: sourceCase.vocContent,
      processingTypes: sourceCase.processingTypes,
      processingTypeOther: sourceCase.processingTypeOther,
      recoveryMethodType: sourceCase.recoveryMethodType,
      // Exclude: victimName, victimContact, victimAddress, victimAddressDetail (case-specific)
      // Exclude: fieldSurveyStatus, status (case-specific workflow)
      updatedAt: getKSTDate(),
    };

    // Filter out null/undefined values
    const filteredData: Partial<Case> = {};
    for (const [key, value] of Object.entries(fieldSurveyData)) {
      if (value !== null && value !== undefined) {
        (filteredData as any)[key] = value;
      }
    }

    if (Object.keys(filteredData).length <= 1) { // Only updatedAt
      console.log(`[Field Survey Copy] No field survey data to copy from ${sourceCase.caseNumber}`);
      return false;
    }

    try {
      await db
        .update(cases)
        .set(filteredData)
        .where(eq(cases.id, newCaseId));
      
      console.log(
        `[Field Survey Copy] Copied ${Object.keys(filteredData).length - 1} field survey fields from ${sourceCase.caseNumber} to ${newCase.caseNumber}`,
      );
      return true;
    } catch (error) {
      console.error(`[Field Survey Copy] Failed to copy field survey data:`, error);
      return false;
    }
  }

  // 기존 케이스들의 날짜를 상태 기반으로 자동 채우기
  async migrateExistingCaseDates(): Promise<number> {
    const allCases = await db.select().from(cases);
    let updatedCount = 0;

    for (const caseItem of allCases) {
      const dateUpdates: Partial<typeof cases.$inferInsert> = {};
      const baseDate = caseItem.createdAt || getKSTDate();

      // 접수일: 없으면 createdAt으로 설정
      if (!caseItem.receptionDate) {
        dateUpdates.receptionDate = baseDate;
      }

      // 상태에 따라 순차적으로 날짜 채우기
      const status = caseItem.status;
      const statusOrder = [
        "배당대기",
        "접수완료",
        "현장방문",
        "현장정보입력",
        "검토중",
        "반려",
        "1차승인",
        "현장정보제출",
        "복구요청(2차승인)",
        "직접복구",
        "선견적요청",
        "청구자료제출(복구)",
        "출동비청구(선견적)",
        "청구",
        "입금완료",
        "부분입금",
        "정산완료",
      ];

      const currentIndex = statusOrder.indexOf(status || "");

      // 배당일: 접수완료 이후 상태면 설정
      if (
        !caseItem.assignmentDate &&
        currentIndex >= statusOrder.indexOf("접수완료")
      ) {
        dateUpdates.assignmentDate = baseDate;
      }

      // 현장방문일: 현장방문 이후 상태면 설정
      if (
        !caseItem.siteVisitDate &&
        currentIndex >= statusOrder.indexOf("현장방문")
      ) {
        dateUpdates.siteVisitDate = baseDate;
      }

      // 현장자료 제출일: 현장정보입력 이후 상태면 설정
      if (
        !caseItem.siteInvestigationSubmitDate &&
        currentIndex >= statusOrder.indexOf("현장정보입력")
      ) {
        dateUpdates.siteInvestigationSubmitDate = baseDate;
      }

      // 1차 승인일: 1차승인 이후 상태면 설정
      if (
        !caseItem.firstApprovalDate &&
        currentIndex >= statusOrder.indexOf("1차승인")
      ) {
        dateUpdates.firstApprovalDate = baseDate;
      }

      // 2차 승인일: 복구요청(2차승인) 이후 상태면 설정
      if (
        !caseItem.secondApprovalDate &&
        currentIndex >= statusOrder.indexOf("복구요청(2차승인)")
      ) {
        dateUpdates.secondApprovalDate = baseDate;
      }

      // 복구완료일: 청구자료제출 또는 출동비 청구 이후 상태면 설정
      if (
        !caseItem.constructionCompletionDate &&
        (currentIndex >=
          statusOrder.indexOf("청구자료제출(복구)") ||
          currentIndex >=
            statusOrder.indexOf("출동비청구(선견적)"))
      ) {
        dateUpdates.constructionCompletionDate = baseDate;
      }

      // 청구일: 청구 이후 상태면 설정
      if (!caseItem.claimDate && currentIndex >= statusOrder.indexOf("청구")) {
        dateUpdates.claimDate = baseDate;
      }

      // 업데이트할 내용이 있으면 DB 업데이트
      if (Object.keys(dateUpdates).length > 0) {
        await db
          .update(cases)
          .set(dateUpdates)
          .where(eq(cases.id, caseItem.id));
        updatedCount++;
      }
    }

    console.log(
      `[Date Migration] Updated ${updatedCount} cases with auto-populated dates`,
    );
    return updatedCount;
  }

  // Case change log methods
  async createCaseChangeLog(data: InsertCaseChangeLog): Promise<CaseChangeLog> {
    const [log] = await db.insert(caseChangeLogs).values(data).returning();
    return log;
  }

  async getCaseChangeLogs(caseId: string): Promise<CaseChangeLog[]> {
    return await db
      .select()
      .from(caseChangeLogs)
      .where(eq(caseChangeLogs.caseId, caseId))
      .orderBy(desc(caseChangeLogs.changedAt));
  }

  async getAllCaseChangeLogs(filters?: {
    caseNumber?: string;
    changedBy?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<(CaseChangeLog & { caseNumber: string })[]> {
    const conditions: any[] = [];

    if (filters?.changedBy) {
      conditions.push(eq(caseChangeLogs.changedBy, filters.changedBy));
    }

    if (filters?.dateFrom) {
      conditions.push(
        sql`${caseChangeLogs.changedAt}::date >= ${filters.dateFrom}::date`,
      );
    }

    if (filters?.dateTo) {
      conditions.push(
        sql`${caseChangeLogs.changedAt}::date <= ${filters.dateTo}::date`,
      );
    }

    // Join with cases to get caseNumber and filter by it
    const query = db
      .select({
        id: caseChangeLogs.id,
        caseId: caseChangeLogs.caseId,
        changedBy: caseChangeLogs.changedBy,
        changedByName: caseChangeLogs.changedByName,
        changedAt: caseChangeLogs.changedAt,
        changeType: caseChangeLogs.changeType,
        changes: caseChangeLogs.changes,
        note: caseChangeLogs.note,
        caseNumber: cases.caseNumber,
      })
      .from(caseChangeLogs)
      .innerJoin(cases, eq(caseChangeLogs.caseId, cases.id))
      .orderBy(desc(caseChangeLogs.changedAt));

    if (filters?.caseNumber) {
      conditions.push(like(cases.caseNumber, `%${filters.caseNumber}%`));
    }

    if (conditions.length > 0) {
      return await query.where(and(...conditions));
    }

    return await query;
  }

  // Settlement methods
  async createSettlement(data: InsertSettlement, createdBy: string): Promise<Settlement> {
    const [settlement] = await db
      .insert(settlements)
      .values({
        ...data,
        createdBy,
        createdAt: getKSTTimestamp(),
      })
      .returning();
    return settlement;
  }

  async updateSettlement(id: string, data: Partial<InsertSettlement>): Promise<Settlement | null> {
    const [updated] = await db
      .update(settlements)
      .set(data)
      .where(eq(settlements.id, id))
      .returning();
    return updated || null;
  }

  async getSettlementsByCaseId(caseId: string): Promise<Settlement[]> {
    return await db
      .select()
      .from(settlements)
      .where(eq(settlements.caseId, caseId))
      .orderBy(desc(settlements.createdAt));
  }

  async getLatestSettlementByCaseId(caseId: string): Promise<Settlement | null> {
    const result = await db
      .select()
      .from(settlements)
      .where(eq(settlements.caseId, caseId))
      .orderBy(desc(settlements.createdAt))
      .limit(1);
    return result[0] || null;
  }

  async getAllSettlements(): Promise<Settlement[]> {
    return await db
      .select()
      .from(settlements)
      .orderBy(desc(settlements.createdAt));
  }

  // Labor rate tiers methods
  async getLaborRateTiers(): Promise<LaborRateTier[]> {
    const tiers = await db
      .select()
      .from(laborRateTiers)
      .orderBy(asc(laborRateTiers.sortOrder));
    
    // 데이터가 없으면 초기화
    if (tiers.length === 0) {
      await this.initializeLaborRateTiers();
      return await db
        .select()
        .from(laborRateTiers)
        .orderBy(asc(laborRateTiers.sortOrder));
    }
    
    return tiers;
  }

  async updateLaborRateTiers(updates: UpdateLaborRateTier[]): Promise<LaborRateTier[]> {
    await db.delete(laborRateTiers);

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      await db.insert(laborRateTiers).values({
        minRatio: update.minRatio,
        rateMultiplier: update.rateMultiplier,
        sortOrder: i + 1,
        updatedAt: new Date(),
      });
    }
    
    return await this.getLaborRateTiers();
  }

  async initializeLaborRateTiers(): Promise<void> {
    // 기존 데이터 확인
    const existing = await db.select().from(laborRateTiers);
    if (existing.length > 0) {
      return; // 이미 데이터가 있으면 초기화하지 않음
    }

    // 기본 요율 데이터 삽입
    for (const tier of DEFAULT_LABOR_RATE_TIERS) {
      await db.insert(laborRateTiers).values(tier);
    }
    console.log("[Storage] Labor rate tiers initialized with default values");
  }

  // Invoice methods
  async createInvoice(data: InsertInvoice, createdBy: string): Promise<Invoice> {
    const [invoice] = await db
      .insert(invoices)
      .values({
        ...data,
        createdAt: getKSTTimestamp(),
      })
      .returning();
    return invoice;
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | null> {
    const [updated] = await db
      .update(invoices)
      .set({
        ...data,
        updatedAt: getKSTTimestamp(),
      })
      .where(eq(invoices.id, id))
      .returning();
    return updated || null;
  }

  async getInvoiceById(id: string): Promise<Invoice | null> {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id));
    return invoice || null;
  }

  async getInvoiceByCaseId(caseId: string): Promise<Invoice | null> {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.caseId, caseId))
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    return invoice || null;
  }

  async getInvoiceByCaseGroupPrefix(caseGroupPrefix: string): Promise<Invoice | null> {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.caseGroupPrefix, caseGroupPrefix))
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    return invoice || null;
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .orderBy(desc(invoices.createdAt));
  }

  async getApprovedInvoices(): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(or(
        eq(invoices.status, "approved"),
        eq(invoices.status, "partial")
      ))
      .orderBy(desc(invoices.createdAt));
  }

  // Unit Price Override methods (D값 관리)
  async getAllUnitPriceOverrides(): Promise<UnitPriceOverride[]> {
    const result = await db.execute(sql`
      SELECT id, category, work_name as "workName", labor_item as "laborItem", 
             standard_work_quantity::text as "standardWorkQuantity", 
             created_at as "createdAt", updated_at as "updatedAt"
      FROM unit_price_overrides
      ORDER BY category, work_name
    `);
    return result.rows.map((row: any) => ({
      ...row,
      standardWorkQuantity: parseFloat(row.standardWorkQuantity)
    })) as UnitPriceOverride[];
  }

  async getUnitPriceOverride(category: string, workName: string, laborItem: string): Promise<UnitPriceOverride | null> {
    const result = await db.execute(sql`
      SELECT id, category, work_name as "workName", labor_item as "laborItem", 
             standard_work_quantity::text as "standardWorkQuantity", 
             created_at as "createdAt", updated_at as "updatedAt"
      FROM unit_price_overrides
      WHERE category = ${category} AND work_name = ${workName} AND labor_item = ${laborItem}
    `);
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as any;
    return {
      ...row,
      standardWorkQuantity: parseFloat(row.standardWorkQuantity)
    } as UnitPriceOverride;
  }

  async upsertUnitPriceOverride(data: InsertUnitPriceOverride): Promise<UnitPriceOverride> {
    const existing = await this.getUnitPriceOverride(data.category, data.workName, data.laborItem);
    
    console.log("[upsertUnitPriceOverride] Input:", { 
      ...data, 
      standardWorkQuantity: data.standardWorkQuantity,
      type: typeof data.standardWorkQuantity 
    });
    console.log("[upsertUnitPriceOverride] Existing:", existing);
    
    // 숫자 검증 (SQL 인젝션 방지 - 엄격한 검증)
    const numValue = Number(data.standardWorkQuantity);
    if (isNaN(numValue) || !isFinite(numValue)) {
      throw new Error(`Invalid standardWorkQuantity: ${data.standardWorkQuantity}`);
    }
    // 문자열로 변환하고 정규식으로 재검증 (SQL 인젝션 방지)
    const strValue = String(numValue);
    if (!/^-?\d+(\.\d+)?$/.test(strValue)) {
      throw new Error(`Invalid numeric format: ${strValue}`);
    }
    console.log("[upsertUnitPriceOverride] strValue:", strValue);
    
    // SQL 리터럴로 직접 삽입 (Neon serverless 파라미터 바인딩 문제 우회)
    if (existing) {
      const queryText = `
        UPDATE unit_price_overrides 
        SET standard_work_quantity = '${strValue}'::numeric, 
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, category, work_name as "workName", labor_item as "laborItem", 
                  standard_work_quantity::text as "standardWorkQuantity", 
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      console.log("[upsertUnitPriceOverride] UPDATE query with literal:", strValue, "id:", existing.id);
      const result = await pool.query(queryText, [existing.id]);
      console.log("[upsertUnitPriceOverride] UPDATE result:", result.rows[0]);
      const row = result.rows[0] as any;
      return {
        ...row,
        standardWorkQuantity: parseFloat(row.standardWorkQuantity)
      } as UnitPriceOverride;
    } else {
      const queryText = `
        INSERT INTO unit_price_overrides (category, work_name, labor_item, standard_work_quantity, created_at, updated_at)
        VALUES ($1, $2, $3, '${strValue}'::numeric, NOW(), NOW())
        RETURNING id, category, work_name as "workName", labor_item as "laborItem", 
                  standard_work_quantity::text as "standardWorkQuantity", 
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      console.log("[upsertUnitPriceOverride] INSERT query with literal:", strValue);
      const result = await pool.query(queryText, [data.category, data.workName, data.laborItem]);
      console.log("[upsertUnitPriceOverride] INSERT result:", result.rows[0]);
      const row = result.rows[0] as any;
      return {
        ...row,
        standardWorkQuantity: parseFloat(row.standardWorkQuantity)
      } as UnitPriceOverride;
    }
  }

  async bulkUpsertUnitPriceOverrides(items: InsertUnitPriceOverride[]): Promise<UnitPriceOverride[]> {
    const results: UnitPriceOverride[] = [];
    for (const item of items) {
      const result = await this.upsertUnitPriceOverride(item);
      results.push(result);
    }
    return results;
  }

  // Estimate Exclusions methods (철거공사 노무비 삭제 영속화)
  async getEstimateExclusions(caseId: string, exclusionType: string): Promise<EstimateExclusion[]> {
    return await db
      .select()
      .from(estimateExclusions)
      .where(and(
        eq(estimateExclusions.caseId, caseId),
        eq(estimateExclusions.exclusionType, exclusionType)
      ))
      .orderBy(asc(estimateExclusions.createdAt));
  }

  async addEstimateExclusion(data: InsertEstimateExclusion): Promise<EstimateExclusion> {
    // Upsert: 이미 존재하면 무시, 없으면 추가
    const existing = await db
      .select()
      .from(estimateExclusions)
      .where(and(
        eq(estimateExclusions.caseId, data.caseId),
        eq(estimateExclusions.exclusionType, data.exclusionType),
        eq(estimateExclusions.deletionKey, data.deletionKey)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0];
    }
    
    const [result] = await db
      .insert(estimateExclusions)
      .values(data)
      .returning();
    return result;
  }

  async removeEstimateExclusion(caseId: string, exclusionType: string, deletionKey: string): Promise<boolean> {
    const result = await db
      .delete(estimateExclusions)
      .where(and(
        eq(estimateExclusions.caseId, caseId),
        eq(estimateExclusions.exclusionType, exclusionType),
        eq(estimateExclusions.deletionKey, deletionKey)
      ))
      .returning();
    return result.length > 0;
  }

  async recordStatusChange(caseId: string, previousStatus: string, newStatus: string): Promise<CaseStatusHistory> {
    const changedAt = getKSTTimestamp();
    const result = await db
      .insert(caseStatusHistory)
      .values({ caseId, previousStatus, newStatus, changedAt })
      .returning();
    return result[0];
  }

  async getStatusHistoryByCaseId(caseId: string): Promise<CaseStatusHistory[]> {
    return await db
      .select()
      .from(caseStatusHistory)
      .where(eq(caseStatusHistory.caseId, caseId))
      .orderBy(asc(caseStatusHistory.id));
  }

  async getAllStatusHistory(): Promise<CaseStatusHistory[]> {
    return await db
      .select()
      .from(caseStatusHistory)
      .orderBy(asc(caseStatusHistory.id));
  }
}

export const storage = new DbStorage();
