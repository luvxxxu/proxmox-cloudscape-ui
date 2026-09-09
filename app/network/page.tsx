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
import TextFilter from "@cloudscape-design/components/text-filter";
import Textarea from "@cloudscape-design/components/textarea";
import Toggle from "@cloudscape-design/components/toggle";
import { useTranslation } from "@/app/lib/use-translation";
import { collectResourceResults, formatNetworkCidr as formatAddressCidr, parseNetworkIpv4 as parseIpv4Cidr } from "@/app/lib/resource-api";

interface PveNode {
  node: string;
  status: "online" | "offline" | "unknown";
}

interface PveNetwork {
  iface: string;
  node: string;
  type: string;
  active?: number;
  address?: string;
  netmask?: string;
  cidr?: string;
  gateway?: string;
  bridge_ports?: string;
  autostart?: number;
  comments?: string;
  slaves?: string;
  bond_mode?: string;
  vlan_raw_device?: string;
  vlan_id?: number | string;
  "vlan-raw-device"?: string;
  "vlan-id"?: number | string;
}

interface Preferences {
  pageSize: number;
  wrapLines: boolean;
  stripedRows: boolean;
  contentDensity: "comfortable" | "compact";
  contentDisplay: ReadonlyArray<CollectionPreferencesProps.ContentDisplayItem>;
}

type NetworkFormType = string;

interface NetworkFormState {
  node: string;
  iface: string;
  type: NetworkFormType;
  ipv4Cidr: string;
  gateway: string;
  autostart: boolean;
  comments: string;
  bridgePorts: string;
  bondSlaves: string;
  bondMode: string;
  vlanRawDevice: string;
  vlanTag: string;
}

const DEFAULT_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "iface", visible: true },
    { id: "node", visible: true },
    { id: "type", visible: true },
    { id: "active", visible: true },
    { id: "address", visible: true },
    { id: "netmask", visible: true },
    { id: "gateway", visible: true },
    { id: "bridge_ports", visible: true },
    { id: "autostart", visible: true },
    { id: "actions", visible: true },
  ],
};

const BOND_MODE_VALUES = [
  "balance-rr",
  "active-backup",
  "balance-xor",
  "broadcast",
  "802.3ad",
  "balance-tlb",
  "balance-alb",
] as const;

const EMPTY_FORM: NetworkFormState = {
  node: "",
  iface: "",
  type: "bridge",
  ipv4Cidr: "",
  gateway: "",
  autostart: true,
  comments: "",
  bridgePorts: "",
  bondSlaves: "",
  bondMode: "active-backup",
  vlanRawDevice: "",
  vlanTag: "",
};

function formatActive(active?: number) {
  return active === 1;
}

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}



function getOptionValue(option: SelectProps.Option | null) {
  return typeof option?.value === "string" ? option.value : "";
}

function encodeFormBody(params: URLSearchParams) {
  return {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params.toString(),
  };
}

function buildFormState(network?: PveNetwork): NetworkFormState {
  if (!network) {
    return EMPTY_FORM;
  }

  return {
    node: network.node,
    iface: network.iface,
    type: network.type,
    ipv4Cidr: formatAddressCidr(network),
    gateway: network.gateway ?? "",
    autostart: network.autostart === 1,
    comments: network.comments ?? "",
    bridgePorts: network.bridge_ports ?? "",
    bondSlaves: network.slaves ?? "",
    bondMode: network.bond_mode ?? "active-backup",
    vlanRawDevice: network.vlan_raw_device ?? network["vlan-raw-device"] ?? "",
    vlanTag: String(network.vlan_id ?? network["vlan-id"] ?? ""),
  };
}

function appendDeleteFields(params: URLSearchParams, deleteFields: string[]) {
  if (deleteFields.length > 0) {
    params.set("delete", deleteFields.join(","));
  }
}

function getTypeLabel(type: string, t: (key: string) => string) {
  switch (type) {
    case "bond":
      return t("network.linuxBond");
    case "vlan":
      return t("network.linuxVlan");
    case "bridge":
      return t("network.linuxBridge");
    default:
      return type;
  }
}

