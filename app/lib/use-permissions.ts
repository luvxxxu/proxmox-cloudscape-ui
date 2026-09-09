'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/components/auth-context';
import { apiFetch } from './api-client';

interface PermissionEntry { [path: string]: Record<string, number> }
interface UsePermissionsResult { permissions: PermissionEntry | null; loading: boolean; check: (path: string, privilege: string) => boolean; checkAny: (path: string, privileges: string[]) => boolean }

export function usePermissions(): UsePermissionsResult {
  const { authenticated, user } = useAuth();
  const [state, setState] = useState<{ user: string | null; data: PermissionEntry | null; loading: boolean }>({ user: null, data: null, loading: true });
  useEffect(() => {
    if (!authenticated || !user) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch('/api/proxmox/access/permissions', { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load permissions');
        const json = await response.json();
        if (!controller.signal.aborted) setState({ user, data: json.data || null, loading: false });
      } catch { if (!controller.signal.aborted) setState({ user, data: null, loading: false }); }
    })();
    return () => controller.abort();
  }, [authenticated, user]);
  const permissions = authenticated && state.user === user ? state.data : null;
  const check = useCallback((path: string, privilege: string) => {
    if (!permissions) return false;
    // The API returns effective per-path privileges. Never infer inheritance across explicit child ACLs.
    const value = permissions[path]?.[privilege];
    return value === 0 || value === 1;
  }, [permissions]);
  const checkAny = useCallback((path: string, privileges: string[]) => privileges.some((privilege) => check(path, privilege)), [check]);
  return { permissions, loading: authenticated && (state.user !== user || state.loading), check, checkAny };
}
