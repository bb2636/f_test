import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { activeUserSessions, sessionStore } from "./session-store";
import {
  loginSchema,
  updatePasswordSchema,
  deleteAccountSchema,
  createAccountSchema,
  changeMyPasswordSchema,
  forceChangePasswordSchema,
  updateUserSchema,
  insertCaseSchema,
  insertCaseRequestSchema,
  insertProgressUpdateSchema,
  insertRolePermissionSchema,
  insertExcelDataSchema,
  insertInquirySchema,
  updateInquirySchema,
  respondInquirySchema,
  insertDrawingSchema,
  insertCaseDocumentSchema,
  insertMasterDataSchema,
  insertLaborCostSchema,
  insertMaterialSchema,
  reviewCaseSchema,
  approveReportSchema,
  insertSettlementSchema,
} from "@shared/schema";
import { z } from "zod";
import { db } from "./db";
import { estimates, cases } from "@shared/schema";
import { sql, inArray, eq, and } from "drizzle-orm";
import nodemailer from "nodemailer";
import https from "https";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  registerObjectStorageRoutes,
  objectStorageClient,
  signObjectURL,
} from "./replit_integrations/object_storage";
import { sendNotificationEmail, sendAccountCreationEmail } from "./email";
import {
  generatePdfWithPdfLib,
  generatePdfWithSizeLimitPdfLib,
  generateEvidencePDFsByTab,
} from "./pdf-lib-service";
import {
  generateInvoicePdf,
  sendInvoiceEmailWithAttachment,
} from "./invoice-pdf-service";
import {
  sendFieldReportEmail,
  sendFieldReportEmailWithLink,
  sendEmailWithAttachment,
} from "./hiworks-email";
import {
  generateEvidencePdfs,
  logAttachmentSummary,
} from "./evidence-pdf-service";
import { compressPdf, isPdfFile, compressPdfForEmail } from "./pdf-compression";

// 피해세대 케이스용 피해자 주소 설정 헬퍼 함수
// 규칙:
// - 피해자 정보가 없는 경우: victimAddress = insuredAddress, victimAddressDetail = insuredAddressDetail
// - 피해자 정보가 있는 경우: victimAddress = insuredAddress, victimAddressDetail = 사용자 입력값 유지
function setVictimAddressForRecoveryCase(caseData: any): void {
  const hasVictimInfo = !!(
    caseData.victimName ||
    caseData.victimContact ||
    caseData.victimAddressDetail
  );

  if (!hasVictimInfo) {
    // 피해자 정보 없음: 피보험자 주소 전체 복사
    caseData.victimAddress = caseData.insuredAddress || "";
    caseData.victimAddressDetail = caseData.insuredAddressDetail || "";
  } else {
    // 피해자 정보 있음: 기본주소는 피보험자 것 사용, 상세주소는 사용자 입력값 유지
    caseData.victimAddress = caseData.insuredAddress || "";
    // victimAddressDetail은 그대로 유지 (사용자 입력값)
  }
}

// Solapi HMAC-SHA256 인증 헤더 생성
function createSolapiAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

// Solapi HTTPS 요청 함수
function solapiHttpsRequest({
  method,
  path,
  headers,
  body,
}: {
  method: string;
  path: string;
  headers: Record<string, string | number>;
  body?: string;
}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.solapi.com",
        port: 443,
        method,
        path,
        headers,
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = data ? JSON.parse(data) : {};
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              return resolve(json);
            }
            reject({ statusCode: res.statusCode, body: json });
          } catch {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              return resolve({ raw: data });
            }
            reject({ statusCode: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("REQUEST_TIMEOUT")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Register Object Storage routes
  registerObjectStorageRoutes(app);

  // Login endpoint
  app.post("/api/login", async (req, res) => {
    try {
      const validatedData = loginSchema.parse(req.body);

      console.log("[LOGIN ATTEMPT]", {
        username: validatedData.username,
        isProduction: process.env.REPLIT_DEPLOYMENT === "1",
        nodeEnv: process.env.NODE_ENV,
        dbUrl:
          process.env.REPLIT_DEPLOYMENT === "1"
            ? "PROD_DATABASE"
            : "DEV_DATABASE",
      });

      const user = await storage.verifyPassword(
        validatedData.username,
        validatedData.password,
      );

      if (!user) {
        console.log(
          "[LOGIN FAILED] User not found or password mismatch:",
          validatedData.username,
        );
        return res.status(401).json({
          error: "아이디 또는 비밀번호가 올바르지 않습니다",
        });
      }

      if (req.session) {
        // 중복 로그인 방지: 기존 세션이 있으면 파괴
        const existingSessionId = activeUserSessions.get(user.id);
        if (existingSessionId && existingSessionId !== req.sessionID) {
          // activeUserSessions에서 먼저 제거
          activeUserSessions.delete(user.id);
          sessionStore.destroy(existingSessionId, (err) => {
            if (err) {
              console.error("[LOGIN] Failed to destroy existing session:", err);
            } else {
              console.log("[LOGIN] Destroyed existing session for userId:", user.id, "sessionId:", existingSessionId);
            }
          });
        }

        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.isSuperAdmin = user.isSuperAdmin || false;
        req.session.rememberMe = validatedData.rememberMe;

        console.log("[LOGIN SUCCESS]", {
          userId: user.id,
          userRole: user.role,
          username: user.username,
          sessionId: req.sessionID,
          cookieSecure: req.session.cookie.secure,
          cookieSameSite: req.session.cookie.sameSite,
        });

        if (validatedData.rememberMe) {
          req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30일
        } else {
          req.session.cookie.maxAge = 30 * 60 * 1000; // 30분
        }

        // Force session save and then respond
        req.session.save((err) => {
          if (err) {
            console.error("[LOGIN] Session save error:", err);
            return res
              .status(500)
              .json({ error: "세션 저장 중 오류가 발생했습니다" });
          }
          // 새 세션ID 등록
          activeUserSessions.set(user.id, req.sessionID);
          console.log(
            "[LOGIN] Session saved successfully, sessionId:",
            req.sessionID,
          );
          const { password, ...userWithoutPassword } = user;
          console.log("[LOGIN] Response data:", {
            userId: userWithoutPassword.id,
            mustChangePassword: userWithoutPassword.mustChangePassword,
          });
          res.json(userWithoutPassword);
        });
        return;
      }

      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Login error:", error);
      res.status(500).json({ error: "로그인 중 오류가 발생했습니다" });
    }
  });

  // Logout endpoint
  app.post("/api/logout", async (req, res) => {
    if (req.session) {
      const userId = req.session.userId;
      req.session.destroy((err) => {
        if (err) {
          console.error("Logout error:", err);
          return res
            .status(500)
            .json({ error: "로그아웃 중 오류가 발생했습니다" });
        }
        if (userId) activeUserSessions.delete(userId);
        res.clearCookie("connect.sid");
        res.json({ success: true });
      });
    } else {
      res.json({ success: true });
    }
  });

  // Force change password endpoint (최초 로그인 시 임시 비밀번호 변경)
  app.post("/api/force-change-password", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const validatedData = forceChangePasswordSchema.parse(req.body);
      const user = await storage.getUser(req.session.userId);

      if (!user) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      // 비밀번호 업데이트
      const updatedUser = await storage.updatePassword(
        user.username,
        validatedData.newPassword,
      );

      if (!updatedUser) {
        return res.status(500).json({ error: "비밀번호 변경에 실패했습니다" });
      }

      // mustChangePassword를 false로 업데이트
      await storage.updateUserMustChangePassword(user.id, false);

      console.log(
        `[FORCE CHANGE PASSWORD] User ${user.username} changed password successfully`,
      );

      res.json({
        success: true,
        message: "비밀번호가 성공적으로 변경되었습니다",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Force change password error:", error);
      res.status(500).json({ error: "비밀번호 변경 중 오류가 발생했습니다" });
    }
  });

  // Get current user endpoint
  app.get("/api/user", async (req, res) => {
    console.log("[API/USER] Request received", {
      sessionId: req.sessionID,
      hasSession: !!req.session,
      userId: req.session?.userId,
      userRole: req.session?.userRole,
      cookieHeader: req.headers.cookie ? "present" : "missing",
      nodeEnv: process.env.NODE_ENV,
      isProduction: process.env.REPLIT_DEPLOYMENT === "1",
    });

    if (!req.session?.userId) {
      console.log("[API/USER] Auth failed - no userId in session", {
        sessionExists: !!req.session,
        sessionKeys: req.session ? Object.keys(req.session) : [],
      });
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      console.log("[API/USER] User not found in DB", {
        userId: req.session.userId,
      });
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    }

    // console.log("[API/USER] Success", {
    //   username: user.username,
    //   role: user.role,
    //   isActive: user.isActive,
    //   deletedAt: user.deletedAt,
    // });

    // Sync session with latest DB values
    req.session.userRole = user.role;
    req.session.isSuperAdmin = user.isSuperAdmin || false;

    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  });

  // Check session endpoint
  app.get("/api/check-session", async (req, res) => {
    if (req.session?.userId) {
      // 중복 로그인 방지: activeUserSessions에서 현재 세션이 활성화된 세션인지 확인
      const activeSessionId = activeUserSessions.get(req.session.userId);
      if (activeSessionId && activeSessionId !== req.sessionID) {
        // 다른 세션이 활성화되어 있으면 현재 세션 무효화
        console.log("[CHECK-SESSION] Session invalidated - another session is active", {
          userId: req.session.userId,
          currentSessionId: req.sessionID,
          activeSessionId: activeSessionId,
        });
        req.session.destroy(() => {});
        return res.json({ authenticated: false });
      }
      
      const user = await storage.getUser(req.session.userId);
      if (user) {
        const { password, ...userWithoutPassword } = user;
        return res.json({ authenticated: true, user: userWithoutPassword });
      }
    }
    res.json({ authenticated: false });
  });

  // Force reset admin passwords and reactivate accounts endpoint (temporary fix for production)
  app.post("/api/reset-admin-passwords", async (req, res) => {
    try {
      const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
      const dbUrl = isProduction
        ? process.env.PROD_DATABASE_URL
        : process.env.DEV_DATABASE_URL;
      const dbHost = dbUrl ? dbUrl.match(/@([^/]+)\//)?.[1] : "unknown";

      console.log("[RESET ADMIN] Starting password reset and reactivation", {
        isProduction,
        dbHost,
      });

      const adminUsernames = [
        "admin01",
        "admin02",
        "admin03",
        "admin04",
        "admin05",
      ];
      const results = [];

      for (const username of adminUsernames) {
        try {
          // First reactivate the account (set status to active)
          const reactivated = await storage.reactivateAccount(username);
          console.log(
            `[RESET ADMIN] ${username} reactivation: ${reactivated ? "SUCCESS" : "USER NOT FOUND"}`,
          );

          // Then reset password
          const updated = await storage.updatePassword(username, "1234");
          results.push({
            username,
            success: !!updated,
            reactivated: !!reactivated,
            error: null,
          });
          console.log(
            `[RESET ADMIN] ${username} password: ${updated ? "SUCCESS" : "USER NOT FOUND"}`,
          );
        } catch (err: any) {
          results.push({
            username,
            success: false,
            reactivated: false,
            error: err.message,
          });
          console.error(`[RESET ADMIN] ${username} ERROR:`, err.message);
        }
      }

      res.json({
        message: "Admin passwords reset and accounts reactivated",
        isProduction,
        dbHost,
        results,
      });
    } catch (error: any) {
      console.error("[RESET ADMIN] Error:", error);
      res
        .status(500)
        .json({ error: "Failed to reset passwords", details: error.message });
    }
  });

  // Debug endpoint to check database connection
  app.get("/api/debug/db-check", async (req, res) => {
    try {
      const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
      const dbUrl = isProduction
        ? process.env.PROD_DATABASE_URL
        : process.env.DEV_DATABASE_URL;
      const dbHost = dbUrl ? dbUrl.match(/@([^/]+)\//)?.[1] : "unknown";

      // Try to get user count
      const users = await storage.getAllUsers();
      const adminUsers = users.filter((u) => u.role === "관리자");

      res.json({
        isProduction,
        dbHost,
        totalUsers: users.length,
        adminUsers: adminUsers.map((u) => ({
          username: u.username,
          status: u.status,
        })),
      });
    } catch (error: any) {
      res.status(500).json({
        error: "Database check failed",
        details: error.message,
        isProduction: process.env.REPLIT_DEPLOYMENT === "1",
      });
    }
  });

  // BUILD VERSION - Always accessible to verify deployment
  const BUILD_TIME = new Date().toISOString();
  const BUILD_ID = `build-${Date.now()}`;

  app.get("/api/debug/version", async (req, res) => {
    res.json({
      buildId: BUILD_ID,
      buildTime: BUILD_TIME,
      appVersion: "1.0.0-debug",
      nodeEnv: process.env.NODE_ENV,
      replitDeployment: process.env.REPLIT_DEPLOYMENT,
      isProduction: process.env.REPLIT_DEPLOYMENT === "1",
      hasDbStatusRoute: true,
      registeredDebugRoutes: ["/api/debug/version", "/api/debug/db-status"],
      serverStartTime: new Date().toISOString(),
    });
  });

  // DEBUG ENDPOINT - Production DB diagnostics (admin only)
  app.get("/api/debug/db-status", async (req, res) => {
    try {
      // Check if user is admin
      if (!req.session?.userId) {
        return res.status(401).json({ error: "인증 필요" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "관리자") {
        return res.status(403).json({ error: "관리자 권한 필요" });
      }

      // Get environment info
      const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
      const dbUrl = isProduction
        ? process.env.PROD_DATABASE_URL
        : process.env.DEV_DATABASE_URL;

      // Mask the DB URL for security (only show host)
      const maskedDbUrl = dbUrl
        ? dbUrl.replace(/\/\/[^@]+@/, "//***:***@").split("?")[0]
        : "NOT SET";

      // Get total cases count directly from DB
      const casesResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(cases);
      const totalCases = casesResult[0]?.count || 0;

      // Get cases through storage (with user filter applied)
      const filteredCases = await storage.getAllCases(user);

      // Get all users count
      const allUsers = await storage.getAllUsers();

      // Get cases by status breakdown
      const allCasesRaw = await db.select().from(cases);
      const statusBreakdown: Record<string, number> = {};
      allCasesRaw.forEach((c) => {
        const status = c.status || "null";
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
      });

      res.json({
        timestamp: new Date().toISOString(),
        environment: {
          isProduction,
          NODE_ENV: process.env.NODE_ENV,
          REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT,
        },
        database: {
          maskedUrl: maskedDbUrl,
          connectionTest: "OK",
        },
        counts: {
          totalCasesInDb: totalCases,
          casesReturnedByApi: filteredCases.length,
          totalUsers: allUsers.length,
        },
        statusBreakdown,
        currentUser: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
        sampleCaseIds: allCasesRaw.slice(0, 3).map((c) => ({
          id: c.id,
          caseNumber: c.caseNumber,
          status: c.status,
        })),
      });
    } catch (error) {
      console.error("[DEBUG] Error:", error);
      res.status(500).json({
        error: "Debug endpoint error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get basic user info (all authenticated users - for displaying names/contacts)
  app.get("/api/users/basic", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const users = await storage.getAllUsers();
      // Return only basic info: id, name, username, phone, role, bankName, accountNumber, company
      const basicUsers = users.map(
        ({ id, name, username, phone, role, bankName, accountNumber, company }) => ({
          id,
          name,
          username,
          contact: phone,
          role,
          bankName,
          accountNumber,
          company,
        }),
      );
      res.json(basicUsers);
    } catch (error) {
      console.error("Get basic users error:", error);
      res
        .status(500)
        .json({ error: "사용자 목록을 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get all insurance companies (unique company names from users with role '보험사')
  app.get("/api/insurance-companies", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const users = await storage.getAllUsers();
      // Get unique company names from users with role '보험사'
      const companySet = new Set<string>();
      users
        .filter((u) => u.role === "보험사" && u.company)
        .forEach((u) => companySet.add(u.company!));
      const insuranceCompanies = Array.from(companySet).sort();
      res.json(insuranceCompanies);
    } catch (error) {
      console.error("Get insurance companies error:", error);
      res
        .status(500)
        .json({ error: "보험사 목록을 불러오는 중 오류가 발p��했습니다" });
    }
  });

  // Get all client companies (unique company names from users with role '보험사', '심사사', '조사사')
  app.get("/api/client-companies", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const users = await storage.getAllUsers();
      const allowedRoles = ["보험사", "심사사", "조사사"];
      const companySet = new Set<string>();
      users
        .filter((u) => u.role && allowedRoles.includes(u.role) && u.company)
        .forEach((u) => companySet.add(u.company!));
      const clientCompanies = Array.from(companySet).sort();
      res.json(clientCompanies);
    } catch (error) {
      console.error("Get client companies error:", error);
      res
        .status(500)
        .json({ error: "의뢰사 목록을 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get all users endpoint (all authenticated users - limited info for non-admins)
  app.get("/api/users", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const users = await storage.getAllUsers();

      // 관리자: 전체 정보 (비밀번호, attachments 제외 - attachments에 Base64 파일이 저장되어 응답이 수십MB가 됨)
      if (req.session.userRole === "관리자") {
        const usersWithoutHeavyFields = users.map(
          ({ password, attachments, ...user }) => user,
        );
        return res.json(usersWithoutHeavyFields);
      }

      // 협력사/기타: 기본 정보만 제공 (담당자 조회용)
      const basicUsers = users.map(
        ({
          id,
          name,
          username,
          phone,
          role,
          company,
          department,
          position,
        }) => ({
          id,
          name,
          username,
          phone,
          role,
          company,
          department,
          position,
        }),
      );
      res.json(basicUsers);
    } catch (error) {
      console.error("Get users error:", error);
      res
        .status(500)
        .json({ error: "사용자 목록을 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get user attachments (admin only)
  app.get("/api/users/:userId/attachments", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자만 접근 가능합니다" });
    }
    try {
      const user = await storage.getUser(req.params.userId);
      if (!user) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }
      res.json({ attachments: user.attachments || [] });
    } catch (error) {
      console.error("Get user attachments error:", error);
      res.status(500).json({ error: "첨부파일을 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Update password endpoint (admin only)
  app.post("/api/update-password", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check admin authorization
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      // Validate request body with Zod
      const validatedData = updatePasswordSchema.parse(req.body);

      const updatedUser = await storage.updatePassword(
        validatedData.username,
        validatedData.newPassword,
      );

      if (!updatedUser) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      const { password, ...userWithoutPassword } = updatedUser;
      res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Password update error:", error);
      res.status(500).json({ error: "비밀번호 변경 중 오류가 발생했습니다" });
    }
  });

  // Change my password endpoint (for logged-in user to change their own password)
  app.patch("/api/me/password", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Validate request body with Zod
      const validatedData = changeMyPasswordSchema.parse(req.body);

      // Get current user
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      // Verify current password
      const isPasswordValid = await storage.verifyPassword(
        user.username,
        validatedData.currentPassword,
      );
      if (!isPasswordValid) {
        return res
          .status(400)
          .json({ error: "현재 비밀번호가 올바르지 않습니다" });
      }

      // Update password
      const updatedUser = await storage.updatePassword(
        user.username,
        validatedData.newPassword,
      );
      if (!updatedUser) {
        return res
          .status(500)
          .json({ error: "비밀번호 변경 중 오류가 발생했습니다" });
      }

      const { password, ...userWithoutPassword } = updatedUser;
      res.json({
        success: true,
        message: "비밀번호가 성공적으로 변경되었습니다",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: error.errors[0]?.message || "입력 값이 올바르지 않습니다",
        });
      }
      console.error("Change my password error:", error);
      res.status(500).json({ error: "비밀번호 변경 중 오류가 발생했습니다" });
    }
  });

  // Delete account endpoint (admin only - soft delete)
  app.post("/api/delete-account", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check admin authorization
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      // Validate request body with Zod
      const validatedData = deleteAccountSchema.parse(req.body);

      const deletedUser = await storage.deleteAccount(validatedData.username);

      if (!deletedUser) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      const { password, ...userWithoutPassword } = deletedUser;
      res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Delete account error:", error);
      res.status(500).json({ error: "계정 삭제 중 오류가 발생했습니다" });
    }
  });

  // Update user account endpoint (admin only)
  app.patch("/api/users/:id", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check admin authorization
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const userId = req.params.id;

      // Validate request body with Zod
      const validatedData = updateUserSchema.parse(req.body);

      // Security: Only super admin can change isSuperAdmin field
      if (
        validatedData.isSuperAdmin !== undefined &&
        validatedData.isSuperAdmin !== null
      ) {
        const requester = await storage.getUser(req.session.userId);
        if (!requester?.isSuperAdmin) {
          delete (validatedData as any).isSuperAdmin;
        }
      }

      // Security: Force isSuperAdmin=false when role is not 관리자
      if (validatedData.role && validatedData.role !== "관리자") {
        (validatedData as any).isSuperAdmin = false;
      }

      const oldUser = await storage.getUser(userId);
      if (!oldUser) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      const updatedUser = await storage.updateUser(userId, validatedData);

      if (!updatedUser) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      try {
        const role = updatedUser.role;
        if (role === "심사사") {
          const result = await db
            .update(cases)
            .set({
              assessorId: updatedUser.company,
              assessorTeam: updatedUser.name,
              assessorContact: updatedUser.phone || "",
              assessorEmail: updatedUser.email || "",
              assessorDepartment: updatedUser.department || "",
            })
            .where(
              and(
                eq(cases.assessorId, oldUser.company),
                eq(cases.assessorTeam, oldUser.name),
              ),
            );
          console.log(`[UserUpdate] Synced cases for assessor: ${oldUser.name} → ${updatedUser.name} (${updatedUser.company}), rows: ${(result as any).rowCount ?? 'unknown'}`);
        } else if (role === "조사사") {
          const result = await db
            .update(cases)
            .set({
              investigatorTeam: updatedUser.company,
              investigatorTeamName: updatedUser.name,
              investigatorContact: updatedUser.phone || "",
              investigatorEmail: updatedUser.email || "",
              investigatorDepartment: updatedUser.department || "",
            })
            .where(
              and(
                eq(cases.investigatorTeam, oldUser.company),
                eq(cases.investigatorTeamName, oldUser.name),
              ),
            );
          console.log(`[UserUpdate] Synced cases for investigator: ${oldUser.name} → ${updatedUser.name} (${updatedUser.company}), rows: ${(result as any).rowCount ?? 'unknown'}`);
        } else if (role === "협력사") {
          const result = await db
            .update(cases)
            .set({
              assignedPartner: updatedUser.company,
              assignedPartnerManager: updatedUser.name,
              assignedPartnerContact: updatedUser.phone || "",
            })
            .where(
              and(
                eq(cases.assignedPartner, oldUser.company),
                eq(cases.assignedPartnerManager, oldUser.name),
              ),
            );
          console.log(`[UserUpdate] Synced cases for partner: ${oldUser.name} → ${updatedUser.name} (${updatedUser.company}), rows: ${(result as any).rowCount ?? 'unknown'}`);
        } else if (role === "의뢰사") {
          const result = await db
            .update(cases)
            .set({
              clientResidence: updatedUser.company,
              clientName: updatedUser.name,
              clientContact: updatedUser.phone || "",
              clientDepartment: updatedUser.department || "",
            })
            .where(
              and(
                eq(cases.clientResidence, oldUser.company),
                eq(cases.clientName, oldUser.name),
              ),
            );
          console.log(`[UserUpdate] Synced cases for client: ${oldUser.name} → ${updatedUser.name} (${updatedUser.company}), rows: ${(result as any).rowCount ?? 'unknown'}`);
        }
      } catch (syncError) {
        console.error("[UserUpdate] Failed to sync cases:", syncError);
      }

      const { password, ...userWithoutPassword } = updatedUser;
      res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Update user error:", error);
      res.status(500).json({ error: "계정 정보 수정 중 오류가 발생했습니다" });
    }
  });

  // Delegate super admin (transfer super admin to another user)
  app.post("/api/delegate-super-admin", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const requester = await storage.getUser(req.session.userId);
    if (!requester?.isSuperAdmin) {
      return res.status(403).json({ error: "최고관리자 권한이 필요합니다" });
    }

    const { targetUserId } = req.body;
    if (!targetUserId) {
      return res
        .status(400)
        .json({ error: "위임 대상 사용자 ID가 필요합니다" });
    }

    const targetUser = await storage.getUser(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: "대상 사용자를 찾을 수 없습니다" });
    }
    if (targetUser.role !== "관리자") {
      return res
        .status(400)
        .json({ error: "관리자 역할의 사용자에게만 위임할 수 있습니다" });
    }

    try {
      // Remove super admin from current user
      await storage.updateUser(requester.id, { isSuperAdmin: false });
      // Grant super admin to target user
      await storage.updateUser(targetUserId, { isSuperAdmin: true });

      // Update session
      req.session.isSuperAdmin = false;

      res.json({ success: true });
    } catch (error) {
      console.error("Delegate super admin error:", error);
      res.status(500).json({ error: "최고관리자 위임 중 오류가 발생했습니다" });
    }
  });

  // Create account endpoint (admin only)
  app.post("/api/create-account", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check admin authorization
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      console.log(
        "Create account request body:",
        JSON.stringify(req.body, null, 2),
      );

      // Validate request body with Zod
      const validatedData = createAccountSchema.parse(req.body);

      console.log("Validated data:", JSON.stringify(validatedData, null, 2));

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(
        validatedData.username,
      );
      if (existingUser) {
        return res.status(409).json({ error: "이미 사용 중인 아이디입니다" });
      }

      // Create new user
      const newUser = await storage.createUser({
        username: validatedData.username,
        password: validatedData.password,
        role: validatedData.role,
        name: validatedData.name,
        company: validatedData.company,
        department: validatedData.department,
        position: validatedData.position,
        email: validatedData.email || undefined,
        phone: validatedData.phone,
        office: validatedData.office,
        address: validatedData.address,
        addressDetail: validatedData.addressDetail, // 상세주소
        // 협력사 전용 필드 - 반드시 포함
        businessRegistrationNumber: validatedData.businessRegistrationNumber,
        representativeName: validatedData.representativeName,
        bankName: validatedData.bankName,
        accountNumber: validatedData.accountNumber,
        accountHolder: validatedData.accountHolder,
        serviceRegions: validatedData.serviceRegions,
        attachments: validatedData.attachments,
        accountType: validatedData.accountType || "개인",
        isSuperAdmin:
          validatedData.role === "관리자" && req.session.isSuperAdmin
            ? validatedData.isSuperAdmin || false
            : false,
        status: "active",
      });

      console.log("Created user:", JSON.stringify(newUser, null, 2));

      const { password, ...userWithoutPassword } = newUser;
      res.status(201).json({ success: true, user: userWithoutPassword });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create account error:", error);
      res.status(500).json({ error: "계정 생성 중 오류가 발생했습니다" });
    }
  });

  // Get next case sequence number for a specific date
  app.get("/api/cases/next-sequence", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const date = req.query.date as string;

      if (!date) {
        return res.status(400).json({ error: "날짜가 필요합니다" });
      }

      // Get next sequence info for the given date
      const insuranceAccidentNo = req.query.insuranceAccidentNo as
        | string
        | undefined;
      const result = await storage.getNextCaseSequence(
        date,
        insuranceAccidentNo,
      );

      res.json(result);
    } catch (error) {
      console.error("Get next sequence error:", error);
      res.status(500).json({ error: "순번 조회 중 오류가 발생했습니다" });
    }
  });

  // Create case endpoint (supports multi-case creation)
  app.post("/api/cases", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Debug: log incoming sameAsPolicyHolder with type
      console.log(
        "📥 Incoming sameAsPolicyHolder:",
        req.body.sameAsPolicyHolder,
        "type:",
        typeof req.body.sameAsPolicyHolder,
      );
      console.log("📥 Incoming managerId:", req.body.managerId);
      console.log(
        "📥 Incoming assignedPartnerManager:",
        req.body.assignedPartnerManager,
      );

      // Validate request body with Zod
      const validatedData = insertCaseRequestSchema.parse(req.body);

      // Debug: log validated sameAsPolicyHolder with type
      console.log(
        "✅ Validated sameAsPolicyHolder:",
        validatedData.sameAsPolicyHolder,
        "type:",
        typeof validatedData.sameAsPolicyHolder,
      );
      console.log("✅ Validated managerId:", validatedData.managerId);
      console.log(
        "✅ Validated assignedPartnerManager:",
        validatedData.assignedPartnerManager,
      );
      console.log(
        "✅ Validated assignedPartnerContact:",
        validatedData.assignedPartnerContact,
      );
      console.log(
        "✅ Validated assignedPartner:",
        validatedData.assignedPartner,
      );

      // Debug: log assessor/investigator info for troubleshooting
      console.log("🔍 Assessor/Investigator Debug:");
      console.log("  - assessorId:", validatedData.assessorId);
      console.log("  - assessorDepartment:", validatedData.assessorDepartment);
      console.log("  - assessorTeam:", validatedData.assessorTeam);
      console.log("  - assessorContact:", validatedData.assessorContact);
      console.log("  - investigatorTeam:", validatedData.investigatorTeam);
      console.log(
        "  - investigatorDepartment:",
        validatedData.investigatorDepartment,
      );
      console.log(
        "  - investigatorTeamName:",
        validatedData.investigatorTeamName,
      );
      console.log(
        "  - investigatorContact:",
        validatedData.investigatorContact,
      );

      // Debug: log victim address info for troubleshooting
      console.log("🏠 Victim Address Debug:");
      console.log("  - victimName:", validatedData.victimName);
      console.log("  - victimAddress:", validatedData.victimAddress);
      console.log(
        "  - victimAddressDetail:",
        validatedData.victimAddressDetail,
      );
      console.log("  - insuredAddress:", validatedData.insuredAddress);
      console.log(
        "  - insuredAddressDetail:",
        validatedData.insuredAddressDetail,
      );
      console.log("  - parentCasePrefix:", (req.body as any).parentCasePrefix);

      // 사용자 정보 가져오기 (자동 채우기용)
      const allUsersForAutoPopulate = await storage.getAllUsers();

      // 기존 케이스의 협력업체 정보 확인 (수정 시 변경 여부 판단용)
      let existingPartner: string | null = null;
      if (validatedData.id) {
        const existingCaseForPartner = await storage.getCaseById(
          validatedData.id,
        );
        if (existingCaseForPartner) {
          existingPartner = existingCaseForPartner.assignedPartner;
        }
      }

      // 협력사 배정 시 담당자 정보 자동 채우기
      // 협력업체가 변경된 경우 또는 새로 설정된 경우 연락처 자동 업데이트
      const isPartnerChangedInPost =
        validatedData.assignedPartner &&
        validatedData.assignedPartner !== existingPartner;

      if (
        validatedData.assignedPartner &&
        (!validatedData.assignedPartnerManager || isPartnerChangedInPost)
      ) {
        const partnerCompanyName = validatedData.assignedPartner;
        // 해당 회사명을 가진 협력사 사용자 찾기
        const partnerUser = allUsersForAutoPopulate.find(
          (u) => u.company === partnerCompanyName && u.role === "협력사",
        );
        if (partnerUser) {
          // 담당자명과 연락처 자동 채우기
          if (partnerUser.name) {
            (validatedData as any).assignedPartnerManager = partnerUser.name;
            console.log(
              `[Auto-populate] Partner manager set to: ${partnerUser.name} for company: ${partnerCompanyName}`,
            );
          }
          if (
            partnerUser.phone &&
            (!validatedData.assignedPartnerContact || isPartnerChangedInPost)
          ) {
            (validatedData as any).assignedPartnerContact = partnerUser.phone;
            console.log(
              `[Auto-populate] Partner contact set to: ${partnerUser.phone} for company: ${partnerCompanyName}`,
            );
          }
        } else if (isPartnerChangedInPost) {
          // 협력업체가 변경되었지만 해당 협력사 사용자가 없는 경우 연락처 초기화
          console.log(
            `[Auto-populate] Partner changed to ${partnerCompanyName}, but no user found - clearing contact`,
          );
          (validatedData as any).assignedPartnerManager = "";
          (validatedData as any).assignedPartnerContact = "";
        }
      }

      // 심사사 이메일 자동 채우기
      // assessorTeam(심사자 이름)이 설정되면 해당 사용자의 이메일을 자동으로 채움
      if (validatedData.assessorTeam) {
        const assessorUser = allUsersForAutoPopulate.find(
          (u) => u.role === "심사사" && u.name === validatedData.assessorTeam,
        );
        if (assessorUser?.email) {
          (validatedData as any).assessorEmail = assessorUser.email;
          console.log(
            `[Auto-populate] Assessor email set to: ${assessorUser.email} for assessor: ${validatedData.assessorTeam}`,
          );
        }
      }

      // 조사사 이메일 자동 채우기
      // investigatorTeamName(조사자 이름)이 설정되면 해당 사용자의 이메일을 자동으로 채움
      if (validatedData.investigatorTeamName) {
        const investigatorUser = allUsersForAutoPopulate.find(
          (u) =>
            u.role === "조사사" &&
            u.name === validatedData.investigatorTeamName,
        );
        if (investigatorUser?.email) {
          (validatedData as any).investigatorEmail = investigatorUser.email;
          console.log(
            `[Auto-populate] Investigator email set to: ${investigatorUser.email} for investigator: ${validatedData.investigatorTeamName}`,
          );
        }
      }

      // Determine case types based on damagePreventionCost and victimIncidentAssistance fields
      // 프론트엔드에서 boolean 또는 "true"/"false" 문자열로 전송될 수 있음
      const hasDamagePrevention =
        validatedData.damagePreventionCost === "true" ||
        (validatedData.damagePreventionCost as unknown) === true;
      const hasVictimRecovery =
        validatedData.victimIncidentAssistance === "true" ||
        (validatedData.victimIncidentAssistance as unknown) === true;

      console.log("🔍 Processing types:", {
        hasDamagePrevention,
        hasVictimRecovery,
        damagePreventionCost: validatedData.damagePreventionCost,
        victimIncidentAssistance: validatedData.victimIncidentAssistance,
      });

      // Generate caseGroupId (use insuranceAccidentNo or generate unique ID)
      const caseGroupId =
        validatedData.insuranceAccidentNo || `GROUP-${Date.now()}`;

      // Handle draft cases (배당대기 status)
      if (validatedData.status === "배당대기") {
        // 기존 임시저장 건이 있으면 업데이트
        if (validatedData.id) {
          const existingCase = await storage.getCaseById(validatedData.id);
          if (existingCase && existingCase.status === "배당대기") {
            // 기존 케이스 업데이트 (접수번호 prefix 유지, suffix는 처리구분에 따라 변경)
            const existingCaseNumber = existingCase.caseNumber || "";

            // "-"이거나 "DRAFT-"로 시작하거나 빈 값이면 새 prefix 생성 필요
            const needsNewPrefix =
              !existingCaseNumber ||
              existingCaseNumber === "-" ||
              existingCaseNumber.startsWith("DRAFT-");

            let existingPrefix = "";
            let existingSuffix: string | null = null;

            if (
              !needsNewPrefix &&
              existingCaseNumber.includes("-") &&
              existingCaseNumber !== "-" &&
              !existingCaseNumber.startsWith("DRAFT-")
            ) {
              existingPrefix = existingCaseNumber.split("-")[0];
              existingSuffix = existingCaseNumber.split("-")[1];
            } else if (!needsNewPrefix) {
              existingPrefix = existingCaseNumber;
            }

            // 접수번호 prefix가 없으면 새로 생성 (접수일자 = 오늘 날짜 기준)
            if (needsNewPrefix || !existingPrefix) {
              const receptionDate =
                new Date().toISOString().split("T")[0];
              const { prefix } = await storage.getNextCaseSequence(
                receptionDate,
                validatedData.insuranceAccidentNo || undefined,
              );
              existingPrefix = prefix;
            }

            // 처리구분에 따라 접수번호 suffix 결정
            let newCaseNumber: string;
            const createdCases: any[] = [];

            if (!hasDamagePrevention && !hasVictimRecovery) {
              // 아무것도 선택 안함 → 고유한 임시 접수번호 생성
              newCaseNumber = `DRAFT-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            } else if (hasDamagePrevention && !hasVictimRecovery) {
              // 손해방지만 선택 → -0 suffix
              // 먼저 -0 케이스가 이미 존재하는지 확인
              const existingPreventionCase =
                await storage.getPreventionCaseByPrefix(existingPrefix);

              if (
                existingPreventionCase &&
                existingPreventionCase.id !== validatedData.id
              ) {
                // -0 케이스가 이미 존재함 (현재 케이스와 다른 케이스)
                // 기존 -0 케이스가 배당대기(임시저장) 상태이면 삭제 후 현재 케이스를 -0으로 변경
                if (existingPreventionCase.status === "배당대기") {
                  await storage.deleteCase(existingPreventionCase.id);
                  console.log(
                    `[Case Draft] Deleted existing draft prevention case ${existingPreventionCase.caseNumber} to replace with current case`,
                  );
                  newCaseNumber = `${existingPrefix}-0`;
                } else {
                  // -0 케이스가 이미 접수완료 상태이면 현재 케이스 번호 유지
                  console.log(
                    `[Case Draft] Prevention case ${existingPreventionCase.caseNumber} already exists and completed, keeping current case number`,
                  );
                  newCaseNumber = existingCaseNumber; // 기존 번호 유지
                }
              } else {
                // -0 케이스가 없거나 현재 케이스가 -0인 경우
                newCaseNumber = `${existingPrefix}-0`;
              }
            } else if (!hasDamagePrevention && hasVictimRecovery) {
              // 피해세대만 선택 → -1 이상 suffix
              // 기존이 피해세대 suffix (-1 이상)이면 유지, 아니면 새로 할당
              if (
                existingSuffix &&
                existingSuffix !== "0" &&
                parseInt(existingSuffix) >= 1
              ) {
                newCaseNumber = existingCaseNumber; // 기존 피해세대 번호 유지
              } else {
                const nextSuffix =
                  await storage.getNextVictimSuffix(existingPrefix);
                newCaseNumber = `${existingPrefix}-${nextSuffix}`;
              }
            } else {
              // 둘 다 선택 → 기존 케이스는 -0, 새 피해세대 케이스 추가 생성
              // 먼저 -0 케이스가 이미 존재하는지 확인
              const existingPreventionCase =
                await storage.getPreventionCaseByPrefix(existingPrefix);

              if (
                existingPreventionCase &&
                existingPreventionCase.id !== validatedData.id
              ) {
                // -0 케이스가 이미 존재함 → 현재 케이스는 피해세대 번호 유지하고 업데이트
                if (
                  existingSuffix &&
                  existingSuffix !== "0" &&
                  parseInt(existingSuffix) >= 1
                ) {
                  newCaseNumber = existingCaseNumber; // 기존 피해세대 번호 유지
                } else {
                  const nextSuffix =
                    await storage.getNextVictimSuffix(existingPrefix);
                  newCaseNumber = `${existingPrefix}-${nextSuffix}`;
                }

                // 현재 케이스 업데이트 (피해세대 케이스로)
                const updatedCase = await storage.updateCase(validatedData.id, {
                  ...validatedData,
                  caseNumber: newCaseNumber,
                  caseGroupId,
                });
                createdCases.push(updatedCase);

                // 기존 -0 케이스도 동기화 (정보 업데이트)
                await storage.updateCase(existingPreventionCase.id, {
                  ...validatedData,
                  caseNumber: existingPreventionCase.caseNumber || undefined,
                  caseGroupId,
                });

                console.log(
                  `[Case Draft] Updated existing prevention case ${existingPreventionCase.caseNumber} and victim case ${newCaseNumber}`,
                );
              } else {
                // -0 케이스가 없거나 현재 케이스가 -0 → 기존 케이스를 -0으로 유지/업데이트
                newCaseNumber = `${existingPrefix}-0`;

                // 기존 케이스를 손해방지 케이스로 업데이트
                const updatedCase = await storage.updateCase(validatedData.id, {
                  ...validatedData,
                  caseNumber: newCaseNumber,
                  caseGroupId,
                });
                createdCases.push(updatedCase);

                // 피해세대 케이스가 이미 존재하는지 확인
                const existingVictimCases = await storage.getCasesByPrefix(
                  existingPrefix,
                  validatedData.id,
                );
                const hasExistingVictimCase = existingVictimCases.some(
                  (c) =>
                    c.caseNumber &&
                    c.caseNumber !== newCaseNumber &&
                    !c.caseNumber.endsWith("-0"),
                );

                if (!hasExistingVictimCase) {
                  // 피해세대 케이스가 없으면 새로 생성
                  const nextSuffix =
                    await storage.getNextVictimSuffix(existingPrefix);
                  const recoveryData = JSON.parse(
                    JSON.stringify(validatedData),
                  );
                  setVictimAddressForRecoveryCase(recoveryData);
                  const recoveryCase = await storage.createCase({
                    ...recoveryData,
                    caseNumber: `${existingPrefix}-${nextSuffix}`,
                    caseGroupId,
                    status: "배당대기",
                    createdBy: req.session.userId,
                  });
                  createdCases.push(recoveryCase);
                } else {
                  console.log(
                    `[Case Draft] Victim case already exists for prefix ${existingPrefix}, skipping creation`,
                  );
                }
              }

              // 임시저장 시에도 관련 케이스에 동기화
              if (createdCases.length > 0) {
                try {
                  const syncCount = await storage.syncIntakeDataToRelatedCases(
                    createdCases[0].id,
                  );
                  if (syncCount > 0) {
                    console.log(
                      `[Case Draft] Auto-synced intake data to ${syncCount} related cases`,
                    );
                  }
                } catch (syncError) {
                  console.error("Failed to sync intake data:", syncError);
                }
              }
              return res
                .status(200)
                .json({ success: true, cases: createdCases });
            }

            const updatedCase = await storage.updateCase(validatedData.id, {
              ...validatedData,
              caseNumber: newCaseNumber,
              caseGroupId,
            });

            // 임시저장 시에도 관련 케이스에 동기화
            try {
              const syncCount = await storage.syncIntakeDataToRelatedCases(
                updatedCase!.id,
              );
              if (syncCount > 0) {
                console.log(
                  `[Case Draft] Auto-synced intake data to ${syncCount} related cases`,
                );
              }
            } catch (syncError) {
              console.error("Failed to sync intake data:", syncError);
            }

            return res
              .status(200)
              .json({ success: true, cases: [updatedCase] });
          }
        }

        // 새 임시저장 생성 (접수일자 = 오늘 날짜 기준)
        const receptionDate = new Date().toISOString().split("T")[0];
        const { prefix, suffix } = await storage.getNextCaseSequence(
          receptionDate,
          validatedData.insuranceAccidentNo || undefined,
        );

        // Create draft based on processing types
        const createdCases: any[] = [];

        if (hasDamagePrevention && !hasVictimRecovery) {
          // Only damage prevention: create single draft with -0 suffix
          const draftCase = await storage.createCase({
            ...validatedData,
            caseNumber: `${prefix}-0`,
            caseGroupId,
            createdBy: req.session.userId,
          });
          createdCases.push(draftCase);
        } else if (!hasDamagePrevention && hasVictimRecovery) {
          // Only victim recovery: create single draft with -N suffix
          const caseNumber = `${prefix}-${suffix === 0 ? 1 : suffix}`;
          const draftCase = await storage.createCase({
            ...validatedData,
            caseNumber,
            caseGroupId,
            createdBy: req.session.userId,
          });
          createdCases.push(draftCase);
        } else if (hasDamagePrevention && hasVictimRecovery) {
          // Both types selected
          // 1. Check if prevention case already exists for this prefix
          const existingPrevention =
            await storage.getPreventionCaseByPrefix(prefix);

          if (!existingPrevention) {
            // Create prevention case with -0 suffix
            const preventionData = JSON.parse(JSON.stringify(validatedData));
            const preventionDraft = await storage.createCase({
              ...preventionData,
              caseNumber: `${prefix}-0`,
              caseGroupId,
              createdBy: req.session.userId,
            });
            createdCases.push(preventionDraft);
          }

          // 2. Always create victim recovery case with next available suffix
          const nextSuffix = await storage.getNextVictimSuffix(prefix);
          const recoveryData = JSON.parse(JSON.stringify(validatedData));
          setVictimAddressForRecoveryCase(recoveryData);
          const recoveryDraft = await storage.createCase({
            ...recoveryData,
            caseNumber: `${prefix}-${nextSuffix}`,
            caseGroupId,
            createdBy: req.session.userId,
          });
          createdCases.push(recoveryDraft);
        } else {
          // No processing type selected - create draft with unique temporary case number
          // 처리구분 미선택 시에도 고유한 접수번호 생성 (나중에 접수완료 시 정식 번호로 변경됨)
          const draftCase = await storage.createCase({
            ...validatedData,
            caseNumber: `DRAFT-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            caseGroupId,
            createdBy: req.session.userId,
          });
          createdCases.push(draftCase);
        }

        return res.status(201).json({ success: true, cases: createdCases });
      }

      // Handle case completion (접수완료 status)
      if (validatedData.status === "접수완료") {
        const receptionDate = validatedData.receptionDate;
        if (!receptionDate) {
          return res.status(400).json({ error: "접수일이 필요합니다" });
        }

        const fullDate = receptionDate.split("T")[0];
        const completedCases: any[] = [];

        // 기존 임시저장 건이 있으면 업데이트
        if (validatedData.id) {
          const existingCase = await storage.getCaseById(validatedData.id);
          if (existingCase && existingCase.status === "배당대기") {
            // 기존 케이스의 접수번호 prefix/suffix 추출
            const existingCaseNumber = existingCase.caseNumber || "";

            // "-"이거나 "DRAFT-"로 시작하거나 빈 값이면 새 prefix 생성 필요
            const needsNewPrefix =
              !existingCaseNumber ||
              existingCaseNumber === "-" ||
              existingCaseNumber.startsWith("DRAFT-");

            let existingPrefix = "";
            let existingSuffix: string | null = null;

            if (
              !needsNewPrefix &&
              existingCaseNumber.includes("-") &&
              existingCaseNumber !== "-" &&
              !existingCaseNumber.startsWith("DRAFT-")
            ) {
              existingPrefix = existingCaseNumber.split("-")[0];
              existingSuffix = existingCaseNumber.split("-")[1];
            } else if (!needsNewPrefix) {
              existingPrefix = existingCaseNumber;
            }

            // 접수번호 prefix가 없으면 새로 생성
            if (needsNewPrefix || !existingPrefix) {
              const { prefix } = await storage.getNextCaseSequence(
                fullDate,
                validatedData.insuranceAccidentNo || undefined,
              );
              existingPrefix = prefix;
            }

            // 처리구분에 따라 접수번호 suffix 결정
            let newCaseNumber: string;

            if (!hasDamagePrevention && !hasVictimRecovery) {
              // 아무것도 선택 안함 → 기본 피해세대 (-1)로 처리
              const nextSuffix =
                await storage.getNextVictimSuffix(existingPrefix);
              newCaseNumber = `${existingPrefix}-${nextSuffix}`;
            } else if (hasDamagePrevention && !hasVictimRecovery) {
              // 손해방지만 선택 → -0 suffix
              // 먼저 -0 케이스가 이미 존재하는지 확인
              const existingPreventionCase =
                await storage.getPreventionCaseByPrefix(existingPrefix);

              if (
                existingPreventionCase &&
                existingPreventionCase.id !== validatedData.id
              ) {
                // -0 케이스가 이미 존재함 (현재 케이스와 다른 케이스)
                // 기존 -0 케이스가 배당대기(임시저장) 상태이면 삭제 후 현재 케이스를 -0으로 변경
                if (existingPreventionCase.status === "배당대기") {
                  await storage.deleteCase(existingPreventionCase.id);
                  console.log(
                    `[Case Complete] Deleted existing draft prevention case ${existingPreventionCase.caseNumber} to replace with current case`,
                  );
                  newCaseNumber = `${existingPrefix}-0`;
                } else {
                  // -0 케이스가 이미 접수완료 상태이면 현재 케이스 번호 유지
                  console.log(
                    `[Case Complete] Prevention case ${existingPreventionCase.caseNumber} already exists and completed, keeping current case number`,
                  );
                  newCaseNumber = existingCaseNumber; // 기존 번호 유지
                }
              } else {
                // -0 케이스가 없거나 현재 케이스가 -0인 경우
                newCaseNumber = `${existingPrefix}-0`;
              }
            } else if (!hasDamagePrevention && hasVictimRecovery) {
              // 피해세대만 선택 → -1 이상 suffix
              if (
                existingSuffix &&
                existingSuffix !== "0" &&
                parseInt(existingSuffix) >= 1
              ) {
                newCaseNumber = existingCaseNumber; // 기존 피해세대 번호 유지
              } else {
                const nextSuffix =
                  await storage.getNextVictimSuffix(existingPrefix);
                newCaseNumber = `${existingPrefix}-${nextSuffix}`;
              }
            } else {
              // 둘 다 선택 → 손해방지(-0)와 피해세대(-1+) 케이스 필요
              // 저장 시 이미 두 케이스가 생성되었을 수 있으므로 모두 업데이트

              // 먼저 같은 prefix를 가진 모든 draft 케이스를 찾음
              const relatedDraftCases =
                await storage.getCasesByPrefix(existingPrefix);
              const draftCases = relatedDraftCases.filter(
                (c) => c.status === "배당대기",
              );

              console.log(
                `[Case Complete] Found ${draftCases.length} draft cases with prefix ${existingPrefix}`,
              );

              if (draftCases.length >= 2) {
                // 이미 두 케이스가 존재함 (저장 시 생성됨) → 모두 접수완료로 업데이트
                // validatedData에서 id 제거하여 중복 키 오류 방지
                const updateDataWithoutId = { ...validatedData };
                delete (updateDataWithoutId as any).id;

                for (const draftCase of draftCases) {
                  const updatedCase = await storage.updateCase(draftCase.id, {
                    ...updateDataWithoutId,
                    caseNumber: draftCase.caseNumber || undefined,
                    caseGroupId,
                    status: "접수완료",
                  });
                  completedCases.push(updatedCase);
                  console.log(
                    `[Case Complete] Updated draft case ${draftCase.caseNumber} to 접수완료`,
                  );
                }
              } else {
                // 기존 케이스만 있거나 새로 생성 필요
                const existingPreventionCase =
                  await storage.getPreventionCaseByPrefix(existingPrefix);

                if (
                  existingPreventionCase &&
                  existingPreventionCase.id !== validatedData.id
                ) {
                  // -0 케이스가 다른 케이스로 존재함 → 현재 케이스는 피해세대로 유지
                  if (
                    existingSuffix &&
                    existingSuffix !== "0" &&
                    parseInt(existingSuffix) >= 1
                  ) {
                    newCaseNumber = existingCaseNumber;
                  } else {
                    const nextSuffix =
                      await storage.getNextVictimSuffix(existingPrefix);
                    newCaseNumber = `${existingPrefix}-${nextSuffix}`;
                  }

                  // 현재 케이스 업데이트 (피해세대 케이스로)
                  const updatedCase = await storage.updateCase(
                    validatedData.id,
                    {
                      ...validatedData,
                      caseNumber: newCaseNumber,
                      caseGroupId,
                      status: "접수완료",
                    },
                  );
                  completedCases.push(updatedCase);

                  // 기존 -0 케이스도 동기화 (정보 업데이트 및 접수완료)
                  if (existingPreventionCase.status === "배당대기") {
                    await storage.updateCase(existingPreventionCase.id, {
                      ...validatedData,
                      caseNumber:
                        existingPreventionCase.caseNumber || undefined,
                      caseGroupId,
                      status: "접수완료",
                    });
                  }

                  console.log(
                    `[Case Complete] Updated existing prevention case ${existingPreventionCase.caseNumber} and victim case ${newCaseNumber}`,
                  );
                } else if (
                  existingPreventionCase &&
                  existingPreventionCase.id === validatedData.id
                ) {
                  // 현재 케이스가 -0 케이스임 → -0은 유지하고 피해세대 케이스 확인/생성
                  newCaseNumber = `${existingPrefix}-0`;

                  // 기존 피해세대 케이스가 있는지 확인
                  const existingVictimCases = relatedDraftCases.filter(
                    (c) =>
                      c.id !== validatedData.id &&
                      c.caseNumber?.includes("-") &&
                      parseInt(c.caseNumber.split("-")[1]) >= 1,
                  );

                  // 현재 케이스(손방-0) 업데이트
                  const updatedPrevention = await storage.updateCase(
                    validatedData.id,
                    {
                      ...validatedData,
                      caseNumber: newCaseNumber,
                      caseGroupId,
                      status: "접수완료",
                    },
                  );
                  completedCases.push(updatedPrevention);

                  if (existingVictimCases.length > 0) {
                    // 기존 피해세대 케이스 업데이트
                    for (const victimCase of existingVictimCases) {
                      const updatedVictim = await storage.updateCase(
                        victimCase.id,
                        {
                          ...validatedData,
                          caseNumber: victimCase.caseNumber || undefined,
                          caseGroupId,
                          status: "접수완료",
                        },
                      );
                      completedCases.push(updatedVictim);
                    }
                  } else {
                    // 피해세대 케이스 새로 생성
                    const nextSuffix =
                      await storage.getNextVictimSuffix(existingPrefix);
                    const recoveryData = JSON.parse(
                      JSON.stringify(validatedData),
                    );
                    setVictimAddressForRecoveryCase(recoveryData);
                    const recoveryCase = await storage.createCase({
                      ...recoveryData,
                      caseNumber: `${existingPrefix}-${nextSuffix}`,
                      caseGroupId,
                      status: "접수완료",
                      createdBy: req.session.userId,
                    });
                    completedCases.push(recoveryCase);
                  }

                  console.log(
                    `[Case Complete] Updated prevention case and ${existingVictimCases.length > 0 ? "existing" : "new"} victim case`,
                  );
                } else {
                  // -0 케이스가 없음 → 기존 케이스를 -0으로, 새 피해세대 케이스 생성
                  newCaseNumber = `${existingPrefix}-0`;

                  const updatedCase = await storage.updateCase(
                    validatedData.id,
                    {
                      ...validatedData,
                      caseNumber: newCaseNumber,
                      caseGroupId,
                      status: "접수완료",
                    },
                  );
                  completedCases.push(updatedCase);

                  const nextSuffix =
                    await storage.getNextVictimSuffix(existingPrefix);
                  const recoveryData = JSON.parse(
                    JSON.stringify(validatedData),
                  );
                  setVictimAddressForRecoveryCase(recoveryData);
                  const recoveryCase = await storage.createCase({
                    ...recoveryData,
                    caseNumber: `${existingPrefix}-${nextSuffix}`,
                    caseGroupId,
                    status: "접수완료",
                    createdBy: req.session.userId,
                  });
                  completedCases.push(recoveryCase);

                  console.log(
                    `[Case Complete] Created prevention case ${newCaseNumber} and victim case`,
                  );
                }
              }

              // 동기화 및 응답
              if (completedCases.length > 0) {
                try {
                  const syncCount = await storage.syncIntakeDataToRelatedCases(
                    completedCases[0].id,
                  );
                  if (syncCount > 0) {
                    console.log(
                      `[Case Complete] Auto-synced intake data to ${syncCount} related cases`,
                    );
                  }
                } catch (syncError) {
                  console.error("Failed to sync intake data:", syncError);
                }
              }
              return res
                .status(200)
                .json({ success: true, cases: completedCases });
            }

            // 기존 케이스 업데이트
            const updatedCase = await storage.updateCase(validatedData.id, {
              ...validatedData,
              caseNumber: newCaseNumber,
              caseGroupId,
              status: "접수완료",
            });
            completedCases.push(updatedCase);

            // 동기화 및 응답
            if (completedCases.length > 0) {
              try {
                const syncCount = await storage.syncIntakeDataToRelatedCases(
                  completedCases[0].id,
                );
                if (syncCount > 0) {
                  console.log(
                    `[Case Complete] Auto-synced intake data to ${syncCount} related cases`,
                  );
                }
              } catch (syncError) {
                console.error("Failed to sync intake data:", syncError);
              }
            }
            return res
              .status(200)
              .json({ success: true, cases: completedCases });
          }
        }

        // 추가 피해자 생성 시: parentCasePrefix가 있으면 해당 prefix 기반으로 케이스 생성
        const parentCasePrefix = (req.body as any).parentCasePrefix;
        if (parentCasePrefix) {
          console.log(
            `[Case Create] Creating additional victim case with parentCasePrefix: ${parentCasePrefix}`,
          );
          const nextSuffix =
            await storage.getNextVictimSuffix(parentCasePrefix);
          const caseNumber = `${parentCasePrefix}-${nextSuffix}`;
          console.log(
            `[Case Create] Generated case number: ${caseNumber} (suffix: ${nextSuffix})`,
          );

          const newCase = await storage.createCase({
            ...validatedData,
            caseNumber,
            caseGroupId,
            createdBy: req.session.userId,
          });
          completedCases.push(newCase);

          // 접수 정보 동기화
          try {
            const syncCount = await storage.syncIntakeDataToRelatedCases(
              newCase.id,
            );
            if (syncCount > 0) {
              console.log(
                `[Case Create] Auto-synced intake data to ${syncCount} related cases`,
              );
            }
          } catch (syncError) {
            console.error(
              "Failed to sync intake data to related cases:",
              syncError,
            );
          }

          // 기존 케이스(-0)의 현장입력 데이터 복사
          try {
            const copied = await storage.copyFieldSurveyFromRelatedCase(
              newCase.id,
            );
            if (copied) {
              console.log(
                `[Case Create] Copied field survey data to new victim case ${newCase.caseNumber}`,
              );
            }
          } catch (copyError) {
            console.error(
              "Failed to copy field survey data to new case:",
              copyError,
            );
          }

          return res.status(201).json({ success: true, cases: completedCases });
        }

        // 새 케이스 생성 (임시저장 없이 바로 접수완료)
        const { prefix, suffix } = await storage.getNextCaseSequence(
          fullDate,
          validatedData.insuranceAccidentNo || undefined,
        );

        if (hasDamagePrevention && !hasVictimRecovery) {
          const caseNumber = `${prefix}-0`;
          const newCase = await storage.createCase({
            ...validatedData,
            caseNumber,
            caseGroupId,
            createdBy: req.session.userId,
          });
          completedCases.push(newCase);
        } else if (!hasDamagePrevention && hasVictimRecovery) {
          const caseNumber = `${prefix}-${suffix === 0 ? 1 : suffix}`;
          const newCase = await storage.createCase({
            ...validatedData,
            caseNumber,
            caseGroupId,
            createdBy: req.session.userId,
          });
          completedCases.push(newCase);
        } else if (hasDamagePrevention && hasVictimRecovery) {
          const existingPrevention =
            await storage.getPreventionCaseByPrefix(prefix);

          if (!existingPrevention) {
            const preventionData = JSON.parse(JSON.stringify(validatedData));
            const preventionCase = await storage.createCase({
              ...preventionData,
              caseNumber: `${prefix}-0`,
              caseGroupId,
              createdBy: req.session.userId,
            });
            completedCases.push(preventionCase);
          }

          const nextSuffix = await storage.getNextVictimSuffix(prefix);
          const recoveryData = JSON.parse(JSON.stringify(validatedData));
          setVictimAddressForRecoveryCase(recoveryData);
          const recoveryCase = await storage.createCase({
            ...recoveryData,
            caseNumber: `${prefix}-${nextSuffix}`,
            caseGroupId,
            createdBy: req.session.userId,
          });
          completedCases.push(recoveryCase);
        } else {
          const caseNumber = `${prefix}-${suffix === 0 ? 1 : suffix}`;
          const newCase = await storage.createCase({
            ...validatedData,
            caseNumber,
            caseGroupId,
            createdBy: req.session.userId,
          });
          completedCases.push(newCase);
        }

        // 동기화
        if (completedCases.length > 0) {
          try {
            const syncCount = await storage.syncIntakeDataToRelatedCases(
              completedCases[0].id,
            );
            if (syncCount > 0) {
              console.log(
                `[Case Create] Auto-synced intake data to ${syncCount} related cases`,
              );
            }
          } catch (syncError) {
            console.error(
              "Failed to sync intake data to related cases:",
              syncError,
            );
          }
        }

        return res.status(201).json({ success: true, cases: completedCases });
      }

      // Fallback: single case creation for other statuses
      // 다른 상태의 경우에도 실제 접수번호 형식 사용
      let caseNumber = validatedData.caseNumber;

      // 추가 피해자 생성 시: parentCasePrefix가 있으면 해당 prefix 기반으로 suffix 계산
      const parentCasePrefix = (req.body as any).parentCasePrefix;
      console.log(
        `[Case Create] parentCasePrefix: ${parentCasePrefix}, existing caseNumber: ${caseNumber}`,
      );
      if (parentCasePrefix && !caseNumber) {
        const nextSuffix = await storage.getNextVictimSuffix(parentCasePrefix);
        caseNumber = `${parentCasePrefix}-${nextSuffix}`;
        console.log(
          `[Case Create] Creating additional victim case with number: ${caseNumber} (suffix: ${nextSuffix})`,
        );
      } else if (!caseNumber) {
        console.log(`[Case Create] Fallback - generating new case number`);
        const receptionDate = new Date().toISOString().split("T")[0];
        const { prefix, suffix } = await storage.getNextCaseSequence(
          receptionDate,
          validatedData.insuranceAccidentNo || undefined,
        );
        caseNumber = `${prefix}-${suffix === 0 ? 1 : suffix}`;
        console.log(`[Case Create] Generated new case number: ${caseNumber}`);
      }

      const newCase = await storage.createCase({
        ...validatedData,
        caseNumber,
        caseGroupId,
        createdBy: req.session.userId,
      });

      // 추가 피해자 케이스 생성 후 동기화
      if (parentCasePrefix) {
        try {
          const syncCount = await storage.syncIntakeDataToRelatedCases(
            newCase.id,
          );
          if (syncCount > 0) {
            console.log(
              `[Case Create] Auto-synced intake data to ${syncCount} related cases`,
            );
          }
        } catch (syncError) {
          console.error(
            "Failed to sync intake data to related cases:",
            syncError,
          );
        }
      }

      res.status(201).json({ success: true, cases: [newCase] });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create case error:", error);
      res.status(500).json({ error: "접수 생성 중 오류가 발생했습니다" });
    }
  });

  // Get all cases endpoint (with role-based filtering)
  app.get("/api/cases", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Get current user for permission-based filtering
      const currentUser = await storage.getUser(req.session.userId);

      if (!currentUser) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      // Get cases filtered by user role and permissions
      const cases = await storage.getAllCases(currentUser);
      res.json(cases);
    } catch (error) {
      console.error("Get cases error:", error);
      res
        .status(500)
        .json({ error: "케이스 목록을 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get single case by ID endpoint
  app.get("/api/cases/:id", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;
      const caseData = await storage.getCaseById(id);

      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // Debug: log partner info being returned
      console.log(`[GET /api/cases/${id}] Partner info:`, {
        caseNumber: caseData.caseNumber,
        assignedPartner: caseData.assignedPartner,
        assignedPartnerManager: caseData.assignedPartnerManager,
        assignedPartnerContact: caseData.assignedPartnerContact,
      });

      // 심사사/조사사 이메일 자동 조회 (DB에 저장되지 않은 경우 users 테이블에서 찾기)
      const allUsers = await storage.getAllUsers();

      // 심사사 이메일이 없고 심사자 이름이 있으면 조회
      if (!caseData.assessorEmail && caseData.assessorTeam) {
        const assessorUser = allUsers.find(
          (u) => u.role === "심사사" && u.name === caseData.assessorTeam,
        );
        if (assessorUser?.email) {
          (caseData as any).assessorEmail = assessorUser.email;
          console.log(
            `[GET /api/cases/${id}] Auto-populated assessorEmail: ${assessorUser.email}`,
          );
        }
      }

      // 조사사 이메일이 없고 조사자 이름이 있으면 조회
      if (!caseData.investigatorEmail && caseData.investigatorTeamName) {
        const investigatorUser = allUsers.find(
          (u) =>
            u.role === "조사사" && u.name === caseData.investigatorTeamName,
        );
        if (investigatorUser?.email) {
          (caseData as any).investigatorEmail = investigatorUser.email;
          console.log(
            `[GET /api/cases/${id}] Auto-populated investigatorEmail: ${investigatorUser.email}`,
          );
        }
      }

      res.json(caseData);
    } catch (error) {
      console.error("Get case by ID error:", error);
      res
        .status(500)
        .json({ error: "케이스를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Helper function for field labels (for change logs)
  const getFieldLabel = (field: string): string => {
    const fieldLabels: Record<string, string> = {
      managerId: "당사 담당자",
      managerDepartment: "담당자 부서",
      managerPosition: "담당자 직급",
      managerContact: "담당자 연락처",
      accidentDate: "사고일",
      insuranceCompany: "보험사",
      insurancePolicyNo: "증권번호",
      insuranceAccidentNo: "사고번호",
      clientResidence: "의뢰사",
      clientDepartment: "의뢰자 부서",
      clientName: "의뢰자명",
      clientContact: "의뢰자 연락처",
      assessorId: "심사사",
      assessorDepartment: "심사사 부서",
      assessorTeam: "심사자",
      assessorContact: "심사사 연락처",
      investigatorTeam: "손사명",
      investigatorDepartment: "조사사 부서",
      investigatorTeamName: "조사자",
      investigatorContact: "조사사 연락처",
      policyHolderName: "보험계약자명",
      policyHolderIdNumber: "보험계약자 주민번호",
      policyHolderAddress: "보험계약자 주소",
      insuredName: "피보험자명",
      insuredIdNumber: "피보험자 주민번호",
      insuredAddress: "피보험자 주소",
      insuredAddressDetail: "피보험자 상세주소",
      insuredContact: "피보험자 연락처",
      victimName: "피해자명",
      victimIdNumber: "피해자 주민번호",
      victimAddress: "피해자 주소",
      victimAddressDetail: "피해자 상세주소",
      victimPhone: "피해자 연락처",
      victimContact: "피해자 연락처",
      perpetratorName: "가해자명",
      perpetratorIdNumber: "가해자 주민번호",
      perpetratorAddress: "가해자 주소",
      perpetratorPhone: "가해자 연락처",
      status: "상태",
      recoveryType: "복구 타입",
      specialNotes: "특이사항",
      additionalNotes: "추가 메모",
      buildingType: "건물 유형",
      buildingStructure: "건물 구조",
      accidentLocation: "사고 위치",
      accidentType: "사고 유형",
      causeOfDamage: "피해 원인",
      partnerCompany: "협력업체",
      assignedPartner: "배정 협력사",
      assignedPartnerManager: "협력사 담당자",
      assignedPartnerContact: "협력사 연락처",
      damagePreventionCost: "손해방지비용",
      victimIncidentAssistance: "피해자사고부담금",
    };
    return fieldLabels[field] || field;
  };

  // Update case endpoint
  app.patch("/api/cases/:id", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;
      const updateData = req.body;

      // 케이스 존재 여부 확인
      const existingCase = await storage.getCaseById(id);
      if (!existingCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 변경 사항 추적
      const changes: Array<{
        field: string;
        fieldLabel: string;
        before: string | null;
        after: string | null;
      }> = [];
      const trackedFields = [
        // 담당자 정보
        "managerId",
        "managerDepartment",
        "managerPosition",
        "managerContact",
        // 기본 정보
        "accidentDate",
        "insuranceCompany",
        "insurancePolicyNo",
        "insuranceAccidentNo",
        "clientResidence",
        "clientDepartment",
        "clientName",
        "clientContact",
        "assessorId",
        "assessorDepartment",
        "assessorTeam",
        "assessorContact",
        "investigatorTeam",
        "investigatorDepartment",
        "investigatorTeamName",
        "investigatorContact",
        // 보험계약자/피보험자/피해자/가해자 정보
        "policyHolderName",
        "policyHolderIdNumber",
        "policyHolderAddress",
        "insuredName",
        "insuredIdNumber",
        "insuredAddress",
        "insuredAddressDetail",
        "insuredContact",
        "victimName",
        "victimIdNumber",
        "victimAddress",
        "victimAddressDetail",
        "victimPhone",
        "victimContact",
        "perpetratorName",
        "perpetratorIdNumber",
        "perpetratorAddress",
        "perpetratorPhone",
        // 상태 및 기타 정보
        "status",
        "recoveryType",
        "specialNotes",
        "additionalNotes",
        "buildingType",
        "buildingStructure",
        "accidentLocation",
        "accidentType",
        "causeOfDamage",
        "partnerCompany",
        // 협력사 정보
        "assignedPartner",
        "assignedPartnerManager",
        "assignedPartnerContact",
        // 처리 유형
        "damagePreventionCost",
        "victimIncidentAssistance",
      ];

      // Helper function to normalize values for comparison
      const normalizeValue = (value: any): string | null => {
        if (value === null || value === undefined || value === "") {
          return null;
        }
        return String(value).trim();
      };

      // Get all users for resolving managerId to names
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

      // 협력사 배정 시 담당자 정보 자동 채우기
      // assignedPartner가 변경된 경우 새 협력업체의 담당자/연락처로 업데이트
      // 클라이언트에서 partnerChanged 플래그도 확인
      const isPartnerChangedByValue =
        updateData.assignedPartner &&
        updateData.assignedPartner !== existingCase.assignedPartner;
      const isPartnerChangedByFlag =
        updateData.partnerChanged === true ||
        updateData.partnerChanged === "true";
      const isPartnerChanged =
        isPartnerChangedByValue || isPartnerChangedByFlag;

      console.log(
        `[Partner Check] Case: ${existingCase.caseNumber}, isPartnerChangedByValue: ${isPartnerChangedByValue}, isPartnerChangedByFlag: ${isPartnerChangedByFlag}, isPartnerChanged: ${isPartnerChanged}, existingPartner: "${existingCase.assignedPartner}", newPartner: "${updateData.assignedPartner}", progressStatus: "${existingCase.progressStatus}"`,
      );

      // 협력사가 변경되었고 기존 진행상태가 "접수완료"가 아니면 진행상태 및 관련 데이터 초기화
      // progressStatus가 null/undefined인 경우는 초기화하지 않음 (아직 진행된 단계가 없음)
      const hasProgress =
        existingCase.progressStatus &&
        existingCase.progressStatus !== "접수완료";

      console.log(
        `[Partner Check] hasProgress: ${hasProgress}, progressStatus type: ${typeof existingCase.progressStatus}, value: "${existingCase.progressStatus}"`,
      );

      if (isPartnerChanged && hasProgress) {
        console.log(
          `[Partner Changed] Resetting progressStatus from "${existingCase.progressStatus}" to "접수완료" for case: ${existingCase.caseNumber}`,
        );
        updateData.progressStatus = "접수완료";

        // 기존 협력사가 진행한 모든 데이터 초기화 (견적서, 증빙자료, 도면 등)
        await storage.resetCaseFieldSurveyData(id);
        console.log(
          `[Partner Changed] All field survey data (documents, drawings, estimates) has been reset for case: ${existingCase.caseNumber}`,
        );
      } else if (isPartnerChanged) {
        console.log(
          `[Partner Changed] Partner changed but no reset needed - progressStatus: "${existingCase.progressStatus}" for case: ${existingCase.caseNumber}`,
        );
      }

      // partnerChanged 플래그는 DB에 저장하지 않음
      delete updateData.partnerChanged;

      if (
        updateData.assignedPartner &&
        (!updateData.assignedPartnerManager || isPartnerChanged)
      ) {
        const partnerCompanyName = updateData.assignedPartner;
        // 해당 회사명을 가진 협력사 사용자 찾기
        const partnerUser = allUsers.find(
          (u) => u.company === partnerCompanyName && u.role === "협력사",
        );
        if (partnerUser) {
          // 담당자명과 연락처 자동 채우기
          if (partnerUser.name) {
            updateData.assignedPartnerManager = partnerUser.name;
            console.log(
              `[Auto-populate] Partner manager set to: ${partnerUser.name} for company: ${partnerCompanyName}`,
            );
          }
          if (
            partnerUser.phone &&
            (!updateData.assignedPartnerContact || isPartnerChanged)
          ) {
            updateData.assignedPartnerContact = partnerUser.phone;
            console.log(
              `[Auto-populate] Partner contact set to: ${partnerUser.phone} for company: ${partnerCompanyName}`,
            );
          }
        } else if (isPartnerChanged) {
          // 협력업체가 변경되었지만 해당 협력사 사용자가 없는 경우 연락처 초기화
          console.log(
            `[Auto-populate] Partner changed to ${partnerCompanyName}, but no user found - clearing contact`,
          );
          updateData.assignedPartnerManager = "";
          updateData.assignedPartnerContact = "";
        }
      }

      // 심사사 이메일 자동 채우기
      // assessorTeam(심사자 이름)이 설정되면 해당 사용자의 이메일을 자동으로 채움
      const assessorName = updateData.assessorTeam || existingCase.assessorTeam;
      if (assessorName) {
        const assessorUser = allUsers.find(
          (u) => u.role === "심사사" && u.name === assessorName,
        );
        if (assessorUser?.email) {
          updateData.assessorEmail = assessorUser.email;
          console.log(
            `[Auto-populate] Assessor email set to: ${assessorUser.email} for assessor: ${assessorName}`,
          );
        }
      }

      // 조사사 이메일 자동 채우기
      // investigatorTeamName(조사자 이름)이 설정되면 해당 사용자의 이메일을 자동으로 채움
      const investigatorName =
        updateData.investigatorTeamName || existingCase.investigatorTeamName;
      if (investigatorName) {
        const investigatorUser = allUsers.find(
          (u) => u.role === "조사사" && u.name === investigatorName,
        );
        if (investigatorUser?.email) {
          updateData.investigatorEmail = investigatorUser.email;
          console.log(
            `[Auto-populate] Investigator email set to: ${investigatorUser.email} for investigator: ${investigatorName}`,
          );
        }
      }

      for (const field of trackedFields) {
        const oldValue = (existingCase as any)[field];
        const newValue = updateData[field];

        // Normalize values for comparison
        const normalizedOld = normalizeValue(oldValue);
        const normalizedNew = normalizeValue(newValue);

        // Only track if the field is being updated and the value actually changed
        if (field in updateData && normalizedOld !== normalizedNew) {
          // Special handling for managerId - resolve to user names
          if (field === "managerId") {
            const oldUserName = normalizedOld
              ? userMap.get(normalizedOld) || "(알수없음)"
              : null;
            const newUserName = normalizedNew
              ? userMap.get(normalizedNew) || "(알수없음)"
              : null;
            changes.push({
              field,
              fieldLabel: getFieldLabel(field),
              before: oldUserName,
              after: newUserName,
            });
          } else {
            changes.push({
              field,
              fieldLabel: getFieldLabel(field),
              before: normalizedOld,
              after: normalizedNew,
            });
          }
        }
      }

      // 처리구분(손해방지/피해세대)에 따른 접수번호 suffix 재계산
      // 중요: 처리구분 필드가 요청 데이터에 포함된 경우에만 접수번호 재계산
      const hasDamagePreventionField = "damagePreventionCost" in updateData;
      const hasVictimRecoveryField = "victimIncidentAssistance" in updateData;

      // 처리구분 필드가 없으면 기존 값 사용, 있으면 새 값 사용
      const hasDamagePrevention = hasDamagePreventionField
        ? updateData.damagePreventionCost === "true" ||
          (updateData.damagePreventionCost as unknown) === true
        : existingCase.damagePreventionCost === "true" ||
          (existingCase.damagePreventionCost as unknown) === true;
      const hasVictimRecovery = hasVictimRecoveryField
        ? updateData.victimIncidentAssistance === "true" ||
          (updateData.victimIncidentAssistance as unknown) === true
        : existingCase.victimIncidentAssistance === "true" ||
          (existingCase.victimIncidentAssistance as unknown) === true;

      // 기존 접수번호에서 prefix 추출
      const existingCaseNumber = existingCase.caseNumber || "";
      const needsNewPrefix =
        !existingCaseNumber ||
        existingCaseNumber === "-" ||
        existingCaseNumber.startsWith("DRAFT-");

      let existingPrefix = "";
      let existingSuffix: string | null = null;

      if (
        !needsNewPrefix &&
        existingCaseNumber.includes("-") &&
        existingCaseNumber !== "-" &&
        !existingCaseNumber.startsWith("DRAFT-")
      ) {
        existingPrefix = existingCaseNumber.split("-")[0];
        existingSuffix = existingCaseNumber.split("-")[1];
      } else if (!needsNewPrefix) {
        existingPrefix = existingCaseNumber;
      }

      // prefix가 없으면 새로 생성 (접수일자 = 기존 접수일자 또는 오늘 날짜 기준)
      if (needsNewPrefix || !existingPrefix) {
        const receptionDate =
          existingCase.receptionDate ||
          new Date().toISOString().split("T")[0];
        const { prefix } = await storage.getNextCaseSequence(
          receptionDate,
          updateData.insuranceAccidentNo ||
            existingCase.insuranceAccidentNo ||
            undefined,
        );
        existingPrefix = prefix;
      }

      // 기존 처리구분 확인
      const hadDamagePrevention =
        existingCase.damagePreventionCost === "true" ||
        (existingCase.damagePreventionCost as unknown) === true;
      const hadVictimRecovery =
        existingCase.victimIncidentAssistance === "true" ||
        (existingCase.victimIncidentAssistance as unknown) === true;

      // 처리구분 변경 감지 및 관련 케이스 삭제 처리
      const caseGroupId = existingCase.caseGroupId;
      let deletedCases: string[] = [];

      // 중요: 처리구분 필드가 업데이트에 포함되지 않으면 케이스 생성/삭제 로직 스킵
      // 이렇게 하면 인보이스 관리 팝업 등에서 단순 필드 업데이트 시 새 케이스가 생성되지 않음
      const shouldProcessCaseNumberLogic =
        hasDamagePreventionField || hasVictimRecoveryField;

      // 둘 다 선택 → 하나만 선택으로 변경된 경우
      if (shouldProcessCaseNumberLogic && existingPrefix) {
        // 같은 그룹 또는 같은 prefix의 모든 케이스 조회
        const allCases = await storage.getAllCases();
        const siblingCases = allCases.filter((c) => {
          if (c.id === id) return false; // 자기 자신 제외

          // caseGroupId가 있으면 그룹으로 비교
          if (caseGroupId && c.caseGroupId === caseGroupId) return true;

          // caseGroupId가 없으면 prefix로 비교
          const siblingNumber = c.caseNumber || "";
          if (
            siblingNumber.includes("-") &&
            siblingNumber !== "-" &&
            !siblingNumber.startsWith("DRAFT-")
          ) {
            const siblingPrefix = siblingNumber.split("-")[0];
            return siblingPrefix === existingPrefix;
          }
          return false;
        });

        // 손해방지만 선택 → 모든 형제 케이스 삭제 (현재 케이스가 -0이 됨)
        if (hasDamagePrevention && !hasVictimRecovery) {
          for (const sibling of siblingCases) {
            // 배당대기 상태만 삭제 가능
            if (sibling.status === "배당대기") {
              await storage.deleteCase(sibling.id);
              deletedCases.push(sibling.caseNumber || sibling.id);
              console.log(
                `[Case Delete] Deleted sibling case ${sibling.caseNumber} for damage prevention only (status: ${sibling.status})`,
              );
            }
          }
        }

        // 피해세대만 선택 → 모든 형제 케이스 삭제 (현at� 케이스만 유지)
        if (!hasDamagePrevention && hasVictimRecovery) {
          for (const sibling of siblingCases) {
            // 배당대기 상태만 삭제 가능
            if (sibling.status === "배당대기") {
              await storage.deleteCase(sibling.id);
              deletedCases.push(sibling.caseNumber || sibling.id);
              console.log(
                `[Case Delete] Deleted sibling case ${sibling.caseNumber} for victim recovery only (status: ${sibling.status})`,
              );
            }
          }
        }

        // 아무것도 선택 안함 → 모든 형제 케이스 삭제
        if (!hasDamagePrevention && !hasVictimRecovery) {
          for (const sibling of siblingCases) {
            if (sibling.status === "배당대기") {
              await storage.deleteCase(sibling.id);
              deletedCases.push(sibling.caseNumber || sibling.id);
              console.log(
                `[Case Delete] Deleted sibling case ${sibling.caseNumber} (status: ${sibling.status})`,
              );
            }
          }
        }
      }

      // 처리구분에 따른 접수번호 결정 (처리구분 필드가 업데이트에 포함된 경우에만 실행)
      let newCaseNumber = existingCaseNumber;

      if (shouldProcessCaseNumberLogic) {
        if (!hasDamagePrevention && !hasVictimRecovery) {
          // 아무것도 선택 안함 → 고유한 임시 접수번호 생성
          newCaseNumber = `DRAFT-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        } else if (hasDamagePrevention && !hasVictimRecovery) {
          // 손해방지만 → -0
          newCaseNumber = `${existingPrefix}-0`;
        } else if (!hasDamagePrevention && hasVictimRecovery) {
          // 피해세대만 → 기존 피해세대 suffix 유지 또는 새로 할당
          if (
            existingSuffix &&
            existingSuffix !== "0" &&
            parseInt(existingSuffix) >= 1
          ) {
            newCaseNumber = existingCaseNumber;
          } else {
            const nextSuffix =
              await storage.getNextVictimSuffix(existingPrefix);
            newCaseNumber = `${existingPrefix}-${nextSuffix}`;
          }
        } else {
          // 둘 다 선택 → 기존 케이스와 형제 케이스 모두 업데이트

          // 같은 prefix를 가진 기존 케이스들 확인
          const relatedCases = await storage.getCasesByPrefix(existingPrefix);
          const existingPreventionCase = relatedCases.find(
            (c) => c.caseNumber === `${existingPrefix}-0`,
          );
          const existingVictimCases = relatedCases.filter(
            (c) =>
              c.caseNumber?.includes("-") &&
              parseInt(c.caseNumber.split("-")[1]) >= 1,
          );

          // 현재 케이스가 -0인지 확인
          const currentIsPrevention =
            existingCaseNumber === `${existingPrefix}-0`;

          if (currentIsPrevention) {
            // 현재 케이스가 손해방지(-0)인 경우 → 번호 유지, 기존 피해세대 케이스 업데이트 또는 생성
            newCaseNumber = existingCaseNumber;

            const updatedCase = await storage.updateCase(id, {
              ...updateData,
              caseNumber: newCaseNumber,
            });
            if (!updatedCase) {
              return res
                .status(404)
                .json({ error: "케이스 업데이트에 실패했습니다" });
            }

            const completedCases = [updatedCase];

            if (existingVictimCases.length > 0) {
              // 기존 피해세대 케이스가 있으면 업데이트
              const updateDataWithoutId = { ...updateData };
              delete (updateDataWithoutId as any).id;

              for (const victimCase of existingVictimCases) {
                const updatedVictim = await storage.updateCase(victimCase.id, {
                  ...updateDataWithoutId,
                  caseNumber: victimCase.caseNumber,
                  status: updateData.status || victimCase.status,
                });
                if (updatedVictim) completedCases.push(updatedVictim);
              }
              console.log(
                `[Case Update] Updated prevention case and ${existingVictimCases.length} existing victim case(s)`,
              );
            } else {
              // 피해세대 케이스가 없으면 새로 생성
              const nextSuffix =
                await storage.getNextVictimSuffix(existingPrefix);
              const caseGroupIdForNew =
                existingCase.caseGroupId || `group-${Date.now()}`;
              const recoveryData = JSON.parse(JSON.stringify(updateData));
              delete recoveryData.id;
              setVictimAddressForRecoveryCase(recoveryData);

              const recoveryCase = await storage.createCase({
                ...recoveryData,
                caseNumber: `${existingPrefix}-${nextSuffix}`,
                caseGroupId: caseGroupIdForNew,
                status: updateData.status || existingCase.status,
                createdBy: req.session.userId,
              });
              completedCases.push(recoveryCase);
              console.log(
                `[Case Update] Updated prevention case and created new victim case`,
              );
            }

            // 변경 로그 저장
            if (changes.length > 0) {
              try {
                const user = await storage.getUser(req.session.userId);
                await storage.createCaseChangeLog({
                  caseId: id,
                  changedBy: req.session.userId,
                  changedByName: user?.name || "알 수 없음",
                  changeType: "update",
                  changes,
                  note: null,
                });
              } catch (logError) {
                console.error("Failed to create change log:", logError);
              }
            }

            try {
              await storage.syncIntakeDataToRelatedCases(id);
            } catch (syncError) {
              console.error("Failed to sync intake data:", syncError);
            }

            return res.json({ success: true, cases: completedCases });
          } else {
            // 현재 케이스가 피해세대(-1 이상)인 경우
            // 현재 케이스 번호 유지, 손해방지 케이스 업데이트 또는 생성
            newCaseNumber = existingCaseNumber;

            const updatedCase = await storage.updateCase(id, {
              ...updateData,
              caseNumber: newCaseNumber,
            });
            if (!updatedCase) {
              return res
                .status(404)
                .json({ error: "케이스 업데이트에 실패했습니다" });
            }

            const completedCases = [updatedCase];

            if (existingPreventionCase) {
              // 기존 손해방지 케이스가 있으면 업데이트
              const updateDataWithoutId = { ...updateData };
              delete (updateDataWithoutId as any).id;

              const updatedPrevention = await storage.updateCase(
                existingPreventionCase.id,
                {
                  ...updateDataWithoutId,
                  caseNumber: existingPreventionCase.caseNumber,
                  status: updateData.status || existingPreventionCase.status,
                },
              );
              if (updatedPrevention) completedCases.push(updatedPrevention);
              console.log(
                `[Case Update] Updated victim case and existing prevention case`,
              );
            } else {
              // 손해방지 케이스가 없으면 새로 생성
              const caseGroupIdForNew =
                existingCase.caseGroupId || `group-${Date.now()}`;
              const preventionData = JSON.parse(JSON.stringify(updateData));
              delete preventionData.id;

              const preventionCase = await storage.createCase({
                ...preventionData,
                caseNumber: `${existingPrefix}-0`,
                caseGroupId: caseGroupIdForNew,
                status: updateData.status || existingCase.status,
                createdBy: req.session.userId,
              });
              completedCases.push(preventionCase);
              console.log(
                `[Case Update] Updated victim case and created new prevention case`,
              );
            }

            // 변경 로그 저장
            if (changes.length > 0) {
              try {
                const user = await storage.getUser(req.session.userId);
                await storage.createCaseChangeLog({
                  caseId: id,
                  changedBy: req.session.userId,
                  changedByName: user?.name || "알 수 없음",
                  changeType: "update",
                  changes,
                  note: null,
                });
              } catch (logError) {
                console.error("Failed to create change log:", logError);
              }
            }

            try {
              await storage.syncIntakeDataToRelatedCases(id);
            } catch (syncError) {
              console.error("Failed to sync intake data:", syncError);
            }

            return res.json({ success: true, cases: completedCases });
          }
        }
      }

      // 접수번호 업데이트 포함 (처리구분 로직을 실행한 경우에만 접수번호 변경)
      const updateDataWithCaseNumber = shouldProcessCaseNumberLogic
        ? { ...updateData, caseNumber: newCaseNumber }
        : updateData;

      // 케이스 업데이트
      const updatedCase = await storage.updateCase(
        id,
        updateDataWithCaseNumber,
      );

      if (!updatedCase) {
        return res
          .status(404)
          .json({ error: "케이스 업데이트에 실패했습니다" });
      }

      // 변경 로그 저장 (변경 사항이 있을 때만)
      if (changes.length > 0) {
        try {
          const user = await storage.getUser(req.session.userId);
          await storage.createCaseChangeLog({
            caseId: id,
            changedBy: req.session.userId,
            changedByName: user?.name || "알 수 없음",
            changeType: "update",
            changes,
            note: null,
          });
          console.log(
            `[Change Log] Recorded ${changes.length} changes for case ${id}:`,
            changes
              .map((c) => `${c.fieldLabel}: ${c.before} → ${c.after}`)
              .join(", "),
          );
        } catch (logError) {
          console.error("Failed to create change log:", logError);
          // Don't fail the request if logging fails
        }
      }

      // 같은 prefix를 가진 관련 케이스들에 접수 정보 동기화
      // (예: 251102001, 251102001-1, 251102001-2는 모두 동기화)
      try {
        const syncCount = await storage.syncIntakeDataToRelatedCases(id);
        if (syncCount > 0) {
          console.log(
            `[Case Update] Auto-synced intake data to ${syncCount} related cases`,
          );
        }
      } catch (syncError) {
        console.error(
          "Failed to sync intake data to related cases:",
          syncError,
        );
        // Don't fail the request if sync fails
      }

      // 입금/지급 관련 날짜 동기화: 같은 사고번호의 모든 건에 자동 연동
      const paymentSyncFields = ["partialPaymentDate", "paymentCompletedDate", "settlementCompletedDate", "taxInvoiceConfirmDate", "claimDate"] as const;
      const paymentSyncData: Record<string, string> = {};
      for (const field of paymentSyncFields) {
        if (field in updateData && updateData[field]) {
          paymentSyncData[field] = updateData[field];
        }
      }
      if (Object.keys(paymentSyncData).length > 0 && updatedCase.insuranceAccidentNo) {
        try {
          const allCasesForSync = await storage.getAllCases();
          const siblingCases = allCasesForSync.filter(
            (c) => c.id !== id && c.insuranceAccidentNo === updatedCase.insuranceAccidentNo
          );
          for (const sibling of siblingCases) {
            await storage.updateCase(sibling.id, paymentSyncData as any);
          }
          if (siblingCases.length > 0) {
            console.log(
              `[Payment Sync] Synced ${Object.keys(paymentSyncData).join(", ")} to ${siblingCases.length} sibling cases (accidentNo: ${updatedCase.insuranceAccidentNo})`,
            );
          }
        } catch (syncError) {
          console.error("Failed to sync payment dates to sibling cases:", syncError);
        }
      }

      res.json({ success: true, case: updatedCase });
    } catch (error) {
      console.error("Update case error:", error);
      res.status(500).json({ error: "케이스 업데이트 중 오류가 발생했습니다" });
    }
  });

  // Delete case endpoint
  app.delete("/api/cases/:id", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;

      // 케이스 존재 여부 확인
      const existingCase = await storage.getCaseById(id);
      if (!existingCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 관리자는 모든 케이스 삭제 가능, 그 외는 배당대기 상태만 삭제 가능
      if (
        req.session.userRole !== "관리자" &&
        existingCase.status !== "배당대기"
      ) {
        return res
          .status(403)
          .json({ error: "임시저장 건(배당대기 상태)만 삭제할 수 있습니다" });
      }

      // 케이스 삭제
      await storage.deleteCase(id);

      res.json({ success: true, message: "케이스가 삭제되었습니다" });
    } catch (error) {
      console.error("Delete case error:", error);
      res.status(500).json({ error: "케이스 삭제 중 오류가 발생했습니다" });
    }
  });

  // Update case status endpoint (admin and partner)
  app.patch("/api/cases/:caseId/status", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;

    // Check authorization (관리자 또는 협력사)
    if (userRole !== "관리자" && userRole !== "협력사") {
      return res.status(403).json({ error: "권한이 없습니다" });
    }

    try {
      const { caseId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: "상태 값이 필요합니다" });
      }

      // 허용된 상태값 검증
      const ALLOWED_STATUSES = [
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
        "부분지급",
        "지급완료",
        "정산완료",
        "접수취소",
      ];

      if (!ALLOWED_STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ error: `허용되지 않은 상태값입니다: ${status}` });
      }

      // 협력사는 직접복구/선견적요청 및 그 자동전환 상태만 변경 가능
      if (userRole === "협력사") {
        const PARTNER_ALLOWED = [
          "직접복구",
          "선견적요청",
          "청구자료제출(복구)",
          "출동비청구(선견적)",
        ];
        if (!PARTNER_ALLOWED.includes(status)) {
          return res.status(403).json({
            error: "협력사는 직접복구/선견적요청만 선택할 수 있습니다",
          });
        }
      }

      // storage.updateCaseStatus에서 미복구→출동비 청구 정규화 처리 및 날짜 자동 기록
      const updatedCase = await storage.updateCaseStatus(caseId, status);

      if (!updatedCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 정산 관련 상태 변경 시 같은 사고번호의 관련건에도 상태 및 날짜 동기화
      const PAYMENT_STATUSES = ["청구", "입금완료", "부분입금", "부분지급", "지급완료", "정산완료"];
      const normalizedForSync = status === "미복구" ? "출동비 청구" : status;
      if (PAYMENT_STATUSES.includes(normalizedForSync) && updatedCase.insuranceAccidentNo) {
        try {
          const allCases = await storage.getAllCases();
          const siblingCases = allCases.filter(
            (c) => c.id !== caseId && c.insuranceAccidentNo === updatedCase.insuranceAccidentNo && c.status !== "접수취소"
          );
          // 날짜 동기화 필드 결정
          const dateSyncData: Record<string, string> = {};
          if (updatedCase.partialPaymentDate && (normalizedForSync === "부분입금" || normalizedForSync === "부분지급")) {
            dateSyncData.partialPaymentDate = updatedCase.partialPaymentDate;
          }
          if (updatedCase.paymentCompletedDate && (normalizedForSync === "입금완료" || normalizedForSync === "지급완료")) {
            dateSyncData.paymentCompletedDate = updatedCase.paymentCompletedDate;
          }
          if (updatedCase.settlementCompletedDate && normalizedForSync === "정산완료") {
            dateSyncData.settlementCompletedDate = updatedCase.settlementCompletedDate;
          }
          if (updatedCase.claimDate && normalizedForSync === "청구") {
            dateSyncData.claimDate = updatedCase.claimDate;
          }
          for (const sibling of siblingCases) {
            // 상태 동기화
            await storage.updateCaseStatus(sibling.id, normalizedForSync);
            // 날짜 동기화 (별도로 업데이트)
            if (Object.keys(dateSyncData).length > 0) {
              await storage.updateCase(sibling.id, dateSyncData as any);
            }
          }
          if (siblingCases.length > 0) {
            console.log(`[Status Sync] Synced status "${normalizedForSync}" to ${siblingCases.length} sibling cases (accidentNo: ${updatedCase.insuranceAccidentNo})`);
          }
        } catch (syncError) {
          console.error("Failed to sync status to sibling cases:", syncError);
        }
      }

      // SMS 알림은 이제 클라이언트의 다이얼로그를 통해 확인 후 발송됩니다
      // 자동 발송 코드는 제거되었습니다

      res.json({ success: true, case: updatedCase });
    } catch (error) {
      console.error("Update case status error:", error);
      res.status(500).json({ error: "상태 변경 중 오류가 발생했습니다" });
    }
  });

  app.get("/api/case-status-history", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }
    try {
      const history = await storage.getAllStatusHistory();
      res.json(history);
    } catch (error) {
      console.error("Get status history error:", error);
      res.status(500).json({ error: "상태 이력 조회 중 오류가 발생했습니다" });
    }
  });

  // Update case special notes endpoint (협력사 only)
  app.patch("/api/cases/:caseId/special-notes", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check authorization (협력사만 가능)
    if (req.session.userRole !== "협력사") {
      return res.status(403).json({ error: "협력사 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      // Validate specialNotes with Zod
      const updateSchema = z.object({
        specialNotes: z
          .string()
          .max(1000, "특이사항은 최대 1000자까지 입력 가능합니다")
          .nullable(),
      });

      const { specialNotes } = updateSchema.parse(req.body);

      const updatedCase = await storage.updateCaseSpecialNotes(
        caseId,
        specialNotes,
      );

      if (!updatedCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      res.json({ success: true, case: updatedCase });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Update case special notes error:", error);
      res.status(500).json({ error: "특이사항 저장 중 오류가 발생했습니다" });
    }
  });

  // Confirm case special notes endpoint (관리자 only)
  app.patch("/api/cases/:caseId/special-notes-confirm", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check admin authorization
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      const updatedCase = await storage.confirmCaseSpecialNotes(
        caseId,
        req.session.userId,
      );

      if (!updatedCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      res.json({ success: true, case: updatedCase });
    } catch (error) {
      console.error("Confirm case special notes error:", error);
      res.status(500).json({ error: "특이사항 확인 중 오류가 발생했습니다" });
    }
  });

  // Add note to partner/admin notes history endpoint
  app.post("/api/cases/:caseId/notes-history", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check authorization (협력사 또는 관리자만)
    if (
      req.session.userRole !== "협력사" &&
      req.session.userRole !== "관리자"
    ) {
      return res
        .status(403)
        .json({ error: "협력사 또는 관리자 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      // Validate input with Zod
      const noteSchema = z.object({
        content: z
          .string()
          .min(1, "내용을 입력해주세요")
          .max(1000, "특이사항은 최대 1000자까지 입력 가능합니다"),
      });

      const { content } = noteSchema.parse(req.body);
      const noteType = req.session.userRole === "협력사" ? "partner" : "admin";

      // Get existing case
      const existingCase = await storage.getCaseById(caseId);
      if (!existingCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // Get user info for name
      const currentUser = await storage.getUser(req.session.userId);

      // Get current notes history
      const historyField =
        noteType === "partner" ? "partnerNotesHistory" : "adminNotesHistory";
      const currentHistory = existingCase[historyField]
        ? JSON.parse(existingCase[historyField] as string)
        : [];

      // Add new note
      const newNote = {
        content,
        createdAt: new Date().toISOString(),
        createdBy: req.session.userId,
        createdByName: currentUser?.name || "",
      };

      currentHistory.push(newNote);

      // Update case and reset ack flag (새 메모 추가시 확인 상태 리셋)
      const updateData: any = {};
      updateData[historyField] = JSON.stringify(currentHistory);

      // Reset ack flag when new note is added
      if (noteType === "partner") {
        updateData.partnerNotesAckedByAdmin = null; // 협력사 메모 추가 → 관리자 확인 리셋 → 빨간점 다시 표시
      } else {
        updateData.adminNotesAckedByPartner = null; // 관리자 메모 추가 → 협력사 확인 리셋 → 파란점 다시 표시
      }

      const updatedCase = await storage.updateCase(caseId, updateData);

      if (!updatedCase) {
        return res
          .status(404)
          .json({ error: "케이스 업데이트에 실패했습니다" });
      }

      res.json({ success: true, case: updatedCase, noteType });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Add notes history error:", error);
      res.status(500).json({ error: "특이사항 저장 중 오류가 발생했습니다" });
    }
  });

  // Acknowledge notes endpoint (협력사가 관리자 특이사항 확인, 관리자가 협력사 특이사항 확인)
  app.post("/api/cases/:caseId/notes-ack", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check authorization (협력사 또는 관리자만)
    if (
      req.session.userRole !== "협력사" &&
      req.session.userRole !== "관리자"
    ) {
      return res
        .status(403)
        .json({ error: "협력사 또는 관리자 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      // Get existing case
      const existingCase = await storage.getCaseById(caseId);
      if (!existingCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // Update appropriate ack field based on role
      const updateData: any = {};
      if (req.session.userRole === "협력사") {
        // 협력사가 관리자 특이사항 확인 → 파란점 사라짐
        updateData.adminNotesAckedByPartner = "true";
      } else if (req.session.userRole === "관리자") {
        // 관리자가 협력사 특이사항 확인 → 빨간점 사라짐
        updateData.partnerNotesAckedByAdmin = "true";
      }

      const updatedCase = await storage.updateCase(caseId, updateData);

      if (!updatedCase) {
        return res
          .status(404)
          .json({ error: "케이스 업데이트에 실패했습니다" });
      }

      res.json({ success: true, case: updatedCase });
    } catch (error) {
      console.error("Acknowledge notes error:", error);
      res
        .status(500)
        .json({ error: "특이사항 확인 처리 중 오류가 발생했습니다" });
    }
  });

  // Add progress update endpoint (관리자 only)
  app.post("/api/cases/:caseId/progress", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check admin authorization
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      // Validate content with Zod
      const progressSchema = z.object({
        content: z.string().min(1, "진행상황 내용이 필요합니다"),
      });

      const { content } = progressSchema.parse(req.body);

      const progressUpdate = await storage.createProgressUpdate({
        caseId,
        content,
        createdBy: req.session.userId,
      });

      res.json({ success: true, progressUpdate });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Add progress update error:", error);
      res.status(500).json({ error: "진행상황 추가 중 오류가 발생했습니다" });
    }
  });

  // Update case additional notes endpoint (협력사 only)
  app.patch("/api/cases/:caseId/additional-notes", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check authorization (협력사만 가능)
    if (req.session.userRole !== "협력사") {
      return res.status(403).json({ error: "협력사 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      // Validate additionalNotes with Zod (800자 제한)
      const updateSchema = z.object({
        additionalNotes: z
          .string()
          .max(800, "기타사항은 800자를 초과할 수 없습니다")
          .nullable(),
      });

      const { additionalNotes } = updateSchema.parse(req.body);

      const updatedCase = await storage.updateCaseAdditionalNotes(
        caseId,
        additionalNotes,
      );

      if (!updatedCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      res.json({ success: true, case: updatedCase });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Update case additional notes error:", error);
      res.status(500).json({ error: "기타사항 저장 중 오류가 발생했습니다" });
    }
  });

  // Submit field survey endpoint (협력사 only)
  app.patch("/api/cases/:caseId/submit", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check authorization (협력사만 가능)
    if (req.session.userRole !== "협력사") {
      return res.status(403).json({ error: "협력사 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      // 케이스 정보 조회
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 도면 조회
      const drawing = await storage.getDrawingByCaseId(caseId);

      // 증빙자료 조회
      const documents = await storage.getDocumentsByCaseId(caseId);

      // 최신 견적 조회
      const estimateData = await storage.getLatestEstimate(caseId);

      // 손해방지 케이스 여부 (접수번호가 -0으로 끝나면 손해방지)
      const isLossPreventionCase = /-0$/.test(caseData.caseNumber || "");

      // 견적 완료 여부 체크
      // - 손해방지 케이스: 복구면적 산출표 없어도 노무비/자재비만 있으면 완료
      // - 피해복구 케이스: 복구면적 산출표 필수
      const hasRecoveryRows = !!(
        estimateData?.rows && estimateData.rows.length > 0
      );
      let hasLaborCosts = false;
      let hasMaterialCosts = false;

      if (estimateData?.estimate?.laborCostData) {
        try {
          const data =
            typeof estimateData.estimate.laborCostData === "string"
              ? JSON.parse(estimateData.estimate.laborCostData)
              : estimateData.estimate.laborCostData;
          hasLaborCosts = Array.isArray(data) && data.length > 0;
        } catch {
          hasLaborCosts = false;
        }
      }

      if (estimateData?.estimate?.materialCostData) {
        try {
          const data =
            typeof estimateData.estimate.materialCostData === "string"
              ? JSON.parse(estimateData.estimate.materialCostData)
              : estimateData.estimate.materialCostData;
          hasMaterialCosts = Array.isArray(data) && data.length > 0;
        } catch {
          hasMaterialCosts = false;
        }
      }

      // 완료 여부 체크
      const isFieldSurveyComplete = !!(
        caseData.visitDate &&
        caseData.visitTime &&
        caseData.accidentCategory
      );
      const isDrawingComplete = !!drawing;
      const isDocumentsComplete = documents.length > 0;
      // 손해방지 케이스: 노무비 또는 자재비만 있으면 완료
      // 피해복구 케이스: 복구면적 산출표 필수
      const isEstimateComplete = isLossPreventionCase
        ? hasLaborCosts || hasMaterialCosts
        : hasRecoveryRows;

      if (
        !isFieldSurveyComplete ||
        !isDrawingComplete ||
        !isDocumentsComplete ||
        !isEstimateComplete
      ) {
        const missingItems = [];
        if (!isFieldSurveyComplete) missingItems.push("현장조사 정보");
        if (!isDrawingComplete) missingItems.push("도면");
        if (!isDocumentsComplete) missingItems.push("증빙자료");
        if (!isEstimateComplete) missingItems.push("견적서");

        return res.status(400).json({
          error: `다음 항목을 완료해주세요: ${missingItems.join(", ")}`,
        });
      }

      // 견적 총액 계산 (노임비 + 재료비 + 관리비 + 이윤 + VAT)
      let estimateTotal: number | null = null;
      if (estimateData && estimateData.rows) {
        const rows = estimateData.rows as any[];
        const vatIncluded = (estimateData as any).vatIncluded ?? true;

        // 노임비 합계 (경비 제외)
        const laborCosts = rows.reduce((sum: number, row: any) => {
          const laborAmount = parseFloat(row.laborCost?.toString() || "0") || 0;
          const includeInEstimate = row.includeInEstimate !== false;
          return sum + (includeInEstimate ? laborAmount : 0);
        }, 0);

        // 경비 합계 (includeInEstimate가 false인 노임비)
        const expenseCosts = rows.reduce((sum: number, row: any) => {
          const laborAmount = parseFloat(row.laborCost?.toString() || "0") || 0;
          const includeInEstimate = row.includeInEstimate !== false;
          return sum + (includeInEstimate ? 0 : laborAmount);
        }, 0);

        // 재료비 합계
        const materialCosts = rows.reduce((sum: number, row: any) => {
          return sum + (parseFloat(row.materialCost?.toString() || "0") || 0);
        }, 0);

        // 기초금액 (노임비 + 재료비, 경비 제외)
        const baseAmount = laborCosts + materialCosts;

        // 관리비 6%, 이윤 15%
        const managementFee = Math.round(baseAmount * 0.06);
        const profit = Math.round(baseAmount * 0.15);

        // 소계 (노임비 + 경비 + 재료비 + 관리비 + 이윤)
        const subtotal =
          laborCosts + expenseCosts + materialCosts + managementFee + profit;

        // VAT 10%
        const vat = vatIncluded ? Math.round(subtotal * 0.1) : 0;

        // 최종 합계
        estimateTotal = subtotal + vat;
      }

      // 견적 rows가 없으면 기존 estimateAmount 사용 (fallback)
      if (estimateTotal === null && caseData.estimateAmount) {
        const parsedAmount = parseFloat(
          caseData.estimateAmount.replace(/,/g, ""),
        );
        estimateTotal = isNaN(parsedAmount) ? 0 : parsedAmount;
      }

      // 여전히 null이면 0으로 설정 (견적이 없는 경우)
      if (estimateTotal === null) {
        estimateTotal = 0;
      }

      // 케이스 번호로 손해방지비용(-0) 또는 대물비용(-1,-2...) 판별
      const caseNumber = caseData.caseNumber || "";
      const caseNumberParts = caseNumber.split("-");
      const suffix =
        caseNumberParts.length > 1
          ? parseInt(caseNumberParts[caseNumberParts.length - 1], 10)
          : 0;
      const isPrevention = suffix === 0;

      // 제출 처리 (초기 견적금액 포함)
      const updatedCase = await storage.submitFieldSurvey(caseId, {
        estimateTotal: estimateTotal.toString(),
        isPrevention,
      });

      if (!updatedCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      res.json({ success: true, case: updatedCase });
    } catch (error) {
      console.error("Submit field survey error:", error);
      res
        .status(500)
        .json({ error: "현장조사 보고서 제출 중 오류가 발생했습니다" });
    }
  });

  // Review case endpoint (관리자 only)
  app.patch("/api/cases/:caseId/review", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check authorization (관리자만 가능)
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      // Validate review data with Zod
      const parsed = reviewCaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "입력 데이터가 유효하지 않습니다",
          details: parsed.error.errors,
        });
      }

      const { decision, reviewComment } = parsed.data;

      // 케이스 확인
      const existingCase = await storage.getCaseById(caseId);
      if (!existingCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 제출된 보고서만 심사 가능
      if (existingCase.fieldSurveyStatus !== "submitted") {
        return res.status(400).json({
          error: "제출된 보고서만 심사할 수 있습니다",
        });
      }

      // 심사 처리
      const updatedCase = await storage.reviewCase(
        caseId,
        decision,
        reviewComment || null,
        req.session.userId,
      );

      if (!updatedCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      res.json({ success: true, case: updatedCase });
    } catch (error) {
      console.error("Review case error:", error);
      res.status(500).json({ error: "보고서 심사 중 오류가 발생했습니다" });
    }
  });

  // Approve report endpoint (관리자 only - 2차 승인)
  app.patch("/api/cases/:caseId/approve-report", async (req, res) => {
    console.log("[APPROVE-REPORT] Request received:", {
      caseId: req.params.caseId,
      body: req.body,
      userId: req.session?.userId,
      userRole: req.session?.userRole,
    });

    // Check authentication
    if (!req.session?.userId) {
      console.log("[APPROVE-REPORT] Auth failed - no userId");
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check authorization (관리자만 가능)
    if (req.session.userRole !== "관리자") {
      console.log(
        "[APPROVE-REPORT] Auth failed - not 관리자, role:",
        req.session.userRole,
      );
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { caseId } = req.params;

      // Validate approval data with Zod
      const parsed = approveReportSchema.safeParse(req.body);
      if (!parsed.success) {
        console.log("[APPROVE-REPORT] Validation failed:", parsed.error.errors);
        return res.status(400).json({
          error: "입력 데이터가 유효하지 않습니다",
          details: parsed.error.errors,
        });
      }

      const { decision, approvalComment } = parsed.data;
      console.log("[APPROVE-REPORT] Parsed data:", {
        decision,
        approvalComment,
      });

      // 케이스 확인
      const existingCase = await storage.getCaseById(caseId);
      if (!existingCase) {
        console.log("[APPROVE-REPORT] Case not found:", caseId);
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      console.log(
        "[APPROVE-REPORT] Existing case status:",
        existingCase.status,
      );

      // 현장정보제출 상태만 보고서 승인 가능 (이메일 전송 후 상태)
      if (existingCase.status !== "현장정보제출") {
        console.log(
          "[APPROVE-REPORT] Status check failed - current status:",
          existingCase.status,
        );
        return res.status(400).json({
          error: "현장정보제출 상태인 보고서만 승인할 수 있습니다",
        });
      }

      // 보고서 승인 처리
      console.log("[APPROVE-REPORT] Calling storage.approveReport...");
      const updatedCase = await storage.approveReport(
        caseId,
        decision,
        approvalComment || null,
        req.session.userId,
      );

      if (!updatedCase) {
        console.log("[APPROVE-REPORT] approveReport returned null");
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      console.log("[APPROVE-REPORT] Success - new status:", updatedCase.status);
      res.json({ success: true, case: updatedCase });
    } catch (error) {
      console.error("Approve report error:", error);
      res.status(500).json({ error: "보고서 승인 중 오류가 발생했습니다" });
    }
  });

  // Update case field survey endpoint (협력사: 언제든지, 관리자: 제출 후에만)
  app.patch("/api/cases/:caseId/field-survey", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    const { caseId } = req.params;

    // 협력사: 언제든지 수정 가능
    // 관리자: 협력사가 제출(submitted) 후에만 수정 가능
    if (userRole !== "협력사" && userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "협력사 또는 관리자 권한이 필요합니다" });
    }

    // 관리자인 경우, 케이스가 제출된 상태인지 확인
    if (userRole === "관리자") {
      const existingCase = await storage.getCaseById(caseId);
      if (!existingCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }
      if (existingCase.fieldSurveyStatus !== "submitted") {
        return res.status(403).json({
          error: "협력사가 보고서를 제출한 후에만 수정할 수 있습니다",
        });
      }
    }

    try {
      // Validate field data with Zod
      const updateSchema = z.object({
        visitDate: z.string().nullable().optional(),
        visitTime: z.string().nullable().optional(),
        travelDistance: z.string().nullable().optional(),
        dispatchLocation: z.string().nullable().optional(),
        accompaniedPerson: z.string().nullable().optional(),
        accidentDate: z.string().nullable().optional(),
        accidentTime: z.string().nullable().optional(),
        accidentCategory: z.string().nullable().optional(),
        accidentCause: z.string().nullable().optional(),
        specialNotes: z.string().nullable().optional(),
        vocContent: z.string().nullable().optional(), // VOC(고객의 소리) - 협력사 특이사항과 분리
        victimName: z.string().nullable().optional(),
        victimContact: z.string().nullable().optional(),
        victimAddress: z.string().nullable().optional(),
        victimAddressDetail: z.string().nullable().optional(),
        additionalVictims: z.string().nullable().optional(),
        specialRequests: z.string().nullable().optional(),
        processingTypes: z.string().nullable().optional(),
        processingTypeOther: z.string().nullable().optional(),
        recoveryMethodType: z.string().nullable().optional(),
        fieldSurveyStatus: z.string().nullable().optional(),
        status: z.string().nullable().optional(), // 케이스 상태 자동 변경용
      });

      const fieldData = updateSchema.parse(req.body);

      // 관리자인 경우 status, fieldSurveyStatus 변경 무시 (기존 상태 유지)
      // 협력사만 현장입력 저장 시 status, fieldSurveyStatus 변경 가능
      if (userRole === "관리자") {
        delete (fieldData as any).status;
        delete (fieldData as any).fieldSurveyStatus;
        console.log(
          `[Field Survey] Admin user - status and fieldSurveyStatus fields ignored to preserve existing state`,
        );
      }

      const updatedCase = await storage.updateCaseFieldSurvey(
        caseId,
        fieldData,
      );

      if (!updatedCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // Sync field survey data to related cases (same accident number, different receipt)
      // Create a new object excluding status fields and victim info - each case has its own victim
      const {
        status,
        fieldSurveyStatus,
        victimName,
        victimContact,
        victimAddress,
        victimAddressDetail,
        additionalVictims,
        ...syncData
      } = fieldData;

      let syncedCount = 0;
      try {
        syncedCount = await storage.syncFieldSurveyToRelatedCases(
          caseId,
          syncData,
        );
      } catch (syncError) {
        console.error("Sync to related cases failed:", syncError);
        // Don't fail the request if sync fails
      }

      res.json({
        success: true,
        case: updatedCase,
        syncedCases: syncedCount,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Update case field survey error:", error);
      res
        .status(500)
        .json({ error: "현장조사 정보 저장 중 오류가 발생했습니다" });
    }
  });

  // Get partner statistics endpoint
  app.get("/api/partner-stats", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const stats = await storage.getPartnerStats();
      res.json(stats);
    } catch (error) {
      console.error("Get partner stats error:", error);
      res
        .status(500)
        .json({ error: "협력사 통계를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Create progress update endpoint
  app.post("/api/progress-updates", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const validatedData = insertProgressUpdateSchema.parse({
        ...req.body,
        createdBy: req.session.userId,
      });

      const newUpdate = await storage.createProgressUpdate(validatedData);
      res.status(201).json({ success: true, update: newUpdate });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create progress update error:", error);
      res
        .status(500)
        .json({ error: "진행상황 업데이트 생성 중 오류가 발생했습니다" });
    }
  });

  // Get progress updates by case ID endpoint
  app.get("/api/progress-updates/:caseId", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const updates = await storage.getProgressUpdatesByCaseId(
        req.params.caseId,
      );
      res.json(updates);
    } catch (error) {
      console.error("Get progress updates error:", error);
      res
        .status(500)
        .json({ error: "진행상황 업데이트를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get statistics filters endpoint
  app.get("/api/statistics/filters", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const filters = await storage.getStatisticsFilters();
      res.json(filters);
    } catch (error) {
      console.error("Get statistics filters error:", error);
      res
        .status(500)
        .json({ error: "필터 데이터를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get filtered cases for statistics endpoint (with role-based filtering)
  app.get("/api/statistics/cases", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Get current user for permission-based filtering
      const currentUser = await storage.getUser(req.session.userId);

      if (!currentUser) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      // Get cases filtered by user role and permissions
      const allCases = await storage.getAllCases(currentUser);
      res.json(allCases);
    } catch (error) {
      console.error("Get statistics cases error:", error);
      res
        .status(500)
        .json({ error: "통계 데이터를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get all role permissions endpoint (admin only)
  app.get("/api/role-permissions", async (req, res) => {
    console.log("[GET /api/role-permissions] Request received, session:", {
      userId: req.session?.userId,
      userRole: req.session?.userRole,
    });

    // Check authentication
    if (!req.session?.userId) {
      console.log("[GET /api/role-permissions] 401: Not authenticated");
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check admin authorization - only super admin can access
    if (req.session.userRole !== "관리자") {
      console.log(
        "[GET /api/role-permissions] 403: Not admin, role is:",
        req.session.userRole,
      );
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    // Check super admin
    const reqUser = await storage.getUser(req.session.userId);
    if (!reqUser?.isSuperAdmin) {
      return res.status(403).json({ error: "최고관리자 권한이 필요합니다" });
    }

    try {
      const permissions = await storage.getAllRolePermissions();
      console.log(
        "[GET /api/role-permissions] Success, returning",
        permissions.length,
        "permissions",
      );
      res.json(permissions);
    } catch (error) {
      console.error("Get role permissions error:", error);
      res
        .status(500)
        .json({ error: "권한 정보를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get role permission by role name endpoint (admin only)
  app.get("/api/role-permissions/:roleName", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사 ��자입니다" });
    }

    // Check admin authorization
    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const permission = await storage.getRolePermission(req.params.roleName);
      if (!permission) {
        return res.status(404).json({ error: "권한 정보를 찾을 수 없습니다" });
      }
      res.json(permission);
    } catch (error) {
      console.error("Get role permission error:", error);
      res
        .status(500)
        .json({ error: "권한 정보를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get current user's permissions endpoint (all authenticated users)
  app.get("/api/my-permissions", async (req, res) => {
    // Check authentication
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Get user's role from session
    const userRole = req.session.userRole;
    const userId = req.session.userId;
    console.log("[MY-PERMISSIONS] Request:", { userId, userRole });

    if (!userRole) {
      return res
        .status(400)
        .json({ error: "사용자 역할 정보를 찾을 수 없습니다" });
    }

    try {
      // For admin users, check for individual admin permissions first
      if (userRole === "관리자") {
        const individualKey = `관리자_${userId}`;
        const individualPermission =
          await storage.getRolePermission(individualKey);
        console.log("[MY-PERMISSIONS] Individual check:", {
          individualKey,
          found: !!individualPermission,
        });
        if (individualPermission) {
          return res.json(individualPermission);
        }
      }

      // Fall back to role-based permissions
      const permission = await storage.getRolePermission(userRole);

      if (!permission) {
        // If no permissions set for this role, return empty permissions
        return res.json(null);
      }
      res.json(permission);
    } catch (error) {
      console.error("Get my permissions error:", error);
      res
        .status(500)
        .json({ error: "권한 정보를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Save role permission endpoint (admin only)
  app.post("/api/role-permissions", async (req, res) => {
    console.log(
      "[POST /api/role-permissions] Request received, session:",
      {
        userId: req.session?.userId,
        userRole: req.session?.userRole,
      },
      "body:",
      req.body,
    );

    // Check authentication
    if (!req.session?.userId) {
      console.log("[POST /api/role-permissions] 401: Not authenticated");
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check admin authorization
    if (req.session.userRole !== "관리자") {
      console.log(
        "[POST /api/role-permissions] 403: Not admin, role is:",
        req.session.userRole,
      );
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    // Check super admin
    const postReqUser = await storage.getUser(req.session.userId);
    if (!postReqUser?.isSuperAdmin) {
      return res.status(403).json({ error: "최고관리자 권한이 필요합니다" });
    }

    try {
      const validatedData = insertRolePermissionSchema.parse(req.body);
      const permission = await storage.saveRolePermission(validatedData);
      console.log(
        "[POST /api/role-permissions] Success, saved permission for role:",
        validatedData.roleName,
      );

      res.json(permission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.log(
          "[POST /api/role-permissions] 400: Validation error:",
          error.errors,
        );
        return res.status(400).json({ error: error.errors });
      }
      console.error("Save role permission error:", error);
      res
        .status(500)
        .json({ error: "권한 정보를 저장하는 중 오류가 발생했습니다" });
    }
  });

  // Delete role permission endpoint (admin only)
  app.delete("/api/role-permissions/:roleName", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    // Check super admin
    const delReqUser = await storage.getUser(req.session.userId);
    if (!delReqUser?.isSuperAdmin) {
      return res.status(403).json({ error: "최고관리자 권한이 필요합니다" });
    }

    try {
      const { roleName } = req.params;
      const deleted = await storage.deleteRolePermission(roleName);
      if (deleted) {
        console.log(
          "[DELETE /api/role-permissions] Deleted permission for role:",
          roleName,
        );
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "권한을 찾을 수 없습니다" });
      }
    } catch (error) {
      console.error("Delete role permission error:", error);
      res.status(500).json({ error: "권한 삭제 중 오류가 발생했습니다" });
    }
  });

  // Excel Data APIs (노무비/자재비)
  // Get latest version for a type (backward compatibility - original behavior)
  app.get("/api/excel-data/:type", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { type } = req.params;
      if (type !== "노무비" && type !== "자재비" && type !== "일위대가") {
        return res.status(400).json({ error: "잘못된 데이터 타입입니다" });
      }

      const data = await storage.getExcelData(type);
      res.json(data);
    } catch (error) {
      console.error("Get excel data error:", error);
      res
        .status(500)
        .json({ error: "데이터를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get list of all versions for a type (new endpoint for version management)
  app.get("/api/excel-data/:type/versions", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { type } = req.params;
      if (type !== "노무비" && type !== "자재비" && type !== "일위대가") {
        return res.status(400).json({ error: "잘못된 데이터 타입입니다" });
      }

      const dataList = await storage.listExcelData(type);
      res.json(dataList);
    } catch (error) {
      console.error("List excel data versions error:", error);
      res
        .status(500)
        .json({ error: "데이터를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get specific version by ID
  app.get("/api/excel-data/detail/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { id } = req.params;
      const data = await storage.getExcelDataById(id);

      if (!data) {
        return res.status(404).json({ error: "데이터를 찾을 수 없습니다" });
      }

      res.json(data);
    } catch (error) {
      console.error("Get excel data by ID error:", error);
      res
        .status(500)
        .json({ error: "데이터를 조회하는 중 오류가 발생했습니다" });
    }
  });

  app.post("/api/excel-data", async (req, res) => {
    console.log("[Excel Upload] POST /api/excel-data called");

    if (!req.session?.userId) {
      console.log("[Excel Upload] Error: 인증되지 않은 사용자");
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      console.log("[Excel Upload] Error: 관리자 권한 필요");
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      console.log("[Excel Upload] Request body:", {
        type: req.body?.type,
        title: req.body?.title,
        headersCount: req.body?.headers?.length,
        dataRowsCount: req.body?.data?.length,
      });

      const validatedData = insertExcelDataSchema.parse(req.body);
      const result = await storage.saveExcelData(validatedData);

      console.log("[Excel Upload] Success! Saved with ID:", result.id);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.log("[Excel Upload] Validation error:", error.errors);
        return res.status(400).json({ error: error.errors });
      }
      // Handle unique constraint violation (Postgres error code 23505)
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        console.log("[Excel Upload] Error: 동일한 제목 존재");
        return res.status(409).json({
          error:
            "동일한 제목의 데이터가 이미 존재합니다. 다른 제목을 사용해주세요.",
        });
      }
      console.error("[Excel Upload] Save excel data error:", error);
      res
        .status(500)
        .json({ error: "데이터를 저장하는 중 오류가 발생했습니다" });
    }
  });

  // Re-parse headers for existing data (one-time fix)
  app.patch("/api/excel-data/:id/reparse-headers", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { id } = req.params;
      const existing = await storage.getExcelDataById(id);

      if (!existing) {
        return res.status(404).json({ error: "데이터를 찾을 수 없습니다" });
      }

      // Combine current headers and data to re-detect the correct header row
      const allRows = [existing.headers, ...existing.data];

      // Find header row: look for row containing both "공종" and "공사명"
      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(allRows.length, 10); i++) {
        const row = allRows[i] as any[];
        if (!row) continue;
        const rowStr = row.map((c: any) => c?.toString() || "").join("|");
        if (rowStr.includes("공종") && rowStr.includes("공사명")) {
          headerRowIdx = i;
          console.log("[Reparse] Found header row at index:", i, "Row:", row);
          break;
        }
      }

      const newHeaders = (allRows[headerRowIdx] as any[]).map(
        (h: any) => h?.toString() || "",
      );
      const newData = allRows.slice(headerRowIdx + 1);

      console.log("[Reparse] Original headers:", existing.headers);
      console.log("[Reparse] New headers:", newHeaders);
      console.log("[Reparse] New data rows:", newData.length);

      const updated = await storage.updateExcelData(id, newHeaders, newData);
      res.json(updated);
    } catch (error) {
      console.error("Reparse headers error:", error);
      res.status(500).json({ error: "헤더 재인식 중 오류가 발생했습니다" });
    }
  });

  // Delete all versions by type (original behavior - backward compatibility)
  app.delete("/api/excel-data/:type", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { type } = req.params;
      if (type !== "노무비" && type !== "자재비" && type !== "일위대가") {
        return res.status(400).json({ error: "잘못된 데이터 타입입니다" });
      }

      await storage.deleteExcelData(type);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete excel data error:", error);
      res
        .status(500)
        .json({ error: "데이터를 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // Delete specific version by ID (new endpoint for version management)
  app.delete("/api/excel-data/id/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { id } = req.params;

      const deleted = await storage.deleteExcelDataById(id);
      if (!deleted) {
        return res.status(404).json({ error: "데이터를 찾을 수 없습니다" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete excel data error:", error);
      res
        .status(500)
        .json({ error: "데이터를 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // Get all inquiries (admin) or user's inquiries (regular users)
  app.get("/api/inquiries", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      let inquiries;
      if (req.session.userRole === "관리자") {
        // Admin can see all inquiries
        inquiries = await storage.getAllInquiries();
      } else {
        // Regular users can only see their own inquiries
        inquiries = await storage.getInquiriesByUserId(req.session.userId);
      }
      res.json(inquiries);
    } catch (error) {
      console.error("Get inquiries error:", error);
      res
        .status(500)
        .json({ error: "문의 목록을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Create new inquiry
  app.post("/api/inquiries", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const validatedData = insertInquirySchema.parse({
        ...req.body,
        userId: req.session.userId, // Always use authenticated user's ID
      });
      const inquiry = await storage.createInquiry(validatedData);
      res.json(inquiry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create inquiry error:", error);
      res.status(500).json({ error: "문의를 등록하는 중 오류가 발생했습니다" });
    }
  });

  // Update inquiry (admin only - for responding)
  app.patch("/api/inquiries/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { id } = req.params;

      // Validate response content
      const validatedData = respondInquirySchema.parse(req.body);

      const updateData = {
        responseTitle: validatedData.responseTitle,
        response: validatedData.response,
        respondedBy: req.session.userId,
        respondedAt: new Date(),
        status: "완료",
      };

      const updated = await storage.updateInquiry(id, updateData);
      if (!updated) {
        return res.status(404).json({ error: "문의를 찾을 수 없습니다" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Update inquiry error:", error);
      res.status(500).json({ error: "문의를 수정하는 중 오류가 발생했습니다" });
    }
  });

  // Delete inquiry
  app.delete("/api/inquiries/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    if (req.session.userRole !== "관리자") {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    try {
      const { id } = req.params;
      await storage.deleteInquiry(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete inquiry error:", error);
      res.status(500).json({ error: "문의를 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // ==================== DRAWING ROUTES ====================

  // Save drawing (create or update)
  app.post("/api/drawings", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Extract drawingId if provided (for updates)
      const { drawingId, ...bodyData } = req.body;

      // Debug: Check if canvasImage is received
      console.log("[Drawing Save] canvasImage received:", {
        hasCanvasImage: !!bodyData.canvasImage,
        canvasImageLength: bodyData.canvasImage?.length || 0,
        canvasImagePreview: bodyData.canvasImage?.substring(0, 100) || "null",
      });

      // Validate the request data
      const validatedData = insertDrawingSchema.parse({
        ...bodyData,
        createdBy: req.session.userId,
      });

      // Verify the user has access to this case
      const requestedCase = await storage.getCaseById(validatedData.caseId);
      if (!requestedCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // Note: Additional permission checks could be added here based on user role
      // Currently relying on frontend filtering (field-management page shows only accessible cases)

      let drawing;

      // If drawingId is provided, update existing drawing
      if (drawingId) {
        const existing = await storage.getDrawing(drawingId);
        if (!existing) {
          return res.status(404).json({ error: "도면을 찾을 수 없습니다" });
        }
        // Verify case match (케이스 접근 권한은 이미 위에서 확인됨)
        if (existing.caseId !== validatedData.caseId) {
          return res.status(403).json({ error: "다른 케이스의 도면입니다" });
        }

        const updateData = {
          uploadedImages: validatedData.uploadedImages,
          rectangles: validatedData.rectangles,
          accidentAreas: validatedData.accidentAreas,
          leakMarkers: validatedData.leakMarkers,
          canvasImage: validatedData.canvasImage,
          // caseId is immutable - don't update it
        };
        drawing = await storage.updateDrawing(drawingId, updateData);
      } else {
        // Check if a drawing already exists for this case
        const existing = await storage.getDrawingByCaseId(validatedData.caseId);

        if (existing) {
          // Update existing drawing - 케이스 접근 권한이 있으면 수정 가능
          const updateData = {
            uploadedImages: validatedData.uploadedImages,
            rectangles: validatedData.rectangles,
            accidentAreas: validatedData.accidentAreas,
            leakMarkers: validatedData.leakMarkers,
            canvasImage: validatedData.canvasImage,
          };
          drawing = await storage.updateDrawing(existing.id, updateData);
        } else {
          // Create new drawing
          drawing = await storage.saveDrawing(validatedData);
        }
      }

      // 도면 자동 동기화 비활성화 - 각 케이스 개별 관리
      // Auto-sync drawing disabled - each case manages its own drawing

      res.json(drawing);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Save drawing error:", error);
      res.status(500).json({ error: "도면을 저장하는 중 오류가 발생했습니다" });
    }
  });

  // Get drawing by ID
  app.get("/api/drawings/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;
      const drawing = await storage.getDrawing(id);

      if (!drawing) {
        return res.status(404).json({ error: "도면을 찾을 수 없습니다" });
      }

      res.json(drawing);
    } catch (error) {
      console.error("Get drawing error:", error);
      res.status(500).json({ error: "도면을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get drawing by case ID
  app.get("/api/drawings/case/:caseId", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const drawing = await storage.getDrawingByCaseId(caseId);

      if (!drawing) {
        return res.status(404).json({ error: "도면을 찾을 수 없습니다" });
      }

      res.json(drawing);
    } catch (error) {
      console.error("Get drawing by case error:", error);
      res.status(500).json({ error: "도면을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get active case ID for current user
  app.get("/api/drawings/active-case-id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const activeCase = await storage.getOrCreateActiveCase(
        req.session.userId!,
      );
      res.json({ caseId: activeCase.id });
    } catch (error) {
      console.error("Get active case ID error:", error);
      res
        .status(500)
        .json({ error: "활성 케이스 ID를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // ===== Asset Cloning API (Copy from Related Cases) =====

  // Get related case with drawing (for cloning suggestion)
  app.get("/api/cases/:caseId/related-drawing", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const relatedCase = await storage.getRelatedCaseWithDrawing(caseId);

      if (!relatedCase) {
        return res.json({ hasRelatedDrawing: false });
      }

      res.json({
        hasRelatedDrawing: true,
        sourceCaseId: relatedCase.caseId,
        sourceCaseNumber: relatedCase.caseNumber,
      });
    } catch (error) {
      console.error("Get related drawing error:", error);
      res
        .status(500)
        .json({ error: "관련 도면을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get ALL related cases with drawings (for manual copy selection)
  app.get("/api/cases/:caseId/related-drawings", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const relatedCases = await storage.getAllRelatedCasesWithDrawings(caseId);
      res.json({ relatedCases });
    } catch (error) {
      console.error("Get all related drawings error:", error);
      res
        .status(500)
        .json({ error: "관련 도면 목록을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get prevention case (-0 case) status for approval button visibility
  app.get("/api/cases/:caseId/prevention-case-status", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const currentCase = await storage.getCaseById(caseId);

      if (!currentCase || !currentCase.caseNumber) {
        return res.json({ preventionCase: null });
      }

      // Extract prefix from current case number (e.g., "123-1" -> "123")
      const match = currentCase.caseNumber.match(/^(.+?)(?:-\d+)?$/);
      if (!match) {
        return res.json({ preventionCase: null });
      }

      const prefix = match[1];

      // Get the prevention case (-0 case)
      const preventionCase = await storage.getPreventionCaseByPrefix(prefix);

      if (!preventionCase) {
        return res.json({ preventionCase: null });
      }

      res.json({
        preventionCase: {
          id: preventionCase.id,
          caseNumber: preventionCase.caseNumber,
          status: preventionCase.status,
          fieldSurveyStatus: preventionCase.fieldSurveyStatus,
          reportApprovalDecision: preventionCase.reportApprovalDecision,
        },
      });
    } catch (error) {
      console.error("Get prevention case status error:", error);
      res.status(500).json({
        error: "손해방지 케이스 상태를 조회하는 중 오류가 발생했습니다",
      });
    }
  });

  // Clone drawing from related case
  app.post("/api/cases/:caseId/clone-drawing", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되��� 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const { sourceCaseId } = req.body;

      if (!sourceCaseId) {
        return res.status(400).json({ error: "소스 케이스 ID가 필요합니다" });
      }

      const clonedDrawing = await storage.cloneDrawingFromCase(
        sourceCaseId,
        caseId,
        req.session.userId!,
      );

      if (!clonedDrawing) {
        return res.status(404).json({ error: "소스 케이스에 도면이 없습니다" });
      }

      res.json({ success: true, drawing: clonedDrawing });
    } catch (error) {
      console.error("Clone drawing error:", error);
      res.status(500).json({ error: "도면을 복제하는 중 오류가 발생했습니다" });
    }
  });

  // Get related case with estimate (for cloning suggestion)
  app.get("/api/cases/:caseId/related-estimate", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const relatedCase = await storage.getRelatedCaseWithEstimate(caseId);

      if (!relatedCase) {
        return res.json({ hasRelatedEstimate: false });
      }

      res.json({
        hasRelatedEstimate: true,
        sourceCaseId: relatedCase.caseId,
        sourceCaseNumber: relatedCase.caseNumber,
      });
    } catch (error) {
      console.error("Get related estimate error:", error);
      res
        .status(500)
        .json({ error: "관련 견적서를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Clone estimate from related case
  app.post("/api/cases/:caseId/clone-estimate", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const { sourceCaseId } = req.body;

      if (!sourceCaseId) {
        return res.status(400).json({ error: "소스 케이스 ID가 필요합니다" });
      }

      const clonedEstimate = await storage.cloneEstimateFromCase(
        sourceCaseId,
        caseId,
        req.session.userId!,
      );

      if (!clonedEstimate) {
        return res
          .status(404)
          .json({ error: "소스 케이스에 견적서가 없습니다" });
      }

      res.json({ success: true, estimate: clonedEstimate });
    } catch (error) {
      console.error("Clone estimate error:", error);
      res
        .status(500)
        .json({ error: "견적서를 복제하는 중 오류가 발생했습니다" });
    }
  });

  // Get related case with documents (for cloning suggestion)
  app.get("/api/cases/:caseId/related-documents", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const relatedCase = await storage.getRelatedCaseWithDocuments(caseId);

      if (!relatedCase) {
        return res.json({ hasRelatedDocuments: false });
      }

      res.json({
        hasRelatedDocuments: true,
        sourceCaseId: relatedCase.caseId,
        sourceCaseNumber: relatedCase.caseNumber,
        documentCount: relatedCase.documentCount,
      });
    } catch (error) {
      console.error("Get related documents error:", error);
      res
        .status(500)
        .json({ error: "관련 증빙자료를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Clone documents from related case
  app.post("/api/cases/:caseId/clone-documents", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const { sourceCaseId } = req.body;

      if (!sourceCaseId) {
        return res.status(400).json({ error: "소스 케이스 ID가 필요합니다" });
      }

      const clonedDocuments = await storage.cloneDocumentsFromCase(
        sourceCaseId,
        caseId,
        req.session.userId!,
      );

      res.json({
        success: true,
        documents: clonedDocuments,
        count: clonedDocuments.length,
      });
    } catch (error) {
      console.error("Clone documents error:", error);
      res
        .status(500)
        .json({ error: "증빙자료를 복제하는 중 오류가 발생했습니다" });
    }
  });

  // ===== 증빙자료 Documents API =====

  // Upload document(s) to a case
  app.post("/api/documents", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const validatedData = insertCaseDocumentSchema.parse(req.body);
      const document = await storage.saveDocument(validatedData);

      // 청구자료 카테고리 목록
      const claimDocumentCategories = [
        "복구완료 및 위임장",
        "도급계약서",
        "부가세 청구자료",
      ];
      // 정산 관련 상태 목록 (이미 정산 프로세스에 있는 상태들)
      const settlementStatuses = ["청구", "입금완료", "부분입금", "부분지급", "지급완료", "정산완료"];

      // parentCategory 체크 - 프론트엔드에서 전송한 탭 정보 (스키마에서 검증됨)
      const parentCategory = validatedData.parentCategory;
      const isClaimTab = parentCategory === "청구자료";

      // 청구자료 탭에서 업로드하거나, 청구자료 카테고리 문서 제출 시 처리
      if (
        (isClaimTab ||
          claimDocumentCategories.includes(validatedData.category) ||
          validatedData.category === "청구") &&
        validatedData.caseId
      ) {
        // 현재 케이스 상태를 다시 조회 (동시성 문제 방지)
        const existingCase = await storage.getCaseById(validatedData.caseId);
        if (existingCase) {
          const updateData: Record<string, any> = {};
          const currentDate = new Date()
            .toLocaleString("en-CA", {
              timeZone: "Asia/Seoul",
            })
            .split(",")[0];

          // 상태가 아직 정산 관련 상태가 아닌 경우에만 '청구'로 변경
          // (이미 입금완료, 부분입금, 정산완료인 경우 상태를 되돌리지 않음)
          if (!settlementStatuses.includes(existingCase.status)) {
            updateData.status = "청구";
            updateData.claimDate = currentDate;
          }

          // 복구완료일이 없는 경우에만 설정
          if (!existingCase.constructionCompletionDate) {
            updateData.constructionCompletionDate = currentDate;
          }

          // 변경할 내용이 있는 경우에만 단일 업데이트 수행
          if (Object.keys(updateData).length > 0) {
            await storage.updateCase(validatedData.caseId, updateData);
          }
        }
      }

      // 문서 자동 동기화 비활성화 - 각 케이스 개별 관리
      // Auto-sync document disabled - each case manages its own documents

      res.json(document);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Upload document error:", error);
      res
        .status(500)
        .json({ error: "문서를 업로드하는 중 오류가 발생했습니다" });
    }
  });

  // Get all documents for a case
  app.get("/api/documents/case/:caseId", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;

      // Validate caseId format
      if (!caseId || caseId === "null" || caseId === "undefined") {
        console.error("Invalid caseId for documents:", caseId);
        return res.status(400).json({ error: "유효하지 않은 케이스 ID입니다" });
      }

      const documents = await storage.getDocumentsByCaseId(caseId);
      res.json(documents);
    } catch (error) {
      console.error("Get documents error:", error);
      console.error(
        "Get documents error details:",
        error instanceof Error ? error.message : String(error),
      );
      res.status(500).json({ error: "문서를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get document file data (lazy loading for large files)
  app.get("/api/documents/:id/data", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;

      if (!id || id === "null" || id === "undefined") {
        return res.status(400).json({ error: "유효하지 않은 문서 ID입니다" });
      }

      // Verify document exists and check authorization
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "문서를 찾을 수 없습니다" });
      }

      // Allow admins and assessors to access all documents, others only their own
      const userRole = req.session.userRole;
      const isPrivilegedRole = userRole === "관리자" || userRole === "심사사";

      if (!isPrivilegedRole && document.createdBy !== req.session.userId) {
        return res.status(403).json({ error: "권한이 없습니다" });
      }

      const fileData = await storage.getDocumentFileData(id);
      if (!fileData) {
        return res
          .status(404)
          .json({ error: "문서 데이터를 찾을 수 없습니다" });
      }

      res.json({ fileData });
    } catch (error) {
      console.error("Get document data error:", error);
      res
        .status(500)
        .json({ error: "문서 데이터를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Delete a document
  app.delete("/api/documents/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;

      // Verify existence
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "문서를 찾을 수 없습니다" });
      }

      // Allow admins and assessors to manage all documents, others only their own
      const userRole = req.session.userRole;
      const isPrivilegedRole = userRole === "관리자" || userRole === "심사사";

      if (!isPrivilegedRole && document.createdBy !== req.session.userId) {
        return res.status(403).json({ error: "권한이 없습니다" });
      }

      await storage.deleteDocument(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete document error:", error);
      res.status(500).json({ error: "문서를 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // Update document category
  app.patch("/api/documents/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;
      const { category } = req.body;

      if (!category) {
        return res.status(400).json({ error: "카테고리를 입력해주세요" });
      }

      // Verify existence
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "문서를 찾을 수 없습니다" });
      }

      // Allow admins and assessors to manage all documents, others only their own
      const userRole = req.session.userRole;
      const isPrivilegedRole = userRole === "관리자" || userRole === "심사사";

      if (!isPrivilegedRole && document.createdBy !== req.session.userId) {
        return res.status(403).json({ error: "권한이 없습니다" });
      }

      const updated = await storage.updateDocumentCategory(id, category);
      res.json(updated);
    } catch (error) {
      console.error("Update document category error:", error);
      res
        .status(500)
        .json({ error: "카테고리를 변경하는 중 오류가 발생했습니다" });
    }
  });

  // ===== Object Storage 기반 문서 업로드 API =====

  // Step 1: Presigned URL 발급만 (DB 저장 없음)
  app.post("/api/documents/presign", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // 요청 바디 크기 로그
      const contentLength = req.headers["content-length"];
      console.log(`[presign] Content-Length: ${contentLength} bytes`);

      const { caseId, fileName, fileType, fileSize } = req.body;

      // 파일 바이너리/base64가 포함되지 않았는지 확인
      if (req.body.fileData || req.body.data || req.body.base64) {
        console.error("[presign] ERROR: 파일 바이너리/base64가 요청에 포함됨!");
        return res
          .status(400)
          .json({ error: "presign 요청에는 파일 데이터를 포함하지 마세요" });
      }

      if (!caseId || !fileName || !fileType || !fileSize) {
        return res.status(400).json({
          error:
            "필수 필드가 누락되었습니다 (caseId, fileName, fileType, fileSize)",
        });
      }

      console.log(
        `[presign] Generating presigned URL for case ${caseId}, file: ${fileName}, size: ${fileSize}`,
      );

      // storageKey 생성: documents/{caseId}/{timestamp}_{uuid}_{fileName}
      const timestamp = Date.now();
      const uuid = crypto.randomUUID();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
      const storageKey = `documents/${caseId}/${timestamp}_${uuid}_${safeFileName}`;

      // PRIVATE_OBJECT_DIR에서 bucket 정보 추출
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateObjectDir) {
        console.error("[presign] PRIVATE_OBJECT_DIR not set");
        return res
          .status(500)
          .json({ error: "Object Storage가 설정되지 않았습니다" });
      }

      // Full path: /{bucket}/.../{storageKey}
      const fullPath = `${privateObjectDir}/${storageKey}`;
      const pathParts = fullPath.split("/").filter((p) => p);
      if (pathParts.length < 2) {
        return res.status(500).json({ error: "잘못된 스토리지 경로입니다" });
      }
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join("/");

      console.log(`[presign] Bucket: ${bucketName}, Object: ${objectName}`);

      // Presigned URL 발급 (15분 TTL)
      const uploadURL = await signObjectURL({
        bucketName,
        objectName,
        method: "PUT",
        ttlSec: 900,
      });

      console.log(
        `[presign] Generated presigned URL successfully for storageKey: ${storageKey}`,
      );

      // DB 저장 없이 presigned URL만 반환
      res.json({
        uploadURL,
        storageKey,
      });
    } catch (error: any) {
      console.error("[presign] Error occurred:");
      console.error("  message:", error.message);
      console.error("  stack:", error.stack);
      if (error.code) console.error("  code:", error.code);
      if (error.statusCode) console.error("  statusCode:", error.statusCode);
      if (error.response)
        console.error("  response:", JSON.stringify(error.response));
      res.status(500).json({
        error: "presigned URL 발급 중 오류가 발생했습니다",
        details: error.message,
      });
    }
  });

  // Step 2: 업로드 완료 후 DB에 저장
  app.post("/api/documents/upload-complete", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const {
        caseId,
        category,
        fileName,
        fileType,
        fileSize,
        storageKey,
        displayOrder,
        checksum,
      } = req.body;

      if (
        !caseId ||
        !category ||
        !fileName ||
        !fileType ||
        !fileSize ||
        !storageKey
      ) {
        return res.status(400).json({ error: "필수 필드가 누락되었습니다" });
      }

      console.log(
        `[upload-complete] Verifying and saving document for case ${caseId}, file: ${fileName}`,
      );

      // Object Storage에서 파일 존재 확인
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateObjectDir) {
        return res
          .status(500)
          .json({ error: "Object Storage가 설정되지 않았습니다" });
      }

      const fullPath = `${privateObjectDir}/${storageKey}`;
      const pathParts = fullPath.split("/").filter((p) => p);
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();

      if (!exists) {
        console.error(
          `[upload-complete] File not found in storage: ${storageKey}`,
        );
        return res.status(400).json({
          error:
            "업로드된 파일을 찾을 수 없습니다. 업로드가 실패했을 수 있습니다.",
        });
      }

      let finalFileSize = fileSize;
      let compressionInfo: {
        originalSize: number;
        compressedSize: number;
        ratio: number;
      } | null = null;

      // PDF 파일인 경우 압축 처리
      if (isPdfFile(fileType, fileName)) {
        console.log(`[upload-complete] PDF 파일 감지, 압축 시작: ${fileName}`);

        try {
          // 1. Object Storage에서 PDF 다운로드
          const [pdfBuffer] = await file.download();
          console.log(
            `[upload-complete] PDF 다운로드 완료: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`,
          );

          // 2. PDF 압축
          const compressionResult = await compressPdf(pdfBuffer);

          if (!compressionResult.success) {
            // 압축 실패 (용량 초과 등)
            console.error(
              `[upload-complete] PDF 압축 거부: ${compressionResult.error}`,
            );
            // 업로드된 파일 삭제
            await file.delete();
            return res.status(400).json({ error: compressionResult.error });
          }

          // 3. 압축된 파일로 교체 (원본과 다른 경우)
          if (
            compressionResult.compressedBuffer &&
            compressionResult.compressedSize !== compressionResult.originalSize
          ) {
            console.log(`[upload-complete] 압축된 PDF 업로드 중...`);
            await file.save(compressionResult.compressedBuffer, {
              contentType: "application/pdf",
            });
            finalFileSize = compressionResult.compressedSize!;
            compressionInfo = {
              originalSize: compressionResult.originalSize,
              compressedSize: compressionResult.compressedSize!,
              ratio: compressionResult.compressionRatio!,
            };
            console.log(
              `[upload-complete] PDF 압축 완료: ${(compressionResult.originalSize / 1024 / 1024).toFixed(2)}MB → ${(finalFileSize / 1024 / 1024).toFixed(2)}MB (${compressionResult.compressionRatio}%)`,
            );
          } else {
            console.log(`[upload-complete] PDF 압축 불필요 또는 효과 없음`);
          }
        } catch (compressError) {
          console.error(`[upload-complete] PDF 압축 중 오류:`, compressError);
          // 압축 오류 시 원본 파일 그대로 사용 (중단하지 않음)
        }
      }

      // DB에 문서 레코드 생성 (status: ready)
      const document = await storage.createPendingDocument({
        caseId,
        category,
        fileName,
        fileType,
        fileSize: finalFileSize,
        storageKey,
        displayOrder: displayOrder ?? 0,
        createdBy: req.session.userId!,
      });

      // status를 ready로 업데이트
      await storage.updateDocumentStatus(document.id, "ready", checksum);

      console.log(
        `[upload-complete] Document ${document.id} saved with status ready${compressionInfo ? ` (compressed: ${compressionInfo.ratio}%)` : ""}`,
      );

      res.json({
        success: true,
        documentId: document.id,
        document,
        compression: compressionInfo,
      });
    } catch (error: any) {
      console.error("[upload-complete] Error occurred:");
      console.error("  message:", error.message);
      console.error("  stack:", error.stack);
      if (error.code) console.error("  code:", error.code);
      res.status(500).json({
        error: "문서 저장 중 오류가 발생했습니다",
        details: error.message,
      });
    }
  });

  // Legacy: Request upload URL (하위 호환용)
  app.post("/api/documents/request-upload", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const contentLength = req.headers["content-length"];
      console.log(`[request-upload] Content-Length: ${contentLength} bytes`);

      const { caseId, category, fileName, fileType, fileSize, displayOrder } =
        req.body;

      if (!caseId || !category || !fileName || !fileType || !fileSize) {
        return res.status(400).json({
          error:
            "필수 필드가 누락되었습니다 (caseId, category, fileName, fileType, fileSize)",
        });
      }

      console.log(
        `[request-upload] Starting upload request for case ${caseId}, file: ${fileName}, size: ${fileSize}`,
      );

      // storageKey 생성: documents/{caseId}/{timestamp}_{uuid}_{fileName}
      const timestamp = Date.now();
      const uuid = crypto.randomUUID();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
      const storageKey = `documents/${caseId}/${timestamp}_${uuid}_${safeFileName}`;

      // PRIVATE_OBJECT_DIR에서 bucket 정보 추출
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateObjectDir) {
        console.error("[request-upload] PRIVATE_OBJECT_DIR not set");
        return res
          .status(500)
          .json({ error: "Object Storage가 설정되지 않았습니다" });
      }

      // Full path: /{bucket}/.../{storageKey}
      const fullPath = `${privateObjectDir}/${storageKey}`;
      const pathParts = fullPath.split("/").filter((p) => p);
      if (pathParts.length < 2) {
        return res.status(500).json({ error: "잘못된 스토리지 경로입니다" });
      }
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join("/");

      console.log(
        `[request-upload] Bucket: ${bucketName}, Object: ${objectName}`,
      );

      // Presigned URL 발급 (15분 TTL)
      const uploadURL = await signObjectURL({
        bucketName,
        objectName,
        method: "PUT",
        ttlSec: 900,
      });

      // DB에 pending 상태로 문서 레코드 생성
      const document = await storage.createPendingDocument({
        caseId,
        category,
        fileName,
        fileType,
        fileSize,
        storageKey,
        displayOrder: displayOrder ?? 0,
        createdBy: req.session.userId!,
      });

      console.log(
        `[request-upload] Created pending document ${document.id} with storageKey: ${storageKey}`,
      );

      res.json({
        documentId: document.id,
        uploadURL,
        storageKey,
      });
    } catch (error: any) {
      console.error("[request-upload] Error occurred:");
      console.error("  message:", error.message);
      console.error("  stack:", error.stack);
      if (error.code) console.error("  code:", error.code);
      if (error.statusCode) console.error("  statusCode:", error.statusCode);
      if (error.response)
        console.error("  response:", JSON.stringify(error.response));
      res.status(500).json({
        error: "업로드 URL 발급 중 오류가 발생했습니다",
        details: error.message,
      });
    }
  });

  // Complete upload (업로드 완료 검증 + status ready로 변경)
  app.post("/api/documents/complete-upload", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { documentId, checksum } = req.body;

      if (!documentId) {
        return res.status(400).json({ error: "documentId가 필요합니다" });
      }

      console.log(
        `[complete-upload] Completing upload for document ${documentId}`,
      );

      // 문서 조회
      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ error: "문서를 찾을 수 없습니다" });
      }

      if (!document.storageKey) {
        return res
          .status(400)
          .json({ error: "해당 문서는 Object Storage 업로드가 아닙니다" });
      }

      // Object Storage에서 파일 존재 확인
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateObjectDir) {
        return res
          .status(500)
          .json({ error: "Object Storage가 설정되지 않았습니다" });
      }

      const fullPath = `${privateObjectDir}/${document.storageKey}`;
      const pathParts = fullPath.split("/").filter((p) => p);
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();

      if (!exists) {
        console.error(
          `[complete-upload] File not found in storage: ${document.storageKey}`,
        );
        // 파일이 없으면 failed 상태로 업데이트
        await storage.updateDocumentStatus(documentId, "failed");
        return res
          .status(400)
          .json({ error: "업로드된 파일을 찾을 수 없습니다" });
      }

      // status를 ready로 업데이트
      const updatedDocument = await storage.updateDocumentStatus(
        documentId,
        "ready",
        checksum,
      );

      console.log(
        `[complete-upload] Document ${documentId} status updated to ready`,
      );

      res.json({
        success: true,
        document: updatedDocument,
      });
    } catch (error) {
      console.error("[complete-upload] Error:", error);
      res
        .status(500)
        .json({ error: "업로드 완료 처리 중 오류가 발생했습니다" });
    }
  });

  // Fail upload (업로드 실패 처리)
  app.post("/api/documents/fail-upload", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { documentId } = req.body;

      if (!documentId) {
        return res.status(400).json({ error: "documentId가 필요합니다" });
      }

      console.log(
        `[fail-upload] Marking upload as failed for document ${documentId}`,
      );

      // 문서 조회
      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ error: "문서를 찾을 수 없습니다" });
      }

      // status를 failed로 업데이트
      const updatedDocument = await storage.updateDocumentStatus(
        documentId,
        "failed",
      );

      console.log(
        `[fail-upload] Document ${documentId} status updated to failed`,
      );

      res.json({
        success: true,
        document: updatedDocument,
      });
    } catch (error) {
      console.error("[fail-upload] Error:", error);
      res
        .status(500)
        .json({ error: "업로드 실패 처리 중 오류가 발생했습니다" });
    }
  });

  // Get download URL (storageKey에서 다운로드 URL 생성)
  app.get("/api/documents/:id/download-url", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;

      if (!id || id === "null" || id === "undefined") {
        return res.status(400).json({ error: "유효하지 않은 문서 ID입니다" });
      }

      // 문서 조회
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "문서를 찾을 수 없습니다" });
      }

      // 권한 체크 (관리자/심사사 또는 본인만 접근 가능)
      const userRole = req.session.userRole;
      const isPrivilegedRole = userRole === "관리자" || userRole === "심사사";
      if (!isPrivilegedRole && document.createdBy !== req.session.userId) {
        return res.status(403).json({ error: "권한이 없습니다" });
      }

      // Object Storage 문서인지 확인
      if (!document.storageKey) {
        return res.status(400).json({
          error: "해당 문서는 Object Storage 문서가 아닙니다 (레거시 문서)",
        });
      }

      // status가 ready인지 확인
      if (document.status !== "ready") {
        return res.status(400).json({
          error: `문서가 준비되지 않았습니다 (현재 상태: ${document.status})`,
        });
      }

      console.log(`[download-url] Generating download URL for document ${id}`);

      // Download URL 생성 (1시간 TTL)
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateObjectDir) {
        return res
          .status(500)
          .json({ error: "Object Storage가 설정되지 않았습니다" });
      }

      const fullPath = `${privateObjectDir}/${document.storageKey}`;
      const pathParts = fullPath.split("/").filter((p) => p);
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join("/");

      const downloadURL = await signObjectURL({
        bucketName,
        objectName,
        method: "GET",
        ttlSec: 3600,
      });

      res.json({
        downloadURL,
        fileName: document.fileName,
        fileType: document.fileType,
        fileSize: document.fileSize,
      });
    } catch (error) {
      console.error("[download-url] Error:", error);
      res
        .status(500)
        .json({ error: "다운로드 URL 생성 중 오류가 발생했습니다" });
    }
  });

  // Get image from Object Storage (redirect to signed URL for direct browser access)
  app.get("/api/documents/:id/image", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { id } = req.params;

      if (!id || id === "null" || id === "undefined") {
        return res.status(400).json({ error: "유효하지 않은 문서 ID입니다" });
      }

      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "문서를 찾을 수 없습니다" });
      }

      // Object Storage 문서인 경우 signed URL로 리다이렉트
      if (document.storageKey && document.status === "ready") {
        const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
        if (!privateObjectDir) {
          return res
            .status(500)
            .json({ error: "Object Storage가 설정되지 않았습니다" });
        }

        const fullPath = `${privateObjectDir}/${document.storageKey}`;
        const pathParts = fullPath.split("/").filter((p) => p);
        const bucketName = pathParts[0];
        const objectName = pathParts.slice(1).join("/");

        const signedUrl = await signObjectURL({
          bucketName,
          objectName,
          method: "GET",
          ttlSec: 3600,
        });

        return res.redirect(signedUrl);
      }

      // 레거시 문서 (fileData base64)
      if (document.fileData) {
        const buffer = Buffer.from(document.fileData, "base64");
        res.set("Content-Type", document.fileType);
        res.set("Content-Length", buffer.length.toString());
        res.set("Cache-Control", "public, max-age=3600");
        return res.send(buffer);
      }

      return res
        .status(404)
        .json({ error: "이미지 데이터를 찾을 수 없습니다" });
    } catch (error) {
      console.error("[image] Error:", error);
      res.status(500).json({ error: "이미지 로드 중 오류가 발생o��습니다" });
    }
  });

  // Cases endpoints
  // Get assigned cases for current user
  app.get("/api/cases/assigned", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { search } = req.query;
      const currentUser = await storage.getUser(req.session.userId);

      if (!currentUser) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      const cases = await storage.getAssignedCasesForUser(
        currentUser,
        search as string,
      );

      // Return simplified case summary for picker
      const caseSummaries = cases.map((c) => {
        // 케이스 접미사에 따라 주소 결정: -0은 피보험자 주소, -1 이상은 피해자 주소
        const suffixMatch = (c.caseNumber || "").match(/-(\d+)$/);
        const suffix = suffixMatch ? parseInt(suffixMatch[1], 10) : 0;

        let fullAddress: string;
        if (suffix === 0) {
          // 손해방지(-0): 피보험자 주소 + 상세주소
          fullAddress =
            [c.insuredAddress, c.insuredAddressDetail]
              .filter(Boolean)
              .join(" ") || "-";
        } else {
          // 피해세대(-1, -2, ...): 피해자 주소 + 상세주소 (없으면 피보험자 주소로 대체)
          const victimAddr = [c.victimAddress, c.victimAddressDetail]
            .filter(Boolean)
            .join(" ");
          if (victimAddr) {
            fullAddress = victimAddr;
          } else {
            // 피해자 주소가 없으면 피보험자 주소로 대체
            fullAddress =
              [c.insuredAddress, c.insuredAddressDetail]
                .filter(Boolean)
                .join(" ") || "-";
          }
        }

        return {
          id: c.id,
          caseNumber: c.caseNumber,
          insuredName: c.insuredName,
          accidentLocation: fullAddress,
          insuranceCompany: c.insuranceCompany,
          status: c.status,
        };
      });

      res.json(caseSummaries);
    } catch (error) {
      console.error("Get assigned cases error:", error);
      res
        .status(500)
        .json({ error: "배정된 케이스를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Estimate endpoints
  // Create new estimate version
  app.post("/api/estimates/:caseId", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const {
        rows,
        laborCostData,
        materialCostData,
        totalAmount,
        vatIncluded,
      } = req.body;

      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: "견적 행 데이터가 필요합니다" });
      }

      // Verify case exists
      const existingCase = await storage.getCaseById(caseId);
      if (!existingCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // Validation schema for estimate row from UI
      const estimateRowSchema = z.object({
        category: z.string().min(1, "항소를 선택해주세요"),
        location: z.string().nullable().optional(),
        workType: z.string().nullable().optional(),
        workName: z.string().nullable().optional(),
        damageWidth: z.union([z.string(), z.number()]).nullable().optional(),
        damageHeight: z.union([z.string(), z.number()]).nullable().optional(),
        damageArea: z.union([z.string(), z.number()]).nullable().optional(),
        repairWidth: z.union([z.string(), z.number()]).nullable().optional(),
        repairHeight: z.union([z.string(), z.number()]).nullable().optional(),
        repairArea: z.union([z.string(), z.number()]).nullable().optional(),
        note: z.string().nullable().optional(),
      });

      // Validate and transform UI row data to DB format
      const dbRows = rows.map((row: any, index: number) => {
        // Validate row structure
        const validated = estimateRowSchema.parse(row);

        // Convert to DB format with safe parsing
        // For width/height: parse as float (m 단위)
        const toNumber = (
          val: string | number | null | undefined,
        ): number | null => {
          if (val === null || val === undefined || val === "" || val === "0")
            return null;
          const num = typeof val === "string" ? parseFloat(val) : val;
          return !isNaN(num) && num >= 0 ? num : null;
        };

        // For area: parse as float (m² 단위, 변환 없이 그대로 저장)
        const toArea = (
          val: string | number | null | undefined,
        ): number | null => {
          if (val === null || val === undefined || val === "" || val === "0")
            return null;
          const num = typeof val === "string" ? parseFloat(val) : val;
          if (isNaN(num) || num < 0) return null;
          // 이미 m² 단위이므로 변환 없이 그대로 저장
          return num;
        };

        // [B] 서버 로깅: request body 수신 직후
        if (index === 0) {
          console.log("========================================");
          console.log("[B] 서버: request body 수신 직후");
          console.log("케이스 ID:", caseId);
          console.log("Raw row from request:");
          console.log(
            "  repairWidth:",
            row.repairWidth,
            "타입:",
            typeof row.repairWidth,
          );
          console.log(
            "  repairHeight:",
            row.repairHeight,
            "타입:",
            typeof row.repairHeight,
          );
          console.log(
            "  repairArea:",
            row.repairArea,
            "타입:",
            typeof row.repairArea,
          );
          console.log(
            "  damageWidth:",
            row.damageWidth,
            "타입:",
            typeof row.damageWidth,
          );
          console.log(
            "  damageHeight:",
            row.damageHeight,
            "타입:",
            typeof row.damageHeight,
          );
          console.log(
            "  damageArea:",
            row.damageArea,
            "타입:",
            typeof row.damageArea,
          );
          console.log("Validated row:");
          console.log("  repairWidth:", validated.repairWidth);
          console.log("  repairHeight:", validated.repairHeight);
          console.log("  repairArea:", validated.repairArea);
          console.log("========================================");
        }

        const result = {
          category: validated.category,
          location: validated.location === "선택" ? null : validated.location,
          workType: validated.workType || null,
          workName: validated.workName === "선택" ? null : validated.workName,
          damageWidth: toNumber(validated.damageWidth),
          damageHeight: toNumber(validated.damageHeight),
          damageArea: toArea(validated.damageArea),
          repairWidth: toNumber(validated.repairWidth),
          repairHeight: toNumber(validated.repairHeight),
          repairArea: toArea(validated.repairArea),
          note: validated.note || null,
          rowOrder: index + 1, // Server assigns 1-based ordering
        };

        // 디버그: 변환 후 값 확인
        if (index === 0) {
          console.log("[Estimate Debug] After toNumber conversion:", {
            repairWidth: result.repairWidth,
            repairHeight: result.repairHeight,
            repairArea: result.repairArea,
          });
        }

        return result;
      });

      const result = await storage.createEstimateVersion(
        caseId,
        req.session.userId,
        dbRows,
        laborCostData || null,
        materialCostData || null,
        vatIncluded ?? true, // VAT 포함/별도 옵션
      );

      // 견적 총액을 케이스에 항상 업데이트 (최신 견적금액 유지)
      if (totalAmount !== undefined && totalAmount !== null) {
        await storage.updateCaseEstimateAmount(caseId, totalAmount.toString());
      }

      // 견적은 케이스별 개별 관리 - 동기화하지 않음
      // (접수정보, 현장입력만 동기화됨)

      res.json(result);
    } catch (error: any) {
      // Enhanced error logging for debugging production issues
      const errorDetails = {
        message: error?.message || "Unknown error",
        stack: error?.stack || "No stack trace",
        code: error?.code || "No error code",
        caseId: req.params.caseId,
        userId: req.session?.userId,
        rowCount: req.body?.rows?.length || 0,
        hasLaborData: !!req.body?.laborCostData,
        hasMaterialData: !!req.body?.materialCostData,
        timestamp: new Date().toISOString(),
      };
      console.error(
        "[Estimate Save Error]",
        JSON.stringify(errorDetails, null, 2),
      );

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "견적 데이터 형식이 올바르지 않습니다",
          details: error.errors,
          errorCode: "VALIDATION_ERROR",
        });
      }

      // Return more detailed error for debugging (excluding sensitive stack in response)
      res.status(500).json({
        error: "견적을 저장하는 중 오류가 발생했습니다",
        errorCode: error?.code || "UNKNOWN_ERROR",
        errorMessage: error?.message || "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Get latest estimate
  app.get("/api/estimates/:caseId/latest", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되  � 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const result = await storage.getLatestEstimate(caseId);

      if (!result) {
        // Return empty result instead of 404 for easier frontend handling
        return res.json({ estimate: null, rows: [] });
      }

      // [D] 서버 로깅: GET API 응답 직전 - 복구면적 데이터 확인
      if (result.rows && result.rows.length > 0) {
        console.log("========================================");
        console.log("[D] 서버: GET /api/estimates/:caseId/latest 응답 직전");
        console.log("케이스 ID:", caseId);
        console.log("첫 번째 행 DB에서 조회된 값:");
        console.log(
          "  repairWidth:",
          result.rows[0].repairWidth,
          "타입:",
          typeof result.rows[0].repairWidth,
        );
        console.log(
          "  repairHeight:",
          result.rows[0].repairHeight,
          "타입:",
          typeof result.rows[0].repairHeight,
        );
        console.log(
          "  repairArea:",
          result.rows[0].repairArea,
          "타입:",
          typeof result.rows[0].repairArea,
        );
        console.log("========================================");
      }

      res.json(result);
    } catch (error) {
      console.error("Get latest estimate error:", error);
      res.status(500).json({ error: "견적을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get latest estimates for multiple cases (batch)
  app.post("/api/estimates/batch/latest", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Validate input with Zod
      const batchEstimatesSchema = z.object({
        caseIds: z.array(z.string().min(1)).max(100), // Max 100 cases per request
      });

      const { caseIds } = batchEstimatesSchema.parse(req.body);

      // Fetch estimates for all cases in parallel
      const results = await Promise.all(
        caseIds.map(async (caseId) => {
          try {
            const result = await storage.getLatestEstimate(caseId);
            return {
              caseId,
              estimate: result?.estimate || null,
              rows: result?.rows || [],
            };
          } catch (error) {
            console.error(`Error fetching estimate for case ${caseId}:`, error);
            return {
              caseId,
              estimate: null,
              rows: [],
              error: "견적 조회 실패",
            };
          }
        }),
      );

      res.json(results);
    } catch (error) {
      console.error("Batch get estimates error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "요청 데이터 형식이 올바르지 않습니다",
          details: error.errors,
        });
      }
      res.status(500).json({ error: "견적을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get all estimate versions
  app.get("/api/estimates/:caseId/versions", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const versions = await storage.listEstimateVersions(caseId);
      res.json(versions);
    } catch (error) {
      console.error("List estimate versions error:", error);
      res
        .status(500)
        .json({ error: "견적 버전을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Get specific estimate version
  app.get("/api/estimates/:caseId/versions/:version", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId, version } = req.params;
      const versionNum = parseInt(version, 10);

      if (isNaN(versionNum)) {
        return res.status(400).json({ error: "유효하지 않은 버전 번호입니다" });
      }

      const result = await storage.getEstimateVersion(caseId, versionNum);

      if (!result) {
        return res.status(404).json({ error: "견적 버전을 찾을 수 없습니다" });
      }

      res.json(result);
    } catch (error) {
      console.error("Get estimate version error:", error);
      res
        .status(500)
        .json({ error: "견적 버전을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Master Data endpoints
  // Get master data (optionally filtered by category)
  // includeInactive=true for admin management view
  app.get("/api/master-data", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { category, includeInactive } = req.query;
      const includeAll = includeInactive === "true";
      const data = await storage.getMasterData(
        category as string | undefined,
        includeAll,
      );
      res.json(data);
    } catch (error) {
      console.error("Get master data error:", error);
      res
        .status(500)
        .json({ error: "기준정보를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Create new master data item (admin only)
  app.post("/api/master-data", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 기준정보를 추가할 수 있습니다" });
    }

    try {
      // Validate request body with Zod schema
      const validated = insertMasterDataSchema.parse(req.body);

      const created = await storage.createMasterData(validated);

      res.json(created);
    } catch (error) {
      console.error("Create master data error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "입력 데이터 형식이 올바르지 않습니다",
          details: error.errors,
        });
      }
      res
        .status(500)
        .json({ error: "기준정보를 추가하는 중 오류가 발생했습니다" });
    }
  });

  // Delete master data item (admin only, soft delete)
  app.delete("/api/master-data/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 기준정보를 삭제할 수 있습니다" });
    }

    try {
      const { id } = req.params;
      console.log("[Master Data DELETE] Deleting item:", id);
      await storage.deleteMasterData(id);
      console.log("[Master Data DELETE] Successfully deleted:", id);
      res.json({ success: true });
    } catch (error) {
      console.error("[Master Data DELETE] Error deleting:", error);
      res
        .status(500)
        .json({ error: "기준정보를 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // Update master data item (admin only)
  app.patch("/api/master-data/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 기준정보를 수정할 수 있습니다" });
    }

    try {
      const { id } = req.params;
      const { value, displayOrder, isActive, note } = req.body;

      const updated = await storage.updateMasterData(id, {
        value,
        displayOrder,
        isActive,
        note,
      });

      if (!updated) {
        return res.status(404).json({ error: "기준정보를 찾을 수 없습니다" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Update master data error:", error);

      // Handle unique constraint violation
      if (
        error?.code === "23505" ||
        error?.message?.includes("unique constraint")
      ) {
        return res.status(400).json({
          error: "동일한 값이 이미 존재합니다. 다른 값을 입력해주세요.",
        });
      }

      res
        .status(500)
        .json({ error: "기준정보를 수정하는 중 오류가 발생했습니다" });
    }
  });

  // Labor cost endpoints
  // Get all labor costs (with optional filters)
  app.get("/api/labor-costs", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { category, workName, detailWork } = req.query;
      const filters: {
        category?: string;
        workName?: string;
        detailWork?: string;
      } = {};

      if (typeof category === "string") filters.category = category;
      if (typeof workName === "string") filters.workName = workName;
      if (typeof detailWork === "string") filters.detailWork = detailWork;

      const data = await storage.getLaborCosts(
        Object.keys(filters).length > 0 ? filters : undefined,
      );
      res.json(data);
    } catch (error) {
      console.error("Get labor costs error:", error);
      res
        .status(500)
        .json({ error: "노무비를 조회하는 중 오류가 발생했습니다" });
    }
  });

  app.get("/api/labor-costs/options", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const options = await storage.getLaborCostOptions();
      res.json(options);
    } catch (error) {
      console.error("Get labor cost options error:", error);
      res
        .status(500)
        .json({ error: "노무비 옵션을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Labor catalog from excel_data
  // Get parsed labor cost catalog from excel_data (all authenticated users)
  app.get("/api/labor-catalog", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Get latest 노무비 data from excel_data table
      const excelDataList = await storage.listExcelData("노무비");

      if (!excelDataList || excelDataList.length === 0) {
        return res.json([]);
      }

      // Use the most recent entry
      const excelData = excelDataList[0];

      if (!excelData.data || !Array.isArray(excelData.data)) {
        return res.json([]);
      }

      const catalog: any[] = [];

      // Helper functions
      const safeString = (val: any): string => {
        if (val === null || val === undefined) return "";
        return String(val).trim();
      };

      const parsePrice = (val: any): number | null => {
        if (val === null || val === undefined || val === "") return null;
        if (typeof val === "number") return val;
        const cleaned = String(val).replace(/,/g, "").trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      };

      // Detect format by checking headers
      const headers = excelData.headers || [];
      const isNewFormat = headers.some(
        (h: string) => h && h.includes("노임항목"),
      );

      console.log("Labor catalog headers:", headers);
      console.log("Is new format:", isNewFormat);

      if (isNewFormat) {
        // NEW FORMAT: 공종, 공사명, 노임항목DB, 금액
        // Find column indices by header names with EXACT match priority
        // NOTE: Headers like '노임항목(공종에 종속)' contain '공종' substring, so use exact match first
        let categoryIdx = 0,
          workNameIdx = 1,
          laborItemIdx = 2,
          priceIdx = 3;

        // First pass: exact or near-exact matches (priority)
        headers.forEach((h: string, idx: number) => {
          const trimmed = (h || "").trim();
          // Exact match for 공종 (not substring match to avoid '노임항목(공종에 종속)')
          if (trimmed === "공종") categoryIdx = idx;
          // 노임항목 must be detected before checking for 공사명
          if (trimmed.includes("노임항목")) laborItemIdx = idx;
          // 금액 exact or near-exact
          if (trimmed.includes("금액")) priceIdx = idx;
        });

        // Second pass: 공사명 with more specific matching (exclude 노임항목 column)
        headers.forEach((h: string, idx: number) => {
          const trimmed = (h || "").trim();
          // 공사명 match (but not if already matched as 노임항목)
          if (
            (trimmed.includes("공사명") || trimmed.includes("품명")) &&
            idx !== laborItemIdx
          ) {
            workNameIdx = idx;
          }
        });

        console.log("NEW FORMAT column indices:", {
          categoryIdx,
          workNameIdx,
          laborItemIdx,
          priceIdx,
        });

        let prevCategory: string | null = null;
        let prevWorkName: string | null = null;

        for (let i = 0; i < excelData.data.length; i++) {
          const row = excelData.data[i];
          if (!row || row.length === 0) continue;

          const category: string =
            safeString(row[categoryIdx]) || prevCategory || "";
          const workName: string =
            safeString(row[workNameIdx]) || prevWorkName || "";
          const laborItem: string = safeString(row[laborItemIdx]);
          const price = parsePrice(row[priceIdx]);

          // Update forward-fill values
          if (safeString(row[categoryIdx])) prevCategory = category;
          if (safeString(row[workNameIdx])) prevWorkName = workName;

          // Skip rows without essential data
          if (!category || !laborItem) continue;

          catalog.push({
            공종: category,
            공사명: workName,
            세부공사: "노무비", // 새 형식은 모두 노무비로 간주
            세부항목: laborItem, // 노임항목DB 값
            단위: "인",
            단가_인: price,
            단가_천장: null,
            단가_벽체: null,
            단가_바닥: null,
            단가_길이: null,
          });
        }
      } else {
        // OLD FORMAT: 공종, 공사명(품d�d��), 세부공사, 세부항목, 인, 수량, 무게, 천장, 벽체, 바닥, 길이, 비고
        let prevCategory: string | null = null;
        let prevWorkName: string | null = null;
        let prevDetailWork: string | null = null;

        for (let i = 0; i < excelData.data.length; i++) {
          const row = excelData.data[i];
          if (!row || row.length === 0) continue;

          const category: string = safeString(row[0]) || prevCategory || "";
          const workName: string = safeString(row[1]) || prevWorkName || "";
          const detailWork: string = safeString(row[2]) || prevDetailWork || "";
          const detailItem: string = safeString(row[3]);

          // Column indices for old format
          const laborPrice = parsePrice(row[4]); // 인
          const ceilingPrice = parsePrice(row[7]); // 천장
          const wallPrice = parsePrice(row[8]); // 벽체
          const floorPrice = parsePrice(row[9]); // 바닥
          const lengthPrice = parsePrice(row[10]); // 길이

          // Update forward-fill values
          if (safeString(row[0])) prevCategory = category;
          if (safeString(row[1])) prevWorkName = workName;
          if (safeString(row[2])) prevDetailWork = detailWork;

          // Skip rows without enough data
          if (!category || !workName || !detailWork) continue;

          let unit = "m";
          if (detailWork === "노무비") {
            unit = "인";
          } else if (ceilingPrice || wallPrice || floorPrice) {
            unit = "㎡";
          } else if (lengthPrice) {
            unit = "m";
          }

          catalog.push({
            공종: category,
            공사명: workName,
            세부공사: detailWork,
            세부항목: detailItem,
            단위: unit,
            단가_인: laborPrice,
            단가_천장: ceilingPrice,
            단가_벽체: wallPrice,
            단가_바닥: floorPrice,
            단가_길이: lengthPrice,
          });

          // 피해철거공사 항목을 철거공사로 변환하여 추가 엔트리 생성
          // 예: 피해철거공사-피해철거-일위대가-석고보드 해체 → 철거공사-석고보드-일위대가-석고보드 해체
          if (
            category === "피해철거공사" &&
            detailWork === "일위대가" &&
            detailItem
          ) {
            // 세부항목에서 공사명 추출 (예: "석고보드 해체" → "석고보드")
            const extractedWorkName = detailItem
              .replace(/\s*(해체|철거)\s*$/g, "")
              .trim();
            if (extractedWorkName) {
              catalog.push({
                공종: "철거공사",
                공사명: extractedWorkName,
                세부공사: detailWork,
                세부항목: detailItem,
                단위: unit,
                단가_인: laborPrice,
                단가_천장: ceilingPrice,
                단가_벽체: wallPrice,
                단가_바닥: floorPrice,
                단가_길이: lengthPrice,
              });
            }
          }

          // 원인철거공사 항목도 철거공사로 변환
          if (
            category === "원인철거공사" &&
            detailWork === "일위대가" &&
            detailItem
          ) {
            const extractedWorkName = detailItem
              .replace(/\s*(해체|철거|및.*|\/.*)\s*$/g, "")
              .trim();
            if (extractedWorkName) {
              catalog.push({
                공종: "철거공사",
                공사명: extractedWorkName,
                세부공사: detailWork,
                세부항목: detailItem,
                단위: unit,
                단가_인: laborPrice,
                단가_천장: ceilingPrice,
                단가_벽체: wallPrice,
                단가_바닥: floorPrice,
                단가_길이: lengthPrice,
              });
            }
          }
        }
      }

      console.log("========== LABOR CATALOG DEBUG ==========");
      console.log("Parsed catalog items count:", catalog.length);
      // Debug: 첫 5개 항목 출력
      console.log("첫 5개 항목:", JSON.stringify(catalog.slice(0, 5), null, 2));

      // Debug: 모든 공종 목록 확인
      const allCategories = Array.from(
        new Set(catalog.map((item: any) => item.공종)),
      );
      console.log("전체 공종 목록:", allCategories);
      console.log("==========================================");

      res.json(catalog);
    } catch (error) {
      console.error("Get labor catalog error:", error);
      res
        .status(500)
        .json({ error: "노무비 카탈로그를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // 일위대가DB catalog endpoint - Query by 공종 + 공사명 to get all 노임항목 rows
  app.get("/api/ilwidaega-catalog", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Get latest 일위대가 data from excel_data table
      const excelDataList = await storage.listExcelData("일위대가");

      console.log(
        "[일위대가 API] 조회 결과:",
        excelDataList?.length || 0,
        "개",
      );

      if (!excelDataList || excelDataList.length === 0) {
        console.log("[일위대가 API] 일위대가 데이터 없음");
        return res.json([]);
      }

      // Use the most recent entry
      const excelData = excelDataList[0];
      console.log(
        "[일위대가 API] 사용할 데이터:",
        excelData.id,
        excelData.title,
      );

      if (!excelData.data || !Array.isArray(excelData.data)) {
        console.log("[일위대가 API] 데이터 배열 없음");
        return res.json([]);
      }

      console.log("[일위대가 API] 행 수:", excelData.data.length);

      // Helper functions
      const safeString = (val: any): string => {
        if (val === null || val === undefined) return "";
        return String(val).trim();
      };

      const parsePrice = (val: any): number | null => {
        if (val === null || val === undefined || val === "") return null;
        if (typeof val === "number") return val;
        const cleaned = String(val).replace(/,/g, "").trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      };

      const catalog: any[] = [];
      const headers = excelData.headers || [];

      // 일위대가 format: 공종, 공사명, 노임항목, 기준작업량(D), 노임단가(인당)(E), 일위대가(노임단가/기준작업량)
      // D = 기준작업량, E = 노임단가(인당)
      let categoryIdx = 0,
        workNameIdx = 1,
        laborItemIdx = 2;
      let standardWorkQuantityIdx = -1; // D: 기준작업량
      let laborUnitPriceIdx = -1; // E: 노임단가(인당)
      let ilwidaegaIdx = -1; // 일위대가 (참고용)

      // Find column indices by header names
      headers.forEach((h: string, idx: number) => {
        const trimmed = (h || "").trim();

        // 공종 - exact match only
        if (trimmed === "공종") categoryIdx = idx;

        // 공사명
        if (trimmed.includes("공사명") || trimmed.includes("품명"))
          workNameIdx = idx;

        // 노임항목
        if (trimmed.includes("노임항목") && !trimmed.includes("공종"))
          laborItemIdx = idx;

        // 기준작업량 (D) - must not contain 일위대가 or 노임단가
        if (
          trimmed.includes("기준작업량") &&
          !trimmed.includes("일위대가") &&
          !trimmed.includes("노임단가")
        ) {
          standardWorkQuantityIdx = idx;
        }

        // 노임단가(인당) (E) - the labor unit price per person
        // Must contain '노임단가' but NOT '일위대가'
        if (trimmed.includes("노임단가") && !trimmed.includes("일위대가")) {
          laborUnitPriceIdx = idx;
        }

        // 일위대가 - for reference (E/D)
        if (trimmed.includes("일위대가")) {
          ilwidaegaIdx = idx;
        }
      });

      console.log("일위대가 headers:", headers);
      console.log("일위대가 column indices:", {
        categoryIdx,
        workNameIdx,
        laborItemIdx,
        standardWorkQuantityIdx,
        laborUnitPriceIdx,
        ilwidaegaIdx,
      });

      let prevCategory: string | null = null;
      let prevWorkName: string | null = null;

      for (let i = 0; i < excelData.data.length; i++) {
        const row = excelData.data[i];
        if (!row || row.length === 0) continue;

        const category: string =
          safeString(row[categoryIdx]) || prevCategory || "";
        const workName: string =
          safeString(row[workNameIdx]) || prevWorkName || "";
        const laborItem: string = safeString(row[laborItemIdx]);

        // D = 기준작업량, E = 노임단가(인당)
        const D =
          standardWorkQuantityIdx >= 0
            ? parsePrice(row[standardWorkQuantityIdx])
            : null;
        const E =
          laborUnitPriceIdx >= 0 ? parsePrice(row[laborUnitPriceIdx]) : null;
        const ilwidaega =
          ilwidaegaIdx >= 0 ? parsePrice(row[ilwidaegaIdx]) : null;

        // Update forward-fill values
        if (safeString(row[categoryIdx])) prevCategory = category;
        if (safeString(row[workNameIdx])) prevWorkName = workName;

        // Skip rows without essential data
        if (!category || !laborItem) continue;

        // Skip header rows (rows where values look like header names)
        if (
          category === "공종" ||
          laborItem === "노임항목" ||
          laborItem.includes("노임항목")
        )
          continue;

        catalog.push({
          공종: category,
          공사명: workName,
          노임항목: laborItem,
          기준작업량: D, // D
          노임단가: E, // E (노임단가(인당))
          일위대가: ilwidaega, // 참고용 (E/D)
        });
      }

      // Remove duplicate entries (based on 공종+공사명+노임항목 combination)
      const seen = new Set<string>();
      const uniqueCatalog = catalog.filter((item) => {
        const key = `${item.공종}|${item.공사명}|${item.노임항목}`;
        if (seen.has(key)) {
          return false; // Duplicate
        }
        seen.add(key);
        return true;
      });

      console.log(
        "Parsed 일위대가 catalog items:",
        catalog.length,
        "→ 중복 제거 후:",
        uniqueCatalog.length,
      );

      res.json(uniqueCatalog);
    } catch (error) {
      console.error("Get 일위대가 catalog error:", error);
      res
        .status(500)
        .json({ error: "일위대가 카탈로그를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // 일위대가 기준작업량(D값) 오버라이드 관리 endpoints
  // Get all D value overrides
  app.get("/api/unit-price-overrides", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const overrides = await storage.getAllUnitPriceOverrides();
      res.json(overrides);
    } catch (error) {
      console.error("Get unit price overrides error:", error);
      res
        .status(500)
        .json({ error: "기준작업량 데이터를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Update or create a single D value override
  app.post("/api/unit-price-overrides", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 기준작업량을 수정할 수 있습니다" });
    }

    try {
      const { category, workName, laborItem, standardWorkQuantity } = req.body;

      if (!category || !laborItem || standardWorkQuantity === undefined) {
        return res.status(400).json({ error: "필수 필드가 누락되었습니다" });
      }

      // Validate standardWorkQuantity is a positive finite number
      const parsedValue = Number(standardWorkQuantity);
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return res
          .status(400)
          .json({ error: "기준작업량은 0보다 큰 숫자여야 합니다" });
      }

      const result = await storage.upsertUnitPriceOverride({
        category,
        workName: workName || "",
        laborItem,
        standardWorkQuantity: parsedValue,
      });

      res.json(result);
    } catch (error) {
      console.error("Update unit price override error:", error);
      res.status(500).json({ error: "기준작업량 저장 중 오류가 발생했습니다" });
    }
  });

  // Bulk update D value overrides
  app.post("/api/unit-price-overrides/bulk", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 기준작업량을 수정할 수 있습니다" });
    }

    try {
      const { items } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "업데이트할 항목이 없습니다" });
      }

      // Validate all items have valid standardWorkQuantity values before processing
      const validationErrors: string[] = [];
      const validatedItems = items
        .map((item: any, index: number) => {
          const parsedValue = Number(item.standardWorkQuantity);
          if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
            validationErrors.push(
              `[${index + 1}] ${item.category || "(없음)"} - ${item.laborItem || "(없음)"}: 기준작업량은 0보다 큰 숫자여야 합니다`,
            );
            return null;
          }
          return {
            category: item.category,
            workName: item.workName || "",
            laborItem: item.laborItem,
            standardWorkQuantity: parsedValue,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: "일부 항목의 기준작업량이 유효하지 않습니다",
          details: validationErrors,
        });
      }

      const results =
        await storage.bulkUpsertUnitPriceOverrides(validatedItems);

      res.json({ success: true, count: results.length });
    } catch (error) {
      console.error("Bulk update unit price overrides error:", error);
      res
        .status(500)
        .json({ error: "기준작업량 일괄 저장 중 오류가 발생했습니다" });
    }
  });

  // 자재비DB catalog endpoint - Query by 공사명 to get matching materials
  app.get("/api/materials-by-workname", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Get latest 자재비 data from excel_data table
      const excelDataList = await storage.listExcelData("자재비");

      if (!excelDataList || excelDataList.length === 0) {
        return res.json([]);
      }

      // Use the most recent entry
      const excelData = excelDataList[0];

      console.log("[자재비 API] Excel 데이터:", {
        id: excelData.id,
        title: excelData.title,
        headerType: typeof excelData.headers,
        headersRaw: JSON.stringify(excelData.headers),
        dataRows: excelData.data?.length || 0,
      });

      if (!excelData.data || !Array.isArray(excelData.data)) {
        return res.json([]);
      }

      // Helper functions
      const safeString = (val: any): string => {
        if (val === null || val === undefined) return "";
        return String(val).trim();
      };

      const parsePrice = (val: any): number | string | null => {
        if (val === null || val === undefined || val === "") return null;
        if (typeof val === "string" && val.trim() === "입력") return "입력";
        if (typeof val === "number") return val;
        const cleaned = String(val).replace(/,/g, "").trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      };

      const catalog: any[] = [];
      const headers = excelData.headers || [];

      // 자재비 format: 공종, 공사명, 자재항목(공사명에 종속), 단위, 단가
      console.log("[자재비 API] 헤더:", headers);
      let categoryIdx = 0,
        workNameIdx = 1,
        materialItemIdx = 2,
        unitIdx = 3,
        priceIdx = 4;

      // First pass: find 자재항목 column (to exclude it from 공사명 matching)
      headers.forEach((h: string, idx: number) => {
        if (!h) return;
        if (h.includes("자재항목") || h.includes("자재명"))
          materialItemIdx = idx;
      });

      // Second pass: find other columns (excluding 자재항목 from 공사명 match)
      headers.forEach((h: string, idx: number) => {
        if (!h) return;
        // 공종 (exact match or column name that is just "공종")
        if (h.trim() === "공종" || h.includes("공종명")) categoryIdx = idx;
        // 공사명 - but NOT if it's the 자재항목 column
        if (
          (h.includes("공사명") || h.includes("품명")) &&
          idx !== materialItemIdx &&
          !h.includes("자재")
        ) {
          workNameIdx = idx;
        }
        if (h.includes("단위")) unitIdx = idx;
        if (h.includes("금액") || h.includes("단가")) priceIdx = idx;
      });
      console.log("[자재비 API] 인덱스:", {
        categoryIdx,
        workNameIdx,
        materialItemIdx,
        unitIdx,
        priceIdx,
      });

      let prevCategory: string | null = null;
      let prevWorkName: string | null = null;

      for (let i = 0; i < excelData.data.length; i++) {
        const row = excelData.data[i];
        if (!row || row.length === 0) continue;

        const category: string =
          safeString(row[categoryIdx]) || prevCategory || "";
        const workName: string =
          safeString(row[workNameIdx]) || prevWorkName || "";
        const materialItem: string = safeString(row[materialItemIdx]); // 자재항목
        const unit: string = safeString(row[unitIdx]);
        const price = parsePrice(row[priceIdx]);

        // Update forward-fill values
        if (safeString(row[categoryIdx])) prevCategory = category;
        if (safeString(row[workNameIdx])) prevWorkName = workName;

        // Skip rows without essential data
        if (!category || !workName || !materialItem) continue;

        catalog.push({
          공종: category,
          공사명: workName,
          자재항목: materialItem,
          단위: unit,
          금액: price,
        });
      }

      console.log("Parsed 자재비 catalog items:", catalog.length);

      res.json(catalog);
    } catch (error) {
      console.error("Get 자재비 catalog error:", error);
      res
        .status(500)
        .json({ error: "자재비 카탈로그를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Materials (자재비) endpoints
  // Get materials catalog from excel_data (all authenticated users)
  app.get("/api/materials", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const catalog = await storage.getMaterialsCatalog();
      res.json(catalog);
    } catch (error) {
      console.error("Get materials catalog error:", error);
      res
        .status(500)
        .json({ error: "자재비 카탈로그를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Create new material (admin only)
  app.post("/api/materials", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 자재를 추가할 수 있습니다" });
    }

    try {
      const validated = insertMaterialSchema.parse(req.body);
      const created = await storage.createMaterial(validated);
      res.json(created);
    } catch (error) {
      console.error("Create material error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "입력 데이터 형식이 올바르지 않습니다",
          details: error.errors,
        });
      }
      res.status(500).json({ error: "자재를 추가하는 중 오류가 발생했습니다" });
    }
  });

  // Delete material (admin only)
  app.delete("/api/materials/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 자재를 삭제할 수 있습니다" });
    }

    try {
      const { id } = req.params;
      await storage.deleteMaterial(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete material error:", error);
      res.status(500).json({ error: "자재를 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // Create new labor cost item (admin only)
  app.post("/api/labor-costs", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 노무비를 추가할 수 있습니다" });
    }

    try {
      const validated = insertLaborCostSchema.parse(req.body);
      const created = await storage.createLaborCost(validated);
      res.json(created);
    } catch (error) {
      console.error("Create labor cost error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "입력 데이터 형식이 올바르지 않습니다",
          details: error.errors,
        });
      }
      res
        .status(500)
        .json({ error: "노무비를 추가하는 중 오류가 발생했습니다" });
    }
  });

  // Delete labor cost item (admin only)
  app.delete("/api/labor-costs/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const userRole = req.session.userRole;
    if (userRole !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 노무비를 삭제할 수 있습니다" });
    }

    try {
      const { id } = req.params;
      await storage.deleteLaborCost(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete labor cost error:", error);
      res
        .status(500)
        .json({ error: "노무비를 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // Get field survey report data (통합 조회)
  app.get("/api/field-surveys/:caseId/report", async (req, res) => {
    const requestPath = req.path;
    const queryString = JSON.stringify(req.query);
    const rawCaseId = req.params.caseId;

    // 디버깅 로그 - 요청 정보
    console.log(`[FieldSurveyReport] === REQUEST START ===`);
    console.log(`[FieldSurveyReport] Path: ${requestPath}`);
    console.log(`[FieldSurveyReport] Query: ${queryString}`);
    console.log(`[FieldSurveyReport] CaseId raw value: "${rawCaseId}"`);
    console.log(`[FieldSurveyReport] CaseId type: ${typeof rawCaseId}`);
    console.log(
      `[FieldSurveyReport] CaseId empty check: isEmpty=${!rawCaseId}, isNull=${rawCaseId === "null"}, isUndefined=${rawCaseId === "undefined"}`,
    );

    if (!req.session?.userId) {
      console.log(
        `[FieldSurveyReport] ERROR: Unauthorized - no session userId`,
      );
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;

      // Validate caseId format
      if (!caseId || caseId === "null" || caseId === "undefined") {
        console.error(
          `[FieldSurveyReport] ERROR: Invalid caseId format: "${caseId}"`,
        );
        return res.status(400).json({ error: "유효하지 않은 케이스 ID입니다" });
      }

      // 케이스 정보 조회
      console.log(
        `[FieldSurveyReport] Step 1: Fetching case data for caseId: ${caseId}`,
      );
      let caseData;
      try {
        caseData = await storage.getCaseById(caseId);
        console.log(
          `[FieldSurveyReport] Step 1 result: caseData ${caseData ? "FOUND" : "NOT FOUND"}`,
        );
        if (caseData) {
          console.log(
            `[FieldSurveyReport] Case caseNumber: ${caseData.caseNumber || "N/A"}`,
          );
        }
      } catch (caseError: any) {
        console.error(
          `[FieldSurveyReport] Step 1 ERROR: Failed to fetch case`,
          {
            message: caseError?.message,
            code: caseError?.code,
            detail: caseError?.detail,
          },
        );
        throw caseError;
      }

      if (!caseData) {
        console.log(
          `[FieldSurveyReport] ERROR: Case not found for caseId: ${caseId}`,
        );
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 심사사/조사사 이메일 자동 조회 (DB에 저장되지 않은 경우 users 테이블에서 찾기)
      const allUsers = await storage.getAllUsers();

      // 심사사 이메일이 없고 심사자 이름이 있으면 조회
      if (!caseData.assessorEmail && caseData.assessorTeam) {
        const assessorUser = allUsers.find(
          (u) => u.role === "심사사" && u.name === caseData.assessorTeam,
        );
        if (assessorUser?.email) {
          (caseData as any).assessorEmail = assessorUser.email;
          console.log(
            `[Report] Auto-populated assessorEmail: ${assessorUser.email} (from ${caseData.assessorTeam})`,
          );
        }
      }

      // 조사사 이메일이 없고 조사자 이름이 있으면 조회
      if (!caseData.investigatorEmail && caseData.investigatorTeamName) {
        const investigatorUser = allUsers.find(
          (u) =>
            u.role === "조사사" && u.name === caseData.investigatorTeamName,
        );
        if (investigatorUser?.email) {
          (caseData as any).investigatorEmail = investigatorUser.email;
          console.log(
            `[Report] Auto-populated investigatorEmail: ${investigatorUser.email} (from ${caseData.investigatorTeamName})`,
          );
        }
      }

      // 도면 조회
      console.log(
        `[FieldSurveyReport] Step 2: Fetching drawing for caseId: ${caseId}`,
      );
      let drawing = null;
      try {
        drawing = await storage.getDrawingByCaseId(caseId);
        console.log(
          `[FieldSurveyReport] Step 2 result: drawing ${drawing ? "FOUND" : "NOT FOUND"}`,
        );
      } catch (drawingError: any) {
        console.error(
          `[FieldSurveyReport] Step 2 ERROR: Failed to fetch drawing`,
          {
            message: drawingError?.message,
            code: drawingError?.code,
            detail: drawingError?.detail,
          },
        );
        // 도면 조회 실패해도 계속 진행
      }

      // 증빙자료 조회
      console.log(
        `[FieldSurveyReport] Step 3: Fetching documents for caseId: ${caseId}`,
      );
      let documents: any[] = [];
      try {
        documents = await storage.getDocumentsByCaseId(caseId);
        console.log(
          `[FieldSurveyReport] Step 3 result: documents count = ${documents?.length || 0}`,
        );
      } catch (docsError: any) {
        console.error(
          `[FieldSurveyReport] Step 3 ERROR: Failed to fetch documents`,
          {
            message: docsError?.message,
            code: docsError?.code,
            detail: docsError?.detail,
          },
        );
        // 문서 조회 실패해도 계속 진행
      }

      // 최신 견적 조회
      console.log(
        `[FieldSurveyReport] Step 4: Fetching estimate for caseId: ${caseId}`,
      );
      let estimateData = null;
      try {
        estimateData = await storage.getLatestEstimate(caseId);
        console.log(
          `[FieldSurveyReport] Step 4 result: estimate ${estimateData?.estimate ? "FOUND" : "NOT FOUND"}, rows count = ${estimateData?.rows?.length || 0}`,
        );
      } catch (estimateError: any) {
        console.error(
          `[FieldSurveyReport] Step 4 ERROR: Failed to fetch estimate`,
          {
            message: estimateError?.message,
            code: estimateError?.code,
            detail: estimateError?.detail,
          },
        );
        // 견적 조회 실패해도 계속 진행
      }

      // 손해방지 케이스 여부 (접수번호가 -0으로 끝나면 손해방지)
      const isLossPreventionCase = /-0$/.test(caseData.caseNumber || "");

      // 견적 완료 여부 체크
      // - 손해방지 케이스: 복구면적 산출표 없어도 노무비/자재비만 있으면 완료
      // - 피해복구 케이스: 복구면적 산출표 필수
      const hasRecoveryRows = !!(
        estimateData?.rows && estimateData.rows.length > 0
      );
      // laborCostData와 materialCostData는 이미 파싱된 객체일 수 있음
      let hasLaborCosts = false;
      let hasMaterialCosts = false;

      if (estimateData?.estimate?.laborCostData) {
        try {
          const data =
            typeof estimateData.estimate.laborCostData === "string"
              ? JSON.parse(estimateData.estimate.laborCostData)
              : estimateData.estimate.laborCostData;
          hasLaborCosts = Array.isArray(data) && data.length > 0;
        } catch {
          hasLaborCosts = false;
        }
      }

      if (estimateData?.estimate?.materialCostData) {
        try {
          const data =
            typeof estimateData.estimate.materialCostData === "string"
              ? JSON.parse(estimateData.estimate.materialCostData)
              : estimateData.estimate.materialCostData;
          hasMaterialCosts = Array.isArray(data) && data.length > 0;
        } catch {
          hasMaterialCosts = false;
        }
      }

      // 건축물대장 또는 등기부등본 첨부 여부 확인 (category 필드 사용)
      const hasBuildingLedger = documents.some(
        (doc: any) => doc.category === "건축물대장",
      );
      const hasPropertyRegistry = documents.some(
        (doc: any) => doc.category === "등기부등본",
      );

      // 미입력 항목 목록 생성
      const missingItems: string[] = [];

      // 현장조사 필수 항목 체크
      if (!caseData.visitDate) missingItems.push("방문일시");
      if (!caseData.visitTime && caseData.visitDate) {
      } // visitDate 없으면 방문일시로 통합
      if (!caseData.accidentCategory) missingItems.push("사고유형");

      // 도면 체크
      if (!drawing) missingItems.push("도면");

      // 증빙자료 체크 (건축물대장 또는 등기부등본 중 하나 필수)
      if (!hasBuildingLedger && !hasPropertyRegistry) {
        missingItems.push("건축물대장 또는 등기부등본");
      }

      // 견적서 체크
      if (isLossPreventionCase) {
        if (!hasLaborCosts && !hasMaterialCosts) {
          missingItems.push("노무비 또는 자재비");
        }
      } else {
        if (!hasRecoveryRows) {
          missingItems.push("복구면적 산출표");
        }
      }

      // 각 섹션 완료 여부 체크
      // 손해방지 케이스(-0): 건축물대장 또는 등기부등본 중 하나 필수 (주민등록등본은 선택)
      // 피해세대 복구건(-1,-2 등): 건축물대장 또는 등기부등본 중 하나 필수
      const completionStatus = {
        fieldSurvey: !!(
          caseData.visitDate &&
          caseData.visitTime &&
          caseData.accidentCategory
        ),
        drawing: !!drawing,
        documents: hasBuildingLedger || hasPropertyRegistry,
        // 손해방지 케이스: 노무비 또는 자재비만 있으면 완료
        // 피해복구 케이스: 복구면적 산출표 필수
        estimate: isLossPreventionCase
          ? hasLaborCosts || hasMaterialCosts
          : hasRecoveryRows,
        isComplete: false,
        missingItems, // 미입력 항목 목록 추가
      };

      // 전체 완료 여부 (기타사항은 optional이므로 제외)
      completionStatus.isComplete =
        completionStatus.fieldSurvey &&
        completionStatus.drawing &&
        completionStatus.documents &&
        completionStatus.estimate;

      // 디버그 로그
      console.log(`[Report completionStatus] Case: ${caseData.caseNumber}`, {
        isLossPreventionCase,
        fieldSurvey: completionStatus.fieldSurvey,
        drawing: completionStatus.drawing,
        documents: completionStatus.documents,
        estimate: completionStatus.estimate,
        isComplete: completionStatus.isComplete,
        details: {
          visitDate: caseData.visitDate,
          visitTime: caseData.visitTime,
          accidentCategory: caseData.accidentCategory,
          hasDrawing: !!drawing,
          docCount: documents.length,
          hasBuildingLedger,
          hasPropertyRegistry,
          hasLaborCosts,
          hasMaterialCosts,
          hasRecoveryRows,
        },
      });

      // 응답 데이터 shape 로그
      const responseShape = {
        hasCase: !!caseData,
        caseNumber: caseData?.caseNumber,
        hasDrawing: !!drawing,
        documentsCount: documents?.length || 0,
        hasEstimate: !!estimateData?.estimate,
        estimateRowsCount: estimateData?.rows?.length || 0,
        completionStatus,
      };
      console.log(
        `[FieldSurveyReport] === SUCCESS === Response shape:`,
        responseShape,
      );

      // 통합된 보고서 데이터 반환
      res.json({
        case: caseData,
        drawing: drawing || null,
        documents: documents || [],
        estimate: estimateData || { estimate: null, rows: [] },
        completionStatus,
      });
    } catch (error: any) {
      // 상세 에러 로깅
      console.error(`[FieldSurveyReport] === FATAL ERROR ===`);
      console.error(
        `[FieldSurveyReport] Error message: ${error?.message || "Unknown error"}`,
      );
      console.error(
        `[FieldSurveyReport] Error stack: ${error?.stack || "No stack trace"}`,
      );
      console.error(
        `[FieldSurveyReport] DB error code: ${error?.code || "N/A"}`,
      );
      console.error(
        `[FieldSurveyReport] DB error detail: ${error?.detail || "N/A"}`,
      );
      console.error(`[FieldSurveyReport] Full error object:`, error);

      // 에러 타입에 따른 상태 코드 분리
      if (
        error?.code === "22P02" ||
        error?.message?.includes("invalid input syntax")
      ) {
        return res.status(400).json({
          error: "잘못된 케이스 ID 형식입니다",
          details: error?.message,
        });
      }

      if (error?.code === "42P01") {
        return res.status(500).json({
          error: "데이터베이스 테이블이 존재하지 않습니다",
          details: error?.message,
        });
      }

      res.status(500).json({
        error: "현장조사 보고서를 조회하는 중 오류가 발생했습니다",
        details: error?.message || "Unknown server error",
      });
    }
  });

  // Get dashboard statistics (권한별 필터링)
  app.get("/api/dashboard/stats", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      // Get current user for permission-based filtering
      const currentUser = await storage.getUser(req.session.userId);

      if (!currentUser) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      }

      // Get cases filtered by user role and permissions
      const filteredCases = await storage.getAllCases(currentUser);

      // Helper function to parse date from case
      const parseAccidentDate = (dateStr: string | null): Date | null => {
        if (!dateStr) return null;
        try {
          return new Date(dateStr);
        } catch {
          return null;
        }
      };

      // Calculate current month and last month ranges dynamically
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed

      // Calculate last month (handle year boundary)
      const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const lastYear = currentMonth === 1 ? currentYear - 1 : currentYear;

      // Filter cases for current month
      const currentMonthCases = filteredCases.filter((c) => {
        const accidentDate = parseAccidentDate(c.accidentDate);
        if (!accidentDate) return false;
        return (
          accidentDate.getFullYear() === currentYear &&
          accidentDate.getMonth() + 1 === currentMonth
        );
      });

      // Filter cases for last month
      const lastMonthCases = filteredCases.filter((c) => {
        const accidentDate = parseAccidentDate(c.accidentDate);
        if (!accidentDate) return false;
        return (
          accidentDate.getFullYear() === lastYear &&
          accidentDate.getMonth() + 1 === lastMonth
        );
      });

      // 작성중 제외한 활성 케이스 (프론트엔드 activeCases와 동일)
      const activeCases = filteredCases.filter(
        (c) => c.status !== "작성중",
      );
      const activeLastMonthCases = lastMonthCases.filter(
        (c) => c.status !== "작성중",
      );

      // 미결건 제외 상태 (청구자료제출 단계 이후 + 종결/취소)
      const pendingExcluded = [
        "청구자료제출(복구)",
        "출동비청구(선견적)",
        "청구",
        "입금완료",
        "부분입금",
        "부분지급",
        "지급완료",
        "정산완료",
        "접수취소",
        "종결",
        "취소",
      ];

      // 접수건: 활성 케이스 중 접수취소 제외
      const receivedCases = activeCases.filter(
        (c) => c.status !== "접수취소",
      ).length;
      const lastMonthReceivedCases = activeLastMonthCases.filter(
        (c) => c.status !== "접수취소",
      ).length;

      // 미결건: 정산/종결/취소 완료 상태가 아닌 건
      const pendingCases = activeCases.filter(
        (c) => !pendingExcluded.includes(c.status),
      ).length;
      const lastMonthPendingCases = activeLastMonthCases.filter(
        (c) => !pendingExcluded.includes(c.status),
      ).length;

      // Calculate changes
      const receivedCasesChangeCount = receivedCases - lastMonthReceivedCases;
      const receivedCasesChange =
        lastMonthReceivedCases > 0
          ? (receivedCasesChangeCount / lastMonthReceivedCases) * 100
          : 0;

      const pendingCasesChangeCount = pendingCases - lastMonthPendingCases;
      const pendingCasesChange =
        lastMonthPendingCases > 0
          ? (pendingCasesChangeCount / lastMonthPendingCases) * 100
          : 0;

      // Helper function to calculate estimate total from laborCostData and materialCostData
      const calculateEstimateTotal = (
        laborCostData: any,
        materialCostData: any,
      ): number => {
        let laborTotalWithExpense = 0;
        let laborTotalWithoutExpense = 0;
        let materialTotal = 0;

        // Calculate labor costs
        if (Array.isArray(laborCostData)) {
          laborCostData.forEach((row: any) => {
            const amount = row.amount || 0;
            if (row.includeInEstimate) {
              laborTotalWithExpense += amount;
            } else {
              laborTotalWithoutExpense += amount;
            }
          });
        }

        // Calculate material costs
        if (Array.isArray(materialCostData)) {
          materialCostData.forEach((row: any) => {
            materialTotal += row.금액 || 0;
          });
        }

        // 소계 (전체)
        const subtotal =
          laborTotalWithExpense + laborTotalWithoutExpense + materialTotal;

        // 일반관리비와 이윤 계산 대상 (경비 제외)
        const baseForFees = laborTotalWithoutExpense + materialTotal;

        // 일반관리비 (6%) - 경비 제외 항목에만 적용
        const managementFee = Math.round(baseForFees * 0.06);

        // 이윤 (15%) - 경비 제외 항목에만 적용
        const profit = Math.round(baseForFees * 0.15);

        // VAT 기준액 (소계 + 일반관리비 + 이윤)
        const vatBase = subtotal + managementFee + profit;

        // VAT (10%)
        const vat = Math.round(vatBase * 0.1);

        // 총 합계 (VAT 포함)
        const total = vatBase + vat;

        return total;
      };

      // Get estimates for all cases to calculate unsettled amounts
      const caseIds = activeCases.map((c) => c.id);
      const allEstimates =
        caseIds.length > 0
          ? await db
              .select()
              .from(estimates)
              .where(inArray(estimates.caseId, caseIds))
          : [];

      // Get latest estimate for each case
      const latestEstimatesByCaseId = new Map<string, any>();
      allEstimates.forEach((est) => {
        const existing = latestEstimatesByCaseId.get(est.caseId);
        if (!existing || est.version > existing.version) {
          latestEstimatesByCaseId.set(est.caseId, est);
        }
      });

      // 보험사 미정산: '청구' ~ '부분입금' 상태 건 (청구했지만 입금 최종액이 없는 건)
      const insuranceUnsettledCases = activeCases.filter(
        (c) => c.status === "청구" || c.status === "부분입금",
      );
      const insuranceUnsettledAmount = insuranceUnsettledCases.reduce(
        (sum, c) => {
          const estimate = latestEstimatesByCaseId.get(c.id);
          if (estimate) {
            const total = calculateEstimateTotal(
              estimate.laborCostData,
              estimate.materialCostData,
            );
            return sum + total;
          }
          return sum;
        },
        0,
      );

      // 협력사 미정산: 협력사에 일부 또는 최종 지급 중인 건 ('부분지급' + '지급완료')
      const partnerUnsettledCases = activeCases.filter(
        (c) => c.status === "부분지급" || c.status === "지급완료",
      );
      const partnerUnsettledAmount = partnerUnsettledCases.reduce((sum, c) => {
        const estimate = latestEstimatesByCaseId.get(c.id);
        if (estimate) {
          const total = calculateEstimateTotal(
            estimate.laborCostData,
            estimate.materialCostData,
          );
          return sum + total;
        }
        return sum;
      }, 0);

      const stats = {
        // 접수건: 이번달 케이스 수
        receivedCases,
        lastMonthReceivedCases,
        receivedCasesChange: Math.round(receivedCasesChange * 10) / 10, // 소수점 1자리
        receivedCasesChangeCount,

        // 미결건: status가 "제출", "검토중", "1차승인"인 케이스
        pendingCases,
        lastMonthPendingCases,
        pendingCasesChange: Math.round(pendingCasesChange * 10) / 10, // 소수점 1자리
        pendingCasesChangeCount,

        // 보험사 미정산: "청구" 상태인 케이스들의 견적 금액 합계
        insuranceUnsettledCases: insuranceUnsettledCases.length,
        insuranceUnsettledAmount: Math.round(insuranceUnsettledAmount),

        // 협력사 미정산: "완료" 또는 "청구" 상태인 케이스들의 견적 금액 합계
        partnerUnsettledCases: partnerUnsettledCases.length,
        partnerUnsettledAmount: Math.round(partnerUnsettledAmount),
      };

      res.json(stats);
    } catch (error) {
      console.error("Get dashboard stats error:", error);
      res.status(500).json({ error: "통계를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // 평균 수리비 항목별 통계 API
  app.get("/api/statistics/avg-repair-cost-by-category", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const startDateParam = req.query.startDate as string;
      const endDateParam = req.query.endDate as string;

      // 손해정지비용 공종
      const damagePreventionTypes = [
        "누수탐지비용",
        "배관공사",
        "방수공사",
        "코킹공사",
        "철거공사",
        "원인철거공사",
      ];
      // 대물수리비용 공종
      const propertyRepairTypes = [
        "가설공사",
        "목공사",
        "수장공사",
        "도장공사",
        "욕실공사",
        "타일공사",
        "가구공사",
        "전기공사",
        "피해철거공사",
        "기타공사",
      ];

      // 기간 필터링
      let caseFilter = sql`1=1`;
      if (startDateParam && endDateParam) {
        caseFilter = sql`${cases.createdAt} >= ${startDateParam} AND ${cases.createdAt} <= ${endDateParam}`;
      }

      // 완료된 직접복구 케이스 조회
      const completedCases = await db
        .select()
        .from(cases)
        .where(
          sql`(${cases.status} IN ('정산완료', '입금완료', '부분입금', '부분지급', '지급완료')) AND (${cases.recoveryType} = '직접복구' OR ${cases.status} = '직접복구')`,
        );

      if (!completedCases.length) {
        return res.json({
          손해정지비용: {
            누수탐지비: 0,
            배관공사: 0,
            방수공사: 0,
            코킹공사: 0,
            철거공사: 0,
            계: 0,
          },
          대물수리비용: {
            가설공사: 0,
            목공사: 0,
            수장공사: 0,
            도장공사: 0,
            욕실공사: 0,
            가구공사: 0,
            전기공사: 0,
            철거공사: 0,
            기타공사: 0,
            계: 0,
          },
          총계: 0,
          건수: 0,
        });
      }

      // 케이스별 최신 견적 조회
      const caseIds = completedCases.map((c) => c.id);
      const allEstimates = await db
        .select()
        .from(estimates)
        .where(inArray(estimates.caseId, caseIds));

      // 케이스별 최신 견적만 추출
      const latestEstimatesByCaseId = new Map<string, any>();
      allEstimates.forEach((est) => {
        const existing = latestEstimatesByCaseId.get(est.caseId);
        if (!existing || est.version > existing.version) {
          latestEstimatesByCaseId.set(est.caseId, est);
        }
      });

      // 공종별 합계 계산
      const damagePreventionTotals: Record<string, number> = {
        누수탐지비: 0,
        배관공사: 0,
        방수공사: 0,
        코킹공사: 0,
        철거공사: 0,
      };
      const propertyRepairTotals: Record<string, number> = {
        가설공사: 0,
        목공사: 0,
        수장공사: 0,
        도장공사: 0,
        욕실공사: 0,
        가구공사: 0,
        전기공사: 0,
        철거공사: 0,
        기타공사: 0,
      };

      let validCaseCount = 0;

      latestEstimatesByCaseId.forEach((estimate) => {
        if (!estimate.laborCostData || !Array.isArray(estimate.laborCostData))
          return;
        validCaseCount++;

        estimate.laborCostData.forEach((row: any) => {
          const category = row.category || "";
          const amount = row.amount || 0;

          // 손해정지비용 분류
          if (category === "누수탐지비용") {
            damagePreventionTotals["누수탐지비"] += amount;
          } else if (category === "배관공사") {
            damagePreventionTotals["배관공사"] += amount;
          } else if (category === "방수공사") {
            damagePreventionTotals["방수공사"] += amount;
          } else if (category === "코킹공사") {
            damagePreventionTotals["코킹공사"] += amount;
          } else if (
            category === "원인철거공사" ||
            (category.includes("철거") &&
              damagePreventionTypes.some((t) => t.includes(category)))
          ) {
            damagePreventionTotals["철거공사"] += amount;
          }

          // 대물수리비용 분류
          if (category === "가설공사") {
            propertyRepairTotals["가설공사"] += amount;
          } else if (category === "목공사") {
            propertyRepairTotals["목공사"] += amount;
          } else if (category === "수장공사") {
            propertyRepairTotals["수장공사"] += amount;
          } else if (category === "도장공사") {
            propertyRepairTotals["도장공사"] += amount;
          } else if (category === "욕실공사" || category === "타일공사") {
            propertyRepairTotals["욕실공사"] += amount;
          } else if (category === "가구공사") {
            propertyRepairTotals["가구공사"] += amount;
          } else if (category === "전기공사") {
            propertyRepairTotals["전기공사"] += amount;
          } else if (category === "피해철거공사") {
            propertyRepairTotals["철거공사"] += amount;
          } else if (
            category === "기타공사" &&
            !damagePreventionTypes.includes(category)
          ) {
            propertyRepairTotals["기타공사"] += amount;
          }
        });
      });

      // 평균 계산
      const avgDivisor = validCaseCount || 1;
      const avgDamagePrevention: Record<string, number> = {};
      Object.keys(damagePreventionTotals).forEach((key) => {
        avgDamagePrevention[key] = Math.round(
          damagePreventionTotals[key] / avgDivisor,
        );
      });
      avgDamagePrevention["계"] = Object.values(avgDamagePrevention).reduce(
        (a, b) => a + b,
        0,
      );

      const avgPropertyRepair: Record<string, number> = {};
      Object.keys(propertyRepairTotals).forEach((key) => {
        avgPropertyRepair[key] = Math.round(
          propertyRepairTotals[key] / avgDivisor,
        );
      });
      avgPropertyRepair["계"] = Object.values(avgPropertyRepair).reduce(
        (a, b) => a + b,
        0,
      );

      res.json({
        손해정지비용: avgDamagePrevention,
        대물수리비용: avgPropertyRepair,
        총계: avgDamagePrevention["계"] + avgPropertyRepair["계"],
        건수: validCaseCount,
      });
    } catch (error) {
      console.error("Get avg repair cost by category error:", error);
      res.status(500).json({
        error: "평균 수리비 항목별 통계를 조회하는 중 오류가 발생했습니다",
      });
    }
  });

  // 인보이스 발송 API
  app.post("/api/invoice/send", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const {
        caseId,
        relatedCaseIds,
        damagePreventionAmount,
        propertyRepairAmount,
        remarks,
      } = req.body;

      if (!caseId) {
        return res.status(400).json({ error: "케이스 ID가 필요합니다" });
      }

      // 입력값 검증
      const parsedDamagePreventionAmount =
        parseInt(damagePreventionAmount) || 0;
      const parsedPropertyRepairAmount = parseInt(propertyRepairAmount) || 0;

      // 케이스 정보 조회
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 관련 케이스들의 상태를 "청구"로 변경하고 인보이스 데이터 저장
      const caseIdsToUpdate =
        relatedCaseIds && relatedCaseIds.length > 0 ? relatedCaseIds : [caseId];

      // 청구일을 오늘 날짜로 설정 (KST)
      const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const claimDateStr = kstNow.toISOString().split("T")[0];

      for (const id of caseIdsToUpdate) {
        await storage.updateCase(id, {
          status: "청구",
          claimDate: claimDateStr, // 청구일 설정
          invoiceDamagePreventionAmount:
            parsedDamagePreventionAmount.toString(),
          invoicePropertyRepairAmount: parsedPropertyRepairAmount.toString(),
          invoiceRemarks: remarks || null,
        });

        // 진행상황 기록 추가 (금액 정보 포함)
        await storage.createProgressUpdate({
          caseId: id,
          content: `인보이스 발송 완료 - 청구 상태로 변경 (손해방지비용: ${parsedDamagePreventionAmount.toLocaleString()}원, 대물복구비용: ${parsedPropertyRepairAmount.toLocaleString()}원${remarks ? `, 비고: ${remarks}` : ""})`,
          createdBy: req.session.userId,
        });
      }

      // TODO: 실제 이메일 발송 로직 (SendGrid 등 연동 필요)
      // 현재는 상태만 변경하고 성공 응답 반환

      res.json({
        success: true,
        message: "인보이스가 발송되었습니다.",
        updatedCases: caseIdsToUpdate.length,
      });
    } catch (error) {
      console.error("Invoice send error:", error);
      res.status(500).json({ error: "인보이스 발송 중 오류가 발생했습니다" });
    }
  });

  // PDF 생성 기록 저장 API (청구하기 탭에서 PDF 다운로드/발송 시 호출)
  app.post("/api/invoice/mark-pdf-generated", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId, relatedCaseIds } = req.body;

      if (!caseId) {
        return res.status(400).json({ error: "케이스 ID가 필요합니다" });
      }

      // KST 타임스탬프 생성
      const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const timestamp = kstNow.toISOString();

      // 관련 케이스들에도 PDF 생성 기록 저장
      const caseIdsToUpdate =
        relatedCaseIds && relatedCaseIds.length > 0 ? relatedCaseIds : [caseId];

      for (const id of caseIdsToUpdate) {
        await storage.updateCase(id, {
          invoicePdfGenerated: timestamp,
        });
      }

      res.json({
        success: true,
        message: "PDF 생성 기록이 저장되었습니다.",
        timestamp,
      });
    } catch (error) {
      console.error("Mark PDF generated error:", error);
      res
        .status(500)
        .json({ error: "PDF 생성 기록 저장 중 오류가 발생했습니다" });
    }
  });

  // 현장출동비용 청구 발송 API (선견적요청 케이스용)
  app.post("/api/field-dispatch-invoice/send", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId, relatedCaseIds, fieldDispatchAmount, remarks } = req.body;

      if (!caseId) {
        return res.status(400).json({ error: "케이스 ID가 필요합니다" });
      }

      // 입력값 검증
      const parsedFieldDispatchAmount = parseInt(fieldDispatchAmount) || 0;

      // 케이스 정보 조회
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 관련 케이스들의 상태를 "청구"로 변경하고 금액 저장
      const caseIdsToUpdate =
        relatedCaseIds && relatedCaseIds.length > 0 ? relatedCaseIds : [caseId];

      // 청구일을 오늘 날짜로 설정 (KST)
      const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const claimDateStr = kstNow.toISOString().split("T")[0];

      for (const id of caseIdsToUpdate) {
        // 상태 변경 및 인보이스 데이터 저장
        await storage.updateCase(id, {
          status: "청구",
          claimDate: claimDateStr, // 청구일 설정
          fieldDispatchInvoiceAmount: parsedFieldDispatchAmount.toString(),
          fieldDispatchInvoiceRemarks: remarks || null,
        });

        // 진행상황 기록 추가 (금액 정보 포함)
        await storage.createProgressUpdate({
          caseId: id,
          content: `현장출동비용 청구서 발송 완료 - 청구 상태로 변경 (현장출동비용: ${parsedFieldDispatchAmount.toLocaleString()}원${remarks ? `, 비고: ${remarks}` : ""})`,
          createdBy: req.session.userId,
        });
      }

      res.json({
        success: true,
        message: "현장출동비용 청구서가 발송되었습니다.",
        updatedCases: caseIdsToUpdate.length,
        savedAmount: parsedFieldDispatchAmount,
      });
    } catch (error) {
      console.error("Field dispatch invoice send error:", error);
      res
        .status(500)
        .json({ error: "현장출동비용 청구서 발송 중 오류가 발생했습니다" });
    }
  });

  // User favorites endpoints
  // Get user's favorites
  app.get("/api/favorites", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const favorites = await storage.getUserFavorites(req.session.userId);
      res.json(favorites);
    } catch (error) {
      console.error("Get favorites error:", error);
      res
        .status(500)
        .json({ error: "즐겨찾기를 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Add favorite
  app.post("/api/favorites", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { menuName } = req.body;

      if (!menuName) {
        return res.status(400).json({ error: "메뉴 이름이 필요합니다" });
      }

      const favorite = await storage.addFavorite({
        userId: req.session.userId,
        menuName,
      });

      res.json(favorite);
    } catch (error) {
      console.error("Add favorite error:", error);

      // Handle unique constraint violation (duplicate favorite)
      if (error instanceof Error && error.message.includes("unique")) {
        return res
          .status(409)
          .json({ error: "이미 즐겨찾기에 추가된 메뉴입니다" });
      }

      res
        .status(500)
        .json({ error: "즐겨찾기를 추가하는 중 오류가 발생했습니다" });
    }
  });

  // Remove favorite
  app.delete("/api/favorites/:menuName", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { menuName } = req.params;

      await storage.removeFavorite(req.session.userId, menuName);
      res.json({ success: true });
    } catch (error) {
      console.error("Remove favorite error:", error);
      res
        .status(500)
        .json({ error: "즐겨찾기를 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // Notices routes
  // Get all notices
  app.get("/api/notices", async (req, res) => {
    try {
      const allNotices = await storage.getAllNotices();
      res.json(allNotices);
    } catch (error) {
      console.error("Get notices error:", error);
      res
        .status(500)
        .json({ error: "공지사항을 조회하는 중 오류가 발생했습니다" });
    }
  });

  // Create notice (admin only)
  app.post("/api/notices", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check if user is admin
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 공지사항을 작성할 수 있습니다" });
    }

    try {
      const { title, content } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: "제목과 내용을 입력해주세요" });
      }

      const notice = await storage.createNotice({
        title,
        content,
        authorId: req.session.userId,
      });

      res.json(notice);
    } catch (error) {
      console.error("Create notice error:", error);
      res
        .status(500)
        .json({ error: "공지사항을 등록하는 중 오류가 발생했습니다" });
    }
  });

  // Update notice (admin only)
  app.patch("/api/notices/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check if user is admin
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 공지사항을 수정할 수 있습니다" });
    }

    try {
      const { id } = req.params;
      const { title, content } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: "제목과 내용을 입력해주세요" });
      }

      const updated = await storage.updateNotice(id, { title, content });

      if (!updated) {
        return res.status(404).json({ error: "공지사항을 찾을 수 없습니다" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Update notice error:", error);
      res
        .status(500)
        .json({ error: "공지사항을 수정하는 중 오류가 발생했습니다" });
    }
  });

  // Delete notice (admin only)
  app.delete("/api/notices/:id", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check if user is admin
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 공지사항을 삭제=�� 수 있습니다" });
    }

    try {
      const { id } = req.params;
      await storage.deleteNotice(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete notice error:", error);
      res
        .status(500)
        .json({ error: "공지사항을 삭제하는 중 오류가 발생했습니다" });
    }
  });

  // Get change logs for a specific case
  app.get("/api/cases/:caseId/change-logs", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.params;
      const logs = await storage.getCaseChangeLogs(caseId);
      res.json(logs);
    } catch (error) {
      console.error("Get case change logs error:", error);
      res
        .status(500)
        .json({ error: "변경 로그를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Get all change logs (admin only)
  app.get("/api/case-change-logs", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check if user is admin
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 변경 로그를 조회할 수 있습니다" });
    }

    try {
      const { caseNumber, changedBy, dateFrom, dateTo } = req.query;

      const logs = await storage.getAllCaseChangeLogs({
        caseNumber: caseNumber as string | undefined,
        changedBy: changedBy as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
      });

      res.json(logs);
    } catch (error) {
      console.error("Get all change logs error:", error);
      res
        .status(500)
        .json({ error: "변경 로그를 불러오는 중 오류가 발생했습니다" });
    }
  });

  // Send dashboard PDF email endpoint (Bubble.io + Object Storage) - Admin only
  app.post("/api/send-dashboard-pdf-email", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // Check if user is admin
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "관리자") {
      return res
        .status(403)
        .json({ error: "관리자만 사용할 수 있는 기능입니다" });
    }

    try {
      const { email, pdfBase64, title } = req.body;

      if (!email || !pdfBase64) {
        return res
          .status(400)
          .json({ error: "이메일 주소와 PDF 데이터가 필요합니다" });
      }

      const dateStr = new Date().toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const timestamp = Date.now();
      const fileName = `dashboard_${timestamp}.pdf`;

      // Convert base64 to buffer
      const pdfBuffer = Buffer.from(pdfBase64, "base64");

      // Upload PDF to Object Storage
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        console.error(
          "[send-dashboard-pdf-email] Missing Object Storage bucket ID",
        );
        return res
          .status(500)
          .json({ error: "Object Storage 설정이 필요합니다" });
      }

      const bucket = objectStorageClient.bucket(bucketId);
      const objectName = `public/dashboard-pdfs/${fileName}`;
      const file = bucket.file(objectName);

      // Upload the PDF
      await file.save(pdfBuffer, {
        contentType: "application/pdf",
        metadata: {
          "custom:aclPolicy": JSON.stringify({
            owner: user.id,
            visibility: "public",
          }),
        },
      });

      // Generate signed URL for PDF (7 days validity)
      const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
      const pdfUrl = await signObjectURL({
        bucketName: bucketId,
        objectName: objectName,
        method: "GET",
        ttlSec: SIGNED_URL_TTL_SEC,
      });

      console.log(`[PDF Upload] Dashboard PDF uploaded with signed URL`);

      // Send email via Bubble.io API with PDF link
      const emailContent = `안녕하세요,

FLOXN 대시보드 현황을 보내드립니다.

- 발송일: ${dateStr}
- 발송자: ${user.name || user.username}

아래 링크를 클릭하시면 PDF를 다운로드하실 수 있습니다:
${pdfUrl}

감사합니다.
FLOXN 드림`;

      await sendNotificationEmail(
        email,
        title || `FLOXN 대시보드 현황 - ${dateStr}`,
        emailContent,
      );

      console.log(
        `[Email] Dashboard PDF link sent successfully to ${email} by ${user.username}`,
      );
      res.json({ success: true, message: "이메일이 전송되었습니다", pdfUrl });
    } catch (error) {
      console.error("Send dashboard PDF email error:", error);
      res.status(500).json({ error: "이메일 전송 중 오류가 발생했습니다" });
    }
  });

  // ==========================================
  // POST /api/send-invoice-email - INVOICE PDF 이메일 전송 (Bubble.io)
  // ==========================================
  app.post("/api/send-invoice-email", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    try {
      const {
        email,
        pdfBase64,
        caseNumber,
        insuranceCompany,
        accidentNo,
        damagePreventionAmount,
        propertyRepairAmount,
        totalAmount,
        remarks,
      } = req.body;

      if (!email || !pdfBase64) {
        return res
          .status(400)
          .json({ error: "이메일 주소와 PDF 데이터가 필요합니다" });
      }

      const dateStr = new Date().toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const timestamp = Date.now();
      const fileName = `invoice_${caseNumber || timestamp}_${timestamp}.pdf`;

      // Convert base64 to buffer
      const pdfBuffer = Buffer.from(pdfBase64, "base64");

      // Upload PDF to Object Storage
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        console.error("[send-invoice-email] Missing Object Storage bucket ID");
        return res
          .status(500)
          .json({ error: "Object Storage 설정이 필요합니다" });
      }

      const bucket = objectStorageClient.bucket(bucketId);
      const objectName = `public/invoice-pdfs/${fileName}`;
      const file = bucket.file(objectName);

      // Upload the PDF
      await file.save(pdfBuffer, {
        contentType: "application/pdf",
        metadata: {
          "custom:aclPolicy": JSON.stringify({
            owner: user.id,
            visibility: "public",
          }),
        },
      });

      // Generate signed URL for PDF (7 days validity)
      const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
      const pdfUrl = await signObjectURL({
        bucketName: bucketId,
        objectName: objectName,
        method: "GET",
        ttlSec: SIGNED_URL_TTL_SEC,
      });

      console.log(`[PDF Upload] Invoice PDF uploaded with signed URL`);

      // Format amounts
      const formatAmount = (amount: number) => amount.toLocaleString("ko-KR");

      // Send email via Hiworks SMTP with PDF attachment
      const subject = `[FLOXN] INVOICE - ${accidentNo || caseNumber || dateStr}`;

      const htmlContent = `
        <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">INVOICE 송부</h2>
          
          <p style="color: #666; line-height: 1.8;">안녕하세요,</p>
          
          <p style="color: #666; line-height: 1.8;">
            아래 청구건에 대한 <strong>INVOICE</strong>를 첨부하여 송부드립니다.
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 30%; font-weight: bold;">보험사</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${insuranceCompany || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">사고번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${accidentNo || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">사건번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${caseNumber || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">손해방지비용</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${formatAmount(damagePreventionAmount || 0)}원</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">대물복구비용</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${formatAmount(propertyRepairAmount || 0)}원</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">합계</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd; font-weight: bold; color: #0066cc;">${formatAmount(totalAmount || 0)}원</td>
            </tr>
            ${
              remarks
                ? `<tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">비고</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${remarks}</td>
            </tr>`
                : ""
            }
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">발송일</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${dateStr}</td>
            </tr>
          </table>
          
          <p style="color: #666; line-height: 1.8;">
            첨부된 INVOICE PDF 파일을 확인해 주시기 바랍니다.
          </p>
          
          <p style="color: #666; line-height: 1.8; margin-top: 30px;">
            감사합니다.<br/>
            <strong>FLOXN</strong>
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />
          
          <p style="color: #999; font-size: 12px;">
            본 메일은 FLOXN 시스템에서 자동 발송되었습니다.
          </p>
        </div>
      `;

      const textContent = `INVOICE 송부

안녕하세요,

아래 청구건에 대한 INVOICE를 첨부하여 송부드립니다.

- 보험사: ${insuranceCompany || "-"}
- 사고번호: ${accidentNo || "-"}
- 사건번호: ${caseNumber || "-"}
- 손해방지비용: ${formatAmount(damagePreventionAmount || 0)}원
- 대물복구비용: ${formatAmount(propertyRepairAmount || 0)}원
- 합계: ${formatAmount(totalAmount || 0)}원
${remarks ? `- 비고: ${remarks}` : ""}
- 발송일: ${dateStr}

첨부된 INVOICE PDF 파일을 확인해 주시기 바랍니다.

감사합니다.
FLOXN`;

      // Use Hiworks SMTP with PDF attachment
      const emailResult = await sendEmailWithAttachment({
        to: email,
        subject,
        text: textContent,
        html: htmlContent,
        attachments: [
          {
            filename: fileName,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      if (!emailResult.success) {
        console.error(`[Email] Invoice email failed:`, emailResult.error);
        return res
          .status(500)
          .json({ error: `이메일 전송 실패: ${emailResult.error}` });
      }

      console.log(
        `[Email] Invoice PDF sent successfully to ${email} by ${user.username} (MessageId: ${emailResult.messageId})`,
      );
      res.json({
        success: true,
        message: "INVOICE 이메일이 전송되었습니다",
        pdfUrl,
      });
    } catch (error) {
      console.error("Send invoice email error:", error);
      res
        .status(500)
        .json({ error: "INVOICE 이메일 전송 중 오류가 발생했습니다" });
    }
  });

  // ==========================================
  // POST /api/reports/:caseId/send-email - 현장출동보고서 PDF 이메일 발송 (Hiworks SMTP)
  // ==========================================
  const sendFieldDispatchReportEmailSchema = z.object({
    email: z.string().email("유효한 이메일 주소를 입력해주세요"),
  });

  app.post("/api/reports/:caseId/send-email", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    const allowedRoles = ["협력사", "관리자", "심사사"];
    if (!allowedRoles.includes(user.role)) {
      return res
        .status(403)
        .json({ error: "현장출동보고서 이메일 발송 권한이 없습니다" });
    }

    try {
      const { caseId } = req.params;

      const validationResult = sendFieldDispatchReportEmailSchema.safeParse(
        req.body,
      );
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map((e) => e.message)
          .join(", ");
        return res.status(400).json({ error: errorMessage });
      }

      const { email } = validationResult.data;

      console.log(
        `[Field Report Email] Starting for case ${caseId} to ${email}`,
      );

      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      console.log(
        `[Field Report Email] Generating PDF for case ${caseData.caseNumber}`,
      );

      // 10MB 제한을 적용한 PDF 생성 (이메일 첨부 용량 제한)
      const pdfBuffer = await generatePdfWithSizeLimitPdfLib({
        caseId,
        sections: {
          cover: true,
          fieldReport: true,
          drawing: true,
          evidence: false,
          estimate: false,
          etc: false,
        },
        evidence: {
          tab: "all",
          selectedFileIds: [],
        },
      });

      console.log(
        `[Field Report Email] PDF generated, size: ${pdfBuffer.length} bytes`,
      );
      console.log(
        `[Field Report Email] Case data - accidentNo: ${caseData.insuranceAccidentNo}, policyNo: ${caseData.insurancePolicyNo}`,
      );

      const result = await sendFieldReportEmail(
        email,
        caseData.caseNumber || caseId,
        caseData.insuredName || caseData.victimName || "",
        pdfBuffer,
        {
          insuranceAccidentNo: caseData.insuranceAccidentNo || undefined,
          policyNumber: caseData.insurancePolicyNo || undefined,
          assessorTeam: caseData.assessorTeam || undefined,
          investigatorTeam:
            caseData.investigatorTeam ||
            caseData.investigatorTeamName ||
            undefined,
        },
      );

      if (!result.success) {
        console.error(`[Field Report Email] Failed: ${result.error}`);
        return res
          .status(500)
          .json({ error: `이메일 발송 실패: ${result.error}` });
      }

      console.log(
        `[Field Report Email] Sent successfully to ${email}, messageId: ${result.messageId}`,
      );

      res.json({
        success: true,
        message: "현장출동보고서가 이메일로 발송되었습니다",
        messageId: result.messageId,
      });
    } catch (error) {
      console.error("Send field report email error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "이메일 발송 중 오류가 발생했습니다";
      res.status(500).json({ error: errorMessage });
    }
  });

  // ==========================================
  // GET /api/view-field-report-pdf/:caseId - 현장출동보고서 PDF 보기 (브라우저에서 바로 표시)
  // ==========================================
  app.get("/api/view-field-report-pdf/:caseId", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    try {
      const { caseId } = req.params;
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      console.log(
        `[View Field Report PDF] Generating PDF for case ${caseData.caseNumber}`,
      );

      const allDocs = await storage.getDocumentsByCaseId(caseId);
      const allDocIds = allDocs.map((d) => d.id);

      const pdfBuffer = await generatePdfWithSizeLimitPdfLib({
        caseId,
        sections: {
          cover: true,
          fieldReport: true,
          drawing: true,
          evidence: allDocIds.length > 0,
          estimate: true,
          etc: false,
        },
        evidence: {
          tab: "전체",
          selectedFileIds: allDocIds,
        },
      });

      console.log(
        `[View Field Report PDF] PDF generated, size: ${pdfBuffer.length} bytes`,
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="field-report-${caseData.caseNumber || caseId}.pdf"`,
      );
      res.send(pdfBuffer);
    } catch (error) {
      console.error("[View Field Report PDF] Error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "PDF 생성 중 오류가 발생했습니다";
      res.status(500).json({ error: errorMessage });
    }
  });

  // ==========================================
  // GET /api/view-invoice-pdf/:caseId - Invoice(청구서) PDF 보기 (브라우저에서 바로 표시)
  // ==========================================
  app.get("/api/view-invoice-pdf/:caseId", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    try {
      const { caseId } = req.params;
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      const accidentNo = caseData.insuranceAccidentNo || caseData.caseNumber;

      let allRelatedCases: any[] = [caseData];
      if (caseData.insuranceAccidentNo) {
        const relatedCases = await storage.getCasesByAccidentNo(
          caseData.insuranceAccidentNo,
          caseId,
        );
        allRelatedCases = [caseData, ...relatedCases];
      }

      const getCaseSuffix = (caseNumber: string): number => {
        const match = caseNumber?.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : 999;
      };
      allRelatedCases.sort(
        (a, b) =>
          getCaseSuffix(a.caseNumber || "") - getCaseSuffix(b.caseNumber || ""),
      );

      const particulars: Array<{
        title: string;
        detail?: string;
        amount: number;
      }> = [];
      let calculatedTotal = 0;

      const getCaseSuffixNum = (caseNumber: string): number => {
        const match = caseNumber?.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : 999;
      };

      for (let i = 0; i < allRelatedCases.length; i++) {
        const relatedCase = allRelatedCases[i];
        const caseSuffix = getCaseSuffixNum(relatedCase.caseNumber || "");

        if (relatedCase.status === "접수취소") {
          continue;
        }

        if (relatedCase.recoveryType === "선견적요청") {
          continue;
        }

        let addressLabel = "-";
        if (caseSuffix === 0) {
          addressLabel = relatedCase.insuredAddressDetail || "-";
        } else {
          addressLabel = relatedCase.victimAddressDetail || "-";
        }

        const caseApprovedAmt = parseInt(relatedCase.approvedAmount || "0") || 0;
        const caseEstimateAmt = parseInt(relatedCase.estimateAmount || "0") || 0;

        if (caseSuffix === 0) {
          let caseDamagePreventionAmt = 0;
          if (caseApprovedAmt > 0) {
            caseDamagePreventionAmt = caseApprovedAmt;
          } else if (caseEstimateAmt > 0) {
            caseDamagePreventionAmt = caseEstimateAmt;
          }
          if (caseDamagePreventionAmt > 0) {
            particulars.push({
              title: `[${addressLabel}] - 손해방지비용`,
              amount: caseDamagePreventionAmt,
            });
            calculatedTotal += caseDamagePreventionAmt;
          }
        }

        if (caseSuffix > 0) {
          let casePropertyRepairAmt = 0;
          if (caseApprovedAmt > 0) {
            casePropertyRepairAmt = caseApprovedAmt;
          } else if (caseEstimateAmt > 0) {
            casePropertyRepairAmt = caseEstimateAmt;
          }
          if (casePropertyRepairAmt > 0) {
            particulars.push({
              title: `[${addressLabel}] - 대물복구비용`,
              amount: casePropertyRepairAmt,
            });
            calculatedTotal += casePropertyRepairAmt;
          }
        }
      }

      if (particulars.length === 0) {
        const mainAddressLabel =
          caseData.victimAddressDetail ||
          caseData.victimAddress ||
          caseData.insuredAddressDetail ||
          caseData.insuredAddress ||
          "-";
        const damageAmount = Number(caseData.invoiceDamagePreventionAmount) || 0;
        const repairAmount = Number(caseData.invoicePropertyRepairAmount) || 0;
        if (damageAmount > 0) {
          particulars.push({
            title: `[${mainAddressLabel}] - 손해방지비용`,
            amount: damageAmount,
          });
          calculatedTotal += damageAmount;
        }
        if (repairAmount > 0) {
          particulars.push({
            title: `[${mainAddressLabel}] - 대물복구비용`,
            amount: repairAmount,
          });
          calculatedTotal += repairAmount;
        }
      }

      const invoiceData = {
        recipientName: caseData.insuranceCompany || "-",
        caseNumber: caseData.caseNumber || "-",
        acceptanceDate: caseData.accidentDate || new Date().toISOString(),
        submissionDate:
          caseData.invoicePdfGenerated || new Date().toISOString(),
        insuranceAccidentNo: accidentNo || undefined,
        particulars,
        totalAmount: calculatedTotal,
        remarks: caseData.invoiceRemarks || "",
      };

      const pdfBuffer = await generateInvoicePdf(invoiceData);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(`invoice-${accidentNo || caseId}.pdf`)}"`,
      );
      res.send(Buffer.from(pdfBuffer));
    } catch (error) {
      console.error("[View Invoice PDF] Error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Invoice PDF 생성 중 오류가 발생했습니다";
      res.status(500).json({ error: errorMessage });
    }
  });

  // ==========================================
  // POST /api/generate-invoice-pdf - INVOICE PDF 생성 및 다운로드
  // ==========================================
  const generateInvoicePdfSchema = z.object({
    caseId: z.string().min(1, "케이스 ID가 필요합니다"),
    recipientName: z.string().optional(),
    damagePreventionAmount: z.number().optional().default(0),
    propertyRepairAmount: z.number().optional().default(0),
    fieldDispatchPreventionAmount: z.number().optional().default(0),
    fieldDispatchPropertyAmount: z.number().optional().default(0),
    totalAmount: z.number().optional(),
    remarks: z.string().optional(),
    selectedDocumentIds: z.array(z.string()).optional().default([]),
  });

  app.post("/api/generate-invoice-pdf", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    const allowedRoles = ["협력사", "관리자", "심사사"];
    if (!allowedRoles.includes(user.role)) {
      return res
        .status(403)
        .json({ error: "INVOICE PDF 생성 권한이 없습니다" });
    }

    try {
      const validationResult = generateInvoicePdfSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map((e) => e.message)
          .join(", ");
        return res.status(400).json({ error: errorMessage });
      }

      const {
        caseId,
        recipientName,
        damagePreventionAmount,
        propertyRepairAmount,
        fieldDispatchPreventionAmount,
        fieldDispatchPropertyAmount,
        totalAmount: clientTotalAmount,
        remarks,
        selectedDocumentIds,
      } = validationResult.data;

      // Get case data
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // Build particulars - 관련 케이스들을 조회해서 각각의 금액과 상세주소를 개별 항목으로 표시
      const particulars: Array<{
        title: string;
        detail?: string;
        amount: number;
      }> = [];
      const accidentNo = caseData.insuranceAccidentNo || caseData.caseNumber;

      // 관련 케이스들 조회 (동일한 insuranceAccidentNo)
      let allRelatedCases: any[] = [caseData];
      if (caseData.insuranceAccidentNo) {
        const relatedCases = await storage.getCasesByAccidentNo(
          caseData.insuranceAccidentNo,
          caseId,
        );
        allRelatedCases = [caseData, ...relatedCases];
      }

      // 케이스 번호 suffix로 정렬 (-0, -1, -2, ...)
      const getCaseSuffix = (caseNumber: string): number => {
        const match = caseNumber?.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : 999;
      };
      allRelatedCases.sort(
        (a, b) =>
          getCaseSuffix(a.caseNumber || "") - getCaseSuffix(b.caseNumber || ""),
      );

      console.log(
        `[Invoice PDF] Building particulars for ${allRelatedCases.length} related cases`,
      );
      console.log(
        `[Invoice PDF] Client amounts - damagePreventionAmount: ${damagePreventionAmount}, propertyRepairAmount: ${propertyRepairAmount}`,
      );

      // 선견적요청 건이 하나라도 있는지 확인 (있으면 출동비 청구 불가)
      const hasPreEstimateRequest = allRelatedCases.some(
        (c) => c.recoveryType === "선견적요청",
      );
      console.log(
        `[Invoice PDF] hasPreEstimateRequest: ${hasPreEstimateRequest}`,
      );

      // 모든 케이스가 선견적요청인지 확인 (모두 선견적요청이면 주소 표시 안함)
      const allPreEstimateRequest =
        allRelatedCases.length > 0 &&
        allRelatedCases.every((c) => c.recoveryType === "선견적요청");
      console.log(
        `[Invoice PDF] allPreEstimateRequest: ${allPreEstimateRequest}`,
      );

      // 각 케이스별로 개별 항목 생성
      let calculatedTotal = 0;

      for (let i = 0; i < allRelatedCases.length; i++) {
        const relatedCase = allRelatedCases[i];
        const isMainCase = relatedCase.id === caseId;
        const caseSuffix = getCaseSuffix(relatedCase.caseNumber || "");

        // 접수취소 건은 종결된 건으로 인보이스에서 제외
        if (relatedCase.status === "접수취소") {
          console.log(
            `[Invoice PDF] Skipping 접수취소 case: ${relatedCase.caseNumber}`,
          );
          continue;
        }

        // 선견적요청 건은 인보이스에서 제외 (금액 합산 안됨)
        if (relatedCase.recoveryType === "선견적요청") {
          console.log(
            `[Invoice PDF] Skipping 선견적요청 case: ${relatedCase.caseNumber}`,
          );
          continue;
        }

        // 주소 가져오기: -0 케이스는 피보험자 상세주소만, -1 이상은 피해자 상세주소만 (fallback 없음)
        let addressLabel = "-";
        if (caseSuffix === 0) {
          // 손방건(-0): 피보험자 상세주소만 사용 (피해세대 주소로 fallback하지 않음)
          const detailAddr = relatedCase.insuredAddressDetail || "";
          addressLabel = detailAddr || "-";
        } else {
          // 대물건(-1, -2, ...): 피해자 상세주소만 사용 (피보험자 주소로 fallback하지 않음)
          const detailAddr = relatedCase.victimAddressDetail || "";
          addressLabel = detailAddr || "-";
        }

        // 해당 케이스에 저장된 금액 가져오기 (승인금액 > 견적금액 > 인보이스금액 순서로 확인)
        // 인보이스 금액은 합계로 저장되므로 개별 금액인 승인금액/견적금액을 우선 사용
        const caseApprovedAmt =
          parseInt(relatedCase.approvedAmount || "0") || 0;
        const caseEstimateAmt =
          parseInt(relatedCase.estimateAmount || "0") || 0;

        console.log(
          `[Invoice PDF] Case ${relatedCase.caseNumber}: suffix=${caseSuffix}, approvedAmt=${caseApprovedAmt}, estimateAmt=${caseEstimateAmt}, address=${addressLabel}`,
        );

        // 손방건(-0)인 경우: 손해방지비용
        if (caseSuffix === 0) {
          // 승인금액 > 견적금액 순서로 확인
          let caseDamagePreventionAmt = 0;
          if (caseApprovedAmt > 0) {
            caseDamagePreventionAmt = caseApprovedAmt;
          } else if (caseEstimateAmt > 0) {
            caseDamagePreventionAmt = caseEstimateAmt;
          }
          if (caseDamagePreventionAmt > 0) {
            particulars.push({
              title: `[${addressLabel}] - 손해방지비용`,
              amount: caseDamagePreventionAmt,
            });
            calculatedTotal += caseDamagePreventionAmt;
            console.log(
              `[Invoice PDF] Added 손해방지비용: ${addressLabel} = ${caseDamagePreventionAmt}`,
            );
          }
        }

        // 대물건(-1, -2, ...)인 경우: 대물복구비용
        if (caseSuffix > 0) {
          // 승인금액 > 견적금액 순서로 확인
          let casePropertyRepairAmt = 0;
          if (caseApprovedAmt > 0) {
            casePropertyRepairAmt = caseApprovedAmt;
          } else if (caseEstimateAmt > 0) {
            casePropertyRepairAmt = caseEstimateAmt;
          }
          if (casePropertyRepairAmt > 0) {
            particulars.push({
              title: `[${addressLabel}] - 대물복구비용`,
              amount: casePropertyRepairAmt,
            });
            calculatedTotal += casePropertyRepairAmt;
            console.log(
              `[Invoice PDF] Added 대물복구비용: ${addressLabel} = ${casePropertyRepairAmt}`,
            );
          }
        }
      }

      // 아무 금액도 추가되지 않은 경우 - 클라이언트에서 전달한 금액 사용
      if (particulars.length === 0) {
        const mainAddressLabel =
          caseData.victimAddressDetail ||
          caseData.victimAddress ||
          caseData.insuredAddressDetail ||
          caseData.insuredAddress ||
          "-";

        if (damagePreventionAmount && damagePreventionAmount > 0) {
          particulars.push({
            title: `[${mainAddressLabel}] - 손해방지비용`,
            amount: damagePreventionAmount,
          });
          calculatedTotal += damagePreventionAmount;
        }

        if (propertyRepairAmount && propertyRepairAmount > 0) {
          particulars.push({
            title: `[${mainAddressLabel}] - 대물복구비용`,
            amount: propertyRepairAmount,
          });
          calculatedTotal += propertyRepairAmount;
        }
      }

      // 현장출동비용은 메인 케이스에서만 가져옴 (클라이언트에서 전달된 값 사용)
      const mainAddressLabel =
        caseData.victimAddressDetail ||
        caseData.victimAddress ||
        caseData.insuredAddressDetail ||
        caseData.insuredAddress ||
        "-";

      // 현장출동비용은 항상 주소 없이 표시
      const fieldDispatchTitle = "현장출동비용";

      if (fieldDispatchPreventionAmount && fieldDispatchPreventionAmount > 0) {
        particulars.push({
          title: fieldDispatchTitle,
          amount: fieldDispatchPreventionAmount,
        });
        calculatedTotal += fieldDispatchPreventionAmount;
      }

      if (fieldDispatchPropertyAmount && fieldDispatchPropertyAmount > 0) {
        particulars.push({
          title: fieldDispatchTitle,
          amount: fieldDispatchPropertyAmount,
        });
        calculatedTotal += fieldDispatchPropertyAmount;
      }

      if (particulars.length === 0) {
        particulars.push({
          title: `[${mainAddressLabel}]`,
          detail: "청구 내역 없음",
          amount: 0,
        });
      }

      // 총액: 클라이언트에서 전달된 값이 있으면 사용, 없으면 계산된 값 사용
      let totalAmount: number;
      if (clientTotalAmount !== undefined) {
        totalAmount = clientTotalAmount;
      } else {
        totalAmount = calculatedTotal;
      }

      const invoiceData = {
        recipientName: recipientName || caseData.insuranceCompany || "-",
        caseNumber: caseData.caseNumber || "-",
        acceptanceDate: caseData.accidentDate || new Date().toISOString(),
        submissionDate: new Date().toISOString(),
        insuranceAccidentNo: accidentNo || undefined,
        particulars,
        totalAmount,
        remarks,
      };

      console.log(`[Invoice PDF] Generating PDF for download - case ${caseId}`);

      let pdfBuffer = await generateInvoicePdf(invoiceData);

      console.log(
        `[Invoice PDF] PDF generated for download, size: ${pdfBuffer.length} bytes`,
      );

      // Merge selected documents if any
      if (selectedDocumentIds && selectedDocumentIds.length > 0) {
        console.log(
          `[Invoice PDF] Merging ${selectedDocumentIds.length} documents into PDF`,
        );

        // Get documents from main case AND all related cases
        const mainDocs = await storage.getDocumentsByCaseId(caseId);

        // 케이스 타입에 따라 주소 선택 (-0은 insured, -1+는 victim)
        const getAddressForCase = (caseItem: any): string => {
          const caseNum = caseItem.caseNumber || "";
          const suffix = caseNum.split("-").pop() || "";

          if (suffix === "0") {
            // 손해방지비용 케이스: insuredAddressDetail만 사용
            const address = caseItem.insuredAddress || "";
            const detail = caseItem.insuredAddressDetail || "";
            return detail ? `${address} ${detail}` : address;
          } else {
            // 피해세대 케이스: victimAddressDetail만 사용
            const address = caseItem.victimAddress || "";
            const detail = caseItem.victimAddressDetail || "";
            return detail ? `${address} ${detail}` : address;
          }
        };

        // Build caseId -> caseNumber and caseId -> address mappings
        const caseNumberMap: Record<string, string> = {
          [caseId]: caseData.caseNumber || "",
        };
        const caseAddressMap: Record<string, string> = {
          [caseId]: getAddressForCase(caseData),
        };

        // Get related cases (same insuranceAccidentNo) - 접수취소 건 제외
        let allDocuments = [...mainDocs];
        if (caseData.insuranceAccidentNo) {
          const relatedCases = await storage.getCasesByAccidentNo(
            caseData.insuranceAccidentNo,
            caseId,
          );

          // 접수취소 건 제외
          const activeCases = relatedCases.filter(
            (c: any) => c.status !== "접수취소",
          );

          // Fetch documents from all related cases and build mapping
          for (const relatedCase of activeCases) {
            caseNumberMap[relatedCase.id] = relatedCase.caseNumber || "";
            // Build address for related case (케이스 타입에 따라 주소 선택)
            caseAddressMap[relatedCase.id] = getAddressForCase(relatedCase);

            const relatedDocs = await storage.getDocumentsByCaseId(
              relatedCase.id,
            );
            allDocuments = allDocuments.concat(relatedDocs);
          }
          console.log(
            `[Invoice PDF] Total documents from ${1 + activeCases.length} cases (excluding 접수취소): ${allDocuments.length}`,
          );
        }

        let selectedDocs = allDocuments.filter((doc: any) =>
          selectedDocumentIds.includes(doc.id),
        );

        // Sort documents by: 1) case suffix (-0, -1, -2), then 2) category order within each case
        const categoryOrder: Record<string, number> = {
          // 1. 사진 (현장사진, 수리중, 복구완료)
          현장출동사진: 0,
          현장: 1,
          현장사진: 2,
          "수리중 사진": 3,
          수리중: 4,
          "복구완료 사진": 5,
          복구완료: 6,
          // 2. 기본자료 (보험금청구서, 개인정보동의서)
          "보험금 청구서": 10,
          보험금청구서: 11,
          "개인정보 동의서(가족용)": 12,
          개인정보동의서: 13,
          // 3. 증빙자료 (주민등록등본, 등기부등본, 건축물대장, 기타증빙자료)
          주민등록등본: 20,
          등기부등본: 21,
          건축물대장: 22,
          "기타증빙자료(민원일지 등)": 23,
          기타증빙자료: 24,
          // 4. 청구자료 (복구완료 및 위임장, 도급계약서, 부가세 청구자료)
          "복구완료 및 위임장": 30,
          도급계약서: 31,
          "부가세 청구자료": 34,
          부가세청구자료: 35,
        };

        // Helper: Extract case suffix number from case number (e.g., "260106005-0" -> 0, "260106005-1" -> 1)
        const getCaseSuffix = (caseId: string): number => {
          const caseNumber = caseNumberMap[caseId] || "";
          const match = caseNumber.match(/-(\d+)$/);
          return match ? parseInt(match[1], 10) : 999;
        };

        // Sort by: 1) case suffix, 2) category order within each case
        selectedDocs = selectedDocs.sort((a: any, b: any) => {
          // First: sort by case suffix (-0, -1, -2, etc.)
          const suffixA = getCaseSuffix(a.caseId);
          const suffixB = getCaseSuffix(b.caseId);
          if (suffixA !== suffixB) return suffixA - suffixB;

          // Second: sort by category order within same case
          const orderA = categoryOrder[a.category] ?? 99;
          const orderB = categoryOrder[b.category] ?? 99;
          return orderA - orderB;
        });
        console.log(
          `[Invoice PDF] Selected documents found: ${selectedDocs.length}, sorted by case suffix then category`,
        );

        if (selectedDocs.length > 0) {
          const { PDFDocument, rgb } = await import("pdf-lib");
          const fontkit = (await import("@pdf-lib/fontkit")).default;
          const sharp = await import("sharp");
          const fs = await import("fs");
          const path = await import("path");

          const mergedPdf = await PDFDocument.load(pdfBuffer);

          // 한글 폰트 로드 (Pretendard 사용 - 글자 간격 문제 해결)
          mergedPdf.registerFontkit(fontkit);
          const fontsDir = path.join(process.cwd(), "server/fonts");
          const fontPath = path.join(fontsDir, "Pretendard-Regular.ttf");
          const fontBytes = fs.readFileSync(fontPath);
          const font = await mergedPdf.embedFont(fontBytes, { subset: false });

          // Helper function to get file buffer from Object Storage or DB
          const getFileBuffer = async (doc: any): Promise<Buffer | null> => {
            try {
              // 1. Object Storage에서 가져오기 (우선)
              if (doc.storageKey) {
                const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
                if (privateObjectDir) {
                  const fullPath = `${privateObjectDir}/${doc.storageKey}`;
                  const { ObjectStorageService } = await import(
                    "./replit_integrations/object_storage"
                  );
                  const storageService = new ObjectStorageService();
                  return await storageService.downloadToBuffer(fullPath);
                }
              }
              // 2. fileData에서 가져오기 (레거시)
              if (doc.fileData) {
                if (doc.fileData.startsWith("data:")) {
                  const base64Data = doc.fileData.split(",")[1];
                  return Buffer.from(base64Data, "base64");
                } else {
                  return Buffer.from(doc.fileData, "base64");
                }
              }
              // 3. DB에서 직접 가져오기 (레거시 파일)
              if (doc.id) {
                const fileData = await storage.getDocumentFileData(doc.id);
                if (fileData) {
                  if (fileData.startsWith("data:")) {
                    const base64Data = fileData.split(",")[1];
                    return Buffer.from(base64Data, "base64");
                  } else {
                    return Buffer.from(fileData, "base64");
                  }
                }
              }
              return null;
            } catch (err) {
              console.error(
                `[Invoice PDF] Failed to get file buffer for ${doc.fileName}:`,
                err,
              );
              return null;
            }
          };

          // Helper functions
          const isPdfFile = (mimeType: string, fileName: string): boolean => {
            if (mimeType === "application/pdf") return true;
            if (fileName?.toLowerCase().endsWith(".pdf")) return true;
            return false;
          };

          const isImageFile = (mimeType: string, fileName: string): boolean => {
            if (
              mimeType.startsWith("image/") &&
              !mimeType.includes("heic") &&
              !mimeType.includes("webp")
            )
              return true;
            const ext = fileName?.toLowerCase();
            if (
              ext?.endsWith(".jpg") ||
              ext?.endsWith(".jpeg") ||
              ext?.endsWith(".png") ||
              ext?.endsWith(".gif")
            )
              return true;
            return false;
          };

          // Common constants and category mapping
          const categoryToTab: Record<string, string> = {
            현장출동사진: "현장사진",
            현장: "현장사진",
            "수리중 사진": "현장사진",
            수리중: "현장사진",
            "복구완료 사진": "현장사진",
            복구완료: "현장사진",
            "보험금 청구서": "기본자료",
            "개인정보 동의서(가족용)": "기본자료",
            주민등록등본: "증빙자료",
            등기부등본: "증빙자료",
            건축물대장: "증빙자료",
            "기타증빙자료(민원일지 등)": "증빙자료",
            "복구완료 및 위임장": "청구자료",
            도급계약서: "청구자료",
            "부가세 청구자료": "청구자료",
            청구: "청구자료",
          };

          // Documents are already sorted by case suffix then category order
          // No need to re-sort, just use selectedDocs directly
          const sortedDocs = selectedDocs;

          console.log(
            `[Invoice PDF] 문서 ${sortedDocs.length}개 접수건별/카테고리 순서로 정렬 완료`,
          );

          const A4_WIDTH = 595.28;
          const A4_HEIGHT = 841.89;
          const MARGIN = 30;
          const HEADER_HEIGHT = 20;
          const GAP = 8;

          // 2장/페이지 카테고리 목록 (현장사진, 수리중, 복구완료)
          const twoPerPageCategories = [
            "현장사진",
            "수리중",
            "복구완료",
            "현장출동사진",
            "수리중 사진",
            "복구완료 사진",
          ];
          const isTwoPerPageCategory = (category: string): boolean => {
            if (!category) return false;
            // 정확한 일치만 체크
            return twoPerPageCategories.includes(category);
          };

          // 헤더 텍스트 정규화 함수 (ASCII '-' 유지, U+2010/U+2212 치환 금지)
          const normalizeHeaderIdentifier = (text: string): string => {
            if (!text) return "";
            let s = String(text);
            // 1) 유니코드 공백을 일반 공백으로 통일 (NBSP, zero-width 등)
            s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");
            // 2) 대시류(en dash, em dash, minus)만 ASCII '-'로 통일
            s = s.replace(/[–—−]/g, "-");
            // 3) 코드 패턴([A-Za-z0-9]) 사이 하이픈에서만 공백 제거
            s = s.replace(/([A-Za-z0-9])\s*-\s*([A-Za-z0-9])/g, "$1-$2");
            // 4) 연속 공백 축소
            s = s.replace(/ {2,}/g, " ");
            return s.trim();
          };

          // Collect images for layout (2-per-page for some categories, 1-per-page for others)
          const pendingImages: {
            doc: any;
            buffer: Buffer;
            headerText: string;
            headerInfo: {
              accidentNo: string;
              address: string;
              category: string;
            };
          }[] = [];

          // 테이블 형태 헤더 그리기 헬퍼 함수 (현장출동보고서 스타일)
          const drawTableHeader = (
            page: any,
            x: number,
            y: number,
            width: number,
            height: number,
            headerInfo: {
              accidentNo: string;
              address: string;
              category: string;
            },
          ) => {
            // 열 너비 비율 (사고번호: 30%, 주소: 45%, 카테고리: 25%)
            const col1Width = width * 0.3;
            const col2Width = width * 0.45;
            const col3Width = width * 0.25;

            // 배경 (진한 회색 - 현장출동보고서 스타일)
            page.drawRectangle({
              x: x,
              y: y,
              width: width,
              height: height,
              color: rgb(0.2, 0.2, 0.2),
              borderColor: rgb(0.3, 0.3, 0.3),
              borderWidth: 0.5,
            });

            // 열 구분선
            page.drawLine({
              start: { x: x + col1Width, y: y },
              end: { x: x + col1Width, y: y + height },
              color: rgb(0.4, 0.4, 0.4),
              thickness: 0.5,
            });
            page.drawLine({
              start: { x: x + col1Width + col2Width, y: y },
              end: { x: x + col1Width + col2Width, y: y + height },
              color: rgb(0.4, 0.4, 0.4),
              thickness: 0.5,
            });

            // 텍스트 (흰색 - 어두운 배경에 맞춤)
            const textY = y + (height - 9) / 2;
            const textColor = rgb(1, 1, 1);
            const textSize = 8;

            // 정규화 적용 (ASCII '-' 유지)
            const normalizedAccidentNo = normalizeHeaderIdentifier(
              headerInfo.accidentNo,
            );
            const normalizedAddress = normalizeHeaderIdentifier(
              headerInfo.address || "-",
            );
            const normalizedCategory = normalizeHeaderIdentifier(
              headerInfo.category,
            );

            // 사고번호 정규화 결과 charCode 로그 (공백 문자 검증)
            console.log(
              "[Invoice Header] accidentNo RAW:",
              headerInfo.accidentNo,
            );
            console.log(
              "[Invoice Header] accidentNo NORM:",
              normalizedAccidentNo,
            );
            console.log(
              "[Invoice Header] accidentNo CODES:",
              Array.from(normalizedAccidentNo).map((c) =>
                c.charCodeAt(0).toString(16).padStart(4, "0"),
              ),
            );

            // 하이픈 간격 보정 함수 (사고번호, 주소 공용)
            const drawTextTight = (text: string, startX: number) => {
              if (!text || !text.includes("-")) {
                page.drawText(text || "", {
                  x: startX,
                  y: textY,
                  size: textSize,
                  font,
                  color: textColor,
                });
                return;
              }
              const offset = textSize * 0.06;
              const parts = text.split("-");
              let cursorX = startX;
              const hyphenWidth = font.widthOfTextAtSize("-", textSize);

              for (let i = 0; i < parts.length; i++) {
                if (parts[i]) {
                  page.drawText(parts[i], {
                    x: cursorX,
                    y: textY,
                    size: textSize,
                    font,
                    color: textColor,
                  });
                  cursorX += font.widthOfTextAtSize(parts[i], textSize);
                }
                if (i < parts.length - 1) {
                  page.drawText("-", {
                    x: cursorX,
                    y: textY,
                    size: textSize,
                    font,
                    color: textColor,
                  });
                  cursorX += hyphenWidth - offset;
                }
              }
            };

            // 사고번호
            drawTextTight(normalizedAccidentNo, x + 5);

            // 주소 (하이픈 간격 보정 적용)
            drawTextTight(normalizedAddress, x + col1Width + 5);

            // 카테고리
            page.drawText(normalizedCategory, {
              x: x + col1Width + col2Width + 5,
              y: textY,
              size: textSize,
              font,
              color: textColor,
            });
          };

          // Helper function to flush pending images with category-based layout
          const flushPendingImages = async () => {
            if (pendingImages.length === 0) return;

            const PAGE_HEADER_HEIGHT = 30;
            const imgWidth = A4_WIDTH - MARGIN * 2;

            let i = 0;
            while (i < pendingImages.length) {
              const currentImg = pendingImages[i];
              const category = currentImg.doc.category || "";
              const isTwoPerPage = isTwoPerPageCategory(category);

              if (isTwoPerPage) {
                // 2장/페이지 레이아웃 - 각 이미지 위에 개별 헤더 표시
                const page = mergedPdf.addPage([A4_WIDTH, A4_HEIGHT]);

                // 이미지 영역 계산 (각 이미지마다 개별 헤더 포함)
                const INDIVIDUAL_HEADER_HEIGHT = 24;
                const availableHeight = A4_HEIGHT - MARGIN * 2;
                // 각 슬롯: 헤더(24px) + 이미지영역 + GAP
                const slotHeight = (availableHeight - GAP) / 2;
                const imgHeight = slotHeight - INDIVIDUAL_HEADER_HEIGHT - GAP;

                // 최대 2장까지 배치
                let actualCount = 0;
                for (let j = 0; j < 2 && i + j < pendingImages.length; j++) {
                  const img = pendingImages[i + j];
                  // 다음 이미지가 다른 카테고리면 건너뛰기
                  if (j > 0 && !isTwoPerPageCategory(img.doc.category || ""))
                    break;

                  actualCount++;

                  // 슬롯 시작 위치 계산
                  const slotY =
                    j === 0
                      ? A4_HEIGHT - MARGIN - slotHeight
                      : A4_HEIGHT - MARGIN - slotHeight - GAP - slotHeight;

                  // 개별 헤더 그리기 (각 이미지 위) - 테이블 형태 (현장출동보고서 스타일)
                  drawTableHeader(
                    page,
                    MARGIN,
                    slotY + imgHeight + GAP,
                    imgWidth,
                    INDIVIDUAL_HEADER_HEIGHT,
                    img.headerInfo,
                  );

                  try {
                    const embeddedImage = await mergedPdf.embedJpg(img.buffer);
                    const dims = embeddedImage.scale(1);
                    let scale = Math.min(
                      imgWidth / dims.width,
                      imgHeight / dims.height,
                      1,
                    );
                    const finalW = dims.width * scale;
                    const finalH = dims.height * scale;
                    const imgX = MARGIN + (imgWidth - finalW) / 2;
                    const imgY = slotY + (imgHeight - finalH) / 2;

                    page.drawImage(embeddedImage, {
                      x: imgX,
                      y: imgY,
                      width: finalW,
                      height: finalH,
                    });
                  } catch (e) {
                    console.error(`[Invoice PDF] Failed to embed image:`, e);
                  }
                }

                // 실제 배치된 이미지 개수만큼 스킵
                i += actualCount;
              } else {
                // 1장/페이지 레이아웃
                const page = mergedPdf.addPage([A4_WIDTH, A4_HEIGHT]);

                // 헤더 그리기 - 테이블 형태 (현장출동보고서 스타일)
                drawTableHeader(
                  page,
                  MARGIN,
                  A4_HEIGHT - MARGIN - PAGE_HEADER_HEIGHT,
                  imgWidth,
                  PAGE_HEADER_HEIGHT,
                  currentImg.headerInfo,
                );

                // 전체 페이지 이미지 영역
                const imgHeight =
                  A4_HEIGHT - MARGIN * 2 - PAGE_HEADER_HEIGHT - GAP;
                const yPos = MARGIN;

                try {
                  const embeddedImage = await mergedPdf.embedJpg(
                    currentImg.buffer,
                  );
                  const dims = embeddedImage.scale(1);
                  let scale = Math.min(
                    imgWidth / dims.width,
                    imgHeight / dims.height,
                    1,
                  );
                  const finalW = dims.width * scale;
                  const finalH = dims.height * scale;
                  const imgX = MARGIN + (imgWidth - finalW) / 2;
                  const imgY = yPos + (imgHeight - finalH) / 2;

                  page.drawImage(embeddedImage, {
                    x: imgX,
                    y: imgY,
                    width: finalW,
                    height: finalH,
                  });
                } catch (e) {
                  console.error(`[Invoice PDF] Failed to embed image:`, e);
                }

                i += 1;
              }
            }

            console.log(
              `[Invoice PDF] Added ${pendingImages.length} images (category-based layout)`,
            );
            pendingImages.length = 0;
          };

          // Process all documents in case suffix / category order
          for (const doc of sortedDocs) {
            const mimeType = doc.fileType || "";
            const fileName = doc.fileName || "";

            // Get header info for this document (보험사사고번호 + 해당 케이스의 주소 + 카테고리)
            const accidentNo = caseData.insuranceAccidentNo || "";
            // Use the address from the case this document belongs to
            const fullAddress = caseAddressMap[doc.caseId] || "";
            const docCategory = doc.category || "기타";
            const headerText = `[${accidentNo}] ${fullAddress} - ${docCategory}`;

            // 테이블 형태 헤더 정보 (현장출동보고서 스타일)
            const headerInfo = {
              accidentNo: `사고번호 ${accidentNo}`,
              address: fullAddress,
              category: docCategory,
            };

            if (isPdfFile(mimeType, fileName)) {
              // First, flush any pending images before adding PDF
              await flushPendingImages();

              // PDF document - 헤더와 PDF 내용 간격 40px 추가
              const PDF_HEADER_GAP = 40;
              try {
                const fileBuffer = await getFileBuffer(doc);
                if (!fileBuffer) {
                  console.warn(
                    `[Invoice PDF] No data for PDF: ${doc.fileName}`,
                  );
                  continue;
                }
                const attachedPdf = await PDFDocument.load(fileBuffer, {
                  ignoreEncryption: true,
                });
                const pageCount = attachedPdf.getPageCount();

                for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
                  const srcPage = attachedPdf.getPage(pageIdx);
                  const { width, height } = srcPage.getSize();

                  // 새 페이지 생성 (헤더 + 간격 공간 추가)
                  const totalHeaderSpace =
                    MARGIN + HEADER_HEIGHT + PDF_HEADER_GAP;
                  const newPage = mergedPdf.addPage([
                    width,
                    height + totalHeaderSpace,
                  ]);

                  // 원본 PDF 페이지를 embed하여 아래쪽에 배치
                  const embeddedPage = await mergedPdf.embedPage(srcPage);
                  newPage.drawPage(embeddedPage, { x: 0, y: 0, width, height });

                  // 헤더 배경 (흰색)
                  newPage.drawRectangle({
                    x: 0,
                    y: height,
                    width: width,
                    height: totalHeaderSpace,
                    color: rgb(1, 1, 1),
                  });
                  // 헤더 - 테이블 형태 (현장출동보고서 스타일)
                  drawTableHeader(
                    newPage,
                    MARGIN,
                    height + PDF_HEADER_GAP,
                    width - MARGIN * 2,
                    HEADER_HEIGHT,
                    headerInfo,
                  );
                }
                console.log(
                  `[Invoice PDF] Added PDF: ${doc.fileName} (${pageCount} pages) - ${doc.category}`,
                );
              } catch (docError) {
                console.error(
                  `[Invoice PDF] Failed to add PDF ${doc.fileName}:`,
                  docError,
                );
              }
            } else if (isImageFile(mimeType, fileName)) {
              // Collect image for 2-per-page layout
              try {
                const fileBuffer = await getFileBuffer(doc);
                if (!fileBuffer) {
                  console.warn(
                    `[Invoice PDF] No data for image: ${doc.fileName}`,
                  );
                  continue;
                }
                const imageBuffer = await sharp
                  .default(fileBuffer)
                  .resize(800, 600, { fit: "inside", withoutEnlargement: true })
                  .jpeg({ quality: 60, mozjpeg: true })
                  .toBuffer();

                pendingImages.push({
                  doc,
                  buffer: imageBuffer,
                  headerText,
                  headerInfo,
                });
                console.log(
                  `[Invoice PDF] Queued image: ${doc.fileName} - ${doc.category}`,
                );
              } catch (err) {
                console.error(
                  `[Invoice PDF] Failed to process image ${doc.fileName}:`,
                  err,
                );
              }
            }
          }

          // Flush remaining pending images
          await flushPendingImages();

          console.log(
            `[Invoice PDF] Processed ${sortedDocs.length} documents in category order`,
          );

          pdfBuffer = Buffer.from(await mergedPdf.save());
          console.log(
            `[Invoice PDF] Final PDF with documents, size: ${pdfBuffer.length} bytes`,
          );
        }
      }

      // 10MB 이하로 압축 (이메일 첨부 및 다운로드 공통)
      const originalSize = pdfBuffer.length;
      if (originalSize > 7 * 1024 * 1024) {
        console.log(
          `[Invoice PDF] Compressing PDF: ${(originalSize / 1024 / 1024).toFixed(2)}MB...`,
        );
        pdfBuffer = await compressPdfForEmail(pdfBuffer);
        console.log(
          `[Invoice PDF] Compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`,
        );
      }

      const fileName = `INVOICE_${caseData.insuranceAccidentNo || caseData.caseNumber || caseId}_${Date.now()}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Generate invoice PDF error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "PDF 생성 중 오류가 발생했습니다";
      res.status(500).json({ error: errorMessage });
    }
  });

  // ==========================================
  // POST /api/send-invoice-email-v2 - INVOICE PDF 템플릿 기반 이메일 첨부 발송
  // ==========================================
  const sendInvoiceEmailV2Schema = z.object({
    email: z.string().min(1, "이메일 주소가 필요합니다"),
    caseId: z.string().min(1, "케이스 ID가 필요합니다"),
    recipientName: z.string().optional(),
    damagePreventionAmount: z.number().optional().default(0),
    propertyRepairAmount: z.number().optional().default(0),
    fieldDispatchPreventionAmount: z.number().optional().default(0),
    fieldDispatchPropertyAmount: z.number().optional().default(0),
    totalAmount: z.number().optional(),
    remarks: z.string().optional(),
    selectedDocumentIds: z.array(z.string()).optional().default([]),
  });

  app.post("/api/send-invoice-email-v2", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    const allowedRoles = ["협력사", "관리자", "심사사"];
    if (!allowedRoles.includes(user.role)) {
      return res
        .status(403)
        .json({ error: "INVOICE 이메일 전송 권한이 없습니다" });
    }

    try {
      const validationResult = sendInvoiceEmailV2Schema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map((e) => e.message)
          .join(", ");
        return res.status(400).json({ error: errorMessage });
      }

      const {
        email: rawEmail,
        caseId,
        recipientName,
        damagePreventionAmount,
        propertyRepairAmount,
        fieldDispatchPreventionAmount,
        fieldDispatchPropertyAmount,
        totalAmount: clientTotalAmount,
        remarks,
        selectedDocumentIds,
      } = validationResult.data;

      // 쉼표로 구분된 여러 이메일 처리 (공백 제거 후 검증)
      const emailList = rawEmail
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      // 각 이메일 형식 검증
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = emailList.filter((e) => !emailRegex.test(e));
      if (invalidEmails.length > 0) {
        return res.status(400).json({
          error: `올바른 이메일 형식이 아닙니다: ${invalidEmails.join(", ")}`,
        });
      }

      if (emailList.length === 0) {
        return res
          .status(400)
          .json({ error: "수신자 이메일 주소가 필요합니다" });
      }

      // 첫 번째 이메일을 주 수신자로 사용 (기존 호환성 유지)
      const email = emailList[0];

      // Get case data
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 로고 파일 읽기 (CID 첨부용)
      let logoBuffer: Buffer | null = null;
      try {
        const logoPath = path.join(
          process.cwd(),
          "server",
          "assets",
          "floxn-logo.png",
        );
        if (fs.existsSync(logoPath)) {
          logoBuffer = fs.readFileSync(logoPath);
          console.log(
            `[send-invoice-email-v2] Logo loaded: ${logoBuffer.length} bytes`,
          );
        } else {
          console.warn(
            `[send-invoice-email-v2] Logo file not found: ${logoPath}`,
          );
        }
      } catch (logoErr) {
        console.error("[send-invoice-email-v2] Failed to load logo:", logoErr);
      }

      // Build particulars based on amounts - 관련 케이스들 조회하여 각 케이스별 주소 사용
      const particulars: Array<{
        title: string;
        detail?: string;
        amount: number;
      }> = [];
      const accidentNo = caseData.insuranceAccidentNo || caseData.caseNumber;

      // 관련 케이스들 조회하여 각 케이스별 금액/주소 사용 (다운로드 로직과 동일)
      const allCases = [caseData];
      if (caseData.insuranceAccidentNo) {
        const relatedCasesForParticulars = await storage.getCasesByAccidentNo(
          caseData.insuranceAccidentNo,
          caseId,
        );
        allCases.push(...relatedCasesForParticulars);
      }

      // 케이스 suffix 추출 함수
      const getCaseSuffix = (caseNumber: string): number => {
        const match = caseNumber.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : 999;
      };

      // 케이스 suffix 순으로 정렬
      allCases.sort(
        (a, b) =>
          getCaseSuffix(a.caseNumber || "") - getCaseSuffix(b.caseNumber || ""),
      );

      // 선견ca�요청 건이 하나라도 있는지 확인 (있으면 출동비 청구 불가)
      const hasPreEstimateRequest = allCases.some(
        (c) => c.recoveryType === "선견적요청",
      );
      console.log(
        `[send-invoice-email-v2] hasPreEstimateRequest: ${hasPreEstimateRequest}`,
      );

      let calculatedTotal = 0;

      for (const relatedCase of allCases) {
        const caseSuffix = getCaseSuffix(relatedCase.caseNumber || "");

        // 접수취소 건은 종결된 건으로 인보이스에서 제외
        if (relatedCase.status === "접수취소") {
          console.log(
            `[send-invoice-email-v2] Skipping 접수취소 case: ${relatedCase.caseNumber}`,
          );
          continue;
        }

        // 선견적요청 건은 인보이스에서 제외 (금액 합산 안됨)
        if (relatedCase.recoveryType === "선견적요청") {
          console.log(
            `[send-invoice-email-v2] Skipping 선견적요청 case: ${relatedCase.caseNumber}`,
          );
          continue;
        }

        // 상세주소 가져오기: -0 케이스는 피보험자 상세주소만, -1+ 케이스는 피해자 상세주소만 (fallback 없음)
        let caseAddressLabel = "-";
        if (caseSuffix === 0) {
          // 손방건(-0): 피보험자 상세주소만 사용 (피해세대 주소로 fallback하지 않음)
          caseAddressLabel = relatedCase.insuredAddressDetail || "-";
        } else {
          // 대물건(-1, -2, ...): 피해자 상세주소만 사용 (피보험자 주소로 fallback하지 않음)
          caseAddressLabel = relatedCase.victimAddressDetail || "-";
        }

        // 해당 케이스에 저장된 금액 가져오기 (승인금액 > 견적금액 순서로 확인)
        // 인보이스 금액은 합계로 저장되므로 개별 금액인 승인금액/견적금액을 우선 사용
        const caseApprovedAmt =
          parseInt(relatedCase.approvedAmount || "0") || 0;
        const caseEstimateAmt =
          parseInt(relatedCase.estimateAmount || "0") || 0;

        // 손방건(-0)인 경우: 손해방지비용
        if (caseSuffix === 0) {
          // 승인금액 > 견적금액 순서로 확인
          let caseDamagePreventionAmt = 0;
          if (caseApprovedAmt > 0) {
            caseDamagePreventionAmt = caseApprovedAmt;
          } else if (caseEstimateAmt > 0) {
            caseDamagePreventionAmt = caseEstimateAmt;
          }
          if (caseDamagePreventionAmt > 0) {
            particulars.push({
              title: `[${caseAddressLabel}] - 손해방지비용`,
              amount: caseDamagePreventionAmt,
            });
            calculatedTotal += caseDamagePreventionAmt;
          }
        }

        // 대물건(-1, -2, ...)인 경우: 대물복구비용
        if (caseSuffix > 0) {
          // 승인금액 > 견적금액 순서로 확인
          let casePropertyRepairAmt = 0;
          if (caseApprovedAmt > 0) {
            casePropertyRepairAmt = caseApprovedAmt;
          } else if (caseEstimateAmt > 0) {
            casePropertyRepairAmt = caseEstimateAmt;
          }
          if (casePropertyRepairAmt > 0) {
            particulars.push({
              title: `[${caseAddressLabel}] - 대물복구비용`,
              amount: casePropertyRepairAmt,
            });
            calculatedTotal += casePropertyRepairAmt;
          }
        }
      }

      // 아무 금액도 추가되지 않은 경우 - 클라이언트에서 전달한 금액 사용
      const mainAddressLabel =
        caseData.victimAddressDetail ||
        caseData.victimAddress ||
        caseData.insuredAddressDetail ||
        caseData.insuredAddress ||
        "-";

      if (particulars.length === 0) {
        if (damagePreventionAmount && damagePreventionAmount > 0) {
          particulars.push({
            title: `[${mainAddressLabel}] - 손해방지비용`,
            amount: damagePreventionAmount,
          });
        }

        if (propertyRepairAmount && propertyRepairAmount > 0) {
          particulars.push({
            title: `[${mainAddressLabel}] - 대물복구비용`,
            amount: propertyRepairAmount,
          });
        }

        if (
          fieldDispatchPreventionAmount &&
          fieldDispatchPreventionAmount > 0
        ) {
          particulars.push({
            title: "현장출동비용",
            amount: fieldDispatchPreventionAmount,
          });
        }

        if (fieldDispatchPropertyAmount && fieldDispatchPropertyAmount > 0) {
          particulars.push({
            title: "현장출동비용",
            amount: fieldDispatchPropertyAmount,
          });
        }
      }

      // If still no particulars, add a default entry
      if (particulars.length === 0) {
        particulars.push({
          title: `[${mainAddressLabel}]`,
          detail: "청구 내역 없음",
          amount: 0,
        });
      }

      // Use client-provided totalAmount if available, otherwise compute server-side (no truncation)
      let totalAmount: number;
      if (clientTotalAmount !== undefined) {
        totalAmount = clientTotalAmount;
      } else {
        // 절사 없이 합계 계산
        totalAmount =
          (damagePreventionAmount || 0) +
          (propertyRepairAmount || 0) +
          (fieldDispatchPreventionAmount || 0) +
          (fieldDispatchPropertyAmount || 0);
      }

      // Build invoice data
      const invoiceData = {
        recipientName: recipientName || caseData.insuranceCompany || "-",
        caseNumber: caseData.caseNumber || "-",
        acceptanceDate: caseData.accidentDate || new Date().toISOString(),
        submissionDate: new Date().toISOString(),
        insuranceAccidentNo: accidentNo || undefined,
        particulars,
        totalAmount,
        remarks,
      };

      console.log(`[Invoice PDF] Generating PDF for case ${caseId}`);

      // Generate PDF from template
      let pdfBuffer = await generateInvoicePdf(invoiceData);

      console.log(
        `[Invoice PDF] PDF generated, size: ${pdfBuffer.length} bytes`,
      );

      // Merge selected documents into Invoice PDF (same as download logic)
      if (selectedDocumentIds && selectedDocumentIds.length > 0) {
        console.log(
          `[Invoice Email] Merging ${selectedDocumentIds.length} documents into Invoice PDF`,
        );

        // Get documents from main case AND all related cases
        const mainDocs = await storage.getDocumentsByCaseId(caseId);

        // 케이스 타입에 따라 주소 선택 (-0은 insured, -1+는 victim)
        const getAddressForCase = (caseItem: any): string => {
          const caseNum = caseItem.caseNumber || "";
          const suffix = caseNum.split("-").pop() || "";

          if (suffix === "0") {
            // 손해방지비용 케이스: insuredAddressDetail만 사용
            const address = caseItem.insuredAddress || "";
            const detail = caseItem.insuredAddressDetail || "";
            return detail ? `${address} ${detail}` : address;
          } else {
            // 피해세대 케이스: victimAddressDetail만 사용
            const address = caseItem.victimAddress || "";
            const detail = caseItem.victimAddressDetail || "";
            return detail ? `${address} ${detail}` : address;
          }
        };

        // Build caseId -> caseNumber and caseId -> address mappings
        const caseNumberMap: Record<string, string> = {
          [caseId]: caseData.caseNumber || "",
        };
        const caseAddressMap: Record<string, string> = {
          [caseId]: getAddressForCase(caseData),
        };

        // Get related cases (same insuranceAccidentNo) - 접수취소 건 제외
        let allDocuments = [...mainDocs];
        if (caseData.insuranceAccidentNo) {
          const relatedCases = await storage.getCasesByAccidentNo(
            caseData.insuranceAccidentNo,
            caseId,
          );

          // 접수취소 건 제외
          const activeCases = relatedCases.filter(
            (c: any) => c.status !== "접수취소",
          );

          // Fetch documents from all related cases and build mapping
          for (const relatedCase of activeCases) {
            caseNumberMap[relatedCase.id] = relatedCase.caseNumber || "";
            // Build address for related case (케이스 타입에 따라 주소 선택)
            caseAddressMap[relatedCase.id] = getAddressForCase(relatedCase);

            const relatedDocs = await storage.getDocumentsByCaseId(
              relatedCase.id,
            );
            allDocuments = allDocuments.concat(relatedDocs);
          }
          console.log(
            `[Invoice Email] Total documents from ${1 + activeCases.length} cases (excluding 접수취소): ${allDocuments.length}`,
          );
        }

        let selectedDocs = allDocuments.filter((doc: any) =>
          selectedDocumentIds.includes(doc.id),
        );

        // Sort documents by: 1) case suffix (-0, -1, -2), then 2) category order within each case
        const categoryOrder: Record<string, number> = {
          // 1. 사진 (현장사진, 수리중, 복구완료)
          현장출동사진: 0,
          현장: 1,
          현장사진: 2,
          "수리중 사진": 3,
          수리중: 4,
          "복구완료 사진": 5,
          복구완료: 6,
          // 2. 기본자료 (보험금청구서, 개인정보동의서)
          "보험금 청구서": 10,
          보험금청구서: 11,
          "개인정보 동의서(가족용)": 12,
          개인정보동의서: 13,
          // 3. 증빙자료 (주민등록등본, 등기부등본, 건축물대장, 기타증빙자료)
          주민등록등본: 20,
          등기부등본: 21,
          건축물대장: 22,
          "기타증빙자료(민원일지 등)": 23,
          기타증빙자료: 24,
          // 4. 청구자료 (복구완료 및 위임장, 도급계약서, 부가세 청구자료)
          "복구완료 및 위임장": 30,
          도급계약서: 31,
          "부가세 청구자료": 34,
          부가세청구자료: 35,
        };

        // Helper: Extract case suffix number from case number (e.g., "260106005-0" -> 0, "260106005-1" -> 1)
        const getCaseSuffix = (docCaseId: string): number => {
          const caseNumber = caseNumberMap[docCaseId] || "";
          const match = caseNumber.match(/-(\d+)$/);
          return match ? parseInt(match[1], 10) : 999;
        };

        // Sort by: 1) case suffix, 2) category order within each case
        selectedDocs = selectedDocs.sort((a: any, b: any) => {
          // First: sort by case suffix (-0, -1, -2, etc.)
          const suffixA = getCaseSuffix(a.caseId);
          const suffixB = getCaseSuffix(b.caseId);
          if (suffixA !== suffixB) return suffixA - suffixB;

          // Second: sort by category order within same case
          const orderA = categoryOrder[a.category] ?? 99;
          const orderB = categoryOrder[b.category] ?? 99;
          return orderA - orderB;
        });
        console.log(
          `[Invoice Email] Selected documents found: ${selectedDocs.length}, sorted by case suffix then category`,
        );

        if (selectedDocs.length > 0) {
          const { PDFDocument, rgb } = await import("pdf-lib");
          const fontkit = (await import("@pdf-lib/fontkit")).default;
          const sharp = await import("sharp");
          const fs = await import("fs");
          const path = await import("path");

          const mergedPdf = await PDFDocument.load(pdfBuffer);

          // 한글 폰트 로드 (Pretendard 사용 - 글자 간격 문제 해결)
          mergedPdf.registerFontkit(fontkit);
          const fontsDir = path.join(process.cwd(), "server/fonts");
          const fontPath = path.join(fontsDir, "Pretendard-Regular.ttf");
          const fontBytes = fs.readFileSync(fontPath);
          const font = await mergedPdf.embedFont(fontBytes, { subset: false });

          // Helper function to get file buffer from Object Storage or DB
          const getFileBuffer = async (doc: any): Promise<Buffer | null> => {
            try {
              // 1. Object Storage에서 가져오기 (우선)
              if (doc.storageKey) {
                const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
                if (privateObjectDir) {
                  const fullPath = `${privateObjectDir}/${doc.storageKey}`;
                  const { ObjectStorageService } = await import(
                    "./replit_integrations/object_storage"
                  );
                  const storageService = new ObjectStorageService();
                  return await storageService.downloadToBuffer(fullPath);
                }
              }
              // 2. fileData에서 가져오기 (레거시)
              if (doc.fileData) {
                if (doc.fileData.startsWith("data:")) {
                  const base64Data = doc.fileData.split(",")[1];
                  return Buffer.from(base64Data, "base64");
                } else {
                  return Buffer.from(doc.fileData, "base64");
                }
              }
              // 3. DB에서 직접 가져오기 (레거시 파일)
              if (doc.id) {
                const fileData = await storage.getDocumentFileData(doc.id);
                if (fileData) {
                  if (fileData.startsWith("data:")) {
                    const base64Data = fileData.split(",")[1];
                    return Buffer.from(base64Data, "base64");
                  } else {
                    return Buffer.from(fileData, "base64");
                  }
                }
              }
              return null;
            } catch (err) {
              console.error(
                `[Invoice Email] Failed to get buffer for ${doc.fileName}:`,
                err,
              );
              return null;
            }
          };

          // Helper functions
          const isPdfFile = (mimeType: string, fileName: string): boolean => {
            if (mimeType === "application/pdf") return true;
            if (fileName?.toLowerCase().endsWith(".pdf")) return true;
            return false;
          };

          const isImageFile = (mimeType: string, fileName: string): boolean => {
            if (
              mimeType.startsWith("image/") &&
              !mimeType.includes("heic") &&
              !mimeType.includes("webp")
            )
              return true;
            const ext = fileName?.toLowerCase();
            if (
              ext?.endsWith(".jpg") ||
              ext?.endsWith(".jpeg") ||
              ext?.endsWith(".png") ||
              ext?.endsWith(".gif")
            )
              return true;
            return false;
          };

          // Common constants
          const A4_WIDTH = 595.28;
          const A4_HEIGHT = 841.89;
          const MARGIN = 30;
          const HEADER_HEIGHT = 20;
          const GAP = 8;

          // selectedDocs is already sorted by case suffix then category, use directly
          const sortedDocs = selectedDocs;

          console.log(
            `[Invoice Email] 문서 ${sortedDocs.length}개 케이스별/카테고리 순서로 정렬됨`,
          );

          // 2장/페이지 카테고리 목록 (현장사진, 수리중, 복구완료)
          const twoPerPageCategories = [
            "현장사진",
            "수리중",
            "복구완료",
            "현장출동사진",
            "수리중 사진",
            "복구완료 사진",
          ];
          const isTwoPerPageCategory = (category: string): boolean => {
            if (!category) return false;
            // 정확한 일치만 체크
            return twoPerPageCategories.includes(category);
          };

          // 헤더 텍스트 정규화 함수 (ASCII '-' 유지, U+2010/U+2212 치환 금지)
          const normalizeHeaderIdentifier = (text: string): string => {
            if (!text) return "";
            let s = String(text);
            // 1) 유니코드 공백을 일반 공백으로 통일 (NBSP, zero-width 등)
            s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");
            // 2) 대시류(en dash, em dash, minus)만 ASCII '-'로 통일
            s = s.replace(/[–—−]/g, "-");
            // 3) 코드 패턴([A-Za-z0-9]) 사이 하이픈에서만 공백 제거
            s = s.replace(/([A-Za-z0-9])\s*-\s*([A-Za-z0-9])/g, "$1-$2");
            // 4) 연속 공백 축소
            s = s.replace(/ {2,}/g, " ");
            return s.trim();
          };

          // Collect images for layout (2-per-page for some categories, 1-per-page for others)
          const pendingImages: {
            doc: any;
            buffer: Buffer;
            headerText: string;
            headerInfo: {
              accidentNo: string;
              address: string;
              category: string;
            };
          }[] = [];

          // 테이블 형태 헤더 그리기 헬퍼 함수 (현장출동보고서 스타일)
          const drawTableHeader = (
            page: any,
            x: number,
            y: number,
            width: number,
            height: number,
            headerInfo: {
              accidentNo: string;
              address: string;
              category: string;
            },
          ) => {
            // 열 너비 비율 (사고번호: 30%, 주소: 45%, 카테고리: 25%)
            const col1Width = width * 0.3;
            const col2Width = width * 0.45;
            const col3Width = width * 0.25;

            // 배경 (진한 회색 - 현장출동보고서 스타일)
            page.drawRectangle({
              x: x,
              y: y,
              width: width,
              height: height,
              color: rgb(0.2, 0.2, 0.2),
              borderColor: rgb(0.3, 0.3, 0.3),
              borderWidth: 0.5,
            });

            // 열 구분선
            page.drawLine({
              start: { x: x + col1Width, y: y },
              end: { x: x + col1Width, y: y + height },
              color: rgb(0.4, 0.4, 0.4),
              thickness: 0.5,
            });
            page.drawLine({
              start: { x: x + col1Width + col2Width, y: y },
              end: { x: x + col1Width + col2Width, y: y + height },
              color: rgb(0.4, 0.4, 0.4),
              thickness: 0.5,
            });

            // 텍스트 (s��색 - 어두운 배경에 맞춤)
            const textY = y + (height - 9) / 2;
            const textColor = rgb(1, 1, 1);
            const textSize = 8;

            // 정규화 적용 (ASCII '-' 유지)
            const normalizedAccidentNo = normalizeHeaderIdentifier(
              headerInfo.accidentNo,
            );
            const normalizedAddress = normalizeHeaderIdentifier(
              headerInfo.address || "-",
            );
            const normalizedCategory = normalizeHeaderIdentifier(
              headerInfo.category,
            );

            // 사고번호 정규화 결과 charCode 로그 (공백 문자 검증)
            console.log(
              "[Invoice Header] accidentNo RAW:",
              headerInfo.accidentNo,
            );
            console.log(
              "[Invoice Header] accidentNo NORM:",
              normalizedAccidentNo,
            );
            console.log(
              "[Invoice Header] accidentNo CODES:",
              Array.from(normalizedAccidentNo).map((c) =>
                c.charCodeAt(0).toString(16).padStart(4, "0"),
              ),
            );

            // 하이픈 간격 보정 함수 (사고번호, 주소 공용)
            const drawTextTight = (text: string, startX: number) => {
              if (!text || !text.includes("-")) {
                page.drawText(text || "", {
                  x: startX,
                  y: textY,
                  size: textSize,
                  font,
                  color: textColor,
                });
                return;
              }
              const offset = textSize * 0.06;
              const parts = text.split("-");
              let cursorX = startX;
              const hyphenWidth = font.widthOfTextAtSize("-", textSize);

              for (let i = 0; i < parts.length; i++) {
                if (parts[i]) {
                  page.drawText(parts[i], {
                    x: cursorX,
                    y: textY,
                    size: textSize,
                    font,
                    color: textColor,
                  });
                  cursorX += font.widthOfTextAtSize(parts[i], textSize);
                }
                if (i < parts.length - 1) {
                  page.drawText("-", {
                    x: cursorX,
                    y: textY,
                    size: textSize,
                    font,
                    color: textColor,
                  });
                  cursorX += hyphenWidth - offset;
                }
              }
            };

            // 사고번호
            drawTextTight(normalizedAccidentNo, x + 5);

            // 주소 (하이픈 간격 보정 적용)
            drawTextTight(normalizedAddress, x + col1Width + 5);

            // 카테고리
            page.drawText(normalizedCategory, {
              x: x + col1Width + col2Width + 5,
              y: textY,
              size: textSize,
              font,
              color: textColor,
            });
          };

          // Helper function to flush pending images with category-based layout
          const flushPendingImages = async () => {
            if (pendingImages.length === 0) return;

            const PAGE_HEADER_HEIGHT = 30;
            const imgWidth = A4_WIDTH - MARGIN * 2;

            let i = 0;
            while (i < pendingImages.length) {
              const currentImg = pendingImages[i];
              const category = currentImg.doc.category || "";
              const isTwoPerPage = isTwoPerPageCategory(category);

              if (isTwoPerPage) {
                // 2장/페이지 레이아웃 - 각 이미지 위에 개별 헤더 표시
                const page = mergedPdf.addPage([A4_WIDTH, A4_HEIGHT]);

                // 이미지 영역 계산 (각 이미지마다 개별 헤더 포함)
                const INDIVIDUAL_HEADER_HEIGHT = 24;
                const availableHeight = A4_HEIGHT - MARGIN * 2;
                // 각 슬롯: 헤더(24px) + 이미지영역 + GAP
                const slotHeight = (availableHeight - GAP) / 2;
                const imgHeight = slotHeight - INDIVIDUAL_HEADER_HEIGHT - GAP;

                // 최대 2장까지 배치
                let actualCount = 0;
                for (let j = 0; j < 2 && i + j < pendingImages.length; j++) {
                  const img = pendingImages[i + j];
                  // 다음 이미지가 다른 카테고리면 건너뛰기
                  if (j > 0 && !isTwoPerPageCategory(img.doc.category || ""))
                    break;

                  actualCount++;

                  // 슬롯 시작 위치 계산
                  const slotY =
                    j === 0
                      ? A4_HEIGHT - MARGIN - slotHeight
                      : A4_HEIGHT - MARGIN - slotHeight - GAP - slotHeight;

                  // 개별 헤더 그리기 (각 이미지 위) - 테이블 형태 (현장출동보고서 스타일)
                  drawTableHeader(
                    page,
                    MARGIN,
                    slotY + imgHeight + GAP,
                    imgWidth,
                    INDIVIDUAL_HEADER_HEIGHT,
                    img.headerInfo,
                  );

                  try {
                    const embeddedImage = await mergedPdf.embedJpg(img.buffer);
                    const dims = embeddedImage.scale(1);
                    let scale = Math.min(
                      imgWidth / dims.width,
                      imgHeight / dims.height,
                      1,
                    );
                    const finalW = dims.width * scale;
                    const finalH = dims.height * scale;
                    const imgX = MARGIN + (imgWidth - finalW) / 2;
                    const imgY = slotY + (imgHeight - finalH) / 2;

                    page.drawImage(embeddedImage, {
                      x: imgX,
                      y: imgY,
                      width: finalW,
                      height: finalH,
                    });
                  } catch (e) {
                    console.error(`[Invoice Email] Failed to embed image:`, e);
                  }
                }

                // 실제 배치된 이미지 개수만큼 스킵
                i += actualCount;
              } else {
                // 1장/페 � ��mo� 레이us�웃
                const page = mergedPdf.addPage([A4_WIDTH, A4_HEIGHT]);

                // 헤더 그리기 - 테이블 형태 (현장출동보고서 스타일)
                drawTableHeader(
                  page,
                  MARGIN,
                  A4_HEIGHT - MARGIN - PAGE_HEADER_HEIGHT,
                  imgWidth,
                  PAGE_HEADER_HEIGHT,
                  currentImg.headerInfo,
                );

                // 전체 페이지 이미지 영역
                const imgHeight =
                  A4_HEIGHT - MARGIN * 2 - PAGE_HEADER_HEIGHT - GAP;
                const yPos = MARGIN;

                try {
                  const embeddedImage = await mergedPdf.embedJpg(
                    currentImg.buffer,
                  );
                  const dims = embeddedImage.scale(1);
                  let scale = Math.min(
                    imgWidth / dims.width,
                    imgHeight / dims.height,
                    1,
                  );
                  const finalW = dims.width * scale;
                  const finalH = dims.height * scale;
                  const imgX = MARGIN + (imgWidth - finalW) / 2;
                  const imgY = yPos + (imgHeight - finalH) / 2;

                  page.drawImage(embeddedImage, {
                    x: imgX,
                    y: imgY,
                    width: finalW,
                    height: finalH,
                  });
                } catch (e) {
                  console.error(`[Invoice Email] Failed to embed image:`, e);
                }

                i += 1;
              }
            }

            console.log(
              `[Invoice Email] Added ${pendingImages.length} images (category-based layout)`,
            );
            pendingImages.length = 0;
          };

          // Process all documents in case suffix / category order
          for (const doc of sortedDocs) {
            const mimeType = doc.fileType || "";
            const fileName = doc.fileName || "";

            // Get header info for this document (보험사사고번호 + 해당 케이스의 주소 + 카테고리)
            const accidentNo = caseData.insuranceAccidentNo || "";
            // Use the address from the case this document belongs to
            const fullAddress = caseAddressMap[doc.caseId] || "";
            const docCategory = doc.category || "기타";
            const headerText = `[${accidentNo}] ${fullAddress} - ${docCategory}`;

            // 테이블 형태 헤더 정보 (현장출동보고서 스타일)
            const headerInfo = {
              accidentNo: `사고번호 ${accidentNo}`,
              address: fullAddress,
              category: docCategory,
            };

            if (isPdfFile(mimeType, fileName)) {
              // First, flush any pending images before adding PDF
              await flushPendingImages();

              // PDF document - 헤더와 PDF 내용 간격 40px 추가
              const PDF_HEADER_GAP = 40;
              try {
                const fileBuffer = await getFileBuffer(doc);
                if (!fileBuffer || fileBuffer.length === 0) {
                  console.warn(
                    `[Invoice Email] No data for PDF: ${doc.fileName}`,
                  );
                  continue;
                }

                const sourcePdf = await PDFDocument.load(fileBuffer);
                const pageCount = sourcePdf.getPageCount();

                for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
                  const srcPage = sourcePdf.getPage(pageIdx);
                  const { width, height } = srcPage.getSize();

                  // 새 페이지 생성 (헤더 + 간격 공간 추가)
                  const totalHeaderSpace =
                    MARGIN + HEADER_HEIGHT + PDF_HEADER_GAP;
                  const newPage = mergedPdf.addPage([
                    width,
                    height + totalHeaderSpace,
                  ]);

                  // 원본 PDF 페이지를 embed하여 아래쪽에 배치
                  const embeddedPage = await mergedPdf.embedPage(srcPage);
                  newPage.drawPage(embeddedPage, { x: 0, y: 0, width, height });

                  // 헤더 배경 (흰색)
                  newPage.drawRectangle({
                    x: 0,
                    y: height,
                    width: width,
                    height: totalHeaderSpace,
                    color: rgb(1, 1, 1),
                  });
                  // 헤더 - 테이블 형태 (현장출동보고서 스타일)
                  drawTableHeader(
                    newPage,
                    MARGIN,
                    height + PDF_HEADER_GAP,
                    width - MARGIN * 2,
                    HEADER_HEIGHT,
                    headerInfo,
                  );
                }
                console.log(
                  `[Invoice Email] Added PDF: ${doc.fileName} (${pageCount} pages) - ${doc.category}`,
                );
              } catch (pdfError) {
                console.error(
                  `[Invoice Email] Failed to add PDF ${doc.fileName}:`,
                  pdfError,
                );
              }
            } else if (isImageFile(mimeType, fileName)) {
              // Collect image for 2-per-page layout
              try {
                const fileBuffer = await getFileBuffer(doc);
                if (!fileBuffer || fileBuffer.length === 0) {
                  console.warn(
                    `[Invoice Email] No data for image: ${doc.fileName}`,
                  );
                  continue;
                }

                const imageBuffer = await sharp
                  .default(fileBuffer)
                  .resize(800, 600, { fit: "inside", withoutEnlargement: true })
                  .jpeg({ quality: 60, mozjpeg: true })
                  .toBuffer();

                pendingImages.push({
                  doc,
                  buffer: imageBuffer,
                  headerText,
                  headerInfo,
                });
                console.log(
                  `[Invoice Email] Queued image: ${doc.fileName} - ${doc.category}`,
                );
              } catch (err) {
                console.error(
                  `[Invoice Email] Failed to process image ${doc.fileName}:`,
                  err,
                );
              }
            }
          }

          // Flush remaining pending images
          await flushPendingImages();

          console.log(
            `[Invoice Email] Processed ${sortedDocs.length} documents in category order`,
          );

          pdfBuffer = Buffer.from(await mergedPdf.save());
          console.log(
            `[Invoice Email] Final merged PDF size: ${pdfBuffer.length} bytes`,
          );

          // Compress if too large (> 9MB)
          if (pdfBuffer.length > 9 * 1024 * 1024) {
            console.log(
              `[Invoice Email] Compressing PDF: ${Math.round((pdfBuffer.length / 1024 / 1024) * 100) / 100}MB...`,
            );
            const { compressPdfForEmail } = await import("./pdf-compression");
            pdfBuffer = await compressPdfForEmail(pdfBuffer);
            console.log(
              `[Invoice Email] Compressed to: ${Math.round((pdfBuffer.length / 1024 / 1024) * 100) / 100}MB`,
            );
          }
        }
      }

      // Format amounts
      const formatAmount = (amt: number) => amt.toLocaleString("ko-KR");
      const dateStr = new Date().toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      // Build amount lines for email
      const amountLines: string[] = [];
      if (damagePreventionAmount && damagePreventionAmount > 0) {
        amountLines.push(
          `- 손해방지비용: ${formatAmount(damagePreventionAmount)}원`,
        );
      }
      if (propertyRepairAmount && propertyRepairAmount > 0) {
        amountLines.push(
          `- 대물복구비용: ${formatAmount(propertyRepairAmount)}원`,
        );
      }
      if (fieldDispatchPreventionAmount && fieldDispatchPreventionAmount > 0) {
        amountLines.push(
          `- 현장출동비용: ${formatAmount(fieldDispatchPreventionAmount)}원`,
        );
      }
      if (fieldDispatchPropertyAmount && fieldDispatchPropertyAmount > 0) {
        amountLines.push(
          `- 현장출동비용: ${formatAmount(fieldDispatchPropertyAmount)}원`,
        );
      }
      amountLines.push(`- 합계: ${formatAmount(totalAmount)}원`);

      // Build email content (NO links, PDF is attached directly)
      const emailSubjectId =
        invoiceData.insuranceAccidentNo ||
        caseData.insurancePolicyNo ||
        invoiceData.caseNumber ||
        dateStr;
      const emailSubject = `[FLOXN] INVOICE - ${emailSubjectId}`;

      // 파일명을 이메일 제목과 동일하게 (특수문자 제거)
      const safeFilenameId = emailSubjectId.replace(/[<>:"/\\|?*]/g, "_");
      const invoiceFilename = `FLOXN INVOICE - ${safeFilenameId}.pdf`;

      // Get assessor and investigator names from case data fields
      const assessorName = caseData.assessorTeam || "-";
      const investigatorName = caseData.investigatorTeamName || "-";

      // 동일 사고번호의 모든 접수번호 수집 (접수취소 건 제외)
      const allCaseNumbers =
        allCases
          .filter((c) => c.status !== "접수취소")
          .map((c) => c.caseNumber)
          .filter(Boolean)
          .join(", ") || "-";

      const htmlContent = `
        <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">INVOICE 전달드립니다</h2>
          
          <p style="color: #666; line-height: 1.8;">안녕하세요,</p>
          
          <p style="color: #666; line-height: 1.8;">
            아래 내용의 <strong>INVOICE</strong>를 첨부하여 송부드립니다.
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 140px; font-weight: bold;">사고번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${invoiceData.insuranceAccidentNo || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">담당자</td>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold; width: 80px;">심사자</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${assessorName}</td>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold; width: 80px;">조사자</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${investigatorName}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">청구금액</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">
                ${amountLines.map((line) => `<div>${line}</div>`).join("")}
              </td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">접수번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${allCaseNumbers}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">발송일</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${dateStr}</td>
            </tr>
          </table>
          
          <p style="color: #666; line-height: 1.8;">
            첨부된 PDF 파일을 확인해 주시기 바랍니다.
          </p>
          
          <p style="color: #666; line-height: 1.8; margin-top: 30px;">
            감사합니다.
          </p>
          
          <div style="border-top: 1px solid #ddd; padding-top: 16px; margin-top: 24px;">
            ${logoBuffer ? '<img src="cid:floxn-logo" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">' : '<p style="font-size: 18px; font-weight: bold; color: #333; margin: 0 0 4px 0;">FLOXN</p>'}
            <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">Front·Line·Ops·Xpert·Net</p>
            <p style="font-size: 12px; color: #666; margin: 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
            <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
          </div>
        </div>
      `;

      const textContent = `안녕하세요,

INVOICE를 첨부하여 전달드립니다.

- 사고번호: ${invoiceData.insuranceAccidentNo || "-"}
- 담당자: 심사자 ${assessorName} / 조사자 ${investigatorName}

청구금액:
${amountLines.join("\n")}

- 접수번호: ${allCaseNumbers}
- 발송일: ${dateStr}

첨부된 PDF 파일을 확인해 주시기 바랍니다.

감사합니다.

---
FLOXN
Front·Line·Ops·Xpert·Net
주식회사 플록슨(FLOXN Co., Ltd.)
서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호`;

      // Build attachments array: Invoice PDF (with merged documents) + Logo
      const attachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
        cid?: string;
      }> = [
        {
          filename: invoiceFilename,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ];

      // 로고가 있으면 CID 첨부파일로 추가
      if (logoBuffer) {
        attachments.push({
          filename: "floxn-logo.png",
          content: logoBuffer,
          contentType: "image/png",
          cid: "floxn-logo",
        });
      }

      // Log attachment summary before sending
      console.log(`\n========== SMTP 첨부   ���일 요약 ==========`);
      console.log(
        `${invoiceFilename}: ${Math.round((pdfBuffer.length / 1024 / 1024) * 1000) / 1000}MB`,
      );
      console.log(`총 첨부 파일 개수: ${attachments.length}`);
      console.log(`==========================================\n`);

      // Send email with all PDF attachments - 여러 수신자 지원
      const allRecipients = emailList.join(", ");
      console.log(
        `[Invoice Email] Sending ${attachments.length} PDF attachments to ${emailList.length} recipients: ${allRecipients}`,
      );
      const emailResult = await sendEmailWithAttachment({
        to: allRecipients,
        subject: emailSubject,
        text: textContent,
        html: htmlContent,
        attachments,
      });

      if (!emailResult.success) {
        console.error(`[Invoice Email] Failed to send: ${emailResult.error}`);
        return res
          .status(500)
          .json({ error: `이메일 전송 실패: ${emailResult.error}` });
      }

      console.log(
        `[Invoice Email] ${attachments.length} PDF attachments sent successfully to ${emailList.length} recipients by ${user.username}`,
      );
      res.json({
        success: true,
        message: `INVOICE PDF가 ${emailList.length}명에게 이메일 첨부파일로 전송되었습니다`,
        attachmentCount: attachments.length,
        recipientCount: emailList.length,
      });
    } catch (error) {
      console.error("Send invoice email v2 error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "INVOICE 이메일 전송 중 오류가 발생했습니다";
      res.status(500).json({ error: errorMessage });
    }
  });

  // ==========================================
  // POST /api/send-field-dispatch-invoice-email - 현장출동비용 청구서 PDF 이메일 전송 (선견적요청용)
  // ==========================================
  app.post("/api/send-field-dispatch-invoice-email", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    try {
      const {
        email,
        pdfBase64,
        caseNumber,
        caseId,
        insuranceCompany,
        accidentNo,
        fieldDispatchAmount,
        totalAmount,
        remarks,
        selectedDocumentIds = [],
      } = req.body;

      if (!email || !pdfBase64) {
        return res
          .status(400)
          .json({ error: "이메일 주소와 PDF 데이터가 필요합니다" });
      }

      const dateStr = new Date().toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const timestamp = Date.now();
      const fileName = `field_dispatch_invoice_${caseNumber || "unknown"}_${timestamp}.pdf`;

      // Convert base64 to buffer
      let pdfBuffer = Buffer.from(pdfBase64, "base64");

      // If documents are selected and caseId provided, merge them into the PDF
      if (caseId && selectedDocumentIds && selectedDocumentIds.length > 0) {
        console.log(
          `[Field Dispatch PDF] Merging ${selectedDocumentIds.length} documents into PDF`,
        );

        const { PDFDocument } = await import("pdf-lib");
        const mainPdf = await PDFDocument.load(pdfBuffer);

        // Fetch selected documents
        const allDocuments = await storage.getDocumentsByCaseId(caseId);
        let selectedDocs = allDocuments.filter((doc: { id: string }) =>
          selectedDocumentIds.includes(doc.id),
        );

        // Sort documents by category order: 사진 > 기본자료 > 증빙자료 > 청구자료
        const categoryOrder: Record<string, number> = {
          // 1. 사진 (현장사진, 수리중, 복구완료)
          현장출동사진: 0,
          현장: 1,
          현장사진: 2,
          "수리중 사진": 3,
          수리중: 4,
          "복구완료 사진": 5,
          복구완료: 6,
          // 2. 기본자료 (보험금청구서, 개인정보동의서)
          "보험금 청구서": 10,
          보험금청구서: 11,
          "개인정보 동의서(가족용)": 12,
          개인정보동의서: 13,
          // 3. 증빙자료 (주민등록등본, 등기부등본, 건축물대장, 기타증빙자료)
          주민등록등본: 20,
          등기부등본: 21,
          건축물대장: 22,
          "기타증빙자료(민원일지 등)": 23,
          기타증빙자료: 24,
          // 4. 청구자료 (복구완료 및 위임장, 도급계약서, 부가세 청구자료)
          "복구완료 및 위임장": 30,
          도급계약서: 31,
          "부가세 청구자료": 34,
          부가세청구자료: 35,
        };
        selectedDocs = selectedDocs.sort((a: any, b: any) => {
          const orderA = categoryOrder[a.category] ?? 99;
          const orderB = categoryOrder[b.category] ?? 99;
          return orderA - orderB;
        });
        console.log(
          `[Field Dispatch PDF] Selected documents: ${selectedDocs.length}, sorted by category`,
        );

        for (const doc of selectedDocs) {
          try {
            if (!doc.fileData) continue;

            // Extract base64 data from data URL
            const base64Match = doc.fileData.match(
              /^data:([^;]+);base64,(.+)$/,
            );
            if (!base64Match) continue;

            const mimeType = base64Match[1];
            const base64Data = base64Match[2];
            const imageBytes = Buffer.from(base64Data, "base64");

            // Create a new page for each image
            const A4_WIDTH = 595.28;
            const A4_HEIGHT = 841.89;

            let embeddedImage;
            if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
              embeddedImage = await mainPdf.embedJpg(imageBytes);
            } else if (mimeType === "image/png") {
              embeddedImage = await mainPdf.embedPng(imageBytes);
            } else {
              console.log(
                `[Field Dispatch PDF] Skipping unsupported file type: ${mimeType}`,
              );
              continue;
            }

            // Calculate dimensions to fit image on A4 page with margins
            const margin = 40;
            const maxWidth = A4_WIDTH - margin * 2;
            const maxHeight = A4_HEIGHT - margin * 2;

            let width = embeddedImage.width;
            let height = embeddedImage.height;

            const widthRatio = maxWidth / width;
            const heightRatio = maxHeight / height;
            const scale = Math.min(widthRatio, heightRatio, 1);

            width *= scale;
            height *= scale;

            const page = mainPdf.addPage([A4_WIDTH, A4_HEIGHT]);
            const x = (A4_WIDTH - width) / 2;
            const y = (A4_HEIGHT - height) / 2;

            page.drawImage(embeddedImage, {
              x,
              y,
              width,
              height,
            });

            console.log(`[Field Dispatch PDF] Added document: ${doc.fileName}`);
          } catch (docError) {
            console.error(
              `[Field Dispatch PDF] Failed to add document ${doc.fileName}:`,
              docError,
            );
          }
        }

        pdfBuffer = Buffer.from(await mainPdf.save());
        console.log(
          `[Field Dispatch PDF] Final PDF with documents, size: ${pdfBuffer.length} bytes`,
        );
      }

      // Upload PDF to Object Storage
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        console.error(
          "[send-field-dispatch-invoice-email] Missing Object Storage bucket ID",
        );
        return res
          .status(500)
          .json({ error: "Object Storage 설정이 필요합니다" });
      }

      const bucket = objectStorageClient.bucket(bucketId);
      const objectName = `public/invoice-pdfs/${fileName}`;
      const file = bucket.file(objectName);

      // Upload the PDF
      await file.save(pdfBuffer, {
        contentType: "application/pdf",
        metadata: {
          "custom:aclPolicy": JSON.stringify({
            owner: user.id,
            visibility: "public",
          }),
        },
      });

      // Generate signed URL for PDF (7 days validity)
      const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
      const pdfUrl = await signObjectURL({
        bucketName: bucketId,
        objectName: objectName,
        method: "GET",
        ttlSec: SIGNED_URL_TTL_SEC,
      });

      console.log(
        `[PDF Upload] Field dispatch invoice PDF uploaded with signed URL`,
      );

      // Format amounts
      const formatAmount = (amount: number) => amount.toLocaleString("ko-KR");

      // Send email via Hiworks SMTP with PDF attachment
      const subject = `[FLOXN] 현장출동비용 청구서 - ${accidentNo || caseNumber || dateStr}`;

      const htmlContent = `
        <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">현장출동비용 청구서</h2>
          
          <p style="color: #666; line-height: 1.8;">안녕하세요,</p>
          
          <p style="color: #666; line-height: 1.8;">
            아래 청구건에 대한 <strong>현장출동비용 청구서</strong>를 첨부하여 송부드립니다.
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 30%; font-weight: bold;">보험사</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${insuranceCompany || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">사고번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${accidentNo || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">사건번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${caseNumber || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">현장출동비용</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd; font-weight: bold; color: #0066cc;">${formatAmount(fieldDispatchAmount || 0)}원</td>
            </tr>
            ${
              remarks
                ? `<tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">비고</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${remarks}</td>
            </tr>`
                : ""
            }
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">발송일</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${dateStr}</td>
            </tr>
          </table>
          
          <p style="color: #666; line-height: 1.8;">
            첨부된 현장출동비용 청구서 PDF 파일을 확인해 주시기 바랍니다.
          </p>
          
          <p style="color: #666; line-height: 1.8; margin-top: 30px;">
            감사합니다.<br/>
            <strong>FLOXN</strong><br/>
            <span style="font-size: 12px; color: #999;">주식회사 플록슨(FLOXN Co., Ltd.)</span>
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />
          
          <p style="color: #999; font-size: 12px;">
            본 메일은 FLOXN 시스템에서 자동 발송되었습니다.
          </p>
        </div>
      `;

      const textContent = `현장출동비용 청구서

안녕하세요,

아래 청구건에 대한 현장출동비용 청구서를 첨부하여 송부드립니다.

- 보험사: ${insuranceCompany || "-"}
- 사고번호: ${accidentNo || "-"}
- 사건번호: ${caseNumber || "-"}
- 현장출동비용: ${formatAmount(fieldDispatchAmount || 0)}원
${remarks ? `- 비고: ${remarks}` : ""}
- 발송일: ${dateStr}

첨부된 현장출동비용 청구서 PDF 파일을 확인해 주시기 바랍니다.

감사합니다.
FLOXN
주식회사 플록슨(FLOXN Co., Ltd.)`;

      // Use Hiworks SMTP with PDF attachment
      const emailResult = await sendEmailWithAttachment({
        to: email,
        subject,
        text: textContent,
        html: htmlContent,
        attachments: [
          {
            filename: fileName,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      if (!emailResult.success) {
        console.error(
          `[Email] Field dispatch invoice email failed:`,
          emailResult.error,
        );
        return res
          .status(500)
          .json({ error: `이메일 전송 실패: ${emailResult.error}` });
      }

      console.log(
        `[Email] Field dispatch invoice PDF sent successfully to ${email} by ${user.username} (MessageId: ${emailResult.messageId})`,
      );
      res.json({
        success: true,
        message: "현장출동비용 청구서 이메일이 전송되었습니다",
        pdfUrl,
      });
    } catch (error) {
      console.error("Send field dispatch invoice email error:", error);
      res.status(500).json({
        error: "현장출동비용 청구서 이메일 전송 중 오류가 발생했습니다",
      });
    }
  });

  // ==========================================
  // POST /api/generate-document-urls - 증빙자료 서명 URL 생성 (PDF용)
  // ==========================================
  app.post("/api/generate-document-urls", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    // 역할 기반 접근 제어 - 협력사, 관리자, 심사사만 허용
    const allowedRoles = ["협력사", "관리자", "심사사"];
    if (!allowedRoles.includes(user.role)) {
      return res
        .status(403)
        .json({ error: "증빙자료 URL 생성 권한이 없습니다" });
    }

    try {
      const { caseId } = req.body;
      if (!caseId) {
        return res.status(400).json({ error: "caseId가 필요합니다" });
      }

      // 사건 존재 여부 및 접근 권한 확인
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "사건을 찾을 수 없습니다" });
      }

      // 관리자가 아닌 경우, 사건에 배정된 협력사인지 확인
      if (user.role !== "관리자") {
        const isAssignedPartner =
          user.role === "협력사" && caseData.assignedPartner === user.company;
        const isAssignedAssessor =
          user.role === "심사사" && caseData.assessorId === user.id;

        if (!isAssignedPartner && !isAssignedAssessor) {
          return res
            .status(403)
            .json({ error: "해당 사건에 대한 접근 권한이 없습니다" });
        }
      }

      const documents = await storage.getDocumentsByCaseId(caseId);
      if (!documents || documents.length === 0) {
        return res.json({ documentLinks: [] });
      }

      console.log(
        `[generate-document-urls] Found ${documents.length} documents for case ${caseId}`,
      );

      // Get private object directory
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateObjectDir) {
        console.warn("[generate-document-urls] PRIVATE_OBJECT_DIR not set");
        return res.json({ documentLinks: [] });
      }

      // Parse bucket name from private object dir
      const privateDirParts = privateObjectDir.startsWith("/")
        ? privateObjectDir.slice(1).split("/")
        : privateObjectDir.split("/");
      const privateBucketName = privateDirParts[0];
      const privatePrefix = privateDirParts.slice(1).join("/");
      const privateBucket = objectStorageClient.bucket(privateBucketName);

      const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
      const timestamp = Date.now();
      const documentLinks: Array<{
        category: string;
        fileName: string;
        url: string;
      }> = [];

      for (const doc of documents) {
        try {
          const fileBuffer = Buffer.from(doc.fileData, "base64");
          const sanitizedFileName = doc.fileName.replace(
            /[^a-zA-Z0-9가-힣._-]/g,
            "_",
          );
          const docObjectName = `${privatePrefix}/case-documents/${caseId}/${timestamp}_${sanitizedFileName}`;
          const docFile = privateBucket.file(docObjectName);

          // Upload to private storage
          await docFile.save(fileBuffer, {
            contentType: doc.fileType,
            metadata: {
              "custom:aclPolicy": JSON.stringify({
                owner: user.id,
                visibility: "private",
              }),
            },
          });

          // Generate signed URL
          const docUrl = await signObjectURL({
            bucketName: privateBucketName,
            objectName: docObjectName,
            method: "GET",
            ttlSec: SIGNED_URL_TTL_SEC,
          });

          documentLinks.push({
            category: doc.category,
            fileName: doc.fileName,
            url: docUrl,
          });

          console.log(
            `[generate-document-urls] Generated signed URL for: ${doc.fileName}`,
          );
        } catch (docError) {
          console.error(
            `[generate-document-urls] Failed for ${doc.fileName}:`,
            docError,
          );
        }
      }

      res.json({ documentLinks });
    } catch (error) {
      console.error("Generate document URLs error:", error);
      res
        .status(500)
        .json({ error: "o��빙자료 URL 생성 중 오류가 발생했습니다" });
    }
  });

  // ==========================================
  // POST /api/send-field-report-email - 현장조사 리포트 PDF 이메일 전송 (Bubble.io)
  // ==========================================
  const sendFieldReportEmailSchema = z.object({
    email: z.string().email("올바른 이메일 형식이 아닙니다").optional(), // 하위 호환성
    emails: z
      .array(z.string().email("올바른 이메일 형식이 아닙니다"))
      .optional(), // 여러 수신자 지원
    pdfBase64: z.string().min(1, "PDF 데이터가 필요합니다"),
    caseId: z.string().optional(),
    caseNumber: z.string().optional(),
    insuranceCompany: z.string().optional(),
    accidentNo: z.string().optional(),
    clientName: z.string().optional(),
    insuredName: z.string().optional(),
    visitDate: z.string().optional().nullable(),
    accidentCategory: z.string().optional().nullable(),
    accidentCause: z.string().optional().nullable(),
    recoveryMethodType: z.string().optional().nullable(),
  });

  app.post("/api/send-field-report-email", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    // 역할 기반 접근 제어 - 협력사, 관리자, 심사사만 허용
    const allowedRoles = ["협력사", "관리자", "심사사"];
    if (!allowedRoles.includes(user.role)) {
      return res
        .status(403)
        .json({ error: "현장조사 리포트 이메일 전송 권한이 없습니다" });
    }

    try {
      // Zod 검증
      const validationResult = sendFieldReportEmailSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map((e) => e.message)
          .join(", ");
        return res.status(400).json({ error: errorMessage });
      }

      const {
        email,
        emails: emailsList,
        pdfBase64,
        caseId,
        caseNumber,
        insuranceCompany,
        accidentNo,
        clientName,
        insuredName,
        visitDate,
        accidentCategory,
        accidentCause,
        recoveryMethodType,
      } = validationResult.data;

      // 이메일 수신자 결정 (emails 배열 우선, 없으면 단일 email 사용)
      const recipients =
        emailsList && emailsList.length > 0 ? emailsList : email ? [email] : [];

      if (recipients.length === 0) {
        return res.status(400).json({ error: "수신자 이메일이 필요합니다" });
      }

      const dateStr = new Date().toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const timestamp = Date.now();
      const fileName = `field-report_${caseNumber || timestamp}_${timestamp}.pdf`;

      // Convert base64 to buffer
      const pdfBuffer = Buffer.from(pdfBase64, "base64");

      // Upload PDF to Object Storage
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        console.error(
          "[send-field-report-email] Missing Object Storage bucket ID",
        );
        return res
          .status(500)
          .json({ error: "Object Storage 설정이 필요합니다" });
      }

      const bucket = objectStorageClient.bucket(bucketId);
      const objectName = `public/field-report-pdfs/${fileName}`;
      const file = bucket.file(objectName);

      // Upload the PDF
      await file.save(pdfBuffer, {
        contentType: "application/pdf",
        metadata: {
          "custom:aclPolicy": JSON.stringify({
            owner: user.id,
            visibility: "public",
          }),
        },
      });

      // Generate signed URL for PDF (7 days validity)
      const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
      const pdfUrl = await signObjectURL({
        bucketName: bucketId,
        objectName: objectName,
        method: "GET",
        ttlSec: SIGNED_URL_TTL_SEC,
      });

      console.log(`[PDF Upload] Field Report PDF uploaded with signed URL`);

      // 증빙자료 다운로드 링크 생성
      let documentLinksSection = "";
      if (caseId) {
        try {
          const documents = await storage.getDocumentsByCaseId(caseId);
          if (documents && documents.length > 0) {
            const categoryOrder = [
              "현장출동사진",
              "수리중 사진",
              "복구완료 사진",
              "보험금 청구서",
              "개인정보 동의서(가족용)",
              "주민등록등본",
              "등기부등본",
              "건축물대장",
              "기타증빙자료(민원일지 등)",
              "복구완료 및 위임장",
              "도급계약서",
              "부가세 청구자료",
            ];

            // Private object directory 설정
            const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
            if (privateObjectDir) {
              const privateDirParts = privateObjectDir.startsWith("/")
                ? privateObjectDir.slice(1).split("/")
                : privateObjectDir.split("/");
              const privateBucketName = privateDirParts[0];
              const privatePrefix = privateDirParts.slice(1).join("/");
              const privateBucket =
                objectStorageClient.bucket(privateBucketName);

              const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
              const emailTimestamp = Date.now();

              // 카테고리별 그룹화
              const categoryGroups: Record<
                string,
                Array<{ fileName: string; url: string }>
              > = {};

              for (const doc of documents) {
                if (!doc.fileData || !doc.category) continue;

                try {
                  const fileBuffer = Buffer.from(doc.fileData, "base64");
                  const sanitizedFileName = doc.fileName.replace(
                    /[^a-zA-Z0-9가-힣._-]/g,
                    "_",
                  );
                  const docObjectName = `${privatePrefix}/email-documents/${caseId}/${emailTimestamp}_${sanitizedFileName}`;
                  const docFile = privateBucket.file(docObjectName);

                  // Upload to private storage
                  await docFile.save(fileBuffer, {
                    contentType: doc.fileType,
                    metadata: {
                      "custom:aclPolicy": JSON.stringify({
                        owner: user.id,
                        visibility: "private",
                      }),
                    },
                  });

                  // Generate signed URL
                  const docUrl = await signObjectURL({
                    bucketName: privateBucketName,
                    objectName: docObjectName,
                    method: "GET",
                    ttlSec: SIGNED_URL_TTL_SEC,
                  });

                  if (!categoryGroups[doc.category]) {
                    categoryGroups[doc.category] = [];
                  }
                  categoryGroups[doc.category].push({
                    fileName: doc.fileName || "unknown",
                    url: docUrl,
                  });
                } catch (docUploadErr) {
                  console.error(
                    `[Email] Failed to generate signed URL for ${doc.fileName}:`,
                    docUploadErr,
                  );
                }
              }

              // 카테고리 순서대로 정렬
              const allCategories = [
                ...categoryOrder,
                ...Object.keys(categoryGroups).filter(
                  (c) => !categoryOrder.includes(c),
                ),
              ];

              let linksText =
                "\n\n■ 증빙자료 다운로드 (링크는 7일간 유효합니다)\n";
              let hasLinks = false;

              for (const category of allCategories) {
                if (
                  !categoryGroups[category] ||
                  categoryGroups[category].length === 0
                )
                  continue;
                hasLinks = true;
                linksText += `\n[${category}]\n`;
                for (const docLink of categoryGroups[category]) {
                  linksText += `  - ${docLink.fileName}\n    ${docLink.url}\n`;
                }
              }

              if (hasLinks) {
                documentLinksSection = linksText;
              }
            }
          }
        } catch (docError) {
          console.error(
            "[Email] Error fetching documents for email:",
            docError,
          );
        }
      }

      // Send email via Bubble.io API with PDF link and document links
      const emailContent = `안녕하세요,

현장조사 리포트를 전송해드립니다.

■ 사건 정보
- 보험사: ${insuranceCompany || "-"}
- 사고번호: ${accidentNo || "-"}
- 사건번호: ${caseNumber || "-"}
- 의뢰사: ${clientName || "-"}

■ 피보험자 정보
- 피보험자: ${insuredName || "-"}

■ 현장조사 정보
- 방문일: ${visitDate || "-"}
- 사고분류: ${accidentCategory || "-"}
- 사고원인: ${accidentCause || "-"}
- 처리유형: ${recoveryMethodType || "-"}

■ 현장조사 리포트 PDF
아래 링크를 클릭하시면 다운로드하실 수 있습니다:
${pdfUrl}
${documentLinksSection}

- 발송일: ${dateStr}
- 발송자: ${user.name || user.username}

감사합니다.
FLOXN 드림`;

      // 모든 수신자에게 이메일 전송
      const sendResults: { email: string; success: boolean; error?: string }[] =
        [];

      for (const recipientEmail of recipients) {
        try {
          await sendNotificationEmail(
            recipientEmail,
            `FLOXN 현장조사 리포트 - ${caseNumber || dateStr}`,
            emailContent,
          );
          sendResults.push({ email: recipientEmail, success: true });
          console.log(
            `[Email] Field Report PDF link sent successfully to ${recipientEmail} by ${user.username}`,
          );
        } catch (sendError) {
          console.error(
            `[Email] Failed to send to ${recipientEmail}:`,
            sendError,
          );
          sendResults.push({
            email: recipientEmail,
            success: false,
            error: sendError instanceof Error ? sendError.message : "전송 실패",
          });
        }
      }

      const successCount = sendResults.filter((r) => r.success).length;
      const failedCount = sendResults.filter((r) => !r.success).length;

      if (successCount === 0) {
        return res.status(500).json({
          error: "모든 이메일 전송에 실패했습니다",
          details: sendResults.filter((r) => !r.success),
        });
      }

      const message =
        failedCount > 0
          ? `${successCount}명에게 전송 완료, ${failedCount}명 전송 실패`
          : `${successCount}명에게 현장조사 리포트 이메일이 전송되었습니다`;

      res.json({ success: true, message, pdfUrl, results: sendResults });
    } catch (error) {
      console.error("Send field report email error:", error);
      res
        .status(500)
        .json({ error: "현장조사 리포트 이메일 전송 중 오류가 발생했습니다" });
    }
  });

  // ==========================================
  // POST /api/send-field-report-email-v2 - 서버 측 PDF 생성 후 이메일 전송
  // ==========================================
  const sendFieldReportEmailV2Schema = z.object({
    emails: z
      .array(z.string().email("올바른 이메일 형식이 아닙니다"))
      .min(1, "수신자 이메일이 필요합니다"),
    caseId: z.string().min(1, "케이스 ID가 필요합니다"),
    sections: z.object({
      cover: z.boolean().default(true),
      fieldReport: z.boolean().default(true),
      drawing: z.boolean().default(true),
      evidence: z.boolean().default(true),
      estimate: z.boolean().default(true),
      etc: z.boolean().default(false),
    }),
    evidence: z
      .object({
        tab: z.string().default("전체"),
        selectedFileIds: z.array(z.string()).default([]),
      })
      .default({ tab: "전체", selectedFileIds: [] }),
  });

  app.post("/api/send-field-report-email-v2", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(403).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    const allowedRoles = ["협력사", "관리자", "심사사"];
    if (!allowedRoles.includes(user.role)) {
      return res
        .status(403)
        .json({ error: "현장조사 리포트 이메일 전송 권한이 없습니다" });
    }

    try {
      const validationResult = sendFieldReportEmailV2Schema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map((e) => e.message)
          .join(", ");
        return res.status(400).json({ error: errorMessage });
      }

      const { emails, caseId, sections, evidence } = validationResult.data;

      // 케이스 정보 조회
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // ========== 현장출동보고서 PDF 생성 (증빙자료 이미지 및 PDF 모두 포함) ==========
      console.log(
        `[send-field-report-email-v2] Generating PDF for case ${caseId} (with all evidence including PDFs)`,
      );
      const mainPdfBuffer = await generatePdfWithSizeLimitPdfLib({
        caseId,
        sections,
        evidence,
        skipEvidence: false, // 증빙자료 이미지 포함
        skipPdfAttachments: false, // p��로드된 PDF 파일도 포함
      });
      console.log(
        `[send-field-report-email-v2] PDF generated: ${Math.round(mainPdfBuffer.length / 1024)}KB (${(mainPdfBuffer.length / 1024 / 1024).toFixed(2)}MB)`,
      );

      // ========== 첨부파일 준비 (단일 PDF) ==========
      // 파일명 우선순위: 사고번호 > 증권번호 > 접수번호
      // 스키마 필드: insuranceAccidentNo(사고번호), insurancePolicyNo(증권번호), caseNumber(접수번호)
      console.log(
        `[send-field-report-email-v2] 파일명 생성 데이터 - insuranceAccidentNo: "${caseData.insuranceAccidentNo}", insurancePolicyNo: "${caseData.insurancePolicyNo}", caseNumber: "${caseData.caseNumber}"`,
      );
      const accidentNo =
        caseData.insuranceAccidentNo ||
        caseData.insurancePolicyNo ||
        caseData.caseNumber ||
        "UNKNOWN";
      console.log(
        `[send-field-report-email-v2] 선택된 accidentNo: "${accidentNo}"`,
      );

      // -0 (손해방지/피보험자) 건: 피보험자 상세주소 사용
      // -1 이상 (피해자 복구) 건: 피해자 상세주소 사용
      const isLossPreventionCase = /-0$/.test(caseData.caseNumber || "");
      const detailAddress = isLossPreventionCase
        ? caseData.insuredAddressDetail || caseData.insuredAddress || ""
        : caseData.victimAddressDetail ||
          caseData.victimAddress ||
          caseData.insuredAddressDetail ||
          caseData.insuredAddress ||
          "";

      // 파일명에 사용할 수 없는 특수문자 제거
      const safeDetailAddress = detailAddress.replace(/[<>:"/\\|?*]/g, "_");
      const mainFileName = safeDetailAddress
        ? `현장출동보고서 _${accidentNo} (${safeDetailAddress}).pdf`
        : `현장출동보고서 _${accidentNo}.pdf`;

      const attachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }> = [
        {
          filename: mainFileName,
          content: mainPdfBuffer,
          contentType: "application/pdf",
        },
      ];

      // ========== 첨부파일 용량 검  � ==========
      let totalBytes = 0;
      console.log(`[send-field-report-email-v2] ===== 첨부파일 상세 =====`);
      for (const att of attachments) {
        const sizeKB = Math.round(att.content.length / 1024);
        const sizeMB = (att.content.length / (1024 * 1024)).toFixed(2);
        console.log(
          `[send-field-report-email-v2]   - ${att.filename}: ${sizeKB}KB (${sizeMB}MB)`,
        );
        totalBytes += att.content.length;
      }
      const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
      console.log(
        `[send-field-report-email-v2] ===== 총 첨부파일: ${attachments.length}개, ${totalMB}MB =====`,
      );

      // 25MB 초과 시 경고 (Hiworks SMTP 제한)
      if (totalBytes > 25 * 1024 * 1024) {
        console.warn(
          `[send-field-report-email-v2] 경고: 총 첨부파일 용량 ${totalMB}MB가 25MB를 초과합니다. SMTP 552 오류 가능성`,
        );
      }

      const dateStr = new Date()
        .toLocaleDateString("ko-KR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
        .replace(/\./g, "-")
        .replace(/ /g, "")
        .replace(/-$/, "");

      // 로고 파일 읽기 (CID 첨부용)
      let logoBuffer: Buffer | null = null;
      try {
        const logoPath = path.join(
          process.cwd(),
          "server",
          "assets",
          "floxn-logo.png",
        );
        if (fs.existsSync(logoPath)) {
          logoBuffer = fs.readFileSync(logoPath);
          console.log(
            `[send-field-report-email-v2] Logo loaded: ${logoBuffer.length} bytes`,
          );
        } else {
          console.warn(
            `[send-field-report-email-v2] Logo file not found: ${logoPath}`,
          );
        }
      } catch (logoError) {
        console.warn(
          `[send-field-report-email-v2] Failed to load logo:`,
          logoError,
        );
      }

      // HTML 이메일 본문 생성 (표 형식, 링크 없음)
      const emailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 40px; border-radius: 8px;">
    <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 8px; color: #333;">현장출동보고서 송부</h1>
    <hr style="border: none; border-top: 3px solid #e85a1b; margin-bottom: 24px;">
    
    <p style="color: #333; margin-bottom: 16px;">안녕하세요.<br>아래 접수건에 대한 현장출동보고서를 첨부하여 송부드립니다.</p>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold; width: 120px;">사고번호(증권번호)</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;" colspan="4">${caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">담당자</td>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold; width: 80px;">심사자</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;">${caseData.assessorTeam || "-"}</td>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold; width: 80px;">조사자</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;">${caseData.investigatorTeamName || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">피보험자</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;" colspan="4">${caseData.insuredName || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">접수번호</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;" colspan="4">${caseData.caseNumber || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">발송일</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;" colspan="4">${new Date().toISOString().split("T")[0]}</td>
      </tr>
    </table>
    
    <p style="color: #333; margin-bottom: 24px;">첨부된 PDF 파일을 확인해 주시기 바랍니다.</p>
    
    <p style="color: #333; margin-bottom: 16px;">감사합니다.</p>
    
    <div style="border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 24px;">
      ${logoBuffer ? '<img src="cid:floxn-logo" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">' : '<p style="font-size: 18px; font-weight: bold; color: #333; margin: 0 0 4px 0;">FLOXN</p>'}
      <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">Front·Line·Ops·Xpert·Net</p>
      <p style="font-size: 12px; color: #666; margin: 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
      <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
    </div>
  </div>
</body>
</html>`;

      // 텍스트 버전 (HTML 미지원 클라이언트용)
      const emailText = `현장출동보고서 송부

안녕하세요.
아래 접수건에 대한 현장출동보고서를 첨부하여 송부드립니다.

사고번호: ${caseData.insuranceAccidentNo || "-"}
심사자: ${caseData.assessorTeam || "-"}
조사자: ${caseData.investigatorTeamName || "-"}
피보험자: ${caseData.insuredName || "-"}
접수번호: ${caseData.caseNumber || "-"}
발송일: ${new Date().toISOString().split("T")[0]}

첨부된 PDF 파일을 확인해 주시기 바랍니다.

감사합니다.

---
FLOXN
Front·Line·Ops·Xpert·Net
주식회사 플록슨(FLOXN Co., Ltd.)
서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호`;

      // ========== 이메일 전송 (PDF 직접 첨부) ==========
      // 최종 첨부파일 배열 생성 (로고 포함)
      const finalAttachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
        cid?: string;
      }> = [...attachments];

      // 로고가 있으면 CID 첨부파일로 추가
      if (logoBuffer) {
        finalAttachments.push({
          filename: "floxn-logo.png",
          content: logoBuffer,
          contentType: "image/png",
          cid: "floxn-logo",
        });
      }

      const sendResults: { email: string; success: boolean; error?: string }[] =
        [];

      for (const recipientEmail of emails) {
        try {
          console.log(
            `[send-field-report-email-v2] Sending email to ${recipientEmail} with ${finalAttachments.length} attachments`,
          );

          // 이메일 제목도 파일명과 동일한 형식으로
          const emailSubject = safeDetailAddress
            ? `현장출동보고서 _${accidentNo} (${safeDetailAddress})`
            : `현장출동보고서 _${accidentNo}`;

          const result = await sendEmailWithAttachment({
            to: recipientEmail,
            subject: emailSubject,
            text: emailText,
            html: emailHtml,
            attachments: finalAttachments,
          });

          if (result.success) {
            sendResults.push({ email: recipientEmail, success: true });
            console.log(
              `[Email] Field Report with attachments sent to ${recipientEmail} by ${user.username}`,
            );
          } else {
            sendResults.push({
              email: recipientEmail,
              success: false,
              error: result.error || "전송 실패",
            });
            console.error(
              `[Email] Failed to send to ${recipientEmail}:`,
              result.error,
            );
          }
        } catch (sendError: any) {
          console.error(
            `[Email] Failed to send to ${recipientEmail}:`,
            sendError,
          );
          const errorMsg =
            sendError?.message || sendError?.toString() || "전송 실패";
          sendResults.push({
            email: recipientEmail,
            success: false,
            error: errorMsg,
          });

          // SMTP 552 오류 감지
          if (errorMsg.includes("552") || errorMsg.includes("size")) {
            console.error(
              `[send-field-report-email-v2] SMTP 552 오류 감지 - 총 첨부파일 크기: ${totalMB}MB`,
            );
          }
        }
      }

      const successCount = sendResults.filter((r) => r.success).length;
      const failedCount = sendResults.filter((r) => !r.success).length;

      if (successCount === 0) {
        return res.status(500).json({
          error: "이메일 전송에 실패했습니다. SMTP 설정을 확인해주세요.",
          details: sendResults.filter((r) => !r.success),
        });
      }

      const message =
        failedCount > 0
          ? `${successCount}명에게 전송 완료, ${failedCount}명 전송 실패`
          : `${successCount}명에게 현장출동보고서가 PDF 첨부파일로 전송되었습니다`;

      res.json({ success: true, message, results: sendResults });
    } catch (error) {
      console.error("Send field report email v2 error:", error);
      res
        .status(500)
        .json({ error: "현장조사 리포트 이메일 전송 중 오류가 발생했습니다" });
    }
  });

  // ==========================================
  // POST /send-pdf - PDF 이메일 첨부 전송 (SMTP/Nodemailer)
  // ==========================================
  app.post("/send-pdf", async (req, res) => {
    try {
      const { to, pdfUrl } = req.body;

      // Validate request body
      if (!to || typeof to !== "string") {
        return res
          .status(400)
          .json({ ok: false, message: "수신자 이메일(to)이 필요합니다" });
      }
      if (!pdfUrl || typeof pdfUrl !== "string") {
        return res
          .status(400)
          .json({ ok: false, message: "PDF URL(pdfUrl)이 필요합니다" });
      }

      // Check SMTP environment variables
      const SMTP_HOST = process.env.SMTP_HOST;
      const SMTP_PORT = process.env.SMTP_PORT;
      const SMTP_USER = process.env.SMTP_USER;
      const SMTP_PASS = process.env.SMTP_PASS;

      if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        console.error("[send-pdf] Missing SMTP configuration");
        return res.status(500).json({
          ok: false,
          message:
            "SMTP 설정이 필요합니다 (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)",
        });
      }

      // Download PDF from URL
      console.log(`[send-pdf] Downloading PDF from: ${pdfUrl}`);
      let pdfBuffer: Buffer;
      try {
        const pdfResponse = await fetch(pdfUrl);
        if (!pdfResponse.ok) {
          console.error(
            `[send-pdf] PDF download failed: ${pdfResponse.status} ${pdfResponse.statusText}`,
          );
          return res.status(500).json({
            ok: false,
            message: `PDF 다운로드 실패: ${pdfResponse.status}`,
          });
        }
        const arrayBuffer = await pdfResponse.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
        console.log(
          `[send-pdf] PDF downloaded successfully, size: ${pdfBuffer.length} bytes`,
        );
      } catch (downloadError) {
        console.error("[send-pdf] PDF download error:", downloadError);
        return res
          .status(500)
          .json({ ok: false, message: "PDF 파일을 다운로드할 수 없습니다" });
      }

      // Setup Nodemailer transporter
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT, 10),
        secure: parseInt(SMTP_PORT, 10) === 465, // true for 465, false for other ports
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });

      // Send email with PDF attachment
      console.log(`[send-pdf] Sending email to: ${to}`);
      try {
        const info = await transporter.sendMail({
          from: `FLOXN <${SMTP_USER}>`,
          to: to,
          subject: "PDF 파일 전송",
          text: "첨부된 PDF 파일을 확인해주세요.",
          attachments: [
            {
              filename: "document.pdf",
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });

        console.log(`[send-pdf] Email sent successfully: ${info.messageId}`);
        return res.json({ ok: true });
      } catch (sendError) {
        console.error("[send-pdf] Email send error:", sendError);
        return res.status(500).json({
          ok: false,
          message: `이메일 전송 실패: ${(sendError as Error).message}`,
        });
      }
    } catch (error) {
      console.error("[send-pdf] Unexpected error:", error);
      return res
        .status(500)
        .json({ ok: false, message: `서버 오류: ${(error as Error).message}` });
    }
  });

  // ==========================================
  // POST /api/send-sms - 솔라피 SMS 발송 (접수완료 알림)
  // ==========================================
  const sendSmsSchema = z.object({
    to: z.string().min(10, "유효한 전화번호를 입력해주세요").max(20),
    caseNumber: z.string().optional(),
    insuranceCompany: z.string().optional(),
    managerName: z.string().optional(),
    insurancePolicyNo: z.string().optional(),
    insuranceAccidentNo: z.string().optional(),
    insuredName: z.string().optional(),
    insuredContact: z.string().optional(),
    victimName: z.string().optional(),
    victimContact: z.string().optional(),
    assessorTeam: z.string().optional(),
    assessorContact: z.string().optional(),
    investigatorTeamName: z.string().optional(),
    investigatorContact: z.string().optional(),
    accidentLocation: z.string().optional(),
    accidentLocationDetail: z.string().optional(),
    victimAddressDetail: z.string().optional(),
    requestScope: z.string().optional(),
  });

  app.post("/api/send-sms", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    // 권한 확인: storage에서 사용자 정보 다시 조회하여 실제 권한 확인
    const currentUser = await storage.getUser(req.session.userId);
    if (!currentUser) {
      return res.status(401).json({ error: "사용자를 찾을 수 없습니다" });
    }

    // 관리자 또는 보험사만 SMS 발송 가능
    if (!["관리자", "보험사"].includes(currentUser.role)) {
      console.log(
        `[send-sms] Unauthorized role: ${currentUser.role} (user: ${currentUser.username})`,
      );
      return res.status(403).json({ error: "SMS 발송 권한이 없습니다" });
    }

    try {
      // Zod 스키마로 요청 검증
      const validatedData = sendSmsSchema.parse(req.body);

      const {
        to,
        caseNumber,
        insuranceCompany,
        managerName,
        insurancePolicyNo,
        insuranceAccidentNo,
        insuredName,
        insuredContact,
        victimName,
        victimContact,
        assessorTeam,
        assessorContact,
        investigatorTeamName,
        investigatorContact,
        accidentLocation,
        accidentLocationDetail,
        victimAddressDetail,
        requestScope,
      } = validatedData;

      // 솔라피 API 키 확인
      const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
      const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
      const SOLAPI_SENDER = process.env.SOLAPI_SENDER;

      if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
        console.error("[send-sms] Missing Solapi configuration");
        return res.status(500).json({
          error: "SMS 서비스가 설정되지 않았습니다",
        });
      }

      // 전OL�번호 정규화 (하이픈 및 공백 제거, 숫자만 추출)
      const normalizedTo = to.replace(/[^0-9]/g, "");
      const normalizedSender = SOLAPI_SENDER.replace(/[^0-9]/g, "");

      // 전화번호 유효성 검사
      if (normalizedTo.length < 10 || normalizedTo.length > 11) {
        return res
          .status(400)
          .json({ error: "유효하지 않은 전화번호 형식입니다" });
      }

      // SMS 메시지 내용 생성 (값이 없는 항목은 표시하지 않음)
      const messageLines: string[] = ["<접수완료 알림>", ""];

      if (caseNumber) messageLines.push(`접수번호 : ${caseNumber}`);
      if (insuranceCompany) messageLines.push(`보험사 : ${insuranceCompany}`);
      if (managerName) messageLines.push(`담당자 : ${managerName}`);
      if (insurancePolicyNo)
        messageLines.push(`증권번호 : ${insurancePolicyNo}`);
      if (insuranceAccidentNo)
        messageLines.push(`사고번호 : ${insuranceAccidentNo}`);

      // 피보험자: 이름 또는 연락처가 있을 때만 표시
      if (insuredName || insuredContact) {
        const insuredParts = [];
        if (insuredName) insuredParts.push(insuredName);
        if (insuredContact) insuredParts.push(`연락처 ${insuredContact}`);
        messageLines.push(`피보험자 : ${insuredParts.join("  ")}`);
      }

      // 피해자: 이름 또는 연락처가 있을 때만 표시
      if (victimName || victimContact) {
        const victimParts = [];
        if (victimName) victimParts.push(victimName);
        if (victimContact) victimParts.push(`연락처 ${victimContact}`);
        messageLines.push(`피해자 : ${victimParts.join("  ")}`);
      }

      // 심사자: 이름과 연락처 모두 있을 때만 표시
      if (
        assessorTeam &&
        assessorTeam !== "-" &&
        typeof assessorContact === "string" &&
        assessorContact !== "-" &&
        /[0-9]/.test(assessorContact)
      ) {
        messageLines.push(
          `심사자 : ${assessorTeam}  연락처 ${assessorContact}`,
        );
      }

      // 조사자: 이름과 연락처 모두 있을 때만 표시
      if (
        investigatorTeamName &&
        investigatorTeamName !== "-" &&
        typeof investigatorContact === "string" &&
        investigatorContact !== "-" &&
        /[0-9]/.test(investigatorContact)
      ) {
        messageLines.push(
          `조사자 : ${investigatorTeamName}  연락처 ${investigatorContact}`,
        );
      }

      // 사고장소: 피보험자 주소 + 피보험자 상세주소, 피해자 상세주소(있으면)
      const insuredFullAddress = [accidentLocation, accidentLocationDetail]
        .filter(Boolean)
        .join(" ");

      let fullAddress = insuredFullAddress;
      // 피해자 상세주소가 있고, "-"가 아니면 콤마로 구분하여 추가
      if (
        victimAddressDetail &&
        victimAddressDetail !== "-" &&
        victimAddressDetail.trim()
      ) {
        if (fullAddress) {
          fullAddress = `${fullAddress}, ${victimAddressDetail}`;
        } else {
          fullAddress = victimAddressDetail;
        }
      }
      if (fullAddress) messageLines.push(`사고장소 : ${fullAddress}`);
      if (requestScope) messageLines.push(`의뢰범위 : ${requestScope}`);

      const messageText = messageLines.join("\n");
      console.log(
        `[send-sms] Sending LMS to: ${normalizedTo} (user: ${req.session.userId})`,
      );

      // Solapi LMS 발송 (순수 HTTPS + HMAC-SHA256 인증)
      const payload = {
        message: {
          to: normalizedTo,
          from: normalizedSender,
          text: messageText,
          subject: "접수완료 알림",
          type: "LMS",
        },
      };
      const body = JSON.stringify(payload);

      const solapiResponse = await solapiHttpsRequest({
        method: "POST",
        path: "/messages/v4/send",
        headers: {
          Authorization: createSolapiAuthHeader(
            SOLAPI_API_KEY,
            SOLAPI_API_SECRET,
          ),
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        body,
      });

      console.log(
        `[send-sms] LMS sent successfully to ${normalizedTo}`,
        solapiResponse,
      );
      res.json({
        success: true,
        message: "문자가 전송되었습니다",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error("[send-sms] Validation error:", error.errors);
        return res.status(400).json({
          error: "요청 데이터가 올바르지 않습니다",
          details: error.errors,
        });
      }
      // Solapi API 에러 처리 (statusCode, body 형식)
      console.error("[send-sms] SMS send error:", error);
      if (error?.statusCode && error?.body) {
        return res.status(error.statusCode).json({
          error: "문자 전송에 실패했습니다",
          statusCode: error.statusCode,
          details: error.body,
        });
      }
      // 일반 에러 처리
      const errorMessage =
        error instanceof Error ? error.message : "알 수 없는 오류";
      const errorDetails =
        error instanceof Error ? error.stack : JSON.stringify(error);
      res.status(500).json({
        error: "문자 전송에 실패했습니다",
        details: errorMessage,
        stack: errorDetails,
      });
    }
  });

  // ==========================================
  // POST /api/send-custom-sms - 범용 문자 발송 (제목, 내용, 수신인 지정)
  // ==========================================
  const sendCustomSmsSchema = z.object({
    subject: z.string().min(1, "제목을 입력해주세요"),
    content: z.string().min(1, "내용을 입력해주세요"),
    recipients: z
      .array(
        z.object({
          name: z.string(),
          phone: z.string().min(10, "유효한 전화번호를 입력해주세요").max(20),
        }),
      )
      .min(1, "수신인을 1명 이상 입력해주세요"),
    senderName: z.string().optional(),
  });

  app.post("/api/send-custom-sms", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const currentUser = await storage.getUser(req.session.userId);
    if (!currentUser) {
      return res.status(401).json({ error: "사용자를 찾을 수 없습니다" });
    }

    if (!["관리자", "보험사"].includes(currentUser.role)) {
      return res.status(403).json({ error: "문자 발송 권한이 없습니다" });
    }

    try {
      const validatedData = sendCustomSmsSchema.parse(req.body);
      const { subject, content, recipients, senderName } = validatedData;
      const smsText = senderName
        ? `${content}\n\n발신인: ${senderName}\n연락처: 070-7778-0925`
        : content;

      const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
      const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
      const SOLAPI_SENDER = process.env.SOLAPI_SENDER;

      if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
        return res
          .status(500)
          .json({ error: "SMS 서비스가 설정되지 않았습니다" });
      }

      const normalizedSender = SOLAPI_SENDER.replace(/[^0-9]/g, "");
      const results: {
        name: string;
        phone: string;
        success: boolean;
        error?: string;
      }[] = [];

      for (const recipient of recipients) {
        const normalizedTo = recipient.phone.replace(/[^0-9]/g, "");
        if (normalizedTo.length < 10 || normalizedTo.length > 11) {
          results.push({
            name: recipient.name,
            phone: recipient.phone,
            success: false,
            error: "유효하지 않은 전화번호",
          });
          continue;
        }

        try {
          const payload = {
            message: {
              to: normalizedTo,
              from: normalizedSender,
              text: smsText,
              subject: subject,
              type: "LMS",
            },
          };
          const body = JSON.stringify(payload);

          await solapiHttpsRequest({
            method: "POST",
            path: "/messages/v4/send",
            headers: {
              Authorization: createSolapiAuthHeader(
                SOLAPI_API_KEY,
                SOLAPI_API_SECRET,
              ),
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
            body,
          });

          console.log(
            `[send-custom-sms] LMS sent to ${normalizedTo} (${recipient.name})`,
          );
          results.push({
            name: recipient.name,
            phone: recipient.phone,
            success: true,
          });
        } catch (err: any) {
          console.error(
            `[send-custom-sms] Failed to send to ${normalizedTo}:`,
            err,
          );
          results.push({
            name: recipient.name,
            phone: recipient.phone,
            success: false,
            error: "발송 실패",
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      res.json({
        success: failCount === 0,
        message: `${successCount}건 발송 완료${failCount > 0 ? `, ${failCount}건 실패` : ""}`,
        results,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "요청 데이터가 올바르지 않습니다",
          details: error.errors,
        });
      }
      console.error("[send-custom-sms] Error:", error);
      res.status(500).json({ error: "문자 전송에 실패했습니다" });
    }
  });

  // ==========================================
  // POST /api/cases/:id/send-lms - 진행관리 LMS 발송
  // ==========================================
  const sendCaseLmsSchema = z.object({
    messageType: z.enum(["청구금액 지급요청", "중복보험 미지급금 요청"]),
    recipientType: z.enum(["심사자", "조사자"]),
  });

  app.post("/api/cases/:id/send-lms", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const currentUser = await storage.getUser(req.session.userId);
    if (!currentUser) {
      return res.status(401).json({ error: "사용자를 찾을 수 없습니다" });
    }

    if (currentUser.role !== "관리자") {
      return res.status(403).json({ error: "LMS 발송 권한이 없습니다" });
    }

    try {
      const { messageType, recipientType } = sendCaseLmsSchema.parse(req.body);
      const caseId = req.params.id;
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      let recipientCompany = "";
      let recipientName = "";
      let recipientPhone = "";

      if (recipientType === "심사자") {
        recipientCompany = caseData.assessorId || "";
        recipientName = caseData.assessorTeam || "";
        recipientPhone = caseData.assessorContact || "";
      } else {
        recipientCompany = caseData.investigatorTeam || "";
        recipientName = caseData.investigatorTeamName || "";
        recipientPhone = caseData.investigatorContact || "";
      }

      if (!recipientPhone) {
        return res.status(400).json({
          error: `${recipientType}의 연락처가 등록되어 있지 않습니다`,
        });
      }

      const senderName = currentUser.name || "플록슨 담당자";
      const senderPhone = currentUser.phone || "070-7778-0925";

      // 청구액 계산 (정산조회와 동일한 로직: 총 승인금액 - 자기부담금)
      const parseAmt = (v: any): number => {
        if (v === null || v === undefined) return 0;
        if (typeof v === "number") return isNaN(v) ? 0 : v;
        const cleaned = String(v).replace(/,/g, "");
        const parsed = Number(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      };
      const getSuffix = (cn: string | null): number => {
        if (!cn) return 0;
        const di = cn.lastIndexOf("-");
        if (di > 0) {
          const s = parseInt(cn.substring(di + 1), 10);
          return isNaN(s) ? 0 : s;
        }
        return 0;
      };

      let claimAmountText = "";
      let estimateAmountText = "";
      try {
        const caseNumber = caseData.caseNumber || "";
        const prefix = caseNumber.replace(/-\d+$/, "");
        const relatedCases = await storage.getCasesByPrefix(prefix);
        const filteredCases = relatedCases.filter(
          (c: any) => c.status !== "접수취소",
        );
        const allCasesInGroup =
          filteredCases.length > 0 ? filteredCases : [caseData];

        const hasDirectRepair = allCasesInGroup.some(
          (c: any) => c.recoveryType === "직접복구",
        );
        const allNoRepair = allCasesInGroup.every(
          (c: any) => c.recoveryType === "선견적요청",
        );

        // 각 케이스별 승인금액 계산 (정산조회와 동일)
        const caseApprovedValues: {
          approvedValue: number;
          isPrevention: boolean;
          isProperty: boolean;
          recoveryType: string | null;
        }[] = [];
        let totalEstimate = 0;
        for (const c of allCasesInGroup) {
          const suffix = getSuffix(c.caseNumber);
          const isPrevention = suffix === 0;
          const isProperty = suffix > 0;

          let estimateTotal = 0;
          const initialEst = (c as any).initialEstimateAmount;
          if (
            initialEst !== null &&
            initialEst !== undefined &&
            initialEst !== ""
          ) {
            estimateTotal = parseAmt(initialEst);
          } else {
            estimateTotal = parseAmt(c.estimateAmount);
          }
          totalEstimate += estimateTotal;

          const caseApprovedAmount = parseAmt(c.approvedAmount);
          const isApproved =
            c.reviewDecision === "승인" || caseApprovedAmount > 0;
          const approvedValue =
            caseApprovedAmount > 0
              ? caseApprovedAmount
              : isApproved
                ? estimateTotal
                : 0;

          caseApprovedValues.push({
            approvedValue,
            isPrevention,
            isProperty,
            recoveryType: c.recoveryType,
          });
        }
        estimateAmountText = totalEstimate > 0 ? `${totalEstimate.toLocaleString()}원` : (caseData.estimateAmount || "");

        // 손해방지비용 + 대물비용 승인액 (직접복구 건만)
        const preventionApproved = caseApprovedValues
          .filter((v) => v.isPrevention && v.recoveryType === "직접복구")
          .reduce((sum, v) => sum + v.approvedValue, 0);
        const propertyApproved = caseApprovedValues
          .filter((v) => v.isProperty && v.recoveryType === "직접복구")
          .reduce((sum, v) => sum + v.approvedValue, 0);

        const calculatedTotalApproved = hasDirectRepair
          ? preventionApproved + propertyApproved
          : allNoRepair
            ? 100000
            : 0;

        // 자기부담금 합산 (정산 테이블)
        let totalSettlementDeductible = 0;
        for (const c of allCasesInGroup) {
          try {
            const setts = await storage.getSettlementsByCaseId(c.id);
            for (const s of setts) {
              totalSettlementDeductible += parseAmt(s.deductible);
            }
          } catch {}
        }

        // 인보이스에 저장된 값이 있으면 우선 사용
        let invoiceTotalApproved = 0;
        let invoiceDeductible = 0;
        try {
          const invoice = await storage.getInvoiceByCaseGroupPrefix(prefix);
          if (invoice) {
            invoiceTotalApproved = invoice.totalApprovedAmount
              ? parseInt(invoice.totalApprovedAmount)
              : 0;
            invoiceDeductible = invoice.deductible
              ? parseInt(invoice.deductible)
              : 0;
          }
        } catch {}

        const finalApproved =
          invoiceTotalApproved > 0
            ? invoiceTotalApproved
            : calculatedTotalApproved;
        const finalDeductible =
          invoiceDeductible > 0 ? invoiceDeductible : totalSettlementDeductible;
        const claimAmount = finalApproved - finalDeductible;
        claimAmountText = `${claimAmount.toLocaleString()}원`;
      } catch {
        claimAmountText = caseData.estimateAmount || "";
      }

      let messageText = "";

      if (messageType === "청구금액 지급요청") {
        let invoiceDate = "";
        try {
          const caseNumber = caseData.caseNumber || "";
          const prefix = caseNumber.replace(/-\d+$/, "");
          const relatedCases = await storage.getCasesByPrefix(prefix);
          const relatedIds = relatedCases.map((c: any) => c.id);
          for (const rid of relatedIds) {
            const history = await storage.getStatusHistoryByCaseId(rid);
            const submitEntry = history.find((h: any) => h.newStatus === "현장정보제출");
            if (submitEntry) {
              const dateStr = submitEntry.changedAt;
              invoiceDate = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
              break;
            }
          }
        } catch {}
        
        messageText = `[청구금액 지급요청]\nTO. ${recipientName}\n\n안녕하세요. 플록슨 ${senderName}입니다.\n\n아래 사고 건은 복구공사가 이미 완료되었으며, 공사금액 관련 자료는 ${invoiceDate} 이메일로 송부드린 바 있습니다.\n\n현재까지 공사금액 지급이 이루어지지 않아 확인 차 재안내 드리오니 신속한 검토 후 지급을 부탁드립니다.\n\n▷ 사고번호: ${caseData.insuranceAccidentNo || ""}\n▷ 피보험자: ${caseData.insuredName || ""}\n▷ 소재지: ${caseData.insuredAddress || ""}\n▷ 견적금액: ${claimAmountText}\n\n※ 문의사항이 있으신 경우 당사 담당자 (${senderName} / ${senderPhone})에게 연락 주시기 바랍니다.\n\n감사합니다.`;
      } else {
        // 중복보험 일부금 독촉
        // 정산청구 입금액(settlement.discount) + 입금일을 관련건 전체에서 합산
        let depositInfo = "";
        try {
          const caseNumber = caseData.caseNumber || "";
          const prefix = caseNumber.replace(/-\d+$/, "");
          const relatedCasesForDeposit = await storage.getCasesByPrefix(prefix);
          const filteredForDeposit = relatedCasesForDeposit.filter(
            (c: any) => c.status !== "접수취소",
          );
          const groupCases = filteredForDeposit.length > 0 ? filteredForDeposit : [caseData];

          let totalDiscount = 0;
          let latestDepositDate = "";

          for (const gc of groupCases) {
            try {
              const setts = await storage.getSettlementsByCaseId(gc.id);
              if (setts && setts.length > 0) {
                const s = setts[0];
                // 입금액: settlement.discount (정산청구 입금액 컬럼과 동일)
                const discountVal = parseAmt((s as any).discount || "0");
                totalDiscount += discountVal;

                // 입금일: depositEntries 중 가장 최근 depositDate
                const entries = (s as any).depositEntries;
                if (Array.isArray(entries) && entries.length > 0) {
                  const sorted = [...entries]
                    .filter((e: any) => e.depositDate)
                    .sort((a: any, b: any) =>
                      (b.depositDate || "").localeCompare(a.depositDate || ""),
                    );
                  if (sorted.length > 0 && sorted[0].depositDate > latestDepositDate) {
                    latestDepositDate = sorted[0].depositDate;
                  }
                }
                // depositEntries 없으면 settlementDate 사용
                if (!latestDepositDate && (s as any).settlementDate) {
                  latestDepositDate = (s as any).settlementDate;
                }
              }
            } catch {}
          }

          if (totalDiscount > 0) {
            // 날짜 포맷: YYYY-MM-DD → yy.mm.dd
            let dateStr = "";
            if (latestDepositDate && latestDepositDate !== "-") {
              const parts = latestDepositDate.split("-");
              if (parts.length === 3) {
                dateStr = `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`;
              } else {
                dateStr = latestDepositDate;
              }
            }
            depositInfo = dateStr
              ? `${totalDiscount.toLocaleString()}원(${dateStr})`
              : `${totalDiscount.toLocaleString()}원`;
          }
        } catch {}

        messageText = `[중복보험  미지급금 요청]\nTO. ${recipientName}\n\n안녕하세요. 플록슨 ${senderName}입니다.\n\n아래 사고 건과 관련하여 중복보험금 일부만 입금된 것으로 확인되어 안내드립니다.\n\n협력업체와의 원활한 업무 진행을 위해, 미지급 금액에 대한 신속한 지급을 요청드립니다.\n\n▷ 사고번호: ${caseData.insuranceAccidentNo || ""}\n▷ 피보험자: ${caseData.insuredName || ""}\n▷ 견적금액: ${estimateAmountText}\n▷ 입금금액: ${depositInfo}\n\n※ 관련 문의사항은 당사 담당자 (${senderName} / ${senderPhone})에게 연락 주시면 재 안내드리겠습니다.\n\n감사합니다.`;
      }

      // Send LMS via Solapi
      const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
      const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
      const SOLAPI_SENDER = process.env.SOLAPI_SENDER;

      if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
        return res
          .status(500)
          .json({ error: "SMS 서비스가 설정되지 않았습니다" });
      }

      const normalizedSender = SOLAPI_SENDER.replace(/[^0-9]/g, "");
      const normalizedTo = recipientPhone.replace(/[^0-9]/g, "");

      if (normalizedTo.length < 10 || normalizedTo.length > 11) {
        return res
          .status(400)
          .json({ error: "유효하지 않은 수신자 전화번호입니다" });
      }

      const payload = {
        message: {
          to: normalizedTo,
          from: normalizedSender,
          text: messageText,
          subject: messageType,
          type: "LMS" as const,
        },
      };
      const body = JSON.stringify(payload);

      await solapiHttpsRequest({
        method: "POST",
        path: "/messages/v4/send",
        headers: {
          Authorization: createSolapiAuthHeader(
            SOLAPI_API_KEY,
            SOLAPI_API_SECRET,
          ),
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        body,
      });

      console.log(
        `[send-case-lms] LMS sent to ${normalizedTo} (${recipientName}) for case ${caseId}`,
      );

      // Record LMS send history
      const now = new Date();
      const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const kstString = kstDate.toISOString().slice(0, 10);

      const newEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sentAt: kstString,
        messageType,
        recipientType,
        recipientCompany,
        recipientName,
        recipientPhone,
        senderName,
      };

      let history: any[] = [];
      try {
        if (caseData.lmsSendHistory) {
          history = JSON.parse(caseData.lmsSendHistory as string);
        }
      } catch {}

      history.unshift(newEntry);

      await storage.updateCase(caseId, {
        lmsSendHistory: JSON.stringify(history),
      });

      res.json({ success: true, message: "LMS 발송 완료", entry: newEntry });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "요청 데이터가 올바르지 않습니다" });
      }
      console.error("[send-case-lms] Error:", error);
      res.status(500).json({ error: "LMS 발송에 실패했습니다" });
    }
  });

  // ==========================================
  // POST /api/cases/:id/manual-history - 진행관리 수기 이력 추가
  // ==========================================
  const manualHistorySchema = z.object({
    date: z.string().min(1),
    medium: z.string().optional().default(""),
    content: z.string().min(1),
    recipient: z.string().optional().default(""),
  });

  app.post("/api/cases/:id/manual-history", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }

      const caseId = req.params.id;
      const { date, medium, content, recipient } = manualHistorySchema.parse(req.body);

      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "사건을 찾을 수 없습니다" });
      }

      const newEntry = {
        id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sentAt: date,
        medium: medium || "",
        messageType: content,
        recipientType: "수기입력",
        recipientCompany: "",
        recipientName: recipient,
        recipientPhone: "",
        senderName: currentUser.name || currentUser.username,
        isManual: true,
      };

      let history: any[] = [];
      try {
        if (caseData.lmsSendHistory) {
          history = JSON.parse(caseData.lmsSendHistory as string);
        }
      } catch {}

      history.unshift(newEntry);

      await storage.updateCase(caseId, {
        lmsSendHistory: JSON.stringify(history),
      });

      res.json({ success: true, message: "수기 이력이 추가되었습니다", entry: newEntry });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "요청 데이터가 올바르지 않습니다" });
      }
      console.error("[manual-history] Error:", error);
      res.status(500).json({ error: "수기 이력 추가에 실패했습니다" });
    }
  });

  // ==========================================
  // POST /api/send-account-notification - 계정 생성 안내 발송 (이메일/SMS)
  // ==========================================
  const accountNotificationSchema = z.object({
    sendEmail: z.boolean().default(false),
    sendSms: z.boolean().default(false),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    name: z.string(),
    username: z.string(),
    password: z.string(),
    role: z.string(),
    company: z.string().optional().nullable(),
  });

  app.post("/api/send-account-notification", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const currentUser = await storage.getUser(req.session.userId);
    if (!currentUser) {
      return res.status(401).json({ error: "사용자를 찾을 수 없습니다" });
    }

    // 관리자만 계정 생성 안내 발송 가능
    if (currentUser.role !== "관리자") {
      return res
        .status(403)
        .json({ error: "계정 생성 안내 발송 권한이 없습니다" });
    }

    try {
      const validatedData = accountNotificationSchema.parse(req.body);
      const {
        sendEmail,
        sendSms,
        email,
        phone,
        name,
        username,
        password,
        role,
        company,
      } = validatedData;

      const results = {
        emailSent: false,
        smsSent: false,
        errors: [] as string[],
      };

      // 역할명 변환
      const roleNames: Record<string, string> = {
        admin: "관리자",
        insurer: "보험사",
        partner: "협력사",
        assessor: "심사사",
        investigator: "조사사",
        client: "의뢰사",
        관리자: "관리자",
        보험사: "보험사",
        협력사: "협력사",
        심사사: "심사사",
        조사사: "조사사",
        의뢰사: "의뢰사",
      };
      const roleName = roleNames[role] || role;

      // 이메일 발송
      if (sendEmail && email) {
        try {
          await sendAccountCreationEmail(email, {
            name,
            username,
            password,
            role,
            company: company || undefined,
          });
          results.emailSent = true;
          console.log(`[send-account-notification] Email sent to ${email}`);
        } catch (emailError) {
          console.error("[send-account-notification] Email error:", emailError);
          results.errors.push("이메일 전송 실패");
        }
      }

      // SMS 발송
      if (sendSms && phone) {
        const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
        const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
        const SOLAPI_SENDER = process.env.SOLAPI_SENDER;

        if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
          results.errors.push("SMS 서비스가 설정되지 않았습니다");
        } else {
          const normalizedPhone = phone.replace(/[^0-9]/g, "");
          const normalizedSender = SOLAPI_SENDER.replace(/[^0-9]/g, "");

          if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
            results.errors.push("유효하지 않은 전화번호 형식입니다");
          } else {
            const messageText = `[FLOXN 계정 생성 안내]

안녕하세요, ${name}님.
FLOXN 플랫폼 계정이 생성되었습니다.

▶ 계정 정보
- 이름: ${name}
- 소속: ${company || "-"}
- 역할: ${roleName}
- 아이디: ${username}
- 비밀번호: ${password}

▶ 로그인 주소
https://www.floxn.co.kr/

로그인 후 반드시 비밀번호를 변경해 주세요.`;

            try {
              const payload = {
                message: {
                  to: normalizedPhone,
                  from: normalizedSender,
                  text: messageText,
                  subject: "FLOXN 계정 생성 안내",
                  type: "LMS",
                },
              };
              const body = JSON.stringify(payload);

              await solapiHttpsRequest({
                method: "POST",
                path: "/messages/v4/send",
                headers: {
                  Authorization: createSolapiAuthHeader(
                    SOLAPI_API_KEY,
                    SOLAPI_API_SECRET,
                  ),
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(body),
                },
                body,
              });

              results.smsSent = true;
              console.log(
                `[send-account-notification] SMS sent to ${normalizedPhone}`,
              );
            } catch (smsError) {
              console.error("[send-account-notification] SMS error:", smsError);
              results.errors.push("SMS 전송 실패");
            }
          }
        }
      }

      // 결과 반환
      if (results.emailSent || results.smsSent) {
        let message = "";
        if (results.emailSent && results.smsSent) {
          message = "이메일과 문자가 전송되었습니다";
        } else if (results.emailSent) {
          message = "이메일이 전송되었습니다";
        } else {
          message = "문자가 전송되었습니다";
        }
        res.json({ success: true, message, ...results });
      } else if (results.errors.length > 0) {
        res.status(500).json({
          success: false,
          error: results.errors.join(", "),
          ...results,
        });
      } else {
        res.json({
          success: true,
          message: "발송 대상이 없습니다",
          ...results,
        });
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "요청 데이터가 올바르지 않습니다",
          details: error.errors,
        });
      }
      console.error("[send-account-notification] Error:", error);
      res.status(500).json({ error: "알림 발송에 실패했습니다" });
    }
  });

  // ==========================================
  // POST /api/send-stage-notification - 단계별 SMS 알림 발송
  // ==========================================
  const stageNotificationSchema = z.object({
    caseId: z.string(),
    stage: z.enum([
      "접수완료",
      "현장정보입력",
      "반려",
      "승인반려",
      "현장정보제출",
      "복구요청",
      "직접복구",
      "미복구",
      "청구자료제출",
      "출동비청구(선견적)",
      "청구",
      "접수취소",
      "입금완료",
      "부분입금",
      "부분지급",
      "지급완료",
      "정산완료",
      "선견적요청",
      "종결",
    ]),
    recipients: z.object({
      partner: z.boolean().default(false),
      manager: z.boolean().default(false),
      assessorInvestigator: z.boolean().default(false),
    }),
    additionalMessage: z.string().optional(),
    // 접수취소 사유 (접수취소 단계에서만 사용)
    cancelReason: z.string().optional(),
    // 반려 시 이전 진행상태 (반려 단계에서만 사용)
    previousStatus: z.string().optional(),
  });

  app.post("/api/send-stage-notification", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const currentUser = await storage.getUser(req.session.userId);
    if (!currentUser) {
      return res.status(401).json({ error: "사용자를 찾을 수 없습니실" });
    }

    // 관리자 또는 협력사만 SMS 발송 가능
    if (!["관리자", "협력사"].includes(currentUser.role)) {
      console.log(
        `[send-stage-notification] Unauthorized role: ${currentUser.role} (user: ${currentUser.username})`,
      );
      return res.status(403).json({ error: "SMS 발송 권한이 없습니다" });
    }

    try {
      const validatedData = stageNotificationSchema.parse(req.body);
      const {
        caseId,
        stage,
        recipients,
        additionalMessage,
        cancelReason,
        recoveryAmount,
        feeRate,
        paymentAmount,
        previousStatus,
      } = validatedData;

      // 솔라피 API 키 확인
      const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
      const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
      const SOLAPI_SENDER = process.env.SOLAPI_SENDER;

      if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
        console.error("[send-stage-notification] Missing Solapi configuration");
        return res
          .status(500)
          .json({ error: "SMS 서비스가 설정되지 않았습니다" });
      }

      // 케이스 정보 조회
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 담당자(관리자) 정보 조회
      let managerData = null;
      if (caseData.managerId) {
        managerData = await storage.getUser(caseData.managerId);
      }

      const normalizedSender = SOLAPI_SENDER.replace(/[^0-9]/g, "");

      // 수신자별 전화번호 수집
      const phoneNumbers: { type: string; phone: string; name: string }[] = [];

      // 협력업체 연락처
      if (recipients.partner && caseData.assignedPartnerContact) {
        const normalizedPhone = caseData.assignedPartnerContact.replace(
          /[^0-9]/g,
          "",
        );
        if (normalizedPhone.length >= 10 && normalizedPhone.length <= 11) {
          phoneNumbers.push({
            type: "협력업체",
            phone: normalizedPhone,
            name: caseData.assignedPartner || "협력업체",
          });
        }
      }

      // 플록슨 담당자 연락처
      if (recipients.manager && managerData?.phone) {
        const normalizedPhone = managerData.phone.replace(/[^0-9]/g, "");
        if (normalizedPhone.length >= 10 && normalizedPhone.length <= 11) {
          phoneNumbers.push({
            type: "플록슨담당자",
            phone: normalizedPhone,
            name: managerData.name || "담당자",
          });
        }
      }

      // 심사자/조사자 연락처
      if (recipients.assessorInvestigator) {
        // 심사자 연락처
        if (caseData.assessorContact) {
          const normalizedPhone = caseData.assessorContact.replace(
            /[^0-9]/g,
            "",
          );
          if (normalizedPhone.length >= 10 && normalizedPhone.length <= 11) {
            phoneNumbers.push({
              type: "심사자",
              phone: normalizedPhone,
              name: caseData.assessorId || "심사자",
            });
          }
        }
        // 조사자 연락처
        if (caseData.investigatorContact) {
          const normalizedPhone = caseData.investigatorContact.replace(
            /[^0-9]/g,
            "",
          );
          if (normalizedPhone.length >= 10 && normalizedPhone.length <= 11) {
            phoneNumbers.push({
              type: "조사자",
              phone: normalizedPhone,
              name: caseData.investigatorTeamName || "조사자",
            });
          }
        }
      }

      if (phoneNumbers.length === 0) {
        // 연락처가 없는 경우 에러 대신 성공으로 처리 (SMS는 발송되지 않음)
        console.log(
          `[send-stage-notification] No phone numbers available for stage: ${stage}, caseId: ${caseId}`,
        );
        return res.json({
          success: true,
          message: "발송할 연락처가 없어 SMS가 발송되지 않았습니다.",
          sentCount: 0,
          failedCount: 0,
          results: [],
        });
      }

      // 메시지 템플릿 생성
      let messageText = "";
      let subject = "";

      // 케이스 접미사에 따른 주소 결정: -0은 피보험자 주소, -1 이상은 피해자 주소
      const getFullAddress = () => {
        const caseNumber = caseData.caseNumber || "";
        const suffixMatch = caseNumber.match(/-(\d+)$/);
        const suffix = suffixMatch ? parseInt(suffixMatch[1], 10) : 0;

        if (suffix === 0) {
          // 손해방지(-0): 피보험자 주소 + 상세주소
          return (
            [caseData.insuredAddress, caseData.insuredAddressDetail]
              .filter(Boolean)
              .join(" ") || "-"
          );
        } else {
          // 피해세대(-1, -2, ...): 피해자 주소 + 상세주소 (없으면 피보험자 주소로 대체)
          const victimAddr = [
            caseData.victimAddress,
            caseData.victimAddressDetail,
          ]
            .filter(Boolean)
            .join(" ");
          if (victimAddr) {
            return victimAddr;
          }
          return (
            [caseData.insuredAddress, caseData.insuredAddressDetail]
              .filter(Boolean)
              .join(" ") || "-"
          );
        }
      };

      if (stage === "접수완료") {
        subject = "접수완료 알림";
        // 값이 없는 항목은 표시하지 않음
        const msgLines: string[] = ["<접수완료 알림>", ""];

        if (caseData.caseNumber)
          msgLines.push(`접수번호 : ${caseData.caseNumber}`);
        if (caseData.insuranceCompany)
          msgLines.push(`보험사 : ${caseData.insuranceCompany}`);
        if (managerData?.name) msgLines.push(`담당자 : ${managerData.name}`);
        if (caseData.insurancePolicyNo)
          msgLines.push(`증권번호 : ${caseData.insurancePolicyNo}`);
        if (caseData.insuranceAccidentNo)
          msgLines.push(`사고번호 : ${caseData.insuranceAccidentNo}`);

        // 피보험자: 이름 또는 연락처가 있을 때만 표시
        if (caseData.insuredName || caseData.insuredContact) {
          const insuredParts = [];
          if (caseData.insuredName) insuredParts.push(caseData.insuredName);
          if (caseData.insuredContact)
            insuredParts.push(`연락처 ${caseData.insuredContact}`);
          msgLines.push(`피보험자 : ${insuredParts.join("  ")}`);
        }

        // 피해자: 이름 또는 연락처가 있을 때만 표시
        if (caseData.victimName || caseData.victimContact) {
          const victimParts = [];
          if (caseData.victimName) victimParts.push(caseData.victimName);
          if (caseData.victimContact)
            victimParts.push(`연락처 ${caseData.victimContact}`);
          msgLines.push(`피해자 : ${victimParts.join("  ")}`);
        }

        // 조사자: 이름과 연락처 모두 있을 때만 표시
        if (caseData.investigatorTeamName && caseData.investigatorContact) {
          msgLines.push(
            `조사자 : ${caseData.investigatorTeamName}  연락처 ${caseData.investigatorContact}`,
          );
        }
        // 심사자: 이름과 연락처 모두 있을 때만 표시
        if (caseData.assessorId && caseData.assessorContact) {
          msgLines.push(
            `심사자 : ${caseData.assessorTeam}  연락처 ${caseData.assessorContact}`,
          );
        }

        msgLines.push(`사고장소 : ${getFullAddress()}`);

        const requestScope = [
          caseData.damagePreventionCost === "true" ? "손방" : null,
          caseData.victimIncidentAssistance === "true" ? "대물" : null,
        ]
          .filter(Boolean)
          .join(", ");
        if (requestScope) msgLines.push(`의뢰범위 : ${requestScope}`);

        messageText = msgLines.join("\n");
      } else if (stage === "접수취소") {
        subject = "접수취소 알림";
        messageText = `<접수취소 알림>

접수번호 : ${caseData.caseNumber || "-"}
보험사 : ${caseData.insuranceCompany || "-"}
증권번호 : ${caseData.insurancePolicyNo || "-"}
사고번호 : ${caseData.insuranceAccidentNo || "-"}
피보험자 : ${caseData.insuredName || "-"}
사고장소 : ${getFullAddress()}

위 접수건은 접수 취소 되었음을 알려드립니다.
취소 사유 : ${cancelReason || "-"}`;
      } else if (stage === "종결") {
        const settlements = await storage.getSettlementsByCaseId(caseId);
        const latestSettlement =
          settlements && settlements.length > 0 ? settlements[0] : null;

        let paymentAmountNum = 0;
        let commissionNum = 0;

        if (
          latestSettlement?.paymentEntries &&
          Array.isArray(latestSettlement.paymentEntries)
        ) {
          const entries = latestSettlement.paymentEntries as Array<{
            paymentAmount?: number;
            commission?: number;
          }>;
          paymentAmountNum = entries.reduce(
            (sum, e) => sum + (Number(e.paymentAmount) || 0),
            0,
          );
          commissionNum = entries.reduce(
            (sum, e) => sum + (Number(e.commission) || 0),
            0,
          );
        } else {
          paymentAmountNum = latestSettlement?.partnerPaymentAmount
            ? Number(latestSettlement.partnerPaymentAmount)
            : 0;
          commissionNum = latestSettlement?.commission
            ? Number(latestSettlement.commission)
            : 0;
        }

        const deductibleNum = latestSettlement?.deductible
          ? Number(latestSettlement.deductible)
          : 0;
        const totalAmountNum = paymentAmountNum + commissionNum + deductibleNum;

        const paymentAmountStr =
          paymentAmountNum > 0 ? paymentAmountNum.toLocaleString() : "-";
        const deductibleStr =
          deductibleNum > 0 ? deductibleNum.toLocaleString() : "-";
        const commissionStr =
          commissionNum > 0 ? commissionNum.toLocaleString() : "-";
        const totalAmountStr =
          totalAmountNum > 0 ? totalAmountNum.toLocaleString() : "-";

        subject = "지급 알림";
        const deductibleLine = deductibleNum > 0 ? `\n자기부담금 : ${deductibleStr}원` : "";
        messageText = `<지급 알림>

보험사 : ${caseData.insuranceCompany || "-"}
사고(증권)번호 : ${caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "-"}
피보험자 : ${caseData.insuredName || "-"}
사고장소 : ${getFullAddress()}

지급금액 : ${paymentAmountStr}원${deductibleLine}
수수료 : ${commissionStr}원
합계금액 : ${totalAmountStr}원`;
      } else if (stage === "반려" || stage === "승인반려") {
        // 심사반려 또는 승인반려 모두 동일한 형식으로 처리
        const rejectionType = stage === "승인반려" ? "승인반려" : "심사반려";
        subject = `${rejectionType} 알림`;
        // 반려 직전 상태 표시 (예: "검토중에서 반려", "현장정보제출에서 반려")
        const rejectionStatus = previousStatus
          ? `${previousStatus}에서 반려`
          : "반려";
        messageText = `<${rejectionType} 알림>

접수번호 : ${caseData.caseNumber || "-"}
보험사 : ${caseData.insuranceCompany || "-"}
증권번호 : ${caseData.insurancePolicyNo || "-"}
사고번호 : ${caseData.insuranceAccidentNo || "-"}
피보험자 : ${caseData.insuredName || "-"}
사고장소 : ${getFullAddress()}
진행상태 : ${rejectionStatus}`;
      } else {
        // 현장정보입력~청구 등 단계별 항목 알림
        const stageDisplayName =
          stage === "직접복구" || stage === "미복구" ? `${stage}` : stage;
        subject = `${stageDisplayName} 알림`;
        messageText = `<${stageDisplayName} 알림>

접수번호 : ${caseData.caseNumber || "-"}
보험사 : ${caseData.insuranceCompany || "-"}
증권번호 : ${caseData.insurancePolicyNo || "-"}
사고번호 : ${caseData.insuranceAccidentNo || "-"}
피보험자 : ${caseData.insuredName || "-"}
사고장소 : ${getFullAddress()}
진행사항 : ${stageDisplayName}`;
      }

      // 추가 메시지가 있으면 추가
      if (additionalMessage) {
        messageText += `\n\n추가사항 : ${additionalMessage}`;
      }

      console.log(
        `[send-stage-notification] Stage: ${stage}, Recipients request:`,
        JSON.stringify(recipients),
      );
      console.log(
        `[send-stage-notification] Phone numbers collected: ${phoneNumbers.length}`,
        phoneNumbers.map((p) => `${p.type}:${p.phone}`).join(", "),
      );

      // 각 수신자에게 SMS 발송
      const results: {
        type: string;
        name: string;
        success: boolean;
        error?: string;
      }[] = [];

      for (const recipient of phoneNumbers) {
        try {
          const payload = {
            message: {
              to: recipient.phone,
              from: normalizedSender,
              text: messageText,
              subject: subject,
              type: "LMS",
            },
          };
          const body = JSON.stringify(payload);

          await solapiHttpsRequest({
            method: "POST",
            path: "/messages/v4/send",
            headers: {
              Authorization: createSolapiAuthHeader(
                SOLAPI_API_KEY,
                SOLAPI_API_SECRET,
              ),
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
            body,
          });

          console.log(
            `[send-stage-notification] LMS sent to ${recipient.type}: ${recipient.phone}`,
          );
          results.push({
            type: recipient.type,
            name: recipient.name,
            success: true,
          });
        } catch (sendError: any) {
          console.error(
            `[send-stage-notification] Failed to send to ${recipient.type}:`,
            sendError,
          );
          results.push({
            type: recipient.type,
            name: recipient.name,
            success: false,
            error:
              sendError?.body?.message || sendError?.message || "발송 실패",
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      res.json({
        success: successCount > 0,
        message: `${successCount}건 발송 완료${failCount > 0 ? `, ${failCount}건 실패` : ""}`,
        results,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error(
          "[send-stage-notification] Validation error:",
          error.errors,
        );
        return res.status(400).json({
          error: "요청 데이터가 올바르지 않습니다",
          details: error.errors,
        });
      }
      console.error("[send-stage-notification] Error:", error);
      res.status(500).json({
        error: "알림 발송에 실패했습니다",
        details: error instanceof Error ? error.message : "알 수 없는 오류",
      });
    }
  });

  // POST /api/send-cancellation-email - 접수취소 이메일 발송
  const cancellationEmailSchema = z.object({
    caseId: z.string(),
    cancelReason: z.string().optional(),
    recipients: z.object({
      sendToAssessor: z.boolean().default(false),
      sendToInvestigator: z.boolean().default(false),
      manualEmail: z.string().optional(),
    }),
  });

  app.post("/api/send-cancellation-email", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    const currentUser = await storage.getUser(req.session.userId);
    if (!currentUser) {
      return res.status(401).json({ error: "사용자를 찾을 수 없습니다" });
    }

    if (!["관리자", "협력사"].includes(currentUser.role)) {
      return res.status(403).json({ error: "이메일 발송 권한이 없습니다" });
    }

    try {
      const validatedData = cancellationEmailSchema.parse(req.body);
      const { caseId, cancelReason, recipients } = validatedData;

      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      const emailRecipients: string[] = [];

      if (recipients.sendToAssessor && caseData.assessorEmail) {
        emailRecipients.push(caseData.assessorEmail);
      }
      if (recipients.sendToInvestigator && caseData.investigatorEmail) {
        emailRecipients.push(caseData.investigatorEmail);
      }
      if (recipients.manualEmail && recipients.manualEmail.trim()) {
        emailRecipients.push(recipients.manualEmail.trim());
      }

      if (emailRecipients.length === 0) {
        return res
          .status(400)
          .json({ error: "수신자 이메일이 선택되지 않았습니다" });
      }

      const subjectIdentifier =
        caseData.insuranceAccidentNo ||
        caseData.insurancePolicyNo ||
        caseData.caseNumber ||
        "-";
      const subject = `[FLOXN] 접수취소- ${subjectIdentifier}`;

      const today = new Date();
      const kstDate = new Date(today.getTime() + 9 * 60 * 60 * 1000);
      const dateStr = `${kstDate.getFullYear()}.${String(kstDate.getMonth() + 1).padStart(2, "0")}.${String(kstDate.getDate()).padStart(2, "0")}`;

      const accidentNo =
        caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "-";
      const caseNumber = caseData.caseNumber || "-";
      const insuredName = caseData.insuredName || "-";

      // 로고 파일 로드
      let logoBuffer: Buffer | null = null;
      try {
        const logoPath = path.join(
          process.cwd(),
          "attached_assets",
          "logo_1767744300048.png",
        );
        if (fs.existsSync(logoPath)) {
          logoBuffer = fs.readFileSync(logoPath);
          console.log(
            `[send-cancellation-email] Logo loaded: ${logoBuffer.length} bytes`,
          );
        } else {
          console.warn(
            `[send-cancellation-email] Logo file not found: ${logoPath}`,
          );
        }
      } catch (logoError) {
        console.warn(
          `[send-cancellation-email] Failed to load logo:`,
          logoError,
        );
      }

      // ========== PDF 생성 ==========
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
      const fontkit = (await import("@pdf-lib/fontkit")).default;

      const pdfDoc = await PDFDocument.create();
      pdfDoc.registerFontkit(fontkit);

      // 한글 폰트 로드 (Pretendard TTF 형식 사용 - pdf-lib 호환성)
      const fontPath = path.join(
        process.cwd(),
        "server",
        "fonts",
        "Pretendard-Regular.ttf",
      );
      let customFont;
      let boldFont;
      try {
        console.log("[send-cancellation-email] Loading font from:", fontPath);
        const fontBytes = fs.readFileSync(fontPath);
        console.log(
          "[send-cancellation-email] Font bytes loaded:",
          fontBytes.length,
        );
        customFont = await pdfDoc.embedFont(fontBytes);
        const boldFontPath = path.join(
          process.cwd(),
          "server",
          "fonts",
          "Pretendard-SemiBold.ttf",
        );
        if (fs.existsSync(boldFontPath)) {
          const boldFontBytes = fs.readFileSync(boldFontPath);
          boldFont = await pdfDoc.embedFont(boldFontBytes);
        } else {
          boldFont = customFont;
        }
        console.log(
          "[send-cancellation-email] Korean fonts loaded successfully",
        );
      } catch (fontError) {
        console.error("[send-cancellation-email] Font load error:", fontError);
        throw new Error("한글 폰트 로드 실패");
      }

      const page = pdfDoc.addPage([595, 842]); // A4 size
      const { width, height } = page.getSize();
      const margin = 50;
      let yPos = height - margin;

      // 헤더 텍스트 정규화 함수 (ASCII '-' 유지, U+2010/U+2212 치환 금지)
      const normalizeText = (text: string): string => {
        if (!text) return "";
        let s = String(text);
        // 1) 유니코드 공백을 일반 공백으로 통일 (NBSP, zero-width 등)
        s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");
        // 2) 대시류(en dash, em dash, minus)만 ASCII '-'로 통일
        s = s.replace(/[–—−]/g, "-");
        // 3) 코드 패턴([A-Za-z0-9]) 사이 하이픈에서만 공백 제거
        s = s.replace(/([A-Za-z0-9])\s*-\s*([A-Za-z0-9])/g, "$1-$2");
        // 4) 연속 공백 축소
        s = s.replace(/ {2,}/g, " ");
        return s.trim();
      };

      // 하이픈 간격 보정하여 텍스트 그리기 (현장출동보고서와 동일 방식)
      const drawTextTight = (
        text: string,
        startX: number,
        textY: number,
        textSize: number,
        font: any,
        textColor: any,
      ) => {
        const normalizedText = normalizeText(text);
        if (!normalizedText) return;
        const offset = textSize * 0.06;
        const parts = normalizedText.split("-");
        let cursorX = startX;
        const hyphenWidth = font.widthOfTextAtSize("-", textSize);

        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) {
            page.drawText(parts[i], {
              x: cursorX,
              y: textY,
              size: textSize,
              font,
              color: textColor,
            });
            cursorX += font.widthOfTextAtSize(parts[i], textSize);
          }
          if (i < parts.length - 1) {
            page.drawText("-", {
              x: cursorX,
              y: textY,
              size: textSize,
              font,
              color: textColor,
            });
            cursorX += hyphenWidth - offset;
          }
        }
      };

      // ========== 제목: 접수취소 안내 ==========
      const titleText = "접수취소 안내";
      const titleWidth = boldFont.widthOfTextAtSize(titleText, 22);
      page.drawText(titleText, {
        x: (width - titleWidth) / 2,
        y: yPos,
        size: 22,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      yPos -= 50;

      // ========== 수신 라인 ==========
      const insuranceCompany = caseData.insuranceCompany || "-";
      page.drawText("수 신", {
        x: margin,
        y: yPos,
        size: 12,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      page.drawText(insuranceCompany, {
        x: margin + 50,
        y: yPos,
        size: 12,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      // 밑줄
      const nameWidth = customFont.widthOfTextAtSize(insuranceCompany, 12);
      page.drawLine({
        start: { x: margin + 50, y: yPos - 3 },
        end: { x: margin + 50 + Math.max(nameWidth, 150), y: yPos - 3 },
        thickness: 0.5,
        color: rgb(0, 0, 0),
      });
      page.drawText("귀하", {
        x: width - margin - 30,
        y: yPos,
        size: 12,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      yPos -= 30;

      // ========== 테이블 ==========
      const tableWidth = width - margin * 2;
      const rowHeight = 30;
      const col1Width = 100; // 사고번호(증권번호)
      const col2Width = 145; // 값
      const col3Width = 80; // 수임일자/취소일자
      const col4Width = tableWidth - col1Width - col2Width - col3Width; // 나머지

      // 수임일자
      let receptionDateStr = "-";
      if (caseData.receptionDate) {
        const rd = new Date(caseData.receptionDate);
        receptionDateStr = `${rd.getFullYear()}-${String(rd.getMonth() + 1).padStart(2, "0")}-${String(rd.getDate()).padStart(2, "0")}`;
      }

      // Row 1: 사고번호(증권번호) | value | 수임일자 | value
      // 셀 1-1
      page.drawRectangle({
        x: margin,
        y: yPos - rowHeight,
        width: col1Width,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      page.drawText("사고번호(증권번호)", {
        x: margin + 5,
        y: yPos - 20,
        size: 10,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      // 셀 1-2
      page.drawRectangle({
        x: margin + col1Width,
        y: yPos - rowHeight,
        width: col2Width,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      drawTextTight(
        accidentNo,
        margin + col1Width + 5,
        yPos - 20,
        10,
        customFont,
        rgb(0, 0, 0),
      );
      // 셀 1-3
      page.drawRectangle({
        x: margin + col1Width + col2Width,
        y: yPos - rowHeight,
        width: col3Width,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      page.drawText("수임일자", {
        x: margin + col1Width + col2Width + 5,
        y: yPos - 20,
        size: 10,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      // 셀 1-4
      page.drawRectangle({
        x: margin + col1Width + col2Width + col3Width,
        y: yPos - rowHeight,
        width: col4Width,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      drawTextTight(
        receptionDateStr,
        margin + col1Width + col2Width + col3Width + 5,
        yPos - 20,
        10,
        customFont,
        rgb(0, 0, 0),
      );
      yPos -= rowHeight;

      // Row 2: 피보험자명 | value | 취소일자 | value
      page.drawRectangle({
        x: margin,
        y: yPos - rowHeight,
        width: col1Width,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      page.drawText("피보험자명", {
        x: margin + 5,
        y: yPos - 20,
        size: 10,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      page.drawRectangle({
        x: margin + col1Width,
        y: yPos - rowHeight,
        width: col2Width,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      drawTextTight(
        insuredName,
        margin + col1Width + 5,
        yPos - 20,
        10,
        customFont,
        rgb(0, 0, 0),
      );
      page.drawRectangle({
        x: margin + col1Width + col2Width,
        y: yPos - rowHeight,
        width: col3Width,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      page.drawText("취소일자", {
        x: margin + col1Width + col2Width + 5,
        y: yPos - 20,
        size: 10,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      page.drawRectangle({
        x: margin + col1Width + col2Width + col3Width,
        y: yPos - rowHeight,
        width: col4Width,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      drawTextTight(
        dateStr,
        margin + col1Width + col2Width + col3Width + 5,
        yPos - 20,
        10,
        customFont,
        rgb(0, 0, 0),
      );
      yPos -= rowHeight;

      // Row 3: 취소사유 (full width)
      const reasonText = normalizeText(cancelReason || "-");
      const reasonCellWidth = tableWidth - col1Width - 10; // 셀 내부 패딩 고려
      const reasonFontSize = 10;
      const reasonLines: string[] = [];

      // 폰트 너비 기준으로 줄바꿈 계산
      let currentLine = "";
      for (const char of reasonText) {
        const testLine = currentLine + char;
        const testWidth = customFont.widthOfTextAtSize(
          testLine,
          reasonFontSize,
        );
        if (testWidth > reasonCellWidth) {
          if (currentLine) {
            reasonLines.push(currentLine);
          }
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        reasonLines.push(currentLine);
      }
      if (reasonLines.length === 0) {
        reasonLines.push("-");
      }
      const lineHeight = 16;
      const reasonRowHeight = Math.max(
        rowHeight,
        reasonLines.length * lineHeight + 14,
      );

      // 취소사유 라벨 셀
      page.drawRectangle({
        x: margin,
        y: yPos - reasonRowHeight,
        width: col1Width,
        height: reasonRowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      page.drawText("취소사유", {
        x: margin + 5,
        y: yPos - reasonRowHeight / 2 - 4,
        size: 10,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      // 취소사유 내용 셀
      page.drawRectangle({
        x: margin + col1Width,
        y: yPos - reasonRowHeight,
        width: tableWidth - col1Width,
        height: reasonRowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
      let textY = yPos - 18;
      for (const line of reasonLines) {
        page.drawText(line, {
          x: margin + col1Width + 5,
          y: textY,
          size: 10,
          font: customFont,
          color: rgb(0, 0, 0),
        });
        textY -= lineHeight;
      }
      yPos -= reasonRowHeight;

      // ========== 본문 텍스트 ==========
      yPos -= 30;
      page.drawText("상기 건에 대하여 접수취소 사유를 첨부하여 송부드립니다.", {
        x: margin,
        y: yPos,
        size: 11,
        font: customFont,
        color: rgb(0, 0, 0),
      });

      // ========== 날짜 ==========
      yPos -= 40;
      const now = new Date();
      const koreanDate = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
      const dateWidth = customFont.widthOfTextAtSize(koreanDate, 12);
      page.drawText(koreanDate, {
        x: (width - dateWidth) / 2,
        y: yPos,
        size: 12,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      yPos -= 40;

      // ========== 하단 푸터: 가로선 + FLOXN., Inc ==========
      const footerY = yPos - 30;
      const lineStartX = margin + 50;
      const lineEndX = width - margin - 50;

      // 가로선
      page.drawLine({
        start: { x: lineStartX, y: footerY },
        end: { x: lineEndX, y: footerY },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      // FLOXN., Inc 텍스트 (중앙 정렬)
      const footerText = "FLOXN., Inc";
      const footerTextWidth = customFont.widthOfTextAtSize(footerText, 10);
      page.drawText(footerText, {
        x: (width - footerTextWidth) / 2,
        y: footerY - 18,
        size: 10,
        font: customFont,
        color: rgb(0, 0, 0),
      });

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);
      console.log(
        `[send-cancellation-email] PDF generated: ${pdfBuffer.length} bytes`,
      );

      const htmlContent = `
        <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; text-align: center; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px;">접수취소 안내드립니다.</h2>
          
          <p style="color: #333; line-height: 1.8; margin-bottom: 20px;">
            안녕하세요.<br/>
            아래 내용의 <strong>접수취소</strong> 사유를 첨부하여 송부드립니다.
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="background: #f8f8f8; padding: 10px 15px; border: 1px solid #ccc; width: 35%; font-weight: bold;">사고번호(증권번호)</td>
              <td style="padding: 10px 15px; border: 1px solid #ccc;">${accidentNo}</td>
            </tr>
            <tr>
              <td style="background: #f8f8f8; padding: 10px 15px; border: 1px solid #ccc; font-weight: bold;">피보험자명</td>
              <td style="padding: 10px 15px; border: 1px solid #ccc;">${insuredName}</td>
            </tr>
            <tr>
              <td style="background: #f8f8f8; padding: 10px 15px; border: 1px solid #ccc; font-weight: bold;">취소사유</td>
              <td style="padding: 10px 15px; border: 1px solid #ccc;">${cancelReason || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f8f8f8; padding: 10px 15px; border: 1px solid #ccc; font-weight: bold;">발송일</td>
              <td style="padding: 10px 15px; border: 1px solid #ccc;">${dateStr}</td>
            </tr>
          </table>
          
          <p style="color: #333; line-height: 1.8; margin: 20px 0;">
            첨부된 PDF 파일을 확인해주시길 바랍니다. 감사합니다.
          </p>
          
          <div style="border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 24px;">
            ${logoBuffer ? '<img src="cid:floxn-logo" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">' : '<p style="font-size: 14px; font-weight: bold; color: #333; margin: 0 0 8px 0;">FLOXN</p>'}
            <p style="font-size: 12px; color: #666; margin: 0 0 4px 0;">Front Line Ops Xpert Net</p>
            <p style="font-size: 12px; color: #666; margin: 0 0 4px 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
            <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
          </div>
        </div>
      `;

      const textContent = `접수취소 안내드립니다.

안녕하세요.
아래 내용의 접수취소 사유를 송부드립니다.

- 사고번호(증권번호): ${accidentNo}
- 접수번호: ${caseNumber}
- 피보험자명: ${insuredName}
- 취소사유: ${cancelReason || "-"}
- 발송일: ${dateStr}

감사합니다.
FLOXN`;

      const results: { email: string; success: boolean; error?: string }[] = [];

      // 첨부파일 준비 (PDF + 로고)
      const attachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
        cid?: string;
      }> = [];

      // PDF 첨부 - 파일명: [FLOXN] 접수취소- 사고번호 (사고번호 없으면 증권번호)
      const filenameId = (
        caseData.insuranceAccidentNo ||
        caseData.insurancePolicyNo ||
        "unknown"
      ).replace(/[^a-zA-Z0-9가-힣-]/g, "_");
      const pdfFilename = `[FLOXN] 접수취소- ${filenameId}.pdf`;
      attachments.push({
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: "application/pdf",
      });

      // 로고 첨부 (이메일 본문용)
      if (logoBuffer) {
        attachments.push({
          filename: "floxn_logo.png",
          content: logoBuffer,
          contentType: "image/png",
          cid: "floxn-logo",
        });
      }

      for (const email of emailRecipients) {
        try {
          const result = await sendEmailWithAttachment({
            to: email,
            subject,
            text: textContent,
            html: htmlContent,
            attachments,
          });

          if (result.success) {
            console.log(`[send-cancellation-email] Email sent to: ${email}`);
            results.push({ email, success: true });
          } else {
            console.error(
              `[send-cancellation-email] Failed to send to ${email}:`,
              result.error,
            );
            results.push({ email, success: false, error: result.error });
          }
        } catch (sendError: any) {
          console.error(
            `[send-cancellation-email] Error sending to ${email}:`,
            sendError,
          );
          results.push({
            email,
            success: false,
            error: sendError?.message || "발송 실패",
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      res.json({
        success: successCount > 0,
        message: `${successCount}건 이메일 발송 완료${failCount > 0 ? `, ${failCount}건 실패` : ""}`,
        results,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error(
          "[send-cancellation-email] Validation error:",
          error.errors,
        );
        return res.status(400).json({
          error: "요청 데이터가 올바르지 않습니다",
          details: error.errors,
        });
      }
      console.error("[send-cancellation-email] Error:", error);
      res.status(500).json({
        error: "이메일 발송에 실패했습니다",
        details: error instanceof Error ? error.message : "알 수 없는 오류",
      });
    }
  });

  // POST /api/submit-claim-documents - 청구자료 제출 (해당 케이스 1건만 상태 변경 + 모든 관련 케이스가 제출 완료 시 SMS 발송)
  app.post("/api/submit-claim-documents", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "인증되지 않은 사용자입니다" });
    }

    try {
      const { caseId } = req.body;
      if (!caseId) {
        return res.status(400).json({ error: "caseId가 필요합니다" });
      }

      // 현재 케이스 조회
      const currentCase = await storage.getCaseById(caseId);
      if (!currentCase) {
        return res.status(404).json({ error: "케이스를 찾을 수 없습니다" });
      }

      // 현재 케이스가 직접복구 상태인지 확인
      if (currentCase.status !== "직접복구") {
        return res.status(400).json({
          error: "직접복구 상태인 케이스만 청구자료를 제출할 수 있습니다",
        });
      }

      // 1. 해당 케이스 1건만 청구자료제출 상태로 변경 + 복구완료일 설정
      // KST 오늘 날짜
      const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const constructionCompletionDateStr = kstNow.toISOString().split("T")[0];

      const updatedCase = await storage.updateCase(caseId, {
        status: "청구자료제출(복구)",
        constructionCompletionDate: constructionCompletionDateStr, // 복구완료일 설정
      });

      if (!updatedCase) {
        return res
          .status(500)
          .json({ error: "케이스 상태 변경에 실패했습니다" });
      }

      console.log(
        `[submit-claim-documents] Updated case ${caseId} to 청구자료제출`,
      );

      // 2. 동일 사고번호의 모든 직접복구/청구자료제출/선견적요청 케이스 조회
      const accidentNo = currentCase.insuranceAccidentNo;
      const allCases = await storage.getAllCases();
      const relatedCases = accidentNo
        ? allCases.filter(
            (c) =>
              c.insuranceAccidentNo === accidentNo &&
              (c.status === "직접복구" ||
                c.status === "청구자료제출(복구)" ||
                c.status === "선견적요청" ||
                c.status === "출동비청구(선견적)"),
          )
        : [updatedCase];

      // 3. 모든 관련 케이스가 청구자료제출 또는 출동비청구 상태인지 확인
      const allSubmitted = relatedCases.every(
        (c) =>
          c.status === "청구자료제출(복구)" ||
          c.status === "출동비청구(선견적)",
      );
      let smsSent = false;

      if (allSubmitted && relatedCases.length > 0) {
        console.log(
          `[submit-claim-documents] All ${relatedCases.length} cases submitted, sending SMS`,
        );

        // 플록슨 담당자에게 SMS 발송
        const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
        const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
        const SOLAPI_SENDER_NUMBER = process.env.SOLAPI_SENDER_NUMBER;

        if (SOLAPI_API_KEY && SOLAPI_API_SECRET && SOLAPI_SENDER_NUMBER) {
          // 현재 제출한 케이스 정보 사용 (updatedCase)
          const submittedCase = updatedCase;
          const addressMain =
            submittedCase.victimAddress || submittedCase.insuredAddress;
          const addressDetail =
            submittedCase.victimAddressDetail ||
            submittedCase.insuredAddressDetail;
          const fullAddress = [addressMain, addressDetail]
            .filter(Boolean)
            .join(" ");

          // 모든 관련 케이스의 접수번호 목록 생성
          const allCaseNumbers = relatedCases
            .map((c) => c.caseNumber)
            .filter(Boolean)
            .join(", ");

          const messageText = `<청구자료제출 알림>

접수번호 : ${allCaseNumbers || submittedCase.caseNumber || "-"}
보험사 : ${submittedCase.insuranceCompany || "-"}
증권번호 : ${submittedCase.insurancePolicyNo || "-"}
사고번호 : ${submittedCase.insuranceAccidentNo || "-"}
피보험자 : ${submittedCase.insuredName || "-"}
사고장소 : ${fullAddress || "-"}
진행사항 : 청구자료제출 (${relatedCases.length}건 완료)`;

          // 플록슨 담당자 번호 조회 (managerId를 통해 사용자 정보에서 조회)
          let floxnManagerPhone: string | null = null;
          if (submittedCase.managerId) {
            const manager = await storage.getUser(submittedCase.managerId);
            floxnManagerPhone = manager?.phone || null;
          }

          if (floxnManagerPhone) {
            try {
              const authHeader = createSolapiAuthHeader(
                SOLAPI_API_KEY,
                SOLAPI_API_SECRET,
              );
              const smsBody = JSON.stringify({
                message: {
                  to: floxnManagerPhone.replace(/-/g, ""),
                  from: SOLAPI_SENDER_NUMBER.replace(/-/g, ""),
                  text: messageText,
                  type: "LMS",
                },
              });

              await solapiHttpsRequest({
                method: "POST",
                path: "/messages/v4/send",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: authHeader,
                  "Content-Length": Buffer.byteLength(smsBody, "utf8"),
                },
                body: smsBody,
              });
              console.log(
                `[submit-claim-documents] SMS sent to Floxn manager: ${floxnManagerPhone}`,
              );
              smsSent = true;
            } catch (smsError) {
              console.error(
                "[submit-claim-documents] SMS send error:",
                smsError,
              );
            }
          } else {
            console.log(
              "[submit-claim-documents] No Floxn manager phone number found",
            );
          }
        }
      } else {
        const remaining = relatedCases.filter(
          (c) => c.status === "직접복구",
        ).length;
        console.log(
          `[submit-claim-documents] ${remaining} cases remaining to submit`,
        );
      }

      res.json({
        success: true,
        message: allSubmitted
          ? `청구자료가 제출되었습니다. (${relatedCases.length}건 모두 완료${smsSent ? ", SMS 발송 완료" : ""})`
          : `청구자료가 제출되었습니다. (${relatedCases.filter((c) => c.status === "직접복구").length}건 남음)`,
        updatedCount: 1,
        allSubmitted,
        smsSent,
      });
    } catch (error: any) {
      console.error("[submit-claim-documents] Error:", error);
      res.status(500).json({
        error: "청구자료 제출 처리 중 오류가 발생했습니다",
        details: error instanceof Error ? error.message : "알 수 없는 오류",
      });
    }
  });

  // =====================
  // Settlement endpoints
  // =====================

  // Create a new settlement
  app.post("/api/settlements", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "로그인이 필요합니다" });
      }

      const validatedData = insertSettlementSchema.parse(req.body);
      const settlement = await storage.createSettlement(
        validatedData,
        req.session.userId,
      );

      res.status(201).json(settlement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create settlement error:", error);
      res.status(500).json({ error: "정산 생성 중 오류가 발생했습니다" });
    }
  });

  // Get all settlements
  app.get("/api/settlements", async (req, res) => {
    try {
      const settlements = await storage.getAllSettlements();
      res.json(settlements);
    } catch (error) {
      console.error("Get all settlements error:", error);
      res.status(500).json({ error: "정산 목록 조회 중 오류가 발생했습니다" });
    }
  });

  // Get settlements by case ID
  app.get("/api/settlements/case/:caseId", async (req, res) => {
    try {
      const { caseId } = req.params;
      const settlements = await storage.getSettlementsByCaseId(caseId);
      res.json(settlements);
    } catch (error) {
      console.error("Get settlements by case error:", error);
      res
        .status(500)
        .json({ error: "케이스별 정산 조회 중 오류가 발생했습니다" });
    }
  });

  // Get latest settlement for a case
  app.get("/api/settlements/case/:caseId/latest", async (req, res) => {
    try {
      const { caseId } = req.params;
      const settlement = await storage.getLatestSettlementByCaseId(caseId);
      res.json(settlement);
    } catch (error) {
      console.error("Get latest settlement error:", error);
      res.status(500).json({ error: "최신 정산 조회 중 오류가 발생했습니다" });
    }
  });

  // Update settlement
  app.patch("/api/settlements/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "로그인이 필요합니다" });
      }

      const { id } = req.params;
      const updated = await storage.updateSettlement(id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "정산 정보를 찾을 수 없습니다" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Update settlement error:", error);
      res.status(500).json({ error: "정산 수정 중 오류가 발생했습니다" });
    }
  });

  // =====================
  // Labor Rate Tiers endpoints (C/D 비율 적용률)
  // =====================

  // Get all labor rate tiers
  app.get("/api/labor-rate-tiers", async (req, res) => {
    try {
      const tiers = await storage.getLaborRateTiers();
      res.json(tiers);
    } catch (error) {
      console.error("Get labor rate tiers error:", error);
      res
        .status(500)
        .json({ error: "노임단가 적용률 조회 중 오류가 발생했습니다" });
    }
  });

  // Update labor rate tiers
  app.put("/api/labor-rate-tiers", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "로그인이 필요합니다" });
      }

      const { tiers } = req.body;
      if (!Array.isArray(tiers)) {
        return res.status(400).json({ error: "tiers 배열이 필요합니다" });
      }

      const updatedTiers = await storage.updateLaborRateTiers(tiers);
      res.json(updatedTiers);
    } catch (error) {
      console.error("Update labor rate tiers error:", error);
      res
        .status(500)
        .json({ error: "노임단가 적용률 수정 중 오류가 발생했습니다" });
    }
  });

  // =====================
  // Invoice endpoints (인보이스 관리)
  // =====================

  // Create invoice
  app.post("/api/invoices", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "로그인이 필요합니다" });
      }

      const invoice = await storage.createInvoice(req.body, req.session.userId);
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Create invoice error:", error);
      res.status(500).json({ error: "인보이스 생성 중 오류가 발생했습니다" });
    }
  });

  // Update invoice
  app.patch("/api/invoices/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "로그인이 필요합니다" });
      }

      const { id } = req.params;
      const invoice = await storage.updateInvoice(id, req.body);
      if (!invoice) {
        return res.status(404).json({ error: "인보이스를 찾을 수 없습니다" });
      }
      res.json(invoice);
    } catch (error) {
      console.error("Update invoice error:", error);
      res.status(500).json({ error: "인보이스 수정 중 오류가 발생했습니다" });
    }
  });

  // Get all invoices
  app.get("/api/invoices", async (req, res) => {
    try {
      const invoices = await storage.getAllInvoices();
      res.json(invoices);
    } catch (error) {
      console.error("Get all invoices error:", error);
      res
        .status(500)
        .json({ error: "인보이스 목록 조회 중 오류가 발생했습니다" });
    }
  });

  // Get approved invoices only
  app.get("/api/invoices/approved", async (req, res) => {
    try {
      const invoices = await storage.getApprovedInvoices();
      res.json(invoices);
    } catch (error) {
      console.error("Get approved invoices error:", error);
      res
        .status(500)
        .json({ error: "승인된 인보이스 조회 중 오류가 발생했습니다" });
    }
  });

  // Get invoice by ID
  app.get("/api/invoices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const invoice = await storage.getInvoiceById(id);
      if (!invoice) {
        return res.status(404).json({ error: "인보이스를 찾을 수 없습니다" });
      }
      res.json(invoice);
    } catch (error) {
      console.error("Get invoice error:", error);
      res.status(500).json({ error: "인보이스 조회 중 오류가 발생했습니다" });
    }
  });

  // Get invoice by case ID
  app.get("/api/invoices/case/:caseId", async (req, res) => {
    try {
      const { caseId } = req.params;
      const invoice = await storage.getInvoiceByCaseId(caseId);
      res.json(invoice);
    } catch (error) {
      console.error("Get invoice by case error:", error);
      res
        .status(500)
        .json({ error: "케이스별 인보이스 조회 중 오류가 발생했습니다" });
    }
  });

  // Get invoice by case group prefix
  app.get("/api/invoices/group/:prefix", async (req, res) => {
    try {
      const { prefix } = req.params;
      const invoice = await storage.getInvoiceByCaseGroupPrefix(prefix);
      res.json(invoice);
    } catch (error) {
      console.error("Get invoice by group prefix error:", error);
      res
        .status(500)
        .json({ error: "그룹별 인보이스 조회 중 오류가 발생했습니다" });
    }
  });

  // Get approved amounts for invoice by case group prefix
  // Returns damage prevention amount (from -0 case) and property repair amount (from -1+ cases)
  app.get("/api/invoice-amounts/:prefix", async (req, res) => {
    try {
      const { prefix } = req.params;
      const allCases = await storage.getAllCases();

      // Filter cases by prefix
      const groupCases = allCases.filter(
        (c: { caseNumber?: string | null }) => {
          if (!c.caseNumber) return false;
          const casePrefix = c.caseNumber.split("-")[0];
          return casePrefix === prefix;
        },
      );

      // Approved statuses (1차승인 or later in the workflow)
      const approvedStatuses = [
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
        "부분지급",
        "지급완료",
        "정산완료",
      ];

      let damagePreventionAmount = 0;
      let propertyRepairAmount = 0;

      for (const c of groupCases) {
        if (!c.caseNumber || !approvedStatuses.includes(c.status || ""))
          continue;

        // 선견적요청 건은 인보이스 금액에서 제외 (현장출동비용으로 별도 청구)
        if (c.recoveryType === "선견적요청") {
          console.log(`[invoice-amounts] 선견적요청 건 제외: ${c.caseNumber}`);
          continue;
        }

        const suffix = c.caseNumber.split("-")[1];
        // 인보이스에는 invoiceAmount > approvedAmount > estimateAmount 순으로 사용
        const amount =
          parseInt(
            c.invoiceAmount || c.approvedAmount || c.estimateAmount || "0",
          ) || 0;

        if (suffix === "0") {
          // Damage prevention case (-0)
          damagePreventionAmount += amount;
        } else if (suffix && parseInt(suffix) >= 1) {
          // Property repair case (-1, -2, ...)
          propertyRepairAmount += amount;
        }
      }

      res.json({
        damagePreventionAmount,
        propertyRepairAmount,
        totalAmount: damagePreventionAmount + propertyRepairAmount,
      });
    } catch (error) {
      console.error("Get invoice amounts error:", error);
      res
        .status(500)
        .json({ error: "인보이스 금액 조회 중 오류가 발생했습니다" });
    }
  });

  // PDF 다운로드 엔드포인트
  const pdfDownloadSchema = z.object({
    caseId: z.string().min(1),
    sections: z.object({
      cover: z.boolean().default(false),
      fieldReport: z.boolean().default(false),
      drawing: z.boolean().default(false),
      evidence: z.boolean().default(false),
      estimate: z.boolean().default(false),
      etc: z.boolean().default(false),
    }),
    evidence: z
      .object({
        tab: z.string().default("전체"),
        selectedFileIds: z.array(z.string()).default([]),
      })
      .default({ tab: "전체", selectedFileIds: [] }),
  });

  app.post("/api/pdf/download", async (req, res) => {
    try {
      const payload = pdfDownloadSchema.parse(req.body);

      // 용량 제한 PDF 생성 사용 (대용량 첨부파일 케이스 대응)
      console.log(
        `[pdf-download] Starting PDF generation for case ${payload.caseId}`,
      );
      const pdfBuffer = await generatePdfWithSizeLimitPdfLib({
        ...payload,
        skipPdfAttachments: false, // PDF 첨부 파일도 포함
      });
      console.log(
        `[pdf-download] PDF generated: ${Math.round(pdfBuffer.length / 1024)}KB (${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB)`,
      );

      const caseData = await storage.getCaseById(payload.caseId);
      const accidentNo =
        caseData?.insuranceAccidentNo || caseData?.caseNumber || payload.caseId;

      // -0 (손해방지/피보험자) 건: 피보험자 상세주소 사용
      // -1 이상 (피해자 복구) 건: 피해자 상세주소 사용
      const isLossPreventionCase = /-0$/.test(caseData?.caseNumber || "");
      const detailAddress = isLossPreventionCase
        ? caseData?.insuredAddressDetail || caseData?.insuredAddress || ""
        : caseData?.victimAddressDetail ||
          caseData?.victimAddress ||
          caseData?.insuredAddressDetail ||
          caseData?.insuredAddress ||
          "";

      const safeDetailAddress = detailAddress.replace(/[<>:"/\\|?*]/g, "_");
      const filename = safeDetailAddress
        ? `현장출동보고서 _${accidentNo} (${safeDetailAddress}).pdf`
        : `현장출동보고서 _${accidentNo}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("PDF generation error:", error);
      res.status(500).json({ error: "PDF 생성 중 오류가 발생했습니다" });
    }
  });

  // ========== 견적서 제외 항목 API (철거공사 노무비 삭제 영속화) ==========

  // 케이스별 제외 항목 조회
  app.get("/api/cases/:caseId/estimate-exclusions", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "로그인이 필요합니다" });
      }

      const { caseId } = req.params;
      const { type } = req.query;

      const exclusionType = (type as string) || "demolition_auto_labor";
      const exclusions = await storage.getEstimateExclusions(
        caseId,
        exclusionType,
      );

      res.json(exclusions);
    } catch (error) {
      console.error("Get estimate exclusions error:", error);
      res.status(500).json({ error: "제외 항목 조회 중 오류가 발생했습니다" });
    }
  });

  // 제외 항목 추가 (삭제 클릭 시 즉시 호출)
  app.post("/api/cases/:caseId/estimate-exclusions", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "로그인이 필요합니다" });
      }

      const { caseId } = req.params;
      const { exclusionType, deletionKey } = req.body;

      if (!exclusionType || !deletionKey) {
        return res
          .status(400)
          .json({ error: "exclusionType과 deletionKey가 필요합니다" });
      }

      console.log(
        `[Exclusion] Adding: caseId=${caseId}, type=${exclusionType}, key=${deletionKey}`,
      );

      const exclusion = await storage.addEstimateExclusion({
        caseId,
        exclusionType,
        deletionKey,
      });

      res.json(exclusion);
    } catch (error) {
      console.error("Add estimate exclusion error:", error);
      res.status(500).json({ error: "제외 항목 추가 중 오류가 발생했습니다" });
    }
  });

  // 제외 항목 삭제 (제외 해제)
  app.delete("/api/cases/:caseId/estimate-exclusions", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "로그인이 필요합니다" });
      }

      const { caseId } = req.params;
      const { exclusionType, deletionKey } = req.body;

      if (!exclusionType || !deletionKey) {
        return res
          .status(400)
          .json({ error: "exclusionType과 deletionKey가 필요합니다" });
      }

      console.log(
        `[Exclusion] Removing: caseId=${caseId}, type=${exclusionType}, key=${deletionKey}`,
      );

      const removed = await storage.removeEstimateExclusion(
        caseId,
        exclusionType,
        deletionKey,
      );

      res.json({ success: removed });
    } catch (error) {
      console.error("Remove estimate exclusion error:", error);
      res.status(500).json({ error: "제외 항목 삭제 중 오류가 발생했습니다" });
    }
  });

  // 임시 관리자 엔드포인트: 초기 견적금액 백필 (GET으로 변경하여 브라우저에서 호출 가능)
  app.get("/api/admin/backfill-initial-estimates", async (req, res) => {
    try {
      // 관리자 권한 확인
      if (!req.session?.userId) {
        return res
          .status(401)
          .json({ error: "인증이 필요합니다. 로그인 후 이 URL을 방문하세요." });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "관리자") {
        return res.status(403).json({ error: "관리자 권한이 필요합니다" });
      }

      // 1. 기존 initial_estimate_amount 백필
      const result1 = await db.execute(sql`
        UPDATE cases 
        SET initial_estimate_amount = estimate_amount 
        WHERE estimate_amount IS NOT NULL 
          AND initial_estimate_amount IS NULL 
          AND field_survey_status IN ('submitted', 'approved', 'rejected')
        RETURNING id, case_number
      `);

      // 2. 손해방지비용(-0)에 대한 initial_prevention_estimate_amount 백필
      // 케이스 번호가 -0으로 끝나는 경우
      const result2 = await db.execute(sql`
        UPDATE cases 
        SET initial_prevention_estimate_amount = estimate_amount 
        WHERE estimate_amount IS NOT NULL 
          AND (initial_prevention_estimate_amount IS NULL OR initial_prevention_estimate_amount = '')
          AND field_survey_status IN ('submitted', 'approved', 'rejected')
          AND case_number LIKE '%-0'
        RETURNING id, case_number, estimate_amount
      `);

      // 3. 대물비용(-1, -2, etc)에 대한 initial_property_estimate_amount 백필
      // 케이스 번호가 -0이 아닌 경우 (숫자로 끝나지만 -0은 아닌 경우)
      const result3 = await db.execute(sql`
        UPDATE cases 
        SET initial_property_estimate_amount = estimate_amount 
        WHERE estimate_amount IS NOT NULL 
          AND (initial_property_estimate_amount IS NULL OR initial_property_estimate_amount = '')
          AND field_survey_status IN ('submitted', 'approved', 'rejected')
          AND case_number ~ '-[1-9][0-9]*$'
        RETURNING id, case_number, estimate_amount
      `);

      console.log(
        "[Backfill] Updated initial_estimate_amount:",
        result1.rows.length,
      );
      console.log(
        "[Backfill] Updated initial_prevention_estimate_amount:",
        result2.rows.length,
      );
      console.log(
        "[Backfill] Updated initial_property_estimate_amount:",
        result3.rows.length,
      );

      res.json({
        success: true,
        message: `백필 완료: initial_estimate_amount=${result1.rows.length}건, 손해방지비용=${result2.rows.length}건, 대물비용=${result3.rows.length}건`,
        details: {
          initialEstimate: result1.rows.length,
          prevention: result2.rows,
          property: result3.rows,
        },
      });
    } catch (error) {
      console.error("Backfill error:", error);
      res.status(500).json({ error: "백필 중 오류가 발생했습니다" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
