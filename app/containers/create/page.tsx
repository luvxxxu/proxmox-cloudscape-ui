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

async function fetchProxmox<T>(path: string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

function optionLabel(option: SelectProps.Option | null) {
  return option?.label ?? "-";
}

function optionValue(option: SelectProps.Option | null) {
  return option?.value ?? "";
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function storageSupportsContent(storage: StorageSummary, contentType: string) {
  return isStorageActive(storage) && (storage.content ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .includes(contentType);
}

export default function CreateContainerPage() {
  const router = useRouter();
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nodeResourcesLoading, setNodeResourcesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const [containerName, setContainerName] = useState("");
  const [containerId, setContainerId] = useState("");
  const [nodeOptions, setNodeOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [selectedNode, setSelectedNode] = useState<SelectProps.Option | null>(null);
  const [templateOptions, setTemplateOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<SelectProps.Option | null>(null);
  const [cores, setCores] = useState("1");
  const [memory, setMemory] = useState("512");
  const [swap, setSwap] = useState("512");
  const [diskSize, setDiskSize] = useState("8");
  const [storageOptions, setStorageOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [selectedStorage, setSelectedStorage] = useState<SelectProps.Option | null>(null);
  const [bridgeOptions, setBridgeOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [selectedBridge, setSelectedBridge] = useState<SelectProps.Option | null>(null);
  const [ipAddress, setIpAddress] = useState("");
  const [gateway, setGateway] = useState("");
  const [dnsServer, setDnsServer] = useState("");
  const [rootPassword, setRootPassword] = useState("");
  const [startOnBoot, setStartOnBoot] = useState(false);
  const [unprivileged, setUnprivileged] = useState(true);
  const [nestingEnabled, setNestingEnabled] = useState(false);

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
      setContainerId(normalizedNextId ? String(normalizedNextId) : "");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load container creation data");
    } finally {
      setLoading(false);
    }
  }, []);

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

        const rootdirStorageOptions = (storages ?? [])
          .filter((storage) => storageSupportsContent(storage, "rootdir"))
          .map((storage) => ({ label: storage.storage, value: storage.storage }))
          .sort((left, right) => optionLabel(left).localeCompare(optionLabel(right)));

        const templateStorages = (storages ?? []).filter((storage) => storageSupportsContent(storage, "vztmpl"));

        const [templateGroups, networks] = await Promise.all([
          Promise.all(
            templateStorages.map(async (storage) => {
              try {
                return await fetchProxmox<StorageContentItem[]>(
                  `/api/proxmox/nodes/${node}/storage/${storage.storage}/content?content=vztmpl`,
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

        const templateMap = new Map<string, SelectProps.Option>();
        templateGroups.flat().forEach((item) => {
          if (item?.volid) {
            templateMap.set(item.volid, { label: item.volid, value: item.volid });
          }
        });

        const networkBridgeOptions = (networks ?? [])
          .filter((network) => network.type === "bridge" || network.type === "OVSBridge")
          .map((network) => ({ label: network.iface, value: network.iface }))
          .sort((left, right) => optionLabel(left).localeCompare(optionLabel(right)));

        const nextTemplateOptions = Array.from(templateMap.values()).sort((left, right) =>
          optionLabel(left).localeCompare(optionLabel(right)),
        );

        setStorageOptions(rootdirStorageOptions);
        setSelectedStorage((current) =>
          current && rootdirStorageOptions.some((option) => option.value === current.value) ? current : null,
        );
        setTemplateOptions(nextTemplateOptions);
        setSelectedTemplate((current) => (current && templateMap.has(String(current.value)) ? current : null));
        setBridgeOptions(networkBridgeOptions);
        setSelectedBridge((current) =>
          current && networkBridgeOptions.some((option) => option.value === current.value) ? current : null,
        );
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load node resources");
          setTemplateOptions([]);
          setSelectedTemplate(null);
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
  }, [selectedNode]);

  const validateForm = useCallback((): ValidationResult | null => {
    if (nodeResourcesLoading) return { message: "Wait for node resources to finish loading.", stepIndex: 0 };
    if (!containerName.trim()) {
      return { message: "Container Name is required.", stepIndex: 0 };
    }
    if (!optionValue(selectedNode)) {
      return { message: "Node is required.", stepIndex: 0 };
    }
    if (!isValidVmid(containerId)) {
      return { message: "Container ID is required.", stepIndex: 0 };
    }
    if (!optionValue(selectedTemplate)) {
      return { message: "Template is required.", stepIndex: 1 };
    }
    if (!optionValue(selectedStorage)) {
      return { message: "Storage is required.", stepIndex: 2 };
    }
    if (!optionValue(selectedBridge)) {
      return { message: "Network Bridge is required.", stepIndex: 3 };
    }
    if (!isIntegerInRange(cores, 1) || !isIntegerInRange(memory, 16) || !isIntegerInRange(swap, 0)) return { message: "CPU cores and memory must be positive integers; swap must be a non-negative integer.", stepIndex: 2 };
    if (!Number.isFinite(Number(diskSize)) || Number(diskSize) <= 0) return { message: "Disk size must be a positive number.", stepIndex: 2 };
    if (!rootPassword) {
      return { message: "Root Password is required.", stepIndex: 3 };
    }
    return null;
  }, [containerId, containerName, cores, memory, swap, diskSize, nodeResourcesLoading, rootPassword, selectedBridge, selectedNode, selectedStorage, selectedTemplate]);

  const handleSubmit = useCallback(async () => {
    const validationResult = validateForm();

    if (validationResult) {
      setError(validationResult.message);
      setActiveStepIndex(validationResult.stepIndex);
      return;
    }

    const node = optionValue(selectedNode);
    const storage = optionValue(selectedStorage);
    const template = optionValue(selectedTemplate);
    const bridge = optionValue(selectedBridge);
    const ipValue = ipAddress.trim() || "dhcp";
    const net0Parts = [`name=eth0`, `bridge=${bridge}`, `ip=${ipValue}`, `firewall=1`];

    if (gateway.trim()) {
      net0Parts.push(`gw=${gateway.trim()}`);
    }

    const body = new URLSearchParams({
      vmid: containerId,
      hostname: containerName.trim(),
      cores,
      memory,
      swap,
      ostemplate: template,
      rootfs: `${storage}:${diskSize}`,
      net0: net0Parts.join(","),
      password: rootPassword,
      onboot: startOnBoot ? "1" : "0",
      unprivileged: unprivileged ? "1" : "0",
    });

    if (dnsServer.trim()) {
      body.set("nameserver", dnsServer.trim());
    }

    if (nestingEnabled) {
      body.set("features", "nesting=1");
    }

    try {
      setSubmitting(true);
      setError(null);

      await requestResource<string>(`/api/proxmox/nodes/${node}/lxc`, {
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
          content: `Container ${containerName.trim()} is being created. Redirecting to containers...`,
          dismissible: true,
          id: "container-create-success",
        },
      ]);

      router.push("/containers");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create container");
    } finally {
      setSubmitting(false);
    }
  }, [
    containerId,
    containerName,
    cores,
    diskSize,
    dnsServer,
    gateway,
    ipAddress,
    memory,
    nestingEnabled,
    rootPassword,
    router,
    selectedBridge,
    selectedNode,
    selectedStorage,
    selectedTemplate,
    startOnBoot,
    swap,
    unprivileged,
    validateForm,
  ]);

  const reviewSections = useMemo(
    () => [
      {
        title: "Name and node",
        stepIndex: 0,
        items: [
          { label: "Container Name", value: containerName || "-" },
          { label: "Node", value: optionLabel(selectedNode) },
          { label: "Container ID", value: containerId || "-" },
        ],
      },
      {
        title: "OS template",
        stepIndex: 1,
        items: [{ label: "Template", value: optionLabel(selectedTemplate) }],
      },
      {
        title: "Resources",
        stepIndex: 2,
        items: [
          { label: "CPU Cores", value: cores },
          { label: "Memory in MB", value: memory },
          { label: "Swap in MB", value: swap },
          { label: "Disk Size in GB", value: diskSize },
          { label: "Storage", value: optionLabel(selectedStorage) },
        ],
      },
      {
        title: "Network and options",
        stepIndex: 3,
        items: [
          { label: "Network Bridge", value: optionLabel(selectedBridge) },
          { label: "IP Address", value: ipAddress.trim() || "dhcp" },
          { label: "Gateway", value: gateway.trim() || "-" },
          { label: "DNS Server", value: dnsServer.trim() || "-" },
          { label: "Root Password", value: rootPassword ? "••••••••" : "-" },
          { label: "Start on boot", value: yesNo(startOnBoot) },
          { label: "Unprivileged container", value: yesNo(unprivileged) },
          { label: "Enable nesting", value: yesNo(nestingEnabled) },
        ],
      },
    ],
    [
      containerId,
      containerName,
      cores,
      diskSize,
      dnsServer,
      gateway,
      ipAddress,
      memory,
      nestingEnabled,
      rootPassword,
      selectedBridge,
      selectedNode,
      selectedStorage,
      selectedTemplate,
      startOnBoot,
      swap,
      unprivileged,
    ],
  );

  const steps = useMemo<WizardProps.Step[]>(
    () => [
      {
        title: "Name and Node",
        content: (
          <Container header={<Header variant="h2">Container details</Header>}>
            <SpaceBetween size="l">
              <FormField label="Container Name" description="Give this container a memorable hostname." stretch>
                <Input
                  value={containerName}
                  onChange={({ detail }) => setContainerName(detail.value)}
                  placeholder="my-container-01"
                />
              </FormField>
              <FormField label="Node" description="Only online nodes are available for launching." stretch>
                <Select
                  selectedOption={selectedNode}
                  onChange={({ detail }) => { setSelectedNode(detail.selectedOption); setNodeResourcesLoading(false); setTemplateOptions([]); setSelectedTemplate(null); setStorageOptions([]); setSelectedStorage(null); setBridgeOptions([]); setSelectedBridge(null); }}
                  options={nodeOptions}
                  placeholder="Choose a node"
                  loadingText="Loading nodes"
                  filteringType="auto"
                  statusType={loading ? "loading" : "finished"}
                />
              </FormField>
              <FormField label="Container ID" description="This value is auto-filled from the cluster and can be edited." stretch>
                <Input
                  value={containerId}
                  type="number"
                  inputMode="numeric"
                  onChange={({ detail }) => setContainerId(detail.value)}
                />
              </FormField>
            </SpaceBetween>
          </Container>
        ),
      },
      {
        title: "OS Template",
        content: (
          <Container header={<Header variant="h2">Operating system</Header>}>
            <FormField
              label="Template"
              stretch
              description={!selectedNode ? "Select a node first" : "Choose an LXC template for the container root filesystem."}
            >
              <Select
                selectedOption={selectedTemplate}
                onChange={({ detail }) => setSelectedTemplate(detail.selectedOption)}
                options={templateOptions}
                placeholder={!selectedNode ? "Select a node first" : "Choose a template"}
                empty="No LXC templates available"
                loadingText="Loading templates"
                filteringType="auto"
                statusType={!selectedNode ? "pending" : nodeResourcesLoading ? "loading" : "finished"}
                disabled={!selectedNode}
              />
            </FormField>
          </Container>
        ),
      },
      {
        title: "Resources",
        content: (
          <Container header={<Header variant="h2">Resources</Header>}>
            <ColumnLayout columns={2} variant="text-grid">
              <FormField label="CPU Cores" stretch>
                <Input value={cores} type="number" inputMode="numeric" onChange={({ detail }) => setCores(detail.value)} />
              </FormField>
              <FormField label="Memory in MB" stretch>
                <Input value={memory} type="number" inputMode="numeric" onChange={({ detail }) => setMemory(detail.value)} />
              </FormField>
              <FormField label="Swap in MB" stretch>
                <Input value={swap} type="number" inputMode="numeric" onChange={({ detail }) => setSwap(detail.value)} />
              </FormField>
              <FormField label="Disk Size in GB" stretch>
                <Input value={diskSize} type="number" inputMode="numeric" onChange={({ detail }) => setDiskSize(detail.value)} />
              </FormField>
              <FormField label="Storage" stretch>
                <Select
                  selectedOption={selectedStorage}
                  onChange={({ detail }) => setSelectedStorage(detail.selectedOption)}
                  options={storageOptions}
                  placeholder={!selectedNode ? "Select a node first" : "Choose storage"}
                  empty="No root filesystem storage available"
                  loadingText="Loading storage"
                  statusType={!selectedNode ? "pending" : nodeResourcesLoading ? "loading" : "finished"}
                  disabled={!selectedNode}
                />
              </FormField>
            </ColumnLayout>
          </Container>
        ),
      },
      {
        title: "Network and Options",
        content: (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Network</Header>}>
              <ColumnLayout columns={2} variant="text-grid">
                <FormField label="Network Bridge" stretch>
                  <Select
                    selectedOption={selectedBridge}
                    onChange={({ detail }) => setSelectedBridge(detail.selectedOption)}
                    options={bridgeOptions}
                    placeholder={!selectedNode ? "Select a node first" : "Choose a bridge"}
                    empty="No bridges available"
                    loadingText="Loading network bridges"
                    statusType={!selectedNode ? "pending" : nodeResourcesLoading ? "loading" : "finished"}
                    disabled={!selectedNode}
                  />
                </FormField>
                <FormField
                  label="IP Address"
                  description="Use DHCP or specify static IP e.g. 192.168.1.100/24"
                  stretch
                >
                  <Input value={ipAddress} onChange={({ detail }) => setIpAddress(detail.value)} placeholder="dhcp" />
                </FormField>
                <FormField label="Gateway" stretch>
                  <Input value={gateway} onChange={({ detail }) => setGateway(detail.value)} />
                </FormField>
                <FormField label="DNS Server" stretch>
                  <Input value={dnsServer} onChange={({ detail }) => setDnsServer(detail.value)} />
                </FormField>
              </ColumnLayout>
            </Container>
            <Container header={<Header variant="h2">Options</Header>}>
              <ColumnLayout columns={2} variant="text-grid">
                <FormField label="Root Password" stretch>
                  <Input value={rootPassword} type="password" onChange={({ detail }) => setRootPassword(detail.value)} />
                </FormField>
                <FormField label="Start on boot" stretch>
                  <Toggle checked={startOnBoot} onChange={({ detail }) => setStartOnBoot(detail.checked)}>
                    Start automatically after host boot
                  </Toggle>
                </FormField>
                <FormField label="Unprivileged container" stretch>
                  <Toggle checked={unprivileged} onChange={({ detail }) => setUnprivileged(detail.checked)}>
                    Use an unprivileged container
                  </Toggle>
                </FormField>
                <FormField label="Enable nesting" stretch>
                  <Checkbox checked={nestingEnabled} onChange={({ detail }) => setNestingEnabled(detail.checked)}>
                    Allow nested container workloads
                  </Checkbox>
                </FormField>
              </ColumnLayout>
            </Container>
          </SpaceBetween>
        ),
      },
      {
        title: "Review and Create",
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
                        Edit
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
      containerId,
      containerName,
      cores,
      diskSize,
      dnsServer,
      gateway,
      ipAddress,
      loading,
      memory,
      nestingEnabled,
      nodeOptions,
      nodeResourcesLoading,
      reviewSections,
      rootPassword,
      selectedBridge,
      selectedNode,
      selectedStorage,
      selectedTemplate,
      startOnBoot,
      storageOptions,
      swap,
      templateOptions,
      unprivileged,
      bridgeOptions,
    ],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">Create container</Header>
      {flashbarItems.length > 0 ? <Flashbar items={flashbarItems.map((item) => ({ ...item, onDismiss: item.onDismiss ?? (() => setFlashbarItems((current) => current.filter((entry) => entry.id !== item.id))) }))} /> : null}
      {error ? (
        <Alert type="error" header="Unable to create container">
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <Container>
          <Box color="text-body-secondary">Loading container creation wizard...</Box>
        </Container>
      ) : (
        <Wizard
          steps={steps}
          activeStepIndex={activeStepIndex}
          onNavigate={({ detail }) => setActiveStepIndex(detail.requestedStepIndex)}
          onCancel={() => router.push("/containers")}
          onSubmit={() => void handleSubmit()}
          i18nStrings={{
            submitButton: "Create container",
            cancelButton: "Cancel",
            previousButton: "Previous",
            nextButton: "Next",
            stepNumberLabel: (n) => `Step ${n}`,
            collapsedStepsLabel: (n, total) => `Step ${n} of ${total}`,
          }}
          isLoadingNextStep={submitting || nodeResourcesLoading}
        />
      )}
    </SpaceBetween>
  );
}
