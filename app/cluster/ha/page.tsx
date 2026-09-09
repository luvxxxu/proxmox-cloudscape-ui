"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
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
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";
import Textarea from "@cloudscape-design/components/textarea";
import { useTranslation } from "@/app/lib/use-translation";
import { isIntegerInRange } from "@/app/lib/resource-api";
import Link from "@/app/components/app-link";

interface HaResource {
  sid: string;
  state?: string;
  status?: string;
  request_state?: string;
  node?: string;
  max_relocate?: number;
  max_restart?: number;
  group?: string;
  comment?: string;
}

interface HaGroup {
  group: string;
  nodes?: string;
  restricted?: number | boolean;
  nofailback?: number | boolean;
  comment?: string;
}

interface Preferences {
  pageSize: number;
  wrapLines: boolean;
  stripedRows: boolean;
  contentDensity: "comfortable" | "compact";
  contentDisplay: ReadonlyArray<CollectionPreferencesProps.ContentDisplayItem>;
}

interface ResourceFormState {
  sid: string;
  maxRestart: string;
  maxRelocate: string;
  group: string;
  state: string;
  comment: string;
}

interface GroupFormState {
  group: string;
  nodes: string;
  restricted: boolean;
  nofailback: boolean;
  comment: string;
}

const DEFAULT_RESOURCE_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "sid", visible: true },
    { id: "state", visible: true },
    { id: "status", visible: true },
    { id: "requestState", visible: true },
    { id: "node", visible: true },
    { id: "maxRelocate", visible: true },
    { id: "maxRestart", visible: true },
    { id: "group", visible: true },
    { id: "comment", visible: true },
    { id: "actions", visible: true },
  ],
};

const DEFAULT_GROUP_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "group", visible: true },
    { id: "nodes", visible: true },
    { id: "restricted", visible: true },
    { id: "nofailback", visible: true },
    { id: "comment", visible: true },
    { id: "actions", visible: true },
  ],
};

const EMPTY_RESOURCE_FORM: ResourceFormState = {
  sid: "",
  maxRestart: "1",
  maxRelocate: "1",
  group: "",
  state: "started",
  comment: "",
};

const EMPTY_GROUP_FORM: GroupFormState = {
  group: "",
  nodes: "",
  restricted: false,
  nofailback: false,
  comment: "",
};

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}



function isEnabled(value?: number | boolean) {
  return value === 1 || value === true;
}

function buildResourceForm(resource: HaResource): ResourceFormState {
  return {
    sid: resource.sid,
    maxRestart: String(resource.max_restart ?? 1),
    maxRelocate: String(resource.max_relocate ?? 1),
    group: resource.group ?? "",
    state: resource.state ?? "started",
    comment: resource.comment ?? "",
  };
}

function buildGroupForm(haGroup: HaGroup): GroupFormState {
  return {
    group: haGroup.group,
    nodes: haGroup.nodes ?? "",
    restricted: isEnabled(haGroup.restricted),
    nofailback: isEnabled(haGroup.nofailback),
    comment: haGroup.comment ?? "",
  };
}

function renderCenteredState(title: string, description: string, action?: ReactNode) {
  return (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{title}</b>
        <Box variant="p" color="inherit">
          {description}
        </Box>
        {action ?? null}
      </SpaceBetween>
    </Box>
  );
}

function updatePreferences(
  detail: CollectionPreferencesProps.Preferences<CollectionPreferencesProps.ContentDisplayItem>,
  setPreferences: React.Dispatch<React.SetStateAction<Preferences>>,
) {
  setPreferences((current) => ({
    pageSize: detail.pageSize ?? current.pageSize,
    wrapLines: detail.wrapLines ?? current.wrapLines,
    stripedRows: detail.stripedRows ?? current.stripedRows,
    contentDensity: detail.contentDensity ?? current.contentDensity,
    contentDisplay: detail.contentDisplay ?? current.contentDisplay,
  }));
}

