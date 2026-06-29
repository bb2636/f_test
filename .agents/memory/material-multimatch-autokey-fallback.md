---
name: 다중매칭 자재행 autoKey 불일치(레거시) 보존
description: 복구면적 sync가 다중매칭을 __NONE__ autoKey로 만들어 레거시 item-suffixed 저장행과 빗나가 자재명이 풀리는 문제와 해법
---

규칙: 복구면적→자재행 sync(syncMaterialFromRecoveryArea)는 한 공사명에 자재 후보가 여럿(다중매칭, 예: 도배=실크/합지벽지)이면 autoKey를 항상 `공종|공사명|__NONE__`로 만든다. 그런데 과거 "자재항목 포함 키" 시절(2026-05-04 롤백)에 저장된 레거시 행은 autoKey가 `공종|공사명|<자재명>`(예: `수상공사|도배|실크벽지`)이다.

증상: 견적서/자재비 탭(공유 materialRows)에서 사용자가 고른 자재명이 빈 "선택"으로, 단가가 "가격 입력"으로 풀리고 수량만 복구면적값으로 재계산됨. (현장출동보고서는 별도 스냅샷이라 정상으로 보임 → 대조 시 혼동 주의.)

원인: existingRow lookup이 full autoKey(`...|__NONE__`)와 bare(`공종|공사명`)만 시도. 레거시 행은 full autoKey(`...|실크벽지`)로 등록돼 둘 다 MISS → reconcile staleness(키=row.autoKey)가 레거시 행을 stale 판정·삭제 → 빈 `__NONE__` 행 신규 생성. 보존 분기는 "행을 찾기만 하면" 비어있지 않은 자재명/단가를 보존하므로 진짜 문제는 lookup MISS.

해법(3점 세트):
1. `existingAutoRowsByBareKey`(`공종|normalizedName`→row) 맵을 별도 구성(잠금행 포함, 자재명 채워진 행 우선). normalizeMaterialWorkName 정규화로 data측 fallbackKey(가설공사 건축물보양→건축물현장정리)와 정렬.
2. 다중매칭 existingRow lookup에 3차 fallback `existingAutoRowsByBareKey.get(fallbackKey)` 추가 → 레거시 행을 찾아 새 `__NONE__` 행으로 자재명/단가 이관.
3. 이관된 행 id를 `claimedAutoRowIds`에 기록 → reconcile survivor(`isStale && lockedAtSave && !forceUnlock`) 단계에서 claimed 행은 survivor로 재추가하지 않음(삭제 처리). 없으면 잠금+!forceUnlock 레거시에서 survivor(구행)+신 `__NONE__` 행 중복 발생.

**Why:** 다중매칭은 단일 행 정책이라 sync가 자재명을 키에 안 넣는데, 과거 데이터는 키에 자재명이 박혀 있어 키 스킴 불일치가 영구 잔존. 신규 편집은 autosave가 `__NONE__`로 저장(material-useredit-autosave-persist)하므로 이 경로는 레거시 데이터 전용 보강.
**How to apply:** reconcile staleness는 row.autoKey 기준임을 기억. autoKey 스킴을 바꾸는 변경은 lookup(전 fallback)·reconcile·survivor 중복까지 한 묶음으로 검토. 잠금행 이관 시 반드시 claimed 추적으로 survivor 중복을 막을 것.
