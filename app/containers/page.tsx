"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";
import { GuestPowerConfirmation, type GuestPowerAction } from "@/app/lib/guest-power-confirmation";
import { useSettings } from "@/app/components/settings-context";

import { formatResourceBytes as formatBytes } from "@/app/lib/resource-api";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/app/components/notifications";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@/app/components/app-link";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import type { CollectionPreferencesProps } from "@cloudscape-design/components/collection-preferences";
import { useTranslation } from "@/app/lib/use-translation";

interface PveContainer {
  vmid: number;
  template?: number;
  name?: string;
  status: "running" | "stopped";
  node: string;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
}

interface Preferences {
  pageSize: number;
  wrapLines: boolean;
  stripedRows: boolean;
  contentDensity: "comfortable" | "compact";
  contentDisplay: ReadonlyArray<CollectionPreferencesProps.ContentDisplayItem>;
}

const DEFAULT_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "vmid", visible: true },
    { id: "name", visible: true },
    { id: "node", visible: true },
    { id: "status", visible: true },
    { id: "cpu", visible: true },
    { id: "memory", visible: true },
    { id: "disk", visible: true },
    { id: "uptime", visible: true },
  ],
};



function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getStatusType(status: PveContainer["status"]) {
  return status === "running" ? "success" : "stopped";
}

function getStatusLabel(t: (key: string) => string, status: PveContainer["status"]) {
  return status === "running" ? t("common.running") : t("common.stopped");
}

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

