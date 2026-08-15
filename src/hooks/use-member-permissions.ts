"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type Permission = {
  id: string;
  module: string;
  action: string;
};

type PermissionMap = Record<string, boolean>;

const permissionKey = (module: string, action: string) =>
  `${module}:${action}`;

export function useMemberPermissions() {
  const { user, accountRole } = useAuth();

  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadPermissions() {
      if (!user?.id || !accountRole) {
        setPermissions({});
        setLoading(false);
        return;
      }

      if (accountRole === "owner" || accountRole === "admin") {
        setPermissions({});
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const supabase = createClient();

        const [definitionsRes, roleRes, overridesRes] =
          await Promise.all([
            supabase
              .from("permission_definitions")
              .select("id, module, action"),

            supabase
              .from("role_permissions")
              .select("permission_id, allowed")
              .eq("role", accountRole),

            supabase
              .from("member_permission_overrides")
              .select("permission_id, allowed")
              .eq("user_id", user.id),
          ]);

        if (definitionsRes.error) throw definitionsRes.error;
        if (roleRes.error) throw roleRes.error;
        if (overridesRes.error) throw overridesRes.error;

        const definitions = (definitionsRes.data ?? []) as Permission[];

        const rolePermissions = new Map(
          (roleRes.data ?? []).map((row) => [
            row.permission_id,
            Boolean(row.allowed),
          ]),
        );

        const overrides = new Map(
          (overridesRes.data ?? []).map((row) => [
            row.permission_id,
            Boolean(row.allowed),
          ]),
        );

        const result: PermissionMap = {};

        for (const permission of definitions) {
          const key = permissionKey(
            permission.module,
            permission.action,
          );

          result[key] =
            rolePermissions.get(permission.id) ?? false;

          if (overrides.has(permission.id)) {
            result[key] = overrides.get(permission.id)!;
          }
        }

        if (!cancelled) {
          setPermissions(result);
        }
      } catch (error) {
        console.error(
          "[useMemberPermissions] Error loading permissions:",
          error,
        );

        if (!cancelled) {
          setPermissions({});
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPermissions();

    return () => {
      cancelled = true;
    };
  }, [user?.id, accountRole]);

  const can = useCallback(
    (module: string, action: string) => {
      if (accountRole === "owner" || accountRole === "admin") {
        return true;
      }

      return permissions[permissionKey(module, action)] ?? false;
    },
    [permissions, accountRole],
  );

  return {
    can,
    loading,
    permissions,
  };
}