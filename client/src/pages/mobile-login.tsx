import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { loginSchema, type LoginInput } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Check } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import logoIcon from "@assets/Frame 2_1762217940686.png";

export default function MobileLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    setVh();
    window.addEventListener('resize', setVh);
    return () => window.removeEventListener('resize', setVh);
  }, []);

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
          setLocation("/mobile-home");
        }
      } catch (error) {
        console.error("Session check failed:", error);
      }
    };

    checkSession();

    const savedRememberMe = localStorage.getItem("rememberMe");
    if (savedRememberMe === "true") {
      form.setValue("rememberMe", true);
    }
  }, [setLocation, form]);

  const loginMutation = useMutation({
    mutationFn: async (data: LoginInput) => {
      return await apiRequest("POST", "/api/login", data);
    },
    onSuccess: (data, variables) => {
      if (variables.rememberMe) {
        localStorage.setItem("rememberMe", "true");
      } else {
        localStorage.removeItem("rememberMe");
      }

      toast({
        title: "로그인 성공",
        description: "환영합니다!",
      });

      setTimeout(() => {
        setLocation("/mobile-home");
      }, 500);
    },
    onError: (error: any) => {
      const errorMessage = error?.error || "로그인에 실패했습니다. 다시 시도해주세요.";
      
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

  return (
    <div 
      className="relative w-full bg-white"
      style={{
        minHeight: 'calc(var(--vh, 1vh) * 100)',
      }}
    >
      <div 
        className="flex flex-col items-center px-4 pt-[132px]"
        style={{
          gap: '62px',
        }}
      >
        <div 
          className="flex flex-col items-center"
          style={{
            gap: '16px',
          }}
        >
          <img 
            src={logoIcon} 
            alt="FLOXN Logo" 
            style={{
              width: '71px',
              height: '72px',
            }}
            data-testid="img-mobile-logo"
          />
          <span
            style={{
              fontFamily: 'Pretendard',
              fontWeight: 700,
              fontSize: '20px',
              lineHeight: '100%',
              letterSpacing: '-0.02em',
              color: '#0C0C0C',
            }}
            data-testid="text-mobile-brand"
          >
            FLOXN
          </span>
        </div>

        <Form {...form}>
          <form 
            onSubmit={form.handleSubmit(onSubmit)} 
            className="w-full max-w-[343px]"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '38px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div
                          style={{
                            boxSizing: 'border-box',
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            padding: '10px 20px',
                            gap: '10px',
                            width: '100%',
                            height: '52px',
                            background: '#FDFDFD',
                            border: '1px solid rgba(12, 12, 12, 0.08)',
                            borderRadius: '8px',
                          }}
                        >
                          <input
                            {...field}
                            placeholder="아이디"
                            aria-label="아이디"
                            className="w-full bg-transparent outline-none"
                            style={{
                              fontFamily: 'Pretendard',
                              fontWeight: 600,
                              fontSize: '15px',
                              lineHeight: '128%',
                              letterSpacing: '-0.02em',
                              color: '#0C0C0C',
                            }}
                            data-testid="input-mobile-username"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div
                          style={{
                            boxSizing: 'border-box',
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            padding: '10px 20px',
                            gap: '10px',
                            width: '100%',
                            height: '52px',
                            background: '#FDFDFD',
                            border: '1px solid rgba(12, 12, 12, 0.08)',
                            borderRadius: '8px',
                          }}
                        >
                          <input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            placeholder="비밀번호"
                            aria-label="비밀번호"
                            className="flex-1 bg-transparent outline-none"
                            style={{
                              fontFamily: 'Pretendard',
                              fontWeight: 600,
                              fontSize: '15px',
                              lineHeight: '128%',
                              letterSpacing: '-0.02em',
                              color: '#0C0C0C',
                            }}
                            data-testid="input-mobile-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="flex items-center justify-center"
                            aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                            style={{
                              width: '22px',
                              height: '22px',
                            }}
                            data-testid="button-toggle-password"
                          >
                            {showPassword ? (
                              <Eye 
                                className="w-[18px] h-[18px]" 
                                style={{ color: 'rgba(12, 12, 12, 0.4)' }}
                              />
                            ) : (
                              <EyeOff 
                                className="w-[18px] h-[18px]" 
                                style={{ color: 'rgba(12, 12, 12, 0.4)' }}
                              />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="rememberMe"
                render={({ field }) => (
                  <FormItem>
                    <div 
                      className="flex items-center cursor-pointer"
                      style={{
                        gap: '6px',
                      }}
                      onClick={() => field.onChange(!field.value)}
                    >
                      <div
                        style={{
                          width: '22px',
                          height: '22px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '4px',
                          border: field.value 
                            ? '1px solid #008FED' 
                            : '1px solid rgba(12, 12, 12, 0.24)',
                          background: field.value ? '#008FED' : 'transparent',
                        }}
                        data-testid="checkbox-mobile-remember"
                      >
                        {field.value && (
                          <Check 
                            className="w-[14px] h-[14px]" 
                            style={{ color: '#FFFFFF' }}
                          />
                        )}
                      </div>
                      <span
                        style={{
                          fontFamily: 'Pretendard',
                          fontWeight: 500,
                          fontSize: '14px',
                          lineHeight: '128%',
                          letterSpacing: '-0.01em',
                          color: 'rgba(12, 12, 12, 0.8)',
                        }}
                      >
                        자동로그인
                      </span>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending}
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '16px 0px',
                gap: '8px',
                width: '100%',
                height: '54px',
                background: '#008FED',
                borderRadius: '8px',
                border: 'none',
                cursor: loginMutation.isPending ? 'not-allowed' : 'pointer',
                opacity: loginMutation.isPending ? 0.7 : 1,
              }}
              data-testid="button-mobile-login"
            >
              {loginMutation.isPending ? (
                <Loader2 
                  className="w-5 h-5 animate-spin" 
                  style={{ color: '#FDFDFD' }}
                />
              ) : (
                <span
                  style={{
                    fontFamily: 'Pretendard',
                    fontWeight: 600,
                    fontSize: '15px',
                    lineHeight: '128%',
                    textAlign: 'center',
                    letterSpacing: '-0.02em',
                    color: '#FDFDFD',
                  }}
                >
                  로그인
                </span>
              )}
            </button>
          </form>
        </Form>
      </div>

      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          width: '134px',
          height: '5px',
          bottom: '8px',
          background: '#111111',
          borderRadius: '100px',
        }}
      />
    </div>
  );
}
