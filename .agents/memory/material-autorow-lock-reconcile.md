---
name: 자재비 연동 자동행 lock & 진입 재계산
description: 복구면적 연동 자동행(보양재 등)이 첫 진입 시 stale로 보이는 lock 메커니즘과 안전한 정정 방법
---

# 자재비(materialRows) 복구면적 연동 자동행 stale 문제

## 핵심 메커니즘
- 복구면적→노무비→자재비 순서로 입력하면, 자재비 탭을 열기 **전에** 복구면적 편집(recoverySignature sync)이 연동 자동행(예: 가설공사·건축물보양/보양재)을 먼저 만들고 autosave가 `lockedAtSave=true`로 잠근다. 이때 잠긴 값이 편집 중간합(stale)일 수 있다.
- 자동 sync 경로(`syncMaterialFromRecoveryArea(false)`)는 `lockedAtSave=true` 행의 수량을 **재계산하지 않고 OLD 값 유지**. 오직 수동 "복구면적 가져오기"(`forceUnlock=true`)만 재계산한다.

## 왜 기존 fix로 안 잡혔나
- on-load 1회 재계산(`materialAutoSyncOnLoadRef`)은 "**하이드레이션 시점에 이미 연동행 존재**" + materialRows가 deps에 없음 → 세션 내에서 새로 생성되는 신규 케이스 흐름을 못 잡음.

## 안전한 정정 규칙
- 진입 시 정정은 `syncMaterialFromRecoveryArea(true)`(forceUnlock)로 하되 **자동저장 금지**(triggerAutoSaveAfterSync 호출 안 함) — 진입만으로 옛 저장본 덮어쓰지 않는 정책 유지.
- forceUnlock은 `lockedAtSave`만 우회. 사용자 수정행(`isOverridden`/`isItemOverridden`/`isManualPriceEntry`)·수동행은 보존되므로 안전.
- **카탈로그(`materialByWorknameCatalog`) 미로드 시 재계산 금지**: matchingMaterials 빈배열이면 autoKey가 `__NONE__`로 달라져 중복행 생성 위험. `materialByWorknameCatalog.length>0 && rows.length>0` 가드 + 효과 deps에 둘 다 포함해 로드 후 재실행 보장.

**Why:** 보양재 수량은 산식이 아니라 복구면적 합으로 결정되는데, lock 때문에 자동 추종이 끊겨 첫 화면이 틀림. 산식(수량·합계 공식)은 절대 불변.
