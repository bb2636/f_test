---
name: 심사사 SMS 수신번호는 사무실(office) 우선
description: 심사사(심사자)에게 문자 발송 시 어떤 번호를 쓰는지의 정책과 변경 이력
---

# 규칙
심사사(심사자)에게 SMS를 보낼 때 수신번호는 `users.office`(사무실/직통) 우선, 없으면 `users.phone` 폴백. (2026-07-07 사용자 확정)

**Why:** 과거에는 반대(phone 우선, "SMS는 사무실 번호 대신 핸드폰으로" 주석까지 있었음)로 구현돼 있었고, 사용자가 사무실 번호 수신을 요구해 뒤집음. 접수화면(intake)과 관리자 일괄동기화는 원래부터 office 우선이라 이제 전 경로 일관.

**How to apply:** 심사사 연락처를 결정하는 경로가 여러 곳에 흩어져 있다 — 새 SMS/연락처 경로를 추가하거나 수정할 때 전부 office-first인지 확인할 것:
- 서버: 접수완료 알림(send-sms 본문), 진행관리 LMS(send-lms 수신), 단계알림(send-stage-notification 본문+수신), 사용자수정 시 cases.assessorContact 동기화, 관리자 일괄동기화 SQL(COALESCE 순서)
- 클라: 수동 문자발송(floating-intake-button)의 수신인 선택 — 심사사만 office 우선, 그 외 역할은 phone 우선
- 동명이인 회피 패턴: (company, name) 매칭이 정확히 1명일 때만 users 테이블 번호를 신뢰
