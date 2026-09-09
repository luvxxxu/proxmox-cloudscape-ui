"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import type { CollectionPreferencesProps } from "@cloudscape-design/components/collection-preferences";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useNotifications } from "@/app/components/notifications";
import { useTranslation } from "@/app/lib/use-translation";
import { collectResourceResults, buildRestoreParameters, inferBackupGuestType, isStorageActive, isValidVmid, formatResourceBytes as formatBytes } from "@/app/lib/resource-api";

interface PveNode {
  node: string;
  status: "online" | "offline" | "unknown";
}

interface ClusterResource {
  vmid?: number;
  node?: string;
  name?: string;
  status?: string;
  type?: "qemu" | "lxc" | string;
  template?: number;
}

interface PveStorage {
  storage: string;
  node: string;
  content?: string;
  active?: number;
  status?: string;
}

interface PveBackupContent {
  volid: string;
  vmid?: number;
  ctime?: number;
  size?: number;
  format?: string;
  notes?: string;
  content?: string;
}

type GuestType = "qemu" | "lxc" | "unknown";

interface BackupRow {
  id: string;
  volid: string;
  vmid: number;
  node: string;
  storage: string;
  size?: number;
  ctime?: number;
  format: string;
  notes?: string;
  guestType: GuestType;
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
    { id: "volid", visible: true },
    { id: "vmid", visible: true },
    { id: "node", visible: true },
    { id: "storage", visible: true },
    { id: "size", visible: true },
    { id: "ctime", visible: true },
    { id: "format", visible: true },
    { id: "notes", visible: true },
    { id: "actions", visible: true },
  ],
};



function formatDateTime(timestamp?: number): string {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp * 1000).toLocaleString();
}

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function optionValue(option: SelectProps.Option | null) {
  return typeof option?.value === "string" ? option.value : "";
}

