"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";

import { isStorageActive, poolMemberVmid } from "@/app/lib/resource-api";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import type { CollectionPreferencesProps } from "@cloudscape-design/components/collection-preferences";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Textarea from "@cloudscape-design/components/textarea";
import { useNotifications } from "@/app/components/notifications";
import { useTranslation } from "@/app/lib/use-translation";

interface PoolMember {
  id: string;
  node?: string;
  type?: "qemu" | "lxc" | "storage" | string;
  name?: string;
  status?: string;
  storage?: string;
  vmid?: number;
}

interface PoolSummary {
  poolid: string;
  comment?: string;
}

interface PoolDetail extends PoolSummary {
  members?: PoolMember[];
}

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

interface PoolRecord {
  poolid: string;
  comment: string;
  members: PoolMember[];
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
    { id: "poolid", visible: true },
    { id: "comment", visible: true },
    { id: "members", visible: true },
    { id: "actions", visible: true },
  ],
};

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function getMemberTypeKey(type?: string) {
  if (type === "qemu") return "pools.virtualMachine";
  if (type === "lxc") return "pools.container";
  if (type === "storage") return "pools.storage";
  return "common.other";
}

function getStatusType(status?: string) {
  if (status === "running" || status === "active" || status === "available") {
    return "success" as const;
  }
  if (status === "stopped" || status === "inactive" || status === "disabled") {
    return "stopped" as const;
  }
  return "info" as const;
}



function optionValue(option: SelectProps.Option | null) {
  return typeof option?.value === "string" ? option.value : "";
}

function getMemberKey(member: PoolMember) {
  return `${member.type ?? "unknown"}:${member.id}`;
}

function getMemberLabel(member: PoolMember, t: (key: string) => string) {
  const typeLabel = t(getMemberTypeKey(member.type));
  const primaryId = member.type === "storage" ? member.storage ?? member.id : member.id;
  const suffix = member.name ? ` · ${member.name}` : "";
  return `${typeLabel} ${primaryId}${suffix}`;
}

