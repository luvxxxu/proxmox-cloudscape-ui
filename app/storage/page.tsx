"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";

import { collectResourceResults, formatResourceBytes as formatBytes, isStorageActive } from "@/app/lib/resource-api";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import type { CollectionPreferencesProps } from "@cloudscape-design/components/collection-preferences";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Toggle from "@cloudscape-design/components/toggle";
import { useNotifications } from "@/app/components/notifications";
import { useTranslation } from "@/app/lib/use-translation";

interface PveNode {
  node: string;
  status: "online" | "offline" | "unknown";
}

interface PveStorage {
  storage: string;
  node: string;
  type: string;
  content: string;
  active?: number;
  status?: string;
  total?: number;
  used?: number;
  avail?: number;
  used_fraction?: number;
}

type StorageType = "dir" | "nfs" | "cifs" | "lvm" | "lvmthin" | "zfspool";
type ContentType = "images" | "rootdir" | "vztmpl" | "iso" | "backup" | "snippets";

interface PveStorageConfig {
  storage: string;
  type: StorageType;
  content?: string;
  nodes?: string;
  disable?: boolean | number | string;
  path?: string;
  server?: string;
  export?: string;
  options?: string;
  share?: string;
  username?: string;
  domain?: string;
  vgname?: string;
  base?: string;
  thinpool?: string;
  pool?: string;
  blocksize?: string;
}

interface StorageFormState {
  storageId: string;
  type: StorageType | "";
  content: ContentType[];
  nodes: string;
  enabled: boolean;
  path: string;
  server: string;
  exportPath: string;
  nfsVersion: string;
  share: string;
  username: string;
  password: string;
  domain: string;
  volumeGroup: string;
  baseStorage: string;
  baseVolume: string;
  thinPool: string;
  pool: string;
  blocksize: string;
  nfsOptions: string;
}

interface Preferences {
  pageSize: number;
  wrapLines: boolean;
  stripedRows: boolean;
  contentDensity: "comfortable" | "compact";
  contentDisplay: ReadonlyArray<CollectionPreferencesProps.ContentDisplayItem>;
}

const ALL_CONTENT_TYPES: ContentType[] = ["images", "rootdir", "vztmpl", "iso", "backup", "snippets"];
const FILE_CONTENT_TYPES: ContentType[] = ["images", "rootdir", "vztmpl", "iso", "backup", "snippets"];
const BLOCK_CONTENT_TYPES: ContentType[] = ["images", "rootdir"];

const DEFAULT_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "storage", visible: true },
    { id: "node", visible: true },
    { id: "type", visible: true },
    { id: "content", visible: true },
    { id: "status", visible: true },
    { id: "total", visible: true },
    { id: "used", visible: true },
    { id: "avail", visible: true },
    { id: "usage", visible: true },
    { id: "actions", visible: true },
  ],
};



function formatUsage(value?: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 1000) / 10));
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



function getSupportedContentTypes(type: StorageType | "") {
  if (type === "dir" || type === "nfs" || type === "cifs") {
    return FILE_CONTENT_TYPES;
  }
  if (type === "lvm" || type === "lvmthin" || type === "zfspool") {
    return BLOCK_CONTENT_TYPES;
  }
  return [] as ContentType[];
}

function createDefaultForm(): StorageFormState {
  return {
    storageId: "",
    type: "",
    content: [],
    nodes: "",
    enabled: true,
    path: "",
    server: "",
    exportPath: "",
    nfsVersion: "",
    share: "",
    username: "",
    password: "",
    domain: "",
    volumeGroup: "",
    baseStorage: "",
    baseVolume: "",
    thinPool: "",
    pool: "",
    blocksize: "",
    nfsOptions: "",
  };
}

function normalizeContent(content?: string): ContentType[] {
  return (content ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is ContentType => ALL_CONTENT_TYPES.includes(entry as ContentType));
}

function parseNfsVersion(options?: string) {
  const match = options?.match(/(?:^|,)vers=(3|4|4\.1|4\.2)(?:,|$)/);
  return match?.[1] ?? "";
}

function removeNfsVersion(options?: string) {
  return (options ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith("vers="))
    .join(",");
}

function isDisabledValue(value: PveStorageConfig["disable"]) {
  return value === true || value === 1 || value === "1";
}

