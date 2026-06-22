---
name: users-cache 무효화 레이스 + 원자적 비번초기화
description: 사용자 인메모리 캐시 무효화가 진행중 fetch를 못 막던 레이스와, 비번초기화를 단일 UPDATE로 묶어야 하는 이유
---

# 규칙
- 사용자 in-memory 캐시(`getCachedUsers`/`invalidateUsersCache`)는 **세대(epoch) 가드** 필수: fetch 시작 시 epoch를 캡처하고, 결과 저장 직전 `usersCacheEpoch === fetchEpoch`일 때만 캐시에 쓴다. (호출자에겐 결과를 반환하되 캐시 오염은 막음)
- 비밀번호 초기화는 **password + mustChangePassword=true를 단일 UPDATE로 원자적으로** 처리한다 → `storage.resetPasswordWithForceChange`. 절대 두 번에 나눠 쓰지 말 것.

**Why:** 무효화 함수가 `usersCache`만 null로 비우고 진행중인 `usersCacheFetching`은 취소하지 않아, 쓰기 직전에 시작된 fetch가 무효화 *이후* 옛 데이터로 캐시를 되살리고 TTL까지 새로 찍었다. 여기에 비번초기화가 (updatePassword → updateUserMustChangePassword) 두 단계라, 그 사이 `{새 비번, mustChange=false}` 스냅샷이 캐시에 박혀 첫 로그인 시 비번은 맞는데 강제변경이 안 걸리는 버그가 났다(웹/모바일 공통).

**How to apply:** users 테이블을 바꾸는 모든 mutation은 끝에 `invalidateUsersCache()`를 부르고, "새 자격증명 + 플래그"처럼 함께 일관돼야 하는 값은 한 UPDATE로 묶는다. 인증 직결 데이터에 두 단계 쓰기를 피하라.

**주의(미해결):** 캐시는 프로세스 로컬이라 autoscale 다중 인스턴스에선 TTL(5분)만큼 인스턴스 간 staleness가 남는다. 단 이 경우 증상은 "초기화 직후 새 임시비번이 잠깐 안 먹힘"(로그인 실패)이지 강제변경 우회는 아님. 진짜로 막으려면 Redis pub/sub 등 인스턴스 간 무효화 필요.