async function fetchProxmox<T>(path: string, _t: (key: string) => string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function NetworkPage() {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<PveNode[]>([]);
  const [interfaces, setInterfaces] = useState<PveNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [applyVisible, setApplyVisible] = useState(false);
  const [selectedInterface, setSelectedInterface] = useState<PveNetwork | null>(null);
  const [formState, setFormState] = useState<NetworkFormState>(EMPTY_FORM);
  const [applyNode, setApplyNode] = useState<SelectProps.Option | null>(null);

  const addFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 5));
  }, []);

  const dismissFlash = useCallback((id: string) => {
    setFlashItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const loadInterfaces = useCallback(async () => {
    try {
      setLoading(true);
      const nextNodes = await fetchProxmox<PveNode[]>("/api/proxmox/nodes", t);
      const onlineNodes = (nextNodes ?? []).filter((node) => node.status === "online");
      const networkLists = await Promise.allSettled(
        onlineNodes.map(async ({ node }) => {
          const entries = await fetchProxmox<Omit<PveNetwork, "node">[]>(`/api/proxmox/nodes/${node}/network`, t);
          return (entries ?? []).map((entry) => ({ ...entry, node }));
        }),
      );
      setNodes(onlineNodes);
      const result = collectResourceResults(networkLists, onlineNodes.map((node) => node.node));
      setInterfaces(result.values);
      setError(result.errors.length ? result.errors.join("; ") : null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("network.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useResourceTaskRefresh(loadInterfaces);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadInterfaces();
  }, [loadInterfaces]);

  const nodeOptions = useMemo<SelectProps.Option[]>(
    () => nodes.map((node) => ({ label: node.node, value: node.node })),
    [nodes],
  );

  const typeOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("network.linuxBridge"), value: "bridge" },
      { label: t("network.linuxBond"), value: "bond" },
      { label: t("network.linuxVlan"), value: "vlan" },
    ],
    [t],
  );

  const bondModeOptions = useMemo<SelectProps.Option[]>(
    () => BOND_MODE_VALUES.map((mode) => ({ label: t(`network.bondModeOption.${mode}`), value: mode })),
    [t],
  );

  const columnDefinitions = useMemo<TableProps<PveNetwork>["columnDefinitions"]>(
    () => [
      {
        id: "iface",
        header: t("network.interfaceName"),
        cell: ({ iface }) => iface,
        sortingField: "iface",
        isRowHeader: true,
        minWidth: 180,
      },
      {
        id: "node",
        header: t("network.node"),
        cell: ({ node }) => node,
        sortingField: "node",
        minWidth: 140,
      },
      {
        id: "type",
        header: t("network.type"),
        cell: ({ type }) => getTypeLabel(type, t),
        sortingComparator: (a, b) => getTypeLabel(a.type, t).localeCompare(getTypeLabel(b.type, t)),
        minWidth: 140,
      },
      {
        id: "active",
        header: t("network.active"),
        cell: ({ active }) => (
          <StatusIndicator type={formatActive(active) ? "success" : "stopped"}>
            {formatActive(active) ? t("network.active") : t("network.inactive")}
          </StatusIndicator>
        ),
        sortingComparator: (a, b) => (a.active ?? 0) - (b.active ?? 0),
        minWidth: 140,
      },
      {
        id: "address",
        header: t("network.address"),
        cell: ({ address }) => address ?? "-",
        minWidth: 180,
      },
      {
        id: "netmask",
        header: t("network.netmaskCidr"),
        cell: ({ netmask, cidr }) => netmask ?? cidr ?? "-",
        minWidth: 160,
      },
      {
        id: "gateway",
        header: t("network.gateway"),
        cell: ({ gateway }) => gateway ?? "-",
        minWidth: 180,
      },
      {
        id: "bridge_ports",
        header: t("network.bridgePorts"),
        cell: ({ bridge_ports }) => bridge_ports ?? "-",
        minWidth: 180,
      },
      {
        id: "autostart",
        header: t("network.autostart"),
        cell: ({ autostart }) => (autostart === 1 ? t("network.yes") : t("network.no")),
        sortingComparator: (a, b) => (a.autostart ?? 0) - (b.autostart ?? 0),
        minWidth: 140,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (item) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="inline-link" onClick={() => {
              setSelectedInterface(item);
              setFormState(buildFormState(item));
              setActionError(null);
              setEditVisible(true);
            }}>
              {t("network.editInterface")}
            </Button>
            <Button variant="inline-link" onClick={() => {
              setSelectedInterface(item);
              setActionError(null);
              setDeleteVisible(true);
            }}>
              {t("network.deleteInterface")}
            </Button>
          </SpaceBetween>
        ),
        minWidth: 160,
      },
    ],
    [t],
  );

  const emptyState = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("network.noInterfaces")}</b>
        <Box variant="p" color="inherit">
          {t("network.noInterfacesAvailable")}
        </Box>
        <Button onClick={() => void loadInterfaces()}>{t("common.refresh")}</Button>
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
  } = useCollection(interfaces, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return [
          item.iface,
          item.node,
          getTypeLabel(item.type, t),
          formatActive(item.active) ? "active" : "inactive",
          item.address ?? "",
          item.netmask ?? item.cidr ?? "",
          item.gateway ?? "",
          item.bridge_ports ?? "",
          item.autostart === 1 ? "yes" : "no",
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: emptyState,
      noMatch: (
        <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
          <SpaceBetween size="m">
            <b>{t("common.noMatches")}</b>
            <Box variant="p" color="inherit">
              {t("network.noInterfacesMatch")}
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
  });

  const noMatch = (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <b>{t("common.noMatches")}</b>
        <Box variant="p" color="inherit">
          {t("network.noInterfacesMatch")}
        </Box>
        <Button onClick={() => actions.setFiltering("")}>{t("common.clearFilter")}</Button>
      </SpaceBetween>
    </Box>
  );

  const openCreateModal = useCallback(() => {
    setFormState({
      ...EMPTY_FORM,
      node: nodeOptions[0]?.value ?? "",
    });
    setActionError(null);
    setCreateVisible(true);
  }, [nodeOptions]);

  const openApplyModal = useCallback(() => {
    setApplyNode(nodeOptions[0] ?? null);
    setActionError(null);
    setApplyVisible(true);
  }, [nodeOptions]);

  const closeCreateModal = useCallback(() => {
    setCreateVisible(false);
    setFormState(EMPTY_FORM);
    setActionError(null);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditVisible(false);
    setSelectedInterface(null);
    setActionError(null);
  }, []);

  const closeDeleteModal = useCallback(() => {
    setDeleteVisible(false);
    setSelectedInterface(null);
    setActionError(null);
  }, []);

  const closeApplyModal = useCallback(() => {
    setApplyVisible(false);
    setApplyNode(null);
    setActionError(null);
  }, []);

  const buildRequestParams = useCallback((mode: "create" | "edit") => {
    const params = new URLSearchParams();
    const deleteFields: string[] = [];
    const iface = formState.iface.trim();
    const gateway = formState.gateway.trim();
    const comments = formState.comments.trim();
    const { address, netmask } = parseIpv4Cidr(formState.ipv4Cidr);

    if (iface) {
      params.set("iface", iface);
    }
    if (mode === "create") params.set("type", formState.type);
    params.set("autostart", formState.autostart ? "1" : "0");

    if (address) {
      params.set("address", address);
    } else if (mode === "edit") {
      deleteFields.push("address");
    }

    if (netmask) {
      params.set("netmask", netmask);
    } else if (mode === "edit") {
      deleteFields.push("netmask");
    }

    if (gateway) {
      params.set("gateway", gateway);
    } else if (mode === "edit") {
      deleteFields.push("gateway");
    }

    if (comments) {
      params.set("comments", comments);
    } else if (mode === "edit") {
      deleteFields.push("comments");
    }

    if (formState.type === "bridge") {
      const bridgePorts = formState.bridgePorts.trim();
      if (bridgePorts) {
        params.set("bridge_ports", bridgePorts);
      } else if (mode === "edit") {
        deleteFields.push("bridge_ports");
      }
    }

    if (formState.type === "bond") {
      const bondSlaves = formState.bondSlaves.trim();
      const bondMode = formState.bondMode.trim();
      if (bondSlaves) {
        params.set("slaves", bondSlaves);
      } else if (mode === "edit") {
        deleteFields.push("slaves");
      }
      if (bondMode) {
        params.set("bond_mode", bondMode);
      } else if (mode === "edit") {
        deleteFields.push("bond_mode");
      }
    }

    if (formState.type === "vlan") {
      const vlanRawDevice = formState.vlanRawDevice.trim();
      const vlanTag = formState.vlanTag.trim();
      if (vlanRawDevice) {
        params.set("vlan-raw-device", vlanRawDevice);
      } else if (mode === "edit") {
        deleteFields.push("vlan-raw-device");
      }
      if (vlanTag) {
        params.set("vlan-id", vlanTag);
      } else if (mode === "edit") {
        deleteFields.push("vlan-id");
      }
    }

    if (mode === "edit") {
      appendDeleteFields(params, deleteFields);
    }

    return params;
  }, [formState]);

  const handleCreateInterface = useCallback(async () => {
    const node = formState.node.trim();
    const iface = formState.iface.trim();

    if (!node) {
      setActionError(t("network.nodeRequired"));
      return;
    }

    if (!iface) {
      setActionError(t("network.interfaceNameRequired"));
      return;
    }

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/nodes/${node}/network`, t, {
        method: "POST",
        ...encodeFormBody(buildRequestParams("create")),
      });
      closeCreateModal();
      addFlash({
        id: `network-create-${Date.now()}`,
        type: "success",
        content: interpolate(t("network.createSuccess"), { iface, node }),
        dismissible: true,
      });
      await loadInterfaces();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : t("network.createFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, buildRequestParams, closeCreateModal, formState.iface, formState.node, loadInterfaces, t]);

  const handleEditInterface = useCallback(async () => {
    if (!selectedInterface) {
      setActionError(t("network.updateFailed"));
      return;
    }

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/nodes/${selectedInterface.node}/network/${selectedInterface.iface}`, t, {
        method: "PUT",
        ...encodeFormBody(buildRequestParams("edit")),
      });
      closeEditModal();
      addFlash({
        id: `network-update-${Date.now()}`,
        type: "success",
        content: interpolate(t("network.updateSuccess"), {
          iface: selectedInterface.iface,
          node: selectedInterface.node,
        }),
        dismissible: true,
      });
      await loadInterfaces();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : t("network.updateFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, buildRequestParams, closeEditModal, loadInterfaces, selectedInterface, t]);

  const handleDeleteInterface = useCallback(async () => {
    if (!selectedInterface) {
      return;
    }

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/nodes/${selectedInterface.node}/network/${selectedInterface.iface}`, t, {
        method: "DELETE",
      });
      closeDeleteModal();
      addFlash({
        id: `network-delete-${Date.now()}`,
        type: "success",
        content: interpolate(t("network.deleteSuccess"), {
          iface: selectedInterface.iface,
          node: selectedInterface.node,
        }),
        dismissible: true,
      });
      await loadInterfaces();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t("network.deleteFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, closeDeleteModal, loadInterfaces, selectedInterface, t]);

  const handleApplyConfiguration = useCallback(async () => {
    const node = getOptionValue(applyNode).trim();

    if (!node) {
      setActionError(t("network.nodeRequired"));
      return;
    }

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/nodes/${node}/network`, t, {
        method: "PUT",
      });
      closeApplyModal();
      addFlash({
        id: `network-apply-${Date.now()}`,
        type: "success",
        content: interpolate(t("network.applySuccess"), { node }),
        dismissible: true,
      });
      await loadInterfaces();
    } catch (applyError) {
      setActionError(applyError instanceof Error ? applyError.message : t("network.applyFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, applyNode, closeApplyModal, loadInterfaces, t]);

  const headerCounter = filterProps.filteringText ? `(${filteredItemsCount}/${interfaces.length})` : `(${interfaces.length})`;

  const selectedTypeOption = typeOptions.find((option) => option.value === formState.type) ?? { label: formState.type, value: formState.type };
  const selectedNodeOption = nodeOptions.find((option) => option.value === formState.node) ?? null;
  const selectedBondModeOption = bondModeOptions.find((option) => option.value === formState.bondMode) ?? null;

  const formContent = (mode: "create" | "edit") => (
    <SpaceBetween size="m">
      {actionError ? <Alert type="error">{actionError}</Alert> : null}
      <FormField label={t("network.selectNode")}>
        <Select
          selectedOption={selectedNodeOption}
          onChange={({ detail }) => setFormState((current) => ({ ...current, node: getOptionValue(detail.selectedOption) }))}
          options={nodeOptions}
          placeholder={t("network.selectNode")}
          disabled={mode === "edit"}
        />
      </FormField>
      <FormField label={t("network.interfaceNameLabel")} errorText={!formState.iface.trim() && actionError === t("network.interfaceNameRequired") ? t("network.interfaceNameRequired") : undefined}>
        <Input
          value={formState.iface}
          placeholder={t("network.interfaceNamePlaceholder")}
          onChange={({ detail }) => setFormState((current) => ({ ...current, iface: detail.value }))}
          disabled={mode === "edit"}
        />
      </FormField>
      <FormField label={t("network.typeLabel")}>
        <Select
          selectedOption={selectedTypeOption}
          onChange={({ detail }) => setFormState((current) => ({ ...current, type: getOptionValue(detail.selectedOption) as NetworkFormType }))}
          options={typeOptions}
          placeholder={t("network.selectType")}
          disabled={mode === "edit"}
        />
      </FormField>
      <FormField label={t("network.ipv4Cidr")}>
        <Input
          value={formState.ipv4Cidr}
          placeholder={t("network.ipv4CidrPlaceholder")}
          onChange={({ detail }) => setFormState((current) => ({ ...current, ipv4Cidr: detail.value }))}
        />
      </FormField>
      <FormField label={t("network.gatewayLabel")}>
        <Input
          value={formState.gateway}
          placeholder={t("network.gatewayPlaceholder")}
          onChange={({ detail }) => setFormState((current) => ({ ...current, gateway: detail.value }))}
        />
      </FormField>
      {formState.type === "bridge" ? (
        <FormField label={t("network.bridgePorts")} description={t("network.bridgePortsHelp")}>
          <Input
            value={formState.bridgePorts}
            placeholder={t("network.bridgePortsPlaceholder")}
            onChange={({ detail }) => setFormState((current) => ({ ...current, bridgePorts: detail.value }))}
          />
        </FormField>
      ) : null}
      {formState.type === "bond" ? (
        <>
          <FormField label={t("network.bondSlaves")} description={t("network.bondSlavesHelp")}>
            <Input
              value={formState.bondSlaves}
              placeholder={t("network.bondSlavesPlaceholder")}
              onChange={({ detail }) => setFormState((current) => ({ ...current, bondSlaves: detail.value }))}
            />
          </FormField>
          <FormField label={t("network.bondMode")}>
            <Select
              selectedOption={selectedBondModeOption}
              onChange={({ detail }) => setFormState((current) => ({ ...current, bondMode: getOptionValue(detail.selectedOption) }))}
              options={bondModeOptions}
              placeholder={t("network.selectBondMode")}
            />
          </FormField>
        </>
      ) : null}
      {formState.type === "vlan" ? (
        <>
          <FormField label={t("network.vlanRawDevice")}>
            <Input
              value={formState.vlanRawDevice}
              placeholder={t("network.vlanRawDevicePlaceholder")}
              onChange={({ detail }) => setFormState((current) => ({ ...current, vlanRawDevice: detail.value }))}
            />
          </FormField>
          <FormField label={t("network.vlanTag")}>
            <Input
              type="number"
              value={formState.vlanTag}
              placeholder={t("network.vlanTagPlaceholder")}
              onChange={({ detail }) => setFormState((current) => ({ ...current, vlanTag: detail.value }))}
            />
          </FormField>
        </>
      ) : null}
      <Toggle
        checked={formState.autostart}
        onChange={({ detail }) => setFormState((current) => ({ ...current, autostart: detail.checked }))}
      >
        {t("network.autostartLabel")}
      </Toggle>
      <FormField label={t("network.commentsLabel")}>
        <Textarea
          value={formState.comments}
          placeholder={t("network.commentsPlaceholder")}
          onChange={({ detail }) => setFormState((current) => ({ ...current, comments: detail.value }))}
        />
      </FormField>
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="m">
      {flashItems.length > 0 ? <Flashbar items={flashItems.map((item) => ({ ...item, onDismiss: () => dismissFlash(item.id ?? "") }))} /> : null}
      {error ? (
        <Alert type="error" header={t("network.failedToLoad")}>
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
        trackBy={(item) => `${item.node}:${item.iface}`}
        loading={loading}
        loadingText={t("network.loadingInterfaces")}
        empty={filterProps.filteringText ? noMatch : emptyState}
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        columnDisplay={preferences.contentDisplay}
        header={
          <Header
            variant="h1"
            counter={headerCounter}
            description={t("network.manageDescription")}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => void loadInterfaces()}>{t("common.refresh")}</Button>
                <Button onClick={openApplyModal}>{t("network.applyConfiguration")}</Button>
                <Button variant="primary" onClick={openCreateModal}>{t("network.createInterface")}</Button>
              </SpaceBetween>
            }
          >
            {t("network.interfaces")}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder={t("network.findInterfaces")}
            countText={`${filteredItemsCount ?? interfaces.length} ${t("common.matches")}`}
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
                { value: 10, label: t("network.interfacesCount10") },
                { value: 20, label: t("network.interfacesCount20") },
                { value: 50, label: t("network.interfacesCount50") },
              ],
            }}
            wrapLinesPreference={{
              label: t("common.wrapLines"),
              description: t("network.wrapLinesDesc"),
            }}
            stripedRowsPreference={{
              label: t("common.stripedRows"),
              description: t("network.stripedRowsDesc"),
            }}
            contentDensityPreference={{
              label: t("common.contentDensity"),
              description: t("network.contentDensityDesc"),
            }}
            contentDisplayPreference={{
              title: t("common.columnPreferences"),
              options: [
                { id: "iface", label: t("network.interfaceName"), alwaysVisible: true },
                { id: "node", label: t("network.node") },
                { id: "type", label: t("network.type") },
                { id: "active", label: t("network.active") },
                { id: "address", label: t("network.address") },
                { id: "netmask", label: t("network.netmaskCidr") },
                { id: "gateway", label: t("network.gateway") },
                { id: "bridge_ports", label: t("network.bridgePorts") },
                { id: "autostart", label: t("network.autostart") },
                { id: "actions", label: t("common.actions") },
              ],
            }}
          />
        }
      />

      <Modal
        visible={createVisible}
        onDismiss={closeCreateModal}
        header={t("network.createModalTitle")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={closeCreateModal}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void handleCreateInterface()}>
              {t("common.create")}
            </Button>
          </SpaceBetween>
        }
      >
        {formContent("create")}
      </Modal>

      <Modal
        visible={editVisible}
        onDismiss={closeEditModal}
        header={t("network.editModalTitle")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={closeEditModal}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void handleEditInterface()}>
              {t("common.save")}
            </Button>
          </SpaceBetween>
        }
      >
        {formContent("edit")}
      </Modal>

      <Modal
        visible={deleteVisible}
        onDismiss={closeDeleteModal}
        header={t("network.deleteModalTitle")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={closeDeleteModal}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void handleDeleteInterface()}>
              {t("common.delete")}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <Box>
            {selectedInterface
              ? interpolate(t("network.deleteConfirmation"), {
                iface: selectedInterface.iface,
                node: selectedInterface.node,
              })
              : null}
          </Box>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={applyVisible}
        onDismiss={closeApplyModal}
        header={t("network.applyConfiguration")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={closeApplyModal}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void handleApplyConfiguration()}>
              {t("common.confirm")}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <FormField label={t("network.selectNode")}>
            <Select
              selectedOption={applyNode}
              onChange={({ detail }) => setApplyNode(detail.selectedOption)}
              options={nodeOptions}
              placeholder={t("network.selectNode")}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
