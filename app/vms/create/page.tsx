"use client";

import { requestResource } from "@/app/lib/resource-request";
import { isStorageActive, isValidVmid, isIntegerInRange } from "@/app/lib/resource-api";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Toggle from "@cloudscape-design/components/toggle";
import Wizard, { type WizardProps } from "@cloudscape-design/components/wizard";
import { useTranslation } from "@/app/lib/use-translation";

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

interface StorageContentItem {
  volid: string;
}

interface NetworkInterfaceSummary {
  iface: string;
  type: string;
}

interface ValidationResult {
  message: string;
  stepIndex: number;
}

const OS_TYPE_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "Linux", value: "l26" },
  { label: "Windows 11", value: "win11" },
  { label: "Windows 10", value: "win10" },
  { label: "Other", value: "other" },
];

const CPU_TYPE_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "Host (best performance)", value: "host" },
  { label: "x86-64-v2-AES", value: "x86-64-v2-AES" },
  { label: "x86-64-v3", value: "x86-64-v3" },
  { label: "Default (kvm64)", value: "kvm64" },
];

const SCSI_CONTROLLER_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "virtio-scsi-single", value: "virtio-scsi-single" },
  { label: "virtio-scsi-pci", value: "virtio-scsi-pci" },
  { label: "lsi", value: "lsi" },
];

const NETWORK_MODEL_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "virtio", value: "virtio" },
  { label: "e1000", value: "e1000" },
  { label: "rtl8139", value: "rtl8139" },
];

const BIOS_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "OVMF (UEFI)", value: "ovmf" },
  { label: "SeaBIOS", value: "seabios" },
];

const MACHINE_TYPE_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "q35 (recommended)", value: "q35" },
  { label: "i440fx", value: "i440fx" },
];

const VGA_TYPE_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "VirtIO-GPU (best performance)", value: "virtio" },
  { label: "Standard VGA", value: "std" },
  { label: "VMware compatible", value: "vmware" },
  { label: "QXL (SPICE)", value: "qxl" },
  { label: "Serial terminal", value: "serial0" },
  { label: "None", value: "none" },
];

const DISK_FORMAT_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "Raw (best performance)", value: "raw" },
  { label: "QCOW2", value: "qcow2" },
  { label: "VMDK", value: "vmdk" },
];

const DISK_CACHE_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "None (best performance)", value: "none" },
  { label: "Write back", value: "writeback" },
  { label: "Write through", value: "writethrough" },
  { label: "Direct sync", value: "directsync" },
  { label: "Unsafe (fastest, no safety)", value: "unsafe" },
];

const HUGEPAGES_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "None", value: "" },
  { label: "2 MB", value: "2" },
  { label: "1 GB", value: "1024" },
  { label: "Any", value: "any" },
];

const HOTPLUG_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "All (disk, network, usb, memory, cpu)", value: "disk,network,usb,memory,cpu" },
  { label: "Disk + Network", value: "disk,network" },
  { label: "None", value: "0" },
];

const AGENT_TYPE_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "VirtIO", value: "virtio" },
  { label: "ISA", value: "isa" },
];