function storageConfigToForm(config: PveStorageConfig, summary: PveStorage): StorageFormState {
  const [baseStorage = "", baseVolume = ""] = (config.base ?? "").split(":", 2);

  return {
    storageId: config.storage ?? summary.storage,
    type: config.type ?? (summary.type as StorageType),
    content: normalizeContent(config.content ?? summary.content),
    nodes: config.nodes ?? "",
    enabled: !isDisabledValue(config.disable),
    path: config.path ?? "",
    server: config.server ?? "",
    exportPath: config.export ?? "",
    nfsVersion: parseNfsVersion(config.options),
    share: config.share ?? "",
    username: config.username ?? "",
    password: "",
    domain: config.domain ?? "",
    volumeGroup: config.vgname ?? "",
    baseStorage,
    baseVolume,
    thinPool: config.thinpool ?? "",
    pool: config.pool ?? "",
    blocksize: config.blocksize ?? "",
    nfsOptions: config.options ?? "",
  };
}

async function fetchProxmox<T>(path: string, _t: (key: string) => string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function StoragePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { addError, addSuccess } = useNotifications();

  const [storages, setStorages] = useState<PveStorage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);

  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingConfigId, setLoadingConfigId] = useState<string | null>(null);
  const [selectedStorage, setSelectedStorage] = useState<PveStorage | null>(null);
  const [form, setForm] = useState<StorageFormState>(createDefaultForm());

  const typeOptions = useMemo<ReadonlyArray<SelectProps.Option>>(
    () => [
      { label: t("storage.dirType"), value: "dir" },
      { label: t("storage.nfsType"), value: "nfs" },
      { label: t("storage.cifsType"), value: "cifs" },
      { label: t("storage.lvmType"), value: "lvm" },
      { label: t("storage.lvmthinType"), value: "lvmthin" },
      { label: t("storage.zfspoolType"), value: "zfspool" },
    ],
    [t],
  );

  const nfsVersionOptions = useMemo<ReadonlyArray<SelectProps.Option>>(
    () => [
      { label: "3", value: "3" },
      { label: "4", value: "4" },
      { label: "4.1", value: "4.1" },
      { label: "4.2", value: "4.2" },
    ],
    [],
  );

  const contentLabels = useMemo<Record<ContentType, string>>(
    () => ({
      images: t("storage.contentImages"),
      rootdir: t("storage.contentRootdir"),
      vztmpl: t("storage.contentVztmpl"),
      iso: t("storage.contentIso"),
      backup: t("storage.contentBackup"),
      snippets: t("storage.contentSnippets"),
    }),
    [t],
  );

  const selectedTypeOption = useMemo(
    () => typeOptions.find((option) => option.value === form.type) ?? null,
    [form.type, typeOptions],
  );

  const selectedNfsVersionOption = useMemo(
    () => nfsVersionOptions.find((option) => option.value === form.nfsVersion) ?? null,
    [form.nfsVersion, nfsVersionOptions],
  );

  const supportedContentTypes = useMemo(
    () => new Set<ContentType>(getSupportedContentTypes(form.type)),
    [form.type],
  );

  const loadStorages = useCallback(async () => {
    try {
      setLoading(true);
      const nodes = await fetchProxmox<PveNode[]>("/api/proxmox/nodes", t);
      const onlineNodes = (nodes ?? []).filter((node) => node.status === "online");
      const storageLists = await Promise.allSettled(
        onlineNodes.map(async ({ node }) => {
          const entries = await fetchProxmox<Omit<PveStorage, "node">[]>(`/api/proxmox/nodes/${node}/storage`, t);
          return (entries ?? []).map((entry) => ({ ...entry, node }));
        }),
      );
      const result = collectResourceResults(storageLists, onlineNodes.map((node) => node.node));
      setStorages(result.values);
      setError(result.errors.length ? result.errors.join("; ") : null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("storage.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useResourceTaskRefresh(loadStorages);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadStorages();
  }, [loadStorages]);

  const resetForm = useCallback(() => {
    setForm(createDefaultForm());
  }, []);

  const closeCreateModal = useCallback(() => {
    setCreateVisible(false);
    resetForm();
  }, [resetForm]);

  const closeEditModal = useCallback(() => {
    setEditVisible(false);
    setSelectedStorage(null);
    resetForm();
  }, [resetForm]);

  const closeDeleteModal = useCallback(() => {
    setDeleteVisible(false);
    setSelectedStorage(null);
  }, []);

  const setFormValue = useCallback(<K extends keyof StorageFormState>(key: K, value: StorageFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const handleTypeChange = useCallback((value: StorageType | "") => {
    const supported = new Set(getSupportedContentTypes(value));
    setForm((current) => ({
      ...current,
      type: value,
      content: current.content.filter((entry) => supported.has(entry)),
    }));
  }, []);

  const toggleContentType = useCallback((contentType: ContentType, checked: boolean) => {
    setForm((current) => ({
      ...current,
      content: checked
        ? [...current.content.filter((entry) => entry !== contentType), contentType]
        : current.content.filter((entry) => entry !== contentType),
    }));
  }, []);

  const runAction = useCallback(async (action: () => Promise<void>, fallbackKey: string) => {
    try {
      setSubmitting(true);
      await action();
    } catch (actionError) {
      addError(actionError instanceof Error ? actionError.message : t(fallbackKey));
    } finally {
      setSubmitting(false);
    }
  }, [addError, t]);

  const buildStoragePayload = useCallback((mode: "create" | "edit") => {
    const storageId = form.storageId.trim();
    const type = form.type;
    const nodes = form.nodes.trim();
    const content = form.content.join(",");

    if (mode === "create" && !storageId) {
      throw new Error(t("storage.storageIdRequired"));
    }

    if (!type) {
      throw new Error(t("storage.selectType"));
    }

    if (!content) {
      throw new Error(t("storage.contentTypesRequired"));
    }

    const body = new URLSearchParams();
    const deleteFields: string[] = [];

    if (mode === "create") {
      body.set("storage", storageId);
      body.set("type", type);
    }

    body.set("content", content);
    body.set("disable", form.enabled ? "0" : "1");

    if (nodes) {
      body.set("nodes", nodes);
    } else if (mode === "edit") {
      deleteFields.push("nodes");
    }

    if (type === "dir") {
      const path = form.path.trim();
      if (!path) {
        throw new Error(t("storage.pathRequired"));
      }
      body.set("path", path);
    }

    if (type === "nfs") {
      const server = form.server.trim();
      const exportPath = form.exportPath.trim();
      if (!server) {
        throw new Error(t("storage.serverRequired"));
      }
      if (!exportPath) {
        throw new Error(t("storage.exportRequired"));
      }
      body.set("server", server);
      body.set("export", exportPath);

      const remainingOptions = removeNfsVersion(form.nfsOptions);
      const options = [form.nfsVersion ? `vers=${form.nfsVersion}` : "", remainingOptions]
        .filter(Boolean)
        .join(",");

      if (options) {
        body.set("options", options);
      } else if (mode === "edit") {
        deleteFields.push("options");
      }
    }

    if (type === "cifs") {
      const server = form.server.trim();
      const share = form.share.trim();
      const username = form.username.trim();
      const domain = form.domain.trim();

      if (!server) {
        throw new Error(t("storage.serverRequired"));
      }
      if (!share) {
        throw new Error(t("storage.shareRequired"));
      }

      body.set("server", server);
      body.set("share", share);

      if (username) {
        body.set("username", username);
      } else if (mode === "edit") {
        deleteFields.push("username");
      }

      if (domain) {
        body.set("domain", domain);
      } else if (mode === "edit") {
        deleteFields.push("domain");
      }

      if (form.password.trim()) {
        body.set("password", form.password);
      }
    }

    if (type === "lvm") {
      const volumeGroup = form.volumeGroup.trim();
      const baseStorage = form.baseStorage.trim();
      const baseVolume = form.baseVolume.trim();

      if (!volumeGroup) {
        throw new Error(t("storage.volumeGroupRequired"));
      }

      if ((baseStorage && !baseVolume) || (!baseStorage && baseVolume)) {
        throw new Error(t("storage.baseVolumeRequired"));
      }

      body.set("vgname", volumeGroup);

      if (baseStorage && baseVolume) {
        body.set("base", `${baseStorage}:${baseVolume}`);
      } else if (mode === "edit") {
        deleteFields.push("base");
      }
    }

    if (type === "lvmthin") {
      const volumeGroup = form.volumeGroup.trim();
      const thinPool = form.thinPool.trim();

      if (!volumeGroup) {
        throw new Error(t("storage.volumeGroupRequired"));
      }
      if (!thinPool) {
        throw new Error(t("storage.thinPoolRequired"));
      }

      body.set("vgname", volumeGroup);
      body.set("thinpool", thinPool);
    }

    if (type === "zfspool") {
      const pool = form.pool.trim();
      const blocksize = form.blocksize.trim();

      if (!pool) {
        throw new Error(t("storage.poolRequired"));
      }

      body.set("pool", pool);

      if (blocksize) {
        body.set("blocksize", blocksize);
      } else if (mode === "edit") {
        deleteFields.push("blocksize");
      }
    }

    if (mode === "edit" && deleteFields.length > 0) {
      body.set("delete", deleteFields.join(","));
    }

    return body;
  }, [form, t]);

  const openCreateModal = useCallback(() => {
    resetForm();
    setCreateVisible(true);
  }, [resetForm]);

  const openEditModal = useCallback(async (storage: PveStorage) => {
    try {
      setLoadingConfigId(storage.storage);
      const config = await fetchProxmox<PveStorageConfig>(`/api/proxmox/storage/${encodeURIComponent(storage.storage)}`, t);
      setSelectedStorage(storage);
      setForm(storageConfigToForm(config, storage));
      setEditVisible(true);
    } catch (loadError) {
      addError(loadError instanceof Error ? loadError.message : t("storage.updateFailed"));
    } finally {
      setLoadingConfigId(null);
    }
  }, [addError, t]);

  const openDeleteModal = useCallback((storage: PveStorage) => {
    setSelectedStorage(storage);
    setDeleteVisible(true);
  }, []);

  const handleCreateStorage = useCallback(async () => {
    await runAction(async () => {
      const body = buildStoragePayload("create");
      const storageId = form.storageId.trim();

      await fetchProxmox<string>("/api/proxmox/storage", t, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      addSuccess(interpolate(t("storage.createSuccess"), { id: storageId }));
      closeCreateModal();
      await loadStorages();
    }, "storage.createFailed");
  }, [addSuccess, buildStoragePayload, closeCreateModal, form.storageId, loadStorages, runAction, t]);

  const handleEditStorage = useCallback(async () => {
    if (!selectedStorage) {
      return;
    }

    await runAction(async () => {
      const body = buildStoragePayload("edit");

      await fetchProxmox<string>(`/api/proxmox/storage/${encodeURIComponent(selectedStorage.storage)}`, t, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      addSuccess(interpolate(t("storage.updateSuccess"), { id: selectedStorage.storage }));
      closeEditModal();
      await loadStorages();
    }, "storage.updateFailed");
  }, [addSuccess, buildStoragePayload, closeEditModal, loadStorages, runAction, selectedStorage, t]);

  const handleDeleteStorage = useCallback(async () => {
    if (!selectedStorage) {
      return;
    }

    await runAction(async () => {
      await fetchProxmox<string>(`/api/proxmox/storage/${encodeURIComponent(selectedStorage.storage)}`, t, {
        method: "DELETE",
      });

      addSuccess(interpolate(t("storage.deleteSuccess"), { id: selectedStorage.storage }));
      closeDeleteModal();
      await loadStorages();
    }, "storage.deleteFailed");
  }, [addSuccess, closeDeleteModal, loadStorages, runAction, selectedStorage, t]);

  const columnDefinitions = useMemo<TableProps<PveStorage>["columnDefinitions"]>(
    () => [
      {
        id: "storage",
        header: t("common.name"),
        cell: ({ storage }) => storage,
        sortingField: "storage",
        isRowHeader: true,
        minWidth: 180,
      },
      {
        id: "node",
        header: t("storage.node"),
        cell: ({ node }) => node,
        sortingField: "node",
        minWidth: 140,
      },
      {
        id: "type",
        header: t("storage.type"),
        cell: ({ type }) => type,
        sortingField: "type",
        minWidth: 140,
      },
      {
        id: "content",
        header: t("storage.content"),
        cell: ({ content }) => content,
        minWidth: 180,
      },
      {
        id: "status",
        header: t("common.status"),
        cell: (storage) => <StatusIndicator type={isStorageActive(storage) ? "success" : "stopped"}>{storage.status ?? (isStorageActive(storage) ? t("nodeDetail.active") : t("nodeDetail.inactive"))}</StatusIndicator>,
        minWidth: 140,
      },
      {
        id: "total",
        header: t("storage.total"),
        cell: ({ total }) => formatBytes(total ?? 0),
        sortingComparator: (a, b) => (a.total ?? 0) - (b.total ?? 0),
        minWidth: 140,
      },
      {
        id: "used",
        header: t("storage.used"),
        cell: ({ used }) => formatBytes(used ?? 0),
        sortingComparator: (a, b) => (a.used ?? 0) - (b.used ?? 0),
        minWidth: 140,
      },
      {
        id: "avail",
        header: t("storage.available"),
        cell: ({ avail }) => formatBytes(avail ?? 0),
        sortingComparator: (a, b) => (a.avail ?? 0) - (b.avail ?? 0),
        minWidth: 140,
      },
      {
        id: "usage",
        header: t("common.usage"),
        cell: ({ used, total, used_fraction }) => (
          <ProgressBar
            value={formatUsage(used_fraction)}
            additionalInfo={`${formatBytes(used ?? 0)} / ${formatBytes(total ?? 0)}`}
          />
        ),
        sortingComparator: (a, b) => (a.used_fraction ?? 0) - (b.used_fraction ?? 0),
        minWidth: 260,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (storage) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              variant="inline-link"
              disabled={submitting || loadingConfigId === storage.storage}
              onClick={() => void openEditModal(storage)}
            >
              {t("common.edit")}
            </Button>
            <Button
              variant="inline-link"
              disabled={submitting || loadingConfigId === storage.storage}
              onClick={() => openDeleteModal(storage)}
            >
              {t("common.delete")}
            </Button>
          </SpaceBetween>
        ),
        minWidth: 180,
      },
    ],
    [loadingConfigId, openDeleteModal, openEditModal, submitting, t],
  );

  const emptyState = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("storage.noStorage")}</b>
        <Box variant="p" color="inherit">
          {t("storage.noStorageAvailable")}
        </Box>
        <Button onClick={() => void loadStorages()}>{t("common.refresh")}</Button>
      </SpaceBetween>
    </Box>
  );

  const noMatch = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("common.noMatches")}</b>
        <Box variant="p" color="inherit">
          {t("storage.noStorageMatch")}
        </Box>
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
  } = useCollection(storages, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return [
          item.storage,
          item.node,
          item.type,
          item.content,
          item.status ?? "",
          formatBytes(item.total ?? 0),
          formatBytes(item.used ?? 0),
          formatBytes(item.avail ?? 0),
          `${formatUsage(item.used_fraction)}%`,
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: emptyState,
      noMatch,
    },
    sorting: {
      defaultState: {
        sortingColumn: columnDefinitions[0],
      },
    },
    pagination: {
      pageSize: preferences.pageSize,
    },
  });

  const headerCounter = filterProps.filteringText ? `(${filteredItemsCount}/${storages.length})` : `(${storages.length})`;

  const renderTypeSpecificFields = () => {
    if (form.type === "dir") {
      return (
        <FormField label={t("storage.path")} errorText={!form.path.trim() && submitting ? t("storage.pathRequired") : undefined}>
          <Input
            value={form.path}
            placeholder={t("storage.pathPlaceholder")}
            onChange={({ detail }) => setFormValue("path", detail.value)}
          />
        </FormField>
      );
    }

    if (form.type === "nfs") {
      return (
        <ColumnLayout columns={2} variant="text-grid">
          <FormField label={t("storage.server")} errorText={!form.server.trim() && submitting ? t("storage.serverRequired") : undefined}>
            <Input
              value={form.server}
              placeholder={t("storage.serverPlaceholder")}
              onChange={({ detail }) => setFormValue("server", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.export_")} errorText={!form.exportPath.trim() && submitting ? t("storage.exportRequired") : undefined}>
            <Input
              value={form.exportPath}
              placeholder={t("storage.exportPlaceholder")}
              onChange={({ detail }) => setFormValue("exportPath", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.nfsVersion")}>
            <Select
              selectedOption={selectedNfsVersionOption}
              options={nfsVersionOptions}
              placeholder={t("storage.selectNfsVersion")}
              onChange={({ detail }) => setFormValue("nfsVersion", optionValue(detail.selectedOption))}
            />
          </FormField>
        </ColumnLayout>
      );
    }

    if (form.type === "cifs") {
      return (
        <ColumnLayout columns={2} variant="text-grid">
          <FormField label={t("storage.server")} errorText={!form.server.trim() && submitting ? t("storage.serverRequired") : undefined}>
            <Input
              value={form.server}
              placeholder={t("storage.serverPlaceholder")}
              onChange={({ detail }) => setFormValue("server", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.share")} errorText={!form.share.trim() && submitting ? t("storage.shareRequired") : undefined}>
            <Input
              value={form.share}
              placeholder={t("storage.sharePlaceholder")}
              onChange={({ detail }) => setFormValue("share", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.username")}>
            <Input
              value={form.username}
              placeholder={t("storage.usernamePlaceholder")}
              onChange={({ detail }) => setFormValue("username", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.password")}>
            <Input
              type="password"
              value={form.password}
              placeholder={t("storage.passwordPlaceholder")}
              onChange={({ detail }) => setFormValue("password", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.domain")}>
            <Input
              value={form.domain}
              placeholder={t("storage.domainPlaceholder")}
              onChange={({ detail }) => setFormValue("domain", detail.value)}
            />
          </FormField>
        </ColumnLayout>
      );
    }

    if (form.type === "lvm") {
      return (
        <ColumnLayout columns={2} variant="text-grid">
          <FormField label={t("storage.volumeGroup")} errorText={!form.volumeGroup.trim() && submitting ? t("storage.volumeGroupRequired") : undefined}>
            <Input
              value={form.volumeGroup}
              placeholder={t("storage.volumeGroupPlaceholder")}
              onChange={({ detail }) => setFormValue("volumeGroup", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.baseStorage")}>
            <Input
              value={form.baseStorage}
              placeholder={t("storage.baseStoragePlaceholder")}
              onChange={({ detail }) => setFormValue("baseStorage", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.baseVolume")}>
            <Input
              value={form.baseVolume}
              placeholder={t("storage.baseVolumePlaceholder")}
              onChange={({ detail }) => setFormValue("baseVolume", detail.value)}
            />
          </FormField>
        </ColumnLayout>
      );
    }

    if (form.type === "lvmthin") {
      return (
        <ColumnLayout columns={2} variant="text-grid">
          <FormField label={t("storage.volumeGroup")} errorText={!form.volumeGroup.trim() && submitting ? t("storage.volumeGroupRequired") : undefined}>
            <Input
              value={form.volumeGroup}
              placeholder={t("storage.volumeGroupPlaceholder")}
              onChange={({ detail }) => setFormValue("volumeGroup", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.thinPool")} errorText={!form.thinPool.trim() && submitting ? t("storage.thinPoolRequired") : undefined}>
            <Input
              value={form.thinPool}
              placeholder={t("storage.thinPoolPlaceholder")}
              onChange={({ detail }) => setFormValue("thinPool", detail.value)}
            />
          </FormField>
        </ColumnLayout>
      );
    }

    if (form.type === "zfspool") {
      return (
        <ColumnLayout columns={2} variant="text-grid">
          <FormField label={t("storage.pool")} errorText={!form.pool.trim() && submitting ? t("storage.poolRequired") : undefined}>
            <Input
              value={form.pool}
              placeholder={t("storage.poolPlaceholder")}
              onChange={({ detail }) => setFormValue("pool", detail.value)}
            />
          </FormField>
          <FormField label={t("storage.blocksize")}>
            <Input
              value={form.blocksize}
              placeholder={t("storage.blocksizePlaceholder")}
              onChange={({ detail }) => setFormValue("blocksize", detail.value)}
            />
          </FormField>
        </ColumnLayout>
      );
    }

    return null;
  };

  const renderStorageForm = (mode: "create" | "edit") => (
    <SpaceBetween size="l">
      <ColumnLayout columns={2} variant="text-grid">
        <FormField label={t("storage.storageId")} errorText={mode === "create" && !form.storageId.trim() && submitting ? t("storage.storageIdRequired") : undefined}>
          <Input
            value={form.storageId}
            placeholder={t("storage.storageIdPlaceholder")}
            disabled={mode === "edit"}
            onChange={({ detail }) => setFormValue("storageId", detail.value)}
          />
        </FormField>
        <FormField label={t("storage.storageType")}>
          <Select
            selectedOption={selectedTypeOption}
            options={typeOptions}
            placeholder={t("storage.selectType")}
            disabled={mode === "edit"}
            onChange={({ detail }) => handleTypeChange(optionValue(detail.selectedOption) as StorageType | "")}
          />
        </FormField>
      </ColumnLayout>

      <FormField label={t("storage.contentTypes")} errorText={form.content.length === 0 && submitting ? t("storage.contentTypesRequired") : undefined}>
        <ColumnLayout columns={2} variant="text-grid">
          {ALL_CONTENT_TYPES.map((contentType) => (
            <Checkbox
              key={contentType}
              checked={form.content.includes(contentType)}
              disabled={!supportedContentTypes.has(contentType)}
              onChange={({ detail }) => toggleContentType(contentType, detail.checked)}
            >
              {contentLabels[contentType]}
            </Checkbox>
          ))}
        </ColumnLayout>
      </FormField>

      <ColumnLayout columns={2} variant="text-grid">
        <FormField label={t("storage.nodes")}>
          <Input
            value={form.nodes}
            placeholder={t("storage.nodesPlaceholder")}
            onChange={({ detail }) => setFormValue("nodes", detail.value)}
          />
        </FormField>
        <FormField label={t("storage.enabled")}>
          <Toggle checked={form.enabled} onChange={({ detail }) => setFormValue("enabled", detail.checked)}>
            {t("storage.enabled")}
          </Toggle>
        </FormField>
      </ColumnLayout>

      {renderTypeSpecificFields()}
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="m">
      {error ? (
        <Alert type="error" header={t("storage.failedToLoad")}>
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
        trackBy={(item) => `${item.node}:${item.storage}`}
        loading={loading}
        loadingText={t("storage.loadingStorage")}
        empty={filterProps.filteringText ? noMatch : emptyState}
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        columnDisplay={preferences.contentDisplay}
        header={
          <Header
            variant="h1"
            counter={headerCounter}
            description={t("storage.manageDescriptionLong")}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => router.push("/storage/upload")}>{t("storage.upload")}</Button>
                <Button iconName="refresh" ariaLabel={t("common.refresh")} onClick={() => void loadStorages()} />
                <Button variant="primary" onClick={openCreateModal}>{t("storage.createStorage")}</Button>
              </SpaceBetween>
            }
          >
            {t("storage.storage")}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder={t("storage.findStorage")}
            countText={`${filteredItemsCount ?? storages.length} ${t("common.matches")}`}
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
                { value: 10, label: t("storage.resourcesCount10") },
                { value: 20, label: t("storage.resourcesCount20") },
                { value: 50, label: t("storage.resourcesCount50") },
              ],
            }}
            wrapLinesPreference={{
              label: t("common.wrapLines"),
              description: t("storage.wrapLinesDesc"),
            }}
            stripedRowsPreference={{
              label: t("common.stripedRows"),
              description: t("storage.stripedRowsDesc"),
            }}
            contentDensityPreference={{
              label: t("common.contentDensity"),
              description: t("storage.contentDensityDesc"),
            }}
            contentDisplayPreference={{
              title: t("common.columnPreferences"),
              options: [
                { id: "storage", label: t("common.name"), alwaysVisible: true },
                { id: "node", label: t("storage.node") },
                { id: "type", label: t("storage.type") },
                { id: "content", label: t("storage.content") },
                { id: "status", label: t("common.status") },
                { id: "total", label: t("storage.total") },
                { id: "used", label: t("storage.used") },
                { id: "avail", label: t("storage.available") },
                { id: "usage", label: t("common.usage") },
                { id: "actions", label: t("common.actions") },
              ],
            }}
          />
        }
      />

      <Modal
        visible={createVisible}
        size="large"
        onDismiss={closeCreateModal}
        header={t("storage.createStorageModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={closeCreateModal}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={submitting} onClick={() => void handleCreateStorage()}>{t("common.create")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {renderStorageForm("create")}
      </Modal>

      <Modal
        visible={editVisible}
        size="large"
        onDismiss={closeEditModal}
        header={t("storage.editStorageModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={closeEditModal}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={submitting} onClick={() => void handleEditStorage()}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {renderStorageForm("edit")}
      </Modal>

      <Modal
        visible={deleteVisible}
        onDismiss={closeDeleteModal}
        header={t("storage.deleteStorageModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={closeDeleteModal}>{t("common.cancel")}</Button>
              <Button variant="normal" loading={submitting} onClick={() => void handleDeleteStorage()}>{t("common.delete")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Box>
          {selectedStorage
            ? interpolate(t("storage.deleteConfirmation"), { id: selectedStorage.storage })
            : t("storage.deleteStorage")}
        </Box>
      </Modal>
    </SpaceBetween>
  );
}
