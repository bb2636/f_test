import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Plus, MessageSquare, X, Mail, Loader2, Search } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import Intake from "@/pages/intake";

interface Recipient {
  name: string;
  phone: string;
  company?: string;
}

export function FloatingIntakeButton() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const { toast } = useToast();

  const [smsSubject, setSmsSubject] = useState("");
  const [smsContent, setSmsContent] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [senderName, setSenderName] = useState("");
  const [senderSearchQuery, setSenderSearchQuery] = useState("");
  const [showSenderSearch, setShowSenderSearch] = useState(false);
  const senderSearchRef = useRef<HTMLDivElement>(null);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: smsDialogOpen,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
      if (senderSearchRef.current && !senderSearchRef.current.contains(e.target as Node)) {
        setShowSenderSearch(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const sendSmsMutation = useMutation({
    mutationFn: async (data: { subject: string; content: string; recipients: Recipient[]; senderName?: string }) => {
      const res = await apiRequest("POST", "/api/send-custom-sms", data);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "문자 발송 완료",
        description: data.message,
      });
      resetSmsForm();
      setSmsDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "문자 발송 실패",
        description: error?.message || "문자 발송 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const hiddenPaths = ['/', '/login', '/intake', '/forbidden', '/not-found'];
  if (hiddenPaths.includes(location)) return null;

  if (user?.role !== "관리자") return null;

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleSuccess = () => {
    setIsOpen(false);
  };

  const filteredSenderUsers = (allUsers || []).filter((u) => {
    if (!senderSearchQuery.trim()) return false;
    if (u.role !== "관리자") return false;
    const q = senderSearchQuery.trim().toLowerCase();
    return u.name && u.name.toLowerCase().includes(q);
  });

  const filteredUsers = (allUsers || []).filter((u) => {
    if (!searchQuery.trim()) return false;
    const q = searchQuery.trim().toLowerCase();
    const alreadyAdded = recipients.some((r) => r.phone === u.phone && r.name === u.name);
    if (alreadyAdded) return false;
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.company && u.company.toLowerCase().includes(q))
    );
  });

  const addUserAsRecipient = (u: User) => {
    if (!u.phone) {
      toast({
        title: "추가 불가",
        description: `${u.name}님의 연락처가 등록되어 있지 않습니다.`,
        variant: "destructive",
      });
      return;
    }
    if (recipients.length >= 10) {
      toast({
        title: "추가 불가",
        description: "수신인은 최대 10명까지 선택 가능합니다.",
        variant: "destructive",
      });
      return;
    }
    const alreadyAdded = recipients.some((r) => r.phone === u.phone && r.name === u.name);
    if (alreadyAdded) {
      toast({
        title: "중복 수신인",
        description: `${u.name}님은 이미 추가되어 있습니다.`,
        variant: "destructive",
      });
      return;
    }
    setRecipients([...recipients, { name: u.name, phone: u.phone, company: u.company }]);
    setSearchQuery("");
    setShowSearchResults(false);
  };

  const removeRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const resetSmsForm = () => {
    setSmsSubject("");
    setSmsContent("");
    setRecipients([]);
    setSearchQuery("");
    setShowSearchResults(false);
    setSenderName(user?.name || "");
    setSenderSearchQuery("");
    setShowSenderSearch(false);
  };

  const handleSendSms = () => {
    if (!smsSubject.trim()) {
      toast({ title: "입력 오류", description: "제목을 입력해주세요.", variant: "destructive" });
      return;
    }
    if (!smsContent.trim()) {
      toast({ title: "입력 오류", description: "내용을 입력해주세요.", variant: "destructive" });
      return;
    }
    if (recipients.length === 0) {
      toast({ title: "입력 오류", description: "수신인을 1명 이상 추가해주세요.", variant: "destructive" });
      return;
    }
    sendSmsMutation.mutate({
      subject: smsSubject,
      content: smsContent,
      recipients,
      senderName: senderName.trim() || undefined,
    });
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: '32px',
          left: '32px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          zIndex: 100,
        }}
      >
        <button
          onClick={() => {
            setSmsSubject("");
            setSmsContent("");
            setRecipients([]);
            setSearchQuery("");
            setShowSearchResults(false);
            setSenderName(user?.name || "");
            setSenderSearchQuery("");
            setShowSenderSearch(false);
            setSmsDialogOpen(true);
          }}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '14px 20px',
            background: '#6B5CE7',
            borderRadius: '40px',
            border: 'none',
            boxShadow: '0px 4px 20px rgba(107, 92, 231, 0.4)',
            cursor: 'pointer',
          }}
          data-testid="button-floating-sms"
        >
          <MessageSquare size={18} color="#FFFFFF" />
          <span style={{
            fontFamily: 'Pretendard',
            fontWeight: 600,
            fontSize: '14px',
            lineHeight: '128%',
            letterSpacing: '-0.02em',
            color: '#FFFFFF',
          }}>
            문자발송
          </span>
        </button>

        <button
          onClick={() => setIsOpen(true)}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '16px 24px',
            background: '#008FED',
            borderRadius: '40px',
            border: 'none',
            boxShadow: '0px 4px 20px rgba(0, 143, 237, 0.4)',
            cursor: 'pointer',
          }}
          data-testid="button-floating-intake"
        >
          <span style={{
            fontFamily: 'Pretendard',
            fontWeight: 600,
            fontSize: '16px',
            lineHeight: '128%',
            letterSpacing: '-0.02em',
            color: '#FFFFFF',
          }}>
            접수
          </span>
          <Plus size={20} color="#FFFFFF" />
        </button>
      </div>

      <Dialog open={smsDialogOpen} onOpenChange={setSmsDialogOpen}>
        <DialogContent
          style={{
            maxWidth: '720px',
            width: '90vw',
            maxHeight: '85vh',
            overflow: 'auto',
            padding: '0',
            borderRadius: '12px',
          }}
          data-testid="dialog-sms-send"
        >
          <div style={{ padding: '28px 32px' }}>
            <DialogHeader>
              <DialogTitle style={{
                fontFamily: 'Pretendard',
                fontSize: '20px',
                fontWeight: 700,
                color: '#0C0C0C',
                textAlign: 'center',
                marginBottom: '24px',
              }}>
                문자 보내기
              </DialogTitle>
            </DialogHeader>

            <div style={{ display: 'flex', gap: '20px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label style={{
                    fontFamily: 'Pretendard',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: '#0C0C0C',
                    minWidth: '48px',
                  }}>
                    제목
                  </label>
                  <input
                    type="text"
                    value={smsSubject}
                    onChange={(e) => setSmsSubject(e.target.value)}
                    placeholder="문자 제목을 입력하세요"
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      border: '1px solid rgba(12, 12, 12, 0.15)',
                      borderRadius: '8px',
                      fontFamily: 'Pretendard',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                    data-testid="input-sms-subject"
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{
                    fontFamily: 'Pretendard',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: '#008FED',
                  }}>
                    내용입력
                  </label>
                  <textarea
                    value={smsContent}
                    onChange={(e) => setSmsContent(e.target.value)}
                    placeholder="문자 내용을 입력하세요"
                    style={{
                      width: '100%',
                      minHeight: '220px',
                      padding: '14px',
                      border: '1px solid #008FED',
                      borderRadius: '8px',
                      fontFamily: 'Pretendard',
                      fontSize: '14px',
                      lineHeight: '1.6',
                      resize: 'vertical',
                      outline: 'none',
                      background: '#F0F7FF',
                    }}
                    data-testid="textarea-sms-content"
                  />
                </div>
              </div>

              <div style={{ width: '260px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <div style={{
                    fontFamily: 'Pretendard',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: '#0C0C0C',
                    marginBottom: '8px',
                  }}>
                    수신인 {recipients.length > 0 && <span style={{ color: '#008FED', fontWeight: 700 }}>({recipients.length}명)</span>}
                  </div>

                  <div ref={searchRef} style={{ position: 'relative', marginBottom: '8px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      border: '1px solid rgba(12, 12, 12, 0.15)',
                      borderRadius: '8px',
                      background: '#FFFFFF',
                    }}>
                      <Search size={16} color="rgba(12,12,12,0.4)" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setShowSearchResults(true);
                        }}
                        onFocus={() => { if (searchQuery.trim()) setShowSearchResults(true); }}
                        placeholder="이름 또는 회사명으로 검색"
                        style={{
                          flex: 1,
                          border: 'none',
                          fontFamily: 'Pretendard',
                          fontSize: '13px',
                          outline: 'none',
                          background: 'transparent',
                        }}
                        data-testid="input-search-recipient"
                      />
                    </div>

                    {showSearchResults && searchQuery.trim() && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: '#FFFFFF',
                        border: '1px solid rgba(12,12,12,0.15)',
                        borderRadius: '8px',
                        marginTop: '4px',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        zIndex: 50,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      }}>
                        {filteredUsers.length === 0 ? (
                          <div style={{
                            padding: '12px 14px',
                            fontFamily: 'Pretendard',
                            fontSize: '12px',
                            color: 'rgba(12,12,12,0.4)',
                            textAlign: 'center',
                          }}>
                            검색 결과가 없습니다
                          </div>
                        ) : (
                          filteredUsers.map((u) => (
                            <button
                              key={u.id}
                              onClick={() => addUserAsRecipient(u)}
                              style={{
                                width: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                                padding: '10px 14px',
                                border: 'none',
                                borderBottom: '1px solid rgba(12,12,12,0.06)',
                                background: 'transparent',
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = '#F5F7FA')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              data-testid={`button-search-user-${u.id}`}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontFamily: 'Pretendard', fontSize: '13px', fontWeight: 600, color: '#0C0C0C' }}>{u.name}</span>
                                <span style={{ fontFamily: 'Pretendard', fontSize: '11px', color: 'rgba(12,12,12,0.5)', background: '#F0F2F5', padding: '1px 6px', borderRadius: '4px' }}>{u.role}</span>
                              </div>
                              <div style={{ fontFamily: 'Pretendard', fontSize: '12px', color: 'rgba(12,12,12,0.5)' }}>
                                {u.company}{u.phone ? ` · ${u.phone}` : ' · 연락처 없음'}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{
                    border: '1px solid rgba(12, 12, 12, 0.15)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 32px',
                      background: '#F5F7FA',
                      borderBottom: '1px solid rgba(12, 12, 12, 0.1)',
                    }}>
                      <div style={{ padding: '8px 10px', fontFamily: 'Pretendard', fontSize: '12px', fontWeight: 600, color: 'rgba(12,12,12,0.6)' }}>이름(회사)</div>
                      <div style={{ padding: '8px 10px', fontFamily: 'Pretendard', fontSize: '12px', fontWeight: 600, color: 'rgba(12,12,12,0.6)' }}>휴대폰번호</div>
                      <div />
                    </div>

                    <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                      {recipients.length === 0 ? (
                        <div style={{
                          padding: '20px',
                          textAlign: 'center',
                          fontFamily: 'Pretendard',
                          fontSize: '12px',
                          color: 'rgba(12,12,12,0.3)',
                        }}>
                          수신인을 추가해주세요
                        </div>
                      ) : (
                        recipients.map((r, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr 32px',
                              borderBottom: idx < recipients.length - 1 ? '1px solid rgba(12,12,12,0.06)' : 'none',
                              alignItems: 'center',
                            }}
                            data-testid={`row-recipient-${idx}`}
                          >
                            <div style={{ padding: '8px 10px', fontFamily: 'Pretendard', fontSize: '13px', color: '#0C0C0C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.name}{r.company ? <span style={{ fontSize: '11px', color: 'rgba(12,12,12,0.45)', marginLeft: '4px' }}>({r.company})</span> : ''}
                            </div>
                            <div style={{ padding: '8px 10px', fontFamily: 'Pretendard', fontSize: '13px', color: '#0C0C0C' }}>{r.phone}</div>
                            <button
                              onClick={() => removeRecipient(idx)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              data-testid={`button-remove-recipient-${idx}`}
                            >
                              <X size={14} color="rgba(12,12,12,0.4)" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '16px' }}>
                  <div style={{
                    fontFamily: 'Pretendard',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: '#0C0C0C',
                    marginBottom: '8px',
                  }}>
                    발신인
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="text"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="발신인 이름"
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        border: '1px solid rgba(12, 12, 12, 0.15)',
                        borderRadius: '6px',
                        fontFamily: 'Pretendard',
                        fontSize: '13px',
                        outline: 'none',
                      }}
                      data-testid="input-sender-name"
                    />
                    <div ref={senderSearchRef} style={{ position: 'relative' }}>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => setShowSenderSearch(!showSenderSearch)}
                        data-testid="button-sender-search"
                      >
                        <Search size={16} />
                      </Button>

                      {showSenderSearch && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          width: '220px',
                          background: '#FFFFFF',
                          border: '1px solid rgba(12,12,12,0.15)',
                          borderRadius: '8px',
                          marginTop: '4px',
                          zIndex: 50,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        }}>
                          <div style={{ padding: '8px' }}>
                            <input
                              type="text"
                              value={senderSearchQuery}
                              onChange={(e) => setSenderSearchQuery(e.target.value)}
                              placeholder="관리자 이름 검색"
                              autoFocus
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                border: '1px solid rgba(12,12,12,0.15)',
                                borderRadius: '6px',
                                fontFamily: 'Pretendard',
                                fontSize: '12px',
                                outline: 'none',
                              }}
                              data-testid="input-sender-search"
                            />
                          </div>
                          <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                            {filteredSenderUsers.length === 0 && senderSearchQuery.trim() ? (
                              <div style={{
                                padding: '10px 14px',
                                fontFamily: 'Pretendard',
                                fontSize: '12px',
                                color: 'rgba(12,12,12,0.4)',
                                textAlign: 'center',
                              }}>
                                검색 결과 없음
                              </div>
                            ) : (
                              filteredSenderUsers.map((u) => (
                                <button
                                  key={u.id}
                                  onClick={() => {
                                    setSenderName(u.name);
                                    setSenderSearchQuery("");
                                    setShowSenderSearch(false);
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '8px 14px',
                                    border: 'none',
                                    borderBottom: '1px solid rgba(12,12,12,0.06)',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    fontFamily: 'Pretendard',
                                    fontSize: '13px',
                                    color: '#0C0C0C',
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = '#F5F7FA')}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                  data-testid={`button-sender-user-${u.id}`}
                                >
                                  {u.name}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '6px',
                    fontFamily: 'Pretendard',
                    fontSize: '12px',
                    color: 'rgba(12,12,12,0.5)',
                  }}>
                    <Mail size={12} color="rgba(12,12,12,0.4)" />
                    <span>연락처: 070-7778-0925</span>
                  </div>
                </div>

              </div>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginTop: '24px',
              paddingTop: '16px',
              borderTop: '1px solid rgba(12, 12, 12, 0.08)',
            }}>
              <Button
                onClick={handleSendSms}
                disabled={sendSmsMutation.isPending}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 24px',
                  background: '#008FED',
                  fontFamily: 'Pretendard',
                  fontWeight: 600,
                  fontSize: '14px',
                }}
                data-testid="button-send-sms"
              >
                {sendSmsMutation.isPending ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Mail size={18} />
                )}
                {sendSmsMutation.isPending ? "발송 중..." : "발송"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={isOpen} onOpenChange={setIsOpen} modal={true}>
        <SheetContent 
          side="right" 
          className="w-full sm:max-w-full md:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] p-0 flex flex-col"
          style={{ 
            maxWidth: '1400px',
            background: '#F5F7FA',
            height: '100vh',
          }}
        >
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <Intake 
              isModal={true} 
              onClose={handleClose} 
              onSuccess={handleSuccess} 
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
