"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";
import { GuestPowerConfirmation, type GuestPowerAction } from "@/app/lib/guest-power-confirmation";
import { useSettings } from "@/app/components/settings-context";

import { formatResourceBytes as formatBytes, isStorageActive, setOptionalParameters, isValidVmid, inferBackupGuestType } from "@/app/lib/resource-api";

import { type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import AreaChart from "@cloudscape-design/components/area-chart";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Modal from "@cloudscape-design/components/modal";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Tabs, { type TabsProps } from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import Toggle from "@cloudscape-design/components/toggle";
import { useTranslation } from "@/app/lib/use-translation";

interface PveResource {
  vmid?: number;
  node: string;
  type: string;
  name?: string;
  status: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  template?: number;
}

type ContainerConfigValue = string | number | boolean;
type PveContainerConfig = Record<string, ContainerConfigValue | null | undefined>;

interface PveSnapshot {
  name: string;
  description?: string;
  snaptime?: number;
  vmstate?: number;
  parent?: string;
}

interface PveTask {
  upid: string;
  node: string;
  type: string;
  id?: string;
  user: string;
  status?: string;
  starttime: number;
  endtime?: number;
}

interface PveRrdPoint {
  time: number;
  cpu?: number;
  memused?: number;
  memtotal?: number;
}

interface ContainerDetailData {
  resource: PveResource;
  config: PveContainerConfig;
  snapshots: PveSnapshot[];
  tasks: PveTask[];
  rrd: PveRrdPoint[];
}

interface NodeSummary {
  node: string;
  status: string;
}

interface ClusterNextId {
  vmid?: number | string;
}

interface StorageSummary {
  storage: string;
  content?: string;
  active?: number;
  enabled?: number;
}

interface NetworkInterfaceRow {
  id: string;
  interface: string;
  bridge: string;
  macAddress: string;
  ip: string;
  firewall: string;
  rateLimit: string;
  vlanTag: string;
}

interface ContainerOptionsFormState {
  onboot: boolean;
  protection: boolean;
  cmode: string;
}

interface ContainerDnsConfig {
  nameserver?: ContainerConfigValue | null;
  searchdomain?: ContainerConfigValue | null;
}

interface ContainerDnsFormState {
  nameserver: string;
  searchdomain: string;
}

interface ContainerFirewallRule {
  pos: number;
  type?: string;
  action?: string;
  proto?: string;
  source?: string;
  dest?: string;
  dport?: string;
  comment?: string;
  enable?: number | boolean;
}

interface ContainerFirewallOptions {
  enable?: number | boolean;
  dhcp?: number | boolean;
  macfilter?: number | boolean;
  policy_in?: string;
  policy_out?: string;
}

interface ContainerFirewallOptionsFormState {
  enable: boolean;
  dhcp: boolean;
  macfilter: boolean;
  policyIn: string;
  policyOut: string;
}

interface ContainerFirewallRuleFormState {
  type: string;
  action: string;
  proto: string;
  source: string;
  dest: string;
  dport: string;
  comment: string;
  enable: boolean;
}

interface BackupStorageSummary {
  storage: string;
  content?: string;
  active?: number;
  enabled?: number;
  status?: string;
}

interface ContainerBackupContent {
  volid: string;
  ctime?: number;
  size?: number;
  notes?: string;
  content?: string;
  active?: number;
  enabled?: number;
}

interface ContainerBackupRow {
  id: string;
  storage: string;
  volid: string;
  ctime?: number;
  size?: number;
  notes?: string;
}

const EMPTY_CONTAINER_OPTIONS_FORM: ContainerOptionsFormState = {
  onboot: false,
  protection: false,
  cmode: "console",
};

const EMPTY_DNS_FORM: ContainerDnsFormState = {
  nameserver: "",
  searchdomain: "",
};

const EMPTY_FIREWALL_OPTIONS_FORM: ContainerFirewallOptionsFormState = {
  enable: false,
  dhcp: false,
  macfilter: false,
  policyIn: "DROP",
  policyOut: "ACCEPT",
};

const EMPTY_FIREWALL_RULE_FORM: ContainerFirewallRuleFormState = {
  type: "in",
  action: "ACCEPT",
  proto: "",
  source: "",
  dest: "",
  dport: "",
  comment: "",
  enable: true,
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

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp * 1000).toLocaleString();
}

function formatConfigValue(key: string, value: ContainerConfigValue, yesLabel: string, noLabel: string): string {
  if (typeof value === "boolean") {
    return value ? yesLabel : noLabel;
  }
  if (typeof value === "number") {
    if (key === "memory" || key === "swap") {
      return formatBytes(value * 1024 * 1024);
    }
    return String(value);
  }
  return value;
}

function labelForConfigKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getStatusType(status: string) {
  if (status === "running") {
    return "success" as const;
  }
  if (status === "stopped") {
    return "stopped" as const;
  }
  return "info" as const;
}

