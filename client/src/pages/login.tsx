import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { loginSchema, type LoginInput } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ForceChangePasswordModal } from "@/components/force-change-password-modal";
import loginIllustration from "@assets/1771911650223.jpg";
import logoIcon from "@assets/Frame 2_1762217940686.png";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showForceChangePassword, setShowForceChangePassword] = useState(false);
  const [saveUsername, setSaveUsername] = useState(false);
  const [privacyPolicyOpen, setPrivacyPolicyOpen] = useState(false);
  const [termsOfServiceOpen, setTermsOfServiceOpen] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
      rememberMe: false,
    },
  });

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch("/api/check-session");
        const data = await response.json();
        if (data.authenticated) {
          if (data.user?.mustChangePassword === true) {
            setShowForceChangePassword(true);
          } else {
            setLocation("/dashboard");
          }
        }
      } catch (error) {
        console.error("Session check failed:", error);
      }
    };

    checkSession();

    const savedUsername = localStorage.getItem("savedUsername");
    if (savedUsername) {
      form.setValue("username", savedUsername);
      setSaveUsername(true);
    }

    const savedRememberMe = localStorage.getItem("rememberMe");
    if (savedRememberMe === "true") {
      form.setValue("rememberMe", true);
    }
  }, [setLocation, form]);

  const loginMutation = useMutation({
    mutationFn: async (data: LoginInput) => {
      const response = await apiRequest("POST", "/api/login", data);
      return await response.json();
    },
    onSuccess: (data: any, variables) => {
      if (variables.rememberMe) {
        localStorage.setItem("rememberMe", "true");
      } else {
        localStorage.removeItem("rememberMe");
      }

      if (saveUsername) {
        localStorage.setItem("savedUsername", variables.username);
      } else {
        localStorage.removeItem("savedUsername");
      }

      if (data.mustChangePassword === true) {
        toast({
          title: "비밀번호 변경 필요",
          description: "임시 비밀번호를 변경해주세요.",
        });
        setShowForceChangePassword(true);
      } else {
        toast({
          title: "로그인 성공",
          description: "환영합니다!",
        });

        setTimeout(() => {
          setLocation("/dashboard");
        }, 500);
      }
    },
    onError: (error: any) => {
      const errorMessage =
        error?.error || "로그인에 실패했습니다. 다시 시도해주세요.";

      toast({
        title: "로그인 실패",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: LoginInput) => {
    loginMutation.mutate(data);
  };

  const handlePasswordChangeSuccess = () => {
    setShowForceChangePassword(false);
    toast({
      title: "로그인 성공",
      description: "환영합니다!",
    });
    setTimeout(() => {
      setLocation("/dashboard");
    }, 500);
  };

  const handleLogoutFromModal = () => {
    setShowForceChangePassword(false);
    form.reset();
  };

  return (
    <div
      className="relative"
      style={{ height: "1147px", background: "#E7EDFE" }}
    >
      {/* Blur Background Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute"
          style={{
            width: "1095px",
            height: "777px",
            left: "-250px",
            top: "170px",
            background: "rgba(254, 240, 230, 0.40)",
            borderRadius: "9999px",
            filter: "blur(212px)",
          }}
        />
        <div
          className="absolute"
          style={{
            width: "1335px",
            height: "1323px",
            left: "160px",
            top: "160px",
            background: "rgba(233, 230, 254, 0.50)",
            borderRadius: "9999px",
            filter: "blur(212px)",
          }}
        />
        <div
          className="absolute"
          style={{
            width: "348px",
            height: "1323px",
            right: "-100px",
            top: "-30px",
            background: "rgba(233, 230, 254, 0.50)",
            borderRadius: "9999px",
            filter: "blur(212px)",
          }}
        />
      </div>
      {/* Header */}
      <header
        className="relative w-full h-[89px] px-8 flex items-center gap-2"
        style={{
          background: "rgba(255, 255, 255, 0.06)",
          backdropFilter: "blur(22px)",
        }}
      >
        <img src={logoIcon} alt="FLOXN Logo" className="w-6 h-6" />
        <div className="text-2xl font-bold text-gray-900">FLOXN</div>
      </header>
      {/* Main Content */}
      <div className="relative flex gap-0 px-8 py-0 max-w-[1856px] mx-auto">
        {/* Left Panel - Illustration */}
        <div
          className="hidden lg:block overflow-hidden flex-1"
          style={{
            height: "990px",
            borderRadius: "12px",
            position: "relative",
          }}
        >
          <img
            src={loginIllustration}
            alt="Login Illustration"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>

        {/* Right Panel - Login Form */}
        <div
          className="flex-1 flex items-center justify-center overflow-hidden"
          style={{
            height: "990px",
            borderRadius: "12px",
          }}
        >
          <div className="w-full max-w-lg px-8 py-12">
            {/* Header */}
            <div className="mb-[91px]">
              <h1
                className="font-medium mb-3"
                style={{
                  color: "rgba(12, 12, 12, 0.90)",
                  fontSize: "28px",
                  lineHeight: "35.84px",
                }}
                data-testid="text-login-title"
              >
                로그인
              </h1>
              <p
                style={{
                  color: "rgba(12, 12, 12, 0.70)",
                  fontSize: "18px",
                  lineHeight: "23.04px",
                }}
                data-testid="text-login-subtitle"
              >
                접수부터 종결까지 진행 흐름을 한눈에-
              </p>
            </div>

            {/* Login Form */}
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-[38px]"
              >
                <div className="space-y-5">
                  {/* Username Field */}
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="font-semibold"
                          style={{
                            color: "#0C0C0C",
                            fontSize: "15px",
                            lineHeight: "19.20px",
                          }}
                        >
                          아이디
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="floxn"
                            className="font-semibold"
                            style={{
                              height: "34px",
                              paddingLeft: "20px",
                              paddingRight: "20px",
                              background: "#FDFDFD",
                              borderRadius: "8px",
                              border: "none",
                              outline: "2px solid rgba(12, 12, 12, 0.08)",
                              outlineOffset: "-2px",
                              color: "#0C0C0C",
                              fontSize: "16px",
                              lineHeight: "20.48px",
                            }}
                            data-testid="input-username"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Password Field */}
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="font-semibold"
                          style={{
                            color: "#0C0C0C",
                            fontSize: "15px",
                            lineHeight: "19.20px",
                          }}
                        >
                          비밀번호
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            placeholder="••••••••••••"
                            className="font-semibold"
                            style={{
                              height: "34px",
                              paddingLeft: "20px",
                              paddingRight: "20px",
                              background: "#FDFDFD",
                              borderRadius: "8px",
                              border: "none",
                              outline: "2px solid rgba(12, 12, 12, 0.08)",
                              outlineOffset: "-2px",
                              color: "#0C0C0C",
                              fontSize: "16px",
                              lineHeight: "20.48px",
                            }}
                            data-testid="input-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Save Username Checkbox */}
                  <div className="flex items-center gap-1">
                    <Checkbox
                      checked={saveUsername}
                      onCheckedChange={(checked) => setSaveUsername(!!checked)}
                      data-testid="checkbox-save-username"
                    />
                    <Label
                      className="cursor-pointer font-medium"
                      style={{
                        color: "#686A6E",
                        fontSize: "14px",
                        lineHeight: "17.92px",
                      }}
                      onClick={() => setSaveUsername(!saveUsername)}
                    >
                      아이디저장
                    </Label>
                  </div>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  className="w-full font-bold"
                  style={{
                    height: "34px",
                    paddingLeft: "20px",
                    paddingRight: "20px",
                    background: "#008FED",
                    borderRadius: "8px",
                    color: "#FDFDFD",
                    fontSize: "18px",
                    lineHeight: "23.04px",
                  }}
                  data-testid="button-login"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      로그인 중...
                    </>
                  ) : (
                    "로그인"
                  )}
                </Button>

                <div
                  className="mt-6 text-center"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "12px",
                    color: "rgba(12, 12, 12, 0.45)",
                    lineHeight: "1.8",
                  }}
                >
                  <div
                    className="flex items-center justify-center gap-3 mb-2"
                    style={{
                      fontSize: "13px",
                      color: "rgba(12, 12, 12, 0.55)",
                    }}
                  >
                    <span
                      className="cursor-pointer hover:underline"
                      style={{ color: "rgba(12, 12, 12, 0.7)" }}
                      onClick={() => setPrivacyPolicyOpen(true)}
                      data-testid="button-privacy-policy"
                    >개인정보처리방침</span>
                    <span>|</span>
                    <span
                      className="cursor-pointer hover:underline"
                      style={{ color: "rgba(12, 12, 12, 0.7)" }}
                      onClick={() => setTermsOfServiceOpen(true)}
                      data-testid="button-terms-of-service"
                    >서비스 이용약관</span>
                  </div>
                  <p>
                    회사명: ©플록슨 대표이사: 송기원 사업자등록번호:
                    517-87-03490
                  </p>
                  <p>
                    (07256) 서울 영등포구 당산로 133, 3층 302호 Tel.
                    070-7778-0925
                  </p>
                  <p>Copyright FLOXN Co., Ltd. All rights reserved.</p>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </div>
      <ForceChangePasswordModal
        open={showForceChangePassword}
        onSuccess={handlePasswordChangeSuccess}
        onLogout={handleLogoutFromModal}
      />
      <Dialog open={privacyPolicyOpen} onOpenChange={setPrivacyPolicyOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">개인정보 처리방침</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-700 leading-relaxed space-y-4" style={{ fontFamily: 'Pretendard' }}>
            <p>주식회사 플록슨(이하 '회사')은 「개인정보 보호법」 제30조에 따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.</p>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제1조 (개인정보의 처리 목적)</h4>
              <p>회사는 다음의 목적을 위하여 개인정보를 처리합니다. 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않으며 이용 목적이 변경되는 경우에는 「개인정보 보호법」 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.</p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-slate-600">
                <li>서비스 제공 및 관리: B2B 업무 시스템 이용에 따른 본인 식별, 인증, 회원자격 유지·관리, 서비스 공급 및 계약 이행.</li>
                <li>현장 조사 및 공사 수행 지원: 사고원인 파악을 위한 현장확인, 관련 위치 및 피해상황 사진 촬영, 공사 진행상태 기록 및 관리</li>
                <li>서비스 이용 관련 문의, 불만 처리 및 고지사항 전달 등</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제2조 (개인정보의 처리 및 보유 기간)</h4>
              <p>① 회사는 법령에 따른 개인정보 보유·이용 기간 또는 정보주체로부터 개인정보를 수집 시에 동의 받은 개인정보 보유·이용 기간 내에서 개인정보를 처리·보유합니다.</p>
              <p className="mt-1">② 각각의 개인정보 처리 및 보유 기간은 다음과 같습니다.</p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-slate-600">
                <li>시스템 회원 가입 및 관리: 시스템 탈퇴 시까지. 단, 다음의 사유에 해당하는 경우에는 해당 사유 종료 시까지 보존합니다.
                  <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                    <li>관계 법령 위반에 따른 수사·조사 등이 진행 중인 경우: 해당 수사·조사 종료 시까지</li>
                    <li>시스템 이용에 따른 채권·채무관계 잔존 시: 해당 채권·채무관계 정산 완료 시까지</li>
                  </ul>
                </li>
                <li>서비스 접속 및 이용 기록: 1년 (관련 법령에 따라 최소 1년 이상 보관)</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제3조 (처리하는 개인정보의 항목)</h4>
              <p>회사는 다음의 개인정보 항목을 처리하고 있습니다.</p>
              <ol className="list-decimal list-inside mt-1 space-y-1 text-slate-600">
                <li>피보험자 정보: 성명, 연락처(휴대전화번호), 주소(공사 대상 주택 소재지)</li>
                <li>피해자 정보: 성명, 연락처, 주소</li>
                <li>현장 조사 및 업무 수행 정보: 사고 현장 사진(위치 및 피해 상황 포함), 공사 진행 관련 사진</li>
                <li>시스템 이용자(담당자) 정보: 성명, 소속 회사/부서, 직함, 업무용 연락처, 로그인 ID, 접속 로그, IP 주소</li>
              </ol>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제4조 (개인정보 처리 업무의 위탁)</h4>
              <p>회사는 원활한 서비스 제공 및 현장 출동, 복구 공사 등 업무 수행을 위하여 다음과 같이 개인정보 처리 업무를 위탁하고 있습니다.</p>
              <div className="mt-2 border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-2 text-left font-semibold border-b border-slate-200">수탁자(업무 수행 주체)</th>
                      <th className="p-2 text-left font-semibold border-b border-slate-200">위탁 업무의 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="p-2 border-b border-slate-100">시스템 등록된 공사업체</td>
                      <td className="p-2 border-b border-slate-100">현장 출동, 사고원인 확인, 공사 수행, 피해자 확인 및 현장 사진 촬영</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-1">회사는 위탁계약 체결 시 「개인정보 보호법」 제26조에 따라 위탁업무 수행 목적 외 개인정보 처리금지, 기술적·관리적 보호조치, 재위탁 제한, 수탁자에 대한 관리·감독, 손해배상 등 책임에 관한 사항을 계약서 등 명문으로 규정하고, 수탁자가 개인정보를 안전하게 처리하는지를 감독하고 있습니다.</p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제5조 (개인정보의 파기 절차 및 방법)</h4>
              <p>① 회사는 개인정보 보유기간의 경과, 처리목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.</p>
              <p>② 전자적 파일 형태의 정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 삭제합니다.</p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제6조 (개인정보의 안전성 확보 조치)</h4>
              <p>회사는 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취하고 있습니다.</p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-slate-600">
                <li>관리적 조치: 내부관리계획 수립 및 시행, 정기적 직원 교육.</li>
                <li>기술적 조치: 개인정보처리시스템 등의 접근권한 관리, 접속기록의 보관, 비밀번호의 일방향 암호화, 데이터 전송 시 SSL 암호화 적용.</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제7조 (개인정보 보호책임자)</h4>
              <p>개인정보 처리에 관한 업무를 총괄해서 책임지고, 정보주체의 불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.</p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-slate-600">
                <li>성명: 이현재</li>
                <li>직책: 상무</li>
                <li>연락처: hjlee@floxn.co.kr (070-7731-0925)</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제8조 (정보주체의 권리·의무 및 그 행사방법)</h4>
              <p>정보주체는 회사에 대해 언제든지 개인정보 열람·정정·삭제·처리정지 요구 등의 권리를 행사할 수 있습니다. 권리 행사는 서면, 전자우편 등을 통하여 하실 수 있으며 회사는 이에 대해 지체 없이 조치하겠습니다.</p>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <h4 className="font-bold text-slate-900 mb-1">부 칙</h4>
              <p>제1조 (시행일) 본 개인정보 처리방침은 2026년 3월 1일부터 시행됩니다.</p>
              <p className="mt-1">제2조 (개정 이력) 회사는 개인정보 처리방침을 개정하는 경우 변경 전후를 비교하여 확인할 수 있도록 아래와 같이 관리합니다.</p>
              <div className="mt-2 border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-2 text-left font-semibold border-b border-slate-200">버전 번호</th>
                      <th className="p-2 text-left font-semibold border-b border-slate-200">공고 일자</th>
                      <th className="p-2 text-left font-semibold border-b border-slate-200">시행일자</th>
                      <th className="p-2 text-left font-semibold border-b border-slate-200">주요 개정 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="p-2 border-b border-slate-100">v1.0</td>
                      <td className="p-2 border-b border-slate-100">2026.02.23.</td>
                      <td className="p-2 border-b border-slate-100">2026.03.01</td>
                      <td className="p-2 border-b border-slate-100">최초 제정 및 시행</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={termsOfServiceOpen} onOpenChange={setTermsOfServiceOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">서비스 이용약관</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-700 leading-relaxed space-y-4" style={{ fontFamily: 'Pretendard' }}>
            <div>
              <h4 className="font-bold text-slate-900 mb-1">제1조 (목적)</h4>
              <p>본 약관은 주식회사 플록슨(이하 "회사")가 제공하는 플록슨 ELS(이하 "서비스")을 이용함에 있어 "회사"와 "이용고객(기업)" 간의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.</p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제2조 (용어의 정의)</h4>
              <ul className="list-disc list-inside mt-1 space-y-1 text-slate-600">
                <li>서비스: "회사"가 제공하는 업무 관리/지원 웹 시스템을 의미합니다.</li>
                <li>이용고객: 본 약관에 동의하고 "회사"로부터 이용 권한을 부여받은 기업 또는 단체를 의미합니다.</li>
                <li>구성원(User): 이용고객으로부터 서비스 접근 권한을 부여받은 임직원 등을 의미합니다.</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제3조 (이용계약의 체결 및 거절)</h4>
              <p>이용계약은 "이용고객"이 "회사"에 계정 생성을 요청하고 본 약관에 동의함으로써 성립합니다.</p>
              <p className="mt-1">"회사"는 "이용고객"으로부터 제공받은 기본 정보를 바탕으로 초기 아이디(ID)와 임시 비밀번호를 생성하여 전달합니다.</p>
              <p className="mt-1">"이용고객"은 임시 비밀번호를 수령한 후 시스템에 최초 접속 시 반드시 비밀번호를 본인이 직접 변경하여야 하며, 이를 이행하지 않아 발생하는 보안 사고의 책임은 "이용고객"에게 있습니다.</p>
              <p className="mt-1">"회사"는 다음 각 호에 해당하는 신청에 대하여는 승낙을 하지 않거나 사후에 이용계약을 해지할 수 있습니다.</p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-slate-600 ml-2">
                <li>제공받은 기본 정보가 허위인 경우</li>
                <li>본 서비스의 목적에 부합하지 않는 주체가 신청한 경우</li>
                <li>수리·복구 서비스를 위한 '제휴업체 협력' 계약이 해지된 경우</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제4조 (서비스의 제공 및 변경)</h4>
              <p>서비스는 회사의 기술적·업무적 특별한 지장이 없는 한 상시 제공을 원칙으로 합니다.</p>
              <p className="mt-1">회사는 서비스 개선이나 설비의 긴급 보수, 장애 대응 등 부득이한 사유가 발생한 경우 사전 예고 없이 서비스를 일시 중지할 수 있습니다. 이 경우 회사는 서비스 내 게시판이나 팝업 등을 통해 사후에 지체 없이 관련 사실을 공지합니다.</p>
              <p className="mt-1">회사는 고의 또는 중과실이 없는 한, 서비스 일시 중지로 인하여 이용자가 입은 부수적 손해(기회비용 상실 등)에 대하여 책임을 지지 않습니다.</p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제5조 (데이터의 소유권 및 관리)</h4>
              <p>"이용고객"이 본 서비스를 통해 입력, 생성 또는 보고한 모든 데이터(이하 "보고 데이터")에 대한 소유권, 지식재산권 및 처분권은 "회사"에게 귀속됩니다. "이용고객"은 서비스 이용 기간 중 업무 목적으로 해당 데이터를 사용할 권한만을 가집니다.</p>
              <p className="mt-1">"이용고객"은 이미 보고 등이 완료된 데이터에 대하여 임의로 수정, 삭제 또는 파기를 요구할 수 없습니다. 다만, "회사"는 이미 보고 등이 완료된 데이터를 관련 법령과 내부적으로 정한 기한에 따라 삭제(또는 파기) 합니다.</p>
              <p className="mt-1">"회사"는 데이터를 서비스의 고도화, 통계 분석 및 기타 시스템 운영 목적으로 활용할 수 있으며, "이용고객"은 이에 대해 어떠한 권리 주장이나 보상을 요구할 수 없습니다.</p>
              <p className="mt-1">서비스 이용 계약이 해지 또는 종료되더라도 "이용고객"은 "보고 데이터"의 반환이나 삭제를 청구할 수 없습니다. "회사"는 관련 법령에 따른 보존 의무 기간 동안 데이터를 보관하며, 그 이후의 처리는 "회사"의 정책에 따릅니다.</p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제6조 (의무 및 금지사항)</h4>
              <p>"이용고객" 및 "구성원"은 아이디와 비밀번호를 엄격히 관리해야 하며, 제3자에게 공유해서는 안 됩니다.</p>
              <p className="mt-1">서비스의 역설계(Reverse Engineering), 해킹 시도, 데이터 무단 크롤링 등 시스템에 위해를 가하는 행위는 엄격히 금지됩니다.</p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제7조 (책임 제한)</h4>
              <p>"회사"는 천재지변, 기간통신사업자의 회선 장애, 클라우드 서비스 자체의 기술적 결함 등 "회사"의 통제 범위를 벗어난 사유로 발생한 손해에 대해서는 책임을 지지 않습니다.</p>
              <p className="mt-1">"회사"는 "이용고객" 에게 공사 중개를 위한 시스템만을 제공할 뿐, "이용고객"을 대리하지 않습니다. 성립된 공사 계약 및 그에 따른 이행, 하자 보수 등 모든 업무적·법적 책임은 계약의 당사자인 "이용고객"에게 있습니다.</p>
              <p className="mt-1">"회사"는 어떠한 경우에도 서비스 이용과 관련하여 발생한 부수적 손해, 결과적 손해, 특별 손해 또는 징벌적 손해에 대해 책임을 지지 않습니다.</p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제8조 (비밀 유지)</h4>
              <p>"회사"와 "이용고객"은 서비스 이용 과정에서 알게 된 상대방의 업무상 비밀을 서비스 이용 목적 외의 용도로 사용하거나 제3자에게 누설하여서는 안 됩니다.</p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-1">제9조 (준거법 및 재판관할)</h4>
              <p>본 약관은 대한민국 법령에 의하여 해석되며, 발생한 분쟁에 대해서는 회사의 본점 주소지를 관할하는 법원으로 합니다.</p>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <h4 className="font-bold text-slate-900 mb-1">부 칙</h4>
              <p>제1조 (시행일) 이 약관은 2026년 3월 1일부터 시행합니다.</p>
              <p className="mt-1">제2조 (개정 이력)</p>
              <p className="text-slate-600 ml-2">v1.0 제정: 2026. 03. 01. (최초 서비스 런칭)</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