async function fetchProxmox<T>(path: string, _t: (key: string) => string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function PoolsPage() {
  const { t } = useTranslation();
  const { addError, addSuccess } = useNotifications();
  const [pools, setPools] = useState<PoolRecord[]>([]);
  const [resources, setResources] = useState<ClusterResource[]>([]);
  const [storages, setStorages] = useState<PveStorage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);

  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [membersVisible, setMembersVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [createPoolId, setCreatePoolId] = useState("");
  const [createComment, setCreateComment] = useState("");
  const [editComment, setEditComment] = useState("");
  const [selectedMemberType, setSelectedMemberType] = useState<SelectProps.Option | null>(null);
  const [selectedMemberTarget, setSelectedMemberTarget] = useState<SelectProps.Option | null>(null);

  const selectedPool = useMemo(
    () => pools.find((pool) => pool.poolid === selectedPoolId) ?? null,
    [pools, selectedPoolId],
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const [poolSummaries, clusterResources, nodes] = await Promise.all([
        fetchProxmox<PoolSummary[]>("/api/proxmox/pools", t),
        fetchProxmox<ClusterResource[]>("/api/proxmox/cluster/resources?type=vm", t),
        fetchProxmox<PveNode[]>("/api/proxmox/nodes", t),
      ]);

      const onlineNodes = (nodes ?? []).filter((node) => node.status === "online");
      const [poolDetails, nodeStorages] = await Promise.all([
        Promise.all(
          (poolSummaries ?? []).map(async ({ poolid }) => {
            const detail = await fetchProxmox<PoolDetail>(`/api/proxmox/pools/${encodeURIComponent(poolid)}`, t);
            return {
              poolid,
              comment: detail.comment ?? "",
              members: detail.members ?? [],
            } satisfies PoolRecord;
          }),
        ),
        Promise.all(
          onlineNodes.map(async ({ node }) => {
            const entries = await fetchProxmox<Omit<PveStorage, "node">[]>(`/api/proxmox/nodes/${node}/storage`, t);
            return (entries ?? []).map((entry) => ({ ...entry, node }));
          }),
        ),
      ]);

      setPools(poolDetails.sort((a, b) => a.poolid.localeCompare(b.poolid)));
      setResources(
        (clusterResources ?? [])
          .filter((resource) => resource.vmid !== undefined && resource.node && resource.type && resource.template !== 1)
          .sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0)),
      );
      setStorages(nodeStorages.flat().filter((storage) => isStorageActive(storage)));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("pools.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useResourceTaskRefresh(loadData);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadData();
  }, [loadData]);

  const memberTypeOptions = useMemo<SelectProps.Options>(() => [
    { label: t("pools.virtualMachineOrContainer"), value: "vm" },
    { label: t("pools.storage"), value: "storage" },
  ], [t]);

  const memberTargetOptions = useMemo<SelectProps.Options>(() => {
    if (optionValue(selectedMemberType) === "storage") {
      const seen = new Set<string>();
      return storages
        .filter((storage) => {
          if (seen.has(storage.storage)) {
            return false;
          }
          seen.add(storage.storage);
          return true;
        })
        .map((storage) => ({
          label: storage.storage,
          description: storage.node,
          value: storage.storage,
        }));
    }

    return resources.map((resource) => ({
      label: `${resource.vmid} · ${resource.name ?? t("pools.unknownName")}`,
      description: `${resource.node} · ${t(getMemberTypeKey(resource.type))}`,
      value: String(resource.vmid ?? ""),
    }));
  }, [resources, selectedMemberType, storages, t]);

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

  const resetCreateForm = useCallback(() => {
    setCreatePoolId("");
    setCreateComment("");
  }, []);

  const openEditModal = useCallback((pool: PoolRecord) => {
    setSelectedPoolId(pool.poolid);
    setEditComment(pool.comment);
    setEditVisible(true);
  }, []);

  const openDeleteModal = useCallback((pool: PoolRecord) => {
    setSelectedPoolId(pool.poolid);
    setDeleteVisible(true);
  }, []);

  const openMembersModal = useCallback((pool: PoolRecord) => {
    setSelectedPoolId(pool.poolid);
    setSelectedMemberType(null);
    setSelectedMemberTarget(null);
    setMembersVisible(true);
  }, []);

  const handleCreatePool = useCallback(async () => {
    if (!createPoolId.trim()) {
      addError(t("pools.poolIdRequired"));
      return;
    }

    await runAction(async () => {
      const body = new URLSearchParams();
      body.set("poolid", createPoolId.trim());
      if (createComment.trim()) {
        body.set("comment", createComment.trim());
      }

      await fetchProxmox<string>("/api/proxmox/pools", t, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      addSuccess(interpolate(t("pools.createSuccess"), { poolid: createPoolId.trim() }));
      setCreateVisible(false);
      resetCreateForm();
      await loadData();
    }, "pools.createFailed");
  }, [addError, addSuccess, createComment, createPoolId, loadData, resetCreateForm, runAction, t]);

  const handleEditPool = useCallback(async () => {
    if (!selectedPool) {
      return;
    }

    await runAction(async () => {
      const body = new URLSearchParams();
      body.set("comment", editComment.trim());

      await fetchProxmox<string>(`/api/proxmox/pools/${encodeURIComponent(selectedPool.poolid)}`, t, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      addSuccess(interpolate(t("pools.updateSuccess"), { poolid: selectedPool.poolid }));
      setEditVisible(false);
      await loadData();
    }, "pools.updateFailed");
  }, [addSuccess, editComment, loadData, runAction, selectedPool, t]);

  const handleDeletePool = useCallback(async () => {
    if (!selectedPool) {
      return;
    }

    await runAction(async () => {
      await fetchProxmox<string>(`/api/proxmox/pools/${encodeURIComponent(selectedPool.poolid)}`, t, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(),
      });

      addSuccess(interpolate(t("pools.deleteSuccess"), { poolid: selectedPool.poolid }));
      setDeleteVisible(false);
      setMembersVisible(false);
      setSelectedPoolId(null);
      await loadData();
    }, "pools.deleteFailed");
  }, [addSuccess, loadData, runAction, selectedPool, t]);

  const handleAddMember = useCallback(async () => {
    if (!selectedPool) {
      return;
    }

    const memberType = optionValue(selectedMemberType);
    const memberTarget = optionValue(selectedMemberTarget);

    if (!memberType) {
      addError(t("pools.memberTypeRequired"));
      return;
    }

    if (!memberTarget) {
      addError(t("pools.memberTargetRequired"));
      return;
    }

    await runAction(async () => {
      const body = new URLSearchParams();
      if (memberType === "storage") {
        body.set("storage", memberTarget);
      } else {
        body.set("vms", memberTarget);
      }

      await fetchProxmox<string>(`/api/proxmox/pools/${encodeURIComponent(selectedPool.poolid)}`, t, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      addSuccess(interpolate(t("pools.addMemberSuccess"), { poolid: selectedPool.poolid }));
      setSelectedMemberType(null);
      setSelectedMemberTarget(null);
      await loadData();
    }, "pools.addMemberFailed");
  }, [addError, addSuccess, loadData, runAction, selectedMemberTarget, selectedMemberType, selectedPool, t]);

  const handleRemoveMember = useCallback(async (member: PoolMember) => {
    if (!selectedPool) {
      return;
    }

    await runAction(async () => {
      const body = new URLSearchParams();
      if (member.type === "storage") {
        body.set("storage", member.storage ?? member.id);
      } else {
        body.set("vms", poolMemberVmid(member));
      }
      body.set("delete", "1");

      await fetchProxmox<string>(`/api/proxmox/pools/${encodeURIComponent(selectedPool.poolid)}`, t, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      addSuccess(interpolate(t("pools.removeMemberSuccess"), { poolid: selectedPool.poolid }));
      await loadData();
    }, "pools.removeMemberFailed");
  }, [addSuccess, loadData, runAction, selectedPool, t]);

  const columnDefinitions = useMemo<TableProps<PoolRecord>["columnDefinitions"]>(() => [
    {
      id: "poolid",
      header: t("pools.poolId"),
      cell: ({ poolid }) => poolid,
      sortingField: "poolid",
      isRowHeader: true,
      minWidth: 180,
    },
    {
      id: "comment",
      header: t("pools.comment"),
      cell: ({ comment }) => comment || t("pools.noComment"),
      sortingField: "comment",
      minWidth: 220,
    },
    {
      id: "members",
      header: t("pools.members"),
      cell: (pool) => pool.members.length > 0
        ? pool.members.map((member) => getMemberLabel(member, t)).join(", ")
        : t("pools.noMembers"),
      sortingComparator: (a, b) => a.members.length - b.members.length,
      minWidth: 320,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: (pool) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="inline-link" onClick={() => openMembersModal(pool)}>{t("pools.manageMembers")}</Button>
          <Button variant="inline-link" onClick={() => openEditModal(pool)}>{t("common.edit")}</Button>
          <Button variant="inline-link" onClick={() => openDeleteModal(pool)}>{t("common.delete")}</Button>
        </SpaceBetween>
      ),
      minWidth: 260,
    },
  ], [openDeleteModal, openEditModal, openMembersModal, t]);

  const emptyState = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("pools.noPools")}</b>
        <Box variant="p" color="inherit">
          {t("pools.noPoolsDescription")}
        </Box>
        <Button onClick={() => setCreateVisible(true)}>{t("pools.createPool")}</Button>
      </SpaceBetween>
    </Box>
  );

  const noMatch = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("common.noMatches")}</b>
        <Box variant="p" color="inherit">
          {t("pools.noPoolsMatch")}
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
  } = useCollection(pools, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [
          item.poolid,
          item.comment,
          ...item.members.flatMap((member) => [
            member.id,
            member.node ?? "",
            member.type ?? "",
            member.name ?? "",
            member.status ?? "",
            member.storage ?? "",
          ]),
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

  const memberColumns = useMemo<TableProps<PoolMember>["columnDefinitions"]>(() => [
    {
      id: "id",
      header: t("pools.memberId"),
      cell: (member) => member.type === "storage" ? member.storage ?? member.id : member.id,
      isRowHeader: true,
    },
    {
      id: "node",
      header: t("pools.node"),
      cell: (member) => member.node ?? t("cluster.common.none"),
    },
    {
      id: "type",
      header: t("pools.type"),
      cell: (member) => t(getMemberTypeKey(member.type)),
    },
    {
      id: "name",
      header: t("common.name"),
      cell: (member) => member.name ?? t("pools.unknownName"),
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (member) => (
        <StatusIndicator type={getStatusType(member.status)}>
          {member.status ?? t("pools.unknownStatus")}
        </StatusIndicator>
      ),
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: (member) => (
        <Button
          variant="inline-link"
          disabled={submitting}
          onClick={() => void handleRemoveMember(member)}
        >
          {t("pools.removeMember")}
        </Button>
      ),
    },
  ], [handleRemoveMember, submitting, t]);

  const headerCounter = filterProps.filteringText
    ? `(${filteredItemsCount}/${pools.length})`
    : `(${pools.length})`;

  return (
    <SpaceBetween size="m">
      {error ? (
        <Alert type="error" header={t("pools.failedToLoad")}>
          {error}
        </Alert>
      ) : null}

      <Table
        {...collectionProps}
        items={items}
        columnDefinitions={columnDefinitions}
        variant="full-page"
        stickyHeader
        resizableColumns
        enableKeyboardNavigation
        trackBy="poolid"
        loading={loading}
        loadingText={t("pools.loadingPools")}
        empty={filterProps.filteringText ? noMatch : emptyState}
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        columnDisplay={preferences.contentDisplay}
        header={
          <Header
            variant="h1"
            counter={headerCounter}
            description={t("pools.pageDescription")}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="primary" onClick={() => setCreateVisible(true)}>{t("pools.createPool")}</Button>
                <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
              </SpaceBetween>
            }
          >
            {t("pools.pageTitle")}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder={t("pools.findPools")}
            countText={`${filteredItemsCount ?? pools.length} ${t("common.matches")}`}
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
                { value: 10, label: t("pools.poolsCount10") },
                { value: 20, label: t("pools.poolsCount20") },
                { value: 50, label: t("pools.poolsCount50") },
              ],
            }}
            wrapLinesPreference={{
              label: t("common.wrapLines"),
              description: t("pools.wrapLinesDesc"),
            }}
            stripedRowsPreference={{
              label: t("common.stripedRows"),
              description: t("pools.stripedRowsDesc"),
            }}
            contentDensityPreference={{
              label: t("common.contentDensity"),
              description: t("pools.contentDensityDesc"),
            }}
            contentDisplayPreference={{
              title: t("common.columnPreferences"),
              options: [
                { id: "poolid", label: t("pools.poolId"), alwaysVisible: true },
                { id: "comment", label: t("pools.comment") },
                { id: "members", label: t("pools.members") },
                { id: "actions", label: t("common.actions") },
              ],
            }}
          />
        }
      />

      <Modal
        visible={createVisible}
        onDismiss={() => {
          setCreateVisible(false);
          resetCreateForm();
        }}
        header={t("pools.createModalTitle")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => {
              setCreateVisible(false);
              resetCreateForm();
            }}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void handleCreatePool()}>{t("common.create")}</Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label={t("pools.poolId")} errorText={!createPoolId.trim() && submitting ? t("pools.poolIdRequired") : undefined}>
            <Input value={createPoolId} placeholder={t("pools.poolIdPlaceholder")} onChange={({ detail }) => setCreatePoolId(detail.value)} />
          </FormField>
          <FormField label={t("pools.comment")}>
            <Textarea value={createComment} placeholder={t("pools.commentPlaceholder")} onChange={({ detail }) => setCreateComment(detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={editVisible}
        onDismiss={() => setEditVisible(false)}
        header={selectedPool ? interpolate(t("pools.editModalTitle"), { poolid: selectedPool.poolid }) : t("pools.editModalTitleFallback")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => setEditVisible(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void handleEditPool()}>{t("common.save")}</Button>
          </SpaceBetween>
        }
      >
        <FormField label={t("pools.comment")}>
          <Textarea value={editComment} placeholder={t("pools.commentPlaceholder")} onChange={({ detail }) => setEditComment(detail.value)} />
        </FormField>
      </Modal>

      <Modal
        visible={deleteVisible}
        onDismiss={() => setDeleteVisible(false)}
        header={t("pools.deleteModalTitle")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => setDeleteVisible(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void handleDeletePool()}>{t("common.delete")}</Button>
          </SpaceBetween>
        }
      >
        <Box>{selectedPool ? interpolate(t("pools.deleteConfirmation"), { poolid: selectedPool.poolid }) : t("pools.deleteModalTitle")}</Box>
      </Modal>

      <Modal
        visible={membersVisible}
        onDismiss={() => {
          setMembersVisible(false);
          setSelectedMemberType(null);
          setSelectedMemberTarget(null);
        }}
        size="max"
        header={selectedPool ? interpolate(t("pools.membersModalTitle"), { poolid: selectedPool.poolid }) : t("pools.membersModalTitleFallback")}
        footer={<Button onClick={() => setMembersVisible(false)}>{t("common.cancel")}</Button>}
      >
        <SpaceBetween size="l">
          <SpaceBetween size="m" direction="horizontal">
            <FormField label={t("pools.memberType")} stretch>
              <Select
                selectedOption={selectedMemberType}
                options={memberTypeOptions}
                placeholder={t("pools.selectMemberType")}
                onChange={({ detail }) => {
                  setSelectedMemberType(detail.selectedOption);
                  setSelectedMemberTarget(null);
                }}
              />
            </FormField>
            <FormField label={t("pools.memberTarget")} stretch>
              <Select
                selectedOption={selectedMemberTarget}
                options={memberTargetOptions}
                placeholder={t("pools.selectMemberTarget")}
                disabled={!selectedMemberType}
                onChange={({ detail }) => setSelectedMemberTarget(detail.selectedOption)}
              />
            </FormField>
            <FormField label={t("common.actions")}>
              <Button variant="primary" loading={submitting} onClick={() => void handleAddMember()}>{t("pools.addMember")}</Button>
            </FormField>
          </SpaceBetween>

          <Table
            items={selectedPool?.members ?? []}
            trackBy={getMemberKey}
            columnDefinitions={memberColumns}
            variant="embedded"
            loading={loading}
            loadingText={t("pools.loadingMembers")}
            empty={
              <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
                {t("pools.noMembers")}
              </Box>
            }
            header={
              <Header counter={`(${selectedPool?.members.length ?? 0})`}>
                {t("pools.members")}
              </Header>
            }
          />
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
