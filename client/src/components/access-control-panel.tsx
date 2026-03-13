import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Minus, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VALID_ROLES, PERMISSION_CATEGORIES, type RolePermission, type User } from "@shared/schema";

type PermissionCategory = keyof typeof PERMISSION_CATEGORIES;

interface PermissionState {
  [category: string]: {
    enabled: boolean;
    items: { [item: string]: boolean };
  };
}

interface RolePermissions {
  [role: string]: PermissionState;
}

export function AccessControlPanel() {
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState<string>("협력사");
  const [selectedAdminId, setSelectedAdminId] = useState<string>("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["현장조사", "종합진행관리", "통계 및 정산", "관리자 설정"])
  );
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>({});

  // Fetch all admin users (관리자 역할)
  const { data: adminUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
    select: (users) => users.filter((user) => user.role === "관리자"),
  });

  const categories = Object.keys(PERMISSION_CATEGORIES) as PermissionCategory[];

  // Fetch all role permissions
  const { data: allPermissions, isLoading } = useQuery<RolePermission[]>({
    queryKey: ["/api/role-permissions"],
  });

  // Save role permission mutation
  const savePermissionMutation = useMutation({
    mutationFn: async (data: { roleName: string; permissions: string }) => {
      return await apiRequest("POST", "/api/role-permissions", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/role-permissions"] });
      toast({
        title: "저장 완료",
        description: "권한이 성공적으로 저장되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "저장 실패",
        description: "권한 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Delete role permission mutation (for resetting individual admin permissions)
  const deletePermissionMutation = useMutation({
    mutationFn: async (roleName: string) => {
      return await apiRequest("DELETE", `/api/role-permissions/${encodeURIComponent(roleName)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/role-permissions"] });
      toast({
        title: "초기화 완료",
        description: "개별 권한이 삭제되어 전체 관리자 권한으로 복원되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "초기화 실패",
        description: "권한 초기화 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Load permissions from API when data is fetched
  useEffect(() => {
    if (allPermissions) {
      const loadedPermissions: RolePermissions = {};
      allPermissions.forEach((perm) => {
        try {
          loadedPermissions[perm.roleName] = JSON.parse(perm.permissions);
        } catch (e) {
          console.error("Failed to parse permissions for role:", perm.roleName, e);
        }
      });
      setRolePermissions(loadedPermissions);
    }
  }, [allPermissions]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  // Get permission key based on selected role and admin
  const getPermissionKey = (): string => {
    if (selectedRole === "관리자" && selectedAdminId && selectedAdminId !== "__all__") {
      return `관리자_${selectedAdminId}`;
    }
    return selectedRole;
  };

  // Check if individual admin has custom permissions saved
  const hasIndividualPermissions = (): boolean => {
    if (selectedRole !== "관리자" || !selectedAdminId || selectedAdminId === "__all__") {
      return false;
    }
    const key = `관리자_${selectedAdminId}`;
    return !!rolePermissions[key] && Object.keys(rolePermissions[key]).length > 0;
  };

  const getCurrentPermissions = (): PermissionState => {
    const key = getPermissionKey();
    const individualPermissions = rolePermissions[key];
    
    // For individual admins, inherit from global admin permissions if no individual permissions exist
    if (selectedRole === "관리자" && selectedAdminId && selectedAdminId !== "__all__") {
      if (!individualPermissions || Object.keys(individualPermissions).length === 0) {
        // Deep clone global admin permissions to prevent mutation of the original
        const globalPerms = rolePermissions["관리자"];
        if (globalPerms) {
          return JSON.parse(JSON.stringify(globalPerms));
        }
        return {};
      }
    }
    
    return individualPermissions || {};
  };

  const updateCurrentPermissions = (newPermissions: PermissionState) => {
    const key = getPermissionKey();
    setRolePermissions((prev) => ({
      ...prev,
      [key]: newPermissions,
    }));
  };

  // Reset admin selection when role changes
  useEffect(() => {
    if (selectedRole !== "관리자") {
      setSelectedAdminId("");
    } else if (!selectedAdminId) {
      // Default to "전체 관리자" when 관리자 role is selected
      setSelectedAdminId("__all__");
    }
  }, [selectedRole]);

  const toggleCategoryPermission = (category: string, checked: boolean) => {
    const currentPerms = getCurrentPermissions();
    const items = PERMISSION_CATEGORIES[category as PermissionCategory];
    const newState = { ...currentPerms };
    newState[category] = {
      enabled: checked,
      items:
        items.length > 0
          ? Object.fromEntries(items.map((item) => [item, checked]))
          : {},
    };
    updateCurrentPermissions(newState);
  };

  const toggleItemPermission = (
    category: string,
    item: string,
    checked: boolean
  ) => {
    const currentPerms = getCurrentPermissions();
    const newState = { ...currentPerms };
    if (!newState[category]) {
      newState[category] = { enabled: false, items: {} };
    }
    newState[category].items[item] = checked;
    
    // Check if all items are checked to update parent
    const items = PERMISSION_CATEGORIES[category as PermissionCategory];
    const allChecked = items.every((i) => newState[category].items[i]);
    newState[category].enabled = allChecked;
    
    updateCurrentPermissions(newState);
  };

  const handleAllowAll = () => {
    const allPermissions: PermissionState = {};
    categories.forEach((category) => {
      const items = PERMISSION_CATEGORIES[category];
      allPermissions[category] = {
        enabled: true,
        items:
          items.length > 0
            ? Object.fromEntries(items.map((item) => [item, true]))
            : {},
      };
    });
    updateCurrentPermissions(allPermissions);
  };

  const isCategoryChecked = (category: string) => {
    const currentPerms = getCurrentPermissions();
    const items = PERMISSION_CATEGORIES[category as PermissionCategory];
    
    // For categories with sub-items, check if ALL items are checked
    if (items && items.length > 0) {
      return items.every((item) => currentPerms[category]?.items[item] === true);
    }
    
    // For categories without sub-items, use the enabled flag
    return currentPerms[category]?.enabled || false;
  };

  const isItemChecked = (category: string, item: string) => {
    const currentPerms = getCurrentPermissions();
    return currentPerms[category]?.items[item] || false;
  };

  const handleSave = () => {
    const currentPerms = getCurrentPermissions();
    const key = getPermissionKey();
    savePermissionMutation.mutate({
      roleName: key,
      permissions: JSON.stringify(currentPerms),
    });
  };

  // Reset individual admin permissions (delete from database)
  const handleResetIndividualPermissions = () => {
    if (!hasIndividualPermissions()) return;
    const key = `관리자_${selectedAdminId}`;
    deletePermissionMutation.mutate(key);
    // Also remove from local state
    setRolePermissions((prev) => {
      const newState = { ...prev };
      delete newState[key];
      return newState;
    });
  };

  // Get display name for selected role/admin
  const getDisplayName = (): string => {
    if (selectedRole === "관리자") {
      if (selectedAdminId && selectedAdminId !== "__all__") {
        const admin = adminUsers.find((u) => u.id === selectedAdminId);
        return admin ? `${admin.name || admin.username} (관리자)` : "관리자";
      }
      return "전체 관리자";
    }
    return selectedRole;
  };

  return (
    <>
      {/* Title */}
      <div className="flex items-center mb-6">
        <h1
          style={{
            fontFamily: "Pretendard",
            fontSize: "26px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#0C0C0C",
          }}
        >
          접근 권한 관리
        </h1>
      </div>

      <div className="flex gap-6">
        {/* Left Card - Role Selection */}
        <div
          className="rounded-xl"
          style={{
            width: "444px",
            background: "#FFFFFF",
            boxShadow: "0px 0px 20px #DBE9F5",
          }}
        >
          {/* Card Header */}
          <div
            className="px-6 py-6"
            style={{
              borderBottom: "2px solid rgba(12, 12, 12, 0.1)",
            }}
          >
            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "20px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
              }}
            >
              역할
            </span>
          </div>

          {/* Role Selection */}
          <div className="px-5 py-6 space-y-5">
            <div>
              <label
                className="mb-2 block"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  color: "#686A6E",
                }}
              >
                역할 선택
              </label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger
                  className="w-full"
                  style={{
                    height: "68px",
                    background: "#FDFDFD",
                    border: "2px solid rgba(12, 12, 12, 0.08)",
                    borderRadius: "8px",
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}
                  data-testid="select-role"
                >
                  <SelectValue placeholder="접근 가능 범위를 역할별 파악을 선택하세요." />
                </SelectTrigger>
                <SelectContent>
                  {VALID_ROLES.map((role) => (
                    <SelectItem 
                      key={role} 
                      value={role}
                      data-testid={`select-role-option-${role}`}
                    >
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Admin User Selection - Only shows when 관리자 is selected */}
            {selectedRole === "관리자" && (
              <div>
                <label
                  className="mb-2 block"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: "#686A6E",
                  }}
                >
                  관리자 선택
                </label>
                <Select value={selectedAdminId} onValueChange={setSelectedAdminId}>
                  <SelectTrigger
                    className="w-full"
                    style={{
                      height: "68px",
                      background: "#FDFDFD",
                      border: "2px solid rgba(12, 12, 12, 0.08)",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.9)",
                    }}
                    data-testid="select-admin"
                  >
                    <SelectValue placeholder="관리자를 선택하세요." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem 
                      value="__all__"
                      data-testid="select-admin-option-all"
                    >
                      전체 관리자 (기본)
                    </SelectItem>
                    {adminUsers.map((admin) => (
                      <SelectItem 
                        key={admin.id} 
                        value={admin.id}
                        data-testid={`select-admin-option-${admin.id}`}
                      >
                        {admin.name || admin.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* Right Card - Permissions */}
        <div
          className="flex-1 rounded-xl"
          style={{
            background: "#FFFFFF",
            boxShadow: "0px 0px 20px #DBE9F5",
          }}
        >
          {/* Header */}
          <div
            className="flex flex-col justify-center items-center py-6 gap-5"
            style={{
              borderBottom: "1px solid rgba(0, 143, 237, 0.3)",
            }}
          >
            {/* Selected Role Box */}
            <div
              className="flex flex-col items-start gap-2.5 w-full"
              style={{
                maxWidth: "1091px",
                padding: "16px 20px",
                background: "rgba(12, 12, 12, 0.04)",
                backdropFilter: "blur(7px)",
                borderRadius: "12px",
              }}
            >
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.7)",
                }}
                data-testid="text-selected-role-label"
              >
                선택된 역할
              </span>
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: 600,
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.9)",
                }}
                data-testid="text-selected-role-value"
              >
                {getDisplayName()}
              </span>
            </div>

            {/* Buttons Row */}
            <div
              className="flex justify-between items-center w-full"
              style={{
                maxWidth: "1091px",
              }}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={handleAllowAll}
                  className="flex justify-center items-center gap-2"
                  style={{
                    padding: "12px 16px",
                    background: "rgba(0, 143, 237, 0.1)",
                    border: "2px solid rgba(255, 255, 255, 0.04)",
                    boxShadow: "inset 0px -2px 4px rgba(0, 0, 0, 0.05), inset 0px 2px 4px rgba(0, 0, 0, 0.05)",
                    backdropFilter: "blur(7px)",
                    borderRadius: "6px",
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "#008FED",
                  }}
                  data-testid="button-allow-all"
                >
                  전체 허용
                </button>
                <button
                  onClick={handleSave}
                  disabled={savePermissionMutation.isPending || isLoading}
                  className="flex justify-center items-center gap-2"
                  style={{
                    padding: "12px 16px",
                    background: (savePermissionMutation.isPending || isLoading) ? "#CCCCCC" : "#008FED",
                    border: "2px solid rgba(255, 255, 255, 0.04)",
                    boxShadow: "inset 0px -2px 4px rgba(0, 0, 0, 0.05), inset 0px 2px 4px rgba(0, 0, 0, 0.05)",
                    backdropFilter: "blur(7px)",
                    borderRadius: "6px",
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "#FFFFFF",
                    cursor: (savePermissionMutation.isPending || isLoading) ? "not-allowed" : "pointer",
                  }}
                  data-testid="button-save"
                >
                  {savePermissionMutation.isPending ? "저장 중..." : "저장"}
                </button>
                {/* Reset Individual Admin Permissions Button */}
                {selectedRole === "관리자" && selectedAdminId && selectedAdminId !== "__all__" && hasIndividualPermissions() && (
                  <button
                    onClick={handleResetIndividualPermissions}
                    disabled={deletePermissionMutation.isPending}
                    className="flex justify-center items-center gap-2"
                    style={{
                      padding: "12px 16px",
                      background: deletePermissionMutation.isPending ? "#CCCCCC" : "rgba(239, 68, 68, 0.1)",
                      border: "2px solid rgba(255, 255, 255, 0.04)",
                      boxShadow: "inset 0px -2px 4px rgba(0, 0, 0, 0.05), inset 0px 2px 4px rgba(0, 0, 0, 0.05)",
                      backdropFilter: "blur(7px)",
                      borderRadius: "6px",
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      lineHeight: "128%",
                      letterSpacing: "-0.02em",
                      color: deletePermissionMutation.isPending ? "#666666" : "#EF4444",
                      cursor: deletePermissionMutation.isPending ? "not-allowed" : "pointer",
                    }}
                    data-testid="button-reset-permissions"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {deletePermissionMutation.isPending ? "초기화 중..." : "권한 초기화"}
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  // Reset all permissions to false
                  const emptyPermissions: PermissionState = {};
                  categories.forEach((category) => {
                    const items = PERMISSION_CATEGORIES[category];
                    emptyPermissions[category] = {
                      enabled: false,
                      items: items.reduce((acc, item) => {
                        acc[item] = false;
                        return acc;
                      }, {} as { [item: string]: boolean }),
                    };
                  });
                  
                  const key = getPermissionKey();
                  setRolePermissions((prev) => ({
                    ...prev,
                    [key]: emptyPermissions,
                  }));
                  
                  toast({
                    title: "권한 초기화",
                    description: `${getDisplayName()}의 모든 권한이 초기화되었습니다.`,
                  });
                }}
                className="flex items-center gap-1.5"
                style={{
                  background: "transparent",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 500,
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.7)",
                  cursor: "pointer",
                }}
                data-testid="button-reset"
              >
                <RotateCcw className="w-5 h-5" style={{ color: "rgba(12, 12, 12, 0.7)" }} />
                초기화
              </button>
            </div>
          </div>

          {/* Permissions List */}
          <div className="px-6 py-6 flex flex-col gap-4">
            {categories.map((category) => {
              const items = PERMISSION_CATEGORIES[category];
              const hasItems = items.length > 0;
              const isExpanded = expandedCategories.has(category);
              const isChecked = isCategoryChecked(category);

              return (
                <div
                  key={category}
                  className="rounded-lg"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid rgba(12, 12, 12, 0.08)",
                  }}
                >
                  {/* Category Header */}
                  <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) =>
                          toggleCategoryPermission(category, checked as boolean)
                        }
                        style={{
                          width: "20px",
                          height: "20px",
                        }}
                        data-testid={`checkbox-${category}`}
                      />
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 500,
                          letterSpacing: "-0.02em",
                          color: "#0C0C0C",
                        }}
                        data-testid={`text-category-${category}`}
                      >
                        {category === "새로운접수" ? "접수하기" : category}
                      </span>
                    </div>
                    {hasItems && (
                      <button
                        onClick={() => toggleCategory(category)}
                        className="p-1"
                        data-testid={`button-toggle-${category}`}
                      >
                        <Minus className="w-5 h-5 text-[#0C0C0C]" />
                      </button>
                    )}
                  </div>

                  {/* Sub Items */}
                  {hasItems && isExpanded && (
                    <div
                      className="px-6 pb-4 pt-2 flex flex-wrap gap-6"
                      style={{
                        borderTop: "1px solid rgba(12, 12, 12, 0.08)",
                      }}
                    >
                      {items.map((item) => (
                        <div
                          key={item}
                          className="flex items-center gap-2"
                          style={{ minWidth: "150px" }}
                        >
                          <Checkbox
                            checked={isItemChecked(category, item)}
                            onCheckedChange={(checked) =>
                              toggleItemPermission(
                                category,
                                item,
                                checked as boolean
                              )
                            }
                            style={{
                              width: "18px",
                              height: "18px",
                            }}
                            data-testid={`checkbox-${category}-${item}`}
                          />
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 500,
                              letterSpacing: "-0.01em",
                              color: "#0C0C0C",
                            }}
                            data-testid={`text-item-${category}-${item}`}
                          >
                            {item}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