async function fetchProxmox<T>(path: string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

function optionLabel(option: SelectProps.Option | null) {
  return option?.label ?? "-";
}

function optionValue(option: SelectProps.Option | null) {
  return option?.value ?? "";
}

function storageSupportsContent(storage: StorageSummary, contentType: string) {
  return isStorageActive(storage) && (storage.content ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .includes(contentType);
}

function boolToApiValue(value: boolean) {
  return value ? "1" : "0";
}

export default function CreateVirtualMachinePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nodeResourcesLoading, setNodeResourcesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const [vmName, setVmName] = useState("");
  const [vmId, setVmId] = useState("");
  const [nodeOptions, setNodeOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [selectedNode, setSelectedNode] = useState<SelectProps.Option | null>(null);
  const [selectedOsType, setSelectedOsType] = useState<SelectProps.Option | null>(OS_TYPE_OPTIONS[0] ?? null);
  const [isoOptions, setIsoOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [selectedIso, setSelectedIso] = useState<SelectProps.Option | null>(null);

  const [selectedBios, setSelectedBios] = useState<SelectProps.Option | null>(BIOS_OPTIONS[0] ?? null);
  const [selectedMachineType, setSelectedMachineType] = useState<SelectProps.Option | null>(
    MACHINE_TYPE_OPTIONS[0] ?? null,
  );
  const [selectedScsiController, setSelectedScsiController] = useState<SelectProps.Option | null>(
    SCSI_CONTROLLER_OPTIONS[0] ?? null,
  );
  const [efiDiskEnabled, setEfiDiskEnabled] = useState(true);
  const [tpmEnabled, setTpmEnabled] = useState(false);
  const [selectedVgaType, setSelectedVgaType] = useState<SelectProps.Option | null>(VGA_TYPE_OPTIONS[0] ?? null);

  const [cores, setCores] = useState("2");
  const [sockets, setSockets] = useState("1");
  const [selectedCpuType, setSelectedCpuType] = useState<SelectProps.Option | null>(CPU_TYPE_OPTIONS[0] ?? null);
  const [numaEnabled, setNumaEnabled] = useState(true);
  const [cpuFlagAes, setCpuFlagAes] = useState(false);
  const [cpuFlagPcid, setCpuFlagPcid] = useState(false);
  const [cpuFlagSpecCtrl, setCpuFlagSpecCtrl] = useState(false);
  const [cpuFlagIbpb, setCpuFlagIbpb] = useState(false);
  const [cpuFlagSsbd, setCpuFlagSsbd] = useState(false);
  const [cpuFlagMdClear, setCpuFlagMdClear] = useState(false);

  const [memory, setMemory] = useState("4096");
  const [ballooningEnabled, setBallooningEnabled] = useState(true);
  const [minimumMemory, setMinimumMemory] = useState("512");
  const [selectedHugepages, setSelectedHugepages] = useState<SelectProps.Option | null>(HUGEPAGES_OPTIONS[0] ?? null);

  const [diskSize, setDiskSize] = useState("32");
  const [storageOptions, setStorageOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [selectedStorage, setSelectedStorage] = useState<SelectProps.Option | null>(null);
  const [selectedDiskFormat, setSelectedDiskFormat] = useState<SelectProps.Option | null>(DISK_FORMAT_OPTIONS[0] ?? null);
  const [selectedDiskCache, setSelectedDiskCache] = useState<SelectProps.Option | null>(DISK_CACHE_OPTIONS[0] ?? null);
  const [ioThreadEnabled, setIoThreadEnabled] = useState(true);
  const [discardEnabled, setDiscardEnabled] = useState(true);
  const [ssdEmulationEnabled, setSsdEmulationEnabled] = useState(true);

  const [bridgeOptions, setBridgeOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [selectedBridge, setSelectedBridge] = useState<SelectProps.Option | null>(null);
  const [selectedNetworkModel, setSelectedNetworkModel] = useState<SelectProps.Option | null>(
    NETWORK_MODEL_OPTIONS[0] ?? null,
  );
  const [vlanTag, setVlanTag] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [firewallEnabled, setFirewallEnabled] = useState(true);
  const [mtu, setMtu] = useState("");
  const [multiqueue, setMultiqueue] = useState("");

  const [startOnBoot, setStartOnBoot] = useState(false);
  const [bootOrder, setBootOrder] = useState("order=scsi0;ide2;net0");
  const [qemuAgentEnabled, setQemuAgentEnabled] = useState(true);
  const [agentFstrimEnabled, setAgentFstrimEnabled] = useState(true);
  const [selectedAgentType, setSelectedAgentType] = useState<SelectProps.Option | null>(AGENT_TYPE_OPTIONS[0] ?? null);
  const [selectedHotplug, setSelectedHotplug] = useState<SelectProps.Option | null>(HOTPLUG_OPTIONS[0] ?? null);
  const [tabletDeviceEnabled, setTabletDeviceEnabled] = useState(true);
  const [useLocalTime, setUseLocalTime] = useState(false);
  const [protectionEnabled, setProtectionEnabled] = useState(false);
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");


  const yesNo = useCallback(
    (value: boolean) => (value ? t("common.yes") : t("common.no")),
    [t],
  );

  const cpuFlagsValue = useMemo(() => {
    const flags: string[] = [];

    if (cpuFlagAes) {
      flags.push("+aes");
    }
    if (cpuFlagPcid) {
      flags.push("+pcid");
    }
    if (cpuFlagSpecCtrl) {
      flags.push("+spec-ctrl");
    }
    if (cpuFlagIbpb) {
      flags.push("+ibpb");
    }
    if (cpuFlagSsbd) {
      flags.push("+ssbd");
    }
    if (cpuFlagMdClear) {
      flags.push("+md-clear");
    }

    return flags;
  }, [cpuFlagAes, cpuFlagIbpb, cpuFlagMdClear, cpuFlagPcid, cpuFlagSpecCtrl, cpuFlagSsbd]);

  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
      const [nodes, nextId] = await Promise.all([
        fetchProxmox<NodeSummary[]>("/api/proxmox/nodes"),
        fetchProxmox<number | string | ClusterNextId>("/api/proxmox/cluster/nextid"),
      ]);

      const onlineNodeOptions = (nodes ?? [])
        .filter((node) => node.status === "online")
        .map((node) => ({ label: node.node, value: node.node }))
        .sort((left, right) => optionLabel(left).localeCompare(optionLabel(right)));

      const normalizedNextId =
        typeof nextId === "object" && nextId !== null && "vmid" in nextId ? nextId.vmid : nextId;

      setNodeOptions(onlineNodeOptions);
      setVmId(normalizedNextId ? String(normalizedNextId) : "");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("vms.failedToLoadCreation"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    const node = optionValue(selectedNode);

    if (!node) return;

    let cancelled = false;

    const loadNodeResources = async () => {
      try {
        setNodeResourcesLoading(true);
        const storages = await fetchProxmox<StorageSummary[]>(`/api/proxmox/nodes/${node}/storage`);

        if (cancelled) {
          return;
        }

        const imageStorageOptions = (storages ?? [])
          .filter((storage) => storageSupportsContent(storage, "images"))
          .map((storage) => ({ label: storage.storage, value: storage.storage }))
          .sort((left, right) => optionLabel(left).localeCompare(optionLabel(right)));

        const isoStorages = (storages ?? []).filter((storage) => storageSupportsContent(storage, "iso"));

        const [isoGroups, networks] = await Promise.all([
          Promise.all(
            isoStorages.map(async (storage) => {
              try {
                return await fetchProxmox<StorageContentItem[]>(
                  `/api/proxmox/nodes/${node}/storage/${storage.storage}/content?content=iso`,
                );
              } catch {
                return [];
              }
            }),
          ),
          fetchProxmox<NetworkInterfaceSummary[]>(`/api/proxmox/nodes/${node}/network`),
        ]);

        if (cancelled) {
          return;
        }

        const isoMap = new Map<string, SelectProps.Option>();
        isoGroups.flat().forEach((item) => {
          if (item?.volid) {
            isoMap.set(item.volid, { label: item.volid, value: item.volid });
          }
        });

        const networkBridgeOptions = (networks ?? [])
          .filter((network) => network.type === "bridge" || network.type === "OVSBridge")
          .map((network) => ({ label: network.iface, value: network.iface }))
          .sort((left, right) => optionLabel(left).localeCompare(optionLabel(right)));

        const nextIsoOptions = Array.from(isoMap.values()).sort((left, right) =>
          optionLabel(left).localeCompare(optionLabel(right)),
        );

        setStorageOptions(imageStorageOptions);
        setSelectedStorage((current) =>
          current && imageStorageOptions.some((option) => option.value === current.value) ? current : null,
        );
        setIsoOptions(nextIsoOptions);
        setSelectedIso((current) => (current && isoMap.has(String(current.value)) ? current : null));
        setBridgeOptions(networkBridgeOptions);
        setSelectedBridge((current) =>
          current && networkBridgeOptions.some((option) => option.value === current.value) ? current : null,
        );
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t("vms.failedToLoadNodeResources"));
          setIsoOptions([]);
          setSelectedIso(null);
          setStorageOptions([]);
          setSelectedStorage(null);
          setBridgeOptions([]);
          setSelectedBridge(null);
        }
      } finally {
        if (!cancelled) {
          setNodeResourcesLoading(false);
        }
      }
    };

    void loadNodeResources();

    return () => {
      cancelled = true;
    };
  }, [selectedNode, t]);

  const validateForm = useCallback((): ValidationResult | null => {
    if (nodeResourcesLoading) return { message: "Wait for node resources to finish loading.", stepIndex: 0 };
    if (!vmName.trim()) {
      return { message: t("vms.vmNameRequired"), stepIndex: 0 };
    }
    if (!optionValue(selectedNode)) {
      return { message: t("vms.nodeRequired"), stepIndex: 0 };
    }
    if (!isValidVmid(vmId)) {
      return { message: t("vms.vmIdRequired"), stepIndex: 0 };
    }
    if (!optionValue(selectedStorage)) {
      return { message: t("vms.storageRequired"), stepIndex: 5 };
    }
    if (!optionValue(selectedBridge)) {
      return { message: t("vms.bridgeRequired"), stepIndex: 6 };
    }
    if (!isIntegerInRange(cores, 1) || !isIntegerInRange(sockets, 1)) {
      return { message: t("vms.coresSocketsMemoryError"), stepIndex: 3 };
    }
    if (!isIntegerInRange(memory, 16)) return { message: t("vms.coresSocketsMemoryError"), stepIndex: 4 };
    if (!Number.isFinite(Number(diskSize)) || Number(diskSize) <= 0) {
      return { message: t("vms.diskSizeError"), stepIndex: 5 };
    }
    if (ballooningEnabled && !isIntegerInRange(minimumMemory, 16, Number(memory))) {
      return { message: t("vms.minimumMemoryError"), stepIndex: 4 };
    }
    return null;
  }, [
    nodeResourcesLoading,
    ballooningEnabled,
    cores,
    diskSize,
    memory,
    minimumMemory,
    selectedBridge,
    selectedNode,
    selectedStorage,
    sockets,
    t,
    vmId,
    vmName,
  ]);

  const handleSubmit = useCallback(async () => {
    const validationResult = validateForm();

    if (validationResult) {
      setError(validationResult.message);
      setActiveStepIndex(validationResult.stepIndex);
      return;
    }

    const node = optionValue(selectedNode);
    const storage = optionValue(selectedStorage);
    const isoVolid = optionValue(selectedIso);
    const diskFormat = optionValue(selectedDiskFormat);
    const diskCache = optionValue(selectedDiskCache);
    const networkModel = optionValue(selectedNetworkModel);
    const bridge = optionValue(selectedBridge);
    const hugepages = optionValue(selectedHugepages);
    const agentType = optionValue(selectedAgentType);

    const cpuValue = cpuFlagsValue.length > 0
      ? `${optionValue(selectedCpuType)},flags=${cpuFlagsValue.join(";")}`
      : optionValue(selectedCpuType);

    const scsi0Segments = [
      `${storage}:${diskSize}`,
      `format=${diskFormat}`,
      `cache=${diskCache}`,
      `iothread=${boolToApiValue(ioThreadEnabled)}`,
      `discard=${discardEnabled ? "on" : "ignore"}`,
      `ssd=${boolToApiValue(ssdEmulationEnabled)}`,
    ];

    const net0Segments = [
      `model=${networkModel}`,
      `bridge=${bridge}`,
      `firewall=${boolToApiValue(firewallEnabled)}`,
    ];

    if (vlanTag.trim()) {
      net0Segments.push(`tag=${vlanTag.trim()}`);
    }
    if (macAddress.trim()) {
      net0Segments.push(`macaddr=${macAddress.trim()}`);
    }
    if (mtu.trim()) {
      net0Segments.push(`mtu=${mtu.trim()}`);
    }
    if (multiqueue.trim()) {
      net0Segments.push(`queues=${multiqueue.trim()}`);
    }

    const body = new URLSearchParams({
      vmid: vmId,
      name: vmName.trim(),
      memory,
      cores,
      sockets,
      cpu: cpuValue,
      ostype: optionValue(selectedOsType),
      scsihw: optionValue(selectedScsiController),
      bios: optionValue(selectedBios),
      machine: optionValue(selectedMachineType),
      scsi0: scsi0Segments.join(","),
      net0: net0Segments.join(","),
      vga: optionValue(selectedVgaType),
      agent: `${boolToApiValue(qemuAgentEnabled)},fstrim_cloned_disks=${boolToApiValue(agentFstrimEnabled)},type=${agentType}`,
      boot: bootOrder.trim() || "order=scsi0;ide2;net0",
      numa: boolToApiValue(numaEnabled),
      balloon: ballooningEnabled ? minimumMemory : "0",
      hotplug: optionValue(selectedHotplug),
      tablet: boolToApiValue(tabletDeviceEnabled),
      onboot: boolToApiValue(startOnBoot),
      protection: boolToApiValue(protectionEnabled),
      localtime: boolToApiValue(useLocalTime),
    });

    if (isoVolid) {
      body.set("ide2", `${isoVolid},media=cdrom`);
    } else {
      body.set("ide2", "none,media=cdrom");
    }
    if (optionValue(selectedVgaType) === "serial0") body.set("serial0", "socket");
    if (efiDiskEnabled) {
      body.set("efidisk0", `${storage}:1,format=${diskFormat},efitype=4m,pre-enrolled-keys=1`);
    }
    if (tpmEnabled) {
      body.set("tpmstate0", `${storage}:1,version=v2.0`);
    }
    if (hugepages) {
      body.set("hugepages", hugepages);
    }
    if (tags.trim()) {
      body.set("tags", tags.trim());
    }
    if (description.trim()) {
      body.set("description", description.trim());
    }

    try {
      setSubmitting(true);
      setError(null);

      await requestResource<string>(`/api/proxmox/nodes/${node}/qemu`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      setFlashbarItems([
        {
          type: "success",
          content: t("vms.vmCreated").replace("{name}", vmName.trim()),
          dismissible: true,
          id: "vm-create-success",
        },
      ]);

      router.push("/vms");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("vms.failedToCreate"));
    } finally {
      setSubmitting(false);
    }
  }, [
    agentFstrimEnabled,
    ballooningEnabled,
    bootOrder,
    cpuFlagsValue,
    description,
    cores,
    diskSize,
    discardEnabled,
    efiDiskEnabled,
    firewallEnabled,
    ioThreadEnabled,
    memory,
    minimumMemory,
    mtu,
    macAddress,
    multiqueue,
    numaEnabled,
    protectionEnabled,
    qemuAgentEnabled,
    router,
    selectedAgentType,
    selectedBios,
    selectedBridge,
    selectedCpuType,
    selectedDiskCache,
    selectedDiskFormat,
    selectedHotplug,
    selectedHugepages,
    selectedIso,
    selectedMachineType,
    selectedNetworkModel,
    selectedNode,
    selectedOsType,
    selectedScsiController,
    selectedStorage,
    selectedVgaType,
    sockets,
    ssdEmulationEnabled,
    startOnBoot,
    tags,
    tabletDeviceEnabled,
    t,
    tpmEnabled,
    useLocalTime,
    validateForm,
    vlanTag,
    vmId,
    vmName,
  ]);

  const reviewSections = useMemo(
    () => [
      {
        title: t("vms.instanceDetails"),
        stepIndex: 0,
        items: [
          { label: t("vms.vmName"), value: vmName || "-" },
          { label: t("vms.node"), value: optionLabel(selectedNode) },
          { label: t("vms.vmIdLabel"), value: vmId || "-" },
        ],
      },
      {
        title: t("vms.operatingSystem"),
        stepIndex: 1,
        items: [
          { label: t("vms.osType"), value: optionLabel(selectedOsType) },
          { label: t("vms.isoImageLabel"), value: optionLabel(selectedIso) },
        ],
      },
      {
        title: t("vms.systemSettings"),
        stepIndex: 2,
        items: [
          { label: t("vms.bios"), value: optionLabel(selectedBios) },
          { label: t("vms.machineType"), value: optionLabel(selectedMachineType) },
          { label: t("vms.scsiController"), value: optionLabel(selectedScsiController) },
          { label: t("vms.efiDisk"), value: yesNo(efiDiskEnabled) },
          { label: t("vms.tpm"), value: yesNo(tpmEnabled) },
          { label: t("vms.vgaType"), value: optionLabel(selectedVgaType) },
        ],
      },
      {
        title: t("vms.cpuSettings"),
        stepIndex: 3,
        items: [
          { label: t("vms.cpuCores"), value: cores },
          { label: t("vms.cpuSockets"), value: sockets },
          { label: t("vms.cpuType"), value: optionLabel(selectedCpuType) },
          { label: t("vms.numa"), value: yesNo(numaEnabled) },
          { label: t("vms.cpuFlags"), value: cpuFlagsValue.length > 0 ? cpuFlagsValue.join(", ") : "-" },
        ],
      },
      {
        title: t("vms.memorySettings"),
        stepIndex: 4,
        items: [
          { label: t("vms.memoryMb"), value: memory },
          { label: t("vms.ballooning"), value: yesNo(ballooningEnabled) },
          { label: t("vms.minimumMemory"), value: ballooningEnabled ? minimumMemory : "0" },
          { label: t("vms.hugepages"), value: optionLabel(selectedHugepages) },
        ],
      },
      {
        title: t("vms.storageAndNetwork"),
        stepIndex: 5,
        items: [
          { label: t("vms.diskSizeGb"), value: diskSize },
          { label: t("vms.storageLabel"), value: optionLabel(selectedStorage) },
          { label: t("vms.diskFormat"), value: optionLabel(selectedDiskFormat) },
          { label: t("vms.diskCache"), value: optionLabel(selectedDiskCache) },
          { label: t("vms.ioThread"), value: yesNo(ioThreadEnabled) },
          { label: t("vms.discard"), value: yesNo(discardEnabled) },
          { label: t("vms.ssdEmulation"), value: yesNo(ssdEmulationEnabled) },
          { label: t("vms.networkBridge"), value: optionLabel(selectedBridge) },
          { label: t("vms.networkModel"), value: optionLabel(selectedNetworkModel) },
          { label: t("vms.vlanTag"), value: vlanTag || "-" },
          { label: t("vms.macAddress"), value: macAddress || "-" },
          { label: t("vms.firewall"), value: yesNo(firewallEnabled) },
          { label: t("vms.mtu"), value: mtu || "-" },
          { label: t("vms.multiqueue"), value: multiqueue || "-" },
        ],
      },
      {
        title: t("vms.advancedOptions"),
        stepIndex: 6,
        items: [
          { label: t("vms.startOnBoot"), value: yesNo(startOnBoot) },
          { label: t("vms.bootOrder"), value: bootOrder || "-" },
          { label: t("vms.qemuAgent"), value: yesNo(qemuAgentEnabled) },
          { label: t("vms.agentFstrim"), value: yesNo(agentFstrimEnabled) },
          { label: t("vms.agentType"), value: optionLabel(selectedAgentType) },
          { label: t("vms.hotplug"), value: optionLabel(selectedHotplug) },
          { label: t("vms.tabletDevice"), value: yesNo(tabletDeviceEnabled) },
          { label: t("vms.useLocalTime"), value: yesNo(useLocalTime) },
          { label: t("vms.protection"), value: yesNo(protectionEnabled) },
          { label: t("vms.tags"), value: tags || "-" },
          { label: t("vms.descriptionLabel"), value: description || "-" },
        ],
      },
    ],
    [
      agentFstrimEnabled,
      ballooningEnabled,
      bootOrder,
      cores,
      cpuFlagsValue,
      description,
      diskSize,
      discardEnabled,
      efiDiskEnabled,
      firewallEnabled,
      ioThreadEnabled,
      macAddress,
      memory,
      minimumMemory,
      mtu,
      multiqueue,
      numaEnabled,
      protectionEnabled,
      qemuAgentEnabled,
      selectedAgentType,
      selectedBios,
      selectedBridge,
      selectedCpuType,
      selectedDiskCache,
      selectedDiskFormat,
      selectedHotplug,
      selectedHugepages,
      selectedIso,
      selectedMachineType,
      selectedNetworkModel,
      selectedNode,
      selectedOsType,
      selectedScsiController,
      selectedStorage,
      selectedVgaType,
      sockets,
      ssdEmulationEnabled,
      startOnBoot,
      tabletDeviceEnabled,
      tags,
      t,
      tpmEnabled,
      useLocalTime,
      vlanTag,
      vmId,
      vmName,
      yesNo,
    ],
  );

  const steps = useMemo<WizardProps.Step[]>(
    () => [
      {
        title: t("vms.generalStep"),
        content: (
          <Container header={<Header variant="h2">{t("vms.instanceDetails")}</Header>}>
            <SpaceBetween size="l">
              <FormField label={t("vms.vmName")} description={t("vms.vmNameDesc")} stretch>
                <Input value={vmName} onChange={({ detail }) => setVmName(detail.value)} placeholder={t("vms.vmNamePlaceholder")} />
              </FormField>
              <FormField label={t("vms.node")} description={t("vms.nodeDesc")} stretch>
                <Select
                  selectedOption={selectedNode}
                  onChange={({ detail }) => { setSelectedNode(detail.selectedOption); setNodeResourcesLoading(false); setIsoOptions([]); setSelectedIso(null); setStorageOptions([]); setSelectedStorage(null); setBridgeOptions([]); setSelectedBridge(null); }}
                  options={nodeOptions}
                  placeholder={t("vms.chooseNode")}
                  loadingText={t("storage.loadingNodes")}
                  filteringType="auto"
                  statusType={loading ? "loading" : "finished"}
                />
              </FormField>
              <FormField label={t("vms.vmIdLabel")} description={t("vms.vmIdDesc")} stretch>
                <Input value={vmId} type="number" inputMode="numeric" onChange={({ detail }) => setVmId(detail.value)} />
              </FormField>
            </SpaceBetween>
          </Container>
        ),
      },
      {
        title: t("vms.osStep"),
        content: (
          <Container header={<Header variant="h2">{t("vms.operatingSystem")}</Header>}>
            <SpaceBetween size="l">
              <FormField label={t("vms.osType")} stretch>
                <Select
                  selectedOption={selectedOsType}
                  onChange={({ detail }) => setSelectedOsType(detail.selectedOption)}
                  options={OS_TYPE_OPTIONS}
                />
              </FormField>
              <FormField
                label={t("vms.isoImageLabel")}
                stretch
                description={!selectedNode ? t("vms.selectNodeFirst") : t("vms.optionalBootMedia")}
              >
                <Select
                  selectedOption={selectedIso}
                  onChange={({ detail }) => setSelectedIso(detail.selectedOption)}
                  options={isoOptions}
                  placeholder={!selectedNode ? t("vms.selectNodeFirst") : t("vms.chooseIso")}
                  empty={t("vms.noIsoAvailable")}
                  loadingText={t("vms.loadingIso")}
                  filteringType="auto"
                  statusType={!selectedNode ? "pending" : nodeResourcesLoading ? "loading" : "finished"}
                  disabled={!selectedNode}
                />
              </FormField>
            </SpaceBetween>
          </Container>
        ),
      },
      {
        title: t("vms.systemStep"),
        content: (
          <Container header={<Header variant="h2">{t("vms.systemSettings")}</Header>}>
            <ColumnLayout columns={2} variant="text-grid">
              <FormField label={t("vms.bios")} stretch>
                <Select selectedOption={selectedBios} onChange={({ detail }) => { setSelectedBios(detail.selectedOption); setEfiDiskEnabled(optionValue(detail.selectedOption) === "ovmf"); }} options={BIOS_OPTIONS} />
              </FormField>
              <FormField label={t("vms.machineType")} description={t("vms.machineTypeDesc")} stretch>
                <Select
                  selectedOption={selectedMachineType}
                  onChange={({ detail }) => setSelectedMachineType(detail.selectedOption)}
                  options={MACHINE_TYPE_OPTIONS}
                />
              </FormField>
              <FormField label={t("vms.scsiController")} stretch>
                <Select
                  selectedOption={selectedScsiController}
                  onChange={({ detail }) => setSelectedScsiController(detail.selectedOption)}
                  options={SCSI_CONTROLLER_OPTIONS}
                />
              </FormField>
              <FormField label={t("vms.vgaType")} description={t("vms.vgaTypeDesc")} stretch>
                <Select
                  selectedOption={selectedVgaType}
                  onChange={({ detail }) => setSelectedVgaType(detail.selectedOption)}
                  options={VGA_TYPE_OPTIONS}
                />
              </FormField>
              <FormField label={t("vms.efiDisk")} description={t("vms.efiDiskDesc")} stretch>
                <Toggle checked={efiDiskEnabled} onChange={({ detail }) => setEfiDiskEnabled(detail.checked)} disabled={optionValue(selectedBios) !== "ovmf"}>
                  {t("vms.efiDisk")}
                </Toggle>
              </FormField>
              <FormField label={t("vms.tpm")} description={t("vms.tpmDesc")} stretch>
                <Toggle checked={tpmEnabled} onChange={({ detail }) => setTpmEnabled(detail.checked)}>
                  {t("vms.tpm")}
                </Toggle>
              </FormField>
            </ColumnLayout>
          </Container>
        ),
      },
      {
        title: t("vms.cpuStep"),
        content: (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">{t("vms.cpuSettings")}</Header>}>
              <ColumnLayout columns={2} variant="text-grid">
                <FormField label={t("vms.cpuCores")} stretch>
                  <Input value={cores} type="number" inputMode="numeric" onChange={({ detail }) => setCores(detail.value)} />
                </FormField>
                <FormField label={t("vms.cpuSockets")} stretch>
                  <Input value={sockets} type="number" inputMode="numeric" onChange={({ detail }) => setSockets(detail.value)} />
                </FormField>
                <FormField label={t("vms.cpuType")} stretch>
                  <Select
                    selectedOption={selectedCpuType}
                    onChange={({ detail }) => setSelectedCpuType(detail.selectedOption)}
                    options={CPU_TYPE_OPTIONS}
                  />
                </FormField>
                <FormField label={t("vms.numa")} description={t("vms.numaDesc")} stretch>
                  <Toggle checked={numaEnabled} onChange={({ detail }) => setNumaEnabled(detail.checked)}>
                    {t("vms.numa")}
                  </Toggle>
                </FormField>
              </ColumnLayout>
            </Container>
            <Container header={<Header variant="h2">{t("vms.cpuFlags")}</Header>}>
              <FormField description={t("vms.cpuFlagsDesc")} stretch>
                <ColumnLayout columns={2} variant="text-grid">
                  <Checkbox checked={cpuFlagAes} onChange={({ detail }) => setCpuFlagAes(detail.checked)}>
                    {t("vms.aesFlag")}
                  </Checkbox>
                  <Checkbox checked={cpuFlagPcid} onChange={({ detail }) => setCpuFlagPcid(detail.checked)}>
                    {t("vms.pcidFlag")}
                  </Checkbox>
                  <Checkbox checked={cpuFlagSpecCtrl} onChange={({ detail }) => setCpuFlagSpecCtrl(detail.checked)}>
                    {t("vms.specCtrlFlag")}
                  </Checkbox>
                  <Checkbox checked={cpuFlagIbpb} onChange={({ detail }) => setCpuFlagIbpb(detail.checked)}>
                    {t("vms.ibpbFlag")}
                  </Checkbox>
                  <Checkbox checked={cpuFlagSsbd} onChange={({ detail }) => setCpuFlagSsbd(detail.checked)}>
                    {t("vms.ssbdFlag")}
                  </Checkbox>
                  <Checkbox checked={cpuFlagMdClear} onChange={({ detail }) => setCpuFlagMdClear(detail.checked)}>
                    {t("vms.mdClearFlag")}
                  </Checkbox>
                </ColumnLayout>
              </FormField>
            </Container>
          </SpaceBetween>
        ),
      },
      {
        title: t("vms.memoryStep"),
        content: (
          <Container header={<Header variant="h2">{t("vms.memorySettings")}</Header>}>
            <ColumnLayout columns={2} variant="text-grid">
              <FormField label={t("vms.memoryMb")} stretch>
                <Input value={memory} type="number" inputMode="numeric" onChange={({ detail }) => setMemory(detail.value)} />
              </FormField>
              <FormField label={t("vms.hugepages")} description={t("vms.hugepagesDesc")} stretch>
                <Select
                  selectedOption={selectedHugepages}
                  onChange={({ detail }) => setSelectedHugepages(detail.selectedOption)}
                  options={HUGEPAGES_OPTIONS}
                />
              </FormField>
              <FormField label={t("vms.ballooning")} description={t("vms.ballooningDesc")} stretch>
                <Toggle checked={ballooningEnabled} onChange={({ detail }) => setBallooningEnabled(detail.checked)}>
                  {t("vms.ballooning")}
                </Toggle>
              </FormField>
              <FormField label={t("vms.minimumMemory")} description={t("vms.minimumMemoryDesc")} stretch>
                <Input
                  value={minimumMemory}
                  type="number"
                  inputMode="numeric"
                  onChange={({ detail }) => setMinimumMemory(detail.value)}
                  disabled={!ballooningEnabled}
                />
              </FormField>
            </ColumnLayout>
          </Container>
        ),
      },
      {
        title: t("vms.storageNetworkStep"),
        content: (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">{t("storage.storage")}</Header>}>
              <ColumnLayout columns={2} variant="text-grid">
                <FormField label={t("vms.diskSizeGb")} stretch>
                  <Input value={diskSize} type="number" inputMode="numeric" onChange={({ detail }) => setDiskSize(detail.value)} />
                </FormField>
                <FormField label={t("vms.storageLabel")} stretch>
                  <Select
                    selectedOption={selectedStorage}
                    onChange={({ detail }) => setSelectedStorage(detail.selectedOption)}
                    options={storageOptions}
                    placeholder={!selectedNode ? t("vms.selectNodeFirst") : t("vms.chooseStorage")}
                    empty={t("vms.noImageStorage")}
                    loadingText={t("storage.loadingStorage")}
                    statusType={!selectedNode ? "pending" : nodeResourcesLoading ? "loading" : "finished"}
                    disabled={!selectedNode}
                  />
                </FormField>
                <FormField label={t("vms.diskFormat")} description={t("vms.diskFormatDesc")} stretch>
                  <Select
                    selectedOption={selectedDiskFormat}
                    onChange={({ detail }) => setSelectedDiskFormat(detail.selectedOption)}
                    options={DISK_FORMAT_OPTIONS}
                  />
                </FormField>
                <FormField label={t("vms.diskCache")} description={t("vms.diskCacheDesc")} stretch>
                  <Select
                    selectedOption={selectedDiskCache}
                    onChange={({ detail }) => setSelectedDiskCache(detail.selectedOption)}
                    options={DISK_CACHE_OPTIONS}
                  />
                </FormField>
                <FormField label={t("vms.ioThread")} description={t("vms.ioThreadDesc")} stretch>
                  <Toggle checked={ioThreadEnabled} onChange={({ detail }) => setIoThreadEnabled(detail.checked)}>
                    {t("vms.ioThread")}
                  </Toggle>
                </FormField>
                <FormField label={t("vms.discard")} description={t("vms.discardDesc")} stretch>
                  <Toggle checked={discardEnabled} onChange={({ detail }) => setDiscardEnabled(detail.checked)}>
                    {t("vms.discard")}
                  </Toggle>
                </FormField>
                <FormField label={t("vms.ssdEmulation")} description={t("vms.ssdEmulationDesc")} stretch>
                  <Toggle checked={ssdEmulationEnabled} onChange={({ detail }) => setSsdEmulationEnabled(detail.checked)}>
                    {t("vms.ssdEmulation")}
                  </Toggle>
                </FormField>
              </ColumnLayout>
            </Container>
            <Container header={<Header variant="h2">{t("containers.network")}</Header>}>
              <ColumnLayout columns={2} variant="text-grid">
                <FormField label={t("vms.networkBridge")} stretch>
                  <Select
                    selectedOption={selectedBridge}
                    onChange={({ detail }) => setSelectedBridge(detail.selectedOption)}
                    options={bridgeOptions}
                    placeholder={!selectedNode ? t("vms.selectNodeFirst") : t("vms.chooseBridge")}
                    empty={t("vms.noBridgesAvailable")}
                    loadingText={t("vms.loadingBridges")}
                    statusType={!selectedNode ? "pending" : nodeResourcesLoading ? "loading" : "finished"}
                    disabled={!selectedNode}
                  />
                </FormField>
                <FormField label={t("vms.networkModel")} stretch>
                  <Select
                    selectedOption={selectedNetworkModel}
                    onChange={({ detail }) => setSelectedNetworkModel(detail.selectedOption)}
                    options={NETWORK_MODEL_OPTIONS}
                  />
                </FormField>
                <FormField label={t("vms.vlanTag")} stretch>
                  <Input value={vlanTag} onChange={({ detail }) => setVlanTag(detail.value)} placeholder={t("vms.vlanTagPlaceholder")} />
                </FormField>
                <FormField label={t("vms.macAddress")} stretch>
                  <Input value={macAddress} onChange={({ detail }) => setMacAddress(detail.value)} placeholder={t("vms.macAddressPlaceholder")} />
                </FormField>
                <FormField label={t("vms.mtu")} stretch>
                  <Input value={mtu} onChange={({ detail }) => setMtu(detail.value)} placeholder={t("vms.mtuPlaceholder")} />
                </FormField>
                <FormField label={t("vms.multiqueue")} stretch>
                  <Input value={multiqueue} onChange={({ detail }) => setMultiqueue(detail.value)} placeholder={t("vms.multiqueuePlaceholder")} />
                </FormField>
                <FormField label={t("vms.firewall")} stretch>
                  <Checkbox checked={firewallEnabled} onChange={({ detail }) => setFirewallEnabled(detail.checked)}>
                    {t("vms.firewallDesc")}
                  </Checkbox>
                </FormField>
              </ColumnLayout>
            </Container>
          </SpaceBetween>
        ),
      },
      {
        title: t("vms.advancedStep"),
        content: (
          <Container header={<Header variant="h2">{t("vms.advancedOptions")}</Header>}>
            <ColumnLayout columns={2} variant="text-grid">
              <FormField label={t("vms.startOnBoot")} description={t("vms.startOnBootDesc")} stretch>
                <Toggle checked={startOnBoot} onChange={({ detail }) => setStartOnBoot(detail.checked)}>
                  {t("vms.startOnBoot")}
                </Toggle>
              </FormField>
              <FormField label={t("vms.bootOrder")} stretch>
                <Input value={bootOrder} onChange={({ detail }) => setBootOrder(detail.value)} />
              </FormField>
              <FormField label={t("vms.qemuAgent")} description={t("vms.qemuAgentDesc")} stretch>
                <Toggle checked={qemuAgentEnabled} onChange={({ detail }) => setQemuAgentEnabled(detail.checked)}>
                  {t("vms.qemuAgent")}
                </Toggle>
              </FormField>
              <FormField label={t("vms.agentType")} stretch>
                <Select
                  selectedOption={selectedAgentType}
                  onChange={({ detail }) => setSelectedAgentType(detail.selectedOption)}
                  options={AGENT_TYPE_OPTIONS}
                  disabled={!qemuAgentEnabled}
                />
              </FormField>
              <FormField label={t("vms.agentFstrim")} description={t("vms.agentFstrimDesc")} stretch>
                <Toggle checked={agentFstrimEnabled} onChange={({ detail }) => setAgentFstrimEnabled(detail.checked)} disabled={!qemuAgentEnabled}>
                  {t("vms.agentFstrim")}
                </Toggle>
              </FormField>
              <FormField label={t("vms.hotplug")} description={t("vms.hotplugDesc")} stretch>
                <Select
                  selectedOption={selectedHotplug}
                  onChange={({ detail }) => setSelectedHotplug(detail.selectedOption)}
                  options={HOTPLUG_OPTIONS}
                />
              </FormField>
              <FormField label={t("vms.tabletDevice")} description={t("vms.tabletDeviceDesc")} stretch>
                <Toggle checked={tabletDeviceEnabled} onChange={({ detail }) => setTabletDeviceEnabled(detail.checked)}>
                  {t("vms.tabletDevice")}
                </Toggle>
              </FormField>
              <FormField label={t("vms.useLocalTime")} description={t("vms.useLocalTimeDesc")} stretch>
                <Toggle checked={useLocalTime} onChange={({ detail }) => setUseLocalTime(detail.checked)}>
                  {t("vms.useLocalTime")}
                </Toggle>
              </FormField>
              <FormField label={t("vms.protection")} description={t("vms.protectionDesc")} stretch>
                <Toggle checked={protectionEnabled} onChange={({ detail }) => setProtectionEnabled(detail.checked)}>
                  {t("vms.protection")}
                </Toggle>
              </FormField>
              <FormField label={t("vms.tags")} description={t("vms.tagsDesc")} stretch>
                <Input value={tags} onChange={({ detail }) => setTags(detail.value)} placeholder={t("vms.tagsPlaceholder")} />
              </FormField>
              <FormField label={t("vms.descriptionLabel")} stretch>
                <Input
                  value={description}
                  onChange={({ detail }) => setDescription(detail.value)}
                  placeholder={t("vms.descriptionPlaceholder")}
                />
              </FormField>
            </ColumnLayout>
          </Container>
        ),
      },
      {
        title: t("vms.reviewStep"),
        content: (
          <SpaceBetween size="l">
            {reviewSections.map((section) => (
              <Container
                key={section.title}
                header={
                  <Header
                    variant="h2"
                    actions={
                      <Button variant="normal" onClick={() => setActiveStepIndex(section.stepIndex)}>
                        {t("common.edit")}
                      </Button>
                    }
                  >
                    {section.title}
                  </Header>
                }
              >
                <KeyValuePairs columns={2} items={section.items} />
              </Container>
            ))}
          </SpaceBetween>
        ),
      },
    ],
    [
      agentFstrimEnabled,
      ballooningEnabled,
      bootOrder,
      bridgeOptions,
      cores,
      cpuFlagAes,
      cpuFlagIbpb,
      cpuFlagMdClear,
      cpuFlagPcid,
      cpuFlagSpecCtrl,
      cpuFlagSsbd,
      description,
      diskSize,
      discardEnabled,
      efiDiskEnabled,
      firewallEnabled,
      ioThreadEnabled,
      isoOptions,
      loading,
      macAddress,
      memory,
      minimumMemory,
      mtu,
      multiqueue,
      nodeOptions,
      nodeResourcesLoading,
      numaEnabled,
      protectionEnabled,
      qemuAgentEnabled,
      reviewSections,
      selectedAgentType,
      selectedBios,
      selectedBridge,
      selectedCpuType,
      selectedDiskCache,
      selectedDiskFormat,
      selectedHotplug,
      selectedHugepages,
      selectedIso,
      selectedMachineType,
      selectedNetworkModel,
      selectedNode,
      selectedOsType,
      selectedScsiController,
      selectedStorage,
      selectedVgaType,
      sockets,
      ssdEmulationEnabled,
      startOnBoot,
      storageOptions,
      tabletDeviceEnabled,
      tags,
      t,
      tpmEnabled,
      useLocalTime,
      vlanTag,
      vmId,
      vmName,
    ],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{t("vms.launchInstance")}</Header>
      {flashbarItems.length > 0 ? <Flashbar items={flashbarItems.map((item) => ({ ...item, onDismiss: item.onDismiss ?? (() => setFlashbarItems((current) => current.filter((entry) => entry.id !== item.id))) }))} /> : null}
      {error ? (
        <Alert type="error" header={t("vms.unableToCreate")}>
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <Container>
          <Box color="text-body-secondary">{t("vms.loadingWizard")}</Box>
        </Container>
      ) : (
        <Wizard
          steps={steps}
          activeStepIndex={activeStepIndex}
          onNavigate={({ detail }) => setActiveStepIndex(detail.requestedStepIndex)}
          onCancel={() => router.push("/vms")}
          onSubmit={() => void handleSubmit()}
          i18nStrings={{
            submitButton: t("vms.submitButton"),
            cancelButton: t("vms.cancelButton"),
            previousButton: t("vms.previousButton"),
            nextButton: t("vms.nextButton"),
            stepNumberLabel: (n) => t("vms.stepNumberLabel").replace("{n}", String(n)),
            collapsedStepsLabel: (n, total) =>
              t("vms.collapsedStepsLabel").replace("{n}", String(n)).replace("{total}", String(total)),
          }}
          isLoadingNextStep={submitting || nodeResourcesLoading}
        />
      )}
    </SpaceBetween>
  );
}
