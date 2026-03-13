import session from "express-session";
import createMemoryStore from "memorystore";

const MemoryStore = createMemoryStore(session);

export const sessionStore = new MemoryStore({
  checkPeriod: 86400000,
});

// userId -> sessionId 맵 (중복 로그인 방지)
export const activeUserSessions = new Map<string, string>();
