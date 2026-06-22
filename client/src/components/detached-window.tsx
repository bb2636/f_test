import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import {
  acquireDetachedToastSurface,
  releaseDetachedToastSurface,
} from "@/lib/toast-surface";

const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}

/** 현재 컴포넌트가 분리창(DetachedWindow) 안에서 렌더되는지 여부.
 *  분리창 내부에서만 IME(한글) 조합 가드를 적용하기 위한 판별용. */
export function useIsDetachedWindow() {
  return useContext(PortalContainerContext) !== undefined;
}

// 노드를 복제하되, stylesheet <link>는 절대 URL로 고정한다.
//   분리창은 window.open("")로 연 about:blank 문서라 baseURI가 "about:blank"다.
//   프로덕션 빌드의 CSS는 <link href="/assets/index-xxxx.css"> 같은 루트상대 경로인데,
//   cloneNode는 "속성"(상대경로)을 그대로 복사하므로 about:blank에서 해석에 실패해
//   CSS가 로드되지 않는다(개발모드는 인라인 <style>이라 표가 정상으로 보이지만 배포본에선
//   Tailwind가 통째로 빠져 flex 행이 세로로 무너짐). link.href "프로퍼티"는 이미 해석된
//   절대 URL이므로 그 값으로 덮어써 분리창에서도 정상 로드되게 한다.
function cloneStyleNode(node: Element): Node {
  const clone = node.cloneNode(true);
  if (
    node.nodeName === "LINK" &&
    (node as HTMLLinkElement).rel === "stylesheet"
  ) {
    (clone as HTMLLinkElement).href = (node as HTMLLinkElement).href;
  }
  return clone;
}

function copyStyles(src: Document, dest: Document) {
  src
    .querySelectorAll('style, link[rel="stylesheet"]')
    .forEach((node) => dest.head.appendChild(cloneStyleNode(node)));
}

interface DetachedWindowProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** window.open 대상 이름. 건별로 유니크하게 주면 창이 건마다 분리되고
   *  같은 이름으로 다시 열면 기존 창이 재사용/포커스된다. 미지정 시 매번 새 창. */
  name?: string;
  width?: number;
  height?: number;
  children: ReactNode;
}

