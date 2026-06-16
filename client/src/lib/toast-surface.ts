// 토스트 표시 대상(surface) 조정용 경량 스토어.
//
// 토스트 상태(use-toast)는 전역 단일 memoryState라 Toaster를 메인 창과 분리창
// 양쪽에 마운트하면 동일 토스트가 두 창에 중복 표시된다. 이 스토어로 "현재 활성
// 분리창"을 추적해, 분리창이 열려 있으면 토스트를 활성 분리창에서만 보이고 메인
// Toaster는 숨긴다(분리창이 없으면 메인에서 보인다).
//
// 여러 분리창이 동시에 열리면 가장 최근에 연 창(스택 top)이 토스트를 가져간다.

let stack: number[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

/** 분리창이 열릴 때 호출. 반환된 id를 해당 분리창 Toaster에 전달한다. */
export function acquireDetachedToastSurface(): number {
  const id = ++seq;
  stack.push(id);
  notify();
  return id;
}

/** 분리창이 닫힐 때 호출. */
export function releaseDetachedToastSurface(id: number) {
  stack = stack.filter((x) => x !== id);
  notify();
}

export function subscribeToastSurface(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 현재 토스트를 표시할 활성 분리창 id. 분리창이 없으면 null(=메인 창). */
export function getActiveDetachedSurface(): number | null {
  return stack.length ? stack[stack.length - 1] : null;
}
