import { useLocation } from "wouter";
import { ShieldAlert } from "lucide-react";

export default function Forbidden() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{
      background: "linear-gradient(126.03deg, rgba(255, 213, 168, 0.2) 0%, rgba(224, 164, 255, 0.2) 100%)",
    }}>
      <div className="max-w-md w-full">
        <div
          className="rounded-xl p-8 text-center"
          style={{
            background: "#FFFFFF",
            boxShadow: "0px 0px 20px #DBE9F5",
          }}
        >
          <div className="flex justify-center mb-6">
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                width: "80px",
                height: "80px",
                background: "rgba(239, 68, 68, 0.1)",
              }}
            >
              <ShieldAlert className="w-10 h-10" style={{ color: "#EF4444" }} />
            </div>
          </div>
          
          <h1
            className="mb-4"
            style={{
              fontFamily: "Pretendard",
              fontSize: "24px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#0C0C0C",
            }}
          >
            접근 권한이 없습니다
          </h1>
          
          <p
            className="mb-8"
            style={{
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "1.6",
              letterSpacing: "-0.02em",
              color: "rgba(12, 12, 12, 0.7)",
            }}
          >
            이 페이지에 접근할 수 있는 권한이 없습니다.
            <br />
            관리자에게 권한을 요청하세요.
          </p>
          
          <button
            onClick={() => setLocation("/dashboard")}
            className="w-full py-3 px-6 rounded-lg"
            style={{
              background: "#008FED",
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "#FFFFFF",
            }}
            data-testid="button-back-to-home"
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
}
