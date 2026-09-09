"use client";

import { useMemo, useSyncExternalStore } from "react";
import Board, {
  type BoardProps,
} from "@cloudscape-design/board-components/board";
import BoardItem from "@cloudscape-design/board-components/board-item";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Table from "@cloudscape-design/components/table";
import Link from "@/app/components/app-link";
import Button from "@cloudscape-design/components/button";
import Spinner from "@cloudscape-design/components/spinner";
import Alert from "@cloudscape-design/components/alert";
import AreaChart from "@cloudscape-design/components/area-chart";
import Popover from "@cloudscape-design/components/popover";
import { useTranslation } from "@/app/lib/use-translation";
import { clusterCpuPercent, useDashboardData, type PveNode, type PveResource, type PveRrdPoint, type RrdTimeframe } from "@/app/lib/dashboard-data";

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function getStatusLabel(t: (key: string) => string, status: string) {
  if (status === "running") return t("common.running");
  if (status === "stopped") return t("common.stopped");
  if (status === "online") return t("common.online");
  if (status === "offline") return t("common.offline");
  if (status === "available") return t("common.available");
  return status;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.max(0, Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k))));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function pct(used: number, max: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / max) * 100)));
}

function ClusterOverviewContent({
  nodes,
  vms,
  containers,
}: {
  nodes: PveNode[];
  vms: PveResource[];
  containers: PveResource[];
}) {
  const { t } = useTranslation();
  const onlineNodes = nodes.filter((n) => n.status === "online").length;
  const runningVms = vms.filter((r) => r.status === "running").length;
  const runningCts = containers.filter((r) => r.status === "running").length;
  const totalCpu = nodes.reduce((s, n) => s + n.maxcpu, 0);
  const totalMem = nodes.reduce((s, n) => s + n.maxmem, 0);
  const usedMem = nodes.reduce((s, n) => s + n.mem, 0);

  return (
    <KeyValuePairs
      columns={3}
      items={[
        {
          label: (
            <SpaceBetween direction="horizontal" size="xxs">
              <span>Nodes</span>
              <Popover
                header={t("dashboard.nodes")}
                content={t("dashboard.nodesInfo")}
                triggerType="custom"
              >
                <Link variant="info">{t("common.info")}</Link>
              </Popover>
            </SpaceBetween>
          ),
          value: (
            <Link variant="awsui-value-large" href="/nodes">
              {onlineNodes} / {nodes.length}
            </Link>
          ),
        },
        {
          label: (
            <SpaceBetween direction="horizontal" size="xxs">
              <span>{t("dashboard.virtualMachines")}</span>
              <Popover
                header={t("nav.virtualMachines")}
                content={t("dashboard.virtualMachinesInfo")}
                triggerType="custom"
              >
                <Link variant="info">{t("common.info")}</Link>
              </Popover>
            </SpaceBetween>
          ),
          value: (
            <Link variant="awsui-value-large" href="/vms">
              {runningVms} / {vms.length}
            </Link>
          ),
        },
        {
          label: (
            <SpaceBetween direction="horizontal" size="xxs">
              <span>{t("dashboard.containers")}</span>
              <Popover
                header={t("dashboard.containers")}
                content={t("dashboard.containersInfo")}
                triggerType="custom"
              >
                <Link variant="info">{t("common.info")}</Link>
              </Popover>
            </SpaceBetween>
          ),
          value: (
            <Link variant="awsui-value-large" href="/containers">
              {runningCts} / {containers.length}
            </Link>
          ),
        },
        {
          label: t("common.cpuCores"),
          value: <Box variant="awsui-value-large">{totalCpu}</Box>,
        },
        {
          label: t("common.memory"),
          value: (
            <Box variant="awsui-value-large">
              {formatBytes(usedMem)}{" "}
              <Box variant="span" fontSize="body-s" color="text-body-secondary">
                / {formatBytes(totalMem)}
              </Box>
            </Box>
          ),
        },
        {
          label: t("common.clusterHealth"),
          value:
            nodes.length === 0 ? <StatusIndicator type="warning">{t("common.noDataAvailable")}</StatusIndicator> : onlineNodes === nodes.length ? (
              <StatusIndicator type="success">{t("common.allNodesOnline")}</StatusIndicator>
            ) : (
              <StatusIndicator type="warning">
                {interpolate(t("common.allNodesOfflineCount"), { count: nodes.length - onlineNodes })}
              </StatusIndicator>
            ),
        },
      ]}
    />
  );
}