async function fetchProxmox<T>(path: string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function ContainersPage() {
  const router = useRouter();
  const { confirmPowerActions } = useSettings();
  const [pendingPowerAction, setPendingPowerAction] = useState<GuestPowerAction | null>(null);
  const { t } = useTranslation();
  const { addError, trackTask } = useNotifications();
  const [containers, setContainers] = useState<PveContainer[]>([]);
  const [selectedItems, setSelectedItems] = useState<PveContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<GuestPowerAction | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const loadContainers = useCallback(async () => {
    try {
      setLoading(true);
      const resources = await fetchProxmox<Array<PveContainer & { type: string }>>("/api/proxmox/cluster/resources?type=vm");
      const merged = (resources ?? []).filter((guest) => guest.type === "lxc").sort((a, b) => a.vmid - b.vmid);

      setContainers(merged);
      setSelectedItems((current) => {
        const vmids = new Set(merged.map((container) => container.vmid));
        return current
          .filter((container) => vmids.has(container.vmid))
          .map((container) => merged.find((item) => item.vmid === container.vmid) ?? container);
      });
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("containers.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useResourceTaskRefresh(loadContainers);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadContainers();
  }, [loadContainers]);

  const hasSelection = selectedItems.length > 0;
  const allStopped = hasSelection && selectedItems.every((container) => container.status === "stopped");
  const allRunning = hasSelection && selectedItems.every((container) => container.status === "running");
  const canStart = allStopped && selectedItems.every((guest) => guest.template !== 1) && !actionLoading;
  const canStop = allRunning && !actionLoading;
  const canReboot = allRunning && !actionLoading;
  const canDelete = allStopped && !actionLoading;
  const canOpenConsole = selectedItems.length === 1 && selectedItems[0]?.status === "running" && !actionLoading;

  const runPowerAction = useCallback(async (action: GuestPowerAction) => {
    if (!selectedItems.length) return;
    setActionLoading(action);
    const results = await Promise.allSettled(selectedItems.map(async (container) => {
      const upid = await fetchProxmox<string>(`/api/proxmox/nodes/${encodeURIComponent(container.node)}/lxc/${container.vmid}/status/${action}`, { method: "POST" });
      if (upid) trackTask(upid, container.node, `${action} ${container.vmid}`);
    }));
    const failures = results.flatMap((result, index) => result.status === "rejected" ? [`${selectedItems[index].vmid}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
    if (failures.length) addError(failures.join("; "));
    setPendingPowerAction(null);
    await loadContainers();
    setActionLoading(null);
  }, [selectedItems, trackTask, addError, loadContainers]);

  const requestPowerAction = (action: GuestPowerAction) => {
    if (!confirmPowerActions && action !== "stop") void runPowerAction(action);
    else setPendingPowerAction(action);
  };

  const deleteConfirmPhrase = selectedItems.length === 1
    ? (selectedItems[0].name || String(selectedItems[0].vmid))
    : t("common.delete");

  const handleOpenDelete = () => {
    setDeleteConfirmText("");
    setShowDeleteConfirm(true);
  };

  const handleCloseDelete = () => {
    setShowDeleteConfirm(false);
    setDeleteConfirmText("");
  };

  const runDelete = useCallback(async () => {
    if (selectedItems.length === 0 || deleteConfirmText !== deleteConfirmPhrase) return;

    try {
      setActionLoading("delete");
      const results = await Promise.allSettled(selectedItems.map(async (container) => {
        const upid = await fetchProxmox<string>(`/api/proxmox/nodes/${encodeURIComponent(container.node)}/lxc/${container.vmid}`, { method: "DELETE" });
        if (upid) trackTask(upid, container.node, `Delete ${container.vmid}`);
      }));
      const failedItems = selectedItems.filter((_, index) => results[index].status === "rejected");
      if (failedItems.length) {
        for (const [index, result] of results.entries()) {
          if (result.status === "rejected") addError(`${selectedItems[index].vmid}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        }
        setSelectedItems(failedItems);
        await loadContainers();
        return;
      }

      setSelectedItems([]);
      setShowDeleteConfirm(false);
      await loadContainers();
    } catch (deleteError) {
      addError(deleteError instanceof Error ? deleteError.message : t("containers.failedToDelete"));
    } finally {
      setActionLoading(null);
    }
  }, [loadContainers, selectedItems, trackTask, addError, t, deleteConfirmText, deleteConfirmPhrase]);

  const columnDefinitions = useMemo<TableProps<PveContainer>["columnDefinitions"]>(
    () => [
      {
        id: "vmid",
        header: t("containers.ctid"),
        cell: ({ vmid }) => <Link href={`/containers/${vmid}`}>{vmid}</Link>,
        sortingField: "vmid",
        isRowHeader: true,
        minWidth: 120,
      },
      {
        id: "name",
        header: t("common.name"),
        cell: ({ name }) => name ?? "-",
        sortingField: "name",
        minWidth: 180,
      },
      {
        id: "node",
        header: t("vms.node"),
        cell: ({ node }) => node,
        sortingField: "node",
        minWidth: 160,
      },
      {
        id: "status",
        header: t("common.status"),
        cell: ({ status }) => <StatusIndicator type={getStatusType(status)}>{getStatusLabel(t, status)}</StatusIndicator>,
        sortingField: "status",
        minWidth: 140,
      },
      {
        id: "cpu",
        header: t("common.cpuPercent"),
        cell: ({ cpu }) => `${((cpu ?? 0) * 100).toFixed(1)}%`,
        sortingComparator: (a, b) => (a.cpu ?? 0) - (b.cpu ?? 0),
        minWidth: 120,
      },
      {
        id: "memory",
        header: t("common.memory"),
        cell: ({ mem, maxmem }) => `${formatBytes(mem ?? 0)} / ${formatBytes(maxmem ?? 0)}`,
        sortingComparator: (a, b) => (a.mem ?? 0) - (b.mem ?? 0),
        minWidth: 220,
      },
      {
        id: "disk",
        header: t("common.disk"),
        cell: ({ disk, maxdisk }) => `${formatBytes(disk ?? 0)} / ${formatBytes(maxdisk ?? 0)}`,
        sortingComparator: (a, b) => (a.disk ?? 0) - (b.disk ?? 0),
        minWidth: 220,
      },
      {
        id: "uptime",
        header: t("common.uptime"),
        cell: ({ uptime }) => formatUptime(uptime ?? 0),
        sortingComparator: (a, b) => (a.uptime ?? 0) - (b.uptime ?? 0),
        minWidth: 140,
      },
    ],
    [t],
  );

  const emptyState = (
    <Box textAlign="center" margin={{ vertical: "xs" }}>
      <SpaceBetween size="xxl">
        <div>
          <Box variant="strong">{t("containers.noContainers")}</Box>
          <Box color="text-body-secondary" margin={{ top: "xs" }}>
          {t("containers.noContainersAvailable")}
          </Box>
        </div>
         <Button onClick={() => router.push("/containers/create")}>{t("containers.createContainer")}</Button>
      </SpaceBetween>
    </Box>
  );

  const noMatchState = (
    <Box textAlign="center" margin={{ vertical: "xs" }}>
      <SpaceBetween size="xxl">
        <div>
          <Box variant="strong">{t("common.noMatches")}</Box>
          <Box color="text-body-secondary" margin={{ top: "xs" }}>
            {t("containers.noContainersMatch")}
          </Box>
        </div>
        {/* eslint-disable-next-line react-hooks/immutability -- Cloudscape calls this event handler only after useCollection has returned its actions. */}
        <Button onClick={() => actions.setFiltering("")}>{t("common.clearFilter")}</Button>
      </SpaceBetween>
    </Box>
  );

  const {
    actions,
    items,
    collectionProps,
    filterProps,
    filteredItemsCount,
    paginationProps,
  } = useCollection(containers, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return [
          String(item.vmid),
          item.name ?? "",
          item.node,
          item.status,
          `${((item.cpu ?? 0) * 100).toFixed(1)}%`,
          `${formatBytes(item.mem ?? 0)} / ${formatBytes(item.maxmem ?? 0)}`,
          `${formatBytes(item.disk ?? 0)} / ${formatBytes(item.maxdisk ?? 0)}`,
          formatUptime(item.uptime ?? 0),
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: emptyState,
      noMatch: noMatchState,
    },
    sorting: {
      defaultState: {
        sortingColumn: columnDefinitions[0],
      },
    },
    pagination: {
      pageSize: preferences.pageSize,
    },
    selection: {},
  });

  const headerCounter = filteredItemsCount === undefined ? `(${containers.length})` : `(${filteredItemsCount}/${containers.length})`;

  return (
    <SpaceBetween size="m">
      <GuestPowerConfirmation action={pendingPowerAction} guests={selectedItems} busy={actionLoading !== null} onDismiss={() => setPendingPowerAction(null)} onConfirm={() => { if (pendingPowerAction) void runPowerAction(pendingPowerAction); }} />
      <Modal
        visible={showDeleteConfirm}
        onDismiss={() => { if (!actionLoading) handleCloseDelete(); }}
        header={interpolate(t("containers.deleteContainersHeader"), { count: selectedItems.length, suffix: selectedItems.length > 1 ? "s" : "" })}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button disabled={!!actionLoading} variant="link" onClick={handleCloseDelete}>{t("common.cancel")}</Button>
               <Button
                 variant="normal"
                 loading={actionLoading === "delete"}
                 disabled={deleteConfirmText !== deleteConfirmPhrase}
                 onClick={() => void runDelete()}
               >
                 {t("common.delete")}
               </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Alert type="warning">
            {interpolate(t("containers.deleteWarning"), { suffix: selectedItems.length > 1 ? "s" : "" })}
          </Alert>
          <Box>
            {selectedItems.map((container) => (
              <Box key={container.vmid} variant="code" display="block" padding={{ vertical: "xxs" }}>
                {container.vmid} — {container.name ?? t("containers.unnamed")}
              </Box>
            ))}
          </Box>
          <FormField label={interpolate(t("containers.confirmDeletion"), { value: deleteConfirmPhrase })}>
            <Input
              value={deleteConfirmText}
              onChange={({ detail }) => setDeleteConfirmText(detail.value)}
              placeholder={deleteConfirmPhrase}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
      {error ? (
        <Alert type="error" header={t("containers.failedRequest")}>
          {error}
        </Alert>
      ) : null}
      <Table
        {...collectionProps}
        items={items}
        selectionType="multi"
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) => { if (!actionLoading) setSelectedItems(detail.selectedItems); }}
        isItemDisabled={() => actionLoading !== null}
        columnDefinitions={columnDefinitions}
        variant="full-page"
        stickyHeader
        stickyColumns={{ first: 1 }}
        resizableColumns
        enableKeyboardNavigation
        trackBy="vmid"
        loading={loading}
        loadingText={t("containers.loading")}
        empty={filterProps.filteringText ? noMatchState : emptyState}
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        columnDisplay={preferences.contentDisplay}
        header={
          <Header
            variant="h1"
            counter={headerCounter}
            description={t("containers.manageDescription")}
            actions={
              <SpaceBetween size="xs" direction="horizontal">
                <Button loading={actionLoading === "start"} disabled={!canStart} onClick={() => requestPowerAction("start")}>
                  {t("containers.start")}
                </Button>
                <Button loading={actionLoading === "shutdown"} disabled={!canStop} onClick={() => requestPowerAction("shutdown")}>
                  {t("nodeDetail.shutdown")}
                </Button>
                <Button loading={actionLoading === "stop"} disabled={!canStop} onClick={() => requestPowerAction("stop")}>
                  {t("containers.stop")}
                </Button>
                <Button loading={actionLoading === "reboot"} disabled={!canReboot} onClick={() => requestPowerAction("reboot")}>
                  {t("containers.reboot")}
                </Button>
                <Button disabled={!canOpenConsole} onClick={() => router.push(`/containers/${selectedItems[0]?.vmid}/console`)}>
                  {t("containers.console")}
                </Button>
                <Button loading={actionLoading === "delete"} disabled={!canDelete} onClick={handleOpenDelete}>
                  {t("containers.delete")}
                </Button>
                <Button iconName="refresh" ariaLabel={t("common.refresh")} disabled={!!actionLoading} onClick={() => void loadContainers()} />
                <Button variant="primary" disabled={!!actionLoading} onClick={() => router.push("/containers/create")}>
                  {t("containers.createContainer")}
                </Button>
              </SpaceBetween>
            }
          >
            {t("containers.containers")}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder={t("containers.findPlaceholder")}
            countText={`${filteredItemsCount ?? containers.length} ${t("common.matches")}`}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        preferences={
          <CollectionPreferences
            title={t("common.preferences")}
            confirmLabel={t("common.confirm")}
            cancelLabel={t("common.cancel")}
            preferences={preferences}
            onConfirm={({ detail }) =>
              setPreferences((current) => ({
                pageSize: detail.pageSize ?? current.pageSize,
                wrapLines: detail.wrapLines ?? current.wrapLines,
                stripedRows: detail.stripedRows ?? current.stripedRows,
                contentDensity: detail.contentDensity ?? current.contentDensity,
                contentDisplay: detail.contentDisplay ?? current.contentDisplay,
              }))
            }
            pageSizePreference={{
              title: t("common.pageSize"),
              options: [
                { value: 10, label: `10 ${t("containers.containersLabel")}` },
                { value: 20, label: `20 ${t("containers.containersLabel")}` },
                { value: 50, label: `50 ${t("containers.containersLabel")}` },
              ],
            }}
            wrapLinesPreference={{
              label: t("common.wrapLines"),
              description: t("common.wrapLines"),
            }}
            stripedRowsPreference={{
              label: t("common.stripedRows"),
              description: t("common.stripedRows"),
            }}
            contentDensityPreference={{
              label: t("common.contentDensity"),
              description: t("settings.tableDensityDescription"),
            }}
            contentDisplayPreference={{
              title: t("common.columnPreferences"),
              options: [
                { id: "vmid", label: t("containers.ctid"), alwaysVisible: true },
                { id: "name", label: t("common.name") },
                { id: "node", label: t("vms.node") },
                { id: "status", label: t("common.status") },
                { id: "cpu", label: t("common.cpuPercent") },
                { id: "memory", label: t("common.memory") },
                { id: "disk", label: t("common.disk") },
                { id: "uptime", label: t("common.uptime") },
              ],
            }}
          />
        }
      />
    </SpaceBetween>
  );
}
