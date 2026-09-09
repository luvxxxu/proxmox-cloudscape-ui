"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";
import { syslogMessage } from "@/app/lib/resource-api";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Tabs, { type TabsProps } from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useTranslation } from "@/app/lib/use-translation";

interface NodeSummary {
  node: string;
  status: "online" | "offline" | "unknown";
}

interface TaskSummary {
  upid: string;
  node: string;
  type?: string;
  id?: string;
  user?: string;
  status?: string;
  starttime?: number;
  endtime?: number;
}

interface TaskLogLine {
  n?: number;
  t?: string;
}

interface SyslogEntry {
  n?: number;
  t?: number | string;
  time?: number | string;
  msg?: string;
  message?: string;
}

interface SyslogTableItem extends SyslogEntry {
  lineNumber: number;
}

interface TaskLogState {
  status: "loading" | "loaded" | "error";
  content: string;
}

interface TaskItem {
  rowType: "task";
  key: string;
  upid: string;
  node: string;
  type?: string;
  id?: string;
  user?: string;
  status?: string;
  starttime?: number;
  endtime?: number;
}

interface TaskLogItem {
  rowType: "log";
  key: string;
  parentKey: string;
  content: string;
  logStatus: TaskLogState["status"];
}

type TaskTableItem = TaskItem | TaskLogItem;

const TASK_LOG_LIMIT = 500;
const SYSLOG_PAGE_SIZE = 50;

function isTaskItem(item: TaskTableItem): item is TaskItem {
  return item.rowType === "task";
}

function formatDateTime(timestamp?: number | string) {
  if (timestamp == null || timestamp === "") {
    return "-";
  }

  const numericTimestamp = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (Number.isFinite(numericTimestamp)) {
    return new Date(numericTimestamp * 1000).toLocaleString();
  }

  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? String(timestamp) : parsed.toLocaleString();
}

function getTaskStatusIndicator(runningLabel: string, status?: string) {
  if (!status) {
    return { type: "in-progress" as const, label: runningLabel };
  }
  if (status.startsWith("OK")) {
    return { type: "success" as const, label: status };
  }
  return { type: "error" as const, label: status };
}

function formatTaskLog(lines: TaskLogLine[]) {
  if (lines.length === 0) {
    return "No task log output available.";
  }

  return lines.map((line) => line.t ?? "").join("\n");
}

function getSyslogMessage(entry: SyslogEntry) {
  return syslogMessage(entry);
}

function getSyslogLineNumber(entry: SyslogEntry, index: number, pageIndex: number) {
  if (typeof entry.n === "number") {
    return entry.n;
  }

  return (pageIndex - 1) * SYSLOG_PAGE_SIZE + index + 1;
}

