---
name: Expo Go SDK 호환 (standalone 래퍼)
description: standalone Expo 앱이 기기 Expo Go에서 로딩 없이 즉시 "something went wrong" 뜰 때 SDK 버전 불일치 의심
---

## 증상
안드로이드(또는 iOS) Expo Go에서 **로딩 막대 없이 흰 화면 → 즉시 "something went wrong"**. 캐시/데이터 삭제, Expo Go 내장 스캐너 사용, 강제종료 다 해도 동일.

## 원인
프로젝트 Expo SDK가 **설치된 Expo Go가 지원하는 SDK보다 높음**. Expo Go는 매니페스트의 `runtimeVersion: exposdk:NN.0.0`를 읽고 자기가 지원 안 하는 SDK면 JS 번들을 받기도 전에 즉시 거부 → "로딩 없는 즉시 에러"가 시그니처.
- `create-expo-app`(blank-typescript)이 **최신 SDK(예: 56)** 를 받아버리는데, 스토어 Expo Go는 한두 SDK 뒤(이 환경 기준 **SDK 54**)를 지원.
- Replit expo 스킬이 SDK 54 기준(예: expo-crypto v55+는 Expo Go에서 크래시)이라 **SDK 54가 타깃**.

## 진단 (서버측에서 확인)
- 번들 정상 여부: `curl "http://localhost:8081/index.bundle?platform=android&dev=true"` → HTTP200 + `hasError: false`
- 매니페스트 SDK 확인: `curl -H "Expo-Platform: android" -H "Accept: application/expo+json,application/json" "<tunnel-url>/"` → `runtimeVersion` 확인
- 번들·매니페스트 둘 다 정상인데 기기만 즉시 실패 = SDK 불일치(또는 기기망 터널 차단).

## 해결: SDK 다운그레이드 (셸에서 `npx expo install` 금지 → bundledNativeModules로 수동 정렬)
1. `npm install expo@~54.0.0 --legacy-peer-deps` (mobile-app 폴더에서)
2. `node_modules/expo/bundledNativeModules.json`에서 SDK54 버전 읽기. (확인된 값: react-native 0.81.5, react-native-webview 13.15.0, react-native-safe-area-context ~5.6.0, expo-screen-capture ~8.0.9, expo-screen-orientation ~9.0.9, expo-status-bar ~3.0.9, react/react-dom 19.1.0, @types/react ~19.1)
3. 위 버전들 `npm install ... --legacy-peer-deps`로 일괄 정렬
4. `npx tsc --noEmit` 통과 확인 → 워크플로 재시작 → 매니페스트 `exposdk:54.0.0` 확인

**Why:** Expo Go 스토어 버전은 SDK 롤아웃이 느려 최신 SDK를 못 받음. 래퍼 앱은 항상 스토어 Expo Go가 지원하는 SDK로 맞춰야 실기기 테스트가 됨.
