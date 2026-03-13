import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { CheckCircle, AlertCircle } from "lucide-react"

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        // 스낵바 variant를 위한 특별한 렌더링
        if (variant === "snackbar") {
          return (
            <Toast key={id} variant="snackbar" {...props} duration={10000} data-testid="toast-snackbar">
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  padding: "10px 20px",
                  gap: "6px",
                  width: "100%",
                  height: "100%",
                  background: "rgba(0, 143, 237, 0.7)",
                  boxShadow: "-6px 0px 40px rgba(89, 103, 115, 0.6)",
                  backdropFilter: "blur(7px)",
                  borderRadius: "6px",
                }}
                data-testid="toast-snackbar-content"
              >
                {/* 체크 아이콘 */}
                <CheckCircle
                  style={{
                    width: "20px",
                    height: "20px",
                    color: "#FDFDFD",
                    flexShrink: 0,
                  }}
                />
                
                {/* 메시지 */}
                <div
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 700,
                    fontSize: "16px",
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "#FDFDFD",
                    flex: 1,
                  }}
                >
                  {title || description}
                </div>
                
                {/* 확인하기 버튼 */}
                <button
                  onClick={() => dismiss(id)}
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 700,
                    fontSize: "16px",
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    textDecoration: "underline",
                    color: "#FDFDFD",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                  data-testid="button-toast-confirm"
                >
                  확인하기
                </button>
              </div>
            </Toast>
          )
        }

        // 다크 토스트 variant를 위한 특별한 렌더링
        if (variant === "dark") {
          return (
            <Toast key={id} variant="dark" {...props} duration={3000} data-testid="toast-dark">
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  padding: "10px 20px",
                  gap: "6px",
                  width: "100%",
                  height: "100%",
                  background: "rgba(12, 12, 12, 0.7)",
                  boxShadow: "-6px 0px 40px rgba(89, 103, 115, 0.6)",
                  backdropFilter: "blur(7px)",
                  borderRadius: "6px",
                }}
                data-testid="toast-dark-content"
              >
                {/* 에러 아이콘 */}
                <AlertCircle
                  style={{
                    width: "20px",
                    height: "20px",
                    color: "#FDFDFD",
                    flexShrink: 0,
                  }}
                />
                
                {/* 메시지 */}
                <div
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 600,
                    fontSize: "16px",
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "#FDFDFD",
                    flex: 1,
                  }}
                >
                  {title || description}
                </div>
              </div>
            </Toast>
          )
        }

        // 기본 토스트 렌더링
        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