function ResourceUsageContent({ nodes }: { nodes: PveNode[] }) {
  const { t } = useTranslation();
  const totalMem = nodes.reduce((s, n) => s + n.maxmem, 0);
  const usedMem = nodes.reduce((s, n) => s + n.mem, 0);
  const totalDisk = nodes.reduce((s, n) => s + n.maxdisk, 0);
  const usedDisk = nodes.reduce((s, n) => s + n.disk, 0);
  const avgCpu = clusterCpuPercent(nodes);

  const memPct = pct(usedMem, totalMem);
  const diskPct = pct(usedDisk, totalDisk);

  return (
    <ColumnLayout columns={3} variant="text-grid">
      <ProgressBar
        value={avgCpu}
        status={avgCpu > 80 ? "error" : "in-progress"}
        label={t("vms.cpu")}
        description={interpolate(t("dashboard.cpuTotalCores"), { count: nodes.reduce((s, n) => s + n.maxcpu, 0) })}
        additionalInfo={
          <StatusIndicator
            type={avgCpu > 80 ? "error" : avgCpu > 60 ? "warning" : "success"}
          >
            {interpolate(t("dashboard.avgAcrossNodes"), { percent: avgCpu, count: nodes.length })}
          </StatusIndicator>
        }
      />
      <ProgressBar
        value={memPct}
        status={memPct > 80 ? "error" : "in-progress"}
        label={t("common.memory")}
        description={interpolate(t("dashboard.totalAmount"), { value: formatBytes(totalMem) })}
        additionalInfo={
          <StatusIndicator
            type={memPct > 80 ? "error" : memPct > 60 ? "warning" : "success"}
          >
            {interpolate(t("dashboard.usedAmount"), { value: formatBytes(usedMem), percent: memPct })}
          </StatusIndicator>
        }
      />
      <ProgressBar
        value={diskPct}
        status={diskPct > 80 ? "error" : "in-progress"}
        label={t("common.localDisk")}
        description={interpolate(t("dashboard.totalAmount"), { value: formatBytes(totalDisk) })}
        additionalInfo={
          <StatusIndicator
            type={diskPct > 80 ? "error" : diskPct > 60 ? "warning" : "success"}
          >
            {interpolate(t("dashboard.usedAmount"), { value: formatBytes(usedDisk), percent: diskPct })}
          </StatusIndicator>
        }
      />
    </ColumnLayout>
  );
}

