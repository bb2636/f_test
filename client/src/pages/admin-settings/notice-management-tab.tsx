import { Star, Trash2 } from "lucide-react";
import type { Notice, User } from "@shared/schema";
import type { UseMutationResult } from "@tanstack/react-query";

interface NoticeManagementTabProps {
  notices: Notice[];
  noticesLoading: boolean;
  allUsers: Omit<User, "password">[];
  isNoticeManagementFavorite: boolean;
  toggleFavoriteMutation: UseMutationResult<any, any, string, any>;
  setShowAddNoticeModal: (v: boolean) => void;
  setViewingNotice: (v: Notice | null) => void;
  setDeleteTarget: (v: { type: "inquiry" | "notice"; id: string; title: string } | null) => void;
}

export function NoticeManagementTab({
  notices,
  noticesLoading,
  allUsers,
  isNoticeManagementFavorite,
  toggleFavoriteMutation,
  setShowAddNoticeModal,
  setViewingNotice,
  setDeleteTarget,
}: NoticeManagementTabProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h1
            style={{
              fontFamily: "Pretendard",
              fontSize: "28px",
              fontWeight: 600,
              lineHeight: "128%",
              letterSpacing: "-0.02em",
              color: "#56687f",
            }}
          >
            공지사항 관리
          </h1>
          <button
            onClick={() => toggleFavoriteMutation.mutate("공지사항 관리")}
            className="hover:opacity-70 transition-opacity cursor-pointer"
            data-testid="button-toggle-notice-favorite"
          >
            <Star 
              className="w-5 h-5" 
              style={{ 
                color: isNoticeManagementFavorite ? '#FFD700' : 'rgba(12, 12, 12, 0.24)',
                fill: isNoticeManagementFavorite ? '#FFD700' : 'none',
              }} 
            />
          </button>
        </div>
        <button
          onClick={() => setShowAddNoticeModal(true)}
          className="px-6 py-3"
          style={{
            background: "var(--color-button-primary)",
            borderRadius: "8px",
            fontFamily: "Pretendard",
            fontSize: "14px",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "#FDFDFD",
          }}
          data-testid="button-add-notice"
        >
          새 공지 추가
        </button>
      </div>

      <div className="flex items-center gap-1 mb-4">
        <span
          style={{
            fontFamily: "Pretendard",
            fontSize: "20px",
            fontWeight: 700,
            lineHeight: "128%",
            letterSpacing: "-0.02em",
            color: "#56687f",
          }}
        >
          등록된 공지
        </span>
        <span
          style={{
            fontFamily: "Pretendard",
            fontSize: "20px",
            fontWeight: 700,
            lineHeight: "128%",
            letterSpacing: "-0.02em",
            color: "#253396",
          }}
        >
          {notices.length}
        </span>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "#FFFFFF",
          boxShadow: "0px 0px 20px #DBE9F5",
        }}
      >
        <table className="w-full">
          <thead>
            <tr className="compact-row"
              style={{
                background: "#F8F9FA",
                borderBottom: "2px solid rgba(12, 12, 12, 0.1)",
              }}
            >
              {["제목", "내용", "게시일", "수정일", "작성자"].map((label) => (
                <th
                  key={label}
                  className="px-4 py-4 text-left"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    color: "#686A6E",
                  }}
                >
                  {label}
                </th>
              ))}
              <th
                className="px-4 py-4 text-left"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: "#686A6E",
                }}
              >
                조회
              </th>
              <th
                className="px-4 py-4 text-center"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: "#686A6E",
                  width: "60px",
                }}
              >
                삭제
              </th>
            </tr>
          </thead>
          <tbody>
            {noticesLoading ? (
              <tr className="compact-row">
                <td colSpan={7} className="px-4 py-8 text-center">
                  <div className="text-sm text-gray-500">로딩 중...</div>
                </td>
              </tr>
            ) : notices.length === 0 ? (
              <tr className="compact-row">
                <td colSpan={7} className="px-4 py-8 text-center">
                  <div className="text-sm text-gray-500">등록된 공지사항이 없습니다</div>
                </td>
              </tr>
            ) : (
              notices.map((notice, index) => {
                const author = allUsers.find(u => u.id === notice.authorId);
                const createdDate = new Date(notice.createdAt).toLocaleDateString('ko-KR', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit'
                }).replace(/\. /g, '-').replace('.', '');
                
                const updatedDate = notice.updatedAt && new Date(notice.createdAt).getTime() !== new Date(notice.updatedAt).getTime()
                  ? new Date(notice.updatedAt).toLocaleDateString('ko-KR', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit'
                    }).replace(/\. /g, '-').replace('.', '')
                  : '-';

                return (
                  <tr
                    key={notice.id}
                    className="compact-row hover:bg-gray-50 cursor-pointer"
                    style={{
                      borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                    }}
                    data-testid={`row-notice-${index}`}
                  >
                    <td
                      className="px-4 py-4"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "#0C0C0C",
                      }}
                    >
                      {notice.title}
                    </td>
                    <td
                      className="px-4 py-4"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        color: "#686A6E",
                        maxWidth: "200px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {notice.content.substring(0, 30)}...
                    </td>
                    <td
                      className="px-4 py-4"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        color: "#0C0C0C",
                      }}
                    >
                      {createdDate}
                    </td>
                    <td
                      className="px-4 py-4"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        color: "#686A6E",
                      }}
                    >
                      {updatedDate}
                    </td>
                    <td
                      className="px-4 py-4"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        color: "#0C0C0C",
                      }}
                    >
                      {author?.name || "-"}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        className="px-4 py-2"
                        style={{
                          background: "rgba(0, 143, 237, 0.1)",
                          borderRadius: "6px",
                          fontFamily: "Pretendard",
                          fontSize: "13px",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                          color: "#008FED",
                        }}
                        onClick={() => setViewingNotice(notice)}
                        data-testid={`button-notice-view-${index}`}
                      >
                        보기
                      </button>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ type: "notice", id: notice.id, title: notice.title });
                        }}
                        className="p-1.5 hover:bg-red-50 rounded-md transition-colors"
                        data-testid={`button-delete-notice-${index}`}
                      >
                        <Trash2 size={18} style={{ color: "#9CA3AF" }} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
