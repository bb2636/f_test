import { useQuery } from "@tanstack/react-query";
import { User, RolePermission } from "@shared/schema";

interface PermissionState {
  [category: string]: {
    enabled: boolean;
    items: { [item: string]: boolean };
  };
}

export function usePermissions() {
  // Get current user
  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  // Get current user's permissions (single permission for their role)
  const { data: userPermission, isLoading: permissionsLoading } = useQuery<RolePermission | null>({
    queryKey: ["/api/my-permissions"],
    enabled: !!user, // Only fetch if user is logged in
  });

  // Parse permissions JSON (handle both string and object, including double-encoded JSON)
  let permissions: PermissionState = {};
  if (userPermission && userPermission.permissions) {
    try {
      let parsed: unknown = userPermission.permissions;
      
      // Keep parsing while we have a string (handles double-encoded JSON)
      let attempts = 0;
      while (typeof parsed === 'string' && attempts < 3) {
        parsed = JSON.parse(parsed);
        attempts++;
      }
      
      // Verify we have a valid permissions object
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        const hasValidKeys = keys.some(k => isNaN(Number(k)));
        if (hasValidKeys) {
          permissions = parsed as PermissionState;
          console.log("[Permissions] Loaded categories:", keys.filter(k => isNaN(Number(k))));
        } else {
          console.error("[Permissions] Invalid structure - only numeric keys");
        }
      }
    } catch (e) {
      console.error("[Permissions] Failed to parse:", e);
    }
  }

  /**
   * Check if user has access to a specific category
   * Returns true if:
   * 1. The category's enabled is true, OR
   * 2. Any item within the category is true
   */
  const hasCategory = (category: string): boolean => {
    const cat = permissions[category];
    if (!cat) {
      console.log(`[hasCategory] ${category}: NO ENTRY`);
      return false;
    }
    // If enabled is true, return true
    if (cat.enabled === true) {
      console.log(`[hasCategory] ${category}: ENABLED=true -> true`);
      return true;
    }
    // If enabled is false, check if any item is true
    const items = cat.items;
    if (items) {
      const anyItemTrue = Object.values(items).some(value => value === true);
      console.log(`[hasCategory] ${category}: ENABLED=false, items=${JSON.stringify(items)}, anyTrue=${anyItemTrue}`);
      return anyItemTrue;
    }
    console.log(`[hasCategory] ${category}: ENABLED=false, no items -> false`);
    return false;
  };

  /**
   * Check if user has access to a specific item within a category
   * Returns true if:
   * 1. Category enabled is true AND (no items defined OR specific item is true), OR
   * 2. The specific item is explicitly true (even if category enabled is false)
   */
  const hasItem = (category: string, item: string): boolean => {
    if (!permissions[category]) return false;
    const items = permissions[category].items;
    // If specific item is explicitly true, allow access regardless of category enabled
    if (items && items[item] === true) return true;
    // If category enabled but no items defined or empty items, allow all
    if (permissions[category].enabled && (!items || Object.keys(items).length === 0)) return true;
    return false;
  };

  /**
   * Check if user has any of the specified categories
   */
  const hasAnyCategory = (categories: string[]): boolean => {
    return categories.some((category) => hasCategory(category));
  };

  /**
   * Check if user is admin
   */
  const isAdmin = user?.role === "관리자";

  return {
    user,
    permissions,
    isLoading: userLoading || permissionsLoading,
    hasCategory,
    hasItem,
    hasAnyCategory,
    isAdmin,
  };
}
