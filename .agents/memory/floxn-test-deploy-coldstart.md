---
name: floxn-test 배포/콜드스타트 진단
description: floxn-test.replit.app 정체, "무한 스피너"의 진짜 원인(콜드스타트), floxn.co.kr 분리, Firecrawl 스크린샷 함정
---

# floxn-test.replit.app = 이 repl의 autoscale 배포

- `getDeploymentInfo()` 결과: deploymentType=autoscale, primaryUrl=https://floxn-test.replit.app, additionalUrls=[] (추가 도메인 없음).
- 배포 로그에 내 curl 점검(/api/user, /api/check-session 등)이 그대로 찍힘 → floxn-test가 이 repl 배포임을 확정하는 방법.

# "로그인 후 무한 스피너"는 프론트 버그가 아니라 콜드스타트

- autoscale가 유휴 시 scale-to-zero. 잠든 뒤 다시 열면 컨테이너 부팅 ~10~15초 동안 스피너만 보임.
- 깨어 있을 때는 정상: 로그(POST /api/login 200 → /api/user, /api/cases, /api/users, /api/dashboard/stats 200 → check-session 30초 폴링 authenticated)로 전체 세션이 정상 동작 확인됨.
- 무거운 시작작업은 listen()을 막지 않음: server/index.ts에서 listen() 콜백 *이후* warmUpCache/날짜마이그레이션/SMTP init/PII 백필(131초)을 비동기 실행. 즉 PII 백필이 길어도 페이지 제공은 막지 않음.
- **교훈**: floxn-test "안 열림" 신고는 먼저 콜드스타트를 의심하라. 워밍업(여러번 요청해 TTFB 0.1초 만들기) 후 재현되는지로 프론트 버그 vs 콜드스타트 구분.

# Firecrawl external_url 스크린샷 함정

- `screenshot(type=external_url)`는 이 SPA에서 lazy 청크가 렌더되기 전 캡처해 "/"에서도 스피너만 보임 → 워밍업했는데도 스피너로 나옴.
- **이것만으로 "프론트 깨졌다"고 단정 금지.** 실제 폰/브라우저에선 로그인 화면 정상. 확정은 배포 로그의 실제 요청 흐름 또는 실기기로.

# floxn.co.kr 은 별개 서버

- 샌드박스에서 https://floxn.co.kr/ 는 status 000(연결 불가). floxn-test와 응답/도메인 모두 다름.
- floxn-test 배포 설정(Always-on 전환 등)을 바꿔도 floxn.co.kr엔 영향 없음.
