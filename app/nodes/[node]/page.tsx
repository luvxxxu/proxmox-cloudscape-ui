"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";

import { formatResourceBytes as formatBytes, setOptionalParameters } from "@/app/lib/resource-api";

import { useCollection } from "@cloudscape-design/collection-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import AreaChart from "@cloudscape-design/components/area-chart";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Tabs, { type TabsProps } from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useTranslation } from "@/app/lib/use-translation";

interface PveNodeStatus {
  node?: string;
  status?: string;
  cpu?: number;
  cpuinfo?: { cpus?: number; cores?: number; model?: string; sockets?: number };
  memory?: { total?: number; used?: number; free?: number };
  rootfs?: { total?: number; used?: number; free?: number; avail?: number };
  swap?: { total?: number; used?: number; free?: number };
  uptime?: number;
  loadavg?: number[] | string;
  kversion?: string;
  pveversion?: string;
  [key: string]: unknown;
}

interface PveNetwork {
  iface: string;
  type: string;
  active?: number;
  autostart?: number;
  method?: string;
  method6?: string;
  address?: string;
  cidr?: string;
  gateway?: string;
  comments?: string;
}

interface PveStorage {
  storage: string;
  type: string;
  content: string;
  status?: string;
  total?: number;
  used?: number;
}

interface PveTask {
  upid: string;
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

interface PveNodeDnsConfig {
  search?: string;
  dns1?: string;
  dns2?: string;
  dns3?: string;
}

interface PveNodeTimeConfig {
  timezone?: string;
  localtime?: number;
  time?: number;
}

interface PveNodeSyslogEntry {
  n: number;
  t: string;
}

interface PveNodeService {
  service: string;
  name?: string;
  desc?: string;
  state?: string;
  "active-state"?: string;
  "unit-state"?: string;
}

interface PveNodeHostsData {
  data: string;
  digest: string;
}

interface PveNodePackage {
  Package: string;
  Title?: string;
  OldVersion?: string;
  Version?: string;
  Section?: string;
  Priority?: string;
  Arch?: string;
  Origin?: string;
}

interface PveNodeCertificate {
  filename: string;
  subject?: string;
  issuer?: string;
  notbefore?: number;
  notafter?: number;
  fingerprint?: string;
  san?: string;
  "public-key-type"?: string;
  "public-key-bits"?: number;
}

interface PveNodeDisk {
  devpath: string;
  size?: number;
  type?: string;
  vendor?: string;
  model?: string;
  serial?: string;
  wearout?: number | string;
  health?: string;
  gpt?: number | string | boolean;
  used?: string;
}

interface PveNodeDiskSmartAttribute {
  id?: number;
  name?: string;
  value?: number | string;
  worst?: number | string;
  thresh?: number | string;
  raw?: number | string;
}

interface PveNodeDiskSmartData {
  health?: string;
  type?: string;
  attributes?: PveNodeDiskSmartAttribute[];
}

interface PveNodeSubscription {
  status?: string;
  message?: string;
  serverid?: string;
  sockets?: number;
  level?: string;
  key?: string;
  next?: string;
  productname?: string;
  url?: string;
  regdate?: string;
}

interface PveNodeFirewallRule {
  pos?: number;
  type?: string;
  action?: string;
  macro?: string;
  proto?: string;
  source?: string;
  dest?: string;
  dport?: string;
  sport?: string;
  comment?: string;
  enable?: number;
}

interface PveNodeFirewallOptions {
  enable?: number;
  log_level_in?: string;
  log_level_out?: string;
  ndp?: number;
  smurf_log_level?: string;
  tcp_flags_log_level?: string;
}

interface PveNodeFirewallLogEntry {
  n?: number;
  t?: string;
}

interface PveNodePciDevice {
  id?: string;
  class?: string;
  vendor?: string;
  device?: string;
  vendor_name?: string;
  device_name?: string;
  subsystem_device?: string;
  subsystem_vendor?: string;
  iommugroup?: number;
  mdev?: boolean;
}

interface PveNodeUsbDevice {
  busnum?: number;
  devnum?: number;
  vendid?: string;
  prodid?: string;
  manufacturer?: string;
  product?: string;
  speed?: string;
  serial?: string;
  class?: number;
  level?: number;
  port?: number;
  usbpath?: string;
}

interface NodeDetailData {
  status: PveNodeStatus;
  network: PveNetwork[];
  storage: PveStorage[];
  tasks: PveTask[];
  rrd: PveRrdPoint[];
}



function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h`;
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp * 1000).toLocaleString();
}

function getUsagePercent(used?: number, total?: number) {
  if (!used || !total) {
    return 0;
  }
  return Math.round((used / total) * 100);
}

function getBootMode(status: PveNodeStatus): string {
  const bootInfo = status["boot-info"];
  if (!bootInfo || typeof bootInfo !== "object") {
    return "-";
  }

  const mode = Reflect.get(bootInfo, "mode");
  return typeof mode === "string" && mode.length > 0 ? mode : "-";
}

function getServiceStateType(state?: string) {
  if (state === "running") {
    return "success" as const;
  }
  if (state === "dead" || state === "exited") {
    return "stopped" as const;
  }
  return "warning" as const;
}

function getHealthStateType(health?: string) {
  const normalizedHealth = health?.toLowerCase();
  if (!normalizedHealth) {
    return "info" as const;
  }
  if (["passed", "ok", "healthy", "good"].includes(normalizedHealth)) {
    return "success" as const;
  }
  if (["failed", "critical", "bad"].includes(normalizedHealth)) {
    return "error" as const;
  }
  return "warning" as const;
}

function isTruthyDiskFlag(value?: number | string | boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    return normalizedValue !== "" && normalizedValue !== "0" && normalizedValue !== "false" && normalizedValue !== "no";
  }
  return false;
}

async function fetchProxmox<T>(path: string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function NodeDetailPage() {
  const params = useParams<{ node: string }>();
  const node = Array.isArray(params.node) ? params.node[0] : params.node;
  return <NodeDetails key={node} node={node} />;
}

function NodeDetails({ node }: { node: string }) {
  const [activeTabId, setActiveTabId] = useState("summary");
  const [data, setData] = useState<NodeDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t, language } = useTranslation();
  const [actionLoading, setActionLoading] = useState<"reboot" | "shutdown" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [rebootModalVisible, setRebootModalVisible] = useState(false);
  const [shutdownModalVisible, setShutdownModalVisible] = useState(false);
  const [dnsConfig, setDnsConfig] = useState<PveNodeDnsConfig | null>(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [dnsModalVisible, setDnsModalVisible] = useState(false);
  const [dnsSaving, setDnsSaving] = useState(false);
  const [dnsForm, setDnsForm] = useState<PveNodeDnsConfig>({ search: "", dns1: "", dns2: "", dns3: "" });
  const [timeConfig, setTimeConfig] = useState<PveNodeTimeConfig | null>(null);
  const [timeLoading, setTimeLoading] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [timeModalVisible, setTimeModalVisible] = useState(false);
  const [timeSaving, setTimeSaving] = useState(false);
  const [timezoneValue, setTimezoneValue] = useState("");
  const [syslogEntries, setSyslogEntries] = useState<PveNodeSyslogEntry[]>([]);
  const [syslogLoading, setSyslogLoading] = useState(false);
  const [syslogLoaded, setSyslogLoaded] = useState(false);
  const [syslogError, setSyslogError] = useState<string | null>(null);
  const [services, setServices] = useState<PveNodeService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesLoaded, setServicesLoaded] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [serviceActionLoading, setServiceActionLoading] = useState<Record<string, "start" | "stop" | "restart" | null>>({});
  const [hostsData, setHostsData] = useState<PveNodeHostsData | null>(null);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);
  const [hostsModalVisible, setHostsModalVisible] = useState(false);
  const [hostsSaving, setHostsSaving] = useState(false);
  const [hostsFormContent, setHostsFormContent] = useState("");
  const [packages, setPackages] = useState<PveNodePackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packagesLoaded, setPackagesLoaded] = useState(false);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [updatingPackages, setUpdatingPackages] = useState(false);
  const [certificates, setCertificates] = useState<PveNodeCertificate[]>([]);
  const [certsLoading, setCertsLoading] = useState(false);
  const [certsLoaded, setCertsLoaded] = useState(false);
  const [certsError, setCertsError] = useState<string | null>(null);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [uploadSaving, setUploadSaving] = useState(false);
  const [certKey, setCertKey] = useState("");
  const [certChain, setCertChain] = useState("");
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [disks, setDisks] = useState<PveNodeDisk[]>([]);
  const [disksLoading, setDisksLoading] = useState(false);
  const [disksLoaded, setDisksLoaded] = useState(false);
  const [disksError, setDisksError] = useState<string | null>(null);
  const [smartModalVisible, setSmartModalVisible] = useState(false);
  const [smartData, setSmartData] = useState<PveNodeDiskSmartData | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);
  const [selectedDisk, setSelectedDisk] = useState<PveNodeDisk | null>(null);
  const [initGptModalVisible, setInitGptModalVisible] = useState(false);
  const [wipeDiskModalVisible, setWipeDiskModalVisible] = useState(false);
  const [diskActionLoading, setDiskActionLoading] = useState(false);
  const [diskConfirmation, setDiskConfirmation] = useState("");
  const [subscriptionData, setSubscriptionData] = useState<PveNodeSubscription | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [subscriptionKey, setSubscriptionKey] = useState("");
  const [activatingSubscription, setActivatingSubscription] = useState(false);
  const [removeSubscriptionModalVisible, setRemoveSubscriptionModalVisible] = useState(false);
  const [removingSubscription, setRemovingSubscription] = useState(false);
  const [firewallRules, setFirewallRules] = useState<PveNodeFirewallRule[]>([]);
  const [firewallOptions, setFirewallOptions] = useState<PveNodeFirewallOptions | null>(null);
  const [firewallLog, setFirewallLog] = useState<PveNodeFirewallLogEntry[]>([]);
  const [fwOptionsLoading, setFwOptionsLoading] = useState(false);
  const [fwRulesLoading, setFwRulesLoading] = useState(false);
  const [fwRulesLoaded, setFwRulesLoaded] = useState(false);
  const [fwLogLoading, setFwLogLoading] = useState(false);
  const [fwLogLoaded, setFwLogLoaded] = useState(false);
  const [fwError, setFwError] = useState<string | null>(null);
  const [fwLoadErrors, setFwLoadErrors] = useState<{ rules?: string; options?: string; log?: string }>({});
  const fwLoadError = Object.values(fwLoadErrors).filter(Boolean).join(" · ");
  const [fwRuleModalVisible, setFwRuleModalVisible] = useState(false);
  const [fwRuleEditPos, setFwRuleEditPos] = useState<number | null>(null);
  const [fwRuleForm, setFwRuleForm] = useState({
    type: "",
    action: "",
    macro: "",
    proto: "",
    source: "",
    dest: "",
    dport: "",
    sport: "",
    comment: "",
    enable: 1,
  });
  const [fwRuleSaving, setFwRuleSaving] = useState(false);
  const [fwOptionsModalVisible, setFwOptionsModalVisible] = useState(false);
  const [fwOptionsSaving, setFwOptionsSaving] = useState(false);
  const [fwDeleteModalVisible, setFwDeleteModalVisible] = useState(false);
  const [fwDeletePos, setFwDeletePos] = useState<number | null>(null);
  const [fwDeleting, setFwDeleting] = useState(false);
  const [fwOptionsForm, setFwOptionsForm] = useState({
    enable: "0",
    log_level_in: "",
    log_level_out: "",
    ndp: "0",
    smurf_log_level: "nolog",
    tcp_flags_log_level: "",
  });
  const [pciDevices, setPciDevices] = useState<PveNodePciDevice[]>([]);
  const [usbDevices, setUsbDevices] = useState<PveNodeUsbDevice[]>([]);
  const [pciLoading, setPciLoading] = useState(false);
  const [pciLoaded, setPciLoaded] = useState(false);
  const [usbLoading, setUsbLoading] = useState(false);
  const [usbLoaded, setUsbLoaded] = useState(false);
  const [hwErrors, setHwErrors] = useState<{ pci?: string; usb?: string }>({});
  const hwError = Object.values(hwErrors).filter(Boolean).join(" · ");

  const detailRequest = useRef<AbortController | null>(null);

  const loadNode = useCallback(async () => {
    if (!node) {
      return;
    }

    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    try {
      setLoading(true);
      setActionError(null);
      const [status, network, storage, tasks, rrd] = await Promise.all([
        fetchProxmox<PveNodeStatus>(`/api/proxmox/nodes/${node}/status`, { signal: controller.signal }),
        fetchProxmox<PveNetwork[]>(`/api/proxmox/nodes/${node}/network`, { signal: controller.signal }),
        fetchProxmox<PveStorage[]>(`/api/proxmox/nodes/${node}/storage`, { signal: controller.signal }),
        fetchProxmox<PveTask[]>(`/api/proxmox/nodes/${node}/tasks?limit=50`, { signal: controller.signal }),
        fetchProxmox<PveRrdPoint[]>(`/api/proxmox/nodes/${node}/rrddata?timeframe=hour&cf=AVERAGE`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setData({
        status,
        network: network ?? [],
        storage: storage ?? [],
        tasks: tasks ?? [],
        rrd: rrd ?? [],
      });
      setError(null);
    } catch (fetchError) {
      if (controller.signal.aborted) return;
      setError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoad"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [node, t]);

  useResourceTaskRefresh(loadNode);

  useEffect(() => {
    // Start an external request; loading state belongs to its asynchronous lifecycle.
    void loadNode();
    return () => detailRequest.current?.abort();
  }, [loadNode]);

  const loadDns = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setDnsLoading(true);
      const config = await fetchProxmox<PveNodeDnsConfig>(`/api/proxmox/nodes/${node}/dns`);
      setDnsConfig(config ?? null);
      setDnsError(null);
    } catch (fetchError) {
      setDnsError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadDns"));
    } finally {
      setDnsLoading(false);
    }
  }, [node, t]);

  const loadTime = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setTimeLoading(true);
      const config = await fetchProxmox<PveNodeTimeConfig>(`/api/proxmox/nodes/${node}/time`);
      setTimeConfig(config ?? null);
      setTimeError(null);
    } catch (fetchError) {
      setTimeError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadTime"));
    } finally {
      setTimeLoading(false);
    }
  }, [node, t]);

  const loadSyslog = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setSyslogLoading(true);
      const entries = await fetchProxmox<PveNodeSyslogEntry[]>(`/api/proxmox/nodes/${node}/syslog?start=0&limit=500`);
      setSyslogEntries(entries ?? []);
      setSyslogLoaded(true);
      setSyslogError(null);
    } catch (fetchError) {
      setSyslogError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadSyslog"));
    } finally {
      setSyslogLoading(false);
    }
  }, [node, t]);

  const loadServices = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setServicesLoading(true);
      const serviceItems = await fetchProxmox<PveNodeService[]>(`/api/proxmox/nodes/${node}/services`);
      setServices(serviceItems ?? []);
      setServicesLoaded(true);
      setServicesError(null);
    } catch (fetchError) {
      setServicesError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadServices"));
    } finally {
      setServicesLoading(false);
    }
  }, [node, t]);

  const loadHosts = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setHostsLoading(true);
      const hosts = await fetchProxmox<PveNodeHostsData>(`/api/proxmox/nodes/${node}/hosts`);
      setHostsData(hosts ?? null);
      setHostsError(null);
    } catch (fetchError) {
      setHostsError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadHosts"));
    } finally {
      setHostsLoading(false);
    }
  }, [node, t]);

  const loadPackages = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setPackagesLoading(true);
      const packageItems = await fetchProxmox<PveNodePackage[]>(`/api/proxmox/nodes/${node}/apt/versions`);
      setPackages(packageItems ?? []);
      setPackagesLoaded(true);
      setPackagesError(null);
    } catch (fetchError) {
      setPackagesError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadPackages"));
    } finally {
      setPackagesLoading(false);
    }
  }, [node, t]);

  const loadCertificates = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setCertsLoading(true);
      const certificateItems = await fetchProxmox<PveNodeCertificate[]>(`/api/proxmox/nodes/${node}/certificates/info`);
      setCertificates(certificateItems ?? []);
      setCertsLoaded(true);
      setCertsError(null);
    } catch (fetchError) {
      setCertsError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadCertificates"));
    } finally {
      setCertsLoading(false);
    }
  }, [node, t]);

  const loadDisks = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setDisksLoading(true);
      const diskItems = await fetchProxmox<PveNodeDisk[]>(`/api/proxmox/nodes/${node}/disks/list`);
      setDisks(diskItems ?? []);
      setDisksLoaded(true);
      setDisksError(null);
    } catch (fetchError) {
      setDisksError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadDisks"));
    } finally {
      setDisksLoading(false);
    }
  }, [node, t]);

  const loadSubscription = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setSubscriptionLoading(true);
      const subscription = await fetchProxmox<PveNodeSubscription>(`/api/proxmox/nodes/${node}/subscription`);
      setSubscriptionData(subscription ?? null);
      setSubscriptionError(null);
    } catch (fetchError) {
      setSubscriptionError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadSubscription"));
    } finally {
      setSubscriptionLoading(false);
    }
  }, [node, t]);

  const loadFirewallRules = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setFwRulesLoading(true);
      const rules = await fetchProxmox<PveNodeFirewallRule[]>(`/api/proxmox/nodes/${node}/firewall/rules`);
      setFirewallRules(rules ?? []);
      setFwRulesLoaded(true);
      setFwLoadErrors((current) => ({ ...current, rules: undefined }));
    } catch (fetchError) {
      setFwLoadErrors((current) => ({ ...current, rules: fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadFirewallRules") }));
    } finally {
      setFwRulesLoading(false);
    }
  }, [node, t]);

  const loadFirewallOptions = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setFwOptionsLoading(true);
      const options = await fetchProxmox<PveNodeFirewallOptions>(`/api/proxmox/nodes/${node}/firewall/options`);
      setFirewallOptions(options ?? {});
      setFwLoadErrors((current) => ({ ...current, options: undefined }));
    } catch (fetchError) {
      setFwLoadErrors((current) => ({ ...current, options: fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadFirewallOptions") }));
    } finally {
      setFwOptionsLoading(false);
    }
  }, [node, t]);

  const loadFirewallLog = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setFwLogLoading(true);
      const logEntries = await fetchProxmox<PveNodeFirewallLogEntry[]>(`/api/proxmox/nodes/${node}/firewall/log?limit=50`);
      setFirewallLog(logEntries ?? []);
      setFwLogLoaded(true);
      setFwLoadErrors((current) => ({ ...current, log: undefined }));
    } catch (fetchError) {
      setFwLoadErrors((current) => ({ ...current, log: fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadFirewallLog") }));
    } finally {
      setFwLogLoading(false);
    }
  }, [node, t]);

  const loadPciDevices = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setPciLoading(true);
      const devices = await fetchProxmox<PveNodePciDevice[]>(`/api/proxmox/nodes/${node}/hardware/pci`);
      setPciDevices(devices ?? []);
      setPciLoaded(true);
      setHwErrors((current) => ({ ...current, pci: undefined }));
    } catch (fetchError) {
      setHwErrors((current) => ({ ...current, pci: fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadPci") }));
    } finally {
      setPciLoading(false);
    }
  }, [node, t]);

  const loadUsbDevices = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setUsbLoading(true);
      const devices = await fetchProxmox<PveNodeUsbDevice[]>(`/api/proxmox/nodes/${node}/hardware/usb`);
      setUsbDevices(devices ?? []);
      setUsbLoaded(true);
      setHwErrors((current) => ({ ...current, usb: undefined }));
    } catch (fetchError) {
      setHwErrors((current) => ({ ...current, usb: fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadUsb") }));
    } finally {
      setUsbLoading(false);
    }
  }, [node, t]);

  useEffect(() => {
    if (activeTabId === "dns" && !dnsConfig && !dnsLoading && !dnsError) {
      // Start external tab requests; each loader owns its loading, data, and error lifecycle.
      void loadDns();
    }
    if (activeTabId === "time" && !timeConfig && !timeLoading && !timeError) {
      void loadTime();
    }
    if (activeTabId === "syslog" && !syslogLoaded && !syslogLoading && !syslogError) {
      void loadSyslog();
    }
    if (activeTabId === "services" && !servicesLoaded && !servicesLoading && !servicesError) {
      void loadServices();
    }
    if (activeTabId === "hosts" && !hostsData && !hostsLoading && !hostsError) {
      void loadHosts();
    }
    if (activeTabId === "packages" && !packagesLoaded && !packagesLoading && !packagesError) {
      void loadPackages();
    }
    if (activeTabId === "certificates" && !certsLoaded && !certsLoading && !certsError) {
      void loadCertificates();
    }
    if (activeTabId === "disks" && !disksLoaded && !disksLoading && !disksError) {
      void loadDisks();
    }
    if (activeTabId === "subscription" && !subscriptionData && !subscriptionLoading && !subscriptionError) {
      void loadSubscription();
    }
    if (activeTabId === "firewall") {
      if (!fwRulesLoaded && !fwRulesLoading && !fwLoadErrors.rules) {
        void loadFirewallRules();
      }
      if (!firewallOptions && !fwOptionsLoading && !fwLoadErrors.options) {
        void loadFirewallOptions();
      }
      if (!fwLogLoaded && !fwLogLoading && !fwLoadErrors.log) {
        void loadFirewallLog();
      }
    }
    if (activeTabId === "hardware") {
      if (!pciLoaded && !pciLoading && !hwErrors.pci) {
        void loadPciDevices();
      }
      if (!usbLoaded && !usbLoading && !hwErrors.usb) {
        void loadUsbDevices();
      }
    }
  }, [
    activeTabId,
    certsLoaded,
    certsError,
    certsLoading,
    dnsConfig,
    dnsError,
    dnsLoading,
    disksLoaded,
    disksError,
    disksLoading,
    firewallOptions,
    fwOptionsLoading,
    fwLoadErrors,
    fwLogLoaded,
    fwLogLoading,
    fwRulesLoaded,
    fwRulesLoading,
    hostsData,
    hostsError,
    hostsLoading,
    loadDns,
    loadCertificates,
    loadDisks,
    loadFirewallLog,
    loadFirewallOptions,
    loadFirewallRules,
    loadHosts,
    loadPackages,
    loadPciDevices,
    loadServices,
    loadSubscription,
    loadSyslog,
    loadTime,
    loadUsbDevices,
    packagesLoaded,
    packagesError,
    packagesLoading,
    pciLoaded,
    pciLoading,
    servicesLoaded,
    servicesError,
    servicesLoading,
    subscriptionData,
    subscriptionError,
    subscriptionLoading,
    syslogLoaded,
    syslogError,
    syslogLoading,
    timeConfig,
    timeError,
    timeLoading,
    usbLoaded,
    usbLoading,
    hwErrors,
  ]);

  const openDnsModal = useCallback(() => {
    setDnsForm({
      search: dnsConfig?.search ?? "",
      dns1: dnsConfig?.dns1 ?? "",
      dns2: dnsConfig?.dns2 ?? "",
      dns3: dnsConfig?.dns3 ?? "",
    });
    setDnsError(null);
    setDnsModalVisible(true);
  }, [dnsConfig]);

  const openTimeModal = useCallback(() => {
    setTimezoneValue(timeConfig?.timezone ?? "");
    setTimeError(null);
    setTimeModalVisible(true);
  }, [timeConfig]);

  const openHostsModal = useCallback(() => {
    setHostsFormContent(hostsData?.data ?? "");
    setHostsError(null);
    setHostsModalVisible(true);
  }, [hostsData]);

  const openUploadCertificateModal = useCallback(() => {
    setCertKey("");
    setCertChain("");
    setCertsError(null);
    setUploadModalVisible(true);
  }, []);

  const openFirewallRuleModal = useCallback((rule?: PveNodeFirewallRule) => {
    setFwRuleEditPos(rule?.pos ?? null);
    setFwRuleForm({
      type: rule?.type ?? "",
      action: rule?.action ?? "",
      macro: rule?.macro ?? "",
      proto: rule?.proto ?? "",
      source: rule?.source ?? "",
      dest: rule?.dest ?? "",
      dport: rule?.dport ?? "",
      sport: rule?.sport ?? "",
      comment: rule?.comment ?? "",
      enable: rule?.enable ?? 1,
    });
    setFwError(null);
    setFwRuleModalVisible(true);
  }, []);

  const openFirewallOptionsModal = useCallback(() => {
    setFwOptionsForm({
      enable: String(firewallOptions?.enable ?? 1),
      log_level_in: firewallOptions?.log_level_in ?? "nolog",
      log_level_out: firewallOptions?.log_level_out ?? "nolog",
      ndp: String(firewallOptions?.ndp ?? 1),
      smurf_log_level: String(firewallOptions?.smurf_log_level ?? "nolog"),
      tcp_flags_log_level: firewallOptions?.tcp_flags_log_level ?? "nolog",
    });
    setFwError(null);
    setFwOptionsModalVisible(true);
  }, [firewallOptions]);

  const pushFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashbarItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
  }, []);

  const runNodeAction = useCallback(async (action: "reboot" | "shutdown") => {
    if (!node) {
      return;
    }

    try {
      setActionLoading(action);
      setActionError(null);

      const body = new URLSearchParams({ command: action });
      await fetchProxmox(`/api/proxmox/nodes/${node}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t(action === "reboot" ? "nodeDetail.rebootSuccess" : "nodeDetail.shutdownSuccess").replace("{node}", node),
        dismissible: true,
        id: `node-${action}`,
      });

      setRebootModalVisible(false);
      setShutdownModalVisible(false);
      await loadNode();
    } catch (runError) {
      setActionError(runError instanceof Error ? runError.message : t(action === "reboot" ? "nodeDetail.failedToReboot" : "nodeDetail.failedToShutdown"));
    } finally {
      setActionLoading(null);
    }
  }, [loadNode, node, pushFlash, t]);

  const saveDns = useCallback(async () => {
    if (!node) {
      return;
    }

    const search = dnsForm.search?.trim() ?? "";
    if (!search) {
      setDnsError(t("nodeDetail.searchDomainRequired"));
      return;
    }

    try {
      setDnsSaving(true);
      setDnsError(null);

      const params: Record<string, string> = { search };
      const dns1 = dnsForm.dns1?.trim() ?? "";
      const dns2 = dnsForm.dns2?.trim() ?? "";
      const dns3 = dnsForm.dns3?.trim() ?? "";
      if (dns1) params.dns1 = dns1;
      if (dns2) params.dns2 = dns2;
      if (dns3) params.dns3 = dns3;
      const body = new URLSearchParams(params);

      await fetchProxmox(`/api/proxmox/nodes/${node}/dns`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.dnsUpdated"),
        dismissible: true,
        id: "node-dns-updated",
      });

      setDnsModalVisible(false);
      await loadDns();
    } catch (saveError) {
      setDnsError(saveError instanceof Error ? saveError.message : t("nodeDetail.failedToUpdateDns"));
    } finally {
      setDnsSaving(false);
    }
  }, [dnsForm, loadDns, node, pushFlash, t]);

  const saveTime = useCallback(async () => {
    if (!node) {
      return;
    }

    const timezone = timezoneValue.trim();
    if (!timezone) {
      setTimeError(t("nodeDetail.timezoneRequired"));
      return;
    }

    try {
      setTimeSaving(true);
      setTimeError(null);

      const body = new URLSearchParams({ timezone });

      await fetchProxmox(`/api/proxmox/nodes/${node}/time`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.timeUpdated"),
        dismissible: true,
        id: "node-time-updated",
      });

      setTimeModalVisible(false);
      await loadTime();
    } catch (saveError) {
      setTimeError(saveError instanceof Error ? saveError.message : t("nodeDetail.failedToUpdateTime"));
    } finally {
      setTimeSaving(false);
    }
  }, [loadTime, node, pushFlash, t, timezoneValue]);

  const runServiceAction = useCallback(async (service: string, action: "start" | "stop" | "restart") => {
    if (!node) {
      return;
    }

    try {
      setServiceActionLoading((current) => ({ ...current, [service]: action }));
      setServicesError(null);

      await fetchProxmox(`/api/proxmox/nodes/${node}/services/${service}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      const actionLabel = t(
        action === "start"
          ? "nodeDetail.startService"
          : action === "stop"
            ? "nodeDetail.stopService"
            : "nodeDetail.restartService",
      );

      pushFlash({
        type: "success",
        content: t("nodeDetail.serviceActionSuccess").replace("{service}", service).replace("{action}", actionLabel),
        dismissible: true,
        id: `service-${service}-${action}`,
      });

      await loadServices();
    } catch (runError) {
      const actionLabel = t(
        action === "start"
          ? "nodeDetail.startService"
          : action === "stop"
            ? "nodeDetail.stopService"
            : "nodeDetail.restartService",
      );
      setServicesError(
        runError instanceof Error
          ? runError.message
          : t("nodeDetail.failedServiceAction").replace("{service}", service).replace("{action}", actionLabel),
      );
    } finally {
      setServiceActionLoading((current) => ({ ...current, [service]: null }));
    }
  }, [loadServices, node, pushFlash, t]);

  const saveHosts = useCallback(async () => {
    if (!node || !hostsData) {
      return;
    }

    try {
      setHostsSaving(true);
      setHostsError(null);

      const body = new URLSearchParams({
        data: hostsFormContent,
        digest: hostsData.digest,
      });

      await fetchProxmox(`/api/proxmox/nodes/${node}/hosts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.hostsUpdated"),
        dismissible: true,
        id: "node-hosts-updated",
      });

      setHostsModalVisible(false);
      await loadHosts();
    } catch (saveError) {
      setHostsError(saveError instanceof Error ? saveError.message : t("nodeDetail.failedToUpdateHosts"));
    } finally {
      setHostsSaving(false);
    }
  }, [hostsData, hostsFormContent, loadHosts, node, pushFlash, t]);

  const refreshPackageLists = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setUpdatingPackages(true);
      setPackagesError(null);

      await fetchProxmox(`/api/proxmox/nodes/${node}/apt/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.packageListUpdated"),
        dismissible: true,
        id: "node-package-lists-updated",
      });

      await loadPackages();
    } catch (updateError) {
      setPackagesError(updateError instanceof Error ? updateError.message : t("nodeDetail.failedToUpdatePackageLists"));
    } finally {
      setUpdatingPackages(false);
    }
  }, [loadPackages, node, pushFlash, t]);

  const uploadCertificate = useCallback(async () => {
    if (!node) {
      return;
    }

    const trimmedKey = certKey.trim();
    const trimmedChain = certChain.trim();

    if (!trimmedKey) {
      setCertsError(t("nodeDetail.certificateKeyRequired"));
      return;
    }

    if (!trimmedChain) {
      setCertsError(t("nodeDetail.certificateChainRequired"));
      return;
    }

    try {
      setUploadSaving(true);
      setCertsError(null);

      const body = new URLSearchParams({
        key: trimmedKey,
        certificates: trimmedChain,
        restart: "1",
        force: "1",
      });

      await fetchProxmox(`/api/proxmox/nodes/${node}/certificates/custom`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.certificateUploaded"),
        dismissible: true,
        id: "node-certificate-uploaded",
      });

      setUploadModalVisible(false);
      setCertKey("");
      setCertChain("");
      await loadCertificates();
    } catch (uploadError) {
      setCertsError(uploadError instanceof Error ? uploadError.message : t("nodeDetail.failedToUploadCertificate"));
    } finally {
      setUploadSaving(false);
    }
  }, [certChain, certKey, loadCertificates, node, pushFlash, t]);

  const deleteCertificate = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setDeleteLoading(true);
      setCertsError(null);

      await fetchProxmox(`/api/proxmox/nodes/${node}/certificates/custom`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.certificateDeleted"),
        dismissible: true,
        id: "node-certificate-deleted",
      });

      setDeleteModalVisible(false);
      await loadCertificates();
    } catch (deleteError) {
      setCertsError(deleteError instanceof Error ? deleteError.message : t("nodeDetail.failedToDeleteCertificate"));
    } finally {
      setDeleteLoading(false);
    }
  }, [loadCertificates, node, pushFlash, t]);

  const activateSubscription = useCallback(async () => {
    if (!node) {
      return;
    }

    const key = subscriptionKey.trim();
    if (!key) {
      setSubscriptionError(t("nodeDetail.subscriptionKeyPlaceholder"));
      return;
    }

    try {
      setActivatingSubscription(true);
      setSubscriptionError(null);

      const body = new URLSearchParams({ key });

      await fetchProxmox(`/api/proxmox/nodes/${node}/subscription`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.subscriptionActivated"),
        dismissible: true,
        id: "node-subscription-activated",
      });

      setSubscriptionKey("");
      await loadSubscription();
    } catch (activationError) {
      setSubscriptionError(activationError instanceof Error ? activationError.message : t("nodeDetail.failedToActivateSubscription"));
    } finally {
      setActivatingSubscription(false);
    }
  }, [loadSubscription, node, pushFlash, subscriptionKey, t]);

  const removeSubscription = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setRemovingSubscription(true);
      setSubscriptionError(null);

      await fetchProxmox(`/api/proxmox/nodes/${node}/subscription`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.subscriptionRemoved"),
        dismissible: true,
        id: "node-subscription-removed",
      });

      setRemoveSubscriptionModalVisible(false);
      await loadSubscription();
    } catch (removeError) {
      setSubscriptionError(removeError instanceof Error ? removeError.message : t("nodeDetail.failedToRemoveSubscription"));
    } finally {
      setRemovingSubscription(false);
    }
  }, [loadSubscription, node, pushFlash, t]);

  const saveFirewallRule = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setFwRuleSaving(true);
      setFwError(null);

      const body = new URLSearchParams({
        type: fwRuleForm.type.trim(), action: fwRuleForm.action.trim(), enable: String(fwRuleForm.enable),
      });
      setOptionalParameters(body, {
        macro: fwRuleForm.macro, proto: fwRuleForm.proto, source: fwRuleForm.source,
        dest: fwRuleForm.dest, dport: fwRuleForm.dport, sport: fwRuleForm.sport, comment: fwRuleForm.comment,
      }, fwRuleEditPos !== null);

      await fetchProxmox(
        fwRuleEditPos == null
          ? `/api/proxmox/nodes/${node}/firewall/rules`
          : `/api/proxmox/nodes/${node}/firewall/rules/${fwRuleEditPos}`,
        {
          method: fwRuleEditPos == null ? "POST" : "PUT",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );

      pushFlash({
        type: "success",
        content: t(fwRuleEditPos == null ? "nodeDetail.firewallRuleCreated" : "nodeDetail.firewallRuleUpdated"),
        dismissible: true,
        id: fwRuleEditPos == null ? "firewall-rule-created" : `firewall-rule-updated-${fwRuleEditPos}`,
      });

      setFwRuleModalVisible(false);
      await loadFirewallRules();
    } catch (saveError) {
      setFwError(saveError instanceof Error ? saveError.message : t(fwRuleEditPos == null ? "nodeDetail.failedToCreateFirewallRule" : "nodeDetail.failedToUpdateFirewallRule"));
    } finally {
      setFwRuleSaving(false);
    }
  }, [fwRuleEditPos, fwRuleForm, loadFirewallRules, node, pushFlash, t]);

  const saveFirewallOptions = useCallback(async () => {
    if (!node) {
      return;
    }

    try {
      setFwOptionsSaving(true);
      setFwError(null);

      const body = new URLSearchParams({
        enable: fwOptionsForm.enable.trim(),
        log_level_in: fwOptionsForm.log_level_in.trim(),
        log_level_out: fwOptionsForm.log_level_out.trim(),
        ndp: fwOptionsForm.ndp.trim(),
        smurf_log_level: fwOptionsForm.smurf_log_level.trim(),
        tcp_flags_log_level: fwOptionsForm.tcp_flags_log_level.trim(),
      });

      await fetchProxmox(`/api/proxmox/nodes/${node}/firewall/options`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.firewallOptionsUpdated"),
        dismissible: true,
        id: "firewall-options-updated",
      });

      setFwOptionsModalVisible(false);
      await loadFirewallOptions();
    } catch (saveError) {
      setFwError(saveError instanceof Error ? saveError.message : t("nodeDetail.failedToUpdateFirewallOptions"));
    } finally {
      setFwOptionsSaving(false);
    }
  }, [fwOptionsForm, loadFirewallOptions, node, pushFlash, t]);

  const deleteFirewallRule = useCallback(async () => {
    if (!node || fwDeletePos == null) {
      return;
    }

    try {
      setFwDeleting(true);
      setFwError(null);

      await fetchProxmox(`/api/proxmox/nodes/${node}/firewall/rules/${fwDeletePos}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams().toString(),
      });

      pushFlash({
        type: "success",
        content: t("nodeDetail.firewallRuleDeleted"),
        dismissible: true,
        id: `firewall-rule-deleted-${fwDeletePos}`,
      });

      setFwDeleteModalVisible(false);
      setFwDeletePos(null);
      await loadFirewallRules();
    } catch (deleteError) {
      setFwError(deleteError instanceof Error ? deleteError.message : t("nodeDetail.failedToDeleteFirewallRule"));
    } finally {
      setFwDeleting(false);
    }
  }, [fwDeletePos, loadFirewallRules, node, pushFlash, t]);

  const openSmartModal = useCallback(async (disk: PveNodeDisk) => {
    if (!node) {
      return;
    }

    try {
      setSelectedDisk(disk);
      setSmartModalVisible(true);
      setSmartLoading(true);
      setSmartData(null);
      setSmartError(null);

      const smart = await fetchProxmox<PveNodeDiskSmartData>(`/api/proxmox/nodes/${node}/disks/smart?disk=${encodeURIComponent(disk.devpath)}`);
      setSmartData(smart ?? null);
    } catch (fetchError) {
      setSmartError(fetchError instanceof Error ? fetchError.message : t("nodeDetail.failedToLoadSmart"));
    } finally {
      setSmartLoading(false);
    }
  }, [node, t]);

  const runDiskAction = useCallback(async (action: "initgpt" | "wipedisk") => {
    if (!node || !selectedDisk || diskActionLoading || diskConfirmation !== selectedDisk.devpath) {
      return;
    }

    try {
      setDiskActionLoading(true);
      setDisksError(null);

      const body = new URLSearchParams({ disk: selectedDisk.devpath });

      await fetchProxmox(`/api/proxmox/nodes/${node}/disks/${action}`, {
        method: action === "initgpt" ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      pushFlash({
        type: "success",
        content: t(action === "initgpt" ? "nodeDetail.initGptSuccess" : "nodeDetail.wipeDiskSuccess").replace("{device}", selectedDisk.devpath),
        dismissible: true,
        id: `disk-${action}-${selectedDisk.devpath}`,
      });

      setInitGptModalVisible(false);
      setWipeDiskModalVisible(false);
      await loadDisks();
    } catch (actionError) {
      setDisksError(
        actionError instanceof Error
          ? actionError.message
          : t(action === "initgpt" ? "nodeDetail.failedToInitGpt" : "nodeDetail.failedToWipeDisk"),
      );
    } finally {
      setDiskActionLoading(false);
    }
  }, [diskActionLoading, diskConfirmation, loadDisks, node, pushFlash, selectedDisk, t]);

  const networkColumns = useMemo<TableProps<PveNetwork>["columnDefinitions"]>(
    () => [
      {
        id: "iface",
        header: t("nodeDetail.interface"),
        cell: ({ iface }) => iface,
        isRowHeader: true,
      },
      {
        id: "type",
        header: t("nodeDetail.type"),
        cell: ({ type }) => type,
      },
      {
        id: "method",
        header: t("nodeDetail.method"),
        cell: ({ method, method6 }) => [method, method6].filter(Boolean).join(" / ") || "-",
      },
      {
        id: "address",
        header: t("nodeDetail.address"),
        cell: ({ cidr, address }) => cidr ?? address ?? "-",
      },
      {
        id: "gateway",
        header: t("nodeDetail.gateway"),
        cell: ({ gateway }) => gateway ?? "-",
      },
      {
        id: "active",
        header: t("nodeDetail.active"),
        cell: ({ active }) => (
          <StatusIndicator type={active ? "success" : "error"}>{active ? t("nodeDetail.active") : t("nodeDetail.inactive")}</StatusIndicator>
        ),
      },
    ],
    [t],
  );

  const storageColumns = useMemo<TableProps<PveStorage>["columnDefinitions"]>(
    () => [
      {
        id: "storage",
        header: t("nodeDetail.storage"),
        cell: ({ storage }) => storage,
        isRowHeader: true,
      },
      {
        id: "type",
        header: t("nodeDetail.type"),
        cell: ({ type }) => type,
      },
      {
        id: "content",
        header: t("nodeDetail.content"),
        cell: ({ content }) => content,
      },
      {
        id: "status",
        header: t("common.status"),
        cell: ({ status }) => status ?? "-",
      },
      {
        id: "usage",
        header: t("common.usage"),
        cell: ({ used, total }) => (
          <ProgressBar
            value={getUsagePercent(used, total)}
            additionalInfo={`${formatBytes(used ?? 0)} / ${formatBytes(total ?? 0)}`}
          />
        ),
      },
      {
        id: "capacity",
        header: t("nodeDetail.capacity"),
        cell: ({ total }) => formatBytes(total ?? 0),
      },
    ],
    [t],
  );

  const tasksColumns = useMemo<TableProps<PveTask>["columnDefinitions"]>(
    () => [
      {
        id: "starttime",
        header: t("nodeDetail.started"),
        cell: ({ starttime }) => formatDateTime(starttime),
        isRowHeader: true,
      },
      {
        id: "endtime",
        header: t("nodeDetail.ended"),
        cell: ({ endtime }) => formatDateTime(endtime),
      },
      {
        id: "type",
        header: t("nodeDetail.task"),
        cell: ({ type, id }) => id ? `${type} · ${id}` : type,
      },
      {
        id: "user",
        header: t("nodeDetail.user"),
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

  const syslogColumns = useMemo<TableProps<PveNodeSyslogEntry>["columnDefinitions"]>(
    () => [
      {
        id: "n",
        header: t("nodeDetail.lineNumber"),
        cell: ({ n }) => String(n),
        isRowHeader: true,
        minWidth: 100,
      },
      {
        id: "t",
        header: t("nodeDetail.message"),
        cell: ({ t: message }) => message,
      },
    ],
    [t],
  );

  const servicesColumns = useMemo<TableProps<PveNodeService>["columnDefinitions"]>(
    () => [
      {
        id: "service",
        header: t("nodeDetail.serviceName"),
        cell: ({ service }) => service,
        isRowHeader: true,
      },
      {
        id: "desc",
        header: t("nodeDetail.serviceDescription"),
        cell: ({ desc, name }) => desc ?? name ?? "-",
      },
      {
        id: "state",
        header: t("nodeDetail.serviceState"),
        cell: ({ state }) => <StatusIndicator type={getServiceStateType(state)}>{state ?? "-"}</StatusIndicator>,
      },
      {
        id: "active-state",
        header: t("nodeDetail.activeState"),
        cell: (item) => item["active-state"] ?? "-",
      },
      {
        id: "unit-state",
        header: t("nodeDetail.unitState"),
        cell: (item) => item["unit-state"] ?? "-",
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: ({ service }) => {
          const loadingAction = serviceActionLoading[service];
          return (
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="inline-link" loading={loadingAction === "start"} disabled={!!loadingAction} onClick={() => void runServiceAction(service, "start")}>
                {t("nodeDetail.startService")}
              </Button>
              <Button variant="inline-link" loading={loadingAction === "stop"} disabled={!!loadingAction} onClick={() => void runServiceAction(service, "stop")}>
                {t("nodeDetail.stopService")}
              </Button>
              <Button variant="inline-link" loading={loadingAction === "restart"} disabled={!!loadingAction} onClick={() => void runServiceAction(service, "restart")}>
                {t("nodeDetail.restartService")}
              </Button>
            </SpaceBetween>
          );
        },
      },
    ],
    [runServiceAction, serviceActionLoading, t],
  );

  const packagesColumns = useMemo<TableProps<PveNodePackage>["columnDefinitions"]>(
    () => [
      {
        id: "Package",
        header: t("nodeDetail.packageName"),
        cell: ({ Package: packageName }) => packageName,
        isRowHeader: true,
      },
      {
        id: "OldVersion",
        header: t("nodeDetail.currentVersion"),
        cell: ({ OldVersion }) => OldVersion ?? "-",
      },
      {
        id: "Version",
        header: t("nodeDetail.availableVersion"),
        cell: ({ Version }) => Version ?? "-",
      },
      {
        id: "Section",
        header: t("nodeDetail.packageSection"),
        cell: ({ Section }) => Section ?? "-",
      },
      {
        id: "Arch",
        header: t("nodeDetail.packageArch"),
        cell: ({ Arch }) => Arch ?? "-",
      },
      {
        id: "Origin",
        header: t("nodeDetail.packageOrigin"),
        cell: ({ Origin }) => Origin ?? "-",
      },
    ],
    [t],
  );

  const certificatesColumns = useMemo<TableProps<PveNodeCertificate>["columnDefinitions"]>(
    () => [
      {
        id: "filename",
        header: t("nodeDetail.certificateFileName"),
        cell: ({ filename }) => filename,
        isRowHeader: true,
      },
      {
        id: "subject",
        header: t("nodeDetail.certificateSubject"),
        cell: ({ subject }) => subject ?? "-",
      },
      {
        id: "issuer",
        header: t("nodeDetail.certificateIssuer"),
        cell: ({ issuer }) => issuer ?? "-",
      },
      {
        id: "notbefore",
        header: t("nodeDetail.certificateNotBefore"),
        cell: ({ notbefore }) => formatDateTime(notbefore),
      },
      {
        id: "notafter",
        header: t("nodeDetail.certificateNotAfter"),
        cell: ({ notafter }) => formatDateTime(notafter),
      },
      {
        id: "fingerprint",
        header: t("nodeDetail.certificateFingerprint"),
        cell: ({ fingerprint }) => fingerprint ?? "-",
      },
    ],
    [t],
  );

  const disksColumns = useMemo<TableProps<PveNodeDisk>["columnDefinitions"]>(
    () => [
      {
        id: "devpath",
        header: t("nodeDetail.diskDevice"),
        cell: ({ devpath }) => devpath,
        isRowHeader: true,
      },
      {
        id: "size",
        header: t("nodeDetail.diskSize"),
        cell: ({ size }) => formatBytes(size ?? 0),
      },
      {
        id: "type",
        header: t("nodeDetail.diskType"),
        cell: ({ type }) => type ?? "-",
      },
      {
        id: "vendor",
        header: t("nodeDetail.diskVendor"),
        cell: ({ vendor }) => vendor ?? "-",
      },
      {
        id: "model",
        header: t("nodeDetail.diskModel"),
        cell: ({ model }) => model ?? "-",
      },
      {
        id: "serial",
        header: t("nodeDetail.diskSerial"),
        cell: ({ serial }) => serial ?? "-",
      },
      {
        id: "wearout",
        header: t("nodeDetail.diskWearout"),
        cell: ({ wearout }) => wearout != null ? String(wearout) : "-",
      },
      {
        id: "health",
        header: t("nodeDetail.diskHealth"),
        cell: ({ health }) => <StatusIndicator type={getHealthStateType(health)}>{health ?? "-"}</StatusIndicator>,
      },
      {
        id: "gpt",
        header: t("nodeDetail.diskGpt"),
        cell: ({ gpt }) => (isTruthyDiskFlag(gpt) ? t("common.yes") : t("common.no")),
      },
      {
        id: "used",
        header: t("nodeDetail.diskUsedBy"),
        cell: ({ used }) => used ?? "-",
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (disk) => (
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="inline-link" onClick={() => void openSmartModal(disk)}>{t("nodeDetail.viewSmart")}</Button>
            <Button variant="inline-link" onClick={() => {
              setSelectedDisk(disk);
              setDiskConfirmation("");
              setDisksError(null);
              setInitGptModalVisible(true);
            }}>{t("nodeDetail.initGpt")}</Button>
            <Button variant="inline-link" onClick={() => {
              setSelectedDisk(disk);
              setDiskConfirmation("");
              setDisksError(null);
              setWipeDiskModalVisible(true);
            }}>{t("nodeDetail.wipeDisk")}</Button>
          </SpaceBetween>
        ),
      },
    ],
    [openSmartModal, t],
  );

  const smartColumns = useMemo<TableProps<PveNodeDiskSmartAttribute>["columnDefinitions"]>(
    () => [
      {
        id: "id",
        header: t("nodeDetail.smartId"),
        cell: ({ id }) => id != null ? String(id) : "-",
        isRowHeader: true,
      },
      {
        id: "name",
        header: t("nodeDetail.smartAttribute"),
        cell: ({ name }) => name ?? "-",
      },
      {
        id: "value",
        header: t("nodeDetail.smartValue"),
        cell: ({ value }) => value != null ? String(value) : "-",
      },
      {
        id: "worst",
        header: t("nodeDetail.smartWorst"),
        cell: ({ worst }) => worst != null ? String(worst) : "-",
      },
      {
        id: "thresh",
        header: t("nodeDetail.smartThreshold"),
        cell: ({ thresh }) => thresh != null ? String(thresh) : "-",
      },
      {
        id: "raw",
        header: t("nodeDetail.smartRaw"),
        cell: ({ raw }) => raw != null ? String(raw) : "-",
      },
    ],
    [t],
  );

  const firewallRulesColumns = useMemo<TableProps<PveNodeFirewallRule>["columnDefinitions"]>(
    () => [
      {
        id: "pos",
        header: t("nodeDetail.firewallPosition"),
        cell: ({ pos }) => pos != null ? String(pos) : "-",
        isRowHeader: true,
      },
      {
        id: "type",
        header: t("nodeDetail.firewallType"),
        cell: ({ type }) => type ?? "-",
      },
      {
        id: "action",
        header: t("nodeDetail.firewallAction"),
        cell: ({ action }) => action ?? "-",
      },
      {
        id: "macro",
        header: t("nodeDetail.firewallMacro"),
        cell: ({ macro }) => macro ?? "-",
      },
      {
        id: "proto",
        header: t("nodeDetail.firewallProtocol"),
        cell: ({ proto }) => proto ?? "-",
      },
      {
        id: "source",
        header: t("nodeDetail.firewallSource"),
        cell: ({ source }) => source ?? "-",
      },
      {
        id: "dest",
        header: t("nodeDetail.firewallDest"),
        cell: ({ dest }) => dest ?? "-",
      },
      {
        id: "dport",
        header: t("nodeDetail.firewallDport"),
        cell: ({ dport }) => dport ?? "-",
      },
      {
        id: "sport",
        header: t("nodeDetail.firewallSport"),
        cell: ({ sport }) => sport ?? "-",
      },
      {
        id: "comment",
        header: t("nodeDetail.firewallComment"),
        cell: ({ comment }) => comment ?? "-",
      },
      {
        id: "enable",
        header: t("nodeDetail.firewallEnabled"),
        cell: ({ enable }) => enable ? t("common.yes") : t("common.no"),
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (rule) => (
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="inline-link" onClick={() => openFirewallRuleModal(rule)}>{t("common.edit")}</Button>
            <Button variant="inline-link" onClick={() => {
              setFwDeletePos(rule.pos ?? null);
              setFwError(null);
              setFwDeleteModalVisible(true);
            }}>{t("common.delete")}</Button>
          </SpaceBetween>
        ),
      },
    ],
    [openFirewallRuleModal, t],
  );

  const firewallLogColumns = useMemo<TableProps<PveNodeFirewallLogEntry>["columnDefinitions"]>(
    () => [
      {
        id: "n",
        header: t("nodeDetail.lineNumber"),
        cell: ({ n }) => n != null ? String(n) : "-",
        isRowHeader: true,
      },
      {
        id: "t",
        header: t("nodeDetail.firewallLogEntry"),
        cell: ({ t: message }) => message ?? "-",
      },
    ],
    [t],
  );

  const pciColumns = useMemo<TableProps<PveNodePciDevice>["columnDefinitions"]>(
    () => [
      {
        id: "id",
        header: t("nodeDetail.pciId"),
        cell: ({ id }) => id ?? "-",
        isRowHeader: true,
      },
      {
        id: "class",
        header: t("nodeDetail.pciClass"),
        cell: ({ class: pciClass }) => pciClass ?? "-",
      },
      {
        id: "vendor_name",
        header: t("nodeDetail.pciVendorName"),
        cell: ({ vendor_name, vendor }) => vendor_name ?? vendor ?? "-",
      },
      {
        id: "device_name",
        header: t("nodeDetail.pciDeviceName"),
        cell: ({ device_name, device }) => device_name ?? device ?? "-",
      },
      {
        id: "subsystem",
        header: t("nodeDetail.pciSubsystemId"),
        cell: ({ subsystem_vendor, subsystem_device }) => {
          const subsystem = [subsystem_vendor, subsystem_device].filter(Boolean).join(":");
          return subsystem || "-";
        },
      },
      {
        id: "iommugroup",
        header: t("nodeDetail.pciIommuGroup"),
        cell: ({ iommugroup }) => iommugroup != null ? String(iommugroup) : "-",
      },
      {
        id: "mdev",
        header: t("nodeDetail.pciMdev"),
        cell: ({ mdev }) => mdev ? t("common.yes") : t("common.no"),
      },
    ],
    [t],
  );

  const usbColumns = useMemo<TableProps<PveNodeUsbDevice>["columnDefinitions"]>(
    () => [
      {
        id: "busnum",
        header: t("nodeDetail.usbBus"),
        cell: ({ busnum }) => busnum != null ? String(busnum) : "-",
        isRowHeader: true,
      },
      {
        id: "devnum",
        header: t("nodeDetail.usbDev"),
        cell: ({ devnum }) => devnum != null ? String(devnum) : "-",
      },
      {
        id: "vendid",
        header: t("nodeDetail.usbVendorId"),
        cell: ({ vendid }) => vendid ?? "-",
      },
      {
        id: "prodid",
        header: t("nodeDetail.usbProductId"),
        cell: ({ prodid }) => prodid ?? "-",
      },
      {
        id: "manufacturer",
        header: t("nodeDetail.usbManufacturer"),
        cell: ({ manufacturer }) => manufacturer ?? "-",
      },
      {
        id: "product",
        header: t("nodeDetail.usbProduct"),
        cell: ({ product }) => product ?? "-",
      },
      {
        id: "speed",
        header: t("nodeDetail.usbSpeed"),
        cell: ({ speed }) => speed ?? "-",
      },
      {
        id: "serial",
        header: t("nodeDetail.usbSerial"),
        cell: ({ serial }) => serial ?? "-",
      },
    ],
    [t],
  );

  const syslogEmptyState = (
    <Box textAlign="center" color="text-body-secondary" padding="xxl">
      {t("nodeDetail.noSyslogEntries")}
    </Box>
  );

  const syslogNoMatch = (
    <Box textAlign="center" color="text-body-secondary" padding="xxl">
      {t("common.noMatches")}
    </Box>
  );

  const {
    actions: syslogActions,
    items: filteredSyslogItems,
    collectionProps: syslogCollectionProps,
    filterProps: syslogFilterProps,
    filteredItemsCount: filteredSyslogCount,
    paginationProps: syslogPaginationProps,
  } = useCollection(syslogEntries, {
    filtering: {
      filteringFunction: ({ n, t: message }, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [String(n), message].some((value) => value.toLowerCase().includes(query));
      },
      empty: syslogEmptyState,
      noMatch: syslogNoMatch,
    },
    pagination: {
      pageSize: 50,
    },
  });

  const syslogHeaderCounter = syslogFilterProps.filteringText
    ? `(${filteredSyslogCount ?? syslogEntries.length}/${syslogEntries.length})`
    : `(${syslogEntries.length})`;

  if (!node) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{t("nodeDetail.invalidNode")}</Header>
        <Alert type="error" header={t("nodeDetail.invalidNode")}>
          {t("nodeDetail.nodeMissing")}
        </Alert>
      </SpaceBetween>
    );
  }

  if (loading) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{node}</Header>
        <Box textAlign="center" padding={{ top: "xxxl" }}>
          <Spinner size="large" />
        </Box>
      </SpaceBetween>
    );
  }

  if (error || !data) {
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{node}</Header>
        <Alert type="error" header={t("nodeDetail.failedToLoad")}>
          {error ?? t("nodeDetail.unknownError")}
        </Alert>
      </SpaceBetween>
    );
  }

  const st = data.status;
  const summaryItems = [
    {
      label: t("common.status"),
      value: <StatusIndicator type={st.status === "online" || st.cpu !== undefined ? "success" : "error"}>{st.status ?? t("common.online")}</StatusIndicator>,
    },
    {
      label: t("nodeDetail.cpuUsage"),
      value: `${((st.cpu ?? 0) * 100).toFixed(1)}%`,
    },
    {
      label: t("nodeDetail.cpuCores"),
      value: String(st.cpuinfo?.cpus ?? st.cpuinfo?.cores ?? "-"),
    },
    {
      label: t("nodeDetail.memory"),
      value: `${formatBytes(st.memory?.used ?? 0)} / ${formatBytes(st.memory?.total ?? 0)}`,
    },
    {
      label: t("nodeDetail.disk"),
      value: `${formatBytes(st.rootfs?.used ?? 0)} / ${formatBytes(st.rootfs?.total ?? 0)}`,
    },
    {
      label: t("nodeDetail.uptime"),
      value: formatUptime(st.uptime ?? 0),
    },
    {
      label: t("nodeDetail.loadAverage"),
      value: (() => {
        const la = st.loadavg;
        if (la == null) return "-";
        if (Array.isArray(la)) return la.map((v: number) => Number(v).toFixed(2)).join(" / ");
        return String(la);
      })(),
    },
  ];

  const cpuSeries = data.rrd.map((point) => ({
    x: new Date(point.time * 1000),
    y: Math.round((point.cpu ?? 0) * 1000) / 10,
  }));

  const memorySeries = data.rrd.map((point) => ({
    x: new Date(point.time * 1000),
    y: point.memtotal ? Math.round(((point.memused ?? 0) / point.memtotal) * 1000) / 10 : 0,
  }));

  const systemItems = [
    {
      label: t("nodeDetail.cpuModel"),
      value: st.cpuinfo?.model ?? "-",
    },
    {
      label: t("nodeDetail.cpuSockets"),
      value: String(st.cpuinfo?.sockets ?? "-"),
    },
    {
      label: t("nodeDetail.cpuCoresLabel"),
      value: String(st.cpuinfo?.cores ?? "-"),
    },
    {
      label: t("nodeDetail.totalCpus"),
      value: String(st.cpuinfo?.cpus ?? "-"),
    },
    {
      label: t("nodeDetail.kernelVersion"),
      value: st.kversion ?? "-",
    },
    {
      label: t("nodeDetail.pveVersion"),
      value: st.pveversion ?? "-",
    },
    {
      label: t("nodeDetail.bootMode"),
      value: getBootMode(st),
    },
  ];

  const dnsItems = [
    {
      label: t("nodeDetail.searchDomain"),
      value: dnsConfig?.search ?? "-",
    },
    {
      label: t("nodeDetail.dnsServer1"),
      value: dnsConfig?.dns1 ?? "-",
    },
    {
      label: t("nodeDetail.dnsServer2"),
      value: dnsConfig?.dns2 ?? "-",
    },
    {
      label: t("nodeDetail.dnsServer3"),
      value: dnsConfig?.dns3 ?? "-",
    },
  ];

  const timeItems = [
    {
      label: t("nodeDetail.timezone"),
      value: timeConfig?.timezone ?? "-",
    },
    {
      label: t("nodeDetail.localTime"),
      value: formatDateTime(timeConfig?.localtime),
    },
    {
      label: t("nodeDetail.utcTime"),
      value: formatDateTime(timeConfig?.time),
    },
  ];

  const smartItems = [
    {
      label: t("nodeDetail.smartStatus"),
      value: smartData?.health ? (
        <StatusIndicator type={getHealthStateType(smartData.health)}>
          {smartData.health.toLowerCase() === "passed" ? t("nodeDetail.smartPassed") : smartData.health.toLowerCase() === "failed" ? t("nodeDetail.smartFailed") : smartData.health}
        </StatusIndicator>
      ) : "-",
    },
    {
      label: t("nodeDetail.diskType"),
      value: smartData?.type ?? "-",
    },
  ];

  const subscriptionItems = [
    {
      label: t("nodeDetail.subscriptionStatus"),
      value: subscriptionData?.status ? (
        <StatusIndicator type={subscriptionData.status === "Active" ? "success" : "error"}>
          {subscriptionData.status === "Active" ? t("nodeDetail.subscriptionActive") : t("nodeDetail.subscriptionInactive")}
        </StatusIndicator>
      ) : "-",
    },
    {
      label: t("nodeDetail.subscriptionKey"),
      value: subscriptionData?.key ?? "-",
    },
    {
      label: t("nodeDetail.subscriptionLevel"),
      value: subscriptionData?.level ?? "-",
    },
    {
      label: t("nodeDetail.subscriptionProduct"),
      value: subscriptionData?.productname ?? "-",
    },
    {
      label: t("nodeDetail.subscriptionSocket"),
      value: subscriptionData?.sockets != null ? String(subscriptionData.sockets) : "-",
    },
    {
      label: t("nodeDetail.subscriptionExpiry"),
      value: subscriptionData?.next ?? "-",
    },
    {
      label: t("nodeDetail.subscriptionUrl"),
      value: subscriptionData?.url ?? "-",
    },
    {
      label: t("nodeDetail.subscriptionMessage"),
      value: subscriptionData?.message ?? "-",
    },
  ];

  const firewallOptionsItems = [
    {
      label: t("nodeDetail.firewallEnable"),
      value: firewallOptions?.enable ? t("common.yes") : t("common.no"),
    },
    {
      label: t("nodeDetail.firewallTcpFlagsLogLevel"),
      value: firewallOptions?.tcp_flags_log_level ?? "-",
    },
    {
      label: t("nodeDetail.firewallLogLevelIn"),
      value: firewallOptions?.log_level_in ?? "-",
    },
    {
      label: t("nodeDetail.firewallLogLevelOut"),
      value: firewallOptions?.log_level_out ?? "-",
    },
    {
      label: t("nodeDetail.firewallNdp"),
      value: firewallOptions?.ndp ? t("common.yes") : t("common.no"),
    },
    {
      label: t("nodeDetail.firewallLogSmurfs"),
      value: firewallOptions?.smurf_log_level ?? "nolog",
    },
  ];

  const tabs: TabsProps.Tab[] = [
    {
      id: "summary",
      label: t("nodes.summary"),
      content: (
        <SpaceBetween size="l">
          <ColumnLayout columns={1}>
            <KeyValuePairs columns={3} items={summaryItems} />
          </ColumnLayout>
          <SpaceBetween size="s">
            <Header variant="h2">{t("nodeDetail.cpuAndMemoryUsage")}</Header>
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
              xDomain={cpuSeries.length > 1 ? [cpuSeries[0].x, cpuSeries[cpuSeries.length - 1].x] : undefined}
              i18nStrings={{
                xTickFormatter: (value) => (value as Date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                yTickFormatter: (value) => `${value}%`,
              }}
              ariaLabel={`CPU and memory usage for ${node}`}
              empty={<Box textAlign="center" color="text-body-secondary">{t("nodeDetail.noPerformanceData")}</Box>}
            />
          </SpaceBetween>
        </SpaceBetween>
      ),
    },
    {
      id: "system",
      label: t("nodeDetail.system"),
      content: systemItems.some((item) => item.value !== "-") ? (
        <ColumnLayout columns={1}>
          <KeyValuePairs columns={3} items={systemItems} />
        </ColumnLayout>
      ) : (
        <Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noSystemInfo")}</Box>
      ),
    },
    {
      id: "dns",
      label: t("nodeDetail.dns"),
      content: (
        <SpaceBetween size="m">
          {dnsError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadDns")}>{dnsError}</Alert>
          ) : null}
          {dnsLoading ? (
            <Box textAlign="center" padding={{ top: "xxxl" }}><Spinner size="large" /></Box>
          ) : (
            <ColumnLayout columns={1}>
              <KeyValuePairs columns={2} items={dnsItems} />
            </ColumnLayout>
          )}
          <Box>
            <Button onClick={openDnsModal} disabled={dnsLoading}>{t("nodeDetail.editDns")}</Button>
          </Box>
        </SpaceBetween>
      ),
    },
    {
      id: "time",
      label: t("nodeDetail.time"),
      content: (
        <SpaceBetween size="m">
          {timeError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadTime")}>{timeError}</Alert>
          ) : null}
          {timeLoading ? (
            <Box textAlign="center" padding={{ top: "xxxl" }}><Spinner size="large" /></Box>
          ) : (
            <ColumnLayout columns={1}>
              <KeyValuePairs columns={3} items={timeItems} />
            </ColumnLayout>
          )}
          <Box>
            <Button onClick={openTimeModal} disabled={timeLoading}>{t("nodeDetail.editTime")}</Button>
          </Box>
        </SpaceBetween>
      ),
    },
    {
      id: "syslog",
      label: t("nodeDetail.syslog"),
      content: (
        <SpaceBetween size="m">
          {syslogError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadSyslog")}>{syslogError}</Alert>
          ) : null}
          <Table<PveNodeSyslogEntry>
            {...syslogCollectionProps}
            items={filteredSyslogItems}
            trackBy={(item) => `${item.n}-${item.t}`}
            variant="full-page"
            loading={syslogLoading}
            loadingText={t("nodeDetail.syslogEntries")}
            columnDefinitions={syslogColumns}
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            empty={syslogFilterProps.filteringText ? syslogNoMatch : syslogEmptyState}
            header={
              <Header
                variant="h2"
                counter={syslogHeaderCounter}
                actions={<Button iconName="refresh" onClick={() => void loadSyslog()}>{t("common.refresh")}</Button>}
              >
                {t("nodeDetail.syslogEntries")}
              </Header>
            }
            filter={
              <TextFilter
                {...syslogFilterProps}
                filteringPlaceholder={t("nodeDetail.searchSyslog")}
                countText={`${filteredSyslogCount ?? syslogEntries.length} ${t("common.matches")}`}
              />
            }
            pagination={<Pagination {...syslogPaginationProps} />}
          />
        </SpaceBetween>
      ),
    },
    {
      id: "services",
      label: t("nodeDetail.services"),
      content: (
        <SpaceBetween size="m">
          {servicesError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadServices")}>{servicesError}</Alert>
          ) : null}
          <Table
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy="service"
            items={services}
            loading={servicesLoading}
            loadingText={t("nodeDetail.nodeServices")}
            columnDefinitions={servicesColumns}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noServices")}</Box>}
            header={
              <Header variant="h2" counter={`(${services.length})`} actions={<Button iconName="refresh" onClick={() => void loadServices()}>{t("common.refresh")}</Button>}>
                {t("nodeDetail.nodeServices")}
              </Header>
            }
          />
        </SpaceBetween>
      ),
    },
    {
      id: "hosts",
      label: t("nodeDetail.hosts"),
      content: (
        <SpaceBetween size="m">
          {hostsError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadHosts")}>{hostsError}</Alert>
          ) : null}
          {hostsLoading ? (
            <Box textAlign="center" padding={{ top: "xxxl" }}><Spinner size="large" /></Box>
          ) : (
            <FormField label={t("nodeDetail.hostsFile")}>
              <Textarea
                value={hostsData?.data ?? ""}
                readOnly
                rows={10}
                nativeTextareaAttributes={{ style: { fontFamily: "monospace" } }}
              />
            </FormField>
          )}
          <Box>
            <Button onClick={openHostsModal} disabled={hostsLoading || !hostsData}>{t("nodeDetail.editHosts")}</Button>
          </Box>
        </SpaceBetween>
      ),
    },
    {
      id: "packages",
      label: t("nodeDetail.packages"),
      content: (
        <SpaceBetween size="m">
          {packagesError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadPackages")}>{packagesError}</Alert>
          ) : null}
          <Table<PveNodePackage>
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy={(item) => `${item.Package}-${item.Version ?? item.OldVersion ?? ""}`}
            items={packages}
            loading={packagesLoading || updatingPackages}
            loadingText={updatingPackages ? t("nodeDetail.updatingPackageLists") : t("nodeDetail.packageUpdates")}
            columnDefinitions={packagesColumns}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noPackageUpdates")}</Box>}
            header={
              <Header
                variant="h2"
                counter={`(${packages.length})`}
                actions={<Button iconName="refresh" loading={updatingPackages} disabled={packagesLoading} onClick={() => void refreshPackageLists()}>{t("nodeDetail.updatePackageLists")}</Button>}
              >
                {t("nodeDetail.packageUpdates")}
              </Header>
            }
          />
        </SpaceBetween>
      ),
    },
    {
      id: "certificates",
      label: t("nodeDetail.certificates"),
      content: (
        <SpaceBetween size="m">
          {certsError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadCertificates")}>{certsError}</Alert>
          ) : null}
          <Box color="text-body-secondary">{t("nodeDetail.restartRequired")}</Box>
          <Table<PveNodeCertificate>
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy="filename"
            items={certificates}
            loading={certsLoading}
            loadingText={t("nodeDetail.certificateInfo")}
            columnDefinitions={certificatesColumns}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noCertificates")}</Box>}
            header={
              <Header
                variant="h2"
                counter={`(${certificates.length})`}
                actions={
                  <SpaceBetween size="xs" direction="horizontal">
                    <Button onClick={openUploadCertificateModal} disabled={certsLoading}>{t("nodeDetail.uploadCertificate")}</Button>
                    <Button onClick={() => {
                      setCertsError(null);
                      setDeleteModalVisible(true);
                    }} disabled={certsLoading}>{t("nodeDetail.deleteCertificate")}</Button>
                    <Button iconName="refresh" onClick={() => void loadCertificates()} disabled={certsLoading}>{t("common.refresh")}</Button>
                  </SpaceBetween>
                }
              >
                {t("nodeDetail.certificateInfo")}
              </Header>
            }
          />
        </SpaceBetween>
      ),
    },
    {
      id: "disks",
      label: t("nodeDetail.disks"),
      content: (
        <SpaceBetween size="m">
          {disksError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadDisks")}>{disksError}</Alert>
          ) : null}
          <Table<PveNodeDisk>
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy="devpath"
            items={disks}
            loading={disksLoading}
            loadingText={t("nodeDetail.diskList")}
            columnDefinitions={disksColumns}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noDisks")}</Box>}
            header={
              <Header variant="h2" counter={`(${disks.length})`} actions={<Button iconName="refresh" onClick={() => void loadDisks()}>{t("common.refresh")}</Button>}>
                {t("nodeDetail.diskList")}
              </Header>
            }
          />
        </SpaceBetween>
      ),
    },
    {
      id: "subscription",
      label: t("nodeDetail.subscription"),
      content: (
        <SpaceBetween size="m">
          {subscriptionError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadSubscription")}>{subscriptionError}</Alert>
          ) : null}
          {subscriptionLoading ? (
            <Box textAlign="center" padding={{ top: "xxxl" }}><Spinner size="large" /></Box>
          ) : subscriptionData ? (
            <ColumnLayout columns={1}>
              <KeyValuePairs columns={2} items={subscriptionItems} />
            </ColumnLayout>
          ) : (
            <Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noSubscription")}</Box>
          )}
          <SpaceBetween size="s">
            <Header variant="h2">{t("nodeDetail.activateSubscription")}</Header>
            <FormField label={t("nodeDetail.subscriptionKey")}>
              <Input
                value={subscriptionKey}
                placeholder={t("nodeDetail.subscriptionKeyPlaceholder")}
                onChange={({ detail }) => setSubscriptionKey(detail.value)}
              />
            </FormField>
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="primary" loading={activatingSubscription} onClick={() => void activateSubscription()}>
                {t("nodeDetail.activateSubscription")}
              </Button>
              <Button
                disabled={subscriptionLoading || (!subscriptionData?.key && !subscriptionData?.status)}
                onClick={() => {
                  setSubscriptionError(null);
                  setRemoveSubscriptionModalVisible(true);
                }}
              >
                {t("nodeDetail.removeSubscription")}
              </Button>
              <Button iconName="refresh" disabled={subscriptionLoading} onClick={() => void loadSubscription()}>{t("common.refresh")}</Button>
            </SpaceBetween>
          </SpaceBetween>
        </SpaceBetween>
      ),
    },
    {
      id: "firewall",
      label: t("nodeDetail.nodeFirewall"),
      content: (
        <SpaceBetween size="l">
          {fwError || fwLoadError ? (
            <Alert type="error" header={t("nodeDetail.nodeFirewall")}>{fwError || fwLoadError}</Alert>
          ) : null}
          <Table<PveNodeFirewallRule>
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy={({ pos, type }) => `${pos ?? type ?? "rule"}`}
            items={firewallRules}
            loading={fwRulesLoading}
            loadingText={t("nodeDetail.nodeFirewallRules")}
            columnDefinitions={firewallRulesColumns}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noFirewallRules")}</Box>}
            header={
              <Header
                variant="h2"
                counter={`(${firewallRules.length})`}
                actions={
                  <SpaceBetween size="xs" direction="horizontal">
                    <Button onClick={() => openFirewallRuleModal()}>{t("nodeDetail.addFirewallRule")}</Button>
                    <Button iconName="refresh" onClick={() => void loadFirewallRules()}>{t("common.refresh")}</Button>
                  </SpaceBetween>
                }
              >
                {t("nodeDetail.nodeFirewallRules")}
              </Header>
            }
          />
          <SpaceBetween size="m">
            <Header
              variant="h2"
              actions={<Button onClick={openFirewallOptionsModal}>{t("nodeDetail.editFirewallOptions")}</Button>}
            >
              {t("nodeDetail.nodeFirewallOptions")}
            </Header>
            <ColumnLayout columns={1}>
              <KeyValuePairs columns={2} items={firewallOptionsItems} />
            </ColumnLayout>
          </SpaceBetween>
          <Table<PveNodeFirewallLogEntry>
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy={({ n, t: message }) => `${n ?? 0}-${message ?? "log"}`}
            items={firewallLog}
            loading={fwLogLoading}
            loadingText={t("nodeDetail.nodeFirewallLog")}
            columnDefinitions={firewallLogColumns}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noFirewallLog")}</Box>}
            header={<Header variant="h2" counter={`(${firewallLog.length})`} actions={<Button iconName="refresh" onClick={() => void loadFirewallLog()}>{t("common.refresh")}</Button>}>{t("nodeDetail.nodeFirewallLog")}</Header>}
          />
        </SpaceBetween>
      ),
    },
    {
      id: "hardware",
      label: t("nodeDetail.hardware"),
      content: (
        <SpaceBetween size="l">
          {hwError ? (
            <Alert type="error" header={t("nodeDetail.hardware")}>{hwError}</Alert>
          ) : null}
          <Table<PveNodePciDevice>
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy="id"
            items={pciDevices}
            loading={pciLoading}
            loadingText={t("nodeDetail.pciDevices")}
            columnDefinitions={pciColumns}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noPciDevices")}</Box>}
            header={<Header variant="h2" counter={`(${pciDevices.length})`} actions={<Button iconName="refresh" onClick={() => void loadPciDevices()}>{t("common.refresh")}</Button>}>{t("nodeDetail.pciDevices")}</Header>}
          />
          <Table<PveNodeUsbDevice>
            variant="borderless"
            stickyHeader
            resizableColumns
            enableKeyboardNavigation
            trackBy={({ busnum, devnum, vendid, prodid }) => `${busnum ?? 0}-${devnum ?? 0}-${vendid ?? ""}-${prodid ?? ""}`}
            items={usbDevices}
            loading={usbLoading}
            loadingText={t("nodeDetail.usbDevices")}
            columnDefinitions={usbColumns}
            empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noUsbDevices")}</Box>}
            header={<Header variant="h2" counter={`(${usbDevices.length})`} actions={<Button iconName="refresh" onClick={() => void loadUsbDevices()}>{t("common.refresh")}</Button>}>{t("nodeDetail.usbDevices")}</Header>}
          />
        </SpaceBetween>
      ),
    },
    {
      id: "network",
      label: t("nodes.network"),
      content: (
        <Table
          variant="borderless"
          stickyHeader
          resizableColumns
          enableKeyboardNavigation
          trackBy="iface"
          items={data.network}
          columnDefinitions={networkColumns}
          empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noNetworkInterfaces")}</Box>}
          header={<Header variant="h2" counter={`(${data.network.length})`}>{t("nodeDetail.networkInterfaces")}</Header>}
        />
      ),
    },
    {
      id: "storage",
      label: t("nodeDetail.storage"),
      content: (
        <Table
          variant="borderless"
          stickyHeader
          resizableColumns
          enableKeyboardNavigation
          trackBy="storage"
          items={data.storage}
          columnDefinitions={storageColumns}
          empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noStorageAvailable")}</Box>}
          header={<Header variant="h2" counter={`(${data.storage.length})`}>{t("nodeDetail.storage")}</Header>}
        />
      ),
    },
    {
      id: "tasks",
      label: t("nodes.tasks"),
      content: (
        <Table
          variant="borderless"
          stickyHeader
          resizableColumns
          enableKeyboardNavigation
          trackBy="upid"
          items={data.tasks}
          columnDefinitions={tasksColumns}
          empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noRecentTasks")}</Box>}
          header={<Header variant="h2" counter={`(${data.tasks.length})`}>{t("logs.recentTasks")}</Header>}
        />
      ),
    },
  ];

  return (
    <SpaceBetween size="m">
      {flashbarItems.length > 0 ? <Flashbar items={flashbarItems.map((item) => ({ ...item, dismissLabel: item.dismissLabel ?? t("common.close"), onDismiss: item.onDismiss ?? (() => setFlashbarItems((current) => current.filter((entry) => entry !== item))) }))} /> : null}
      {actionError ? (
        <Alert type="error" header={t("common.error")} dismissible onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      ) : null}
      <Header
        variant="h1"
        actions={
          <SpaceBetween size="xs" direction="horizontal">
            <Button iconName="external" disabled={!!actionLoading} onClick={() => window.open(`/nodes/${node}/shell`, "_blank")}>
              {t("nodeDetail.shell")}
            </Button>
            <Button loading={actionLoading === "reboot"} disabled={!!actionLoading} onClick={() => setRebootModalVisible(true)}>
              {t("nodeDetail.reboot")}
            </Button>
            <Button loading={actionLoading === "shutdown"} disabled={!!actionLoading} onClick={() => setShutdownModalVisible(true)}>
              {t("nodeDetail.shutdown")}
            </Button>
            <Button
              iconName="refresh"
              disabled={loading || !!actionLoading}
              onClick={() => {
                void loadNode();
                if (activeTabId === "dns") {
                  void loadDns();
                }
                if (activeTabId === "time") {
                  void loadTime();
                }
                if (activeTabId === "syslog") {
                  syslogActions.setFiltering("");
                  void loadSyslog();
                }
                if (activeTabId === "services") {
                  void loadServices();
                }
                if (activeTabId === "hosts") {
                  void loadHosts();
                }
                if (activeTabId === "packages") {
                  void loadPackages();
                }
                if (activeTabId === "certificates") {
                  void loadCertificates();
                }
                if (activeTabId === "disks") {
                  void loadDisks();
                }
                if (activeTabId === "subscription") {
                  void loadSubscription();
                }
                if (activeTabId === "firewall") {
                  void loadFirewallRules();
                  void loadFirewallOptions();
                  void loadFirewallLog();
                }
                if (activeTabId === "hardware") {
                  void loadPciDevices();
                  void loadUsbDevices();
                }
              }}
            >
              {t("common.refresh")}
            </Button>
          </SpaceBetween>
        }
      >
        {data.status.node || node}
      </Header>
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
      />
      {rebootModalVisible && <Modal
        visible
        onDismiss={() => setRebootModalVisible(false)}
        header={t("nodeDetail.rebootNode")}
        closeAriaLabel={t("nodeDetail.rebootNode")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setRebootModalVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={actionLoading === "reboot"} onClick={() => void runNodeAction("reboot")}>
                {t("common.confirm")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Box>{t("nodeDetail.confirmReboot").replace("{node}", node)}</Box>
      </Modal>}
      {shutdownModalVisible && <Modal
        visible
        onDismiss={() => setShutdownModalVisible(false)}
        header={t("nodeDetail.shutdownNode")}
        closeAriaLabel={t("nodeDetail.shutdownNode")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setShutdownModalVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={actionLoading === "shutdown"} onClick={() => void runNodeAction("shutdown")}>
                {t("common.confirm")}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Box>{t("nodeDetail.confirmShutdown").replace("{node}", node)}</Box>
      </Modal>}
      {dnsModalVisible && <Modal
        visible
        onDismiss={() => {
          setDnsModalVisible(false);
          setDnsError(null);
        }}
        header={t("nodeDetail.editDns")}
        closeAriaLabel={t("nodeDetail.editDns")}
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
              <Button variant="primary" loading={dnsSaving} onClick={() => void saveDns()}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {dnsError ? (
            <Alert type="error" header={t("nodeDetail.failedToUpdateDns")}>{dnsError}</Alert>
          ) : null}
          <FormField label={t("nodeDetail.searchDomain")}>
            <Input
              value={dnsForm.search ?? ""}
              placeholder={t("nodeDetail.searchDomainPlaceholder")}
              onChange={({ detail }) => setDnsForm((current) => ({ ...current, search: detail.value }))}
            />
          </FormField>
          <FormField label={t("nodeDetail.dnsServer1")}>
            <Input
              value={dnsForm.dns1 ?? ""}
              placeholder={t("nodeDetail.dnsPlaceholder")}
              onChange={({ detail }) => setDnsForm((current) => ({ ...current, dns1: detail.value }))}
            />
          </FormField>
          <FormField label={t("nodeDetail.dnsServer2")}>
            <Input
              value={dnsForm.dns2 ?? ""}
              placeholder={t("nodeDetail.dnsPlaceholder")}
              onChange={({ detail }) => setDnsForm((current) => ({ ...current, dns2: detail.value }))}
            />
          </FormField>
          <FormField label={t("nodeDetail.dnsServer3")}>
            <Input
              value={dnsForm.dns3 ?? ""}
              placeholder={t("nodeDetail.dnsPlaceholder")}
              onChange={({ detail }) => setDnsForm((current) => ({ ...current, dns3: detail.value }))}
            />
          </FormField>
        </SpaceBetween>
      </Modal>}
      {timeModalVisible && <Modal
        visible
        onDismiss={() => {
          setTimeModalVisible(false);
          setTimeError(null);
        }}
        header={t("nodeDetail.editTime")}
        closeAriaLabel={t("nodeDetail.editTime")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setTimeModalVisible(false);
                  setTimeError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={timeSaving} onClick={() => void saveTime()}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {timeError ? (
            <Alert type="error" header={t("nodeDetail.failedToUpdateTime")}>{timeError}</Alert>
          ) : null}
          <FormField label={t("nodeDetail.timezone")}>
            <Input value={timezoneValue} placeholder={t("nodeDetail.timezonePlaceholder")} onChange={({ detail }) => setTimezoneValue(detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>}
      {hostsModalVisible && <Modal
        visible
        onDismiss={() => {
          setHostsModalVisible(false);
          setHostsError(null);
        }}
        header={t("nodeDetail.editHosts")}
        closeAriaLabel={t("nodeDetail.editHosts")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setHostsModalVisible(false);
                  setHostsError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={hostsSaving} onClick={() => void saveHosts()}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {hostsError ? (
            <Alert type="error" header={t("nodeDetail.failedToUpdateHosts")}>{hostsError}</Alert>
          ) : null}
          <FormField label={t("nodeDetail.hostsContent")}>
            <Textarea
              value={hostsFormContent}
              rows={12}
              onChange={({ detail }) => setHostsFormContent(detail.value)}
              nativeTextareaAttributes={{ style: { fontFamily: "monospace" } }}
            />
          </FormField>
        </SpaceBetween>
      </Modal>}
      {uploadModalVisible && <Modal
        visible
        onDismiss={() => {
          setUploadModalVisible(false);
          setCertsError(null);
        }}
        header={t("nodeDetail.uploadCertificate")}
        closeAriaLabel={t("nodeDetail.uploadCertificate")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setUploadModalVisible(false);
                  setCertsError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={uploadSaving} onClick={() => void uploadCertificate()}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {certsError ? (
            <Alert type="error" header={t("nodeDetail.failedToUploadCertificate")}>{certsError}</Alert>
          ) : null}
          <Alert type="info" header={t("nodeDetail.restartRequired")}>{t("nodeDetail.restartRequired")}</Alert>
          <FormField label={t("nodeDetail.certificateKey")}>
            <Textarea value={certKey} rows={8} placeholder={t("nodeDetail.certificateKeyPlaceholder")} onChange={({ detail }) => setCertKey(detail.value)} />
          </FormField>
          <FormField label={t("nodeDetail.certificateChain")}>
            <Textarea value={certChain} rows={8} placeholder={t("nodeDetail.certificateChainPlaceholder")} onChange={({ detail }) => setCertChain(detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>}
      {deleteModalVisible && <Modal
        visible
        onDismiss={() => {
          setDeleteModalVisible(false);
          setCertsError(null);
        }}
        header={t("nodeDetail.deleteCertificate")}
        closeAriaLabel={t("nodeDetail.deleteCertificate")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="link"
                onClick={() => {
                  setDeleteModalVisible(false);
                  setCertsError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={deleteLoading} onClick={() => void deleteCertificate()}>{t("common.confirm")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {certsError ? (
            <Alert type="error" header={t("nodeDetail.failedToDeleteCertificate")}>{certsError}</Alert>
          ) : null}
          <Box>{t("nodeDetail.confirmDeleteCertificate")}</Box>
          <Box color="text-body-secondary">{t("nodeDetail.restartRequired")}</Box>
        </SpaceBetween>
      </Modal>}
      {removeSubscriptionModalVisible && <Modal
        visible
        onDismiss={() => {
          setRemoveSubscriptionModalVisible(false);
          setSubscriptionError(null);
        }}
        header={t("nodeDetail.removeSubscription")}
        closeAriaLabel={t("nodeDetail.removeSubscription")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setRemoveSubscriptionModalVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={removingSubscription} onClick={() => void removeSubscription()}>{t("common.confirm")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {subscriptionError ? (
            <Alert type="error" header={t("nodeDetail.failedToRemoveSubscription")}>{subscriptionError}</Alert>
          ) : null}
          <Box>{t("nodeDetail.confirmRemoveSubscription")}</Box>
        </SpaceBetween>
      </Modal>}
      {fwRuleModalVisible && <Modal
        visible
        onDismiss={() => {
          setFwRuleModalVisible(false);
          setFwError(null);
        }}
        header={t(fwRuleEditPos == null ? "nodeDetail.addFirewallRule" : "nodeDetail.editFirewallRule")}
        closeAriaLabel={t(fwRuleEditPos == null ? "nodeDetail.addFirewallRule" : "nodeDetail.editFirewallRule")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setFwRuleModalVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={fwRuleSaving} onClick={() => void saveFirewallRule()}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {fwError ? (
            <Alert type="error" header={t(fwRuleEditPos == null ? "nodeDetail.failedToCreateFirewallRule" : "nodeDetail.failedToUpdateFirewallRule")}>{fwError}</Alert>
          ) : null}
          <FormField label={t("nodeDetail.firewallType")}>
            <Input value={fwRuleForm.type} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, type: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallAction")}>
            <Input value={fwRuleForm.action} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, action: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallMacro")}>
            <Input value={fwRuleForm.macro} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, macro: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallProtocol")}>
            <Input value={fwRuleForm.proto} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, proto: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallSource")}>
            <Input value={fwRuleForm.source} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, source: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallDest")}>
            <Input value={fwRuleForm.dest} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, dest: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallDport")}>
            <Input value={fwRuleForm.dport} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, dport: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallSport")}>
            <Input value={fwRuleForm.sport} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, sport: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallComment")}>
            <Textarea value={fwRuleForm.comment} rows={4} onChange={({ detail }) => setFwRuleForm((current) => ({ ...current, comment: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallEnabled")}>
            <Button onClick={() => setFwRuleForm((current) => ({ ...current, enable: current.enable ? 0 : 1 }))}>
              {fwRuleForm.enable ? t("common.yes") : t("common.no")}
            </Button>
          </FormField>
        </SpaceBetween>
      </Modal>}
      {fwOptionsModalVisible && <Modal
        visible
        onDismiss={() => {
          setFwOptionsModalVisible(false);
          setFwError(null);
        }}
        header={t("nodeDetail.editFirewallOptions")}
        closeAriaLabel={t("nodeDetail.editFirewallOptions")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setFwOptionsModalVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={fwOptionsSaving} onClick={() => void saveFirewallOptions()}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {fwError ? (
            <Alert type="error" header={t("nodeDetail.failedToUpdateFirewallOptions")}>{fwError}</Alert>
          ) : null}
          <FormField label={t("nodeDetail.firewallEnable")}>
            <Input value={fwOptionsForm.enable} onChange={({ detail }) => setFwOptionsForm((current) => ({ ...current, enable: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallLogLevelIn")}>
            <Input value={fwOptionsForm.log_level_in} onChange={({ detail }) => setFwOptionsForm((current) => ({ ...current, log_level_in: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallLogLevelOut")}>
            <Input value={fwOptionsForm.log_level_out} onChange={({ detail }) => setFwOptionsForm((current) => ({ ...current, log_level_out: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallNdp")}>
            <Input value={fwOptionsForm.ndp} onChange={({ detail }) => setFwOptionsForm((current) => ({ ...current, ndp: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallLogSmurfs")}>
            <Input value={fwOptionsForm.smurf_log_level} onChange={({ detail }) => setFwOptionsForm((current) => ({ ...current, smurf_log_level: detail.value }))} />
          </FormField>
          <FormField label={t("nodeDetail.firewallTcpFlagsLogLevel")}>
            <Input value={fwOptionsForm.tcp_flags_log_level} onChange={({ detail }) => setFwOptionsForm((current) => ({ ...current, tcp_flags_log_level: detail.value }))} />
          </FormField>
        </SpaceBetween>
      </Modal>}
      {fwDeleteModalVisible && <Modal
        visible
        onDismiss={() => {
          setFwDeleteModalVisible(false);
          setFwDeletePos(null);
          setFwError(null);
        }}
        header={t("nodeDetail.deleteFirewallRule")}
        closeAriaLabel={t("nodeDetail.deleteFirewallRule")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setFwDeleteModalVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={fwDeleting} onClick={() => void deleteFirewallRule()}>{t("common.confirm")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {fwError ? (
            <Alert type="error" header={t("nodeDetail.failedToDeleteFirewallRule")}>{fwError}</Alert>
          ) : null}
          <Box>{t("nodeDetail.deleteFirewallRuleConfirmation")}</Box>
        </SpaceBetween>
      </Modal>}
      {smartModalVisible && <Modal
        visible
        onDismiss={() => {
          setSmartModalVisible(false);
          setSmartError(null);
          setSmartData(null);
        }}
        header={selectedDisk ? `${t("nodeDetail.smartData")} · ${selectedDisk.devpath}` : t("nodeDetail.smartData")}
        closeAriaLabel={t("nodeDetail.smartData")}
        size="large"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => {
              setSmartModalVisible(false);
              setSmartError(null);
              setSmartData(null);
            }}>{t("common.cancel")}</Button>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {smartError ? (
            <Alert type="error" header={t("nodeDetail.failedToLoadSmart")}>{smartError}</Alert>
          ) : null}
          {smartLoading ? (
            <Box textAlign="center" padding={{ top: "xxxl" }}><Spinner size="large" /></Box>
          ) : (
            <>
              <ColumnLayout columns={1}>
                <KeyValuePairs columns={2} items={smartItems} />
              </ColumnLayout>
              <Table<PveNodeDiskSmartAttribute>
                variant="borderless"
                trackBy={({ id, name }) => `${id ?? name ?? "smart"}`}
                items={smartData?.attributes ?? []}
                columnDefinitions={smartColumns}
                empty={<Box textAlign="center" color="text-body-secondary" padding="xxl">{t("nodeDetail.noSmartData")}</Box>}
                header={<Header variant="h2" counter={`(${smartData?.attributes?.length ?? 0})`}>{t("nodeDetail.smartData")}</Header>}
              />
            </>
          )}
        </SpaceBetween>
      </Modal>}
      {initGptModalVisible && <Modal
        visible
        onDismiss={() => { if (!diskActionLoading) setInitGptModalVisible(false); }}
        header={t("nodeDetail.initGpt")}
        closeAriaLabel={t("nodeDetail.initGpt")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" disabled={diskActionLoading} onClick={() => setInitGptModalVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={diskActionLoading} disabled={!selectedDisk || diskConfirmation !== selectedDisk.devpath} onClick={() => void runDiskAction("initgpt")}>{t("common.confirm")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <Alert type="warning">{t("nodeDetail.confirmInitGpt")} {selectedDisk?.devpath}</Alert>
          <FormField label={language === "ko" ? "디스크 경로 확인" : "Confirm disk path"} description={language === "ko" ? `계속하려면 ${selectedDisk?.devpath}을(를) 입력하세요.` : `Enter ${selectedDisk?.devpath} to continue.`}>
            <Input value={diskConfirmation} disabled={diskActionLoading} onChange={({ detail }) => setDiskConfirmation(detail.value)} autoComplete="off" />
          </FormField>
          {Boolean(disksError) && <Alert type="error">{disksError}</Alert>}
        </SpaceBetween>
      </Modal>}
      {wipeDiskModalVisible && <Modal
        visible
        onDismiss={() => { if (!diskActionLoading) setWipeDiskModalVisible(false); }}
        header={t("nodeDetail.wipeDisk")}
        closeAriaLabel={t("nodeDetail.wipeDisk")}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" disabled={diskActionLoading} onClick={() => setWipeDiskModalVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={diskActionLoading} disabled={!selectedDisk || diskConfirmation !== selectedDisk.devpath} onClick={() => void runDiskAction("wipedisk")}>{t("common.confirm")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <Alert type="warning">{t("nodeDetail.confirmWipeDisk")} {selectedDisk?.devpath}</Alert>
          <FormField label={language === "ko" ? "디스크 경로 확인" : "Confirm disk path"} description={language === "ko" ? `계속하려면 ${selectedDisk?.devpath}을(를) 입력하세요.` : `Enter ${selectedDisk?.devpath} to continue.`}>
            <Input value={diskConfirmation} disabled={diskActionLoading} onChange={({ detail }) => setDiskConfirmation(detail.value)} autoComplete="off" />
          </FormField>
          {Boolean(disksError) && <Alert type="error">{disksError}</Alert>}
        </SpaceBetween>
      </Modal>}
    </SpaceBetween>
  );
}
