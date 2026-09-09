"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FlashbarProps } from '@cloudscape-design/components/flashbar';
import { useAuth } from './auth-context';
import { useTranslation } from '@/app/lib/use-translation';
import { apiFetch } from '@/app/lib/api-client';

interface TrackedTask { upid: string; node: string; description: string; startedAt: number; failures: number }
interface NotificationContextValue {
  notifications: FlashbarProps.MessageDefinition[];
  addSuccess: (message: string) => void;
  addError: (message: string) => void;
  addInfo: (message: string) => void;
  trackTask: (upid: string, node: string, description: string) => void;
}
const NotificationContext = createContext<NotificationContextValue>({ notifications: [], addSuccess: () => {}, addError: () => {}, addInfo: () => {}, trackTask: () => {} });
export function useNotifications() { return useContext(NotificationContext); }

export function retainNotifications(items: FlashbarProps.MessageDefinition[]) {
  let history = 0;
  return items.filter(item => {
    if (item.loading || item.type === 'in-progress' || item.type === 'error' || item.type === 'warning') return true;
    return history++ < 100;
  });
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { authenticated, user } = useAuth();
  const { language } = useTranslation();
  const [notifications, setNotifications] = useState<FlashbarProps.MessageDefinition[]>([]);
  const tasks = useRef(new Map<string, TrackedTask>());
  const completed = useRef(new Set<string>());
  const sequence = useRef(0);
  const dismiss = useCallback((id: string) => setNotifications(current => current.filter(item => item.id !== id)), []);
  const notify = useCallback((type: FlashbarProps.Type, content: string) => {
    const id = `notification-${++sequence.current}`;
    setNotifications(current => retainNotifications([{ id, type, content, dismissible: true, onDismiss: () => dismiss(id) }, ...current]));
  }, [dismiss]);
  const addSuccess = useCallback((message: string) => notify('success', message), [notify]);
  const addError = useCallback((message: string) => notify('error', message), [notify]);
  const addInfo = useCallback((message: string) => notify('info', message), [notify]);
  const trackTask = useCallback((upid: string, node: string, description: string) => {
    if (!upid.startsWith('UPID:') || !node || tasks.current.has(upid) || completed.current.has(upid)) return;
    tasks.current.set(upid, { upid, node, description, startedAt: Date.now(), failures: 0 });
    const id = `task-${upid}`;
    setNotifications(current => [{ id, type: 'in-progress', content: description, loading: true, dismissible: false }, ...current]);
  }, []);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (authenticated && detail && typeof detail.upid === 'string' && typeof detail.node === 'string' && typeof detail.description === 'string') trackTask(detail.upid, detail.node, detail.description);
    };
    window.addEventListener('proxmox-task-started', listener);
    return () => window.removeEventListener('proxmox-task-started', listener);
  }, [authenticated, trackTask]);
  useEffect(() => {
    const activeTasks = tasks.current;
    const finishedTasks = completed.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      // A single in-flight batch prevents slow responses from polling a task twice.
      const pending = [...activeTasks.values()];
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(6, pending.length) }, async () => {
      while (next < pending.length && !controller.signal.aborted) {
        const task = pending[next++];
        const id = `task-${task.upid}`;
        try {
          const response = await apiFetch(`/api/proxmox/nodes/${encodeURIComponent(task.node)}/tasks/${encodeURIComponent(task.upid)}/status`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), maxRetries: 0 });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const { data } = await response.json();
          if (!data || !['running', 'stopped'].includes(data.status)) throw new Error('Invalid task status');
          if (controller.signal.aborted) return;
          if (data.status === 'stopped' && (typeof data.exitstatus !== 'string' || !data.exitstatus)) throw new Error('Task exit status is not yet available');
          task.failures = 0;
          if (data.status === 'stopped') {
            activeTasks.delete(task.upid);
            finishedTasks.add(task.upid);
            if (finishedTasks.size > 1000) finishedTasks.delete(finishedTasks.values().next().value!);
            const ok = data.exitstatus === 'OK';
            setNotifications(current => current.map(item => item.id === id ? { id, type: ok ? 'success' : 'error', content: `${task.description}: ${data.exitstatus ?? (language === 'ko' ? '완료 상태 알 수 없음' : 'Unknown exit status')}`, loading: false, dismissible: true, onDismiss: () => dismiss(id) } : item));
            window.dispatchEvent(new CustomEvent('proxmox-task-finished', { detail: { upid: task.upid, node: task.node, ok } }));
          } else {
            const seconds = Math.round((Date.now() - task.startedAt) / 1000);
            setNotifications(current => current.map(item => item.id === id ? { ...item, type: 'in-progress', content: `${task.description} (${seconds}s)`, loading: true } : item));
          }
        } catch {
          if (controller.signal.aborted) return;
          task.failures += 1;
          if (task.failures >= 3) setNotifications(current => current.map(item => item.id === id ? { ...item, type: 'warning', loading: false, content: `${task.description}: ${language === 'ko' ? '완료 상태를 확인할 수 없습니다. 연결을 다시 확인하는 중입니다.' : 'Completion status unavailable. Retrying the connection.'}` } : item));
        }
      }
      }));
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    }
    if (authenticated) timer = setTimeout(() => void poll(), 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [authenticated, user, language, dismiss]);
  return <NotificationContext.Provider value={{ notifications: authenticated ? notifications : [], addSuccess, addError, addInfo, trackTask }}>{children}</NotificationContext.Provider>;
}
