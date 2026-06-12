---
name: 스키마 변경 적용 경로(auto-schema-sync)
description: 새 테이블/컬럼을 prod까지 반영하려면 어디에 써야 하는지, db:push의 함정
---

# 스키마 변경은 server/auto-schema-sync.ts에 idempotent SQL로 추가

`server/auto-schema-sync.ts`의 `migrations` 배열이 매 서버 기동 시 DEV와 PROD
양쪽 DB에 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
형태로 idempotent 적용된다(기동 로그 `[SCHEMA-SYNC] ... N/N migrations applied`).

**Why:** drizzle 스키마(shared/schema.ts)만 바꾸면 런타임 DB에는 반영되지 않는다.
`npm run db:push`(drizzle-kit)는 이 환경에서 대화형 프롬프트("create table or rename?")가
떠 비대화 실행이 불안정/킬됨. 또 db:push는 보통 DEV만 건드려 배포 시 PROD에 테이블
누락 위험.

**How to apply:** 새 테이블/컬럼이 필요하면 (1) shared/schema.ts에 drizzle 정의 추가,
(2) auto-schema-sync.ts의 migrations 배열에 동일 구조의 idempotent SQL 추가
(제약명은 drizzle 기본명 `<table>_<col>..._unique` 등으로 맞춰 향후 정합성 유지),
(3) 서버 재시작 후 로그에서 DEV/PROD 모두 N/N 적용 확인. 급하면 DEV 즉시반영은
code_execution의 executeSql로 동일 SQL 직접 실행 가능(단 auto-schema-sync에도 반드시 추가).