function parseStorageContent(content?: string) {
  return (content ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasStorageContent(storage: Pick<PveStorage, "content">, type: string) {
  return parseStorageContent(storage.content).includes(type);
}

function inferBackupFormat(volid: string, format?: string) {
  if (format) {
    return format;
  }

  const parts = volid.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "-";
}

async function fetchProxmox<T>(path: string, _t: (key: string) => string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function BackupsPage() {
  const { t } = useTranslation();
  const { trackTask } = useNotifications();
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [resources, setResources] = useState<ClusterResource[]>([]);
  const [storages, setStorages] = useState<PveStorage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const [createVisible, setCreateVisible] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [selectedResource, setSelectedResource] = useState<SelectProps.Option | null>(null);
  const [backupStorageSelection, setSelectedBackupStorage] = useState<SelectProps.Option | null>(null);
  const [compressionSelection, setSelectedCompression] = useState<SelectProps.Option | null>(null);
  const [backupModeSelection, setSelectedBackupMode] = useState<SelectProps.Option | null>(null);
  const [backupNotes, setBackupNotes] = useState("");

  const [restoreVisible, setRestoreVisible] = useState(false);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);
  const [backupToRestore, setBackupToRestore] = useState<BackupRow | null>(null);
  const [restoreStorageSelection, setSelectedRestoreStorage] = useState<SelectProps.Option | null>(null);
  const [restoreVmid, setRestoreVmid] = useState("");

  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [backupToDelete, setBackupToDelete] = useState<BackupRow | null>(null);

  const addFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashItems((current) => {
      const next = current.filter((entry) => entry.id !== item.id);
      return [item, ...next].slice(0, 5);
    });
  }, []);

  const dismissFlash = useCallback((id: string) => {
    setFlashItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const nodes = await fetchProxmox<PveNode[]>("/api/proxmox/nodes", t);
      const onlineNodes = (nodes ?? []).filter((node) => node.status === "online");

      const [clusterResources, nodeStorages] = await Promise.all([
        fetchProxmox<ClusterResource[]>("/api/proxmox/cluster/resources?type=vm", t),
        Promise.allSettled(
          onlineNodes.map(async ({ node }) => {
            const entries = await fetchProxmox<Omit<PveStorage, "node">[]>(`/api/proxmox/nodes/${node}/storage`, t);
            return (entries ?? []).map((entry) => ({ ...entry, node }));
          }),
        ),
      ]);

      const storageResult = collectResourceResults(nodeStorages, onlineNodes.map((node) => node.node));
      const mergedStorages = storageResult.values;
      const backupStorages = mergedStorages.filter(
        (storage) => isStorageActive(storage) && hasStorageContent(storage, "backup"),
      );

      const backupLists = await Promise.allSettled(
        backupStorages.map(async ({ node, storage }) => {
          const entries = await fetchProxmox<PveBackupContent[]>(
            `/api/proxmox/nodes/${node}/storage/${storage}/content?content=backup`,
            t,
          );

          return (entries ?? [])
            .filter((entry) => entry.content === "backup" || inferBackupGuestType(entry.volid) !== "unknown")
            .map((entry) => ({
              id: `${node}:${storage}:${entry.volid}`,
              volid: entry.volid,
              vmid: entry.vmid ?? 0,
              node,
              storage,
              size: entry.size,
              ctime: entry.ctime,
              format: inferBackupFormat(entry.volid, entry.format),
              notes: entry.notes,
              guestType: inferBackupGuestType(entry.volid),
            } satisfies BackupRow));
        }),
      );

      setResources(
        (clusterResources ?? [])
          .filter((resource) => resource.vmid !== undefined && resource.node && resource.type && resource.template !== 1)
          .sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0)),
      );
      setStorages(mergedStorages);
      const backupResult = collectResourceResults(backupLists, backupStorages.map((storage) => `${storage.node}/${storage.storage}`));
      setBackups(backupResult.values.sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0)));
      const failures = [...storageResult.errors, ...backupResult.errors];
      setError(failures.length ? failures.join("; ") : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("backups.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useResourceTaskRefresh(loadData);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadData();
  }, [loadData]);

  const resourceOptions = useMemo<SelectProps.Option[]>(() => {
    return resources.map((resource) => ({
      label: `${resource.vmid} · ${resource.name ?? t("backups.unnamedResource")}`,
      description: `${resource.node} · ${resource.type === "lxc" ? t("backups.container") : t("backups.virtualMachine")}`,
      value: JSON.stringify({
        vmid: resource.vmid,
        node: resource.node,
        type: resource.type,
        name: resource.name ?? "",
      }),
    }));
  }, [resources, t]);

  const compressionOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("backups.compressionNone"), value: "0" },
      { label: t("backups.compressionLzo"), value: "lzo" },
      { label: t("backups.compressionGzip"), value: "gzip" },
      { label: t("backups.compressionZstd"), value: "zstd" },
    ],
    [t],
  );

  const backupModeOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("backups.modeSnapshot"), value: "snapshot" },
      { label: t("backups.modeSuspend"), value: "suspend" },
      { label: t("backups.modeStop"), value: "stop" },
    ],
    [t],
  );

  const selectedCompression = compressionOptions.find((option) => option.value === compressionSelection?.value) ?? compressionOptions[3] ?? null;
  const selectedBackupMode = backupModeOptions.find((option) => option.value === backupModeSelection?.value) ?? backupModeOptions[0] ?? null;

  const selectedResourceData = useMemo(() => {
    const value = optionValue(selectedResource);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as { vmid: number; node: string; type: string; name: string };
    } catch {
      return null;
    }
  }, [selectedResource]);

  const createStorageOptions = useMemo<SelectProps.Option[]>(() => {
    if (!selectedResourceData?.node) {
      return [];
    }

    return storages
      .filter(
        (storage) => storage.node === selectedResourceData.node && isStorageActive(storage) && hasStorageContent(storage, "backup"),
      )
      .sort((a, b) => a.storage.localeCompare(b.storage))
      .map((storage) => ({
        label: storage.storage,
        description: storage.node,
        value: storage.storage,
      }));
  }, [selectedResourceData, storages]);

  const selectedBackupStorage = createStorageOptions.find((option) => option.value === backupStorageSelection?.value) ?? createStorageOptions[0] ?? null;

  const restoreStorageOptions = useMemo<SelectProps.Option[]>(() => {
    if (!backupToRestore) {
      return [];
    }

    const preferredContent = backupToRestore.guestType === "lxc" ? "rootdir" : "images";
    const matching = storages.filter(
      (storage) => storage.node === backupToRestore.node && isStorageActive(storage) && hasStorageContent(storage, preferredContent),
    );
    const optionsSource = matching;

    return optionsSource
      .sort((a, b) => a.storage.localeCompare(b.storage))
      .map((storage) => ({
        label: storage.storage,
        description: storage.node,
        value: storage.storage,
      }));
  }, [backupToRestore, storages]);

  const selectedRestoreStorage = restoreStorageOptions.find((option) => option.value === restoreStorageSelection?.value) ?? restoreStorageOptions[0] ?? null;

  const guestTypeLabel = useCallback((guestType: GuestType) => {
    if (guestType === "qemu") return t("backups.virtualMachine");
    if (guestType === "lxc") return t("backups.container");
    return t("backups.unknownType");
  }, [t]);

  const closeCreateModal = useCallback(() => {
    setCreateVisible(false);
    setSelectedResource(null);
    setSelectedBackupStorage(null);
    setSelectedCompression(null);
    setSelectedBackupMode(null);
    setBackupNotes("");
  }, []);

  const openRestoreModal = useCallback((backup: BackupRow) => {
    setBackupToRestore(backup);
    setSelectedRestoreStorage(null);
    setRestoreVmid(backup.vmid ? String(backup.vmid) : "");
    setRestoreVisible(true);
  }, []);

  const closeRestoreModal = useCallback(() => {
    setRestoreVisible(false);
    setBackupToRestore(null);
    setSelectedRestoreStorage(null);
    setRestoreVmid("");
  }, []);

  const openDeleteModal = useCallback((backup: BackupRow) => {
    setBackupToDelete(backup);
    setDeleteVisible(true);
  }, []);

  const closeDeleteModal = useCallback(() => {
    setDeleteVisible(false);
    setBackupToDelete(null);
  }, []);

  const handleCreateBackup = useCallback(async () => {
    if (!selectedResourceData) {
      addFlash({
        id: "backups-create-resource-error",
        type: "error",
        content: t("backups.resourceRequired"),
        dismissible: true,
        onDismiss: () => dismissFlash("backups-create-resource-error"),
      });
      return;
    }

    const storage = optionValue(selectedBackupStorage);
    if (!storage) {
      addFlash({
        id: "backups-create-storage-error",
        type: "error",
        content: t("backups.backupStorageRequired"),
        dismissible: true,
        onDismiss: () => dismissFlash("backups-create-storage-error"),
      });
      return;
    }

    try {
      setCreateSubmitting(true);

      const body = new URLSearchParams({
        vmid: String(selectedResourceData.vmid),
        storage,
        compress: optionValue(selectedCompression) || "zstd",
        mode: optionValue(selectedBackupMode) || "snapshot",
      });

      if (backupNotes.trim()) {
        body.set("notes-template", backupNotes.trim());
      }

      const upid = await fetchProxmox<string>(`/api/proxmox/nodes/${selectedResourceData.node}/vzdump`, t, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (upid) {
        trackTask(
          upid,
          selectedResourceData.node,
          interpolate(t("backups.backupTaskStarted"), { vmid: selectedResourceData.vmid }),
        );
      }

      addFlash({
        id: `backups-create-success-${selectedResourceData.vmid}`,
        type: "success",
        content: interpolate(t("backups.backupQueued"), { vmid: selectedResourceData.vmid }),
        dismissible: true,
        onDismiss: () => dismissFlash(`backups-create-success-${selectedResourceData.vmid}`),
      });

      closeCreateModal();
    } catch (submitError) {
      addFlash({
        id: "backups-create-failed",
        type: "error",
        content: submitError instanceof Error ? submitError.message : t("backups.failedToCreate"),
        dismissible: true,
        onDismiss: () => dismissFlash("backups-create-failed"),
      });
    } finally {
      setCreateSubmitting(false);
    }
  }, [
    addFlash,
    backupNotes,
    closeCreateModal,
    dismissFlash,
    selectedBackupMode,
    selectedBackupStorage,
    selectedCompression,
    selectedResourceData,
    t,
    trackTask,
  ]);

  const handleRestoreBackup = useCallback(async () => {
    if (!backupToRestore) {
      return;
    }

    const storage = optionValue(selectedRestoreStorage);
    if (!storage) {
      addFlash({
        id: "backups-restore-storage-error",
        type: "error",
        content: t("backups.restoreStorageRequired"),
        dismissible: true,
        onDismiss: () => dismissFlash("backups-restore-storage-error"),
      });
      return;
    }

    const nextVmid = restoreVmid.trim() || String(backupToRestore.vmid);
    if (!isValidVmid(nextVmid)) {
      addFlash({
        id: "backups-restore-vmid-error",
        type: "error",
        content: t("backups.invalidVmid"),
        dismissible: true,
        onDismiss: () => dismissFlash("backups-restore-vmid-error"),
      });
      return;
    }

    const path = backupToRestore.guestType === "lxc"
      ? `/api/proxmox/nodes/${backupToRestore.node}/lxc`
      : backupToRestore.guestType === "qemu"
        ? `/api/proxmox/nodes/${backupToRestore.node}/qemu`
        : "";

    if (!path) {
      addFlash({
        id: "backups-restore-type-error",
        type: "error",
        content: t("backups.unknownBackupType"),
        dismissible: true,
        onDismiss: () => dismissFlash("backups-restore-type-error"),
      });
      return;
    }

    try {
      setRestoreSubmitting(true);

      const body = buildRestoreParameters(backupToRestore.guestType, nextVmid, backupToRestore.volid, storage);

      const upid = await fetchProxmox<string>(path, t, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (upid) {
        trackTask(
          upid,
          backupToRestore.node,
          interpolate(t("backups.restoreTaskStarted"), { vmid: nextVmid }),
        );
      }

      addFlash({
        id: `backups-restore-success-${backupToRestore.id}`,
        type: "success",
        content: interpolate(t("backups.restoreQueued"), { vmid: nextVmid }),
        dismissible: true,
        onDismiss: () => dismissFlash(`backups-restore-success-${backupToRestore.id}`),
      });

      closeRestoreModal();
    } catch (restoreError) {
      addFlash({
        id: "backups-restore-failed",
        type: "error",
        content: restoreError instanceof Error ? restoreError.message : t("backups.failedToRestore"),
        dismissible: true,
        onDismiss: () => dismissFlash("backups-restore-failed"),
      });
    } finally {
      setRestoreSubmitting(false);
    }
  }, [
    addFlash,
    backupToRestore,
    closeRestoreModal,
    dismissFlash,
    restoreVmid,
    selectedRestoreStorage,
    t,
    trackTask,
  ]);

  const handleDeleteBackup = useCallback(async () => {
    if (!backupToDelete) {
      return;
    }

    try {
      setDeleteSubmitting(true);
      const upid = await fetchProxmox<string>(
        `/api/proxmox/nodes/${backupToDelete.node}/storage/${backupToDelete.storage}/content/${encodeURIComponent(backupToDelete.volid)}`,
        t,
        {
          method: "DELETE",
        },
      );

      if (upid) {
        trackTask(
          upid,
          backupToDelete.node,
          interpolate(t("backups.deleteTaskStarted"), { vmid: backupToDelete.vmid }),
        );
      }

      addFlash({
        id: `backups-delete-success-${backupToDelete.id}`,
        type: "success",
        content: interpolate(t("backups.deleteQueued"), { vmid: backupToDelete.vmid }),
        dismissible: true,
        onDismiss: () => dismissFlash(`backups-delete-success-${backupToDelete.id}`),
      });

      closeDeleteModal();
      await loadData();
    } catch (deleteError) {
      addFlash({
        id: "backups-delete-failed",
        type: "error",
        content: deleteError instanceof Error ? deleteError.message : t("backups.failedToDelete"),
        dismissible: true,
        onDismiss: () => dismissFlash("backups-delete-failed"),
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }, [addFlash, backupToDelete, closeDeleteModal, dismissFlash, loadData, t, trackTask]);

  const handleDownloadBackup = useCallback((backup: BackupRow) => {
    window.open(
      `/api/proxmox/nodes/${backup.node}/storage/${backup.storage}/content/${encodeURIComponent(backup.volid)}?download=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, []);

  const columnDefinitions = useMemo<TableProps<BackupRow>["columnDefinitions"]>(
    () => [
      {
        id: "volid",
        header: t("backups.volid"),
        cell: ({ volid }) => volid,
        sortingField: "volid",
        isRowHeader: true,
        minWidth: 260,
      },
      {
        id: "vmid",
        header: t("backups.vmid"),
        cell: ({ vmid, guestType }) => `${guestTypeLabel(guestType)} ${vmid}`,
        sortingComparator: (a, b) => a.vmid - b.vmid,
        minWidth: 120,
      },
      {
        id: "node",
        header: t("backups.node"),
        cell: ({ node }) => node,
        sortingField: "node",
        minWidth: 140,
      },
      {
        id: "storage",
        header: t("backups.storage"),
        cell: ({ storage }) => storage,
        sortingField: "storage",
        minWidth: 140,
      },
      {
        id: "size",
        header: t("backups.size"),
        cell: ({ size }) => formatBytes(size),
        sortingComparator: (a, b) => (a.size ?? 0) - (b.size ?? 0),
        minWidth: 140,
      },
      {
        id: "ctime",
        header: t("backups.dateTime"),
        cell: ({ ctime }) => formatDateTime(ctime),
        sortingComparator: (a, b) => (a.ctime ?? 0) - (b.ctime ?? 0),
        minWidth: 200,
      },
      {
        id: "format",
        header: t("backups.format"),
        cell: ({ format, guestType }) => (
          <SpaceBetween direction="horizontal" size="xs">
            <StatusIndicator type={guestType === "qemu" ? "success" : guestType === "lxc" ? "info" : "pending"}>
              {guestTypeLabel(guestType)}
            </StatusIndicator>
            <span>{format}</span>
          </SpaceBetween>
        ),
        sortingField: "format",
        minWidth: 220,
      },
      {
        id: "notes",
        header: t("backups.notes"),
        cell: ({ notes }) => notes?.trim() || t("backups.noNotes"),
        minWidth: 220,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (backup) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => openRestoreModal(backup)}>{t("backups.restore")}</Button>
            <Button onClick={() => openDeleteModal(backup)}>{t("common.delete")}</Button>
            <Button onClick={() => handleDownloadBackup(backup)}>{t("backups.download")}</Button>
          </SpaceBetween>
        ),
        minWidth: 280,
      },
    ],
    [guestTypeLabel, handleDownloadBackup, openDeleteModal, openRestoreModal, t],
  );

  const emptyState = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("backups.noBackups")}</b>
        <Box variant="p" color="inherit">
          {t("backups.noBackupsAvailable")}
        </Box>
        <Button onClick={() => void loadData()}>{t("common.refresh")}</Button>
      </SpaceBetween>
    </Box>
  );

  const noMatch = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("common.noMatches")}</b>
        <Box variant="p" color="inherit">
          {t("backups.noBackupsMatch")}
        </Box>
      </SpaceBetween>
    </Box>
  );

  const { actions, items, collectionProps, filterProps, filteredItemsCount, paginationProps } = useCollection(backups, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [
          item.volid,
          String(item.vmid),
          item.node,
          item.storage,
          formatBytes(item.size),
          formatDateTime(item.ctime),
          item.format,
          item.notes ?? "",
          guestTypeLabel(item.guestType),
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: emptyState,
      noMatch: (
        <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
          <SpaceBetween size="m">
            <b>{t("common.noMatches")}</b>
            <Box variant="p" color="inherit">
              {t("backups.noBackupsMatch")}
            </Box>
            {/* eslint-disable-next-line react-hooks/immutability -- Cloudscape calls this event handler only after useCollection has returned its actions. */}
            <Button onClick={() => actions.setFiltering("")}>{t("common.clearFilter")}</Button>
          </SpaceBetween>
        </Box>
      ),
    },
    sorting: {
      defaultState: {
        sortingColumn: columnDefinitions[5],
        isDescending: true,
      },
    },
    pagination: {
      pageSize: preferences.pageSize,
    },
  });

  const headerCounter = filterProps.filteringText ? `(${filteredItemsCount}/${backups.length})` : `(${backups.length})`;

  return (
    <SpaceBetween size="m">
      {flashItems.length > 0 ? <Flashbar items={flashItems.map((item) => ({ ...item, onDismiss: item.onDismiss ?? (() => dismissFlash(item.id ?? "")) }))} /> : null}
      {error ? (
        <Alert type="error" header={t("backups.failedToLoad")}>
          {error}
        </Alert>
      ) : null}
      <Table
        {...collectionProps}
        items={items}
        columnDefinitions={columnDefinitions}
        variant="full-page"
        stickyHeader
        stickyColumns={{ first: 1 }}
        resizableColumns
        enableKeyboardNavigation
        trackBy={(item) => item.id}
        loading={loading}
        loadingText={t("backups.loadingBackups")}
        empty={filterProps.filteringText ? noMatch : emptyState}
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        columnDisplay={preferences.contentDisplay}
        header={
          <Header
            variant="h1"
            counter={headerCounter}
            description={t("backups.manageDescription")}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="primary" onClick={() => setCreateVisible(true)}>{t("backups.createBackup")}</Button>
                <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
              </SpaceBetween>
            }
          >
            {t("backups.pageTitle")}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder={t("backups.findBackups")}
            countText={`${filteredItemsCount ?? backups.length} ${t("common.matches")}`}
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
                { value: 10, label: t("backups.backupsCount10") },
                { value: 20, label: t("backups.backupsCount20") },
                { value: 50, label: t("backups.backupsCount50") },
              ],
            }}
            wrapLinesPreference={{
              label: t("common.wrapLines"),
              description: t("backups.wrapLinesDesc"),
            }}
            stripedRowsPreference={{
              label: t("common.stripedRows"),
              description: t("backups.stripedRowsDesc"),
            }}
            contentDensityPreference={{
              label: t("common.contentDensity"),
              description: t("backups.contentDensityDesc"),
            }}
            contentDisplayPreference={{
              title: t("common.columnPreferences"),
              options: [
                { id: "volid", label: t("backups.volid"), alwaysVisible: true },
                { id: "vmid", label: t("backups.vmid") },
                { id: "node", label: t("backups.node") },
                { id: "storage", label: t("backups.storage") },
                { id: "size", label: t("backups.size") },
                { id: "ctime", label: t("backups.dateTime") },
                { id: "format", label: t("backups.format") },
                { id: "notes", label: t("backups.notes") },
                { id: "actions", label: t("common.actions") },
              ],
            }}
          />
        }
      />

      <Modal
        visible={createVisible}
        onDismiss={closeCreateModal}
        header={t("backups.createModalTitle")}
        closeAriaLabel={t("common.cancel")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={closeCreateModal} disabled={createSubmitting}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={() => void handleCreateBackup()} loading={createSubmitting}>
                {t("backups.createBackup")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box color="text-body-secondary">{t("backups.createModalDescription")}</Box>
          <FormField label={t("backups.selectResource")}>
            <Select
              selectedOption={selectedResource}
              onChange={({ detail }) => setSelectedResource(detail.selectedOption)}
              options={resourceOptions}
              placeholder={t("backups.selectResourcePlaceholder")}
              empty={t("backups.noResourcesAvailable")}
            />
          </FormField>
          <FormField label={t("backups.targetStorage")}>
            <Select
              selectedOption={selectedBackupStorage}
              onChange={({ detail }) => setSelectedBackupStorage(detail.selectedOption)}
              options={createStorageOptions}
              placeholder={selectedResourceData ? t("backups.selectBackupStoragePlaceholder") : t("backups.selectResourceFirst")}
              empty={t("backups.noBackupStorageAvailable")}
            />
          </FormField>
          <FormField label={t("backups.compressionMode")}>
            <Select
              selectedOption={selectedCompression}
              onChange={({ detail }) => setSelectedCompression(detail.selectedOption)}
              options={compressionOptions}
              placeholder={t("backups.selectCompressionPlaceholder")}
            />
          </FormField>
          <FormField label={t("backups.backupMode")}>
            <Select
              selectedOption={selectedBackupMode}
              onChange={({ detail }) => setSelectedBackupMode(detail.selectedOption)}
              options={backupModeOptions}
              placeholder={t("backups.selectBackupModePlaceholder")}
            />
          </FormField>
          <FormField label={t("backups.notesLabel")}>
            <Textarea
              value={backupNotes}
              onChange={({ detail }) => setBackupNotes(detail.value)}
              placeholder={t("backups.notesPlaceholder")}
              rows={3}
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={restoreVisible}
        onDismiss={closeRestoreModal}
        header={t("backups.restoreModalTitle")}
        closeAriaLabel={t("common.cancel")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={closeRestoreModal} disabled={restoreSubmitting}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={() => void handleRestoreBackup()} loading={restoreSubmitting}>
                {t("backups.restore")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box color="text-body-secondary">{t("backups.restoreModalDescription")}</Box>
          <FormField label={t("backups.selectedBackup")}>
            <Input value={backupToRestore?.volid ?? ""} disabled />
          </FormField>
          <FormField label={t("backups.targetStorage")}>
            <Select
              selectedOption={selectedRestoreStorage}
              onChange={({ detail }) => setSelectedRestoreStorage(detail.selectedOption)}
              options={restoreStorageOptions}
              placeholder={t("backups.selectRestoreStoragePlaceholder")}
              empty={t("backups.noRestoreStorageAvailable")}
            />
          </FormField>
          <FormField label={t("backups.newVmid")} description={t("backups.newVmidDescription")}>
            <Input
              value={restoreVmid}
              onChange={({ detail }) => setRestoreVmid(detail.value)}
              placeholder={t("backups.newVmidPlaceholder")}
              inputMode="numeric"
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={deleteVisible}
        onDismiss={closeDeleteModal}
        header={t("backups.deleteModalTitle")}
        closeAriaLabel={t("common.cancel")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={closeDeleteModal} disabled={deleteSubmitting}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={() => void handleDeleteBackup()} loading={deleteSubmitting}>
                {t("common.delete")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box>{t("backups.deleteConfirmation")}</Box>
          <FormField label={t("backups.selectedBackup")}>
            <Input value={backupToDelete?.volid ?? ""} disabled />
          </FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