function getConfigStringValue(value: ContainerConfigValue | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function optionValue(option: SelectProps.Option | null): string {
  return option?.value ?? "";
}

function encodeFormBody(params: URLSearchParams) {
  return {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params.toString(),
  };
}

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function isEnabled(value?: number | boolean | null) {
  return value === 1 || value === true;
}

function getTextValue(value?: string, fallback = "-") {
  return value?.trim() ? value : fallback;
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

function buildContainerOptionsForm(config: PveContainerConfig): ContainerOptionsFormState {
  return {
    onboot: isEnabled(config.onboot as number | boolean | null | undefined),
    protection: isEnabled(config.protection as number | boolean | null | undefined),
    cmode: getConfigStringValue(config.cmode) || "console",
  };
}

function buildDnsForm(config: ContainerDnsConfig | PveContainerConfig | null): ContainerDnsFormState {
  return {
    nameserver: getConfigStringValue(config?.nameserver),
    searchdomain: getConfigStringValue(config?.searchdomain),
  };
}

function buildFirewallOptionsForm(options: ContainerFirewallOptions | null): ContainerFirewallOptionsFormState {
  return {
    enable: isEnabled(options?.enable),
    dhcp: isEnabled(options?.dhcp),
    macfilter: isEnabled(options?.macfilter ?? 1),
    policyIn: options?.policy_in ?? "DROP",
    policyOut: options?.policy_out ?? "ACCEPT",
  };
}

function buildFirewallRuleForm(rule: ContainerFirewallRule | null): ContainerFirewallRuleFormState {
  return {
    type: rule?.type ?? "in",
    action: rule?.action ?? "ACCEPT",
    proto: rule?.proto ?? "",
    source: rule?.source ?? "",
    dest: rule?.dest ?? "",
    dport: rule?.dport ?? "",
    comment: rule?.comment ?? "",
    enable: isEnabled(rule?.enable ?? true),
  };
}

function storageSupportsContent(storage: StorageSummary, contentType: string): boolean {
  return isStorageActive(storage) && (storage.content ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .includes(contentType);
}

function parseNetworkConfigEntry(entry: string): Record<string, string> {
  return entry.split(",").reduce<Record<string, string>>((accumulator, part) => {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim();

    if (!key) {
      return accumulator;
    }

    accumulator[key] = rawValue.join("=").trim();
    return accumulator;
  }, {});
}

function getNetworkInterfaces(config: PveContainerConfig, yesLabel: string, noLabel: string): NetworkInterfaceRow[] {
  return Object.entries(config)
    .filter(([key, value]) => /^net\d+$/.test(key) && typeof value === "string" && value.length > 0)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
    .map(([key, value]) => {
      const parsed = parseNetworkConfigEntry(typeof value === "string" ? value : "");
      return {
        id: key,
        interface: parsed.name || key,
        bridge: parsed.bridge || "-",
        macAddress: parsed.hwaddr || "-",
        ip: parsed.ip || "-",
        firewall: parsed.firewall === "1" ? yesLabel : parsed.firewall === "0" || !parsed.firewall ? noLabel : parsed.firewall,
        rateLimit: parsed.rate || "-",
        vlanTag: parsed.tag || "-",
      };
    });
}

async function fetchProxmox<T>(path: string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function ContainerDetailPage(props: { params: Promise<{ ctid: string }> }) {
  const { ctid } = use(props.params);
  return <ContainerDetails key={ctid} ctid={ctid} />;
}

function ContainerDetails({ ctid }: { ctid: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { confirmPowerActions } = useSettings();
  const [pendingPowerAction, setPendingPowerAction] = useState<GuestPowerAction | null>(null);
  const vmid = Number(ctid);
  const [activeTabId, setActiveTabId] = useState("summary");
  const [data, setData] = useState<ContainerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<GuestPowerAction | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [createSnapshotModalVisible, setCreateSnapshotModalVisible] = useState(false);
  const [deleteSnapshotModalVisible, setDeleteSnapshotModalVisible] = useState(false);
  const [rollbackSnapshotModalVisible, setRollbackSnapshotModalVisible] = useState(false);
  const [migrateModalVisible, setMigrateModalVisible] = useState(false);
  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [editCores, setEditCores] = useState("");
  const [editMemory, setEditMemory] = useState("");
  const [editSwap, setEditSwap] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotDescription, setSnapshotDescription] = useState("");
  const [selectedSnapshot, setSelectedSnapshot] = useState<PveSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [migrateTargetNode, setMigrateTargetNode] = useState<SelectProps.Option | null>(null);
  const [migrateOnline, setMigrateOnline] = useState(false);
  const [cloneNewId, setCloneNewId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloneTargetNode, setCloneTargetNode] = useState<SelectProps.Option | null>(null);
  const [cloneTargetStorage, setCloneTargetStorage] = useState<SelectProps.Option | null>(null);
  const [cloneFullClone, setCloneFullClone] = useState<SelectProps.Option | null>({
    label: t("containers.fullClone"),
    value: "full",
  });
  const [cloneDescription, setCloneDescription] = useState("");
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [availableNodes, setAvailableNodes] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [availableStorages, setAvailableStorages] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [loadingStorages, setLoadingStorages] = useState(false);
  const [optionsModalVisible, setOptionsModalVisible] = useState(false);
  const [optionsSaveLoading, setOptionsSaveLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsForm, setOptionsForm] = useState<ContainerOptionsFormState>(EMPTY_CONTAINER_OPTIONS_FORM);
  const [dnsConfig, setDnsConfig] = useState<ContainerDnsConfig | null>(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsInitialized, setDnsInitialized] = useState(false);
  const [dnsModalVisible, setDnsModalVisible] = useState(false);
  const [dnsSaveLoading, setDnsSaveLoading] = useState(false);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [dnsForm, setDnsForm] = useState<ContainerDnsFormState>(EMPTY_DNS_FORM);
  const [firewallRules, setFirewallRules] = useState<ContainerFirewallRule[]>([]);
  const [firewallOptions, setFirewallOptions] = useState<ContainerFirewallOptions | null>(null);
  const [firewallRulesLoading, setFirewallRulesLoading] = useState(false);
  const [firewallOptionsLoading, setFirewallOptionsLoading] = useState(false);
  const [firewallInitialized, setFirewallInitialized] = useState(false);
  const [firewallRulesError, setFirewallRulesError] = useState<string | null>(null);
  const [firewallOptionsError, setFirewallOptionsError] = useState<string | null>(null);
  const [firewallActionError, setFirewallActionError] = useState<string | null>(null);
  const [firewallSubmitting, setFirewallSubmitting] = useState(false);
  const [selectedFirewallRule, setSelectedFirewallRule] = useState<ContainerFirewallRule | null>(null);
  const [firewallRuleForm, setFirewallRuleForm] = useState<ContainerFirewallRuleFormState>(EMPTY_FIREWALL_RULE_FORM);
  const [firewallOptionsForm, setFirewallOptionsForm] = useState<ContainerFirewallOptionsFormState>(EMPTY_FIREWALL_OPTIONS_FORM);
  const [createFirewallRuleVisible, setCreateFirewallRuleVisible] = useState(false);
  const [editFirewallRuleVisible, setEditFirewallRuleVisible] = useState(false);
  const [deleteFirewallRuleVisible, setDeleteFirewallRuleVisible] = useState(false);
  const [editFirewallOptionsVisible, setEditFirewallOptionsVisible] = useState(false);
  const [backups, setBackups] = useState<ContainerBackupRow[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsInitialized, setBackupsInitialized] = useState(false);
  const [backupsError, setBackupsError] = useState<string | null>(null);
  const [backupActionError, setBackupActionError] = useState<string | null>(null);
  const [backupSubmitting, setBackupSubmitting] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<ContainerBackupRow | null>(null);
  const [deleteBackupVisible, setDeleteBackupVisible] = useState(false);
  const yesLabel = t("network.yes");
  const noLabel = t("network.no");

  const detailRequest = useRef<AbortController | null>(null);
  const loadedNode = useRef<string | null>(null);

  const loadContainer = useCallback(async () => {
    if (!isValidVmid(ctid)) {
      setLoadError(t("containers.invalidCtid"));
      setLoading(false);
      return;
    }

    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    try {
      setLoading(true);
      setActionError(null);
      const resources = await fetchProxmox<PveResource[]>("/api/proxmox/cluster/resources?type=vm", { signal: controller.signal });
      const resource = (resources ?? []).find((item) => item.vmid === vmid && item.type === "lxc");

      if (!resource?.node) {
        throw new Error(`Container ${vmid} was not found`);
      }

      const [config, snapshots, tasks, rrd] = await Promise.all([
        fetchProxmox<PveContainerConfig>(`/api/proxmox/nodes/${resource.node}/lxc/${vmid}/config`, { signal: controller.signal }),
        fetchProxmox<PveSnapshot[]>(`/api/proxmox/nodes/${resource.node}/lxc/${vmid}/snapshot`, { signal: controller.signal }),
        fetchProxmox<PveTask[]>(`/api/proxmox/nodes/${resource.node}/tasks?vmid=${vmid}&limit=20`, { signal: controller.signal }),
        fetchProxmox<PveRrdPoint[]>(`/api/proxmox/nodes/${resource.node}/lxc/${vmid}/rrddata?timeframe=hour&cf=AVERAGE`, { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) return;
      if (loadedNode.current !== resource.node) {
        setDnsConfig(null);
        setDnsInitialized(false);
        setDnsError(null);
        setFirewallRules([]);
        setFirewallOptions(null);
        setFirewallInitialized(false);
        setFirewallRulesError(null);
        setFirewallOptionsError(null);
        setFirewallActionError(null);
        setBackups([]);
        setBackupsInitialized(false);
        setBackupsError(null);
        setBackupActionError(null);
        setFirewallRulesLoading(false);
        setFirewallOptionsLoading(false);
        setBackupsLoading(false);
        setDnsLoading(false);
        loadedNode.current = resource.node;
      }
      setData({
        resource,
        config: config ?? {},
        snapshots: snapshots ?? [],
        tasks: tasks ?? [],
        rrd: rrd ?? [],
      });
      setLoadError(null);
    } catch (fetchError) {
      if (controller.signal.aborted) return;
      setLoadError(fetchError instanceof Error ? fetchError.message : t("containers.failedToLoadDetails"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [ctid, t, vmid]);

  useResourceTaskRefresh(loadContainer);

  useEffect(() => {
    // Start an external request; loading state belongs to its asynchronous lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadContainer();
    return () => detailRequest.current?.abort();
  }, [loadContainer]);

  const cloneModeOptions = useMemo<ReadonlyArray<SelectProps.Option>>(
    () => [
      { label: t("containers.fullClone"), value: "full" },
      { label: t("containers.linkedClone"), value: "linked" },
    ],
    [t],
  );

  const loadAvailableNodes = useCallback(
    async (excludeCurrentNode: boolean) => {
      if (!data) {
        return [] as SelectProps.Option[];
      }

      const nodes = await fetchProxmox<NodeSummary[]>("/api/proxmox/nodes");
      return (nodes ?? [])
        .filter((node) => node.status === "online")
        .filter((node) => !excludeCurrentNode || node.node !== data.resource.node)
        .map((node) => ({ label: node.node, value: node.node }))
        .sort((left, right) => String(left.label).localeCompare(String(right.label)));
    },
    [data],
  );

  const loadCloneStorages = useCallback(async (node: string) => {
    const storages = await fetchProxmox<StorageSummary[]>(`/api/proxmox/nodes/${node}/storage`);
    return (storages ?? [])
      .filter((storage) => storageSupportsContent(storage, "rootdir"))
      .map((storage) => ({ label: storage.storage, value: storage.storage }))
      .sort((left, right) => String(left.label).localeCompare(String(right.label)));
  }, []);

  const loadDnsConfig = useCallback(async () => {
    setDnsInitialized(true);
    if (!data) {
      return;
    }

    const requestNode = data.resource.node;
    try {
      setDnsLoading(true);
      const config = await fetchProxmox<PveContainerConfig>(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/config`);
      if (loadedNode.current !== requestNode) return;
      setDnsConfig({
        nameserver: config?.nameserver,
        searchdomain: config?.searchdomain,
      });
      setDnsError(null);
    } catch (loadDnsError) {
      if (loadedNode.current !== requestNode) return;
      setDnsError(loadDnsError instanceof Error ? loadDnsError.message : t("containers.failedToUpdateDns"));
    } finally {
      if (loadedNode.current === requestNode) setDnsLoading(false);
    }
  }, [data, t, vmid]);

  const loadFirewallRules = useCallback(async () => {
    if (!data) {
      return;
    }

    const requestNode = data.resource.node;
    try {
      setFirewallRulesLoading(true);
      const nextRules = await fetchProxmox<ContainerFirewallRule[]>(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/firewall/rules`);
      if (loadedNode.current !== requestNode) return;
      setFirewallRules((nextRules ?? []).slice().sort((left, right) => left.pos - right.pos));
      setFirewallRulesError(null);
    } catch (loadRulesError) {
      if (loadedNode.current !== requestNode) return;
      setFirewallRulesError(loadRulesError instanceof Error ? loadRulesError.message : t("containers.failedToLoadFirewallRules"));
    } finally {
      if (loadedNode.current === requestNode) setFirewallRulesLoading(false);
    }
  }, [data, t, vmid]);

  const loadFirewallOptions = useCallback(async () => {
    if (!data) {
      return;
    }

    const requestNode = data.resource.node;
    try {
      setFirewallOptionsLoading(true);
      const nextOptions = await fetchProxmox<ContainerFirewallOptions>(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/firewall/options`);
      if (loadedNode.current !== requestNode) return;
      setFirewallOptions(nextOptions ?? {});
      setFirewallOptionsError(null);
    } catch (loadOptionsError) {
      if (loadedNode.current !== requestNode) return;
      setFirewallOptionsError(loadOptionsError instanceof Error ? loadOptionsError.message : t("containers.failedToLoadFirewallOptions"));
    } finally {
      if (loadedNode.current === requestNode) setFirewallOptionsLoading(false);
    }
  }, [data, t, vmid]);

  const loadFirewallData = useCallback(async () => {
    setFirewallInitialized(true);
    await Promise.all([loadFirewallRules(), loadFirewallOptions()]);
  }, [loadFirewallOptions, loadFirewallRules]);

  const loadBackups = useCallback(async () => {
    setBackupsInitialized(true);
    if (!data) {
      return;
    }

    const requestNode = data.resource.node;
    try {
      setBackupsLoading(true);
      const storages = await fetchProxmox<BackupStorageSummary[]>(`/api/proxmox/nodes/${data.resource.node}/storage`);
      const backupStorages = (storages ?? []).filter(
        (storage) => isStorageActive(storage) && storageSupportsContent(storage, "backup"),
      );

      const backupLists = await Promise.all(
        backupStorages.map(async ({ storage }) => {
          const entries = await fetchProxmox<ContainerBackupContent[]>(
            `/api/proxmox/nodes/${data.resource.node}/storage/${storage}/content?content=backup&vmid=${vmid}`,
          );

          return (entries ?? [])
            .filter((entry) => entry.content === "backup" || inferBackupGuestType(entry.volid) === "lxc")
            .map((entry) => ({
              id: `${storage}:${entry.volid}`,
              storage,
              volid: entry.volid,
              ctime: entry.ctime,
              size: entry.size,
              notes: entry.notes,
            } satisfies ContainerBackupRow));
        }),
      );

      if (loadedNode.current !== requestNode) return;
      setBackups(backupLists.flat().sort((left, right) => (right.ctime ?? 0) - (left.ctime ?? 0)));
      setBackupsError(null);
    } catch (loadBackupsError) {
      if (loadedNode.current !== requestNode) return;
      setBackupsError(loadBackupsError instanceof Error ? loadBackupsError.message : t("containers.failedToLoadBackups"));
    } finally {
      if (loadedNode.current === requestNode) setBackupsLoading(false);
    }
  }, [data, t, vmid]);

  const handlePowerAction = useCallback(async (action: GuestPowerAction) => {
    if (!data) return;
    try {
      setActionLoading(action);
      setActionError(null);
      await fetchProxmox(`/api/proxmox/nodes/${encodeURIComponent(data.resource.node)}/lxc/${vmid}/status/${action}`, { method: "POST" });
      await loadContainer();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setActionLoading(null);
      setPendingPowerAction(null);
    }
  }, [data, loadContainer, vmid, t]);

  const requestPowerAction = (action: GuestPowerAction) => {
    if (!confirmPowerActions && action !== "stop") void handlePowerAction(action);
    else setPendingPowerAction(action);
  };

  const openEditModal = useCallback(() => {
    if (!data) {
      return;
    }

    setEditCores(getConfigStringValue(data.config.cores));
    setEditMemory(getConfigStringValue(data.config.memory));
    setEditSwap(getConfigStringValue(data.config.swap));
    setEditDescription(getConfigStringValue(data.config.description));
    setConfigError(null);
    setEditModalVisible(true);
  }, [data]);

  const saveConfiguration = useCallback(async () => {
    if (!data) {
      return;
    }

    const cores = Number(editCores);
    const memory = Number(editMemory);
    const swap = Number(editSwap);

    if (!Number.isFinite(cores) || cores <= 0) {
      setConfigError("CPU cores must be greater than 0.");
      return;
    }

    if (!Number.isFinite(memory) || memory <= 0) {
      setConfigError("Memory must be greater than 0 MB.");
      return;
    }

    if (!Number.isFinite(swap) || swap < 0) {
      setConfigError("Swap must be 0 MB or greater.");
      return;
    }

    try {
      setSavingConfig(true);
      setConfigError(null);

      const body = new URLSearchParams({
        cores: String(cores),
        memory: String(memory),
        swap: String(swap),
        description: editDescription,
      });

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.configUpdated").replace("{id}", String(vmid)),
          dismissible: true,
          id: "container-config-updated",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setEditModalVisible(false);
      await loadContainer();
    } catch (saveError) {
      setConfigError(saveError instanceof Error ? saveError.message : t("containers.failedToUpdateConfig"));
    } finally {
      setSavingConfig(false);
    }
  }, [data, editCores, editDescription, editMemory, editSwap, loadContainer, t, vmid]);

  const openCreateSnapshotModal = useCallback(() => {
    setSnapshotName("");
    setSnapshotDescription("");
    setSnapshotError(null);
    setCreateSnapshotModalVisible(true);
  }, []);

  const openDeleteSnapshotModal = useCallback((snapshot: PveSnapshot) => {
    setSelectedSnapshot(snapshot);
    setSnapshotError(null);
    setDeleteSnapshotModalVisible(true);
  }, []);

  const openRollbackSnapshotModal = useCallback((snapshot: PveSnapshot) => {
    setSelectedSnapshot(snapshot);
    setSnapshotError(null);
    setRollbackSnapshotModalVisible(true);
  }, []);

  const openMigrateModal = useCallback(async () => {
    if (!data) {
      return;
    }

    try {
      setLoadingNodes(true);
      setMigrateError(null);
      const nodes = await loadAvailableNodes(true);
      setAvailableNodes(nodes);
      setMigrateTargetNode(nodes[0] ?? null);
      setMigrateOnline(data.resource.status === "running");
      setMigrateModalVisible(true);
    } catch (loadError) {
      setMigrateError(loadError instanceof Error ? loadError.message : t("containers.failedToMigrate"));
      setMigrateModalVisible(true);
    } finally {
      setLoadingNodes(false);
    }
  }, [data, loadAvailableNodes, t]);

  const openCloneModal = useCallback(async () => {
    if (!data) {
      return;
    }

    try {
      setLoadingNodes(true);
      setCloneError(null);
      const [nodes, nextId] = await Promise.all([
        loadAvailableNodes(false),
        fetchProxmox<number | string | ClusterNextId>("/api/proxmox/cluster/nextid"),
      ]);
      const normalizedNextId =
        typeof nextId === "object" && nextId !== null && "vmid" in nextId ? nextId.vmid : nextId;
      const defaultNode = nodes.find((node) => node.value === data.resource.node) ?? nodes[0] ?? null;
      setAvailableNodes(nodes);
      setCloneNewId(normalizedNextId ? String(normalizedNextId) : "");
      setCloneName("");
      setCloneTargetNode(defaultNode);
      setCloneTargetStorage(null);
      setAvailableStorages([]);
      setCloneFullClone({ label: t("containers.fullClone"), value: "full" });
      setCloneDescription("");
      setCloneModalVisible(true);
    } catch (loadError) {
      setCloneError(loadError instanceof Error ? loadError.message : t("containers.failedToClone"));
      setCloneModalVisible(true);
    } finally {
      setLoadingNodes(false);
    }
  }, [data, loadAvailableNodes, t]);

  const createSnapshot = useCallback(async () => {
    if (!data) {
      return;
    }

    if (!snapshotName.trim()) {
      setSnapshotError(t("containers.snapshotNameRequired"));
      return;
    }

    try {
      setSnapshotLoading(true);
      setSnapshotError(null);

      const name = snapshotName.trim();
      const body = new URLSearchParams({
        snapname: name,
        description: snapshotDescription,
      });

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/snapshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.snapshotCreated").replace("{name}", name),
          dismissible: true,
          id: "container-snapshot-created",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setCreateSnapshotModalVisible(false);
      setSnapshotName("");
      setSnapshotDescription("");
      await loadContainer();
    } catch (createError) {
      setSnapshotError(createError instanceof Error ? createError.message : t("containers.failedToCreateSnapshot"));
    } finally {
      setSnapshotLoading(false);
    }
  }, [data, loadContainer, snapshotDescription, snapshotName, t, vmid]);

  const deleteSnapshot = useCallback(async () => {
    if (!data || !selectedSnapshot) {
      return;
    }

    try {
      setSnapshotLoading(true);
      setSnapshotError(null);

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/snapshot/${encodeURIComponent(selectedSnapshot.name)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.snapshotDeleted").replace("{name}", selectedSnapshot.name),
          dismissible: true,
          id: "container-snapshot-deleted",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setDeleteSnapshotModalVisible(false);
      setSelectedSnapshot(null);
      await loadContainer();
    } catch (deleteError) {
      setSnapshotError(deleteError instanceof Error ? deleteError.message : t("containers.failedToDeleteSnapshot"));
    } finally {
      setSnapshotLoading(false);
    }
  }, [data, loadContainer, selectedSnapshot, t, vmid]);

  const rollbackSnapshot = useCallback(async () => {
    if (!data || !selectedSnapshot) {
      return;
    }

    try {
      setSnapshotLoading(true);
      setSnapshotError(null);

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/snapshot/${encodeURIComponent(selectedSnapshot.name)}/rollback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.snapshotRolledBack").replace("{name}", selectedSnapshot.name),
          dismissible: true,
          id: "container-snapshot-rolled-back",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setRollbackSnapshotModalVisible(false);
      setSelectedSnapshot(null);
      await loadContainer();
    } catch (rollbackError) {
      setSnapshotError(rollbackError instanceof Error ? rollbackError.message : t("containers.failedToRollbackSnapshot"));
    } finally {
      setSnapshotLoading(false);
    }
  }, [data, loadContainer, selectedSnapshot, t, vmid]);

  useEffect(() => {
    const targetNode = optionValue(cloneTargetNode);

    if (!cloneModalVisible || !targetNode) return;

    let cancelled = false;

    const run = async () => {
      try {
        setLoadingStorages(true);
        const storages = await loadCloneStorages(targetNode);

        if (cancelled) {
          return;
        }

        setAvailableStorages(storages);
        setCloneTargetStorage((current) =>
          current && storages.some((storage) => storage.value === current.value) ? current : null,
        );
      } catch (loadError) {
        if (!cancelled) {
          setCloneError(loadError instanceof Error ? loadError.message : t("containers.failedToClone"));
          setAvailableStorages([]);
          setCloneTargetStorage(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingStorages(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [cloneModalVisible, cloneTargetNode, loadCloneStorages, t]);


  useEffect(() => {
    if (!data) {
      return;
    }

    if (activeTabId === "dns" && !dnsInitialized) {
      // Load this resource tab once per node; explicit refresh remains available.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDnsConfig();
    }

    if (activeTabId === "firewall" && !firewallInitialized) {
      void loadFirewallData();
    }

    if (activeTabId === "backup" && !backupsInitialized) {
      void loadBackups();
    }
  }, [activeTabId, backupsInitialized, data, dnsInitialized, firewallInitialized, loadBackups, loadDnsConfig, loadFirewallData]);

  const consoleModeOptions = [
    { label: t("containers.consoleModeConsole"), value: "console" },
    { label: t("containers.consoleModeShell"), value: "shell" },
    { label: t("containers.consoleModeTty"), value: "tty" },
  ];

  const firewallTypeOptions = [
    { label: t("firewall.typeIn"), value: "in" },
    { label: t("firewall.typeOut"), value: "out" },
    { label: t("firewall.typeGroup"), value: "group" },
  ];

  const firewallActionOptions = [
    { label: t("firewall.actionAccept"), value: "ACCEPT" },
    { label: t("firewall.actionDrop"), value: "DROP" },
    { label: t("firewall.actionReject"), value: "REJECT" },
  ];

  const firewallProtocolOptions = [
    { label: t("firewall.anyProtocol"), value: "" },
    { label: "TCP", value: "tcp" },
    { label: "UDP", value: "udp" },
    { label: "ICMP", value: "icmp" },
    { label: "ICMPv6", value: "icmpv6" },
  ];

  const firewallTypeLabel = (value?: string) => {
    switch ((value ?? "").toLowerCase()) {
      case "in":
        return t("firewall.typeIn");
      case "out":
        return t("firewall.typeOut");
      case "group":
        return t("firewall.typeGroup");
      default:
        return getTextValue(value, t("cluster.common.none"));
    }
  };

  const firewallActionLabel = (value?: string) => {
    switch ((value ?? "").toUpperCase()) {
      case "ACCEPT":
        return t("firewall.actionAccept");
      case "DROP":
        return t("firewall.actionDrop");
      case "REJECT":
        return t("firewall.actionReject");
      default:
        return getTextValue(value, t("cluster.common.none"));
    }
  };

  const consoleModeLabel = (value?: string) => {
    switch ((value ?? "").toLowerCase()) {
      case "console":
        return t("containers.consoleModeConsole");
      case "shell":
        return t("containers.consoleModeShell");
      case "tty":
        return t("containers.consoleModeTty");
      default:
        return getTextValue(value, t("cluster.common.none"));
    }
  };

  const openOptionsModal = () => {
    if (!data) {
      return;
    }

    setOptionsForm(buildContainerOptionsForm(data.config));
    setOptionsError(null);
    setOptionsModalVisible(true);
  };

  const saveOptions = async () => {
    if (!data) {
      return;
    }

    try {
      setOptionsSaveLoading(true);
      setOptionsError(null);
      const params = new URLSearchParams();
      params.set("onboot", optionsForm.onboot ? "1" : "0");
      params.set("protection", optionsForm.protection ? "1" : "0");
      params.set("cmode", optionsForm.cmode || "console");

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/config`, {
        method: "PUT",
        ...encodeFormBody(params),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.optionsUpdated"),
          dismissible: true,
          id: "container-options-updated",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setOptionsModalVisible(false);
      await loadContainer();
    } catch (saveError) {
      setOptionsError(saveError instanceof Error ? saveError.message : t("containers.failedToUpdateOptions"));
    } finally {
      setOptionsSaveLoading(false);
    }
  };

  const openDnsModal = () => {
    setDnsForm(buildDnsForm(dnsConfig ?? data?.config ?? null));
    setDnsError(null);
    setDnsModalVisible(true);
  };

  const saveDns = async () => {
    if (!data) {
      return;
    }

    try {
      setDnsSaveLoading(true);
      setDnsError(null);
      const params = new URLSearchParams();
      setOptionalParameters(params, { nameserver: dnsForm.nameserver, searchdomain: dnsForm.searchdomain }, true);

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/config`, {
        method: "PUT",
        ...encodeFormBody(params),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.dnsUpdated"),
          dismissible: true,
          id: "container-dns-updated",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setDnsModalVisible(false);
      await Promise.all([loadDnsConfig(), loadContainer()]);
    } catch (saveError) {
      setDnsError(saveError instanceof Error ? saveError.message : t("containers.failedToUpdateDns"));
    } finally {
      setDnsSaveLoading(false);
    }
  };

  const openCreateFirewallRuleModal = () => {
    setSelectedFirewallRule(null);
    setFirewallRuleForm(EMPTY_FIREWALL_RULE_FORM);
    setFirewallActionError(null);
    setCreateFirewallRuleVisible(true);
  };

  const openEditFirewallRuleModal = (rule: ContainerFirewallRule) => {
    setSelectedFirewallRule(rule);
    setFirewallRuleForm(buildFirewallRuleForm(rule));
    setFirewallActionError(null);
    setEditFirewallRuleVisible(true);
  };

  const openDeleteFirewallRuleModal = (rule: ContainerFirewallRule) => {
    setSelectedFirewallRule(rule);
    setFirewallActionError(null);
    setDeleteFirewallRuleVisible(true);
  };

  const openEditFirewallOptionsModal = () => {
    setFirewallOptionsForm(buildFirewallOptionsForm(firewallOptions));
    setFirewallActionError(null);
    setEditFirewallOptionsVisible(true);
  };

  const submitFirewallRule = async (mode: "create" | "edit") => {
    if (!data) {
      return;
    }

    if (mode === "edit" && !selectedFirewallRule) {
      setFirewallActionError(t("containers.failedToUpdateFirewallRule"));
      return;
    }

    try {
      setFirewallSubmitting(true);
      setFirewallActionError(null);
      const params = new URLSearchParams();
      params.set("type", firewallRuleForm.type || "in");
      params.set("action", firewallRuleForm.action || "ACCEPT");
      params.set("enable", firewallRuleForm.enable ? "1" : "0");
      setOptionalParameters(params, { proto: firewallRuleForm.proto, source: firewallRuleForm.source, dest: firewallRuleForm.dest, dport: firewallRuleForm.dport, comment: firewallRuleForm.comment }, mode === "edit");

      const path = mode === "create"
        ? `/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/firewall/rules`
        : `/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/firewall/rules/${selectedFirewallRule?.pos ?? 0}`;

      await fetchProxmox(path, {
        method: mode === "create" ? "POST" : "PUT",
        ...encodeFormBody(params),
      });

      setFlashbarItems([
        {
          type: "success",
          content: mode === "create" ? t("containers.firewallRuleCreated") : t("containers.firewallRuleUpdated"),
          dismissible: true,
          id: `container-firewall-rule-${mode}`,
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setCreateFirewallRuleVisible(false);
      setEditFirewallRuleVisible(false);
      await loadFirewallRules();
    } catch (submitError) {
      setFirewallActionError(
        submitError instanceof Error
          ? submitError.message
          : mode === "create"
            ? t("containers.failedToCreateFirewallRule")
            : t("containers.failedToUpdateFirewallRule"),
      );
    } finally {
      setFirewallSubmitting(false);
    }
  };

  const deleteFirewallRule = async () => {
    if (!data || !selectedFirewallRule) {
      return;
    }

    try {
      setFirewallSubmitting(true);
      setFirewallActionError(null);
      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/firewall/rules/${selectedFirewallRule.pos}`, {
        method: "DELETE",
        ...encodeFormBody(new URLSearchParams()),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.firewallRuleDeleted"),
          dismissible: true,
          id: "container-firewall-rule-deleted",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setDeleteFirewallRuleVisible(false);
      setSelectedFirewallRule(null);
      await loadFirewallRules();
    } catch (deleteError) {
      setFirewallActionError(deleteError instanceof Error ? deleteError.message : t("containers.failedToDeleteFirewallRule"));
    } finally {
      setFirewallSubmitting(false);
    }
  };

  const saveFirewallOptions = async () => {
    if (!data) {
      return;
    }

    try {
      setFirewallSubmitting(true);
      setFirewallActionError(null);
      const params = new URLSearchParams();
      params.set("enable", firewallOptionsForm.enable ? "1" : "0");
      params.set("dhcp", firewallOptionsForm.dhcp ? "1" : "0");
      params.set("macfilter", firewallOptionsForm.macfilter ? "1" : "0");
      params.set("policy_in", firewallOptionsForm.policyIn || "DROP");
      params.set("policy_out", firewallOptionsForm.policyOut || "ACCEPT");

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/firewall/options`, {
        method: "PUT",
        ...encodeFormBody(params),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.firewallOptionsUpdated"),
          dismissible: true,
          id: "container-firewall-options-updated",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setEditFirewallOptionsVisible(false);
      await loadFirewallOptions();
    } catch (saveError) {
      setFirewallActionError(saveError instanceof Error ? saveError.message : t("containers.failedToUpdateFirewallOptions"));
    } finally {
      setFirewallSubmitting(false);
    }
  };

  const openDeleteBackupModal = (backup: ContainerBackupRow) => {
    setSelectedBackup(backup);
    setBackupActionError(null);
    setDeleteBackupVisible(true);
  };

  const deleteBackup = async () => {
    if (!data || !selectedBackup) {
      return;
    }

    try {
      setBackupSubmitting(true);
      setBackupActionError(null);
      await fetchProxmox(
        `/api/proxmox/nodes/${data.resource.node}/storage/${selectedBackup.storage}/content/${encodeURIComponent(selectedBackup.volid)}`,
        {
          method: "DELETE",
          ...encodeFormBody(new URLSearchParams()),
        },
      );

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.backupDeleted"),
          dismissible: true,
          id: "container-backup-deleted",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setDeleteBackupVisible(false);
      setSelectedBackup(null);
      await loadBackups();
    } catch (deleteError) {
      setBackupActionError(deleteError instanceof Error ? deleteError.message : t("containers.failedToDeleteBackup"));
    } finally {
      setBackupSubmitting(false);
    }
  };

  const submitMigration = useCallback(async () => {
    if (!data) {
      return;
    }

    const targetNode = optionValue(migrateTargetNode);

    if (!targetNode) {
      setMigrateError(t("containers.targetNodeRequired"));
      return;
    }

    try {
      setMigrateLoading(true);
      setMigrateError(null);

      const body = new URLSearchParams({
        target: targetNode,
      });

      body.set("restart", migrateOnline ? "1" : "0");

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/migrate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.migrationStarted").replace("{id}", String(vmid)).replace("{node}", targetNode),
          dismissible: true,
          id: "container-migration-started",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setMigrateModalVisible(false);
      await loadContainer();
    } catch (submitError) {
      setMigrateError(submitError instanceof Error ? submitError.message : t("containers.failedToMigrate"));
    } finally {
      setMigrateLoading(false);
    }
  }, [data, loadContainer, migrateOnline, migrateTargetNode, t, vmid]);

  const submitClone = useCallback(async () => {
    if (!data) {
      return;
    }

    const newId = cloneNewId.trim();
    const targetNode = optionValue(cloneTargetNode);
    const targetStorage = optionValue(cloneTargetStorage);
    const fullClone = optionValue(cloneFullClone) !== "linked";

    if (!isValidVmid(newId)) {
      setCloneError(t("containers.newIdRequired"));
      return;
    }

    if (!targetNode) {
      setCloneError(t("containers.targetNodeRequired"));
      return;
    }

    try {
      setCloneLoading(true);
      setCloneError(null);

      const body = new URLSearchParams({
        newid: newId,
        target: targetNode,
        full: fullClone ? "1" : "0",
      });

      if (cloneName.trim()) {
        body.set("hostname", cloneName.trim());
      }

      if (targetStorage) {
        body.set("storage", targetStorage);
      }

      if (cloneDescription.trim()) {
        body.set("description", cloneDescription.trim());
      }

      await fetchProxmox(`/api/proxmox/nodes/${data.resource.node}/lxc/${vmid}/clone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("containers.cloneStarted").replace("{id}", String(vmid)).replace("{newId}", newId),
          dismissible: true,
          id: "container-clone-started",
          onDismiss: () => setFlashbarItems([]),
        },
      ]);
      setCloneModalVisible(false);
      await loadContainer();
    } catch (submitError) {
      setCloneError(submitError instanceof Error ? submitError.message : t("containers.failedToClone"));
    } finally {
      setCloneLoading(false);
    }
  }, [cloneDescription, cloneFullClone, cloneName, cloneNewId, cloneTargetNode, cloneTargetStorage, data, loadContainer, t, vmid]);

  const snapshotColumns = useMemo<TableProps<PveSnapshot>["columnDefinitions"]>(
    () => [
      {
        id: "name",
        header: t("common.name"),
        cell: ({ name }) => name,
        isRowHeader: true,
      },
      {
        id: "parent",
        header: t("containers.parent"),
        cell: ({ parent }) => parent ?? "-",
      },
      {
        id: "snaptime",
        header: t("containers.created"),
        cell: ({ snaptime }) => formatDateTime(snaptime),
      },
      {
        id: "vmstate",
        header: t("containers.stateful"),
        cell: ({ vmstate }) => (vmstate ? yesLabel : noLabel),
      },
      {
        id: "description",
        header: t("containers.description"),
        cell: ({ description }) => description ?? "-",
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (snapshot) => snapshot.name === "current" ? "-" : (
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="inline-link" onClick={() => openRollbackSnapshotModal(snapshot)}>
              {t("containers.rollback")}
            </Button>
            <Button variant="inline-link" onClick={() => openDeleteSnapshotModal(snapshot)}>
              {t("containers.deleteSnapshot")}
            </Button>
          </SpaceBetween>
        ),
      },
    ],
    [noLabel, openDeleteSnapshotModal, openRollbackSnapshotModal, t, yesLabel],
  );

  const taskColumns = useMemo<TableProps<PveTask>["columnDefinitions"]>(
    () => [
      {
        id: "starttime",
        header: t("containers.started"),
        cell: ({ starttime }) => formatDateTime(starttime),
        isRowHeader: true,
      },
      {
        id: "endtime",
        header: t("containers.ended"),
        cell: ({ endtime }) => formatDateTime(endtime),
      },
      {
        id: "type",
        header: t("containers.task"),
        cell: ({ type, id }) => (id ? `${type} · ${id}` : type),
      },
      {
        id: "user",
        header: t("containers.user"),
        cell: ({ user }) => user,
      },
      {
        id: "status",
        header: t("common.status"),
        cell: ({ status }) => status ?? t("common.running"),
      },
    ],
    [t],
  );

  const networkColumns = useMemo<TableProps<NetworkInterfaceRow>["columnDefinitions"]>(
    () => [
      {
        id: "interface",
        header: t("containers.interface"),
        cell: ({ interface: interfaceName }) => interfaceName,
        isRowHeader: true,
      },
      {
        id: "bridge",
        header: t("containers.networkBridge"),
        cell: ({ bridge }) => bridge,
      },
      {
        id: "macAddress",
        header: t("containers.macAddress"),
        cell: ({ macAddress }) => macAddress,
      },
      {
        id: "ip",
        header: t("containers.ipAddress"),
        cell: ({ ip }) => ip,
      },
      {
        id: "firewall",
        header: t("containers.firewallEnabled"),
        cell: ({ firewall }) => firewall,
      },
      {
        id: "rateLimit",
        header: t("containers.rateLimit"),
        cell: ({ rateLimit }) => rateLimit,
      },
      {
        id: "vlanTag",
        header: t("containers.vlanTag"),
        cell: ({ vlanTag }) => vlanTag,
      },
    ],
    [t],
  );

  if (!Number.isFinite(vmid)) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("containers.containers")}</Header>
        <Alert type="error" header={t("containers.invalidCtid")}>
          {t("containers.ctidInvalid")}
        </Alert>
      </SpaceBetween>
    );
  }

  if (loading) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("containers.containers")} {vmid}</Header>
        <Box textAlign="center" padding={{ top: "xxxl" }}>
          <Spinner size="large" />
        </Box>
      </SpaceBetween>
    );
  }

  if (loadError || !data) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("containers.containers")} {vmid}</Header>
        <Alert type="error" header={t("containers.failedToLoadDetails")}>
          {loadError ?? t("containers.unknownError")}
        </Alert>
      </SpaceBetween>
    );
  }

  const { resource, config, snapshots, tasks, rrd } = data;
  const cpuSeries = rrd.map((point) => ({
    x: new Date(point.time * 1000),
    y: Math.round((point.cpu ?? 0) * 1000) / 10,
  }));
  const memorySeries = rrd.map((point) => ({
    x: new Date(point.time * 1000),
    y: point.memtotal ? Math.round(((point.memused ?? 0) / point.memtotal) * 1000) / 10 : 0,
  }));
  const configItems = Object.entries(config)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([label, value]) => ({
      label: labelForConfigKey(label),
      value: formatConfigValue(label, value as ContainerConfigValue, yesLabel, noLabel),
    }));
  const networkInterfaces = getNetworkInterfaces(config, yesLabel, noLabel);
  const summaryItems = [
    {
      label: t("containers.ctid"),
      value: String(vmid),
    },
    {
      label: t("common.name"),
      value: resource.name ?? "-",
    },
    {
      label: t("vms.node"),
      value: resource.node,
    },
    {
      label: t("common.status"),
      value: <StatusIndicator type={getStatusType(resource.status)}>{resource.status}</StatusIndicator>,
    },
    {
      label: t("common.cpuPercent"),
      value: `${((resource.cpu ?? 0) * 100).toFixed(1)}%`,
    },
    {
      label: t("containers.cpuCores"),
      value: String(resource.maxcpu ?? config.cores ?? "-"),
    },
    {
      label: t("common.memory"),
      value: `${formatBytes(resource.mem ?? 0)} / ${formatBytes(resource.maxmem ?? 0)}`,
    },
    {
      label: t("common.disk"),
      value: `${formatBytes(resource.disk ?? 0)} / ${formatBytes(resource.maxdisk ?? 0)}`,
    },
    {
      label: t("common.uptime"),
      value: formatUptime(resource.uptime ?? 0),
    },
    {
      label: t("containers.hostname"),
      value: getConfigStringValue(config.hostname) || "-",
    },
  ];
  const startDisabled = resource.status !== "stopped" || isEnabled(config.template as number | boolean | null | undefined) || actionLoading !== null;
  const stopDisabled = resource.status !== "running" || actionLoading !== null;
  const rebootDisabled = resource.status !== "running" || actionLoading !== null;
  const consoleDisabled = resource.status !== "running" || actionLoading !== null;
  const chartDomain = cpuSeries.length > 1 ? [cpuSeries[0].x, cpuSeries[cpuSeries.length - 1].x] : undefined;
  const optionsDetails = buildContainerOptionsForm(config);
  const dnsDetails = buildDnsForm(dnsConfig ?? config);
  const firewallOptionsDetails = buildFirewallOptionsForm(firewallOptions);
  const optionsItems = [
    {
      label: t("containers.startOnBootLabel"),
      value: <StatusIndicator type={optionsDetails.onboot ? "success" : "stopped"}>{optionsDetails.onboot ? yesLabel : noLabel}</StatusIndicator>,
    },
    {
      label: t("containers.protectionLabel"),
      value: <StatusIndicator type={optionsDetails.protection ? "success" : "stopped"}>{optionsDetails.protection ? yesLabel : noLabel}</StatusIndicator>,
    },
    {
      label: t("containers.unprivilegedLabel"),
      value: <StatusIndicator type={isEnabled(config.unprivileged as number | boolean | null | undefined) ? "success" : "stopped"}>{isEnabled(config.unprivileged as number | boolean | null | undefined) ? yesLabel : noLabel}</StatusIndicator>,
    },
    {
      label: t("containers.featuresLabel"),
      value: getTextValue(getConfigStringValue(config.features), t("cluster.common.none")),
    },
    {
      label: t("containers.consoleModeLabel"),
      value: consoleModeLabel(getConfigStringValue(config.cmode) || "console"),
    },
  ];
  const dnsItems = [
    {
      label: t("containers.dnsServerLabel"),
      value: getTextValue(dnsDetails.nameserver, t("cluster.common.none")),
    },
    {
      label: t("containers.searchDomainLabel"),
      value: getTextValue(dnsDetails.searchdomain, t("cluster.common.none")),
    },
  ];
  const firewallRuleColumns: TableProps<ContainerFirewallRule>["columnDefinitions"] = [
    { id: "pos", header: t("firewall.position"), cell: ({ pos }) => String(pos), isRowHeader: true },
    { id: "type", header: t("firewall.type"), cell: ({ type }) => firewallTypeLabel(type) },
    { id: "action", header: t("firewall.action"), cell: ({ action }) => firewallActionLabel(action) },
    { id: "proto", header: t("firewall.protocol"), cell: ({ proto }) => getTextValue(proto, t("firewall.anyProtocol")) },
    { id: "source", header: t("firewall.source"), cell: ({ source }) => getTextValue(source, t("cluster.common.none")) },
    { id: "dest", header: t("firewall.destination"), cell: ({ dest }) => getTextValue(dest, t("cluster.common.none")) },
    { id: "dport", header: t("firewall.destinationPort"), cell: ({ dport }) => getTextValue(dport, t("cluster.common.none")) },
    { id: "comment", header: t("firewall.comment"), cell: ({ comment }) => getTextValue(comment, t("cluster.common.none")) },
    {
      id: "enable",
      header: t("firewall.enable"),
      cell: (rule) => <StatusIndicator type={isEnabled(rule.enable) ? "success" : "stopped"}>{isEnabled(rule.enable) ? t("firewall.enabled") : t("firewall.disabled")}</StatusIndicator>,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: (rule) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Button onClick={() => openEditFirewallRuleModal(rule)}>{t("common.edit")}</Button>
          <Button onClick={() => openDeleteFirewallRuleModal(rule)}>{t("common.delete")}</Button>
        </SpaceBetween>
      ),
    },
  ];
  const backupColumns: TableProps<ContainerBackupRow>["columnDefinitions"] = [
    { id: "volid", header: t("containers.backupVolid"), cell: ({ volid }) => volid, isRowHeader: true },
    { id: "ctime", header: t("containers.backupDate"), cell: ({ ctime }) => formatDateTime(ctime) },
    { id: "size", header: t("containers.backupSize"), cell: ({ size }) => formatBytes(size ?? 0) },
    { id: "notes", header: t("containers.backupNotes"), cell: ({ notes }) => getTextValue(notes, t("cluster.common.none")) },
    {
      id: "actions",
      header: t("common.actions"),
      cell: (backup) => <Button onClick={() => openDeleteBackupModal(backup)}>{t("containers.deleteBackup")}</Button>,
    },
  ];
  const tabs: TabsProps.Tab[] = [
    {
      id: "summary",
      label: t("containers.summary"),
      content: (
        <SpaceBetween size="l">
          <ColumnLayout columns={1}>
            <KeyValuePairs columns={4} items={summaryItems} />
          </ColumnLayout>
          <SpaceBetween size="s">
            <Header variant="h2">{t("containers.performance")}</Header>
            <AreaChart
              height={320}
              fitHeight
              series={[
                { title: t("nodeDetail.cpuPercent"), type: "area", data: cpuSeries },
                { title: t("nodeDetail.memoryPercent"), type: "area", data: memorySeries },
              ]}
              xScaleType="time"
              xTitle={t("common.time")}
              yTitle={t("common.usagePercent")}
              yDomain={[0, 100]}
              xDomain={chartDomain}
              i18nStrings={{
                xTickFormatter: (value) => (value as Date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                yTickFormatter: (value) => `${value}%`,
              }}
              ariaLabel={`${t("containers.performance")} ${t("containers.containers")} ${vmid}`}
              empty={<Box textAlign="center" color="text-body-secondary">{t("containers.noPerformanceData")}</Box>}
            />
          </SpaceBetween>
        </SpaceBetween>
      ),
    },
    {
      id: "config",
      label: t("containers.config"),
      content: (
        <SpaceBetween size="s">
          <Header
            variant="h2"
            actions={
              <Button onClick={openEditModal} disabled={savingConfig}>
                {t("common.edit")}
              </Button>
            }
          >
            {t("containers.configuration")}
          </Header>
          {configItems.length > 0 ? (
            <KeyValuePairs columns={3} items={configItems} />
          ) : (
            <Box textAlign="center" color="text-body-secondary" padding="xxl">{t("containers.noConfigAvailable")}</Box>
          )}
        </SpaceBetween>
      ),
    },
    {
      id: "network",
      label: t("containers.network"),
      content: (
        <Table
          variant="borderless"
          stickyHeader
          resizableColumns
          enableKeyboardNavigation
          trackBy="id"
          items={networkInterfaces}
          columnDefinitions={networkColumns}
          empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("containers.noNetworkInterfacesAvailable")}</Box>}
          header={<Header variant="h2" counter={`(${networkInterfaces.length})`}>{t("containers.networkInterfaces")}</Header>}
        />
      ),
    },
    {
      id: "snapshots",
      label: t("containers.snapshots"),
      content: (
        <Table
          variant="borderless"
          stickyHeader
          resizableColumns
          enableKeyboardNavigation
          trackBy="name"
          items={snapshots}
          columnDefinitions={snapshotColumns}
          empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("containers.noSnapshotsAvailable")}</Box>}
          header={
            <Header
              variant="h2"
              counter={`(${snapshots.length})`}
              actions={
                <Button onClick={openCreateSnapshotModal} loading={snapshotLoading} disabled={snapshotLoading}>
                  {t("containers.createSnapshot")}
                </Button>
              }
            >
              {t("containers.snapshots")}
            </Header>
          }
        />
      ),
    },
    {
      id: "tasks",
      label: t("containers.tasks"),
      content: (
        <Table
          variant="borderless"
          stickyHeader
          resizableColumns
          enableKeyboardNavigation
          trackBy="upid"
          items={tasks}
          columnDefinitions={taskColumns}
          empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("containers.noRecentTasks")}</Box>}
          header={<Header variant="h2" counter={`(${tasks.length})`}>{t("logs.recentTasks")}</Header>}
        />
      ),
    },
    {
      id: "options",
      label: t("containers.optionsTab"),
      content: (
        <SpaceBetween size="s">
          <Header
            variant="h2"
            actions={
              <Button onClick={openOptionsModal} disabled={optionsSaveLoading}>
                {t("containers.editOptions")}
              </Button>
            }
          >
            {t("containers.optionsTab")}
          </Header>
          <KeyValuePairs columns={2} items={optionsItems} />
        </SpaceBetween>
      ),
    },
    {
      id: "dns",
      label: t("containers.dnsTab"),
      content: (
        <SpaceBetween size="s">
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => void loadDnsConfig()} loading={dnsLoading}>
                  {t("common.refresh")}
                </Button>
                <Button onClick={openDnsModal} disabled={dnsLoading}>
                  {t("containers.editDns")}
                </Button>
              </SpaceBetween>
            }
          >
            {t("containers.dnsTab")}
          </Header>
          {dnsError ? <Alert type="error">{dnsError}</Alert> : null}
          {dnsLoading && !dnsConfig ? (
            <Box>{t("common.loading")}</Box>
          ) : (
            <KeyValuePairs columns={2} items={dnsItems} />
          )}
        </SpaceBetween>
      ),
    },
    {
      id: "firewall",
      label: t("containers.firewallTab"),
      content: (
        <SpaceBetween size="l">
          {firewallRulesError ? <Alert type="error">{firewallRulesError}</Alert> : null}
          {firewallOptionsError ? <Alert type="error">{firewallOptionsError}</Alert> : null}
          <Table
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy="pos"
            items={firewallRules}
            columnDefinitions={firewallRuleColumns}
            loading={firewallRulesLoading}
            loadingText={t("common.loading")}
            empty={renderCenteredState(t("firewall.noRules"), t("firewall.noRulesDescription"), <Button onClick={openCreateFirewallRuleModal}>{t("containers.addFirewallRule")}</Button>)}
            header={
              <Header
                variant="h2"
                counter={`(${firewallRules.length})`}
                actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button iconName="refresh" onClick={() => void loadFirewallRules()} loading={firewallRulesLoading}>
                      {t("common.refresh")}
                    </Button>
                    <Button onClick={openCreateFirewallRuleModal}>{t("containers.addFirewallRule")}</Button>
                  </SpaceBetween>
                }
              >
                {t("containers.ctFirewallRules")}
              </Header>
            }
          />
          <SpaceBetween size="s">
            <Header
              variant="h2"
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button iconName="refresh" onClick={() => void loadFirewallOptions()} loading={firewallOptionsLoading}>
                    {t("common.refresh")}
                  </Button>
                  <Button onClick={openEditFirewallOptionsModal} disabled={firewallOptionsLoading}>
                    {t("containers.editFirewallOptions")}
                  </Button>
                </SpaceBetween>
              }
            >
              {t("containers.ctFirewallOptions")}
            </Header>
            {firewallOptionsLoading && !firewallOptions ? (
              <Box>{t("common.loading")}</Box>
            ) : (
              <KeyValuePairs
                columns={2}
                items={[
                  { label: t("containers.firewallEnabled"), value: <StatusIndicator type={firewallOptionsDetails.enable ? "success" : "stopped"}>{firewallOptionsDetails.enable ? yesLabel : noLabel}</StatusIndicator> },
                  { label: t("containers.dhcp"), value: <StatusIndicator type={firewallOptionsDetails.dhcp ? "success" : "stopped"}>{firewallOptionsDetails.dhcp ? yesLabel : noLabel}</StatusIndicator> },
                  { label: t("containers.macFilter"), value: <StatusIndicator type={firewallOptionsDetails.macfilter ? "success" : "stopped"}>{firewallOptionsDetails.macfilter ? yesLabel : noLabel}</StatusIndicator> },
                  { label: t("firewall.policyIn"), value: firewallActionLabel(firewallOptionsDetails.policyIn) },
                  { label: t("firewall.policyOut"), value: firewallActionLabel(firewallOptionsDetails.policyOut) },
                ]}
              />
            )}
          </SpaceBetween>
        </SpaceBetween>
      ),
    },
    {
      id: "backup",
      label: t("containers.backupTab"),
      content: (
        <SpaceBetween size="s">
          {backupsError ? <Alert type="error">{backupsError}</Alert> : null}
          <Table
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy="id"
            items={backups}
            columnDefinitions={backupColumns}
            loading={backupsLoading}
            loadingText={t("containers.loadingBackups")}
            empty={renderCenteredState(t("containers.noBackups"), t("containers.ctBackups"))}
            header={
              <Header
                variant="h2"
                counter={`(${backups.length})`}
                actions={
                  <Button iconName="refresh" onClick={() => void loadBackups()} loading={backupsLoading}>
                    {t("common.refresh")}
                  </Button>
                }
              >
                {t("containers.ctBackups")}
              </Header>
            }
          />
        </SpaceBetween>
      ),
    },
  ];

  return (
    <SpaceBetween size="m">
      <GuestPowerConfirmation action={pendingPowerAction} guests={[{ vmid: vmid, name: resource.name }]} busy={actionLoading !== null} onDismiss={() => setPendingPowerAction(null)} onConfirm={() => { if (pendingPowerAction) void handlePowerAction(pendingPowerAction); }} />
      {flashbarItems.length > 0 ? <Flashbar items={flashbarItems.map((item) => ({ ...item, dismissLabel: item.dismissLabel ?? t("common.close"), onDismiss: item.onDismiss ?? (() => setFlashbarItems((current) => current.filter((entry) => entry !== item))) }))} /> : null}
      {actionError ? (
        <Alert type="error" header={t("containers.failedRequest")} dismissible onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      ) : null}
      {snapshotError ? (
        <Alert type="error" header={t("common.error")} dismissible onDismiss={() => setSnapshotError(null)}>
          {snapshotError}
        </Alert>
      ) : null}
      <Header
        variant="h1"
        description={`${t("containers.ctid")} ${vmid}`}
        actions={
          <SpaceBetween size="xs" direction="horizontal">
            <Button loading={actionLoading === "start"} disabled={startDisabled} onClick={() => requestPowerAction("start")}>
              {t("containers.start")}
            </Button>
            <Button loading={actionLoading === "shutdown"} disabled={stopDisabled} onClick={() => requestPowerAction("shutdown")}>
              {t("nodeDetail.shutdown")}
            </Button>
            <Button loading={actionLoading === "stop"} disabled={stopDisabled} onClick={() => requestPowerAction("stop")}>
              {t("containers.stop")}
            </Button>
            <Button loading={actionLoading === "reboot"} disabled={rebootDisabled} onClick={() => requestPowerAction("reboot")}>
              {t("containers.reboot")}
            </Button>
            <Button disabled={actionLoading !== null} onClick={() => void openMigrateModal()}>
              {t("containers.migrate")}
            </Button>
            <Button disabled={actionLoading !== null} onClick={() => void openCloneModal()}>
              {t("containers.clone")}
            </Button>
            <Button disabled={consoleDisabled} onClick={() => router.push(`/containers/${vmid}/console`)}>
              {t("containers.console")}
            </Button>
            <Button iconName="refresh" disabled={actionLoading !== null} onClick={() => void loadContainer()}>
              {t("common.refresh")}
            </Button>
          </SpaceBetween>
        }
      >
        {(resource.name ?? `${t("containers.containers")} ${vmid}`) + ` · ${t("containers.ctid")} ${vmid}`}
      </Header>
      <Tabs tabs={tabs} activeTabId={activeTabId} onChange={({ detail }) => setActiveTabId(detail.activeTabId)} />
      <Modal
        visible={migrateModalVisible}
        onDismiss={() => {
          setMigrateModalVisible(false);
          setMigrateError(null);
        }}
        header={t("containers.migrateContainer")}
        closeAriaLabel={t("containers.migrateContainer")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setMigrateModalVisible(false);
                  setMigrateError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={migrateLoading} onClick={() => void submitMigration()}>
                {t("containers.migrate")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {migrateError ? (
            <Alert type="error" header={t("containers.failedToMigrate")}>
              {migrateError}
            </Alert>
          ) : null}
          <FormField label={t("containers.targetNode")}>
            <Select
              selectedOption={migrateTargetNode}
              onChange={({ detail }) => setMigrateTargetNode(detail.selectedOption)}
              options={availableNodes}
              placeholder={t("containers.targetNode")}
              statusType={loadingNodes ? "loading" : "finished"}
              loadingText={t("containers.loadingNodes")}
              empty={t("containers.noOtherNodes")}
            />
          </FormField>
          <Checkbox checked={migrateOnline} onChange={({ detail }) => setMigrateOnline(detail.checked)}>
            {t("containers.restartMigration")}
          </Checkbox>
          <Box color="text-body-secondary">
            {t("containers.restartMigrationDesc")}
          </Box>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={cloneModalVisible}
        onDismiss={() => {
          setCloneModalVisible(false);
          setCloneError(null);
        }}
        header={t("containers.cloneContainer")}
        closeAriaLabel={t("containers.cloneContainer")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setCloneModalVisible(false);
                  setCloneError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={cloneLoading} onClick={() => void submitClone()}>
                {t("containers.clone")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {cloneError ? (
            <Alert type="error" header={t("containers.failedToClone")}>
              {cloneError}
            </Alert>
          ) : null}
          <FormField label={t("containers.newCtId")}>
            <Input type="number" value={cloneNewId} onChange={({ detail }) => setCloneNewId(detail.value)} />
          </FormField>
          <FormField label={t("containers.newHostname")}>
            <Input value={cloneName} onChange={({ detail }) => setCloneName(detail.value)} />
          </FormField>
          <FormField label={t("containers.targetNode")}>
            <Select
              selectedOption={cloneTargetNode}
              onChange={({ detail }) => {
                setCloneTargetNode(detail.selectedOption);
                setCloneTargetStorage(null);
                setAvailableStorages([]);
              }}
              options={availableNodes}
              placeholder={t("containers.targetNode")}
              statusType={loadingNodes ? "loading" : "finished"}
              loadingText={t("containers.loadingNodes")}
            />
          </FormField>
          <FormField label={t("containers.targetStorage")} description={t("containers.targetStorageDesc")}>
            <Select
              selectedOption={cloneTargetStorage}
              onChange={({ detail }) => setCloneTargetStorage(detail.selectedOption)}
              options={availableStorages}
              placeholder={t("containers.sameStorageHint")}
              statusType={loadingStorages ? "loading" : "finished"}
              loadingText={t("containers.loadingStorages")}
              empty={t("containers.sameStorageHint")}
            />
          </FormField>
          <FormField label={t("containers.cloneMode")}>
            <Select
              selectedOption={cloneFullClone}
              onChange={({ detail }) => setCloneFullClone(detail.selectedOption)}
              options={cloneModeOptions}
            />
          </FormField>
          <FormField label={t("containers.description")}>
            <Textarea value={cloneDescription} onChange={({ detail }) => setCloneDescription(detail.value)} rows={4} />
          </FormField>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={createSnapshotModalVisible}
        onDismiss={() => {
          setCreateSnapshotModalVisible(false);
          setSnapshotError(null);
        }}
        header={t("containers.createSnapshot")}
        closeAriaLabel={t("containers.createSnapshot")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setCreateSnapshotModalVisible(false);
                  setSnapshotError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={snapshotLoading} onClick={() => void createSnapshot()}>
                {t("containers.createSnapshot")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {snapshotError ? (
            <Alert type="error" header={t("containers.failedToCreateSnapshot")}>
              {snapshotError}
            </Alert>
          ) : null}
          <FormField label={t("containers.snapshotName")}>
            <Input value={snapshotName} onChange={({ detail }) => setSnapshotName(detail.value)} />
          </FormField>
          <FormField label={t("containers.snapshotDescription")}>
            <Textarea value={snapshotDescription} onChange={({ detail }) => setSnapshotDescription(detail.value)} rows={4} />
          </FormField>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={deleteSnapshotModalVisible}
        onDismiss={() => {
          setDeleteSnapshotModalVisible(false);
          setSelectedSnapshot(null);
          setSnapshotError(null);
        }}
        header={t("containers.deleteSnapshot")}
        closeAriaLabel={t("containers.deleteSnapshot")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setDeleteSnapshotModalVisible(false);
                  setSelectedSnapshot(null);
                  setSnapshotError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={snapshotLoading} onClick={() => void deleteSnapshot()}>
                {t("common.confirm")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {snapshotError ? (
            <Alert type="error" header={t("containers.failedToDeleteSnapshot")}>
              {snapshotError}
            </Alert>
          ) : null}
          <Box>{t("containers.confirmDeleteSnapshot").replace("{name}", selectedSnapshot?.name ?? "")}</Box>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={rollbackSnapshotModalVisible}
        onDismiss={() => {
          setRollbackSnapshotModalVisible(false);
          setSelectedSnapshot(null);
          setSnapshotError(null);
        }}
        header={t("containers.rollbackSnapshot")}
        closeAriaLabel={t("containers.rollbackSnapshot")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setRollbackSnapshotModalVisible(false);
                  setSelectedSnapshot(null);
                  setSnapshotError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={snapshotLoading} onClick={() => void rollbackSnapshot()}>
                {t("common.confirm")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {snapshotError ? (
            <Alert type="error" header={t("containers.failedToRollbackSnapshot")}>
              {snapshotError}
            </Alert>
          ) : null}
          <Alert type="warning" header={t("containers.rollbackSnapshot")}>
            {t("containers.confirmRollbackSnapshot").replace("{name}", selectedSnapshot?.name ?? "")}
          </Alert>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={optionsModalVisible}
        onDismiss={() => {
          setOptionsModalVisible(false);
          setOptionsError(null);
        }}
        header={t("containers.editOptions")}
        closeAriaLabel={t("containers.editOptions")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setOptionsModalVisible(false);
                  setOptionsError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={optionsSaveLoading} onClick={() => void saveOptions()}>
                {t("common.save")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {optionsError ? <Alert type="error">{optionsError}</Alert> : null}
          <Toggle checked={optionsForm.onboot} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, onboot: detail.checked }))}>
            {t("containers.startOnBootLabel")}
          </Toggle>
          <Toggle checked={optionsForm.protection} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, protection: detail.checked }))}>
            {t("containers.protectionLabel")}
          </Toggle>
          <FormField label={t("containers.consoleModeLabel")}>
            <Select
              selectedOption={consoleModeOptions.find((option) => option.value === optionsForm.cmode) ?? null}
              onChange={({ detail }) => setOptionsForm((current) => ({ ...current, cmode: optionValue(detail.selectedOption) || "console" }))}
              options={consoleModeOptions}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={dnsModalVisible}
        onDismiss={() => {
          setDnsModalVisible(false);
          setDnsError(null);
        }}
        header={t("containers.editDns")}
        closeAriaLabel={t("containers.editDns")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setDnsModalVisible(false);
                  setDnsError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={dnsSaveLoading} onClick={() => void saveDns()}>
                {t("common.save")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {dnsError ? <Alert type="error">{dnsError}</Alert> : null}
          <FormField label={t("containers.dnsServerLabel")}>
            <Input
              value={dnsForm.nameserver}
              placeholder={t("containers.dnsServerPlaceholder")}
              onChange={({ detail }) => setDnsForm((current) => ({ ...current, nameserver: detail.value }))}
            />
          </FormField>
          <FormField label={t("containers.searchDomainLabel")}>
            <Input
              value={dnsForm.searchdomain}
              placeholder={t("containers.searchDomainPlaceholder")}
              onChange={({ detail }) => setDnsForm((current) => ({ ...current, searchdomain: detail.value }))}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={createFirewallRuleVisible}
        onDismiss={() => setCreateFirewallRuleVisible(false)}
        header={t("containers.addFirewallRule")}
        closeAriaLabel={t("containers.addFirewallRule")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setCreateFirewallRuleVisible(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={firewallSubmitting} onClick={() => void submitFirewallRule("create")}>
                {t("common.create")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {firewallActionError ? <Alert type="error">{firewallActionError}</Alert> : null}
          <FormField label={t("firewall.type")}>
            <Select
              selectedOption={firewallTypeOptions.find((option) => option.value === firewallRuleForm.type) ?? null}
              onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, type: optionValue(detail.selectedOption) || "in" }))}
              options={firewallTypeOptions}
            />
          </FormField>
          <FormField label={t("firewall.action")}>
            <Select
              selectedOption={firewallActionOptions.find((option) => option.value === firewallRuleForm.action) ?? null}
              onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, action: optionValue(detail.selectedOption) || "ACCEPT" }))}
              options={firewallActionOptions}
            />
          </FormField>
          <FormField label={t("firewall.protocol")}>
            <Select
              selectedOption={firewallProtocolOptions.find((option) => option.value === firewallRuleForm.proto) ?? null}
              onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, proto: optionValue(detail.selectedOption) }))}
              options={firewallProtocolOptions}
            />
          </FormField>
          <FormField label={t("firewall.source")}>
            <Input value={firewallRuleForm.source} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, source: detail.value }))} />
          </FormField>
          <FormField label={t("firewall.destination")}>
            <Input value={firewallRuleForm.dest} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, dest: detail.value }))} />
          </FormField>
          <FormField label={t("firewall.destinationPort")}>
            <Input value={firewallRuleForm.dport} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, dport: detail.value }))} />
          </FormField>
          <FormField label={t("firewall.comment")}>
            <Textarea value={firewallRuleForm.comment} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, comment: detail.value }))} rows={4} />
          </FormField>
          <Toggle checked={firewallRuleForm.enable} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, enable: detail.checked }))}>
            {t("firewall.enable")}
          </Toggle>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={editFirewallRuleVisible}
        onDismiss={() => setEditFirewallRuleVisible(false)}
        header={t("containers.editFirewallRule")}
        closeAriaLabel={t("containers.editFirewallRule")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setEditFirewallRuleVisible(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={firewallSubmitting} onClick={() => void submitFirewallRule("edit")}>
                {t("common.save")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {firewallActionError ? <Alert type="error">{firewallActionError}</Alert> : null}
          <FormField label={t("firewall.type")}>
            <Select
              selectedOption={firewallTypeOptions.find((option) => option.value === firewallRuleForm.type) ?? null}
              onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, type: optionValue(detail.selectedOption) || "in" }))}
              options={firewallTypeOptions}
            />
          </FormField>
          <FormField label={t("firewall.action")}>
            <Select
              selectedOption={firewallActionOptions.find((option) => option.value === firewallRuleForm.action) ?? null}
              onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, action: optionValue(detail.selectedOption) || "ACCEPT" }))}
              options={firewallActionOptions}
            />
          </FormField>
          <FormField label={t("firewall.protocol")}>
            <Select
              selectedOption={firewallProtocolOptions.find((option) => option.value === firewallRuleForm.proto) ?? null}
              onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, proto: optionValue(detail.selectedOption) }))}
              options={firewallProtocolOptions}
            />
          </FormField>
          <FormField label={t("firewall.source")}>
            <Input value={firewallRuleForm.source} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, source: detail.value }))} />
          </FormField>
          <FormField label={t("firewall.destination")}>
            <Input value={firewallRuleForm.dest} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, dest: detail.value }))} />
          </FormField>
          <FormField label={t("firewall.destinationPort")}>
            <Input value={firewallRuleForm.dport} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, dport: detail.value }))} />
          </FormField>
          <FormField label={t("firewall.comment")}>
            <Textarea value={firewallRuleForm.comment} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, comment: detail.value }))} rows={4} />
          </FormField>
          <Toggle checked={firewallRuleForm.enable} onChange={({ detail }) => setFirewallRuleForm((current) => ({ ...current, enable: detail.checked }))}>
            {t("firewall.enable")}
          </Toggle>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={deleteFirewallRuleVisible}
        onDismiss={() => setDeleteFirewallRuleVisible(false)}
        header={t("containers.deleteFirewallRule")}
        closeAriaLabel={t("containers.deleteFirewallRule")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setDeleteFirewallRuleVisible(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={firewallSubmitting} onClick={() => void deleteFirewallRule()}>
                {t("common.delete")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {firewallActionError ? <Alert type="error">{firewallActionError}</Alert> : null}
          <Box>
            {selectedFirewallRule
              ? interpolate(t("containers.deleteFirewallRuleConfirmation"), { pos: selectedFirewallRule.pos })
              : null}
          </Box>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={editFirewallOptionsVisible}
        onDismiss={() => setEditFirewallOptionsVisible(false)}
        header={t("containers.editFirewallOptions")}
        closeAriaLabel={t("containers.editFirewallOptions")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setEditFirewallOptionsVisible(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={firewallSubmitting} onClick={() => void saveFirewallOptions()}>
                {t("common.save")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {firewallActionError ? <Alert type="error">{firewallActionError}</Alert> : null}
          <Toggle checked={firewallOptionsForm.enable} onChange={({ detail }) => setFirewallOptionsForm((current) => ({ ...current, enable: detail.checked }))}>
            {t("containers.firewallEnabled")}
          </Toggle>
          <Toggle checked={firewallOptionsForm.dhcp} onChange={({ detail }) => setFirewallOptionsForm((current) => ({ ...current, dhcp: detail.checked }))}>
            {t("containers.dhcp")}
          </Toggle>
          <Toggle checked={firewallOptionsForm.macfilter} onChange={({ detail }) => setFirewallOptionsForm((current) => ({ ...current, macfilter: detail.checked }))}>
            {t("containers.macFilter")}
          </Toggle>
          <FormField label={t("firewall.policyIn")}>
            <Select
              selectedOption={firewallActionOptions.find((option) => option.value === firewallOptionsForm.policyIn) ?? null}
              onChange={({ detail }) => setFirewallOptionsForm((current) => ({ ...current, policyIn: optionValue(detail.selectedOption) || "DROP" }))}
              options={firewallActionOptions}
            />
          </FormField>
          <FormField label={t("firewall.policyOut")}>
            <Select
              selectedOption={firewallActionOptions.find((option) => option.value === firewallOptionsForm.policyOut) ?? null}
              onChange={({ detail }) => setFirewallOptionsForm((current) => ({ ...current, policyOut: optionValue(detail.selectedOption) || "ACCEPT" }))}
              options={firewallActionOptions}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={deleteBackupVisible}
        onDismiss={() => {
          setDeleteBackupVisible(false);
          setSelectedBackup(null);
          setBackupActionError(null);
        }}
        header={t("containers.deleteBackup")}
        closeAriaLabel={t("containers.deleteBackup")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setDeleteBackupVisible(false);
                  setSelectedBackup(null);
                  setBackupActionError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={backupSubmitting} onClick={() => void deleteBackup()}>
                {t("common.delete")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {backupActionError ? <Alert type="error">{backupActionError}</Alert> : null}
          <Box>
            {selectedBackup
              ? interpolate(t("containers.deleteBackupConfirmation"), { volid: selectedBackup.volid })
              : null}
          </Box>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={editModalVisible}
        onDismiss={() => {
          setEditModalVisible(false);
          setConfigError(null);
        }}
        header={t("containers.editConfiguration")}
        closeAriaLabel="Close edit configuration modal"
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setEditModalVisible(false);
                  setConfigError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={savingConfig} onClick={() => void saveConfiguration()}>
                {t("containers.saveChanges")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {configError ? (
            <Alert type="error" header={t("containers.failedToUpdateConfig")}>
              {configError}
            </Alert>
          ) : null}
          <FormField label={t("containers.cpuCores")}>
            <Input type="number" value={editCores} onChange={({ detail }) => setEditCores(detail.value)} />
          </FormField>
          <FormField label={t("containers.memoryMb")}>
            <Input type="number" value={editMemory} onChange={({ detail }) => setEditMemory(detail.value)} />
          </FormField>
          <FormField label={t("containers.swapMb")}>
            <Input type="number" value={editSwap} onChange={({ detail }) => setEditSwap(detail.value)} />
          </FormField>
          <FormField label={t("containers.description")}>
            <Textarea value={editDescription} onChange={({ detail }) => setEditDescription(detail.value)} rows={4} />
          </FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
