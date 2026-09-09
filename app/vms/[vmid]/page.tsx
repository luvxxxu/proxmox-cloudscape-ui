"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";
import { GuestPowerConfirmation, type GuestPowerAction } from "@/app/lib/guest-power-confirmation";
import { useSettings } from "@/app/components/settings-context";

import { formatResourceBytes as formatBytes, isStorageActive, isValidVmid, setOptionalParameters, readPropertyValue, updatePropertyValue, isIntegerInRange } from "@/app/lib/resource-api";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import AreaChart from "@cloudscape-design/components/area-chart";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
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

interface ClusterVmResource {
  vmid: number;
  node?: string;
  name?: string;
  status?: string;
  type?: string;
}

interface VmStatus {
  vmid: number;
  name?: string;
  status: string;
  cpus?: number;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
}

interface VmRrdPoint {
  time: number;
  cpu?: number;
  memused?: number;
  memtotal?: number;
}

interface VmSnapshot {
  name: string;
  description?: string;
  snaptime?: number;
  vmstate?: boolean | number;
}

interface VmTask {
  upid: string;
  starttime: number;
  type: string;
  status?: string;
  user: string;
}

type VmConfigValue = string | number | boolean;
type VmConfig = Record<string, VmConfigValue | null | undefined>;

interface VmDetailData {
  node: string;
  status: VmStatus;
  rrd: VmRrdPoint[];
  config: VmConfig;
  snapshots: VmSnapshot[];
  tasks: VmTask[];
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

interface VmOptionsFormState {
  boot: string;
  onboot: boolean;
  agent: boolean;
  protection: boolean;
  hotplug: string;
  tablet: boolean;
  localtime: boolean;
}

interface VmCloudInitFormState {
  ciuser: string;
  cipassword: string;
  nameserver: string;
  searchdomain: string;
  sshkeys: string;
  ipconfig0: string;
  citype: string;
}

interface VmFirewallRule {
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

interface VmFirewallOptions {
  enable?: number | boolean;
  dhcp?: number | boolean;
  macfilter?: number | boolean;
  policy_in?: string;
  policy_out?: string;
}

interface VmFirewallRuleFormState {
  type: string;
  action: string;
  proto: string;
  source: string;
  dest: string;
  dport: string;
  comment: string;
  enable: boolean;
}

interface VmFirewallOptionsFormState {
  enable: boolean;
  dhcp: boolean;
  macfilter: boolean;
  policyIn: string;
  policyOut: string;
}

interface VmBackupItem {
  storage: string;
  volid: string;
  ctime?: number;
  size?: number;
  notes?: string;
}

const EMPTY_VM_FIREWALL_RULE_FORM: VmFirewallRuleFormState = {
  type: "in",
  action: "ACCEPT",
  proto: "",
  source: "",
  dest: "",
  dport: "",
  comment: "",
  enable: true,
};

const EMPTY_VM_FIREWALL_OPTIONS_FORM: VmFirewallOptionsFormState = {
  enable: false,
  dhcp: false,
  macfilter: false,
  policyIn: "DROP",
  policyOut: "ACCEPT",
};



function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function formatDateTime(timestamp?: number): string {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp * 1000).toLocaleString();
}

function getVmStatusType(status?: string) {
  if (status === "running") {
    return "success" as const;
  }
  if (status === "stopped") {
    return "stopped" as const;
  }
  if (status === "paused") {
    return "warning" as const;
  }
  return "info" as const;
}

function formatConfigValue(key: string, value: VmConfigValue, t: (key: string) => string): string {
  if (typeof value === "boolean") {
    return value ? t("network.yes") : t("network.no");
  }
  if (typeof value === "number") {
    if (key === "memory") {
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

function getConfigStringValue(value: VmConfigValue | null | undefined): string {
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

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function isEnabled(value?: string | number | boolean | null) {
  return value === 1 || value === true || value === "1";
}

function getTextValue(value?: string | null, fallback = "-") {
  return value?.trim() ? value : fallback;
}

function decodeUrlValue(value?: string | null) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeFormBody(params: URLSearchParams) {
  return {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params.toString(),
  };
}

function buildVmOptionsForm(config: VmConfig): VmOptionsFormState {
  return {
    boot: getConfigStringValue(config.boot),
    onboot: isEnabled(config.onboot),
    agent: isEnabled(readPropertyValue(config.agent, "enabled")),
    protection: isEnabled(config.protection),
    hotplug: getConfigStringValue(config.hotplug),
    tablet: isEnabled(config.tablet ?? 1),
    localtime: isEnabled(config.localtime),
  };
}

function buildVmCloudInitForm(config: VmConfig): VmCloudInitFormState {
  return {
    ciuser: getConfigStringValue(config.ciuser),
    cipassword: "",
    nameserver: getConfigStringValue(config.nameserver),
    searchdomain: getConfigStringValue(config.searchdomain),
    sshkeys: decodeUrlValue(getConfigStringValue(config.sshkeys)),
    ipconfig0: getConfigStringValue(config.ipconfig0),
    citype: getConfigStringValue(config.citype) || (/^w/.test(getConfigStringValue(config.ostype)) ? "configdrive2" : "nocloud"),
  };
}

function buildVmFirewallRuleForm(rule: VmFirewallRule): VmFirewallRuleFormState {
  return {
    type: rule.type ?? "in",
    action: rule.action ?? "ACCEPT",
    proto: rule.proto ?? "",
    source: rule.source ?? "",
    dest: rule.dest ?? "",
    dport: rule.dport ?? "",
    comment: rule.comment ?? "",
    enable: isEnabled(rule.enable),
  };
}

function buildVmFirewallOptionsForm(options: VmFirewallOptions): VmFirewallOptionsFormState {
  return {
    enable: isEnabled(options.enable),
    dhcp: isEnabled(options.dhcp),
    macfilter: isEnabled(options.macfilter ?? 1),
    policyIn: options.policy_in ?? "DROP",
    policyOut: options.policy_out ?? "ACCEPT",
  };
}

function storageSupportsContent(storage: StorageSummary, contentType: string): boolean {
  return isStorageActive(storage) && (storage.content ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .includes(contentType);
}

function getDiskOptions(config: VmConfig): ReadonlyArray<SelectProps.Option> {
  return Object.entries(config)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .filter(([key, value]) => /^(ide|sata|scsi|virtio)\d+$/i.test(key) && typeof value === "string" && !value.includes("media=cdrom"))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
    .map(([key, value]) => ({
      label: `${key} (${value})`,
      value: key,
    }));
}

function getHardwareItems(config: VmConfig, t: (key: string) => string) {
  return Object.entries(config)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .filter(([key]) => key !== "digest")
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
    .map(([key, value]) => ({
      label: labelForConfigKey(key),
      value: formatConfigValue(key, value as VmConfigValue, t),
    }));
}

async function fetchProxmox<T>(path: string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function VirtualMachineDetailPage(props: { params: Promise<{ vmid: string }> }) {
  const { vmid } = use(props.params);
  return <VmDetails key={vmid} vmid={vmid} />;
}

function VmDetails({ vmid }: { vmid: string }) {
  const router = useRouter();
  const { confirmPowerActions } = useSettings();
  const [pendingPowerAction, setPendingPowerAction] = useState<GuestPowerAction | null>(null);
  const { t } = useTranslation();
  const [activeTabId, setActiveTabId] = useState("summary");
  const [data, setData] = useState<VmDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<GuestPowerAction | null>(null);
  const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [resizeModalVisible, setResizeModalVisible] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [resizingDisk, setResizingDisk] = useState(false);
  const [createSnapshotModalVisible, setCreateSnapshotModalVisible] = useState(false);
  const [deleteSnapshotModalVisible, setDeleteSnapshotModalVisible] = useState(false);
  const [rollbackSnapshotModalVisible, setRollbackSnapshotModalVisible] = useState(false);
  const [migrateModalVisible, setMigrateModalVisible] = useState(false);
  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [editCores, setEditCores] = useState("");
  const [editSockets, setEditSockets] = useState("");
  const [editMemory, setEditMemory] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [selectedDisk, setSelectedDisk] = useState<SelectProps.Option | null>(null);
  const [diskSizeGb, setDiskSizeGb] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotDescription, setSnapshotDescription] = useState("");
  const [snapshotVmState, setSnapshotVmState] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<VmSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [migrateTargetNode, setMigrateTargetNode] = useState<SelectProps.Option | null>(null);
  const [migrateOnline, setMigrateOnline] = useState(false);
  const [migrateWithLocalDisks, setMigrateWithLocalDisks] = useState(true);
  const [cloneNewId, setCloneNewId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloneTargetNode, setCloneTargetNode] = useState<SelectProps.Option | null>(null);
  const [cloneTargetStorage, setCloneTargetStorage] = useState<SelectProps.Option | null>(null);
  const [cloneFullClone, setCloneFullClone] = useState<SelectProps.Option | null>({
    label: t("vms.fullClone"),
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
  const [cloudInitModalVisible, setCloudInitModalVisible] = useState(false);
  const [optionsForm, setOptionsForm] = useState<VmOptionsFormState>(() => buildVmOptionsForm({}));
  const [cloudInitForm, setCloudInitForm] = useState<VmCloudInitFormState>(() => buildVmCloudInitForm({}));
  const [optionsSaving, setOptionsSaving] = useState(false);
  const [cloudInitSaving, setCloudInitSaving] = useState(false);
  const [optionsFormError, setOptionsFormError] = useState<string | null>(null);
  const [cloudInitFormError, setCloudInitFormError] = useState<string | null>(null);
  const [firewallRules, setFirewallRules] = useState<VmFirewallRule[]>([]);
  const [firewallOptions, setFirewallOptions] = useState<VmFirewallOptions | null>(null);
  const [firewallRulesLoading, setFirewallRulesLoading] = useState(false);
  const [firewallOptionsLoading, setFirewallOptionsLoading] = useState(false);
  const [firewallRulesError, setFirewallRulesError] = useState<string | null>(null);
  const [firewallOptionsError, setFirewallOptionsError] = useState<string | null>(null);
  const [firewallLoaded, setFirewallLoaded] = useState(false);
  const [firewallSubmitting, setFirewallSubmitting] = useState(false);
  const [firewallActionError, setFirewallActionError] = useState<string | null>(null);
  const [firewallRuleEditorVisible, setFirewallRuleEditorVisible] = useState(false);
  const [firewallDeleteRuleVisible, setFirewallDeleteRuleVisible] = useState(false);
  const [firewallOptionsModalVisible, setFirewallOptionsModalVisible] = useState(false);
  const [editingFirewallRule, setEditingFirewallRule] = useState<VmFirewallRule | null>(null);
  const [firewallRuleForm, setFirewallRuleForm] = useState<VmFirewallRuleFormState>(EMPTY_VM_FIREWALL_RULE_FORM);
  const [firewallRuleModalMode, setFirewallRuleModalMode] = useState<"create" | "edit">("create");
  const [firewallOptionsForm, setFirewallOptionsForm] = useState<VmFirewallOptionsFormState>(EMPTY_VM_FIREWALL_OPTIONS_FORM);
  const [backups, setBackups] = useState<VmBackupItem[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsError, setBackupsError] = useState<string | null>(null);
  const [backupsLoaded, setBackupsLoaded] = useState(false);
  const [deleteBackupVisible, setDeleteBackupVisible] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<VmBackupItem | null>(null);
  const [backupDeleting, setBackupDeleting] = useState(false);
  const [backupActionError, setBackupActionError] = useState<string | null>(null);

  const numericVmid = Number(vmid);

  const addFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashbarItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 5));
  }, []);

  const detailRequest = useRef<AbortController | null>(null);
  const loadedNode = useRef<string | null>(null);

  const loadVm = useCallback(async () => {
    if (!isValidVmid(vmid)) {
      setLoadError(t("vms.invalidVmid"));
      setLoading(false);
      return;
    }

    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    try {
      setLoading(true);
      setActionError(null);
      const resources = await fetchProxmox<ClusterVmResource[]>("/api/proxmox/cluster/resources?type=vm", { signal: controller.signal });
      const resource = (resources ?? []).find((item) => item.type === "qemu" && item.vmid === numericVmid && item.node);

      if (!resource?.node) {
        throw new Error(t("vms.failedToLoadDetails"));
      }

      const [status, rrd, config, snapshots, tasks] = await Promise.all([
        fetchProxmox<VmStatus>(`/api/proxmox/nodes/${resource.node}/qemu/${numericVmid}/status/current`, { signal: controller.signal }),
        fetchProxmox<VmRrdPoint[]>(`/api/proxmox/nodes/${resource.node}/qemu/${numericVmid}/rrddata?timeframe=hour&cf=AVERAGE`, { signal: controller.signal }),
        fetchProxmox<VmConfig>(`/api/proxmox/nodes/${resource.node}/qemu/${numericVmid}/config`, { signal: controller.signal }),
        fetchProxmox<VmSnapshot[]>(`/api/proxmox/nodes/${resource.node}/qemu/${numericVmid}/snapshot`, { signal: controller.signal }),
        fetchProxmox<VmTask[]>(`/api/proxmox/nodes/${resource.node}/tasks?vmid=${numericVmid}&limit=20`, { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) return;
      if (loadedNode.current !== resource.node) {
        setFirewallLoaded(false);
        setFirewallRules([]);
        setFirewallOptions(null);
        setFirewallRulesError(null);
        setFirewallOptionsError(null);
        setBackupsLoaded(false);
        setBackups([]);
        setBackupsError(null);
        setFirewallRulesLoading(false);
        setFirewallOptionsLoading(false);
        setBackupsLoading(false);
        loadedNode.current = resource.node;
      }
      setData({
        node: resource.node,
        status: {
          ...status,
          name: status.name ?? resource.name,
        },
        rrd: rrd ?? [],
        config: config ?? {},
        snapshots: snapshots ?? [],
        tasks: tasks ?? [],
      });
      setLoadError(null);
    } catch (fetchError) {
      if (controller.signal.aborted) return;
      setLoadError(fetchError instanceof Error ? fetchError.message : t("vms.failedToLoadDetails"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [numericVmid, t, vmid]);

  useResourceTaskRefresh(loadVm);

  useEffect(() => {
    // Start an external request; loading state belongs to its asynchronous lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVm();
    return () => detailRequest.current?.abort();
  }, [loadVm]);

  const selectedStatus = data?.status.status;
  const canStart = selectedStatus === "stopped" && !isEnabled(data?.config.template) && !actionLoading;
  const canStop = selectedStatus === "running" && !actionLoading;
  const canReboot = selectedStatus === "running" && !actionLoading;
  const canOpenConsole = selectedStatus === "running" && !actionLoading;
  const cloneModeOptions = useMemo<ReadonlyArray<SelectProps.Option>>(
    () => [
      { label: t("vms.fullClone"), value: "full" },
      { label: t("vms.linkedClone"), value: "linked" },
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
        .filter((node) => !excludeCurrentNode || node.node !== data.node)
        .map((node) => ({ label: node.node, value: node.node }))
        .sort((left, right) => String(left.label).localeCompare(String(right.label)));
    },
    [data],
  );

  const loadCloneStorages = useCallback(async (node: string) => {
    const storages = await fetchProxmox<StorageSummary[]>(`/api/proxmox/nodes/${node}/storage`);
    return (storages ?? [])
      .filter((storage) => storageSupportsContent(storage, "images"))
      .map((storage) => ({ label: storage.storage, value: storage.storage }))
      .sort((left, right) => String(left.label).localeCompare(String(right.label)));
  }, []);

  const runPowerAction = useCallback(async (action: GuestPowerAction) => {
    if (!data) return;
    try {
      setActionLoading(action);
      setActionError(null);
      await fetchProxmox(`/api/proxmox/nodes/${encodeURIComponent(data.node)}/qemu/${numericVmid}/status/${action}`, { method: "POST" });
      await loadVm();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setActionLoading(null);
      setPendingPowerAction(null);
    }
  }, [data, loadVm, numericVmid, t]);

  const requestPowerAction = (action: GuestPowerAction) => {
    if (!confirmPowerActions && action !== "stop") void runPowerAction(action);
    else setPendingPowerAction(action);
  };

  const openEditModal = useCallback(() => {
    if (!data) {
      return;
    }

    setEditCores(getConfigStringValue(data.config.cores));
    setEditSockets(getConfigStringValue(data.config.sockets));
    setEditMemory(readPropertyValue(data.config.memory, "current"));
    setEditDescription(getConfigStringValue(data.config.description));
    setConfigError(null);
    setEditModalVisible(true);
  }, [data]);

  const openResizeModal = useCallback(() => {
    if (!data) {
      return;
    }

    const diskOptions = getDiskOptions(data.config);
    setSelectedDisk(diskOptions[0] ?? null);
    setDiskSizeGb("");
    setConfigError(null);
    setResizeModalVisible(true);
  }, [data]);

  const saveConfiguration = useCallback(async () => {
    if (!data) {
      return;
    }

    const cores = Number(editCores);
    const sockets = Number(editSockets);
    const memory = Number(editMemory);

    if (!isIntegerInRange(editCores, 1) || !isIntegerInRange(editSockets, 1) || !isIntegerInRange(editMemory, 16)) {
      setConfigError(t("vms.coresSocketsMemoryError"));
      return;
    }

    try {
      setSavingConfig(true);
      setConfigError(null);

      const body = new URLSearchParams({
        cores: String(cores),
        sockets: String(sockets),
        memory: getConfigStringValue(data.config.memory).includes("=") ? updatePropertyValue(data.config.memory, "current", String(memory)) : String(memory),
        description: editDescription,
      });

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("vms.configUpdated").replace("{id}", String(numericVmid)),
          dismissible: true,
          id: "vm-config-updated",
        },
      ]);
      setEditModalVisible(false);
      await loadVm();
    } catch (saveError) {
      setConfigError(saveError instanceof Error ? saveError.message : t("vms.failedToUpdateConfig"));
    } finally {
      setSavingConfig(false);
    }
  }, [data, editCores, editDescription, editMemory, editSockets, loadVm, numericVmid, t]);

  const resizeVmDisk = useCallback(async () => {
    if (!data) {
      return;
    }

    const size = Number(diskSizeGb);
    const disk = selectedDisk?.value ?? "";

    if (!disk) {
      setConfigError(t("vms.selectDiskError"));
      return;
    }

    if (!Number.isFinite(size) || size <= 0) {
      setConfigError(t("vms.diskSizeError"));
      return;
    }

    try {
      setResizingDisk(true);
      setConfigError(null);

      const body = new URLSearchParams({
        disk,
        size: `${size}G`,
      });

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/resize`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("vms.diskResizeRequested").replace("{disk}", disk).replace("{id}", String(numericVmid)),
          dismissible: true,
          id: "vm-disk-resize-success",
        },
      ]);
      setResizeModalVisible(false);
      await loadVm();
    } catch (resizeError) {
      setConfigError(resizeError instanceof Error ? resizeError.message : t("vms.failedToResizeDisk"));
    } finally {
      setResizingDisk(false);
    }
  }, [data, diskSizeGb, loadVm, numericVmid, selectedDisk, t]);

  const openCreateSnapshotModal = useCallback(() => {
    setSnapshotName("");
    setSnapshotDescription("");
    setSnapshotVmState(false);
    setSnapshotError(null);
    setCreateSnapshotModalVisible(true);
  }, []);

  const openDeleteSnapshotModal = useCallback((snapshot: VmSnapshot) => {
    setSelectedSnapshot(snapshot);
    setSnapshotError(null);
    setDeleteSnapshotModalVisible(true);
  }, []);

  const openRollbackSnapshotModal = useCallback((snapshot: VmSnapshot) => {
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
      setMigrateOnline(data.status.status === "running");
      setMigrateWithLocalDisks(true);
      setMigrateModalVisible(true);
    } catch (loadError) {
      setMigrateError(loadError instanceof Error ? loadError.message : t("vms.failedToMigrate"));
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
      const defaultNode = nodes.find((node) => node.value === data.node) ?? nodes[0] ?? null;
      setAvailableNodes(nodes);
      setCloneNewId(normalizedNextId ? String(normalizedNextId) : "");
      setCloneName("");
      setCloneTargetNode(defaultNode);
      setCloneTargetStorage(null);
      setAvailableStorages([]);
      setCloneFullClone({ label: t("vms.fullClone"), value: "full" });
      setCloneDescription("");
      setCloneModalVisible(true);
    } catch (loadError) {
      setCloneError(loadError instanceof Error ? loadError.message : t("vms.failedToClone"));
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
      setSnapshotError(t("vms.snapshotNameRequired"));
      return;
    }

    try {
      setSnapshotLoading(true);
      setSnapshotError(null);

      const name = snapshotName.trim();
      const body = new URLSearchParams({
        snapname: name,
        description: snapshotDescription,
        vmstate: snapshotVmState ? "1" : "0",
      });

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/snapshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("vms.snapshotCreated").replace("{name}", name),
          dismissible: true,
          id: "vm-snapshot-created",
        },
      ]);
      setCreateSnapshotModalVisible(false);
      setSnapshotName("");
      setSnapshotDescription("");
      setSnapshotVmState(false);
      await loadVm();
    } catch (createError) {
      setSnapshotError(createError instanceof Error ? createError.message : t("vms.failedToCreateSnapshot"));
    } finally {
      setSnapshotLoading(false);
    }
  }, [data, loadVm, numericVmid, snapshotDescription, snapshotName, snapshotVmState, t]);

  const deleteSnapshot = useCallback(async () => {
    if (!data || !selectedSnapshot) {
      return;
    }

    try {
      setSnapshotLoading(true);
      setSnapshotError(null);

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/snapshot/${encodeURIComponent(selectedSnapshot.name)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("vms.snapshotDeleted").replace("{name}", selectedSnapshot.name),
          dismissible: true,
          id: "vm-snapshot-deleted",
        },
      ]);
      setDeleteSnapshotModalVisible(false);
      setSelectedSnapshot(null);
      await loadVm();
    } catch (deleteError) {
      setSnapshotError(deleteError instanceof Error ? deleteError.message : t("vms.failedToDeleteSnapshot"));
    } finally {
      setSnapshotLoading(false);
    }
  }, [data, loadVm, numericVmid, selectedSnapshot, t]);

  const rollbackSnapshot = useCallback(async () => {
    if (!data || !selectedSnapshot) {
      return;
    }

    try {
      setSnapshotLoading(true);
      setSnapshotError(null);

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/snapshot/${encodeURIComponent(selectedSnapshot.name)}/rollback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("vms.snapshotRolledBack").replace("{name}", selectedSnapshot.name),
          dismissible: true,
          id: "vm-snapshot-rolled-back",
        },
      ]);
      setRollbackSnapshotModalVisible(false);
      setSelectedSnapshot(null);
      await loadVm();
    } catch (rollbackError) {
      setSnapshotError(rollbackError instanceof Error ? rollbackError.message : t("vms.failedToRollbackSnapshot"));
    } finally {
      setSnapshotLoading(false);
    }
  }, [data, loadVm, numericVmid, selectedSnapshot, t]);

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
          setCloneError(loadError instanceof Error ? loadError.message : t("vms.failedToClone"));
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

  const submitMigration = useCallback(async () => {
    if (!data) {
      return;
    }

    const targetNode = optionValue(migrateTargetNode);

    if (!targetNode) {
      setMigrateError(t("vms.targetNodeRequired"));
      return;
    }

    try {
      setMigrateLoading(true);
      setMigrateError(null);

      const body = new URLSearchParams({
        target: targetNode,
        online: migrateOnline ? "1" : "0",
        "with-local-disks": migrateWithLocalDisks ? "1" : "0",
      });

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/migrate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("vms.migrationStarted").replace("{id}", String(numericVmid)).replace("{node}", targetNode),
          dismissible: true,
          id: "vm-migration-started",
        },
      ]);
      setMigrateModalVisible(false);
      await loadVm();
    } catch (submitError) {
      setMigrateError(submitError instanceof Error ? submitError.message : t("vms.failedToMigrate"));
    } finally {
      setMigrateLoading(false);
    }
  }, [data, loadVm, migrateOnline, migrateTargetNode, migrateWithLocalDisks, numericVmid, t]);

  const submitClone = useCallback(async () => {
    if (!data) {
      return;
    }

    const newId = cloneNewId.trim();
    const targetNode = optionValue(cloneTargetNode);
    const targetStorage = optionValue(cloneTargetStorage);
    const fullClone = optionValue(cloneFullClone) !== "linked";

    if (!isValidVmid(newId)) {
      setCloneError(t("vms.newIdRequired"));
      return;
    }

    if (!targetNode) {
      setCloneError(t("vms.targetNodeRequired"));
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
        body.set("name", cloneName.trim());
      }

      if (targetStorage) {
        body.set("storage", targetStorage);
      }

      if (cloneDescription.trim()) {
        body.set("description", cloneDescription.trim());
      }

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/clone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("vms.cloneStarted").replace("{id}", String(numericVmid)).replace("{newId}", newId),
          dismissible: true,
          id: "vm-clone-started",
        },
      ]);
      setCloneModalVisible(false);
      await loadVm();
    } catch (submitError) {
      setCloneError(submitError instanceof Error ? submitError.message : t("vms.failedToClone"));
    } finally {
      setCloneLoading(false);
    }
  }, [cloneDescription, cloneFullClone, cloneName, cloneNewId, cloneTargetNode, cloneTargetStorage, data, loadVm, numericVmid, t]);

  const firewallTypeOptions = useMemo<ReadonlyArray<SelectProps.Option>>(
    () => [
      { label: t("firewall.typeIn"), value: "in" },
      { label: t("firewall.typeOut"), value: "out" },
      { label: t("firewall.typeGroup"), value: "group" },
    ],
    [t],
  );

  const firewallActionOptions = useMemo<ReadonlyArray<SelectProps.Option>>(
    () => [
      { label: t("firewall.actionAccept"), value: "ACCEPT" },
      { label: t("firewall.actionDrop"), value: "DROP" },
      { label: t("firewall.actionReject"), value: "REJECT" },
    ],
    [t],
  );

  const firewallProtocolOptions = useMemo<ReadonlyArray<SelectProps.Option>>(
    () => [
      { label: t("firewall.anyProtocol"), value: "" },
      { label: "TCP", value: "tcp" },
      { label: "UDP", value: "udp" },
      { label: "ICMP", value: "icmp" },
      { label: "ICMPv6", value: "icmpv6" },
      { label: "ESP", value: "esp" },
      { label: "GRE", value: "gre" },
    ],
    [t],
  );

  const cloudInitTypeOptions = useMemo<ReadonlyArray<SelectProps.Option>>(
    () => [
      { label: "NoCloud", value: "nocloud" },
      { label: "ConfigDrive2", value: "configdrive2" },
    ],
    [],
  );

  const firewallTypeLabel = useCallback((value?: string) => {
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
  }, [t]);

  const firewallActionLabel = useCallback((value?: string) => {
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
  }, [t]);

  const loadFirewallRules = useCallback(async () => {
    if (!data) {
      return;
    }

    const requestNode = data.node;
    try {
      setFirewallRulesLoading(true);
      const nextRules = await fetchProxmox<VmFirewallRule[]>(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/firewall/rules`);
      if (loadedNode.current !== requestNode) return;
      setFirewallRules((nextRules ?? []).slice().sort((left, right) => left.pos - right.pos));
      setFirewallRulesError(null);
    } catch (loadError) {
      if (loadedNode.current !== requestNode) return;
      setFirewallRulesError(loadError instanceof Error ? loadError.message : t("vms.failedToLoadFirewallRules"));
    } finally {
      if (loadedNode.current === requestNode) setFirewallRulesLoading(false);
    }
  }, [data, numericVmid, t]);

  const loadFirewallOptions = useCallback(async () => {
    if (!data) {
      return;
    }

    const requestNode = data.node;
    try {
      setFirewallOptionsLoading(true);
      const nextOptions = await fetchProxmox<VmFirewallOptions>(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/firewall/options`);
      if (loadedNode.current !== requestNode) return;
      setFirewallOptions(nextOptions ?? {});
      setFirewallOptionsError(null);
    } catch (loadError) {
      if (loadedNode.current !== requestNode) return;
      setFirewallOptionsError(loadError instanceof Error ? loadError.message : t("vms.failedToLoadFirewallOptions"));
    } finally {
      if (loadedNode.current === requestNode) setFirewallOptionsLoading(false);
    }
  }, [data, numericVmid, t]);

  const loadFirewallData = useCallback(async () => {
    setFirewallLoaded(true);
    await Promise.all([loadFirewallRules(), loadFirewallOptions()]);
  }, [loadFirewallOptions, loadFirewallRules]);

  const loadBackups = useCallback(async () => {
    if (!data) {
      return;
    }

    const requestNode = data.node;
    try {
      setBackupsLoaded(true);
      setBackupsLoading(true);
      const storages = await fetchProxmox<StorageSummary[]>(`/api/proxmox/nodes/${data.node}/storage`);
      const backupStorages = (storages ?? []).filter((storage) => storageSupportsContent(storage, "backup"));

      const backupResults = await Promise.all(
        backupStorages.map(async (storage) => {
          const items = await fetchProxmox<Array<Omit<VmBackupItem, "storage">>>(
            `/api/proxmox/nodes/${data.node}/storage/${encodeURIComponent(storage.storage)}/content?content=backup&vmid=${numericVmid}`,
          );

          return (items ?? []).map((item) => ({ ...item, storage: storage.storage }));
        }),
      );

      if (loadedNode.current !== requestNode) return;
      setBackups(
        backupResults
          .flat()
          .sort((left, right) => (right.ctime ?? 0) - (left.ctime ?? 0)),
      );
      setBackupsError(null);
    } catch (loadError) {
      if (loadedNode.current !== requestNode) return;
      setBackupsError(loadError instanceof Error ? loadError.message : t("vms.failedToLoadBackups"));
    } finally {
      if (loadedNode.current === requestNode) setBackupsLoading(false);
    }
  }, [data, numericVmid, t]);


  useEffect(() => {
    if (activeTabId === "firewall" && data && !firewallLoaded && !firewallRulesLoading && !firewallOptionsLoading) {
      // Start the selected tab’s external request; loaded/loading flags prevent repeat calls.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadFirewallData();
    }

    if (activeTabId === "backup" && data && !backupsLoaded && !backupsLoading) {
      void loadBackups();
    }
  }, [activeTabId, backupsLoaded, backupsLoading, data, firewallLoaded, firewallOptionsLoading, firewallRulesLoading, loadBackups, loadFirewallData]);

  const openOptionsModal = useCallback(() => {
    if (!data) {
      return;
    }

    setOptionsForm(buildVmOptionsForm(data.config));
    setOptionsFormError(null);
    setOptionsModalVisible(true);
  }, [data]);

  const openCloudInitModal = useCallback(() => {
    if (!data) {
      return;
    }

    setCloudInitForm(buildVmCloudInitForm(data.config));
    setCloudInitFormError(null);
    setCloudInitModalVisible(true);
  }, [data]);

  const saveOptions = useCallback(async () => {
    if (!data) {
      return;
    }

    try {
      setOptionsSaving(true);
      setOptionsFormError(null);

      const params = new URLSearchParams();
      setOptionalParameters(params, { boot: optionsForm.boot, hotplug: optionsForm.hotplug }, true);
      params.set("onboot", optionsForm.onboot ? "1" : "0");
      params.set("agent", updatePropertyValue(data.config.agent, "enabled", optionsForm.agent ? "1" : "0"));
      params.set("protection", optionsForm.protection ? "1" : "0");
      params.set("tablet", optionsForm.tablet ? "1" : "0");
      params.set("localtime", optionsForm.localtime ? "1" : "0");

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/config`, {
        method: "PUT",
        ...encodeFormBody(params),
      });

      setOptionsModalVisible(false);
      addFlash({ id: `vm-options-${Date.now()}`, type: "success", content: t("vms.optionsUpdated"), dismissible: true });
      await loadVm();
    } catch (saveError) {
      setOptionsFormError(saveError instanceof Error ? saveError.message : t("vms.failedToUpdateOptions"));
    } finally {
      setOptionsSaving(false);
    }
  }, [addFlash, data, loadVm, numericVmid, optionsForm, t]);

  const saveCloudInit = useCallback(async () => {
    if (!data) {
      return;
    }

    try {
      setCloudInitSaving(true);
      setCloudInitFormError(null);

      const params = new URLSearchParams();
      setOptionalParameters(params, {
        ciuser: cloudInitForm.ciuser,
        nameserver: cloudInitForm.nameserver,
        searchdomain: cloudInitForm.searchdomain,
        sshkeys: cloudInitForm.sshkeys.trim() ? encodeURIComponent(cloudInitForm.sshkeys.trim()) : "",
        ipconfig0: cloudInitForm.ipconfig0,
      }, true);
      params.set("citype", cloudInitForm.citype || "nocloud");
      if (cloudInitForm.cipassword.trim()) {
        params.set("cipassword", cloudInitForm.cipassword);
      }

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/config`, {
        method: "PUT",
        ...encodeFormBody(params),
      });

      setCloudInitModalVisible(false);
      addFlash({ id: `vm-cloudinit-${Date.now()}`, type: "success", content: t("vms.cloudInitUpdated"), dismissible: true });
      await loadVm();
    } catch (saveError) {
      setCloudInitFormError(saveError instanceof Error ? saveError.message : t("vms.failedToUpdateCloudInit"));
    } finally {
      setCloudInitSaving(false);
    }
  }, [addFlash, cloudInitForm, data, loadVm, numericVmid, t]);

  const openCreateFirewallRuleModal = useCallback(() => {
    setFirewallRuleModalMode("create");
    setEditingFirewallRule(null);
    setFirewallRuleForm(EMPTY_VM_FIREWALL_RULE_FORM);
    setFirewallActionError(null);
    setFirewallRuleEditorVisible(true);
  }, []);

  const openEditFirewallRuleModal = useCallback((rule: VmFirewallRule) => {
    setFirewallRuleModalMode("edit");
    setEditingFirewallRule(rule);
    setFirewallRuleForm(buildVmFirewallRuleForm(rule));
    setFirewallActionError(null);
    setFirewallRuleEditorVisible(true);
  }, []);

  const openDeleteFirewallRuleModal = useCallback((rule: VmFirewallRule) => {
    setEditingFirewallRule(rule);
    setFirewallActionError(null);
    setFirewallDeleteRuleVisible(true);
  }, []);

  const openFirewallOptionsModal = useCallback(() => {
    setFirewallOptionsForm(firewallOptions ? buildVmFirewallOptionsForm(firewallOptions) : EMPTY_VM_FIREWALL_OPTIONS_FORM);
    setFirewallActionError(null);
    setFirewallOptionsModalVisible(true);
  }, [firewallOptions]);

  const submitFirewallRule = useCallback(async () => {
    if (!data) {
      return;
    }

    if (firewallRuleModalMode === "edit" && !editingFirewallRule) {
      return;
    }

    try {
      setFirewallSubmitting(true);
      setFirewallActionError(null);

      const params = new URLSearchParams();
      params.set("type", firewallRuleForm.type || "in");
      params.set("action", firewallRuleForm.action || "ACCEPT");
      params.set("enable", firewallRuleForm.enable ? "1" : "0");
      setOptionalParameters(params, { proto: firewallRuleForm.proto, source: firewallRuleForm.source, dest: firewallRuleForm.dest, dport: firewallRuleForm.dport, comment: firewallRuleForm.comment }, firewallRuleModalMode === "edit");

      const path = firewallRuleModalMode === "create"
        ? `/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/firewall/rules`
        : `/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/firewall/rules/${editingFirewallRule?.pos ?? 0}`;

      await fetchProxmox(path, {
        method: firewallRuleModalMode === "create" ? "POST" : "PUT",
        ...encodeFormBody(params),
      });

      setFirewallRuleEditorVisible(false);
      addFlash({
        id: `vm-firewall-rule-${firewallRuleModalMode}-${Date.now()}`,
        type: "success",
        content: firewallRuleModalMode === "create" ? t("vms.firewallRuleCreated") : t("vms.firewallRuleUpdated"),
        dismissible: true,
      });
      await loadFirewallRules();
    } catch (submitError) {
      setFirewallActionError(
        submitError instanceof Error
          ? submitError.message
          : firewallRuleModalMode === "create"
            ? t("vms.failedToCreateFirewallRule")
            : t("vms.failedToUpdateFirewallRule"),
      );
    } finally {
      setFirewallSubmitting(false);
    }
  }, [addFlash, data, editingFirewallRule, firewallRuleForm, firewallRuleModalMode, loadFirewallRules, numericVmid, t]);

  const deleteFirewallRule = useCallback(async () => {
    if (!data || !editingFirewallRule) {
      return;
    }

    try {
      setFirewallSubmitting(true);
      setFirewallActionError(null);
      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/firewall/rules/${editingFirewallRule.pos}`, {
        method: "DELETE",
        ...encodeFormBody(new URLSearchParams()),
      });
      setFirewallDeleteRuleVisible(false);
      addFlash({ id: `vm-firewall-delete-${Date.now()}`, type: "success", content: t("vms.firewallRuleDeleted"), dismissible: true });
      await loadFirewallRules();
    } catch (deleteError) {
      setFirewallActionError(deleteError instanceof Error ? deleteError.message : t("vms.failedToDeleteFirewallRule"));
    } finally {
      setFirewallSubmitting(false);
    }
  }, [addFlash, data, editingFirewallRule, loadFirewallRules, numericVmid, t]);

  const submitFirewallOptions = useCallback(async () => {
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

      await fetchProxmox(`/api/proxmox/nodes/${data.node}/qemu/${numericVmid}/firewall/options`, {
        method: "PUT",
        ...encodeFormBody(params),
      });

      setFirewallOptionsModalVisible(false);
      addFlash({ id: `vm-firewall-options-${Date.now()}`, type: "success", content: t("vms.firewallOptionsUpdated"), dismissible: true });
      await loadFirewallOptions();
    } catch (submitError) {
      setFirewallActionError(submitError instanceof Error ? submitError.message : t("vms.failedToUpdateFirewallOptions"));
    } finally {
      setFirewallSubmitting(false);
    }
  }, [addFlash, data, firewallOptionsForm, loadFirewallOptions, numericVmid, t]);

  const openDeleteBackupModal = useCallback((backup: VmBackupItem) => {
    setSelectedBackup(backup);
    setBackupActionError(null);
    setDeleteBackupVisible(true);
  }, []);

  const deleteBackup = useCallback(async () => {
    if (!data || !selectedBackup) {
      return;
    }

    try {
      setBackupDeleting(true);
      setBackupActionError(null);
      await fetchProxmox(`/api/proxmox/nodes/${data.node}/storage/${encodeURIComponent(selectedBackup.storage)}/content/${encodeURIComponent(selectedBackup.volid)}`, {
        method: "DELETE",
        ...encodeFormBody(new URLSearchParams()),
      });
      setDeleteBackupVisible(false);
      addFlash({ id: `vm-backup-delete-${Date.now()}`, type: "success", content: t("vms.backupDeleted"), dismissible: true });
      await loadBackups();
    } catch (deleteError) {
      setBackupActionError(deleteError instanceof Error ? deleteError.message : t("vms.failedToDeleteBackup"));
    } finally {
      setBackupDeleting(false);
    }
  }, [addFlash, data, loadBackups, selectedBackup, t]);

  const snapshotsColumns = useMemo<TableProps<VmSnapshot>["columnDefinitions"]>(
    () => [
      {
        id: "name",
        header: t("common.name"),
        cell: ({ name }) => name,
        isRowHeader: true,
      },
      {
        id: "description",
        header: t("vms.description"),
        cell: ({ description }) => description || "-",
      },
      {
        id: "date",
        header: t("vms.date"),
        cell: ({ snaptime }) => formatDateTime(snaptime),
      },
      {
        id: "vmstate",
        header: t("vms.vmState"),
        cell: ({ vmstate }) => (vmstate ? t("vms.included") : t("vms.noState")),
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (snapshot) => snapshot.name === "current" ? "-" : (
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="inline-link" onClick={() => openRollbackSnapshotModal(snapshot)}>
              {t("vms.rollback")}
            </Button>
            <Button variant="inline-link" onClick={() => openDeleteSnapshotModal(snapshot)}>
              {t("vms.deleteSnapshot")}
            </Button>
          </SpaceBetween>
        ),
      },
    ],
    [openDeleteSnapshotModal, openRollbackSnapshotModal, t],
  );

  const tasksColumns = useMemo<TableProps<VmTask>["columnDefinitions"]>(
    () => [
      {
        id: "starttime",
        header: t("vms.startTime"),
        cell: ({ starttime }) => formatDateTime(starttime),
        isRowHeader: true,
      },
      {
        id: "type",
        header: t("logs.type"),
        cell: ({ type }) => type,
      },
      {
        id: "status",
        header: t("common.status"),
        cell: ({ status }) => status ?? t("common.running"),
      },
      {
        id: "user",
        header: t("logs.user"),
        cell: ({ user }) => user,
      },
    ],
    [t],
  );

  const firewallRuleColumns = useMemo<TableProps<VmFirewallRule>["columnDefinitions"]>(
    () => [
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
        cell: (rule) => (
          <StatusIndicator type={isEnabled(rule.enable) ? "success" : "stopped"}>
            {isEnabled(rule.enable) ? t("firewall.enabled") : t("firewall.disabled")}
          </StatusIndicator>
        ),
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (rule) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="inline-link" onClick={() => openEditFirewallRuleModal(rule)}>
              {t("vms.editFirewallRule")}
            </Button>
            <Button variant="inline-link" onClick={() => openDeleteFirewallRuleModal(rule)}>
              {t("vms.deleteFirewallRule")}
            </Button>
          </SpaceBetween>
        ),
      },
    ],
    [firewallActionLabel, firewallTypeLabel, openDeleteFirewallRuleModal, openEditFirewallRuleModal, t],
  );

  const backupColumns = useMemo<TableProps<VmBackupItem>["columnDefinitions"]>(
    () => [
      { id: "volid", header: t("vms.backupVolid"), cell: ({ volid }) => volid, isRowHeader: true },
      { id: "date", header: t("vms.backupDate"), cell: ({ ctime }) => formatDateTime(ctime) },
      { id: "size", header: t("vms.backupSize"), cell: ({ size }) => (typeof size === "number" ? formatBytes(size) : "-") },
      { id: "notes", header: t("vms.backupNotes"), cell: ({ notes }) => getTextValue(notes, t("cluster.common.none")) },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (backup) => (
          <Button variant="inline-link" onClick={() => openDeleteBackupModal(backup)}>
            {t("vms.deleteBackup")}
          </Button>
        ),
      },
    ],
    [openDeleteBackupModal, t],
  );

  const optionsItems = useMemo(() => {
    const config = data?.config ?? {};

    return [
      { label: t("vms.bootOrder"), value: getTextValue(getConfigStringValue(config.boot)) },
      { label: t("vms.startOnBoot"), value: isEnabled(config.onboot) ? t("common.yes") : t("common.no") },
      { label: t("vms.qemuAgentLabel"), value: isEnabled(readPropertyValue(config.agent, "enabled")) ? t("common.yes") : t("common.no") },
      { label: t("vms.protection"), value: isEnabled(config.protection) ? t("common.yes") : t("common.no") },
      { label: t("vms.hotplug"), value: getTextValue(getConfigStringValue(config.hotplug)) },
      { label: t("vms.tabletDevice"), value: isEnabled(config.tablet ?? 1) ? t("common.yes") : t("common.no") },
      { label: t("vms.useLocalTime"), value: isEnabled(config.localtime) ? t("common.yes") : t("common.no") },
    ];
  }, [data?.config, t]);

  const cloudInitItems = useMemo(() => {
    const config = data?.config ?? {};
    const sshKeys = decodeUrlValue(getConfigStringValue(config.sshkeys));

    return [
      { label: t("vms.ciUser"), value: getTextValue(getConfigStringValue(config.ciuser)) },
      { label: t("vms.ciPassword"), value: getConfigStringValue(config.cipassword) ? "****" : "-" },
      { label: t("vms.ciDnsServers"), value: getTextValue(getConfigStringValue(config.nameserver)) },
      { label: t("vms.ciSearchDomain"), value: getTextValue(getConfigStringValue(config.searchdomain)) },
      { label: t("vms.ciSshKeys"), value: getTextValue(sshKeys) },
      { label: t("vms.ciIpConfig"), value: getTextValue(getConfigStringValue(config.ipconfig0)) },
      { label: t("vms.ciType"), value: getTextValue(getConfigStringValue(config.citype)) },
    ];
  }, [data?.config, t]);

  const firewallOptionDetails = firewallOptions ? buildVmFirewallOptionsForm(firewallOptions) : EMPTY_VM_FIREWALL_OPTIONS_FORM;

  if (!isValidVmid(String(numericVmid))) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("vms.virtualMachines")}</Header>
        <Alert type="error" header={t("vms.invalidVmid")}>
          {t("vms.vmIdInvalid")}
        </Alert>
      </SpaceBetween>
    );
  }

  if (loading) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("vms.virtualMachines")} {numericVmid}</Header>
        <Box textAlign="center" padding={{ top: "xxxl" }}>
          <Spinner size="large" />
        </Box>
      </SpaceBetween>
    );
  }

  if (loadError || !data) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("vms.virtualMachines")} {numericVmid}</Header>
        <Alert type="error" header={t("vms.failedToLoadDetails")}>
          {loadError ?? t("nodeDetail.unknownError")}
        </Alert>
      </SpaceBetween>
    );
  }

  const summaryItems = [
    { label: t("vms.vmid"), value: String(data.status.vmid) },
    { label: t("vms.name"), value: data.status.name ?? "-" },
    { label: t("vms.node"), value: data.node },
    {
      label: t("common.status"),
      value: (
        <StatusIndicator type={getVmStatusType(data.status.status)}>
          {data.status.status === "running" ? t("common.running") : data.status.status === "stopped" ? t("common.stopped") : data.status.status}
        </StatusIndicator>
      ),
    },
    { label: t("vms.cpu"), value: `${((data.status.cpu ?? 0) * 100).toFixed(1)}%` },
    { label: t("vms.memory"), value: `${formatBytes(data.status.mem ?? 0)} / ${formatBytes(data.status.maxmem ?? 0)}` },
    { label: t("vms.disk"), value: `${formatBytes(data.status.disk ?? 0)} / ${formatBytes(data.status.maxdisk ?? 0)}` },
    { label: t("vms.uptime"), value: formatUptime(data.status.uptime ?? 0) },
  ];

  const hardwareItems = getHardwareItems(data.config, t);
  const diskOptions = getDiskOptions(data.config);
  const cpuSeries = data.rrd.map((point) => ({ x: new Date(point.time * 1000), y: Math.round((point.cpu ?? 0) * 1000) / 10 }));
  const memorySeries = data.rrd.map((point) => ({
    x: new Date(point.time * 1000),
    y: point.memtotal ? Math.round(((point.memused ?? 0) / point.memtotal) * 1000) / 10 : 0,
  }));
  const chartDomain = cpuSeries.length > 1 ? [cpuSeries[0].x, cpuSeries[cpuSeries.length - 1].x] : undefined;

  const tabs: TabsProps.Tab[] = [
    {
      id: "summary",
      label: t("nodes.summary"),
      content: (
        <SpaceBetween size="l">
          <KeyValuePairs columns={4} items={summaryItems} />
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
            ariaLabel={`${t("nodeDetail.cpuAndMemoryUsage")} ${t("vms.virtualMachines")} ${numericVmid}`}
            empty={<Box textAlign="center" color="text-body-secondary">{t("vms.noPerformanceData")}</Box>}
          />
        </SpaceBetween>
      ),
    },
    {
      id: "hardware",
      label: t("vms.hardware"),
      content: (
        <SpaceBetween size="l">
          <Header
            variant="h2"
            actions={
              <SpaceBetween size="xs" direction="horizontal">
                <Button onClick={openEditModal}>{t("common.edit")}</Button>
                <Button onClick={openResizeModal} disabled={diskOptions.length === 0}>
                  {t("vms.resizeDisk")}
                </Button>
              </SpaceBetween>
            }
          >
            {t("vms.hardware")}
          </Header>
          {hardwareItems.length > 0 ? (
            <KeyValuePairs columns={4} items={hardwareItems} />
          ) : (
            <Box textAlign="center" color="text-body-secondary" padding="xxl">{t("vms.noHardwareConfig")}</Box>
          )}
        </SpaceBetween>
      ),
    },
    {
      id: "snapshots",
      label: t("vms.snapshots"),
      content: (
        <Table
          variant="borderless"
          stickyHeader
          resizableColumns
          enableKeyboardNavigation
          trackBy="name"
          items={data.snapshots}
          columnDefinitions={snapshotsColumns}
          empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("vms.noSnapshotsAvailable")}</Box>}
          header={
            <Header
              variant="h2"
              counter={`(${data.snapshots.length})`}
              actions={
                <Button onClick={openCreateSnapshotModal} loading={snapshotLoading} disabled={snapshotLoading}>
                  {t("vms.createSnapshot")}
                </Button>
              }
            >
              {t("vms.snapshots")}
            </Header>
          }
        />
      ),
    },
    {
      id: "tasks",
      label: t("vms.tasks"),
      content: (
        <Table
          variant="borderless"
          stickyHeader
          resizableColumns
          enableKeyboardNavigation
          trackBy="upid"
          items={data.tasks}
          columnDefinitions={tasksColumns}
          empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("vms.noRecentTasks")}</Box>}
          header={<Header variant="h2" counter={`(${data.tasks.length})`}>{t("logs.recentTasks")}</Header>}
        />
      ),
    },
    {
      id: "options",
      label: t("vms.options"),
      content: (
        <SpaceBetween size="l">
          <Header
            variant="h2"
            actions={
              <Button onClick={openOptionsModal}>
                {t("vms.editOptions")}
              </Button>
            }
          >
            {t("vms.options")}
          </Header>
          <KeyValuePairs columns={2} items={optionsItems} />
        </SpaceBetween>
      ),
    },
    {
      id: "cloudinit",
      label: t("vms.cloudinit"),
      content: (
        <SpaceBetween size="l">
          <Header
            variant="h2"
            actions={
              <Button onClick={openCloudInitModal}>
                {t("vms.editCloudInit")}
              </Button>
            }
          >
            {t("vms.cloudinit")}
          </Header>
          <KeyValuePairs columns={2} items={cloudInitItems} />
        </SpaceBetween>
      ),
    },
    {
      id: "firewall",
      label: t("vms.firewallTab"),
      content: (
        <SpaceBetween size="l">
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
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("firewall.noRules")}</Box>}
            header={
              <Header
                variant="h2"
                counter={`(${firewallRules.length})`}
                actions={
                  <SpaceBetween size="xs" direction="horizontal">
                    <Button iconName="refresh" onClick={() => void loadFirewallRules()}>
                      {t("common.refresh")}
                    </Button>
                    <Button variant="primary" onClick={openCreateFirewallRuleModal}>
                      {t("vms.addFirewallRule")}
                    </Button>
                  </SpaceBetween>
                }
              >
                {t("vms.vmFirewallRules")}
              </Header>
            }
          />
          {firewallRulesError ? <Alert type="error">{firewallRulesError}</Alert> : null}
          <SpaceBetween size="m">
            <Header
              variant="h2"
              actions={
                <SpaceBetween size="xs" direction="horizontal">
                  <Button iconName="refresh" onClick={() => void loadFirewallOptions()}>
                    {t("common.refresh")}
                  </Button>
                  <Button onClick={openFirewallOptionsModal}>
                    {t("vms.editFirewallOptions")}
                  </Button>
                </SpaceBetween>
              }
            >
              {t("vms.vmFirewallOptions")}
            </Header>
            {firewallOptionsLoading ? (
              <Box>{t("common.loading")}</Box>
            ) : (
              <KeyValuePairs
                columns={2}
                items={[
                  { label: t("firewall.enabled"), value: firewallOptionDetails.enable ? t("common.yes") : t("common.no") },
                  { label: t("vms.dhcp"), value: firewallOptionDetails.dhcp ? t("common.yes") : t("common.no") },
                  { label: t("vms.macFilter"), value: firewallOptionDetails.macfilter ? t("common.yes") : t("common.no") },
                  { label: t("firewall.policyIn"), value: firewallActionLabel(firewallOptionDetails.policyIn) },
                  { label: t("firewall.policyOut"), value: firewallActionLabel(firewallOptionDetails.policyOut) },
                ]}
              />
            )}
            {firewallOptionsError ? <Alert type="error">{firewallOptionsError}</Alert> : null}
          </SpaceBetween>
        </SpaceBetween>
      ),
    },
    {
      id: "backup",
      label: t("vms.backupTab"),
      content: (
        <SpaceBetween size="l">
          <Table
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy="volid"
            items={backups}
            columnDefinitions={backupColumns}
            loading={backupsLoading}
            loadingText={t("vms.loadingBackups")}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("vms.noBackups")}</Box>}
            header={
              <Header
                variant="h2"
                counter={`(${backups.length})`}
                actions={
                  <Button iconName="refresh" onClick={() => void loadBackups().then(() => setBackupsLoaded(true))}>
                    {t("common.refresh")}
                  </Button>
                }
              >
                {t("vms.vmBackups")}
              </Header>
            }
          />
          {backupsError ? <Alert type="error">{backupsError}</Alert> : null}
        </SpaceBetween>
      ),
    },
  ];

  return (
    <SpaceBetween size="m">
      <GuestPowerConfirmation action={pendingPowerAction} guests={[{ vmid: numericVmid, name: data.status.name }]} busy={actionLoading !== null} onDismiss={() => setPendingPowerAction(null)} onConfirm={() => { if (pendingPowerAction) void runPowerAction(pendingPowerAction); }} />
      {flashbarItems.length > 0 ? <Flashbar items={flashbarItems.map((item) => ({ ...item, dismissLabel: item.dismissLabel ?? t("common.close"), onDismiss: item.onDismiss ?? (() => setFlashbarItems((current) => current.filter((entry) => entry !== item))) }))} /> : null}
      {actionError ? (
        <Alert type="error" header={t("vms.actionFailed")}>
          {actionError}
        </Alert>
      ) : null}
      {configError ? (
        <Alert type="error" header={t("vms.configUpdateFailed")}>
          {configError}
        </Alert>
      ) : null}
      {snapshotError ? (
        <Alert type="error" header={t("common.error")} dismissible onDismiss={() => setSnapshotError(null)}>
          {snapshotError}
        </Alert>
      ) : null}
      <Header
        variant="h1"
        description={`${t("vms.vmid")} ${numericVmid}`}
        actions={
          <SpaceBetween size="xs" direction="horizontal">
            <Button loading={actionLoading === "start"} disabled={!canStart} onClick={() => requestPowerAction("start")}>
              {t("vms.start")}
            </Button>
            <Button loading={actionLoading === "shutdown"} disabled={!canStop} onClick={() => requestPowerAction("shutdown")}>
              {t("nodeDetail.shutdown")}
            </Button>
            <Button loading={actionLoading === "stop"} disabled={!canStop} onClick={() => requestPowerAction("stop")}>
              {t("vms.stop")}
            </Button>
            <Button loading={actionLoading === "reboot"} disabled={!canReboot} onClick={() => requestPowerAction("reboot")}>
              {t("vms.reboot")}
            </Button>
            <Button disabled={!!actionLoading} onClick={() => void openMigrateModal()}>
              {t("vms.migrate")}
            </Button>
            <Button disabled={!!actionLoading} onClick={() => void openCloneModal()}>
              {t("vms.clone")}
            </Button>
            <Button disabled={!canOpenConsole} onClick={() => router.push(`/vms/${numericVmid}/console`)}>
              {t("vms.console")}
            </Button>
            <Button iconName="refresh" disabled={!!actionLoading} onClick={() => void loadVm()}>
              {t("common.refresh")}
            </Button>
          </SpaceBetween>
        }
      >
        {`${data.status.name ?? `${t("vms.virtualMachines")} ${numericVmid}`} · ${t("vms.vmid")} ${numericVmid}`}
      </Header>
      <Tabs tabs={tabs} activeTabId={activeTabId} onChange={({ detail }) => setActiveTabId(detail.activeTabId)} />
      <Modal
        visible={optionsModalVisible}
        onDismiss={() => {
          setOptionsModalVisible(false);
          setOptionsFormError(null);
        }}
        header={t("vms.editOptions")}
        closeAriaLabel={t("vms.editOptions")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setOptionsModalVisible(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={optionsSaving} onClick={() => void saveOptions()}>
                {t("common.save")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {optionsFormError ? <Alert type="error">{optionsFormError}</Alert> : null}
          <FormField label={t("vms.bootOrder")}>
            <Input value={optionsForm.boot} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, boot: detail.value }))} />
          </FormField>
          <Toggle checked={optionsForm.onboot} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, onboot: detail.checked }))}>
            {t("vms.startOnBoot")}
          </Toggle>
          <Toggle checked={optionsForm.agent} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, agent: detail.checked }))}>
            {t("vms.qemuAgentLabel")}
          </Toggle>
          <Toggle checked={optionsForm.protection} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, protection: detail.checked }))}>
            {t("vms.protection")}
          </Toggle>
          <FormField label={t("vms.hotplug")}>
            <Input value={optionsForm.hotplug} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, hotplug: detail.value }))} />
          </FormField>
          <Toggle checked={optionsForm.tablet} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, tablet: detail.checked }))}>
            {t("vms.tabletDevice")}
          </Toggle>
          <Toggle checked={optionsForm.localtime} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, localtime: detail.checked }))}>
            {t("vms.useLocalTime")}
          </Toggle>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={cloudInitModalVisible}
        onDismiss={() => {
          setCloudInitModalVisible(false);
          setCloudInitFormError(null);
        }}
        header={t("vms.editCloudInit")}
        closeAriaLabel={t("vms.editCloudInit")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setCloudInitModalVisible(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={cloudInitSaving} onClick={() => void saveCloudInit()}>
                {t("common.save")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {cloudInitFormError ? <Alert type="error">{cloudInitFormError}</Alert> : null}
          <FormField label={t("vms.ciUser")}>
            <Input value={cloudInitForm.ciuser} placeholder={t("vms.ciUserPlaceholder")} onChange={({ detail }) => setCloudInitForm((current) => ({ ...current, ciuser: detail.value }))} />
          </FormField>
          <FormField label={t("vms.ciPassword")}>
            <Input type="password" value={cloudInitForm.cipassword} placeholder={getConfigStringValue(data.config.cipassword) ? "****" : undefined} onChange={({ detail }) => setCloudInitForm((current) => ({ ...current, cipassword: detail.value }))} />
          </FormField>
          <FormField label={t("vms.ciDnsServers")}>
            <Input value={cloudInitForm.nameserver} placeholder={t("vms.ciDnsPlaceholder")} onChange={({ detail }) => setCloudInitForm((current) => ({ ...current, nameserver: detail.value }))} />
          </FormField>
          <FormField label={t("vms.ciSearchDomain")}>
            <Input value={cloudInitForm.searchdomain} placeholder={t("vms.ciSearchDomainPlaceholder")} onChange={({ detail }) => setCloudInitForm((current) => ({ ...current, searchdomain: detail.value }))} />
          </FormField>
          <FormField label={t("vms.ciSshKeys")}>
            <Textarea value={cloudInitForm.sshkeys} placeholder={t("vms.ciSshKeysPlaceholder")} rows={5} onChange={({ detail }) => setCloudInitForm((current) => ({ ...current, sshkeys: detail.value }))} />
          </FormField>
          <FormField label={t("vms.ciIpConfig")}>
            <Input value={cloudInitForm.ipconfig0} placeholder={t("vms.ciIpConfigPlaceholder")} onChange={({ detail }) => setCloudInitForm((current) => ({ ...current, ipconfig0: detail.value }))} />
          </FormField>
          <FormField label={t("vms.ciType")}>
            <Select
              selectedOption={cloudInitTypeOptions.find((option) => option.value === cloudInitForm.citype) ?? null}
              onChange={({ detail }) => setCloudInitForm((current) => ({ ...current, citype: optionValue(detail.selectedOption) || "nocloud" }))}
              options={cloudInitTypeOptions}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={firewallRuleEditorVisible}
        onDismiss={() => {
          setFirewallRuleEditorVisible(false);
          setFirewallActionError(null);
        }}
        header={firewallRuleModalMode === "create" ? t("vms.addFirewallRule") : t("vms.editFirewallRule")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => setFirewallRuleEditorVisible(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={firewallSubmitting} onClick={() => void submitFirewallRule()}>
              {firewallRuleModalMode === "create" ? t("common.create") : t("common.save")}
            </Button>
          </SpaceBetween>
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
        visible={firewallDeleteRuleVisible}
        onDismiss={() => {
          setFirewallDeleteRuleVisible(false);
          setFirewallActionError(null);
        }}
        header={t("vms.deleteFirewallRule")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => setFirewallDeleteRuleVisible(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={firewallSubmitting} onClick={() => void deleteFirewallRule()}>
              {t("common.delete")}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          {firewallActionError ? <Alert type="error">{firewallActionError}</Alert> : null}
          <Box>
            {editingFirewallRule ? interpolate(t("vms.deleteFirewallRuleConfirmation"), { pos: editingFirewallRule.pos }) : null}
          </Box>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={firewallOptionsModalVisible}
        onDismiss={() => {
          setFirewallOptionsModalVisible(false);
          setFirewallActionError(null);
        }}
        header={t("vms.editFirewallOptions")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => setFirewallOptionsModalVisible(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={firewallSubmitting} onClick={() => void submitFirewallOptions()}>
              {t("common.save")}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          {firewallActionError ? <Alert type="error">{firewallActionError}</Alert> : null}
          <Toggle checked={firewallOptionsForm.enable} onChange={({ detail }) => setFirewallOptionsForm((current) => ({ ...current, enable: detail.checked }))}>
            {t("firewall.enabled")}
          </Toggle>
          <Toggle checked={firewallOptionsForm.dhcp} onChange={({ detail }) => setFirewallOptionsForm((current) => ({ ...current, dhcp: detail.checked }))}>
            {t("vms.dhcp")}
          </Toggle>
          <Toggle checked={firewallOptionsForm.macfilter} onChange={({ detail }) => setFirewallOptionsForm((current) => ({ ...current, macfilter: detail.checked }))}>
            {t("vms.macFilter")}
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
          setBackupActionError(null);
        }}
        header={t("vms.deleteBackup")}
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => setDeleteBackupVisible(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={backupDeleting} onClick={() => void deleteBackup()}>
              {t("common.delete")}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          {backupActionError ? <Alert type="error">{backupActionError}</Alert> : null}
          <Box>
            {selectedBackup ? interpolate(t("vms.deleteBackupConfirmation"), { volid: selectedBackup.volid }) : null}
          </Box>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={migrateModalVisible}
        onDismiss={() => {
          setMigrateModalVisible(false);
          setMigrateError(null);
        }}
        header={t("vms.migrateVm")}
        closeAriaLabel={t("vms.migrateVm")}
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
                {t("vms.migrate")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {migrateError ? (
            <Alert type="error" header={t("vms.failedToMigrate")}>
              {migrateError}
            </Alert>
          ) : null}
          <FormField label={t("vms.targetNode")}>
            <Select
              selectedOption={migrateTargetNode}
              onChange={({ detail }) => setMigrateTargetNode(detail.selectedOption)}
              options={availableNodes}
              placeholder={t("vms.targetNode")}
              statusType={loadingNodes ? "loading" : "finished"}
              loadingText={t("vms.loadingNodes")}
              empty={t("vms.noOtherNodes")}
            />
          </FormField>
          <Checkbox checked={migrateOnline} onChange={({ detail }) => setMigrateOnline(detail.checked)}>
            {t("vms.onlineMigration")}
          </Checkbox>
          <Box color="text-body-secondary">{t("vms.onlineMigrationDesc")}</Box>
          <Checkbox checked={migrateWithLocalDisks} onChange={({ detail }) => setMigrateWithLocalDisks(detail.checked)}>
            {t("vms.withLocalDisks")}
          </Checkbox>
          <Box color="text-body-secondary">{t("vms.withLocalDisksDesc")}</Box>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={cloneModalVisible}
        onDismiss={() => {
          setCloneModalVisible(false);
          setCloneError(null);
        }}
        header={t("vms.cloneVm")}
        closeAriaLabel={t("vms.cloneVm")}
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
                {t("vms.clone")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {cloneError ? (
            <Alert type="error" header={t("vms.failedToClone")}>
              {cloneError}
            </Alert>
          ) : null}
          <FormField label={t("vms.newVmId")}>
            <Input type="number" value={cloneNewId} onChange={({ detail }) => setCloneNewId(detail.value)} />
          </FormField>
          <FormField label={t("vms.newName")}>
            <Input value={cloneName} onChange={({ detail }) => setCloneName(detail.value)} />
          </FormField>
          <FormField label={t("vms.targetNode")}>
            <Select
              selectedOption={cloneTargetNode}
              onChange={({ detail }) => {
                setCloneTargetNode(detail.selectedOption);
                setCloneTargetStorage(null);
                setAvailableStorages([]);
              }}
              options={availableNodes}
              placeholder={t("vms.targetNode")}
              statusType={loadingNodes ? "loading" : "finished"}
              loadingText={t("vms.loadingNodes")}
            />
          </FormField>
          <FormField label={t("vms.targetStorage")} description={t("vms.targetStorageDesc")}>
            <Select
              selectedOption={cloneTargetStorage}
              onChange={({ detail }) => setCloneTargetStorage(detail.selectedOption)}
              options={availableStorages}
              placeholder={t("vms.sameStorageHint")}
              statusType={loadingStorages ? "loading" : "finished"}
              loadingText={t("vms.loadingStorages")}
              empty={t("vms.sameStorageHint")}
            />
          </FormField>
          <FormField label={t("vms.cloneMode")}>
            <Select
              selectedOption={cloneFullClone}
              onChange={({ detail }) => setCloneFullClone(detail.selectedOption)}
              options={cloneModeOptions}
            />
          </FormField>
          <FormField label={t("vms.description")}>
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
        header={t("vms.createSnapshot")}
        closeAriaLabel={t("vms.createSnapshot")}
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
                {t("vms.createSnapshot")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {snapshotError ? (
            <Alert type="error" header={t("vms.failedToCreateSnapshot")}>
              {snapshotError}
            </Alert>
          ) : null}
          <FormField label={t("vms.snapshotName")}>
            <Input value={snapshotName} onChange={({ detail }) => setSnapshotName(detail.value)} />
          </FormField>
          <FormField label={t("vms.snapshotDescription")}>
            <Textarea value={snapshotDescription} onChange={({ detail }) => setSnapshotDescription(detail.value)} rows={4} />
          </FormField>
          <Checkbox checked={snapshotVmState} onChange={({ detail }) => setSnapshotVmState(detail.checked)}>
            {t("vms.includeVmState")}
          </Checkbox>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={deleteSnapshotModalVisible}
        onDismiss={() => {
          setDeleteSnapshotModalVisible(false);
          setSelectedSnapshot(null);
          setSnapshotError(null);
        }}
        header={t("vms.deleteSnapshot")}
        closeAriaLabel={t("vms.deleteSnapshot")}
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
            <Alert type="error" header={t("vms.failedToDeleteSnapshot")}>
              {snapshotError}
            </Alert>
          ) : null}
          <Box>{t("vms.confirmDeleteSnapshot").replace("{name}", selectedSnapshot?.name ?? "")}</Box>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={rollbackSnapshotModalVisible}
        onDismiss={() => {
          setRollbackSnapshotModalVisible(false);
          setSelectedSnapshot(null);
          setSnapshotError(null);
        }}
        header={t("vms.rollbackSnapshot")}
        closeAriaLabel={t("vms.rollbackSnapshot")}
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
            <Alert type="error" header={t("vms.failedToRollbackSnapshot")}>
              {snapshotError}
            </Alert>
          ) : null}
          <Alert type="warning" header={t("vms.rollbackSnapshot")}>
            {t("vms.confirmRollbackSnapshot").replace("{name}", selectedSnapshot?.name ?? "")}
          </Alert>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={editModalVisible}
        onDismiss={() => {
          setEditModalVisible(false);
          setConfigError(null);
        }}
        header={t("vms.editConfiguration")}
        closeAriaLabel={t("vms.editConfiguration")}
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
                {t("vms.saveChanges")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField label={t("vms.cpuCores")}>
            <Input type="number" value={editCores} onChange={({ detail }) => setEditCores(detail.value)} />
          </FormField>
          <FormField label={t("vms.cpuSockets")}>
            <Input type="number" value={editSockets} onChange={({ detail }) => setEditSockets(detail.value)} />
          </FormField>
          <FormField label={t("vms.memoryMb")}>
            <Input type="number" value={editMemory} onChange={({ detail }) => setEditMemory(detail.value)} />
          </FormField>
          <FormField label={t("vms.description")}>
            <Textarea value={editDescription} onChange={({ detail }) => setEditDescription(detail.value)} rows={4} />
          </FormField>
        </SpaceBetween>
      </Modal>
      <Modal
        visible={resizeModalVisible}
        onDismiss={() => {
          setResizeModalVisible(false);
          setConfigError(null);
        }}
        header={t("vms.resizeDisk")}
        closeAriaLabel={t("vms.resizeDisk")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setResizeModalVisible(false);
                  setConfigError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={resizingDisk} onClick={() => void resizeVmDisk()}>
                {t("vms.resizeDisk")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Alert type="info" header={t("vms.diskResizeNote")}>
            {t("vms.diskResizeInfo")}
          </Alert>
          <FormField label={t("vms.diskName")}>
            <Select
              selectedOption={selectedDisk}
              onChange={({ detail }) => setSelectedDisk(detail.selectedOption)}
              options={diskOptions}
              placeholder={t("vms.selectDisk")}
            />
          </FormField>
          <FormField label={t("vms.newSizeGb")}>
            <Input type="number" value={diskSizeGb} onChange={({ detail }) => setDiskSizeGb(detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
