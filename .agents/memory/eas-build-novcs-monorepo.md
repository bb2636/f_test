---
name: EAS no-vcs 빌드가 모노레포 서브앱에서 git루트를 잡는 문제
description: EAS_NO_VCS 빌드시 .easignore 무시·node_modules 통째 업로드·prebuild 실패의 원인과 해결(EAS_PROJECT_ROOT)
---

# 증상
- 격리형 standalone Expo 앱(`mobile-app/`, 자체 node_modules)을 `EAS_NO_VCS=1 eas build`로 빌드.
- 아카이브가 521MB로 거대 → `mobile-app/.easignore`(node_modules/ 등)가 **무시**됨.
- EAS 서버: `npm error Exit handler never called!` → `expo` 미설치 → `npx expo prebuild` 코드1 실패(UNKNOWN_ERROR, Prebuild phase). 업로드된 node_modules 위에 npm install이 크래시.

# 근본 원인
eas-cli no-vcs 클라이언트 `getRootPathAsync()`(node_modules/eas-cli/build/vcs/clients/noVcs.js)는
EAS_PROJECT_ROOT(절대경로) 미설정 시 **`git rev-parse --show-toplevel`로 git 루트를 프로젝트 루트로 사용**.
- 이 repo는 git 루트가 모노레포 루트(/home/runner/workspace), 서브앱은 mobile-app.
- 그래서 복사·`.easignore`/`.gitignore` 읽기 기준이 mobile-app이 아니라 **루트** → mobile-app/.easignore 무시, mobile-app/node_modules 포함.

# 해결
빌드 명령에 절대경로 `EAS_PROJECT_ROOT=/home/runner/workspace/mobile-app`를 함께 지정.
```
cd mobile-app && EAS_PROJECT_ROOT=/home/runner/workspace/mobile-app EAS_NO_VCS=1 ./node_modules/.bin/eas build --platform android --profile preview --non-interactive
```
→ mobile-app을 루트로 보고 mobile-app/.easignore 적용 → node_modules 제외 → 업로드 즉시·작음 → 서버 clean install/prebuild 정상.

**Why:** git이 설치된 모노레포에선 no-vcs라도 git 루트를 잡아 서브앱 ignore가 안 먹는다.
**How to apply:** 서브디렉터리 Expo 앱을 EAS_NO_VCS로 빌드할 땐 항상 EAS_PROJECT_ROOT를 그 앱 절대경로로 지정.

# 부수 이슈/팁(이 샌드박스)
- 장시간 빌드는 bash 백그라운드면 셸 종료시 같이 죽음(setsid도) → **워크플로**로 실행해야 살아남음.
- git 방식(EAS_NO_VCS 미지정)은 불가: `.git/index.lock`(stale) rm조차 "destructive git" 차단. → 반드시 EAS_NO_VCS.
- no-vcs가 node_modules까지 복사하던 시절, shallow-clone 정리(rm -rf) 중 `.cache/dotslash/.../React Native DevTools-linux-x64`가 읽기전용이라 EACCES rmdir 실패 → 임시폴더를 주기적으로 chmod u+w 해주는 보조 워크플로(perm keeper)로 우회. EAS_PROJECT_ROOT로 node_modules가 빠지면 이 문제도 사실상 사라짐.
- 빌드 에러 로그는 GraphQL(api.expo.dev/graphql, Bearer $EXPO_TOKEN) builds.byId.logFiles → 파일은 **brotli** 압축(zlib.brotliDecompressSync), gzip 아님.

# (속편) Prebuild까지 통과시킨 진짜 블로커들 — 최종 성공 경로
node_modules 제외(EAS_PROJECT_ROOT) 후에도 INSTALL_DEPENDENCIES에서 막혔다. 순서대로:

1. **EAS의 `npm ci`가 "Exit handler never called!"로 즉시 크래시** — npm 버전 무관.
   - eas.json `"node":"20.20.0"`로 핀하면 EAS가 INSTALL_CUSTOM_TOOLS에서 실제로 그 node(=npm 10.8.2)를 설치/사용함(로그 "Now using node v20.20.0 (npm v10.8.2)"). 즉 node 핀은 동작한다(단 EAS 미러에 있는 버전이어야 함; 없으면 이미지 기본으로 폴백).
   - 그런데 **로컬에서 동일 npm 10.8.2로는 `npm ci` 성공**하는데 EAS에선 같은 버전도 크래시 → npm 버전이 아니라 EAS 환경(콜드캐시 EAS_USE_NPM_CACHE=0/레지스트리 프록시) 문제. npm을 고치려 하지 말 것.
   - **해결: 패키지매니저를 yarn으로 전환.** EAS 이미지엔 yarn 1.22.22/pnpm/bun 내장. mobile-app에 yarn.lock 두고 package-lock.json 삭제 → EAS가 `yarn install --frozen-lockfile`로 설치(npm 크래시 우회).

2. **Replit에서 생성한 yarn.lock의 resolved URL이 `http://package-firewall.replit.local/npm/...`** (Replit 패키지 방화벽 프록시). EAS 서버는 이 내부호스트 못 찾음 → `getaddrinfo ENOTFOUND package-firewall.replit.local`.
   - **해결: yarn.lock 일괄 치환** `sed -i 's#http://package-firewall.replit.local/npm/#https://registry.yarnpkg.com/#g' yarn.lock` (npm 락도 같은 함정; resolved/registry URL 점검 필수).

3. **yarn.lock 생성 자체가 까다로움**: 콜드 캐시 yarn install은 120s 초과 + bash 백그라운드(nohup/setsid)는 셸 종료시 죽음 → **워크플로(configureWorkflow, 영속)로 생성** 후 getWorkflowStatus 폴링, 끝나면 removeWorkflow.

4. EAS는 `npm ci --include=dev`(yarn은 `--production false`)로 **devDeps까지 설치** → 빌드에 불필요한 로컬도구는 빼라. **mobile-app devDeps에서 eas-cli/@expo/ngrok 제거**(ngrok은 postinstall로 네이티브 바이너리 다운로드, eas-cli는 거대 트리). 로컬 node_modules엔 이미 설치돼 있어 워크플로의 ./node_modules/.bin/eas는 유지됨. typescript는 SDK54용 ~5.9.2(원래 ~6.0.3은 RN/Expo peer(^5)와 충돌). .npmrc legacy-peer-deps=true도 추가(npm 경로 안전망, yarn은 무시).

**최종 성공**: preview(apk) 프로필, EAS_PROJECT_ROOT=절대경로 + EAS_NO_VCS=1 + yarn.lock(호스트치환) → status FINISHED, .apk 산출. appVersion 1.0.0/build 1, package kr.co.floxn.mobile.
**재빌드 명령**(워크플로 정리됨; 필요시 재구성): `cd mobile-app && EAS_PROJECT_ROOT=/home/runner/workspace/mobile-app EAS_NO_VCS=1 ./node_modules/.bin/eas build --platform android --profile preview --non-interactive`. ⚠️ 이 명령을 워크플로로 두면 패키지설치 때 자동 재시작→유료 재빌드 유발하니 일회성 bash나 임시 워크플로로만.
