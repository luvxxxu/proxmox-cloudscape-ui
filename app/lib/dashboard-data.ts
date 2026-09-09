'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api-client';
import { useSettings } from '@/app/components/settings-context';
import { useAuth } from '@/app/components/auth-context';

export interface PveNode {
  node: string; status: 'online' | 'offline' | 'unknown'; cpu: number; maxcpu: number;
  mem: number; maxmem: number; disk: number; maxdisk: number; uptime: number;
}
export interface PveResource {
  id: string; type: 'qemu' | 'lxc' | 'node' | 'storage' | 'sdn'; node: string; name?: string;
  vmid?: number; status: string; cpu?: number; maxcpu?: number; mem?: number; maxmem?: number;
  disk?: number; maxdisk?: number; uptime?: number; template?: number;
}
export interface PveRrdPoint { time: number; cpu?: number; memused?: number; memtotal?: number; netin?: number; netout?: number }
export type RrdTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year';
export interface DashboardData { nodes: PveNode[]; resources: PveResource[]; rrd: PveRrdPoint[]; rrdUnavailable: string[] }
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function normalizeNodes(value: unknown): PveNode[] {
  if (!Array.isArray(value)) throw new Error('Proxmox returned an invalid node list');
  return value.filter((node) => node && typeof node.node === 'string').map((node) => ({
    node: node.node, status: node.status === 'online' || node.status === 'offline' ? node.status : 'unknown',
    cpu: Math.min(1, nonnegative(node.cpu)), maxcpu: nonnegative(node.maxcpu), mem: nonnegative(node.mem), maxmem: nonnegative(node.maxmem),
    disk: nonnegative(node.disk), maxdisk: nonnegative(node.maxdisk), uptime: nonnegative(node.uptime),
  }));
}

export function clusterCpuPercent(nodes: PveNode[]): number {
  const total = nodes.reduce((sum, node) => sum + node.maxcpu, 0);
  return total ? Math.round(nodes.reduce((sum, node) => sum + node.cpu * node.maxcpu, 0) / total * 100) : 0;
}

export function aggregateRrd(series: { cores: number; points: PveRrdPoint[] }[]): PveRrdPoint[] {
  const values = new Map<number, PveRrdPoint & { cpuWeight: number; cpuSum: number }>();
  for (const { cores, points } of series) {
    for (const point of points) {
      if (!point || !finite(point.time) || point.time <= 0) continue;
      const row = values.get(point.time) || { time: point.time, cpuWeight: 0, cpuSum: 0 };
      if (finite(point.cpu) && cores > 0) { row.cpuSum += Math.max(0, Math.min(1, point.cpu)) * cores; row.cpuWeight += cores; }
      for (const metric of ['memused', 'memtotal', 'netin', 'netout'] as const) {
        if (finite(point[metric])) row[metric] = (row[metric] || 0) + Math.max(0, point[metric]);
      }
      values.set(point.time, row);
    }
  }
  return [...values.values()].sort((a, b) => a.time - b.time).map(({ cpuSum, cpuWeight, ...row }) => ({ ...row, ...(cpuWeight ? { cpu: cpuSum / cpuWeight } : {}) }));
}

async function readData(url: string, signal: AbortSignal) {
  const response = await apiFetch(url, { signal, maxRetries: 1 });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Proxmox request failed (HTTP ${response.status})`); }
  return (await response.json()).data;
}

export async function fetchDashboardData(timeframe: RrdTimeframe, signal: AbortSignal): Promise<DashboardData> {
  const [nodeData, resources] = await Promise.all([readData('/api/proxmox/nodes', signal), readData('/api/proxmox/cluster/resources', signal)]);
  const nodes = normalizeNodes(nodeData);
  if (!Array.isArray(resources)) throw new Error('Proxmox returned an invalid resource list');
  const online = nodes.filter((node) => node.status === 'online');
  const series: { cores: number; points: PveRrdPoint[] }[] = [];
  const rrdUnavailable: string[] = [];
  // Bound concurrency for larger clusters while keeping individual node history failures isolated.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, online.length) }, async () => {
    while (next < online.length && !signal.aborted) {
      const node = online[next++];
      try {
        const points = await readData(`/api/proxmox/nodes/${encodeURIComponent(node.node)}/rrddata?timeframe=${timeframe}&cf=AVERAGE`, signal);
        if (!Array.isArray(points)) throw new Error('Invalid RRD response');
        series.push({ cores: node.maxcpu, points });
      } catch (error) {
        if (signal.aborted) throw error;
        rrdUnavailable.push(node.node);
      }
    }
  }));
  if (signal.aborted) throw signal.reason;
  return { nodes, resources, rrd: aggregateRrd(series), rrdUnavailable };
}

export function useDashboardData() {
  const { refreshInterval } = useSettings();
  const { authenticated } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rrdTimeframe, setRrdTimeframe] = useState<RrdTimeframe>('hour');
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!authenticated || inFlight || controller.signal.aborted) return;
      inFlight = true;
      clearTimeout(timer);
      setLoading(true);
      try {
        const result = await fetchDashboardData(rrdTimeframe, controller.signal);
        if (!controller.signal.aborted) { setData(result); setError(null); }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load dashboard');
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (refreshInterval > 0) timer = setTimeout(() => { if (document.visibilityState !== 'hidden') void load(); }, refreshInterval * 1000);
        }
      }
    };
    refreshRef.current = () => void load();
    timer = setTimeout(() => { setData(current => current ? { ...current, rrd: [] } : current); void load(); }, 0);
    const visible = () => { if (document.visibilityState === 'visible' && refreshInterval > 0) void load(); };
    const completed = () => void load();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('proxmox-task-finished', completed);
    return () => { controller.abort(); clearTimeout(timer); refreshRef.current = () => {}; document.removeEventListener('visibilitychange', visible); window.removeEventListener('proxmox-task-finished', completed); };
  }, [authenticated, rrdTimeframe, refreshInterval]);
  return { data, error, loading, refresh, rrdTimeframe, setRrdTimeframe };
}