function CpuMemoryChartContent({
  rrd,
  timeframe,
  onTimeframeChange,
}: {
  rrd: PveRrdPoint[];
  timeframe: RrdTimeframe;
  onTimeframeChange: (tf: RrdTimeframe) => void;
}) {
  const { t } = useTranslation();
  const timeframeOptions: { value: RrdTimeframe; label: string }[] = [
    { value: "hour", label: t("common.hourShort") },
    { value: "day", label: t("common.dayShort") },
    { value: "week", label: t("common.weekShort") },
    { value: "month", label: t("common.monthShort") },
    { value: "year", label: t("common.yearShort") },
  ];

  const formatTime = (d: Date) => {
    if (timeframe === "hour" || timeframe === "day") {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const cpuData = rrd.filter((point) => Number.isFinite(point.cpu)).map((p) => ({
    x: new Date(p.time * 1000),
    y: Math.round((p.cpu ?? 0) * 1000) / 10,
  }));
  const memData = rrd.filter((point) => Number.isFinite(point.memused) && Number.isFinite(point.memtotal) && Number(point.memtotal) > 0).map((p) => ({
    x: new Date(p.time * 1000),
    y: p.memtotal ? Math.round(((p.memused ?? 0) / p.memtotal) * 1000) / 10 : 0,
  }));

  return (
    <SpaceBetween size="s">
      <SpaceBetween size="xs" direction="horizontal">
        {timeframeOptions.map((opt) => (
          <Button
            key={opt.value}
            variant={timeframe === opt.value ? "primary" : "normal"}
            onClick={() => onTimeframeChange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </SpaceBetween>
      <AreaChart
        height={200}
        fitHeight
        series={[
          { title: t("common.cpuPercent"), type: "area", data: cpuData },
          { title: `${t("common.memory")} %`, type: "area", data: memData },
        ]}
        xDomain={
          cpuData.length >= 2
            ? [cpuData[0].x, cpuData[cpuData.length - 1].x]
            : undefined
        }
        yDomain={[0, 100]}
        xScaleType="time"
        xTitle={t("common.time")}
        yTitle={t("common.usagePercent")}
        legendTitle={t("common.metrics")}
        i18nStrings={{
          xTickFormatter: (d) => formatTime(d as Date),
          yTickFormatter: (v) => `${v}%`,
          detailPopoverDismissAriaLabel: t("common.dismiss"),
          legendAriaLabel: t("common.legend"),
          chartAriaRoleDescription: t("common.areaChart"),
        }}
        ariaLabel={t("dashboard.cpuMemoryUsageOverTime")}
        empty={
          <Box textAlign="center" color="text-body-secondary">
            {t("common.noDataAvailable")}
          </Box>
        }
      />
    </SpaceBetween>
  );
}

function NetworkChartContent({
  rrd,
  timeframe,
}: {
  rrd: PveRrdPoint[];
  timeframe: RrdTimeframe;
}) {
  const { t } = useTranslation();
  const formatTime = (d: Date) => {
    if (timeframe === "hour" || timeframe === "day") {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const formatBps = (v: number) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB/s`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB/s`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB/s`;
    return `${v.toFixed(0)} B/s`;
  };

  const netInData = rrd.filter((point) => Number.isFinite(point.netin)).map((p) => ({
    x: new Date(p.time * 1000),
    y: p.netin ?? 0,
  }));
  const netOutData = rrd.filter((point) => Number.isFinite(point.netout)).map((p) => ({
    x: new Date(p.time * 1000),
    y: p.netout ?? 0,
  }));

  return (
    <AreaChart
      height={200}
      fitHeight
      series={[
        { title: t("common.inbound"), type: "area", data: netInData },
        { title: t("common.outbound"), type: "area", data: netOutData },
      ]}
      xDomain={
        netInData.length >= 2
          ? [netInData[0].x, netInData[netInData.length - 1].x]
          : undefined
      }
      xScaleType="time"
      xTitle={t("common.time")}
      yTitle={t("common.throughput")}
      legendTitle={t("common.traffic")}
      i18nStrings={{
        xTickFormatter: (d) => formatTime(d as Date),
        yTickFormatter: (v) => formatBps(Number(v)),
        detailPopoverDismissAriaLabel: t("common.dismiss"),
        legendAriaLabel: t("common.legend"),
        chartAriaRoleDescription: t("common.areaChart"),
      }}
      ariaLabel={t("dashboard.networkIoOverTime")}
      empty={
        <Box textAlign="center" color="text-body-secondary">
          {t("common.noNetworkData")}
        </Box>
      }
    />
  );
}


function NodeDetailsContent({ nodes }: { nodes: PveNode[] }) {
  const { t } = useTranslation();
  return (
    <Table
      enableKeyboardNavigation
      variant="borderless"
      resizableColumns
      items={nodes}
      columnDefinitions={[
        {
          id: "node",
          header: t("common.name"),
          cell: (n) => <Link href={`/nodes/${encodeURIComponent(n.node)}`}>{n.node}</Link>,
          isRowHeader: true,
        },
        {
          id: "status",
          header: t("common.status"),
          cell: (n) => (
            <StatusIndicator type={n.status === "online" ? "success" : "error"}>
              {getStatusLabel(t, n.status)}
            </StatusIndicator>
          ),
        },
        {
          id: "cpu",
          header: t("vms.cpu"),
          cell: (n) => n.status === "online" ? `${(n.cpu * 100).toFixed(1)}%` : "—",
        },
        {
          id: "mem",
          header: t("common.memory"),
          cell: (n) => n.status === "online" ? `${formatBytes(n.mem)} / ${formatBytes(n.maxmem)}` : "—",
        },
        {
          id: "disk",
          header: t("common.disk"),
          cell: (n) => n.status === "online" ? `${formatBytes(n.disk)} / ${formatBytes(n.maxdisk)}` : "—",
        },
        { id: "uptime", header: t("common.uptime"), cell: (n) => n.status === "online" ? formatUptime(n.uptime) : "—" },
      ]}
      empty={
        <Box textAlign="center" color="inherit">
          <Box
            padding={{ bottom: "s" }}
            variant="p"
            color="text-body-secondary"
          >
            {t("dashboard.noNodesFound")}
          </Box>
          <Button href="/api-explorer">{t("common.addNode")}</Button>
        </Box>
      }
    />
  );
}

function VmTableContent({ vms }: { vms: PveResource[] }) {
  const { t } = useTranslation();
  return (
    <Table
      enableKeyboardNavigation
      variant="borderless"
      resizableColumns
      items={vms.slice(0, 10)}
      columnDefinitions={[
        {
          id: "vmid",
          header: t("vms.vmid"),
          cell: (r) => <Link href={`/vms/${r.vmid}`}>{r.vmid}</Link>,
          isRowHeader: true,
        },
        { id: "name", header: t("common.name"), cell: (r) => r.name ?? "-" },
        { id: "node", header: t("vms.node"), cell: (r) => r.node },
        {
          id: "status",
          header: t("common.status"),
          cell: (r) => (
            <StatusIndicator
              type={
                r.status === "running"
                  ? "success"
                  : r.status === "stopped"
                    ? "stopped"
                    : "warning"
              }
            >
              {getStatusLabel(t, r.status)}
            </StatusIndicator>
          ),
        },
        {
          id: "cpu",
          header: t("vms.cpu"),
          cell: (r) =>
            r.cpu !== undefined ? `${(r.cpu * 100).toFixed(1)}%` : "-",
        },
        {
          id: "mem",
          header: t("vms.memory"),
          cell: (r) =>
            r.maxmem
              ? `${formatBytes(r.mem ?? 0)} / ${formatBytes(r.maxmem)}`
              : "-",
        },
      ]}
      empty={
        <Box textAlign="center" color="inherit">
          <Box
            padding={{ bottom: "s" }}
            variant="p"
            color="text-body-secondary"
          >
            {t("dashboard.noVirtualMachines")}
          </Box>
          <Button>{t("common.createInstance")}</Button>
        </Box>
      }
    />
  );
}

function ContainerTableContent({ containers }: { containers: PveResource[] }) {
  const { t } = useTranslation();
  return (
    <Table
      enableKeyboardNavigation
      variant="borderless"
      resizableColumns
      items={containers.slice(0, 10)}
      columnDefinitions={[
        {
          id: "vmid",
          header: t("containers.ctid"),
          cell: (r) => <Link href={`/containers/${r.vmid}`}>{r.vmid}</Link>,
          isRowHeader: true,
        },
        { id: "name", header: t("common.name"), cell: (r) => r.name ?? "-" },
        { id: "node", header: t("vms.node"), cell: (r) => r.node },
        {
          id: "status",
          header: t("common.status"),
          cell: (r) => (
            <StatusIndicator
              type={
                r.status === "running"
                  ? "success"
                  : r.status === "stopped"
                    ? "stopped"
                    : "warning"
              }
            >
              {getStatusLabel(t, r.status)}
            </StatusIndicator>
          ),
        },
        {
          id: "cpu",
          header: t("vms.cpu"),
          cell: (r) =>
            r.cpu !== undefined ? `${(r.cpu * 100).toFixed(1)}%` : "-",
        },
        {
          id: "mem",
          header: t("vms.memory"),
          cell: (r) =>
            r.maxmem
              ? `${formatBytes(r.mem ?? 0)} / ${formatBytes(r.maxmem)}`
              : "-",
        },
      ]}
      empty={
        <Box textAlign="center" color="inherit">
          <Box
            padding={{ bottom: "s" }}
            variant="p"
            color="text-body-secondary"
          >
            {t("dashboard.noContainers")}
          </Box>
          <Button>{t("common.createInstance")}</Button>
        </Box>
      }
    />
  );
}

function StorageContent({ resources }: { resources: PveResource[] }) {
  const { t } = useTranslation();
  const storages = resources.filter((r) => r.type === "storage");
  return (
    <Table
      enableKeyboardNavigation
      variant="borderless"
      resizableColumns
      items={storages.slice(0, 6)}
      columnDefinitions={[
        {
          id: "name",
          header: t("common.name"),
          cell: (r) => r.id?.replace("storage/", "") ?? "-",
          isRowHeader: true,
        },
        { id: "node", header: t("vms.node"), cell: (r) => r.node },
        {
          id: "status",
          header: t("common.status"),
          cell: (r) => (
            <StatusIndicator
              type={r.status === "available" ? "success" : "warning"}
            >
              {getStatusLabel(t, r.status)}
            </StatusIndicator>
          ),
        },
        {
          id: "usage",
          header: t("common.usage"),
          cell: (r) =>
            r.maxdisk ? (
              <ProgressBar
                value={pct(r.disk ?? 0, r.maxdisk)}
                additionalInfo={`${formatBytes(r.disk ?? 0)} / ${formatBytes(r.maxdisk)}`}
              />
            ) : (
              "-"
            ),
        },
      ]}
      empty={
        <Box textAlign="center" color="inherit">
          <Box
            padding={{ bottom: "s" }}
            variant="p"
            color="text-body-secondary"
          >
            {t("common.noStorageAvailable")}
          </Box>
          <Button href="/storage">{t("common.addStorage")}</Button>
        </Box>
      }
    />
  );
}

interface WidgetData {
  title: string;
  description: string;
  widgetId: string;
}

type DashboardItem = BoardProps.Item<WidgetData>;

const STORAGE_KEY = "pve-dashboard-layout";
let volatileLayout: string | null = null;

function getWidgetDescriptions(t: (key: string) => string): Record<string, string> {
  return {
    overview: t("dashboard.overviewWidgetDescription"),
    resources: t("dashboard.resourcesWidgetDescription"),
    "cpu-mem": t("dashboard.cpuMemoryWidgetDescription"),
    network: t("dashboard.networkWidgetDescription"),
    nodes: t("dashboard.nodesWidgetDescription"),
    vms: t("dashboard.vmsWidgetDescription"),
    containers: t("dashboard.containersWidgetDescription"),
    storage: t("dashboard.storageWidgetDescription"),
  };
}

function getDefaultItems(t: (key: string) => string): DashboardItem[] {
  return [
    {
      id: "overview",
      definition: { defaultRowSpan: 3, defaultColumnSpan: 4 },
      data: {
        title: t("dashboard.clusterOverview"),
        description: t("dashboard.summaryOfClusterResources"),
        widgetId: "overview",
      },
    },
    {
      id: "resources",
      definition: { defaultRowSpan: 3, defaultColumnSpan: 4 },
      data: {
        title: t("dashboard.resourceUsage"),
        description: t("dashboard.cpuMemoryDiskUsage"),
        widgetId: "resources",
      },
    },
    {
      id: "cpu-mem",
      definition: { defaultRowSpan: 4, defaultColumnSpan: 2, minRowSpan: 3 },
      data: {
        title: t("dashboard.cpuMemory"),
        description: t("dashboard.historicalCpuMemoryUsage"),
        widgetId: "cpu-mem",
      },
    },
    {
      id: "network",
      definition: { defaultRowSpan: 4, defaultColumnSpan: 2, minRowSpan: 3 },
      data: {
        title: t("dashboard.networkIo"),
        description: t("dashboard.networkThroughput"),
        widgetId: "network",
      },
    },
    {
      id: "nodes",
      definition: { defaultRowSpan: 3, defaultColumnSpan: 4 },
      data: {
        title: t("dashboard.nodes"),
        description: t("dashboard.nodeStatusAndResources"),
        widgetId: "nodes",
      },
    },
    {
      id: "vms",
      definition: { defaultRowSpan: 4, defaultColumnSpan: 2 },
      data: {
        title: t("dashboard.virtualMachines"),
        description: t("dashboard.vmListAndStatus"),
        widgetId: "vms",
      },
    },
    {
      id: "containers",
      definition: { defaultRowSpan: 4, defaultColumnSpan: 2 },
      data: {
        title: t("dashboard.containers"),
        description: t("dashboard.containerListAndStatus"),
        widgetId: "containers",
      },
    },
    {
      id: "storage",
      definition: { defaultRowSpan: 3, defaultColumnSpan: 4 },
      data: {
        title: t("dashboard.storage"),
        description: t("dashboard.storageUsage"),
        widgetId: "storage",
      },
    },
  ];
}

function readLayout(): string | null {
  if (volatileLayout !== null) return volatileLayout;
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function subscribeLayout(callback: () => void) {
  window.addEventListener("pve-layout-change", callback);
  const storage = (event: StorageEvent) => { if (!event.key || event.key === STORAGE_KEY) { volatileLayout = null; callback(); } };
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener("pve-layout-change", callback); window.removeEventListener("storage", storage); };
}
function saveLayout(items: DashboardItem[]) {
  const geometry = JSON.stringify(items.map(({ id, columnSpan, rowSpan }) => ({ id, columnSpan, rowSpan })));
  try { localStorage.setItem(STORAGE_KEY, geometry); volatileLayout = null; } catch { volatileLayout = geometry; }
  window.dispatchEvent(new Event("pve-layout-change"));
}
const serverLayout = () => null;

function getBoardI18n(t: (key: string) => string): BoardProps.I18nStrings<WidgetData> {
  return {
    liveAnnouncementDndStarted: (op) =>
      op === "resize" ? t("common.resizing") : t("common.dragging"),
    liveAnnouncementDndItemReordered: () => "",
    liveAnnouncementDndItemResized: () => "",
    liveAnnouncementDndItemInserted: () => "",
    liveAnnouncementDndCommitted: (op) => `${op} ${t("common.committed")}`,
    liveAnnouncementDndDiscarded: (op) => `${op} ${t("common.discarded")}`,
    liveAnnouncementItemRemoved: () => "",
    navigationAriaLabel: t("common.boardNavigation"),
    navigationAriaDescription: t("common.boardNavigationDescription"),
    navigationItemAriaLabel: (item) => item?.data?.title ?? t("common.widget"),
  };
}

function getBoardItemI18n(t: (key: string) => string) {
  return {
    dragHandleAriaLabel: t("common.dragHandle"),
    dragHandleAriaDescription: t("common.dragHandleDescription"),
    resizeHandleAriaLabel: t("common.resizeHandle"),
    resizeHandleAriaDescription: t("common.resizeHandleDescription"),
  };
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { data, error, loading, refresh, rrdTimeframe, setRrdTimeframe } =
    useDashboardData();
  const savedLayout = useSyncExternalStore(subscribeLayout, readLayout, serverLayout);
  const boardItems = useMemo(() => {
    const defaults = getDefaultItems(t);
    try {
      const saved: unknown = savedLayout ? JSON.parse(savedLayout) : null;
      if (!Array.isArray(saved)) return defaults;
      const seen = new Set<string>();
      return saved.flatMap(item => {
        const original = defaults.find(entry => entry.id === item?.id);
        if (!original || seen.has(original.id)) return [];
        seen.add(original.id);
        return [{ ...original, columnSpan: Number.isInteger(item.columnSpan) && item.columnSpan >= 1 && item.columnSpan <= 4 ? item.columnSpan : original.columnSpan, rowSpan: Number.isInteger(item.rowSpan) && item.rowSpan >= (original.definition?.minRowSpan ?? 1) && item.rowSpan <= 20 ? item.rowSpan : original.rowSpan }];
      });
    } catch { return defaults; }
  }, [savedLayout, t]);
  const widgetDescriptions = getWidgetDescriptions(t);
  const boardI18n = getBoardI18n(t);
  const boardItemI18n = getBoardItemI18n(t);

  const handleItemsChange: BoardProps<WidgetData>["onItemsChange"] = ({
    detail: { items },
  }) => {
    const mutable = [...items];
    saveLayout(mutable);
  };

  const handleResetLayout = () => {
    const defaults = getDefaultItems(t);
    saveLayout(defaults);
  };

  if (loading && !data) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("dashboard.dashboard")}</Header>
        <Box textAlign="center" padding={{ top: "xxxl" }}>
          <Spinner size="large" />
        </Box>
      </SpaceBetween>
    );
  }

  if (error && !data) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("dashboard.dashboard")}</Header>
        <Alert type="error" header={t("common.connectionError")} action={<Button onClick={refresh}>{t("common.refresh")}</Button>}>
          {error}
        </Alert>
      </SpaceBetween>
    );
  }

  if (!data) return null;
  const { nodes, resources, rrd } = data;
  const vms = resources.filter((r) => r.type === "qemu" && !r.template);
  const containers = resources.filter((r) => r.type === "lxc" && !r.template);

  function renderWidgetContent(widgetId: string) {
    switch (widgetId) {
      case "overview":
        return (
          <ClusterOverviewContent
            nodes={nodes}
            vms={vms}
            containers={containers}
          />
        );
      case "resources":
        return <ResourceUsageContent nodes={nodes} />;
      case "cpu-mem":
        return (
          <CpuMemoryChartContent
            rrd={rrd}
            timeframe={rrdTimeframe}
            onTimeframeChange={setRrdTimeframe}
          />
        );
      case "network":
        return <NetworkChartContent rrd={rrd} timeframe={rrdTimeframe} />;
      case "nodes":
        return <NodeDetailsContent nodes={nodes} />;
      case "vms":
        return <VmTableContent vms={vms} />;
      case "containers":
        return <ContainerTableContent containers={containers} />;
      case "storage":
        return <StorageContent resources={resources} />;
      default:
        return <Box>Unknown widget</Box>;
    }
  }

  return (
    <SpaceBetween size="m">
      <Header
        variant="h1"
        description={t("dashboard.overviewDescription")}
        actions={
          <SpaceBetween size="xs" direction="horizontal">
            <Button onClick={handleResetLayout}>{t("dashboard.resetLayout")}</Button>
            <Button iconName="refresh" ariaLabel={t("common.refresh")} onClick={refresh} loading={loading} />
          </SpaceBetween>
        }
      >
        {t("dashboard.dashboard")}
      </Header>
      {Boolean(error) && <Alert type="warning" header={t("common.connectionError")}>{error}</Alert>}
      {data.rrdUnavailable.length > 0 && <Alert type="warning">{t("common.noDataAvailable")}: {data.rrdUnavailable.join(", ")} (RRD)</Alert>}
      <Board
        items={boardItems}
        onItemsChange={handleItemsChange}
        i18nStrings={boardI18n}
        renderItem={(item) => (
          <BoardItem
            header={
              <Header
                variant="h2"
                info={
                <Popover
                  header={item.data.title}
                  content={widgetDescriptions[item.data.widgetId] ?? item.data.description}
                  triggerType="custom"
                >
                  <Link variant="info">{t("common.info")}</Link>
                </Popover>
              }
              >
                {item.data.title}
                {item.data.widgetId === "nodes" && ` (${nodes.length})`}
                {item.data.widgetId === "vms" && ` (${vms.length})`}
                {item.data.widgetId === "containers" &&
                  ` (${containers.length})`}
                {item.data.widgetId === "storage" &&
                  ` (${resources.filter((r) => r.type === "storage").length})`}
              </Header>
            }
            i18nStrings={boardItemI18n}
          >
            {renderWidgetContent(item.data.widgetId)}
          </BoardItem>
        )}
        empty={
          <Box textAlign="center" color="text-body-secondary" padding="xxl">
            {t("common.noWidgetsDashboard")}
          </Box>
        }
      />
    </SpaceBetween>
  );
}