async function fetchProxmox<T>(path: string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function LogsPage() {
  const { t } = useTranslation();
  const [activeTabId, setActiveTabId] = useState("tasks");
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [expandedTaskKeys, setExpandedTaskKeys] = useState<string[]>([]);
  const [taskLogs, setTaskLogs] = useState<Record<string, TaskLogState>>({});

  const [syslogEntries, setSyslogEntries] = useState<SyslogEntry[]>([]);
  const [syslogLoading, setSyslogLoading] = useState(false);
  const [syslogError, setSyslogError] = useState<string | null>(null);
  const [syslogPageIndex, setSyslogPageIndex] = useState(1);
  const [syslogHasMore, setSyslogHasMore] = useState(false);
  const syslogRequest = useRef<AbortController | null>(null);

  const loadNodesAndTasks = useCallback(async () => {
    try {
      setTasksLoading(true);

      const nodeData = await fetchProxmox<NodeSummary[]>("/api/proxmox/nodes");
      const nextNodes = nodeData ?? [];
      const onlineNodes = nextNodes.filter(({ status }) => status === "online");
      const taskGroups = await Promise.allSettled(
        onlineNodes.map(async ({ node }) => {
          const nodeTasks = await fetchProxmox<Omit<TaskSummary, "node">[]>(
            `/api/proxmox/nodes/${encodeURIComponent(node)}/tasks?limit=100&start=0`,
          );

          return (nodeTasks ?? []).map((task) => ({
            rowType: "task" as const,
            key: `${node}:${task.upid}`,
            node,
            upid: task.upid,
            type: task.type,
            id: task.id,
            user: task.user,
            status: task.status,
            starttime: task.starttime,
            endtime: task.endtime,
          }));
        }),
      );

      const mergedTasks = taskGroups.flatMap((result) => result.status === "fulfilled" ? result.value : [])
        .sort((a, b) => (b.starttime ?? 0) - (a.starttime ?? 0));
      const failures = taskGroups.flatMap((result, index) => result.status === "rejected"
        ? [`${onlineNodes[index].node}: ${result.reason instanceof Error ? result.reason.message : t("logs.failedToLoadTasks")}`] : []);

      setNodes(nextNodes);
      setTasks(mergedTasks);
      setExpandedTaskKeys((current) => current.filter((key) => mergedTasks.some((task) => task.key === key)));
      setSelectedNode((current) => {
        if (current && nextNodes.some((node) => node.node === current)) {
          return current;
        }
        return nextNodes[0]?.node ?? null;
      });
      setTasksError(failures.length ? failures.join("; ") : null);
    } catch (fetchError) {
      setTasksError(fetchError instanceof Error ? fetchError.message : t("logs.failedToLoadTasks"));
    } finally {
      setTasksLoading(false);
    }
  }, [t]);

  const loadTaskLog = useCallback(async (task: TaskItem) => {
    setTaskLogs((current) => ({
      ...current,
      [task.key]: {
        status: "loading",
        content: t("logs.loadingLog"),
      },
    }));

    try {
      const lines = await fetchProxmox<TaskLogLine[]>(
        `/api/proxmox/nodes/${encodeURIComponent(task.node)}/tasks/${encodeURIComponent(task.upid)}/log?limit=${TASK_LOG_LIMIT}`,
      );

      setTaskLogs((current) => ({
        ...current,
        [task.key]: {
          status: "loaded",
          content: formatTaskLog(lines ?? []),
        },
      }));
    } catch (fetchError) {
      setTaskLogs((current) => ({
        ...current,
        [task.key]: {
          status: "error",
          content: fetchError instanceof Error ? fetchError.message : t("logs.logUnavailable"),
        },
      }));
    }
  }, [t]);

  const loadSyslog = useCallback(async (node: string, pageIndex: number) => {
    syslogRequest.current?.abort();
    const controller = new AbortController();
    syslogRequest.current = controller;
    try {
      setSyslogLoading(true);

      const start = (pageIndex - 1) * SYSLOG_PAGE_SIZE;
      const entries = await fetchProxmox<SyslogEntry[]>(
        `/api/proxmox/nodes/${encodeURIComponent(node)}/syslog?limit=${SYSLOG_PAGE_SIZE}&start=${start}`,
        { signal: controller.signal },
      );

      if (controller.signal.aborted) return;
      const nextEntries = entries ?? [];
      setSyslogEntries(nextEntries);
      setSyslogHasMore(nextEntries.length === SYSLOG_PAGE_SIZE);
      setSyslogError(null);
    } catch (fetchError) {
      if (controller.signal.aborted) return;
      setSyslogEntries([]);
      setSyslogHasMore(false);
      setSyslogError(fetchError instanceof Error ? fetchError.message : t("logs.failedToLoadSyslog"));
    } finally {
      if (!controller.signal.aborted) setSyslogLoading(false);
    }
  }, [t]);

  useEffect(() => () => syslogRequest.current?.abort(), []);

  useResourceTaskRefresh(loadNodesAndTasks);

  useEffect(() => {
    void loadNodesAndTasks();
  }, [loadNodesAndTasks]);

  useEffect(() => {
    if (!selectedNode) {
      syslogRequest.current?.abort();
      setSyslogEntries([]);
      setSyslogError(null);
      setSyslogHasMore(false);
      return;
    }

    void loadSyslog(selectedNode, syslogPageIndex);
  }, [loadSyslog, selectedNode, syslogPageIndex]);

  const nodeOptions = useMemo<SelectProps.Options>(
    () => nodes.map((node) => ({ label: node.node, value: node.node, description: node.status })),
    [nodes],
  );

  const selectedNodeOption = useMemo(
    () => nodeOptions.find((option) => option.value === selectedNode) ?? null,
    [nodeOptions, selectedNode],
  );

  const taskColumns = useMemo<TableProps<TaskTableItem>["columnDefinitions"]>(
    () => [
      {
        id: "starttime",
        header: t("logs.startTime"),
        cell: (item) => {
          if (item.rowType === "log") {
            return (
              <Box padding={{ vertical: "s" }}>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}>
                  <code>{item.content}</code>
                </pre>
              </Box>
            );
          }

          return formatDateTime(item.starttime);
        },
        sortingComparator: (a, b) => {
          if (!isTaskItem(a) || !isTaskItem(b)) {
            return 0;
          }
          return (a.starttime ?? 0) - (b.starttime ?? 0);
        },
        isRowHeader: true,
        minWidth: 220,
      },
      {
        id: "endtime",
        header: t("logs.endTime"),
        cell: (item) => (isTaskItem(item) ? formatDateTime(item.endtime) : null),
        sortingComparator: (a, b) => {
          if (!isTaskItem(a) || !isTaskItem(b)) {
            return 0;
          }
          return (a.endtime ?? 0) - (b.endtime ?? 0);
        },
        minWidth: 220,
      },
      {
        id: "node",
        header: t("vms.node"),
        cell: (item) => (isTaskItem(item) ? item.node : null),
        sortingField: "node",
        minWidth: 140,
      },
      {
        id: "type",
        header: t("logs.type"),
        cell: (item) => (isTaskItem(item) ? item.type ?? "-" : null),
        sortingField: "type",
        minWidth: 160,
      },
      {
        id: "id",
        header: t("logs.id"),
        cell: (item) => (isTaskItem(item) ? item.id ?? "-" : null),
        sortingField: "id",
        minWidth: 140,
      },
      {
        id: "user",
        header: t("logs.user"),
        cell: (item) => (isTaskItem(item) ? item.user ?? "-" : null),
        sortingField: "user",
        minWidth: 180,
      },
      {
        id: "status",
        header: t("common.status"),
        cell: (item) => {
          if (!isTaskItem(item)) {
            if (item.logStatus === "loading") {
              return <StatusIndicator type="loading">{t("logs.loadingLog")}</StatusIndicator>;
            }
            if (item.logStatus === "error") {
              return <StatusIndicator type="error">{t("logs.logUnavailable")}</StatusIndicator>;
            }
            return <StatusIndicator type="info">{t("logs.taskLog")}</StatusIndicator>;
          }

          const indicator = getTaskStatusIndicator(t("common.running"), item.status);
          return <StatusIndicator type={indicator.type}>{indicator.label}</StatusIndicator>;
        },
        sortingComparator: (a, b) => {
          if (!isTaskItem(a) || !isTaskItem(b)) {
            return 0;
          }
          return (a.status ?? "").localeCompare(b.status ?? "");
        },
        minWidth: 180,
      },
    ],
    [t],
  );

  const taskEmptyState = (
    <Box textAlign="center" color="text-body-secondary" padding="xxl">
      {t("logs.noTaskHistory")}
    </Box>
  );

  const taskNoMatch = (
    <Box textAlign="center" color="text-body-secondary" padding="xxl">
      {t("logs.noTasksMatch")}
    </Box>
  );

  const {
    items: taskItems,
    collectionProps: taskCollectionProps,
    filterProps: taskFilterProps,
    filteredItemsCount: filteredTaskCount,
    paginationProps: taskPaginationProps,
  } = useCollection<TaskTableItem>(tasks, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        if (!isTaskItem(item)) {
          return false;
        }

        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [
          formatDateTime(item.starttime),
          formatDateTime(item.endtime),
          item.node,
          item.type ?? "",
          item.id ?? "",
          item.user ?? "",
          item.status ?? t("common.running"),
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: taskEmptyState,
      noMatch: taskNoMatch,
    },
    sorting: {
      defaultState: {
        sortingColumn: taskColumns[0],
        isDescending: true,
      },
    },
    pagination: {
      pageSize: 20,
    },
  });

  const expandedTaskItems = useMemo(
    () => taskItems.filter((item): item is TaskItem => isTaskItem(item) && expandedTaskKeys.includes(item.key)),
    [expandedTaskKeys, taskItems],
  );

  const syslogTableItems = useMemo<SyslogTableItem[]>(
    () =>
      syslogEntries.map((entry, index) => ({
        ...entry,
        lineNumber: getSyslogLineNumber(entry, index, syslogPageIndex),
      })),
    [syslogEntries, syslogPageIndex],
  );

  const syslogColumns = useMemo<TableProps<SyslogTableItem>["columnDefinitions"]>(
    () => [
      {
        id: "n",
        header: t("logs.lineNumber"),
        cell: (item) => item.lineNumber,
        sortingComparator: (a, b) => a.lineNumber - b.lineNumber,
        isRowHeader: true,
        minWidth: 140,
      },
      {
        id: "message",
        header: t("logs.message"),
        cell: (item) => getSyslogMessage(item),
        minWidth: 500,
      },
    ],
    [t],
  );

  const syslogEmptyState = (
    <Box textAlign="center" color="text-body-secondary" padding="xxl">
      {selectedNode ? t("logs.noSyslogEntries") : t("logs.selectNodeForSyslog")}
    </Box>
  );

  const syslogNoMatch = (
    <Box textAlign="center" color="text-body-secondary" padding="xxl">
      {t("logs.noSyslogMatch")}
    </Box>
  );

  const {
    items: filteredSyslogItems,
    filterProps: syslogFilterProps,
    filteredItemsCount: filteredSyslogCount,
  } = useCollection(syslogTableItems, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [String(item.lineNumber), getSyslogMessage(item)].some((value) =>
          value.toLowerCase().includes(query),
        );
      },
      empty: syslogEmptyState,
      noMatch: syslogNoMatch,
    },
  });

  const taskHeaderCounter = filteredTaskCount === undefined ? `(${tasks.length})` : `(${filteredTaskCount}/${tasks.length})`;
  const syslogHeaderCounter = selectedNode
    ? filteredSyslogCount === undefined
      ? `(${syslogEntries.length})`
      : `(${filteredSyslogCount}/${syslogEntries.length})`
    : undefined;

  const handleRefresh = useCallback(async () => {
    await loadNodesAndTasks();
    if (selectedNode) {
      await loadSyslog(selectedNode, syslogPageIndex);
    }
  }, [loadNodesAndTasks, loadSyslog, selectedNode, syslogPageIndex]);

  const handleTaskExpansion = useCallback(
    (item: TaskItem, expanded: boolean) => {
      setExpandedTaskKeys((current) => {
        if (expanded) {
          return current.includes(item.key) ? current : [...current, item.key];
        }
        return current.filter((key) => key !== item.key);
      });

      if (expanded && !taskLogs[item.key]) {
        void loadTaskLog(item);
      }
    },
    [loadTaskLog, taskLogs],
  );

  const tabs: TabsProps.Tab[] = [
    {
      id: "tasks",
      label: t("logs.tasks"),
      content: (
        <SpaceBetween size="m">
          {tasksError ? (
            <Alert type="error" header={t("logs.failedToLoadTasks")}>
              {tasksError}
            </Alert>
          ) : null}
          <Table<TaskTableItem>
            {...taskCollectionProps}
            items={taskItems}
            trackBy="key"
            variant="full-page"
            loading={tasksLoading}
            loadingText={t("logs.loadingTasks")}
            columnDefinitions={taskColumns}
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            empty={taskFilterProps.filteringText ? taskNoMatch : taskEmptyState}
            header={
              <Header counter={taskHeaderCounter} description={t("logs.clickToExpand")}>
                {t("logs.tasks")}
              </Header>
            }
            filter={
              <TextFilter
                {...taskFilterProps}
                filteringPlaceholder={t("logs.findTasks")}
                countText={`${filteredTaskCount ?? tasks.length} ${t("common.matches")}`}
              />
            }
            pagination={<Pagination {...taskPaginationProps} />}
            onRowClick={({ detail }) => {
              if (isTaskItem(detail.item)) {
                handleTaskExpansion(detail.item, !expandedTaskKeys.includes(detail.item.key));
              }
            }}
            expandableRows={{
              getItemChildren: (item) => {
                if (!isTaskItem(item) || !expandedTaskKeys.includes(item.key)) {
                  return [];
                }

                const logState = taskLogs[item.key] ?? {
                  status: "loading" as const,
                  content: t("logs.loadingLog"),
                };

                return [
                  {
                    rowType: "log" as const,
                    key: `${item.key}:log`,
                    parentKey: item.key,
                    content: logState.content,
                    logStatus: logState.status,
                  },
                ];
              },
              isItemExpandable: isTaskItem,
              expandedItems: expandedTaskItems,
              onExpandableItemToggle: ({ detail }) => {
                if (isTaskItem(detail.item)) {
                  handleTaskExpansion(detail.item, detail.expanded);
                }
              },
            }}
          />
        </SpaceBetween>
      ),
    },
    {
      id: "syslog",
      label: t("logs.systemLog"),
      content: (
        <SpaceBetween size="m">
          <FormField label={t("vms.node")}>
            <Select
              selectedOption={selectedNodeOption}
              options={nodeOptions}
              placeholder={t("logs.chooseNode")}
              selectedAriaLabel="Selected"
              onChange={({ detail }) => {
                setSelectedNode(detail.selectedOption.value ?? null);
                setSyslogPageIndex(1);
              }}
            />
          </FormField>
          {syslogError ? (
            <Alert type="error" header={t("logs.failedToLoadSyslog")}>
              {syslogError}
            </Alert>
          ) : null}
          <Table<SyslogTableItem>
            items={filteredSyslogItems}
            trackBy={(item) => String(item.n ?? `${item.lineNumber}-${item.t ?? item.time ?? ""}-${getSyslogMessage(item)}`)}
            variant="full-page"
            loading={syslogLoading}
            loadingText={t("logs.loadingSystemLog")}
            columnDefinitions={syslogColumns}
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            empty={syslogFilterProps.filteringText ? syslogNoMatch : syslogEmptyState}
            header={
              <Header
                counter={syslogHeaderCounter}
                description={
                  selectedNode
                    ? t("logs.showingPage").replace("{page}", String(syslogPageIndex)).replace("{node}", selectedNode)
                    : undefined
                }
              >
                {t("logs.systemLog")}
              </Header>
            }
            filter={
              <TextFilter
                {...syslogFilterProps}
                filteringPlaceholder={t("logs.searchSystemLog")}
                countText={`${filteredSyslogCount ?? syslogEntries.length} ${t("common.matches")}`}
              />
            }
            pagination={
              selectedNode ? (
                <Pagination
                  currentPageIndex={syslogPageIndex}
                  pagesCount={Math.max(syslogPageIndex + (syslogHasMore ? 1 : 0), 1)}
                  openEnd={syslogHasMore}
                  disabled={syslogLoading}
                  onChange={({ detail }) => setSyslogPageIndex(detail.currentPageIndex)}
                />
              ) : undefined
            }
          />
        </SpaceBetween>
      ),
    },
  ];

  return (
    <SpaceBetween size="m">
      <Header
        variant="h1"
        actions={<Button iconName="refresh" onClick={() => void handleRefresh()}>{t("common.refresh")}</Button>}
      >
        {t("logs.logs")}
      </Header>
      <Tabs tabs={tabs} activeTabId={activeTabId} onChange={({ detail }) => setActiveTabId(detail.activeTabId)} />
    </SpaceBetween>
  );
}
