import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { forceChangePasswordSchema, type ForceChangePasswordInput } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Lock, AlertTriangle, ShieldCheck, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

interface ForceChangePasswordModalProps {
  open: boolean;
  onSuccess: () => void;
  onLogout: () => void;
}

export function ForceChangePasswordModal({
  open,
  onSuccess,
  onLogout,
}: ForceChangePasswordModalProps) {
  const { toast } = useToast();
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [termsExpanded, setTermsExpanded] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);

  const form = useForm<ForceChangePasswordInput>({
    resolver: zodResolver(forceChangePasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: ForceChangePasswordInput) => {
      return await apiRequest("POST", "/api/force-change-password", data);
    },
    onSuccess: () => {
      toast({
        title: "비밀번호 변경 완료",
        description: "새 비밀번호로 변경되었습니다.",
      });
      form.reset();
      onSuccess();
    },
    onError: (error: any) => {
      const errorMessage = error?.error || "비밀번호 변경에 실패했습니다.";
      toast({
        title: "비밀번호 변경 실패",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: ForceChangePasswordInput) => {
    if (!termsAgreed || !privacyAgreed) {
      toast({
        title: "약관 동의 필요",
        description: "서비스 이용약관과 개인정보 처리방침에 모두 동의해주세요.",
        variant: "destructive",
      });
      return;
    }
    changePasswordMutation.mutate(data);
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/logout", {});
      onLogout();
    } catch (error) {
      console.error("Logout error:", error);
      onLogout();
    }
  };

  const allAgreed = termsAgreed && privacyAgreed;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent 
        className="sm:max-w-[460px] max-h-[90vh] overflow-y-auto [&>button[class*='absolute']]:hidden" 
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="mb-4 p-4 rounded-lg" style={{ background: '#F0F5FF', border: '1px solid #D6E4FF' }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="p-1.5 bg-blue-100 rounded-full mt-0.5">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 leading-snug">
                서비스약관 동의 및<br />개인정보처리방침 고지 확인
              </h3>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between p-2.5 bg-white rounded-md" style={{ border: '1px solid #E5E7EB' }}>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={(e) => setTermsAgreed(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-200"
                  data-testid="checkbox-terms-agree"
                />
                <span className="text-xs text-blue-600 font-medium">(필수)</span>
                서비스 이용약관 동의
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTermsExpanded(!termsExpanded)}
                  className="text-xs text-blue-500 hover:text-blue-700 underline"
                  data-testid="button-terms-detail"
                >
                  전문 보기
                </button>
                <span
                  className="text-xs font-medium"
                  style={{ color: termsAgreed ? '#16A34A' : '#9CA3AF' }}
                >
                  {termsAgreed ? '동의' : '미확인'}
                </span>
              </div>
            </div>
            {termsExpanded && (
              <div className="p-3 bg-white rounded-md text-xs text-slate-600 leading-relaxed max-h-[200px] overflow-y-auto space-y-2" style={{ border: '1px solid #E5E7EB' }}>
                <p className="font-semibold mb-1">서비스 이용약관</p>
                <p><span className="font-semibold">제1조 (목적)</span> 본 약관은 주식회사 플록슨(이하 "회사")가 제공하는 플록슨 ELS(이하 "서비스")을 이용함에 있어 "회사"와 "이용고객(기업)" 간의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.</p>
                <p><span className="font-semibold">제2조 (용어의 정의)</span></p>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li>서비스: "회사"가 제공하는 업무 관리/지원 웹 시스템을 의미합니다.</li>
                  <li>이용고객: 본 약관에 동의하고 "회사"로부터 이용 권한을 부여받은 기업 또는 단체를 의미합니다.</li>
                  <li>구성원(User): 이용고객으로부터 서비스 접근 권한을 부여받은 임직원 등을 의미합니다.</li>
                </ul>
                <p><span className="font-semibold">제3조 (이용계약의 체결 및 거절)</span> 이용계약은 "이용고객"이 "회사"에 계정 생성을 요청하고 본 약관에 동의함으로써 성립합니다. "회사"는 "이용고객"으로부터 제공받은 기본 정보를 바탕으로 초기 아이디(ID)와 임시 비밀번호를 생성하여 전달합니다. "이용고객"은 임시 비밀번호를 수령한 후 시스템에 최초 접속 시 반드시 비밀번호를 본인이 직접 변경하여야 하며, 이를 이행하지 않아 발생하는 보안 사고의 책임은 "이용고객"에게 있습니다.</p>
                <p>"회사"는 다음 각 호에 해당하는 신청에 대하여는 승낙을 하지 않거나 사후에 이용계약을 해지할 수 있습니다.</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li>제공받은 기본 정보가 허위인 경우</li>
                  <li>본 서비스의 목적에 부합하지 않는 주체가 신청한 경우</li>
                  <li>수리·복구 서비스를 위한 '제휴업체 협력' 계약이 해지된 경우</li>
                </ul>
                <p><span className="font-semibold">제4조 (서비스의 제공 및 변경)</span> 서비스는 회사의 기술적·업무적 특별한 지장이 없는 한 상시 제공을 원칙으로 합니다. 회사는 서비스 개선이나 설비의 긴급 보수, 장애 대응 등 부득이한 사유가 발생한 경우 사전 예고 없이 서비스를 일시 중지할 수 있습니다. 회사는 고의 또는 중과실이 없는 한, 서비스 일시 중지로 인하여 이용자가 입은 부수적 손해에 대하여 책임을 지지 않습니다.</p>
                <p><span className="font-semibold">제5조 (데이터의 소유권 및 관리)</span> "이용고객"이 본 서비스를 통해 입력, 생성 또는 보고한 모든 데이터(이하 "보고 데이터")에 대한 소유권, 지식재산권 및 처분권은 "회사"에게 귀속됩니다. "이용고객"은 서비스 이용 기간 중 업무 목적으로 해당 데이터를 사용할 권한만을 가집니다. "회사"는 데이터를 서비스의 고도화, 통계 분석 및 기타 시스템 운영 목적으로 활용할 수 있습니다.</p>
                <p><span className="font-semibold">제6조 (의무 및 금지사항)</span> "이용고객" 및 "구성원"은 아이디와 비밀번호를 엄격히 관리해야 하며, 제3자에게 공유해서는 안 됩니다. 서비스의 역설계, 해킹 시도, 데이터 무단 크롤링 등 시스템에 위해를 가하는 행위는 엄격히 금지됩니다.</p>
                <p><span className="font-semibold">제7조 (책임 제한)</span> "회사"는 천재지변, 기간통신사업자의 회선 장애, 클라우드 서비스 자체의 기술적 결함 등 "회사"의 통제 범위를 벗어난 사유로 발생한 손해에 대해서는 책임을 지지 않습니다.</p>
                <p><span className="font-semibold">제8조 (비밀 유지)</span> "회사"와 "이용고객"은 서비스 이용 과정에서 알게 된 상대방의 업무상 비밀을 서비스 이용 목적 외의 용도로 사용하거나 제3자에게 누설하여서는 안 됩니다.</p>
                <p><span className="font-semibold">제9조 (준거법 및 재판관할)</span> 본 약관은 대한민국 법령에 의하여 해석되며, 발생한 분쟁에 대해서는 회사의 본점 주소지를 관할하는 법원으로 합니다.</p>
                <p className="border-t border-slate-200 pt-1 mt-1"><span className="font-semibold">부 칙</span> 제1조 (시행일) 이 약관은 2026년 3월 1일부터 시행합니다. 제2조 (개정 이력) v1.0 제정: 2026. 03. 01. (최초 서비스 런칭)</p>
              </div>
            )}

            <div className="flex items-center justify-between p-2.5 bg-white rounded-md" style={{ border: '1px solid #E5E7EB' }}>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={privacyAgreed}
                  onChange={(e) => setPrivacyAgreed(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-200"
                  data-testid="checkbox-privacy-agree"
                />
                <span className="text-xs text-blue-600 font-medium">(필수)</span>
                개인정보 처리방침 고지 확인
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPrivacyExpanded(!privacyExpanded)}
                  className="text-xs text-blue-500 hover:text-blue-700 underline"
                  data-testid="button-privacy-detail"
                >
                  전문 보기
                </button>
                <span
                  className="text-xs font-medium"
                  style={{ color: privacyAgreed ? '#16A34A' : '#9CA3AF' }}
                >
                  {privacyAgreed ? '확인' : '미확인'}
                </span>
              </div>
            </div>
            {privacyExpanded && (
              <div className="p-3 bg-white rounded-md text-xs text-slate-600 leading-relaxed max-h-[200px] overflow-y-auto space-y-2" style={{ border: '1px solid #E5E7EB' }}>
                <p className="font-semibold mb-1">개인정보 처리방침</p>
                <p>주식회사 플록슨(이하 '회사')은 「개인정보 보호법」 제30조에 따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.</p>
                <p><span className="font-semibold">제1조 (개인정보의 처리 목적)</span> 회사는 다음의 목적을 위하여 개인정보를 처리합니다. 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않으며 이용 목적이 변경되는 경우에는 「개인정보 보호법」 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li>서비스 제공 및 관리: B2B 업무 시스템 이용에 따른 본인 식별, 인증, 회원자격 유지·관리, 서비스 공급 및 계약 이행.</li>
                  <li>현장 조사 및 공사 수행 지원: 사고원인 파악을 위한 현장확인, 관련 위치 및 피해상황 사진 촬영, 공사 진행상태 기록 및 관리</li>
                  <li>서비스 이용 관련 문의, 불만 처리 및 고지사항 전달 등</li>
                </ul>
                <p><span className="font-semibold">제2조 (개인정보의 처리 및 보유 기간)</span> ① 회사는 법령에 따른 개인정보 보유·이용 기간 또는 정보주체로부터 개인정보를 수집 시에 동의 받은 개인정보 보유·이용 기간 내에서 개인정보를 처리·보유합니다.</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li>시스템 회원 가입 및 관리: 시스템 탈퇴 시까지</li>
                  <li>관계 법령 위반에 따른 수사·조사 등이 진행 중인 경우: 해당 수사·조사 종료 시까지</li>
                  <li>시스템 이용에 따른 채권·채무관계 잔존 시: 해당 채권·채무관계 정산 완료 시까지</li>
                  <li>서비스 접속 및 이용 기록: 1년 (관련 법령에 따라 최소 1년 이상 보관)</li>
                </ul>
                <p><span className="font-semibold">제3조 (처리하는 개인정보의 항목)</span> 회사는 다음의 개인정보 항목을 처리하고 있습니다.</p>
                <ol className="list-decimal list-inside ml-2 space-y-0.5">
                  <li>피보험자 정보: 성명, 연락처(휴대전화번호), 주소(공사 대상 주택 소재지)</li>
                  <li>피해자 정보: 성명, 연락처, 주소</li>
                  <li>현장 조사 및 업무 수행 정보: 사고 현장 사진(위치 및 피해 상황 포함), 공사 진행 관련 사진</li>
                  <li>시스템 이용자(담당자) 정보: 성명, 소속 회사/부서, 직함, 업무용 연락처, 로그인 ID, 접속 로그, IP 주소</li>
                </ol>
                <p><span className="font-semibold">제4조 (개인정보 처리 업무의 위탁)</span> 회사는 원활한 서비스 제공 및 현장 출동, 복구 공사 등 업무 수행을 위하여 개인정보 처리 업무를 위탁하고 있습니다. 수탁자: 시스템 등록된 공사업체 / 위탁 업무: 현장 출동, 사고원인 확인, 공사 수행, 피해자 확인 및 현장 사진 촬영</p>
                <p><span className="font-semibold">제5조 (개인정보의 파기 절차 및 방법)</span> ① 회사는 개인정보 보유기간의 경과, 처리목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다. ② 전자적 파일 형태의 정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 삭제합니다.</p>
                <p><span className="font-semibold">제6조 (개인정보의 안전성 확보 조치)</span> 회사는 개인정보의 안전성 확보를 위해 관리적 조치(내부관리계획 수립 및 시행, 정기적 직원 교육)와 기술적 조치(접근권한 관리, 접속기록 보관, 비밀번호 일방향 암호화, SSL 암호화 적용)를 취하고 있습니다.</p>
                <p><span className="font-semibold">제7조 (개인정보 보호책임자)</span> 성명: 이현재 / 직책: 상무 / 연락처: hjlee@floxn.co.kr (070-7731-0925)</p>
                <p><span className="font-semibold">제8조 (정보주체의 권리·의무 및 그 행사방법)</span> 정보주체는 회사에 대해 언제든지 개인정보 열람·정정·삭제·처리정지 요구 등의 권리를 행사할 수 있습니다. 권리 행사는 서면, 전자우편 등을 통하여 하실 수 있으며 회사는 이에 대해 지체 없이 조치하겠습니다.</p>
                <p className="border-t border-slate-200 pt-1 mt-1"><span className="font-semibold">부 칙</span> 제1조 (시행일) 본 개인정보 처리방침은 2026년 3월 1일부터 시행됩니다. 제2조 (개정 이력) v1.0 공고일자: 2026.02.23. 시행일자: 2026.03.01 최초 제정 및 시행</p>
              </div>
            )}
          </div>
        </div>

        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-amber-100 rounded-full">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <DialogTitle className="text-lg font-semibold">
              임시 비밀번호 변경
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            보안을 위해 임시 비밀번호를 변경해주세요.
            <br />
            비밀번호를 변경하지 않으면 시스템을 이용할 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    새 비밀번호 <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type={showNewPassword ? "text" : "password"}
                        placeholder="6자 이상, 영문/숫자, 특수문자 포함"
                        className="pl-10 pr-10"
                        data-testid="input-new-password"
                        {...field}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        data-testid="button-toggle-new-password"
                      >
                        {showNewPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    비밀번호 확인 <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="비밀번호를 다시 입력해주세요"
                        className="pl-10 pr-10"
                        data-testid="input-confirm-password"
                        {...field}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        data-testid="button-toggle-confirm-password"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
              <p className="font-medium mb-1">비밀번호 조건:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>6자 이상</li>
                <li>영문자 포함</li>
                <li>숫자 포함</li>
                <li>특수문자 포함</li>
              </ul>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleLogout}
                className="flex-1"
                data-testid="button-logout-from-modal"
              >
                로그아웃
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={changePasswordMutation.isPending || !allAgreed}
                data-testid="button-change-password"
              >
                {changePasswordMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    변경 중...
                  </>
                ) : (
                  "비밀번호 변경"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
