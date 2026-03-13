import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, UserFavorite, Notice, Inquiry } from "@shared/schema";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { X, Pencil, Star, Home, CalendarPlus, AlertCircle, Building2, TrendingUp, Settings, FileText, Plus, MessageCircle, ChevronDown, ChevronUp, Eye, EyeOff, Lock, MoreHorizontal, CheckCircle2, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";

interface MyPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
}

type TabType = "profile" | "notices" | "inquiries" | "favorites";

export function MyPageDialog({ open, onOpenChange, user }: MyPageDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>("profile");
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showInquiryForm, setShowInquiryForm] = useState(false);
  const [inquiryTitle, setInquiryTitle] = useState("");
  const [inquiryContent, setInquiryContent] = useState("");
  const [expandedInquiry, setExpandedInquiry] = useState<string | null>(null);
  const [respondingInquiryId, setRespondingInquiryId] = useState<string | null>(null);
  const [responseTitle, setResponseTitle] = useState("");
  const [responseContent, setResponseContent] = useState("");
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  
  // Check if user is admin
  const isAdmin = user.role === "관리자";

  // Fetch favorites
  const { data: favorites = [], isLoading: favoritesLoading } = useQuery<UserFavorite[]>({
    queryKey: ["/api/favorites"],
    enabled: open,
  });

  // Fetch notices
  const { data: notices = [], isLoading: noticesLoading } = useQuery<Notice[]>({
    queryKey: ["/api/notices"],
    enabled: open,
  });

  // Fetch inquiries
  const { data: inquiries = [], isLoading: inquiriesLoading } = useQuery<Inquiry[]>({
    queryKey: ["/api/inquiries"],
    enabled: open,
  });

  // Create inquiry mutation
  const createInquiryMutation = useMutation({
    mutationFn: (data: { title: string; content: string }) =>
      apiRequest("POST", "/api/inquiries", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/inquiries"] });
      toast({
        title: "문의 등록 완료",
        description: "문의가 성공적으로 등록되었습니다.",
      });
      setShowInquiryForm(false);
      setInquiryTitle("");
      setInquiryContent("");
    },
    onError: () => {
      toast({
        title: "문의 등록 실패",
        description: "다시 시도해주세요.",
        variant: "destructive",
      });
    },
  });

  // Respond to inquiry mutation (admin only)
  const respondInquiryMutation = useMutation({
    mutationFn: (data: { id: string; responseTitle: string; response: string }) =>
      apiRequest("PATCH", `/api/inquiries/${data.id}`, {
        responseTitle: data.responseTitle,
        response: data.response,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/inquiries"] });
      toast({
        title: "답변 등록 완료",
        description: "답변이 성공적으로 등록되었습니다.",
      });
      setRespondingInquiryId(null);
      setResponseTitle("");
      setResponseContent("");
    },
    onError: () => {
      toast({
        title: "답변 등록 실패",
        description: "다시 시도해주세요.",
        variant: "destructive",
      });
    },
  });

  // Add favorite mutation
  const addFavoriteMutation = useMutation({
    mutationFn: (menuName: string) => apiRequest("POST", "/api/favorites", { menuName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/favorites"] });
      toast({
        title: "즐겨찾기 추가",
        description: "즐겨찾기에 추가되었습니다.",
      });
    },
  });

  // Remove favorite mutation
  const removeFavoriteMutation = useMutation({
    mutationFn: (menuName: string) => apiRequest("DELETE", `/api/favorites/${encodeURIComponent(menuName)}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/favorites"] });
      toast({
        title: "즐겨찾기 해제",
        description: "즐겨찾기에서 제거되었습니다.",
      });
    },
  });

  // Menu structure for favorites (실제 헤더/사이드바 메뉴와 일치)
  const menuStructure = [
    { category: "홈", items: [] },
    { category: "접수하기", items: [] },
    { category: "종합진행관리", items: [] },
    { 
      category: "정산 및 통계", 
      items: ["정산 조회", "통계"] 
    },
    { 
      category: "관리자 설정", 
      items: ["사용자 계정 관리", "접근 권한 관리", "1:1 문의 관리", "공지사항 관리", "DB 관리", "기준정보 관리", "변경 로그 관리"] 
    },
  ];

  const isFavorite = (menuName: string) => {
    return favorites.some(f => f.menuName === menuName);
  };

  const toggleFavorite = (menuName: string) => {
    if (isFavorite(menuName)) {
      removeFavoriteMutation.mutate(menuName);
    } else {
      addFavoriteMutation.mutate(menuName);
    }
  };

  const handleResetFavorites = () => {
    favorites.forEach(fav => {
      removeFavoriteMutation.mutate(fav.menuName);
    });
  };

  const handleSelectAll = () => {
    const allMenus = menuStructure.flatMap(m => 
      m.items.length > 0 ? [m.category, ...m.items] : [m.category]
    );
    allMenus.forEach(menuName => {
      if (!isFavorite(menuName)) {
        addFavoriteMutation.mutate(menuName);
      }
    });
  };

  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<User>) =>
      apiRequest("PATCH", `/api/users/${user.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "저장 완료",
        description: "프로필이 업데이트되었습니다.",
      });
      setIsEditing(null);
    },
    onError: () => {
      toast({
        title: "저장 실패",
        description: "다시 시도해주세요.",
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/logout", {}),
    onSuccess: () => {
      // 모든 캐시 초기화 - 세션 정보 완전히 제거
      qc.clear();
      onOpenChange(false);
      setLocation("/");
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      apiRequest("PATCH", "/api/me/password", data),
    onSuccess: () => {
      toast({
        title: "비밀번호 변경 완료",
        description: "비밀번호가 성공적으로 변경되었습니다.",
      });
      setShowPasswordChange(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error: any) => {
      toast({
        title: "비밀번호 변경 실패",
        description: error?.message || "비밀번호 변경 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (field: string, currentValue: string) => {
    setIsEditing(field);
    setEditValue(currentValue || "");
  };

  const handleSave = (field: string) => {
    updateProfileMutation.mutate({ [field]: editValue });
  };

  const handleKeyDown = (e: React.KeyboardEvent, field: string) => {
    if (e.key === "Enter") {
      handleSave(field);
    } else if (e.key === "Escape") {
      setIsEditing(null);
    }
  };

  const menuItems = [
    { id: "profile" as TabType, label: "내 프로필 설정" },
    { id: "notices" as TabType, label: "공지사항" },
    { id: "inquiries" as TabType, label: "1:1문의" },
    ...(user.role !== "협력사" ? [{ id: "favorites" as TabType, label: "즐겨찾기 목록" }] : []),
  ];

  const getInitials = (name: string) => {
    return name ? name.charAt(0) : "U";
  };

  const renderEditableField = (
    label: string,
    field: keyof User,
    value: string | null | undefined
  ) => {
    const displayValue = value || "";
    const isCurrentlyEditing = isEditing === field;

    return (
      <div className="py-4 border-b border-gray-100">
        <div className="text-sm text-gray-500 mb-1">{label}</div>
        <div className="flex items-center justify-between">
          {isCurrentlyEditing ? (
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, field)}
              onBlur={() => handleSave(field)}
              autoFocus
              className="flex-1 mr-2"
              data-testid={`input-edit-${field}`}
            />
          ) : (
            <span className="text-base text-gray-900">{displayValue || "-"}</span>
          )}
          {!isCurrentlyEditing && field !== "username" && field !== "role" && (
            <button
              onClick={() => handleEdit(field, displayValue)}
              className="p-1 hover:bg-gray-100 rounded"
              data-testid={`button-edit-${field}`}
            >
              <Pencil className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderReadOnlyField = (label: string, value: string | null | undefined, badge?: string) => {
    return (
      <div className="py-4 border-b border-gray-100">
        <div className="text-sm text-gray-500 mb-1">{label}</div>
        <div className="flex items-center gap-2">
          <span className="text-base text-gray-900">{value || "-"}</span>
          {badge && (
            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
              {badge}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-3xl p-0 gap-0 overflow-hidden"
        style={{ 
          borderRadius: '16px',
          maxHeight: '90vh',
        }}
      >
        <div className="flex" style={{ height: 'calc(90vh - 2rem)', minHeight: '600px' }}>
          <div 
            className="w-48 flex-shrink-0 p-6"
            style={{ 
              background: '#F8F9FA',
              borderRight: '1px solid #E9ECEF',
            }}
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-6">마이페이지</h2>
            <nav className="space-y-1">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    activeTab === item.id
                      ? "bg-[#008FED]/10 text-[#008FED] font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                  data-testid={`tab-${item.id}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex-1 p-8 overflow-y-auto relative" style={{ maxHeight: 'calc(90vh - 2rem)' }}>
            {activeTab === "profile" && (
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">내 프로필 설정</h3>
                <p className="text-sm text-gray-500 mb-6">
                  최신 연락수단을 유지해주세요. 변경사항은 즉시 저장됩니다.
                </p>

                <div className="flex items-center gap-4 mb-6">
                  <div 
                    className="w-24 h-24 rounded-lg flex items-center justify-center relative flex-shrink-0"
                    style={{ background: 'rgba(0, 143, 237, 0.15)' }}
                  >
                    <span className="text-3xl font-bold text-[#008FED]">
                      {getInitials(user.name)}
                    </span>
                    <button 
                      className="absolute bottom-0 right-0 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center"
                      data-testid="button-edit-avatar"
                    >
                      <Pencil className="w-3.5 h-3.5 text-gray-500" />
                    </button>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400" style={{ fontFamily: "Pretendard" }}>성함</span>
                    <p className="text-base font-semibold text-gray-900" style={{ fontFamily: "Pretendard" }}>{user.name}</p>
                  </div>
                </div>
                {renderReadOnlyField("아이디", user.username)}
                {renderEditableField("연락처", "phone", user.phone)}
                {renderEditableField("이메일", "email", user.email)}
                {renderReadOnlyField("회사명", user.company, user.role)}
                {renderReadOnlyField("부서", user.department)}
                {renderEditableField("회사 연락처", "office", user.office)}

                <div className="mt-6 pt-6 border-t border-gray-100">
                  {!showPasswordChange ? (
                    <button
                      onClick={() => setShowPasswordChange(true)}
                      className="flex items-center gap-2 text-sm text-[#008FED] hover:text-[#0070BE] transition-colors"
                      data-testid="button-show-password-change"
                    >
                      <Lock className="w-4 h-4" />
                      비밀번호 변경
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-gray-900">비밀번호 변경</h4>
                        <button
                          onClick={() => {
                            setShowPasswordChange(false);
                            setCurrentPassword("");
                            setNewPassword("");
                            setConfirmPassword("");
                          }}
                          className="text-sm text-gray-500 hover:text-gray-700"
                          data-testid="button-cancel-password-change"
                        >
                          취소
                        </button>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm text-gray-500 mb-1">현재 비밀번호</label>
                          <div className="relative">
                            <Input
                              type={showCurrentPassword ? "text" : "password"}
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              placeholder="현재 비밀번호를 입력하세요"
                              className="pr-10"
                              data-testid="input-current-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              data-testid="button-toggle-current-password"
                            >
                              {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm text-gray-500 mb-1">새 비밀번호</label>
                          <div className="relative">
                            <Input
                              type={showNewPassword ? "text" : "password"}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              placeholder="8자 이상, 영문+숫자 포함"
                              className="pr-10"
                              data-testid="input-new-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              data-testid="button-toggle-new-password"
                            >
                              {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">8자 이상, 영문자와 숫자를 포함해야 합니다</p>
                        </div>

                        <div>
                          <label className="block text-sm text-gray-500 mb-1">새 비밀번호 확인</label>
                          <div className="relative">
                            <Input
                              type={showConfirmPassword ? "text" : "password"}
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              placeholder="새 비밀번호를 다시 입력하세요"
                              className="pr-10"
                              data-testid="input-confirm-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              data-testid="button-toggle-confirm-password"
                            >
                              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {confirmPassword && newPassword !== confirmPassword && (
                            <p className="text-xs text-red-500 mt-1">새 비밀번호가 일치하지 않습니다</p>
                          )}
                        </div>

                        <Button
                          onClick={() => {
                            changePasswordMutation.mutate({
                              currentPassword,
                              newPassword,
                              confirmPassword,
                            });
                          }}
                          disabled={
                            !currentPassword || 
                            !newPassword || 
                            !confirmPassword || 
                            newPassword !== confirmPassword ||
                            newPassword.length < 8 ||
                            !/[A-Za-z]/.test(newPassword) ||
                            !/[0-9]/.test(newPassword) ||
                            changePasswordMutation.isPending
                          }
                          className="w-full bg-[#008FED] hover:bg-[#0070BE]"
                          data-testid="button-submit-password-change"
                        >
                          {changePasswordMutation.isPending ? "변경 중..." : "비밀번호 변경"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-8 text-center">
                  <button
                    onClick={() => logoutMutation.mutate()}
                    className="text-sm text-gray-500 underline hover:text-gray-700"
                    data-testid="button-logout-mypage"
                  >
                    로그아웃
                  </button>
                </div>
              </div>
            )}

            {activeTab === "notices" && (
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">공지사항</h3>
                <p className="text-sm text-gray-500 mb-6">
                  보안·개인정보·권한 규정을 준수하세요. 위반 시 계정 제한이 발생할 수 있습니다.
                </p>
                {noticesLoading ? (
                  <div className="text-center py-12 text-gray-500">로딩 중...</div>
                ) : notices.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    등록된 공지사항이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {notices.map((notice) => {
                      const formatDate = (date: Date | string) => {
                        try {
                          return format(new Date(date), "yyyy-MM-dd");
                        } catch {
                          return "-";
                        }
                      };

                      const contentLines = notice.content.split("\n").filter(line => line.trim());

                      return (
                        <div
                          key={notice.id}
                          className="p-4 rounded-xl bg-gray-50"
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-5 h-5 text-gray-500" />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-semibold text-gray-900 mb-1">{notice.title}</h4>
                              <p className="text-sm text-gray-400 mb-3">{formatDate(notice.createdAt)}</p>
                              <ul className="space-y-1">
                                {contentLines.map((line, idx) => (
                                  <li key={idx} className="text-sm text-gray-600 flex items-start gap-2">
                                    <span className="text-gray-400 mt-1">•</span>
                                    <span>{line}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "inquiries" && (
              <div>
                {/* 제목 및 설명 */}
                <h3 className="text-xl font-semibold text-gray-900 mb-1">
                  {isAdmin ? "1:1 문의 관리" : "1:1 문의"}
                </h3>
                {!isAdmin && (
                  <p className="text-sm text-gray-500 mb-6">
                    문의하실 핵심 요점을 간결하게 남겨 주세요.
                  </p>
                )}
                {isAdmin && (
                  <p className="text-sm text-gray-500 mb-6">
                    고객 문의에 답변해 주세요.
                  </p>
                )}

                {/* 일반 사용자: 문의 작성 폼 (항상 표시) */}
                {!isAdmin && (
                  <div className="space-y-4 mb-8">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">제목</label>
                      <Input
                        placeholder="문의 제목을 입력하세요"
                        value={inquiryTitle}
                        onChange={(e) => setInquiryTitle(e.target.value)}
                        className="border-gray-200"
                        data-testid="input-inquiry-title"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">내용</label>
                      <div className="relative">
                        <Textarea
                          placeholder="문의 내용을 입력하세요"
                          value={inquiryContent}
                          onChange={(e) => {
                            if (e.target.value.length <= 800) {
                              setInquiryContent(e.target.value);
                            }
                          }}
                          rows={8}
                          className="border-gray-200 resize-none"
                          data-testid="input-inquiry-content"
                        />
                        <div className="absolute bottom-2 right-3 text-xs text-gray-400">
                          {inquiryContent.length} /800
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <button
                        onClick={() => {
                          setInquiryTitle("");
                          setInquiryContent("");
                        }}
                        className="text-sm text-gray-500 hover:text-gray-700"
                        data-testid="button-reset-inquiry"
                      >
                        초기화
                      </button>
                      <Button
                        onClick={() => {
                          if (inquiryTitle.trim() && inquiryContent.trim()) {
                            createInquiryMutation.mutate({
                              title: inquiryTitle,
                              content: inquiryContent,
                            });
                          }
                        }}
                        disabled={!inquiryTitle.trim() || !inquiryContent.trim() || createInquiryMutation.isPending}
                        className="bg-[#008FED] hover:bg-[#0070BE] px-8"
                        data-testid="button-submit-inquiry"
                      >
                        {createInquiryMutation.isPending ? "등록 중..." : "확인"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* 문의 내역 테이블 */}
                <div className="border-t border-gray-200 pt-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">
                    {isAdmin ? `전체 문의 내역 ${inquiries.length}` : `내 문의 내역 ${inquiries.length}`}
                  </h4>

                  {inquiriesLoading ? (
                    <div className="text-center py-12 text-gray-500">로딩 중...</div>
                  ) : inquiries.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      문의 내역이 없습니다.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="py-3 px-3 text-center text-gray-600 font-medium w-16">순서</th>
                            <th className="py-3 px-3 text-center text-gray-600 font-medium w-28">날짜</th>
                            <th className="py-3 px-3 text-left text-gray-600 font-medium">제목</th>
                            <th className="py-3 px-3 text-left text-gray-600 font-medium">내용</th>
                            <th className="py-3 px-3 text-center text-gray-600 font-medium w-16">
                              <div className="flex justify-center">
                                <MoreHorizontal className="w-5 h-5 text-gray-500" />
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {inquiries.map((inquiry, index) => {
                            const formatDateShort = (date: Date | string) => {
                              try {
                                return format(new Date(date), "yyyy-MM-dd");
                              } catch {
                                return "-";
                              }
                            };
                            const isExpanded = expandedInquiry === inquiry.id;

                            return (
                              <>
                                <tr
                                  key={inquiry.id}
                                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                                  onClick={() => setExpandedInquiry(isExpanded ? null : inquiry.id)}
                                  data-testid={`inquiry-row-${inquiry.id}`}
                                >
                                  <td className="py-3 px-3 text-center text-gray-900">{index + 1}</td>
                                  <td className="py-3 px-3 text-center text-gray-600">{formatDateShort(inquiry.createdAt)}</td>
                                  <td className="py-3 px-3 text-gray-900 truncate max-w-[150px]">{inquiry.title}</td>
                                  <td className="py-3 px-3 text-gray-600 truncate max-w-[200px]">{inquiry.content}</td>
                                  <td className="py-3 px-3 text-center">
                                    <div className="flex justify-center">
                                      {inquiry.status === "완료" ? (
                                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                                      ) : (
                                        <Clock className="w-5 h-5 text-amber-500" />
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr key={`${inquiry.id}-expanded`}>
                                    <td colSpan={5} className="bg-gray-50 p-4">
                                      <div className="space-y-4">
                                        {/* 문의 내용 전체 */}
                                        <div className="p-4 bg-white rounded-lg border border-gray-200">
                                          <p className="text-sm font-medium text-gray-700 mb-2">문의 내용</p>
                                          <p className="text-sm text-gray-600 whitespace-pre-wrap break-all">{inquiry.content}</p>
                                        </div>

                                        {/* 관리자 답변 */}
                                        {inquiry.response && (
                                          <div className="p-4 bg-blue-50 rounded-lg border-l-4 border-[#008FED]">
                                            <div className="flex items-center gap-2 mb-2">
                                              <span className="text-sm font-medium text-[#008FED]">관리자 답변</span>
                                              {inquiry.respondedAt && (
                                                <span className="text-xs text-gray-400">
                                                  {format(new Date(inquiry.respondedAt), "yyyy-MM-dd HH:mm")}
                                                </span>
                                              )}
                                            </div>
                                            {inquiry.responseTitle && (
                                              <p className="font-medium text-gray-900 mb-1 break-all">{inquiry.responseTitle}</p>
                                            )}
                                            <p className="text-sm text-gray-600 whitespace-pre-wrap break-all">{inquiry.response}</p>
                                          </div>
                                        )}

                                        {/* 관리자용 답변 폼 */}
                                        {isAdmin && inquiry.status !== "완료" && (
                                          <div className="mt-4">
                                            {respondingInquiryId === inquiry.id ? (
                                              <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                                                <h5 className="font-medium text-[#008FED]">답변 작성</h5>
                                                <Input
                                                  placeholder="답변 제목을 입력하세요"
                                                  value={responseTitle}
                                                  onChange={(e) => setResponseTitle(e.target.value)}
                                                  data-testid="input-response-title"
                                                />
                                                <Textarea
                                                  placeholder="답변 내용을 입력하세요"
                                                  value={responseContent}
                                                  onChange={(e) => setResponseContent(e.target.value)}
                                                  rows={4}
                                                  data-testid="input-response-content"
                                                />
                                                <div className="flex gap-2 justify-end">
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setRespondingInquiryId(null);
                                                      setResponseTitle("");
                                                      setResponseContent("");
                                                    }}
                                                    data-testid="button-cancel-response"
                                                  >
                                                    취소
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (responseTitle.trim() && responseContent.trim()) {
                                                        respondInquiryMutation.mutate({
                                                          id: inquiry.id,
                                                          responseTitle: responseTitle,
                                                          response: responseContent,
                                                        });
                                                      }
                                                    }}
                                                    disabled={!responseTitle.trim() || !responseContent.trim() || respondInquiryMutation.isPending}
                                                    className="bg-[#008FED] hover:bg-[#0070BE]"
                                                    data-testid="button-submit-response"
                                                  >
                                                    {respondInquiryMutation.isPending ? "등록 중..." : "답변 등록"}
                                                  </Button>
                                                </div>
                                              </div>
                                            ) : (
                                              <Button
                                                size="sm"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setRespondingInquiryId(inquiry.id);
                                                }}
                                                className="bg-[#008FED] hover:bg-[#0070BE]"
                                                data-testid={`button-respond-${inquiry.id}`}
                                              >
                                                답변하기
                                              </Button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "favorites" && (
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">즐겨찾기 목록</h3>
                <p className="text-sm text-gray-500 mb-6">
                  자주 쓰는 화면을 고정해 빠르게 접근하세요. 불필요한 항목은 수시로 정리해 주세요.
                </p>

                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={handleSelectAll}
                    className="text-sm text-[#008FED] hover:underline font-medium"
                    data-testid="button-select-all-favorites"
                  >
                    전체 선택
                  </button>
                  <button
                    onClick={handleResetFavorites}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                    data-testid="button-reset-favorites"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    초기화
                  </button>
                </div>

                {favoritesLoading ? (
                  <div className="text-center py-12 text-gray-500">로딩 중...</div>
                ) : (
                  <div className="space-y-1">
                    {menuStructure.map((menu, menuIndex) => (
                      <div key={menu.category}>
                        {/* Category Header */}
                        <div className="flex items-center justify-between py-3 border-b border-gray-100">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleFavorite(menu.category)}
                              className="flex-shrink-0"
                              data-testid={`toggle-favorite-${menu.category}`}
                            >
                              <Star 
                                className={`w-5 h-5 ${
                                  isFavorite(menu.category) 
                                    ? "fill-[#008FED] text-[#008FED]" 
                                    : "text-gray-300"
                                }`} 
                              />
                            </button>
                            <span className="font-semibold text-gray-900">{menu.category}</span>
                          </div>
                          {menu.items.length > 0 && (
                            <span className="text-gray-400">—</span>
                          )}
                        </div>

                        {/* Sub Items */}
                        {menu.items.length > 0 && (
                          <div className="flex flex-wrap gap-x-6 gap-y-2 py-3 pl-8">
                            {menu.items.map((item) => (
                              <button
                                key={item}
                                onClick={() => toggleFavorite(item)}
                                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                                data-testid={`toggle-favorite-${item}`}
                              >
                                <Star 
                                  className={`w-4 h-4 ${
                                    isFavorite(item) 
                                      ? "fill-[#008FED] text-[#008FED]" 
                                      : "text-gray-300"
                                  }`} 
                                />
                                <span>{item}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
