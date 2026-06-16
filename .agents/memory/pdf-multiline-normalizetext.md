---
name: PDF 멀티라인 필드 줄바꿈 보존 (normalizeText 주의)
description: server/pdf-lib-service.ts에서 사용자 입력 줄바꿈이 사라질 때의 원인과 표준 처리 패턴
---

# PDF 멀티라인 필드의 사용자 줄바꿈이 사라지는 문제

`server/pdf-lib-service.ts`의 `normalizeText`는 정규식으로 "특수문자 앞/뒤 공백 제거"를
하는데, 정규식의 `\s`가 **개행(\n)까지 매치**한다. 그래서 멀티라인 텍스트 전체에
`normalizeText`를 한 번에 적용하면, 특수문자에 인접한 사용자 줄바꿈이 제거되어 PDF에서
한 줄로 쭉 이어져 나온다.

- **Why:** `normalizeText`는 단일 라인 정규화를 가정하고 만들어졌고, `\s`에 `\n`이 포함됨.
- **How to apply:** 멀티라인 필드(사고원인/accidentCause, VOC/vocContent 등)는
  **원문을 `split(/\r?\n/)`로 먼저 나누고 → 각 세그먼트에만 `normalizeText` 적용 →
  세그먼트별로 `wrapText`(폭 기반 줄바꿈)** 후 합친다. 빈 세그먼트는 빈 줄로 보존,
  전체가 비면 `"-"` 폴백. 행/박스 높이는 최종 라인 수 × lineHeight로 계산.
  (VOC 섹션이 이 패턴의 기준 구현. 새 멀티라인 필드 추가 시 동일 패턴 복제할 것.)