export function DetachedWindow({
  open,
  onClose,
  title = "FLOXN",
  name = "",
  width = 760,
  height = 900,
  children,
}: DetachedWindowProps) {
  const winRef = useRef<Window | null>(null);
  const rootRef = useRef<Root | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const surfaceIdRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + 80);
    const features = `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
    const win = window.open("", name, features);

    if (!win) {
      window.alert(
        "브라우저 팝업 차단으로 창을 열 수 없습니다.\n주소창의 팝업 차단을 허용한 뒤 다시 시도해 주세요.",
      );
      onCloseRef.current();
      return;
    }

    winRef.current = win;
    win.document.title = title;
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.className = document.body.className;
    win.document.body.style.margin = "0";
    copyStyles(document, win.document);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) =>
        m.addedNodes.forEach((n) => {
          if (
            n.nodeName === "STYLE" ||
            (n.nodeName === "LINK" &&
              (n as HTMLLinkElement).rel === "stylesheet")
          ) {
            win.document.head.appendChild(cloneStyleNode(n as Element));
          }
        }),
      );
    });
    observer.observe(document.head, { childList: true });

    const container = win.document.createElement("div");
    container.id = "detached-root";
    win.document.body.appendChild(container);
    containerRef.current = container;

    // 이 분리창을 토스트 활성 surface로 등록 → 분리창이 열려 있는 동안 토스트는
    // 메인 창이 아닌 이 분리창에서 표시된다.
    surfaceIdRef.current = acquireDetachedToastSurface();

    const root = createRoot(container);
    rootRef.current = root;

    const poll = window.setInterval(() => {
      if (win.closed) {
        window.clearInterval(poll);
        onCloseRef.current();
      }
    }, 400);
    const handleBeforeUnload = () => onCloseRef.current();
    win.addEventListener("beforeunload", handleBeforeUnload);
    win.focus();

    // 분리창은 메인 창과 동일한 JS realm을 공유한다. 그래서 분리창 안에서 열리는
    // Radix(Dialog/Select/Popover 등)와 react-remove-scroll이 스크롤락/pointer-events:none/
    // aria-hidden을 "메인 창" document.body에 걸어 메인 창 전체 클릭이 막힌다(비모달 요구사항 위반).
    // → 메인 문서를 감시하며 분리창이 열려있는 동안 메인 창 잠금을 즉시 해제한다.
    // 클릭을 막는 잠금은 모두 메인 창 body "자체"에 걸린다(Dialog의 pointer-events:none,
    // react-remove-scroll의 data-scroll-locked/overflow). body 자식의 aria-hidden은 클릭을
    // 막지 않으므로(접근성 잔재) 닫힐 때 1회만 정리한다. 메인 창의 정상 모달까지 풀어버리지
    // 않도록 감시 범위를 body 자체 속성으로 좁힌다.
    const mainDoc = document;
    const unlockMainBody = () => {
      const b = mainDoc.body;
      if (b.style.pointerEvents === "none") b.style.pointerEvents = "";
      if (b.hasAttribute("data-scroll-locked")) {
        b.removeAttribute("data-scroll-locked");
        b.style.overflow = "";
      }
    };
    const lockGuard = new MutationObserver(unlockMainBody);
    lockGuard.observe(mainDoc.body, {
      attributes: true,
      attributeFilter: ["style", "data-scroll-locked"],
    });
    unlockMainBody();

    // 분리창 안에서 Radix 모달류(Select 등)가 열리면 DismissableLayer가 layer의
    // ownerDocument(=분리창 document) 기준으로 분리창 **body**에 pointer-events:none을 건다.
    // 닫힐 때 정상이면 복원되지만, react-remove-scroll이 같은 realm의 메인 body를 잠그고
    // 위 lockGuard가 그걸 강제 해제하면서 refcount가 어긋나면 분리창 body의 pointer-events:none이
    // 남아 분리창 전체 클릭이 죽는다(증상: 날짜/셀렉트/추가 버튼이 안 눌림, 이미 포커스된 입력만 타이핑됨).
    // → 분리창 body도 동일하게 감시해 즉시 해제한다(드롭다운 content는 자체 pointer-events:auto라
    //   계속 클릭 가능 = 사실상 비모달, 폼 팝업엔 적절).
    const winDoc = win.document;
    const unlockWinBody = () => {
      const b = winDoc.body;
      if (b.style.pointerEvents === "none") b.style.pointerEvents = "";
      if (b.hasAttribute("data-scroll-locked")) {
        b.removeAttribute("data-scroll-locked");
        b.style.overflow = "";
      }
    };
    const winLockGuard = new MutationObserver(unlockWinBody);
    winLockGuard.observe(winDoc.body, {
      attributes: true,
      attributeFilter: ["style", "data-scroll-locked"],
    });
    unlockWinBody();

    return () => {
      if (surfaceIdRef.current != null) {
        releaseDetachedToastSurface(surfaceIdRef.current);
        surfaceIdRef.current = null;
      }
      window.clearInterval(poll);
      observer.disconnect();
      lockGuard.disconnect();
      winLockGuard.disconnect();
      win.removeEventListener("beforeunload", handleBeforeUnload);
      try {
        root.unmount();
      } catch {
        /* ignore */
      }
      // 분리창이 닫힐 때 메인 창에 남아있을 수 있는 잠금 잔재를 최종 해제한다.
      unlockMainBody();
      Array.from(mainDoc.body.children).forEach((el) => {
        if ((el as HTMLElement).getAttribute("aria-hidden") === "true") {
          el.removeAttribute("aria-hidden");
        }
      });
      rootRef.current = null;
      containerRef.current = null;
      if (!win.closed) win.close();
      winRef.current = null;
    };
  }, [open, name, title, width, height]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const container = containerRef.current;
    if (!root || !container) return;
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <PortalContainerContext.Provider value={container}>
            {children}
            <Toaster detachedId={surfaceIdRef.current ?? undefined} />
          </PortalContainerContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });

  return null;
}
