"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";

import { formatResourceBytes as formatBytes, parseClusterJoinInfo, buildClusterJoinParameters } from "@/app/lib/resource-api";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@/app/components/app-link";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import TextFilter from "@cloudscape-design/components/text-filter";
import type { CollectionPreferencesProps } from "@cloudscape-design/components/collection-preferences";
import { useTranslation } from "@/app/lib/use-translation";

interface PveNode {
  node: string;
  status: "online" | "offline" | "unknown";
  cpu?: number;
  maxcpu?: number;
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

interface JoinClusterForm {
  joinInfo: string;
  hostname: string;
  password: string;
  fingerprint: string;
  links: Record<string, string>;
}

interface JoinClusterErrors {
  joinInfo?: string;
  hostname?: string;
  password?: string;
  fingerprint?: string;
}

const DEFAULT_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "node", visible: true },
    { id: "status", visible: true },
    { id: "cpu", visible: true },
    { id: "memory", visible: true },
    { id: "disk", visible: true },
    { id: "uptime", visible: true },
    { id: "actions", visible: true },
  ],
};



function formatUptime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h`;
}

function getStatusType(status: PveNode["status"]) {
  return status === "online" ? "success" : "error";
}

async function fetchProxmox<T>(path: string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

const DEFAULT_JOIN_CLUSTER_FORM: JoinClusterForm = {
  joinInfo: "",
  hostname: "",
  password: "",
  fingerprint: "",
  links: {},
};

export default function NodesPage() {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<PveNode[]>([]);
  const [selectedItems, setSelectedItems] = useState<PveNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [joinClusterModalVisible, setJoinClusterModalVisible] = useState(false);
  const [joinClusterForm, setJoinClusterForm] = useState<JoinClusterForm>(DEFAULT_JOIN_CLUSTER_FORM);
  const [joinClusterErrors, setJoinClusterErrors] = useState<JoinClusterErrors>({});
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [wolLoadingNodes, setWolLoadingNodes] = useState<string[]>([]);

  const pushFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashbarItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
  }, []);

  const parsedJoinInfo = useMemo(() => {
    try { return parseClusterJoinInfo(joinClusterForm.joinInfo); }
    catch { return null; }
  }, [joinClusterForm.joinInfo]);

  const loadNodes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchProxmox<PveNode[]>("/api/proxmox/nodes");
      const nextNodes = data ?? [];
      setNodes(nextNodes);
      setSelectedItems((current) => {
        const nodeNames = new Set(nextNodes.map((node) => node.node));
        return current.filter((node) => nodeNames.has(node.node)).map((node) => nextNodes.find((item) => item.node === node.node) ?? node);
      });
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("nodes.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const offlineSelectedItems = useMemo(() => selectedItems.filter((item) => item.status === "offline"), [selectedItems]);
  const canWakeSelected = selectedItems.length > 0 && offlineSelectedItems.length === selectedItems.length && wolLoadingNodes.length === 0 && !joinLoading;

  const handleJoinInfoChange = useCallback((value: string) => {
    try {
      const parsed = parseClusterJoinInfo(value);
      setJoinClusterForm((current) => ({ ...current, joinInfo: value, hostname: parsed?.hostname ?? current.hostname, fingerprint: parsed?.fingerprint ?? current.fingerprint, links: {} }));
      setJoinClusterErrors({});
    } catch {
      setJoinClusterForm((current) => ({ ...current, joinInfo: value }));
      setJoinClusterErrors((current) => ({ ...current, joinInfo: t("nodes.joinInformationInvalid") }));
    }
  }, [t]);

  const closeJoinClusterModal = useCallback(() => {
    setJoinClusterModalVisible(false);
    setJoinClusterForm(DEFAULT_JOIN_CLUSTER_FORM);
    setJoinClusterErrors({});
  }, []);

  const openJoinClusterModal = useCallback(() => {
    setJoinClusterForm(DEFAULT_JOIN_CLUSTER_FORM);
    setJoinClusterErrors({});
    setJoinRequestError(null);
    setJoinClusterModalVisible(true);
  }, []);

  const submitJoinCluster = useCallback(async () => {
    const nextErrors: JoinClusterErrors = {};
    const joinInfo = joinClusterForm.joinInfo.trim();
    const hostname = joinClusterForm.hostname.trim();
    const password = joinClusterForm.password;
    const fingerprint = joinClusterForm.fingerprint.trim();

    if (joinInfo && !parsedJoinInfo) {
      nextErrors.joinInfo = t("nodes.joinInformationInvalid");
    }
    if (!hostname) {
      nextErrors.hostname = t("nodes.peerHostnameRequired");
    }
    if (!password) {
      nextErrors.password = t("nodes.joinPasswordRequired");
    }
    if (!fingerprint) {
      nextErrors.fingerprint = t("nodes.joinFingerprintRequired");
    }

    if (Object.keys(nextErrors).length > 0) {
      setJoinClusterErrors(nextErrors);
      return;
    }

    try {
      setJoinLoading(true);
      setJoinRequestError(null);
      setJoinClusterErrors({});

      const body = buildClusterJoinParameters(joinClusterForm, parsedJoinInfo);

      await fetchProxmox("/api/proxmox/cluster/config/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodes.joinSuccess"),
        dismissible: true,
        id: "nodes-join-success",
      });

      closeJoinClusterModal();
      await loadNodes();
    } catch (joinError) {
      const message = joinError instanceof Error ? joinError.message : t("nodes.joinFailed");
      setJoinRequestError(message);
      pushFlash({
        type: "error",
        content: message || t("nodes.joinFailed"),
        dismissible: true,
        id: "nodes-join-failed",
      });
    } finally {
      setJoinLoading(false);
    }
  }, [closeJoinClusterModal, joinClusterForm, loadNodes, parsedJoinInfo, pushFlash, t]);

  const runWakeOnLan = useCallback(async (targetNodes: PveNode[]) => {
    if (targetNodes.length === 0) {
      return;
    }

    const offlineNodes = targetNodes.filter((item) => item.status === "offline");
    if (offlineNodes.length === 0) {
      return;
    }

    try {
      setWolLoadingNodes((current) => [...new Set([...current, ...offlineNodes.map((item) => item.node)])]);

      const results = await Promise.allSettled(
        offlineNodes.map((item) =>
          fetchProxmox(`/api/proxmox/nodes/${item.node}/wakeonlan`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams().toString(),
          }),
        ),
      );

      results.forEach((result, index) => {
        const target = offlineNodes[index].node;
        pushFlash({
          type: result.status === "fulfilled" ? "success" : "error",
          content: result.status === "fulfilled" ? t("nodes.wolSuccess").replace("{node}", target) : `${target}: ${result.reason instanceof Error ? result.reason.message : t("nodes.wolFailed")}`,
          dismissible: true,
          id: `nodes-wol-${target}`,
        });
      });

      await loadNodes();
    } catch (wolError) {
      const message = wolError instanceof Error ? wolError.message : t("nodes.wolFailed");
      pushFlash({
        type: "error",
        content: message || t("nodes.wolFailed"),
        dismissible: true,
        id: "nodes-wol-failed",
      });
    } finally {
      setWolLoadingNodes((current) => current.filter((node) => !offlineNodes.some((item) => item.node === node)));
    }
  }, [loadNodes, pushFlash, t]);

  useResourceTaskRefresh(loadNodes);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadNodes();
  }, [loadNodes]);

  const columnDefinitions = useMemo<TableProps<PveNode>["columnDefinitions"]>(
    () => [
      {
        id: "node",
        header: t("common.name"),
        cell: ({ node }) => <Link href={`/nodes/${node}`}>{node}</Link>,
        sortingField: "node",
        isRowHeader: true,
        minWidth: 180,
      },
      {
        id: "status",
        header: t("common.status"),
        cell: ({ status }) => <StatusIndicator type={getStatusType(status)}>{status === "online" ? t("common.online") : t("common.offline")}</StatusIndicator>,
        sortingField: "status",
        minWidth: 140,
      },
      {
        id: "cpu",
        header: t("common.cpuPercent"),
        cell: ({ cpu }) => cpu !== undefined && Number.isFinite(cpu) ? `${(cpu * 100).toFixed(1)}%` : "-",
        sortingComparator: (a, b) => (a.cpu ?? 0) - (b.cpu ?? 0),
        minWidth: 120,
      },
      {
        id: "memory",
        header: t("common.memory"),
        cell: ({ mem, maxmem }) => `${formatBytes(mem)} / ${formatBytes(maxmem)}`,
        sortingComparator: (a, b) => (a.mem ?? 0) - (b.mem ?? 0),
        minWidth: 220,
      },
      {
        id: "disk",
        header: t("common.disk"),
        cell: ({ disk, maxdisk }) => `${formatBytes(disk)} / ${formatBytes(maxdisk)}`,
        sortingComparator: (a, b) => (a.disk ?? 0) - (b.disk ?? 0),
        minWidth: 220,
      },
      {
        id: "uptime",
        header: t("common.uptime"),
        cell: ({ uptime }) => formatUptime(uptime),
        sortingComparator: (a, b) => (a.uptime ?? 0) - (b.uptime ?? 0),
        minWidth: 140,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (item) => item.status === "offline" ? (
          <Button
            onClick={() => void runWakeOnLan([item])}
            loading={wolLoadingNodes.includes(item.node)}
            disabled={joinLoading}
          >
            {t("nodes.wakeOnLan")}
          </Button>
        ) : (
          "-"
        ),
        minWidth: 180,
      },
    ],
    [joinLoading, runWakeOnLan, t, wolLoadingNodes],
  );

  const emptyState = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("nodes.noNodes")}</b>
        <Box variant="p" color="inherit">
          {t("nodes.noNodesAvailable")}
        </Box>
        <Button onClick={() => void loadNodes()}>{t("common.refresh")}</Button>
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
  } = useCollection(nodes, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return [
          item.node,
          item.status,
          item.cpu !== undefined && Number.isFinite(item.cpu) ? `${(item.cpu * 100).toFixed(1)}%` : "-",
          `${formatBytes(item.mem)} / ${formatBytes(item.maxmem)}`,
          `${formatBytes(item.disk)} / ${formatBytes(item.maxdisk)}`,
          formatUptime(item.uptime),
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: emptyState,
      noMatch: (
        <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
          <SpaceBetween size="m">
            <b>{t("common.noMatches")}</b>
            <Box variant="p" color="inherit">
              {t("nodes.noNodesMatch")}
            </Box>
            {/* eslint-disable-next-line react-hooks/immutability -- Cloudscape calls this event handler only after useCollection has returned its actions. */}
            <Button onClick={() => actions.setFiltering("")}>{t("common.clearFilter")}</Button>
          </SpaceBetween>
        </Box>
      ),
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

  const noMatch = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("common.noMatches")}</b>
        <Box variant="p" color="inherit">
          {t("nodes.noNodesMatch")}
        </Box>
        <Button onClick={() => actions.setFiltering("")}>{t("common.clearFilter")}</Button>
      </SpaceBetween>
    </Box>
  );

  const headerCounter = filterProps.filteringText ? `(${filteredItemsCount}/${nodes.length})` : `(${nodes.length})`;

  return (
    <SpaceBetween size="m">
      {flashbarItems.length > 0 ? <Flashbar items={flashbarItems.map((item) => ({ ...item, onDismiss: item.onDismiss ?? (() => setFlashbarItems((current) => current.filter((entry) => entry.id !== item.id))) }))} /> : null}
      {error ? (
        <Alert type="error" header={t("nodes.failedToLoad")}>
          {error}
        </Alert>
      ) : null}
      <Modal
        visible={joinClusterModalVisible}
        onDismiss={() => { if (!joinLoading) closeJoinClusterModal(); }}
        header={t("nodes.joinClusterModalTitle")}
        closeAriaLabel={t("nodes.joinClusterModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" disabled={joinLoading} onClick={closeJoinClusterModal}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={joinLoading} onClick={() => void submitJoinCluster()}>
                {t("common.save")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {joinRequestError ? <Alert type="error">{joinRequestError}</Alert> : null}
          <Box color="text-body-secondary">{t("nodes.joinClusterDescription")}</Box>
          <FormField
            label={t("nodes.clusterJoinLink")}
            errorText={joinClusterErrors.joinInfo}
          >
            <Textarea
              value={joinClusterForm.joinInfo}
              placeholder={t("nodes.clusterJoinLinkPlaceholder")}
              onChange={({ detail }) => handleJoinInfoChange(detail.value)}
            />
          </FormField>
          {(parsedJoinInfo?.links ?? [0]).map((number) => <FormField
            key={number}
            label={t("nodes.localClusterLink").replace("{number}", String(number))}
            description={parsedJoinInfo?.requiredLinks.includes(number) ? t("nodes.localClusterLinkRequired") : t("nodes.localClusterLinkOptional")}
          >
            <Input value={joinClusterForm.links[String(number)] ?? ""} placeholder="192.168.1.2" onChange={({ detail }) => setJoinClusterForm((current) => ({ ...current, links: { ...current.links, [number]: detail.value } }))} />
          </FormField>)}
          <FormField
            label={t("nodes.peerHostname")}
            errorText={joinClusterErrors.hostname}
          >
            <Input
              value={joinClusterForm.hostname}
              placeholder={t("nodes.peerHostnamePlaceholder")}
              onChange={({ detail }) => {
                setJoinClusterForm((current) => ({ ...current, hostname: detail.value }));
                setJoinClusterErrors((current) => ({ ...current, hostname: undefined }));
              }}
            />
          </FormField>
          <FormField
            label={t("nodes.joinPassword")}
            errorText={joinClusterErrors.password}
          >
            <Input
              type="password"
              value={joinClusterForm.password}
              placeholder={t("nodes.joinPasswordPlaceholder")}
              onChange={({ detail }) => {
                setJoinClusterForm((current) => ({ ...current, password: detail.value }));
                setJoinClusterErrors((current) => ({ ...current, password: undefined }));
              }}
            />
          </FormField>
          <FormField
            label={t("nodes.joinFingerprint")}
            errorText={joinClusterErrors.fingerprint}
          >
            <Input
              value={joinClusterForm.fingerprint}
              placeholder={t("nodes.joinFingerprintPlaceholder")}
              onChange={({ detail }) => {
                setJoinClusterForm((current) => ({ ...current, fingerprint: detail.value }));
                setJoinClusterErrors((current) => ({ ...current, fingerprint: undefined }));
              }}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
      <Table
        {...collectionProps}
        items={items}
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
        selectionType="multi"
        columnDefinitions={columnDefinitions}
        variant="full-page"
        stickyHeader
        stickyColumns={{ first: 1 }}
        resizableColumns
        enableKeyboardNavigation
        trackBy="node"
        loading={loading}
        loadingText={t("nodes.loading")}
        empty={filterProps.filteringText ? noMatch : emptyState}
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        columnDisplay={preferences.contentDisplay}
        header={
          <Header
            variant="h1"
            counter={headerCounter}
            description={t("nodes.manageDescription")}
            actions={
              <SpaceBetween size="xs" direction="horizontal">
                <Button loading={wolLoadingNodes.length > 0} disabled={!canWakeSelected} onClick={() => void runWakeOnLan(offlineSelectedItems)}>
                  {t("nodes.wakeOnLan")}
                </Button>
                <Button iconName="refresh" ariaLabel={t("common.refresh")} disabled={joinLoading || wolLoadingNodes.length > 0} onClick={() => void loadNodes()} />
                <Button variant="primary" disabled={joinLoading || wolLoadingNodes.length > 0} onClick={openJoinClusterModal}>{t("nodes.joinCluster")}</Button>
              </SpaceBetween>
            }
          >
            {t("nodes.nodes")}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder={t("nodes.findPlaceholder")}
            countText={`${filteredItemsCount ?? nodes.length} ${t("common.matches")}`}
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
                 { value: 10, label: `10 ${t("nodes.nodesLabel")}` },
                 { value: 20, label: `20 ${t("nodes.nodesLabel")}` },
                 { value: 50, label: `50 ${t("nodes.nodesLabel")}` },
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
                { id: "node", label: t("common.name"), alwaysVisible: true },
                { id: "status", label: t("common.status") },
                { id: "cpu", label: t("common.cpuPercent") },
                { id: "memory", label: t("common.memory") },
                { id: "disk", label: t("common.disk") },
                { id: "uptime", label: t("common.uptime") },
                { id: "actions", label: t("common.actions") },
              ],
            }}
          />
        }
      />
    </SpaceBetween>
  );
}