async function fetchProxmox<T>(path: string, _t: (key: string) => string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function ClusterHaPage() {
  const { t } = useTranslation();
  const [activeTabId, setActiveTabId] = useState("resources");
  const [resources, setResources] = useState<HaResource[]>([]);
  const [groups, setGroups] = useState<HaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [resourcePreferences, setResourcePreferences] = useState<Preferences>(DEFAULT_RESOURCE_PREFERENCES);
  const [groupPreferences, setGroupPreferences] = useState<Preferences>(DEFAULT_GROUP_PREFERENCES);

  const [resourceSubmitting, setResourceSubmitting] = useState(false);
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [selectedResource, setSelectedResource] = useState<HaResource | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<HaGroup | null>(null);
  const [resourceForm, setResourceForm] = useState<ResourceFormState>(EMPTY_RESOURCE_FORM);
  const [groupForm, setGroupForm] = useState<GroupFormState>(EMPTY_GROUP_FORM);

  const [createResourceVisible, setCreateResourceVisible] = useState(false);
  const [editResourceVisible, setEditResourceVisible] = useState(false);
  const [deleteResourceVisible, setDeleteResourceVisible] = useState(false);
  const [createGroupVisible, setCreateGroupVisible] = useState(false);
  const [editGroupVisible, setEditGroupVisible] = useState(false);
  const [deleteGroupVisible, setDeleteGroupVisible] = useState(false);

  const addFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 5));
  }, []);

  const dismissFlash = useCallback((id: string) => {
    setFlashItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [nextResources, nextGroups, liveStatus] = await Promise.all([
        fetchProxmox<HaResource[]>("/api/proxmox/cluster/ha/resources", t),
        fetchProxmox<HaGroup[]>("/api/proxmox/cluster/ha/groups", t),
        fetchProxmox<Array<Partial<HaResource> & { type: string }>>("/api/proxmox/cluster/ha/status/current", t),
      ]);
      const liveBySid = new Map((liveStatus ?? []).filter((entry) => entry.type === "service" && entry.sid).map((entry) => [entry.sid, entry]));
      setResources((nextResources ?? []).map((resource) => {
        const live = liveBySid.get(resource.sid);
        return { ...resource, status: live?.state ?? live?.status, node: live?.node, request_state: live?.request_state };
      }).sort((a, b) => a.sid.localeCompare(b.sid)));
      setGroups((nextGroups ?? []).sort((a, b) => a.group.localeCompare(b.group)));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("cluster.ha.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useResourceTaskRefresh(loadData);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadData();
  }, [loadData]);

  const groupOptions = useMemo<SelectProps.Option[]>(() => [{ label: t("cluster.common.none"), value: "" }, ...groups.map((group) => ({ label: group.group, value: group.group }))], [groups, t]);

  const stateOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("cluster.ha.started"), value: "started" },
      { label: t("cluster.ha.stopped"), value: "stopped" },
      { label: t("cluster.ha.enabled"), value: "enabled" },
      { label: t("cluster.ha.disabled"), value: "disabled" },
      { label: t("cluster.ha.ignored"), value: "ignored" },
    ],
    [t],
  );

  const resourceStatusType = useCallback((resource: HaResource): "success" | "stopped" | "in-progress" | "warning" => {
    const state = (resource.state ?? "").toLowerCase();
    if (state === "started" || state === "enabled") {
      return "success";
    }
    if (state === "ignored") {
      return "warning";
    }
    if (resource.status?.toLowerCase().includes("start") || resource.status?.toLowerCase().includes("migrate")) {
      return "in-progress";
    }
    return "stopped";
  }, []);

  const submitResource = useCallback(async (mode: "create" | "edit") => {
    try {
      const sid = resourceForm.sid.trim();
      if (!/^(?:vm|ct):[1-9]\d{2,8}$/.test(sid)) {
        throw new Error(t("cluster.ha.sidRequired"));
      }

      if (!isIntegerInRange(resourceForm.maxRestart, 0) || !isIntegerInRange(resourceForm.maxRelocate, 0)) throw new Error(t("cluster.ha.retryCountInvalid"));
      setResourceSubmitting(true);

      const params = new URLSearchParams();
      params.set("sid", sid);
      params.set("max_restart", resourceForm.maxRestart.trim() || "1");
      params.set("max_relocate", resourceForm.maxRelocate.trim() || "1");
      params.set("state", resourceForm.state || "started");

      if (resourceForm.group.trim()) {
        params.set("group", resourceForm.group.trim());
      }

      const deleteFields: string[] = [];
      if (resourceForm.comment.trim()) params.set("comment", resourceForm.comment.trim());
      else if (mode === "edit") deleteFields.push("comment");
      if (!resourceForm.group.trim() && mode === "edit") deleteFields.push("group");
      if (deleteFields.length) params.set("delete", deleteFields.join(","));

      const path = mode === "create"
        ? "/api/proxmox/cluster/ha/resources"
        : `/api/proxmox/cluster/ha/resources/${encodeURIComponent(selectedResource?.sid ?? sid)}`;

      await fetchProxmox<string>(path, t, {
        method: mode === "create" ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: params.toString(),
      });

      if (mode === "create") {
        setCreateResourceVisible(false);
        addFlash({ id: `ha-resource-create-${Date.now()}`, type: "success", content: t("cluster.ha.resourceCreated"), dismissible: true });
      } else {
        setEditResourceVisible(false);
        addFlash({ id: `ha-resource-update-${Date.now()}`, type: "success", content: t("cluster.ha.resourceUpdated"), dismissible: true });
      }

      await loadData();
    } catch (submitError) {
      const fallback = mode === "create" ? t("cluster.ha.resourceCreateFailed") : t("cluster.ha.resourceUpdateFailed");
      setError(submitError instanceof Error ? submitError.message : fallback);
    } finally {
      setResourceSubmitting(false);
    }
  }, [addFlash, loadData, resourceForm, selectedResource, t]);

  const deleteResource = useCallback(async () => {
    if (!selectedResource) {
      return;
    }

    try {
      setResourceSubmitting(true);
      await fetchProxmox<string>(`/api/proxmox/cluster/ha/resources/${encodeURIComponent(selectedResource.sid)}`, t, {
        method: "DELETE",
      });
      setDeleteResourceVisible(false);
      addFlash({ id: `ha-resource-delete-${Date.now()}`, type: "success", content: t("cluster.ha.resourceDeleted"), dismissible: true });
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("cluster.ha.resourceDeleteFailed"));
    } finally {
      setResourceSubmitting(false);
    }
  }, [addFlash, loadData, selectedResource, t]);

  const submitGroup = useCallback(async (mode: "create" | "edit") => {
    try {
      const group = groupForm.group.trim();
      const nodes = groupForm.nodes.trim();
      if (!group) {
        throw new Error(t("cluster.ha.groupRequired"));
      }
      if (!nodes) {
        throw new Error(t("cluster.ha.nodesRequired"));
      }

      setGroupSubmitting(true);

      const params = new URLSearchParams();
      params.set("group", group);
      params.set("nodes", nodes);
      params.set("restricted", groupForm.restricted ? "1" : "0");
      params.set("nofailback", groupForm.nofailback ? "1" : "0");
      if (groupForm.comment.trim()) params.set("comment", groupForm.comment.trim());
      else if (mode === "edit") params.set("delete", "comment");

      const path = mode === "create"
        ? "/api/proxmox/cluster/ha/groups"
        : `/api/proxmox/cluster/ha/groups/${encodeURIComponent(selectedGroup?.group ?? group)}`;

      await fetchProxmox<string>(path, t, {
        method: mode === "create" ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: params.toString(),
      });

      if (mode === "create") {
        setCreateGroupVisible(false);
        addFlash({ id: `ha-group-create-${Date.now()}`, type: "success", content: t("cluster.ha.groupCreated"), dismissible: true });
      } else {
        setEditGroupVisible(false);
        addFlash({ id: `ha-group-update-${Date.now()}`, type: "success", content: t("cluster.ha.groupUpdated"), dismissible: true });
      }

      await loadData();
    } catch (submitError) {
      const fallback = mode === "create" ? t("cluster.ha.groupCreateFailed") : t("cluster.ha.groupUpdateFailed");
      setError(submitError instanceof Error ? submitError.message : fallback);
    } finally {
      setGroupSubmitting(false);
    }
  }, [addFlash, groupForm, loadData, selectedGroup, t]);

  const deleteGroup = useCallback(async () => {
    if (!selectedGroup) {
      return;
    }

    try {
      setGroupSubmitting(true);
      await fetchProxmox<string>(`/api/proxmox/cluster/ha/groups/${encodeURIComponent(selectedGroup.group)}`, t, {
        method: "DELETE",
      });
      setDeleteGroupVisible(false);
      addFlash({ id: `ha-group-delete-${Date.now()}`, type: "success", content: t("cluster.ha.groupDeleted"), dismissible: true });
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("cluster.ha.groupDeleteFailed"));
    } finally {
      setGroupSubmitting(false);
    }
  }, [addFlash, loadData, selectedGroup, t]);

  const resourceColumns = useMemo<TableProps<HaResource>["columnDefinitions"]>(() => [
    { id: "sid", header: t("cluster.ha.sid"), cell: ({ sid }) => sid, sortingField: "sid", isRowHeader: true, minWidth: 160 },
    { id: "state", header: t("cluster.ha.state"), cell: (resource) => <StatusIndicator type={resourceStatusType(resource)}>{resource.state ?? t("cluster.common.none")}</StatusIndicator>, minWidth: 140 },
    { id: "status", header: t("cluster.ha.status"), cell: ({ status }) => status ?? t("cluster.common.none"), minWidth: 160 },
    { id: "requestState", header: t("cluster.ha.requestState"), cell: ({ request_state }) => request_state ?? t("cluster.common.none"), minWidth: 160 },
    { id: "node", header: t("cluster.ha.node"), cell: ({ node }) => node ?? t("cluster.common.none"), sortingField: "node", minWidth: 140 },
    { id: "maxRelocate", header: t("cluster.ha.maxRelocate"), cell: ({ max_relocate }) => String(max_relocate ?? 1), sortingComparator: (a, b) => (a.max_relocate ?? 0) - (b.max_relocate ?? 0), minWidth: 140 },
    { id: "maxRestart", header: t("cluster.ha.maxRestart"), cell: ({ max_restart }) => String(max_restart ?? 1), sortingComparator: (a, b) => (a.max_restart ?? 0) - (b.max_restart ?? 0), minWidth: 140 },
    { id: "group", header: t("cluster.ha.group"), cell: ({ group }) => group ?? t("cluster.common.none"), sortingField: "group", minWidth: 140 },
    { id: "comment", header: t("cluster.ha.comment"), cell: ({ comment }) => comment ?? t("cluster.common.none"), minWidth: 220 },
    {
      id: "actions",
      header: t("common.actions"),
      cell: (resource) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="inline-link" onClick={() => { setSelectedResource(resource); setResourceForm(buildResourceForm(resource)); setEditResourceVisible(true); }}>{t("common.edit")}</Button>
          <Button variant="inline-link" onClick={() => { setSelectedResource(resource); setDeleteResourceVisible(true); }}>{t("common.delete")}</Button>
        </SpaceBetween>
      ),
      minWidth: 160,
    },
  ], [resourceStatusType, t]);

  const groupColumns = useMemo<TableProps<HaGroup>["columnDefinitions"]>(() => [
    { id: "group", header: t("cluster.ha.group"), cell: ({ group }) => group, sortingField: "group", isRowHeader: true, minWidth: 160 },
    { id: "nodes", header: t("cluster.ha.nodes"), cell: ({ nodes }) => nodes ?? t("cluster.common.none"), minWidth: 220 },
    { id: "restricted", header: t("cluster.ha.restricted"), cell: ({ restricted }) => isEnabled(restricted) ? t("common.yes") : t("common.no"), minWidth: 120 },
    { id: "nofailback", header: t("cluster.ha.noFailback"), cell: ({ nofailback }) => isEnabled(nofailback) ? t("common.yes") : t("common.no"), minWidth: 140 },
    { id: "comment", header: t("cluster.ha.comment"), cell: ({ comment }) => comment ?? t("cluster.common.none"), minWidth: 220 },
    {
      id: "actions",
      header: t("common.actions"),
      cell: (group) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="inline-link" onClick={() => { setSelectedGroup(group); setGroupForm(buildGroupForm(group)); setEditGroupVisible(true); }}>{t("common.edit")}</Button>
          <Button variant="inline-link" onClick={() => { setSelectedGroup(group); setDeleteGroupVisible(true); }}>{t("common.delete")}</Button>
        </SpaceBetween>
      ),
      minWidth: 160,
    },
  ], [t]);

  const resourceEmptyState = renderCenteredState(t("cluster.ha.noResources"), t("cluster.ha.noResourcesDescription"), <Button onClick={() => void loadData()}>{t("common.refresh")}</Button>);
  const groupEmptyState = renderCenteredState(t("cluster.ha.noGroups"), t("cluster.ha.noGroupsDescription"), <Button onClick={() => void loadData()}>{t("common.refresh")}</Button>);

  const { actions: resourceActions, items: resourceItems, collectionProps: resourceCollectionProps, filterProps: resourceFilterProps, filteredItemsCount: filteredResourcesCount, paginationProps: resourcePaginationProps } = useCollection(resources, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return [item.sid, item.state ?? "", item.status ?? "", item.request_state ?? "", item.node ?? "", String(item.max_relocate ?? ""), String(item.max_restart ?? ""), item.group ?? "", item.comment ?? ""].some((value) => value.toLowerCase().includes(query));
      },
      empty: resourceEmptyState,
      // eslint-disable-next-line react-hooks/immutability -- Cloudscape calls this event handler only after useCollection has returned its actions.
      noMatch: renderCenteredState(t("common.noMatches"), t("cluster.ha.noResourcesMatch"), <Button onClick={() => resourceActions.setFiltering("")}>{t("common.clearFilter")}</Button>),
    },
    sorting: { defaultState: { sortingColumn: resourceColumns[0] } },
    pagination: { pageSize: resourcePreferences.pageSize },
  });

  const { actions: groupActions, items: groupItems, collectionProps: groupCollectionProps, filterProps: groupFilterProps, filteredItemsCount: filteredGroupsCount, paginationProps: groupPaginationProps } = useCollection(groups, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return [item.group, item.nodes ?? "", item.comment ?? "", isEnabled(item.restricted) ? t("common.yes") : t("common.no"), isEnabled(item.nofailback) ? t("common.yes") : t("common.no")].some((value) => value.toLowerCase().includes(query));
      },
      empty: groupEmptyState,
      // eslint-disable-next-line react-hooks/immutability -- Cloudscape calls this event handler only after useCollection has returned its actions.
      noMatch: renderCenteredState(t("common.noMatches"), t("cluster.ha.noGroupsMatch"), <Button onClick={() => groupActions.setFiltering("")}>{t("common.clearFilter")}</Button>),
    },
    sorting: { defaultState: { sortingColumn: groupColumns[0] } },
    pagination: { pageSize: groupPreferences.pageSize },
  });

  const resourceHeaderCounter = resourceFilterProps.filteringText ? `(${filteredResourcesCount}/${resources.length})` : `(${resources.length})`;
  const groupHeaderCounter = groupFilterProps.filteringText ? `(${filteredGroupsCount}/${groups.length})` : `(${groups.length})`;

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={t("cluster.ha.pageDescription")}>
        {t("cluster.ha.pageTitle")}
      </Header>

      {flashItems.length > 0 ? (
        <Flashbar items={flashItems.map((item) => ({ ...item, onDismiss: item.id ? () => dismissFlash(item.id as string) : undefined }))} />
      ) : null}

      {error ? (
        <Alert type="error" header={t("cluster.ha.failedToLoad")}>
          {error}
        </Alert>
      ) : null}

      <Alert type="info">{t("cluster.ha.legacyGroupsNotice")} <Link href="/api-explorer">{t("cluster.ha.affinityRulesLink")}</Link></Alert>
      <Tabs
        activeTabId={activeTabId}
        onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
        tabs={[
          {
            id: "resources",
            label: t("cluster.ha.resourcesTab"),
            content: (
              <Table
                {...resourceCollectionProps}
                items={resourceItems}
                columnDefinitions={resourceColumns}
                variant="full-page"
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                trackBy="sid"
                loading={loading}
                loadingText={t("cluster.ha.loadingResources")}
                empty={resourceFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("cluster.ha.noResourcesMatch"), <Button onClick={() => resourceActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : resourceEmptyState}
                wrapLines={resourcePreferences.wrapLines}
                stripedRows={resourcePreferences.stripedRows}
                contentDensity={resourcePreferences.contentDensity}
                columnDisplay={resourcePreferences.contentDisplay}
                header={
                  <Header
                    counter={resourceHeaderCounter}
                    description={t("cluster.ha.resourcesDescription")}
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button variant="primary" onClick={() => { setSelectedResource(null); setResourceForm(EMPTY_RESOURCE_FORM); setCreateResourceVisible(true); }}>{t("cluster.ha.addResource")}</Button>
                        <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
                      </SpaceBetween>
                    }
                  >
                    {t("cluster.ha.resourcesTab")}
                  </Header>
                }
                filter={<TextFilter {...resourceFilterProps} filteringPlaceholder={t("cluster.ha.findResources")} countText={`${filteredResourcesCount ?? resources.length} ${t("common.matches")}`} />}
                pagination={<Pagination {...resourcePaginationProps} />}
                preferences={
                  <CollectionPreferences
                    title={t("common.preferences")}
                    confirmLabel={t("common.confirm")}
                    cancelLabel={t("common.cancel")}
                    preferences={resourcePreferences}
                    onConfirm={({ detail }) => updatePreferences(detail, setResourcePreferences)}
                    pageSizePreference={{ title: t("common.pageSize"), options: [{ value: 10, label: t("cluster.ha.resourcesCount10") }, { value: 20, label: t("cluster.ha.resourcesCount20") }, { value: 50, label: t("cluster.ha.resourcesCount50") }] }}
                    wrapLinesPreference={{ label: t("common.wrapLines"), description: t("cluster.ha.wrapLinesDesc") }}
                    stripedRowsPreference={{ label: t("common.stripedRows"), description: t("cluster.ha.stripedRowsDesc") }}
                    contentDensityPreference={{ label: t("common.contentDensity"), description: t("cluster.ha.contentDensityDesc") }}
                    contentDisplayPreference={{
                      title: t("common.columnPreferences"),
                      options: [
                        { id: "sid", label: t("cluster.ha.sid"), alwaysVisible: true },
                        { id: "state", label: t("cluster.ha.state") },
                        { id: "status", label: t("cluster.ha.status") },
                        { id: "requestState", label: t("cluster.ha.requestState") },
                        { id: "node", label: t("cluster.ha.node") },
                        { id: "maxRelocate", label: t("cluster.ha.maxRelocate") },
                        { id: "maxRestart", label: t("cluster.ha.maxRestart") },
                        { id: "group", label: t("cluster.ha.group") },
                        { id: "comment", label: t("cluster.ha.comment") },
                        { id: "actions", label: t("common.actions") },
                      ],
                    }}
                  />
                }
              />
            ),
          },
          {
            id: "groups",
            label: t("cluster.ha.groupsTab"),
            content: (
              <Table
                {...groupCollectionProps}
                items={groupItems}
                columnDefinitions={groupColumns}
                variant="full-page"
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                trackBy="group"
                loading={loading}
                loadingText={t("cluster.ha.loadingGroups")}
                empty={groupFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("cluster.ha.noGroupsMatch"), <Button onClick={() => groupActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : groupEmptyState}
                wrapLines={groupPreferences.wrapLines}
                stripedRows={groupPreferences.stripedRows}
                contentDensity={groupPreferences.contentDensity}
                columnDisplay={groupPreferences.contentDisplay}
                header={
                  <Header
                    counter={groupHeaderCounter}
                    description={t("cluster.ha.groupsDescription")}
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button variant="primary" onClick={() => { setSelectedGroup(null); setGroupForm(EMPTY_GROUP_FORM); setCreateGroupVisible(true); }}>{t("cluster.ha.createGroup")}</Button>
                        <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
                      </SpaceBetween>
                    }
                  >
                    {t("cluster.ha.groupsTab")}
                  </Header>
                }
                filter={<TextFilter {...groupFilterProps} filteringPlaceholder={t("cluster.ha.findGroups")} countText={`${filteredGroupsCount ?? groups.length} ${t("common.matches")}`} />}
                pagination={<Pagination {...groupPaginationProps} />}
                preferences={
                  <CollectionPreferences
                    title={t("common.preferences")}
                    confirmLabel={t("common.confirm")}
                    cancelLabel={t("common.cancel")}
                    preferences={groupPreferences}
                    onConfirm={({ detail }) => updatePreferences(detail, setGroupPreferences)}
                    pageSizePreference={{ title: t("common.pageSize"), options: [{ value: 10, label: t("cluster.ha.groupsCount10") }, { value: 20, label: t("cluster.ha.groupsCount20") }, { value: 50, label: t("cluster.ha.groupsCount50") }] }}
                    wrapLinesPreference={{ label: t("common.wrapLines"), description: t("cluster.ha.wrapLinesDesc") }}
                    stripedRowsPreference={{ label: t("common.stripedRows"), description: t("cluster.ha.stripedRowsDesc") }}
                    contentDensityPreference={{ label: t("common.contentDensity"), description: t("cluster.ha.contentDensityDesc") }}
                    contentDisplayPreference={{
                      title: t("common.columnPreferences"),
                      options: [
                        { id: "group", label: t("cluster.ha.group"), alwaysVisible: true },
                        { id: "nodes", label: t("cluster.ha.nodes") },
                        { id: "restricted", label: t("cluster.ha.restricted") },
                        { id: "nofailback", label: t("cluster.ha.noFailback") },
                        { id: "comment", label: t("cluster.ha.comment") },
                        { id: "actions", label: t("common.actions") },
                      ],
                    }}
                  />
                }
              />
            ),
          },
        ]}
      />

      <Modal
        visible={createResourceVisible}
        onDismiss={() => setCreateResourceVisible(false)}
        header={t("cluster.ha.addResourceModalTitle")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setCreateResourceVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={resourceSubmitting} onClick={() => void submitResource("create")}>{t("common.create")}</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          {error ? <Alert type="error">{error}</Alert> : null}
          <FormField label={t("cluster.ha.resourceSid")}><Input value={resourceForm.sid} placeholder={t("cluster.ha.resourceSidPlaceholder")} onChange={({ detail }) => setResourceForm((current) => ({ ...current, sid: detail.value }))} /></FormField>
          <FormField label={t("cluster.ha.maxRestart")}><Input value={resourceForm.maxRestart} onChange={({ detail }) => setResourceForm((current) => ({ ...current, maxRestart: detail.value }))} /></FormField>
          <FormField label={t("cluster.ha.maxRelocate")}><Input value={resourceForm.maxRelocate} onChange={({ detail }) => setResourceForm((current) => ({ ...current, maxRelocate: detail.value }))} /></FormField>
          <FormField label={t("cluster.ha.group")}><Select selectedOption={groupOptions.find((option) => option.value === resourceForm.group) ?? null} options={groupOptions} placeholder={t("cluster.ha.selectGroup")} onChange={({ detail }) => setResourceForm((current) => ({ ...current, group: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "" }))} /></FormField>
          <FormField label={t("cluster.ha.state")}><Select selectedOption={stateOptions.find((option) => option.value === resourceForm.state) ?? null} options={stateOptions} placeholder={t("cluster.ha.selectState")} onChange={({ detail }) => setResourceForm((current) => ({ ...current, state: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "started" }))} /></FormField>
          <FormField label={t("cluster.ha.comment")}><Textarea value={resourceForm.comment} placeholder={t("cluster.ha.commentPlaceholder")} onChange={({ detail }) => setResourceForm((current) => ({ ...current, comment: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={editResourceVisible}
        onDismiss={() => setEditResourceVisible(false)}
        header={t("cluster.ha.editResourceModalTitle")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setEditResourceVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={resourceSubmitting} onClick={() => void submitResource("edit")}>{t("common.save")}</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          {error ? <Alert type="error">{error}</Alert> : null}
          <FormField label={t("cluster.ha.resourceSid")}><Input value={resourceForm.sid} disabled /></FormField>
          <FormField label={t("cluster.ha.maxRestart")}><Input value={resourceForm.maxRestart} onChange={({ detail }) => setResourceForm((current) => ({ ...current, maxRestart: detail.value }))} /></FormField>
          <FormField label={t("cluster.ha.maxRelocate")}><Input value={resourceForm.maxRelocate} onChange={({ detail }) => setResourceForm((current) => ({ ...current, maxRelocate: detail.value }))} /></FormField>
          <FormField label={t("cluster.ha.group")}><Select selectedOption={groupOptions.find((option) => option.value === resourceForm.group) ?? null} options={groupOptions} placeholder={t("cluster.ha.selectGroup")} onChange={({ detail }) => setResourceForm((current) => ({ ...current, group: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "" }))} /></FormField>
          <FormField label={t("cluster.ha.state")}><Select selectedOption={stateOptions.find((option) => option.value === resourceForm.state) ?? null} options={stateOptions} placeholder={t("cluster.ha.selectState")} onChange={({ detail }) => setResourceForm((current) => ({ ...current, state: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "started" }))} /></FormField>
          <FormField label={t("cluster.ha.comment")}><Textarea value={resourceForm.comment} placeholder={t("cluster.ha.commentPlaceholder")} onChange={({ detail }) => setResourceForm((current) => ({ ...current, comment: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={deleteResourceVisible}
        onDismiss={() => setDeleteResourceVisible(false)}
        header={t("cluster.ha.removeResourceModalTitle")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setDeleteResourceVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={resourceSubmitting} onClick={() => void deleteResource()}>{t("common.delete")}</Button></SpaceBetween></Box>}
      >
        <Box>{selectedResource ? interpolate(t("cluster.ha.removeResourceConfirmation"), { sid: selectedResource.sid }) : null}</Box>
      </Modal>

      <Modal
        visible={createGroupVisible}
        onDismiss={() => setCreateGroupVisible(false)}
        header={t("cluster.ha.createGroupModalTitle")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setCreateGroupVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={groupSubmitting} onClick={() => void submitGroup("create")}>{t("common.create")}</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          {error ? <Alert type="error">{error}</Alert> : null}
          <FormField label={t("cluster.ha.groupName")}><Input value={groupForm.group} placeholder={t("cluster.ha.groupNamePlaceholder")} onChange={({ detail }) => setGroupForm((current: GroupFormState) => ({ ...current, group: detail.value }))} /></FormField>
          <FormField label={t("cluster.ha.nodes")} description={t("cluster.ha.nodesHelp")}><Input value={groupForm.nodes} placeholder={t("cluster.ha.nodesPlaceholder")} onChange={({ detail }) => setGroupForm((current) => ({ ...current, nodes: detail.value }))} /></FormField>
          <FormField label={t("cluster.ha.comment")}><Textarea value={groupForm.comment} placeholder={t("cluster.ha.commentPlaceholder")} onChange={({ detail }) => setGroupForm((current) => ({ ...current, comment: detail.value }))} /></FormField>
          <Checkbox checked={groupForm.restricted} onChange={({ detail }) => setGroupForm((current) => ({ ...current, restricted: detail.checked }))}>{t("cluster.ha.restrictedLabel")}</Checkbox>
          <Checkbox checked={groupForm.nofailback} onChange={({ detail }) => setGroupForm((current) => ({ ...current, nofailback: detail.checked }))}>{t("cluster.ha.noFailbackLabel")}</Checkbox>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={editGroupVisible}
        onDismiss={() => setEditGroupVisible(false)}
        header={t("cluster.ha.editGroupModalTitle")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setEditGroupVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={groupSubmitting} onClick={() => void submitGroup("edit")}>{t("common.save")}</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          {error ? <Alert type="error">{error}</Alert> : null}
          <FormField label={t("cluster.ha.groupName")}><Input value={groupForm.group} disabled /></FormField>
          <FormField label={t("cluster.ha.nodes")} description={t("cluster.ha.nodesHelp")}><Input value={groupForm.nodes} placeholder={t("cluster.ha.nodesPlaceholder")} onChange={({ detail }) => setGroupForm((current) => ({ ...current, nodes: detail.value }))} /></FormField>
          <FormField label={t("cluster.ha.comment")}><Textarea value={groupForm.comment} placeholder={t("cluster.ha.commentPlaceholder")} onChange={({ detail }) => setGroupForm((current) => ({ ...current, comment: detail.value }))} /></FormField>
          <Checkbox checked={groupForm.restricted} onChange={({ detail }) => setGroupForm((current) => ({ ...current, restricted: detail.checked }))}>{t("cluster.ha.restrictedLabel")}</Checkbox>
          <Checkbox checked={groupForm.nofailback} onChange={({ detail }) => setGroupForm((current) => ({ ...current, nofailback: detail.checked }))}>{t("cluster.ha.noFailbackLabel")}</Checkbox>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={deleteGroupVisible}
        onDismiss={() => setDeleteGroupVisible(false)}
        header={t("cluster.ha.deleteGroupModalTitle")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setDeleteGroupVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={groupSubmitting} onClick={() => void deleteGroup()}>{t("common.delete")}</Button></SpaceBetween></Box>}
      >
        <Box>{selectedGroup ? interpolate(t("cluster.ha.deleteGroupConfirmation"), { group: selectedGroup.group }) : null}</Box>
      </Modal>
    </SpaceBetween>
  );
}
