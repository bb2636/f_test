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

const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}

function copyStyles(src: Document, dest: Document) {
  src
    .querySelectorAll('style, link[rel="stylesheet"]')
    .forEach((node) => dest.head.appendChild(node.cloneNode(true)));
}

interface DetachedWindowProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: number;
  height?: number;
  children: ReactNode;
}

export function DetachedWindow({
  open,
  onClose,
  title = "FLOXN",
  width = 760,
  height = 900,
  children,
}: DetachedWindowProps) {
  const winRef = useRef<Window | null>(null);
  const rootRef = useRef<Root | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + 80);
    const features = `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
    const win = window.open("", "", features);

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
            win.document.head.appendChild(n.cloneNode(true));
          }
        }),
      );
    });
    observer.observe(document.head, { childList: true });

    const container = win.document.createElement("div");
    container.id = "detached-root";
    win.document.body.appendChild(container);
    containerRef.current = container;

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

    return () => {
      window.clearInterval(poll);
      observer.disconnect();
      win.removeEventListener("beforeunload", handleBeforeUnload);
      try {
        root.unmount();
      } catch {
        /* ignore */
      }
      rootRef.current = null;
      containerRef.current = null;
      if (!win.closed) win.close();
      winRef.current = null;
    };
  }, [open, title, width, height]);

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
          </PortalContainerContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });

  return null;
}
