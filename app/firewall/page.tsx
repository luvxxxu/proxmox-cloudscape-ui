"use client";

import { requestResource } from "@/app/lib/resource-request";

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
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
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
import { setOptionalParameters } from "@/app/lib/resource-api";

interface FirewallRule {
  pos: number;
  type?: string;
  action?: string;
  macro?: string;
  proto?: string;
  source?: string;
  dest?: string;
  dport?: string;
  sport?: string;
  comment?: string;
  enable?: number | boolean;
}

interface FirewallOptions {
  enable?: number | boolean;
  policy_in?: string;
  policy_out?: string;
  log_ratelimit?: string;
  ebtables?: number | boolean;
}

interface FirewallIpSet {
  name: string;
  comment?: string;
  digest?: string;
}

interface FirewallGroup {
  group: string;
  comment?: string;
  digest?: string;
}

interface FirewallAlias {
  name: string;
  cidr: string;
  comment?: string;
  digest?: string;
}

interface FirewallIpSetEntry {
  cidr?: string;
  nomatch?: number | boolean;
  comment?: string;
}

interface Preferences {
  pageSize: number;
  wrapLines: boolean;
  stripedRows: boolean;
  contentDensity: "comfortable" | "compact";
  contentDisplay: ReadonlyArray<CollectionPreferencesProps.ContentDisplayItem>;
}

interface RuleFormState {
  type: string;
  action: string;
  macro: string;
  proto: string;
  source: string;
  dest: string;
  dport: string;
  sport: string;
  comment: string;
  enable: boolean;
}

interface OptionsFormState {
  enable: boolean;
  policyIn: string;
  policyOut: string;
  logRateLimit: string;
  ebtables: boolean;
}

interface IpSetFormState {
  name: string;
  comment: string;
}

interface GroupFormState {
  group: string;
  comment: string;
}

interface AliasFormState {
  name: string;
  cidr: string;
  comment: string;
}

const DEFAULT_RULE_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "pos", visible: true },
    { id: "type", visible: true },
    { id: "action", visible: true },
    { id: "macro", visible: true },
    { id: "proto", visible: true },
    { id: "source", visible: true },
    { id: "dest", visible: true },
    { id: "dport", visible: true },
    { id: "sport", visible: true },
    { id: "comment", visible: true },
    { id: "enable", visible: true },
    { id: "actions", visible: true },
  ],
};

const DEFAULT_IP_SET_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "name", visible: true },
    { id: "comment", visible: true },
    { id: "digest", visible: true },
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
    { id: "comment", visible: true },
    { id: "actions", visible: true },
  ],
};

const DEFAULT_ALIAS_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "name", visible: true },
    { id: "cidr", visible: true },
    { id: "comment", visible: true },
    { id: "actions", visible: true },
  ],
};

const EMPTY_RULE_FORM: RuleFormState = {
  type: "in",
  action: "ACCEPT",
  macro: "",
  proto: "",
  source: "",
  dest: "",
  dport: "",
  sport: "",
  comment: "",
  enable: true,
};

const EMPTY_OPTIONS_FORM: OptionsFormState = {
  enable: false,
  policyIn: "DROP",
  policyOut: "ACCEPT",
  logRateLimit: "",
  ebtables: false,
};

const EMPTY_IP_SET_FORM: IpSetFormState = {
  name: "",
  comment: "",
};

const EMPTY_GROUP_FORM: GroupFormState = {
  group: "",
  comment: "",
};

const EMPTY_ALIAS_FORM: AliasFormState = {
  name: "",
  cidr: "",
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

function buildRuleForm(rule: FirewallRule): RuleFormState {
  return {
    type: rule.type ?? "in",
    action: rule.action ?? "ACCEPT",
    macro: rule.macro ?? "",
    proto: rule.proto ?? "",
    source: rule.source ?? "",
    dest: rule.dest ?? "",
    dport: rule.dport ?? "",
    sport: rule.sport ?? "",
    comment: rule.comment ?? "",
    enable: isEnabled(rule.enable),
  };
}

function buildOptionsForm(options: FirewallOptions): OptionsFormState {
  return {
    enable: isEnabled(options.enable),
    policyIn: options.policy_in ?? "DROP",
    policyOut: options.policy_out ?? "ACCEPT",
    logRateLimit: options.log_ratelimit ?? "",
    ebtables: isEnabled(options.ebtables ?? 1),
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

function encodeFormBody(params: URLSearchParams) {
  return {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params.toString(),
  };
}

function getTextValue(value?: string, fallback = "-") {
  return value?.trim() ? value : fallback;
}

function getTrackableValue(option: SelectProps.Option | null) {
  return typeof option?.value === "string" ? option.value : "";
}

export default function FirewallPage() {
  const { t } = useTranslation();
  const [activeTabId, setActiveTabId] = useState("rules");
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [options, setOptions] = useState<FirewallOptions | null>(null);
  const [ipSets, setIpSets] = useState<FirewallIpSet[]>([]);
  const [groups, setGroups] = useState<FirewallGroup[]>([]);
  const [groupRules, setGroupRules] = useState<FirewallRule[]>([]);
  const [aliases, setAliases] = useState<FirewallAlias[]>([]);
  const [ipSetEntries, setIpSetEntries] = useState<FirewallIpSetEntry[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [ipSetsLoading, setIpSetsLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupRulesLoading, setGroupRulesLoading] = useState(false);
  const [aliasesLoading, setAliasesLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [rulePreferences, setRulePreferences] = useState<Preferences>(DEFAULT_RULE_PREFERENCES);
  const [ipSetPreferences, setIpSetPreferences] = useState<Preferences>(DEFAULT_IP_SET_PREFERENCES);
  const [groupPreferences, setGroupPreferences] = useState<Preferences>(DEFAULT_GROUP_PREFERENCES);
  const [aliasPreferences, setAliasPreferences] = useState<Preferences>(DEFAULT_ALIAS_PREFERENCES);
  const [selectedRule, setSelectedRule] = useState<FirewallRule | null>(null);
  const [selectedIpSet, setSelectedIpSet] = useState<FirewallIpSet | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<FirewallGroup | null>(null);
  const [selectedGroupRule, setSelectedGroupRule] = useState<FirewallRule | null>(null);
  const [selectedAlias, setSelectedAlias] = useState<FirewallAlias | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleFormState>(EMPTY_RULE_FORM);
  const [optionsForm, setOptionsForm] = useState<OptionsFormState>(EMPTY_OPTIONS_FORM);
  const [ipSetForm, setIpSetForm] = useState<IpSetFormState>(EMPTY_IP_SET_FORM);
  const [groupForm, setGroupForm] = useState<GroupFormState>(EMPTY_GROUP_FORM);
  const [aliasForm, setAliasForm] = useState<AliasFormState>(EMPTY_ALIAS_FORM);
  const [createRuleVisible, setCreateRuleVisible] = useState(false);
  const [editRuleVisible, setEditRuleVisible] = useState(false);
  const [deleteRuleVisible, setDeleteRuleVisible] = useState(false);
  const [editOptionsVisible, setEditOptionsVisible] = useState(false);
  const [createIpSetVisible, setCreateIpSetVisible] = useState(false);
  const [deleteIpSetVisible, setDeleteIpSetVisible] = useState(false);
  const [viewEntriesVisible, setViewEntriesVisible] = useState(false);
  const [createGroupVisible, setCreateGroupVisible] = useState(false);
  const [deleteGroupVisible, setDeleteGroupVisible] = useState(false);
  const [groupRulesVisible, setGroupRulesVisible] = useState(false);
  const [groupRuleEditorVisible, setGroupRuleEditorVisible] = useState(false);
  const [deleteGroupRuleVisible, setDeleteGroupRuleVisible] = useState(false);
  const [aliasEditorVisible, setAliasEditorVisible] = useState(false);
  const [deleteAliasVisible, setDeleteAliasVisible] = useState(false);
  const [aliasEditorMode, setAliasEditorMode] = useState<"create" | "edit">("create");
  const [groupRuleEditorMode, setGroupRuleEditorMode] = useState<"create" | "edit">("create");

  const addFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 5));
  }, []);

  const dismissFlash = useCallback((id: string) => {
    setFlashItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const loadRules = useCallback(async () => {
    try {
      setRulesLoading(true);
      const nextRules = await fetchProxmox<FirewallRule[]>("/api/proxmox/cluster/firewall/rules", t);
      setRules((nextRules ?? []).slice().sort((a, b) => a.pos - b.pos));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("firewall.failedToLoadRules"));
    } finally {
      setRulesLoading(false);
    }
  }, [t]);

  const loadOptions = useCallback(async () => {
    try {
      setOptionsLoading(true);
      const nextOptions = await fetchProxmox<FirewallOptions>("/api/proxmox/cluster/firewall/options", t);
      setOptions(nextOptions ?? {});
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("firewall.failedToLoadOptions"));
    } finally {
      setOptionsLoading(false);
    }
  }, [t]);

  const loadIpSets = useCallback(async () => {
    try {
      setIpSetsLoading(true);
      const nextIpSets = await fetchProxmox<FirewallIpSet[]>("/api/proxmox/cluster/firewall/ipset", t);
      setIpSets((nextIpSets ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("firewall.failedToLoadIpSets"));
    } finally {
      setIpSetsLoading(false);
    }
  }, [t]);

  const loadGroups = useCallback(async () => {
    try {
      setGroupsLoading(true);
      const nextGroups = await fetchProxmox<FirewallGroup[]>("/api/proxmox/cluster/firewall/groups", t);
      setGroups((nextGroups ?? []).slice().sort((a, b) => a.group.localeCompare(b.group)));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("firewall.failedToLoadGroups"));
    } finally {
      setGroupsLoading(false);
    }
  }, [t]);

  const loadAliases = useCallback(async () => {
    try {
      setAliasesLoading(true);
      const nextAliases = await fetchProxmox<FirewallAlias[]>("/api/proxmox/cluster/firewall/aliases", t);
      setAliases((nextAliases ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("firewall.failedToLoadAliases"));
    } finally {
      setAliasesLoading(false);
    }
  }, [t]);

  const loadGroupRules = useCallback(async (groupName: string) => {
    try {
      setGroupRulesLoading(true);
      const nextRules = await fetchProxmox<FirewallRule[]>(`/api/proxmox/cluster/firewall/groups/${encodeURIComponent(groupName)}`, t);
      setGroupRules((nextRules ?? []).slice().sort((a, b) => a.pos - b.pos));
      setActionError(null);
    } catch (loadError) {
      setGroupRules([]);
      setActionError(loadError instanceof Error ? loadError.message : t("firewall.failedToLoadGroupRules"));
    } finally {
      setGroupRulesLoading(false);
    }
  }, [t]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadRules(), loadOptions(), loadIpSets(), loadGroups(), loadAliases()]);
  }, [loadAliases, loadGroups, loadIpSets, loadOptions, loadRules]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadAll();
  }, [loadAll]);

  const typeOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("firewall.typeIn"), value: "in" },
      { label: t("firewall.typeOut"), value: "out" },
      { label: t("firewall.typeGroup"), value: "group" },
    ],
    [t],
  );

  const actionOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("firewall.actionAccept"), value: "ACCEPT" },
      { label: t("firewall.actionDrop"), value: "DROP" },
      { label: t("firewall.actionReject"), value: "REJECT" },
    ],
    [t],
  );

  const macroOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("firewall.noneOption"), value: "" },
      { label: "DNS", value: "DNS" },
      { label: "DHCPfwd", value: "DHCPfwd" },
      { label: "HTTP", value: "HTTP" },
      { label: "HTTPS", value: "HTTPS" },
      { label: "SSH", value: "SSH" },
      { label: "SMTP", value: "SMTP" },
      { label: "Ping", value: "Ping" },
      { label: "NFS", value: "NFS" },
      { label: "CIFS", value: "CIFS" },
    ],
    [t],
  );

  const protocolOptions = useMemo<SelectProps.Option[]>(
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

  const rulesEmptyState = renderCenteredState(
    t("firewall.noRules"),
    t("firewall.noRulesDescription"),
    <Button onClick={() => {
      setRuleForm(EMPTY_RULE_FORM);
      setActionError(null);
      setCreateRuleVisible(true);
    }}>
      {t("firewall.addRule")}
    </Button>,
  );

  const ipSetsEmptyState = renderCenteredState(
    t("firewall.noIpSets"),
    t("firewall.noIpSetsDescription"),
    <Button onClick={() => {
      setIpSetForm(EMPTY_IP_SET_FORM);
      setActionError(null);
      setCreateIpSetVisible(true);
    }}>
      {t("firewall.createIpSet")}
    </Button>,
  );

  const groupsEmptyState = renderCenteredState(
    t("firewall.noGroups"),
    t("firewall.noGroupsDescription"),
    <Button onClick={() => {
      setGroupForm(EMPTY_GROUP_FORM);
      setActionError(null);
      setCreateGroupVisible(true);
    }}>
      {t("firewall.createGroup")}
    </Button>,
  );

  const aliasesEmptyState = renderCenteredState(
    t("firewall.noAliases"),
    t("firewall.noAliasesDescription"),
    <Button onClick={() => {
      setAliasForm(EMPTY_ALIAS_FORM);
      setAliasEditorMode("create");
      setSelectedAlias(null);
      setActionError(null);
      setAliasEditorVisible(true);
    }}>
      {t("firewall.createAlias")}
    </Button>,
  );

  const ruleTypeLabel = useCallback((value?: string) => {
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

  const actionLabel = useCallback((value?: string) => {
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

  const rulesColumnDefinitions = useMemo<TableProps<FirewallRule>["columnDefinitions"]>(
    () => [
      { id: "pos", header: t("firewall.position"), cell: ({ pos }) => String(pos), sortingField: "pos", isRowHeader: true, minWidth: 90 },
      { id: "type", header: t("firewall.type"), cell: ({ type }) => ruleTypeLabel(type), sortingComparator: (a, b) => ruleTypeLabel(a.type).localeCompare(ruleTypeLabel(b.type)), minWidth: 120 },
      { id: "action", header: t("firewall.action"), cell: ({ action }) => actionLabel(action), sortingComparator: (a, b) => actionLabel(a.action).localeCompare(actionLabel(b.action)), minWidth: 140 },
      { id: "macro", header: t("firewall.macro"), cell: ({ macro }) => getTextValue(macro, t("cluster.common.none")), sortingField: "macro", minWidth: 120 },
      { id: "proto", header: t("firewall.protocol"), cell: ({ proto }) => getTextValue(proto, t("firewall.anyProtocol")), sortingField: "proto", minWidth: 120 },
      { id: "source", header: t("firewall.source"), cell: ({ source }) => getTextValue(source, t("cluster.common.none")), sortingField: "source", minWidth: 160 },
      { id: "dest", header: t("firewall.destination"), cell: ({ dest }) => getTextValue(dest, t("cluster.common.none")), sortingField: "dest", minWidth: 160 },
      { id: "dport", header: t("firewall.destinationPort"), cell: ({ dport }) => getTextValue(dport, t("cluster.common.none")), sortingField: "dport", minWidth: 140 },
      { id: "sport", header: t("firewall.sourcePort"), cell: ({ sport }) => getTextValue(sport, t("cluster.common.none")), sortingField: "sport", minWidth: 140 },
      { id: "comment", header: t("firewall.comment"), cell: ({ comment }) => getTextValue(comment, t("cluster.common.none")), sortingField: "comment", minWidth: 220 },
      {
        id: "enable",
        header: t("firewall.enable"),
        cell: (rule) => <StatusIndicator type={isEnabled(rule.enable) ? "success" : "stopped"}>{isEnabled(rule.enable) ? t("firewall.enabled") : t("firewall.disabled")}</StatusIndicator>,
        sortingComparator: (a, b) => Number(isEnabled(a.enable)) - Number(isEnabled(b.enable)),
        minWidth: 140,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (rule) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => { setSelectedRule(rule); setRuleForm(buildRuleForm(rule)); setActionError(null); setEditRuleVisible(true); }}>{t("common.edit")}</Button>
            <Button onClick={() => { setSelectedRule(rule); setActionError(null); setDeleteRuleVisible(true); }}>{t("common.delete")}</Button>
          </SpaceBetween>
        ),
        minWidth: 180,
      },
    ],
    [actionLabel, ruleTypeLabel, t],
  );

  const ipSetColumnDefinitions = useMemo<TableProps<FirewallIpSet>["columnDefinitions"]>(
    () => [
      { id: "name", header: t("common.name"), cell: ({ name }) => name, sortingField: "name", isRowHeader: true, minWidth: 180 },
      { id: "comment", header: t("firewall.comment"), cell: ({ comment }) => getTextValue(comment, t("cluster.common.none")), sortingField: "comment", minWidth: 220 },
      { id: "digest", header: t("firewall.digest"), cell: ({ digest }) => getTextValue(digest, t("cluster.common.none")), sortingField: "digest", minWidth: 260 },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (ipSet) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              onClick={() => {
                setSelectedIpSet(ipSet);
                setViewEntriesVisible(true);
                setActionError(null);
                void (async () => {
                  try {
                    setEntriesLoading(true);
                    const entries = await fetchProxmox<FirewallIpSetEntry[]>(`/api/proxmox/cluster/firewall/ipset/${encodeURIComponent(ipSet.name)}`, t);
                    setIpSetEntries(entries ?? []);
                  } catch (loadError) {
                    setIpSetEntries([]);
                    setActionError(loadError instanceof Error ? loadError.message : t("firewall.failedToLoadEntries"));
                  } finally {
                    setEntriesLoading(false);
                  }
                })();
              }}
            >
              {t("firewall.viewEntries")}
            </Button>
            <Button onClick={() => { setSelectedIpSet(ipSet); setActionError(null); setDeleteIpSetVisible(true); }}>{t("common.delete")}</Button>
          </SpaceBetween>
        ),
        minWidth: 220,
      },
    ],
    [t],
  );

  const groupColumnDefinitions = useMemo<TableProps<FirewallGroup>["columnDefinitions"]>(
    () => [
      { id: "group", header: t("firewall.groupName"), cell: ({ group }) => group, sortingField: "group", isRowHeader: true, minWidth: 220 },
      { id: "comment", header: t("firewall.comment"), cell: ({ comment }) => getTextValue(comment, t("cluster.common.none")), sortingField: "comment", minWidth: 260 },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (group) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              onClick={() => {
                setSelectedGroup(group);
                setSelectedGroupRule(null);
                setRuleForm(EMPTY_RULE_FORM);
                setGroupRuleEditorVisible(false);
                setDeleteGroupRuleVisible(false);
                setActionError(null);
                setGroupRulesVisible(true);
                void loadGroupRules(group.group);
              }}
            >
              {t("firewall.viewGroupRules")}
            </Button>
            <Button onClick={() => { setSelectedGroup(group); setActionError(null); setDeleteGroupVisible(true); }}>{t("firewall.deleteGroup")}</Button>
          </SpaceBetween>
        ),
        minWidth: 260,
      },
    ],
    [loadGroupRules, t],
  );

  const aliasColumnDefinitions = useMemo<TableProps<FirewallAlias>["columnDefinitions"]>(
    () => [
      { id: "name", header: t("firewall.aliasName"), cell: ({ name }) => name, sortingField: "name", isRowHeader: true, minWidth: 200 },
      { id: "cidr", header: t("firewall.aliasCidr"), cell: ({ cidr }) => cidr, sortingField: "cidr", minWidth: 220 },
      { id: "comment", header: t("firewall.aliasComment"), cell: ({ comment }) => getTextValue(comment, t("cluster.common.none")), sortingField: "comment", minWidth: 260 },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (alias) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              onClick={() => {
                setSelectedAlias(alias);
                setAliasForm({ name: alias.name, cidr: alias.cidr, comment: alias.comment ?? "" });
                setAliasEditorMode("edit");
                setActionError(null);
                setAliasEditorVisible(true);
              }}
            >
              {t("firewall.editAlias")}
            </Button>
            <Button onClick={() => { setSelectedAlias(alias); setActionError(null); setDeleteAliasVisible(true); }}>{t("firewall.deleteAlias")}</Button>
          </SpaceBetween>
        ),
        minWidth: 220,
      },
    ],
    [t],
  );

  const groupRulesColumnDefinitions = useMemo<TableProps<FirewallRule>["columnDefinitions"]>(
    () => [
      { id: "pos", header: t("firewall.position"), cell: ({ pos }) => String(pos), sortingField: "pos", isRowHeader: true, minWidth: 90 },
      { id: "type", header: t("firewall.type"), cell: ({ type }) => ruleTypeLabel(type), sortingComparator: (a, b) => ruleTypeLabel(a.type).localeCompare(ruleTypeLabel(b.type)), minWidth: 120 },
      { id: "action", header: t("firewall.action"), cell: ({ action }) => actionLabel(action), sortingComparator: (a, b) => actionLabel(a.action).localeCompare(actionLabel(b.action)), minWidth: 140 },
      { id: "proto", header: t("firewall.protocol"), cell: ({ proto }) => getTextValue(proto, t("firewall.anyProtocol")), sortingField: "proto", minWidth: 120 },
      { id: "source", header: t("firewall.source"), cell: ({ source }) => getTextValue(source, t("cluster.common.none")), sortingField: "source", minWidth: 160 },
      { id: "dest", header: t("firewall.destination"), cell: ({ dest }) => getTextValue(dest, t("cluster.common.none")), sortingField: "dest", minWidth: 160 },
      { id: "dport", header: t("firewall.destinationPort"), cell: ({ dport }) => getTextValue(dport, t("cluster.common.none")), sortingField: "dport", minWidth: 140 },
      { id: "comment", header: t("firewall.comment"), cell: ({ comment }) => getTextValue(comment, t("cluster.common.none")), sortingField: "comment", minWidth: 220 },
      { id: "enable", header: t("firewall.enable"), cell: (rule) => <StatusIndicator type={isEnabled(rule.enable) ? "success" : "stopped"}>{isEnabled(rule.enable) ? t("firewall.enabled") : t("firewall.disabled")}</StatusIndicator>, minWidth: 140 },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (rule) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              onClick={() => {
                setSelectedGroupRule(rule);
                setRuleForm(buildRuleForm(rule));
                setGroupRuleEditorMode("edit");
                setActionError(null);
                setGroupRuleEditorVisible(true);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button
              onClick={() => {
                setSelectedGroupRule(rule);
                setActionError(null);
                setDeleteGroupRuleVisible(true);
              }}
            >
              {t("firewall.deleteGroupRule")}
            </Button>
          </SpaceBetween>
        ),
        minWidth: 220,
      },
    ],
    [actionLabel, ruleTypeLabel, t],
  );

  const { actions: rulesActions, items: ruleItems, collectionProps: ruleCollectionProps, filterProps: ruleFilterProps, filteredItemsCount: filteredRulesCount, paginationProps: rulePaginationProps } = useCollection(rules, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) return true;
        return [String(item.pos), item.type ?? "", item.action ?? "", item.macro ?? "", item.proto ?? "", item.source ?? "", item.dest ?? "", item.dport ?? "", item.sport ?? "", item.comment ?? "", isEnabled(item.enable) ? t("firewall.enabled") : t("firewall.disabled")].some((value) => value.toLowerCase().includes(query));
      },
      empty: rulesEmptyState,
      noMatch: renderCenteredState(t("common.noMatches"), t("firewall.noRulesMatch")),
    },
    sorting: { defaultState: { sortingColumn: rulesColumnDefinitions[0] } },
    pagination: { pageSize: rulePreferences.pageSize },
  });

  const { actions: ipSetActions, items: ipSetItems, collectionProps: ipSetCollectionProps, filterProps: ipSetFilterProps, filteredItemsCount: filteredIpSetCount, paginationProps: ipSetPaginationProps } = useCollection(ipSets, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) return true;
        return [item.name, item.comment ?? "", item.digest ?? ""].some((value) => value.toLowerCase().includes(query));
      },
      empty: ipSetsEmptyState,
      noMatch: renderCenteredState(t("common.noMatches"), t("firewall.noIpSetsMatch")),
    },
    sorting: { defaultState: { sortingColumn: ipSetColumnDefinitions[0] } },
    pagination: { pageSize: ipSetPreferences.pageSize },
  });

  const { actions: groupActions, items: groupItems, collectionProps: groupCollectionProps, filterProps: groupFilterProps, filteredItemsCount: filteredGroupsCount, paginationProps: groupPaginationProps } = useCollection(groups, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) return true;
        return [item.group, item.comment ?? ""].some((value) => value.toLowerCase().includes(query));
      },
      empty: groupsEmptyState,
      noMatch: renderCenteredState(t("common.noMatches"), t("firewall.noGroupsMatch")),
    },
    sorting: { defaultState: { sortingColumn: groupColumnDefinitions[0] } },
    pagination: { pageSize: groupPreferences.pageSize },
  });

  const { actions: aliasActions, items: aliasItems, collectionProps: aliasCollectionProps, filterProps: aliasFilterProps, filteredItemsCount: filteredAliasesCount, paginationProps: aliasPaginationProps } = useCollection(aliases, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) return true;
        return [item.name, item.cidr, item.comment ?? ""].some((value) => value.toLowerCase().includes(query));
      },
      empty: aliasesEmptyState,
      noMatch: renderCenteredState(t("common.noMatches"), t("firewall.noAliasesMatch")),
    },
    sorting: { defaultState: { sortingColumn: aliasColumnDefinitions[0] } },
    pagination: { pageSize: aliasPreferences.pageSize },
  });

  const openCreateRuleModal = useCallback(() => {
    setSelectedRule(null);
    setRuleForm(EMPTY_RULE_FORM);
    setActionError(null);
    setCreateRuleVisible(true);
  }, []);

  const openEditOptionsModal = useCallback(() => {
    setOptionsForm(options ? buildOptionsForm(options) : EMPTY_OPTIONS_FORM);
    setActionError(null);
    setEditOptionsVisible(true);
  }, [options]);

  const openCreateIpSetModal = useCallback(() => {
    setSelectedIpSet(null);
    setIpSetForm(EMPTY_IP_SET_FORM);
    setActionError(null);
    setCreateIpSetVisible(true);
  }, []);

  const openCreateGroupModal = useCallback(() => {
    setSelectedGroup(null);
    setGroupForm(EMPTY_GROUP_FORM);
    setActionError(null);
    setCreateGroupVisible(true);
  }, []);

  const openCreateAliasModal = useCallback(() => {
    setSelectedAlias(null);
    setAliasForm(EMPTY_ALIAS_FORM);
    setAliasEditorMode("create");
    setActionError(null);
    setAliasEditorVisible(true);
  }, []);

  const submitRule = useCallback(async (mode: "create" | "edit") => {
    try {
      if (mode === "edit" && !selectedRule) {
        throw new Error(t("firewall.updateRuleFailed"));
      }

      setSubmitting(true);
      setActionError(null);

      const params = new URLSearchParams();
      params.set("type", ruleForm.type || "in");
      params.set("action", ruleForm.action || "ACCEPT");
      params.set("enable", ruleForm.enable ? "1" : "0");
      setOptionalParameters(params, { macro: ruleForm.macro, proto: ruleForm.proto, source: ruleForm.source, dest: ruleForm.dest, dport: ruleForm.dport, sport: ruleForm.sport, comment: ruleForm.comment }, mode === "edit");

      const path = mode === "create" ? "/api/proxmox/cluster/firewall/rules" : `/api/proxmox/cluster/firewall/rules/${selectedRule?.pos ?? 0}`;
      await fetchProxmox<string>(path, t, { method: mode === "create" ? "POST" : "PUT", ...encodeFormBody(params) });

      if (mode === "create") {
        setCreateRuleVisible(false);
        addFlash({ id: `firewall-rule-create-${Date.now()}`, type: "success", content: t("firewall.createRuleSuccess"), dismissible: true });
      } else {
        setEditRuleVisible(false);
        addFlash({ id: `firewall-rule-update-${Date.now()}`, type: "success", content: t("firewall.updateRuleSuccess"), dismissible: true });
      }

      await loadRules();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : mode === "create" ? t("firewall.createRuleFailed") : t("firewall.updateRuleFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadRules, ruleForm, selectedRule, t]);

  const deleteRule = useCallback(async () => {
    if (!selectedRule) return;

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/cluster/firewall/rules/${selectedRule.pos}`, t, { method: "DELETE", ...encodeFormBody(new URLSearchParams()) });
      setDeleteRuleVisible(false);
      addFlash({ id: `firewall-rule-delete-${Date.now()}`, type: "success", content: t("firewall.deleteRuleSuccess"), dismissible: true });
      await loadRules();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t("firewall.deleteRuleFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadRules, selectedRule, t]);

  const submitOptions = useCallback(async () => {
    try {
      setSubmitting(true);
      setActionError(null);

      const params = new URLSearchParams();
      params.set("enable", optionsForm.enable ? "1" : "0");
      params.set("policy_in", optionsForm.policyIn || "DROP");
      params.set("policy_out", optionsForm.policyOut || "ACCEPT");
      params.set("ebtables", optionsForm.ebtables ? "1" : "0");
      setOptionalParameters(params, { log_ratelimit: optionsForm.logRateLimit }, true);

      await fetchProxmox<string>("/api/proxmox/cluster/firewall/options", t, { method: "PUT", ...encodeFormBody(params) });

      setEditOptionsVisible(false);
      addFlash({ id: `firewall-options-update-${Date.now()}`, type: "success", content: t("firewall.updateOptionsSuccess"), dismissible: true });
      await loadOptions();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : t("firewall.updateOptionsFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadOptions, optionsForm, t]);

  const submitIpSet = useCallback(async () => {
    try {
      const name = ipSetForm.name.trim();
      if (!name) throw new Error(t("firewall.ipSetNameRequired"));

      setSubmitting(true);
      setActionError(null);

      const params = new URLSearchParams();
      params.set("name", name);
      if (ipSetForm.comment.trim()) params.set("comment", ipSetForm.comment.trim());

      await fetchProxmox<string>("/api/proxmox/cluster/firewall/ipset", t, { method: "POST", ...encodeFormBody(params) });

      setCreateIpSetVisible(false);
      addFlash({ id: `firewall-ipset-create-${Date.now()}`, type: "success", content: t("firewall.createIpSetSuccess"), dismissible: true });
      await loadIpSets();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : t("firewall.createIpSetFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, ipSetForm, loadIpSets, t]);

  const deleteIpSet = useCallback(async () => {
    if (!selectedIpSet) return;

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/cluster/firewall/ipset/${encodeURIComponent(selectedIpSet.name)}`, t, { method: "DELETE", ...encodeFormBody(new URLSearchParams()) });
      setDeleteIpSetVisible(false);
      addFlash({ id: `firewall-ipset-delete-${Date.now()}`, type: "success", content: t("firewall.deleteIpSetSuccess"), dismissible: true });
      await loadIpSets();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t("firewall.deleteIpSetFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadIpSets, selectedIpSet, t]);

  const submitGroup = useCallback(async () => {
    try {
      const name = groupForm.group.trim();
      if (!name) throw new Error(t("firewall.groupNameRequired"));

      setSubmitting(true);
      setActionError(null);

      const params = new URLSearchParams();
      params.set("group", name);
      if (groupForm.comment.trim()) params.set("comment", groupForm.comment.trim());

      await fetchProxmox<string>("/api/proxmox/cluster/firewall/groups", t, { method: "POST", ...encodeFormBody(params) });

      setCreateGroupVisible(false);
      addFlash({ id: `firewall-group-create-${Date.now()}`, type: "success", content: interpolate(t("firewall.groupCreated"), { name }), dismissible: true });
      await loadGroups();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : t("firewall.createGroupFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, groupForm, loadGroups, t]);

  const deleteGroup = useCallback(async () => {
    if (!selectedGroup) return;

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/cluster/firewall/groups/${encodeURIComponent(selectedGroup.group)}`, t, { method: "DELETE", ...encodeFormBody(new URLSearchParams()) });
      setDeleteGroupVisible(false);
      addFlash({ id: `firewall-group-delete-${Date.now()}`, type: "success", content: interpolate(t("firewall.groupDeleted"), { name: selectedGroup.group }), dismissible: true });
      if (groupRulesVisible && selectedGroup) {
        setGroupRulesVisible(false);
      }
      await loadGroups();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t("firewall.deleteGroupFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, groupRulesVisible, loadGroups, selectedGroup, t]);

  const submitGroupRule = useCallback(async (mode: "create" | "edit") => {
    try {
      if (!selectedGroup) {
        throw new Error(mode === "create" ? t("firewall.createGroupRuleFailed") : t("firewall.updateRuleFailed"));
      }

      if (mode === "edit" && !selectedGroupRule) {
        throw new Error(t("firewall.updateRuleFailed"));
      }

      setSubmitting(true);
      setActionError(null);

      const params = new URLSearchParams();
      params.set("type", ruleForm.type || "in");
      params.set("action", ruleForm.action || "ACCEPT");
      params.set("enable", ruleForm.enable ? "1" : "0");
      setOptionalParameters(params, { macro: ruleForm.macro, proto: ruleForm.proto, source: ruleForm.source, dest: ruleForm.dest, dport: ruleForm.dport, sport: ruleForm.sport, comment: ruleForm.comment }, mode === "edit");

      const path = mode === "create"
        ? `/api/proxmox/cluster/firewall/groups/${encodeURIComponent(selectedGroup.group)}`
        : `/api/proxmox/cluster/firewall/groups/${encodeURIComponent(selectedGroup.group)}/${selectedGroupRule?.pos ?? 0}`;

      await fetchProxmox<string>(path, t, { method: mode === "create" ? "POST" : "PUT", ...encodeFormBody(params) });

      setGroupRuleEditorVisible(false);
      setSelectedGroupRule(null);
      addFlash({
        id: `firewall-group-rule-${mode}-${Date.now()}`,
        type: "success",
        content: mode === "create"
          ? interpolate(t("firewall.groupRuleCreated"), { name: selectedGroup.group })
          : t("firewall.updateRuleSuccess"),
        dismissible: true,
      });
      await loadGroupRules(selectedGroup.group);
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : mode === "create" ? t("firewall.createGroupRuleFailed") : t("firewall.updateRuleFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadGroupRules, ruleForm, selectedGroup, selectedGroupRule, t]);

  const deleteGroupRule = useCallback(async () => {
    if (!selectedGroup || !selectedGroupRule) return;

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/cluster/firewall/groups/${encodeURIComponent(selectedGroup.group)}/${selectedGroupRule.pos}`, t, { method: "DELETE", ...encodeFormBody(new URLSearchParams()) });
      setDeleteGroupRuleVisible(false);
      addFlash({ id: `firewall-group-rule-delete-${Date.now()}`, type: "success", content: interpolate(t("firewall.groupRuleDeleted"), { name: selectedGroup.group }), dismissible: true });
      await loadGroupRules(selectedGroup.group);
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t("firewall.deleteGroupRuleFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadGroupRules, selectedGroup, selectedGroupRule, t]);

  const submitAlias = useCallback(async (mode: "create" | "edit") => {
    try {
      const name = aliasForm.name.trim();
      const cidr = aliasForm.cidr.trim();

      if (mode === "create" && !name) throw new Error(t("firewall.aliasNameRequired"));
      if (mode === "edit" && !selectedAlias) throw new Error(t("firewall.updateAliasFailed"));
      if (!cidr) throw new Error(t("firewall.aliasCidrRequired"));

      setSubmitting(true);
      setActionError(null);

      const params = new URLSearchParams();
      if (mode === "create") params.set("name", name);
      params.set("cidr", cidr);
      params.set("comment", aliasForm.comment.trim());

      const targetName = mode === "create" ? name : selectedAlias?.name ?? "";
      const path = mode === "create"
        ? "/api/proxmox/cluster/firewall/aliases"
        : `/api/proxmox/cluster/firewall/aliases/${encodeURIComponent(targetName)}`;

      await fetchProxmox<string>(path, t, { method: mode === "create" ? "POST" : "PUT", ...encodeFormBody(params) });

      setAliasEditorVisible(false);
      addFlash({
        id: `firewall-alias-${mode}-${Date.now()}`,
        type: "success",
        content: mode === "create"
          ? interpolate(t("firewall.aliasCreated"), { name: targetName })
          : interpolate(t("firewall.aliasUpdated"), { name: targetName }),
        dismissible: true,
      });
      await loadAliases();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : mode === "create" ? t("firewall.createAliasFailed") : t("firewall.updateAliasFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, aliasForm, loadAliases, selectedAlias, t]);

  const deleteAlias = useCallback(async () => {
    if (!selectedAlias) return;

    try {
      setSubmitting(true);
      setActionError(null);
      await fetchProxmox<string>(`/api/proxmox/cluster/firewall/aliases/${encodeURIComponent(selectedAlias.name)}`, t, { method: "DELETE", ...encodeFormBody(new URLSearchParams()) });
      setDeleteAliasVisible(false);
      addFlash({ id: `firewall-alias-delete-${Date.now()}`, type: "success", content: interpolate(t("firewall.aliasDeleted"), { name: selectedAlias.name }), dismissible: true });
      await loadAliases();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t("firewall.deleteAliasFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadAliases, selectedAlias, t]);

  const optionsDetails = options ? buildOptionsForm(options) : EMPTY_OPTIONS_FORM;
  const ruleHeaderCounter = ruleFilterProps.filteringText ? `(${filteredRulesCount}/${rules.length})` : `(${rules.length})`;
  const ipSetHeaderCounter = ipSetFilterProps.filteringText ? `(${filteredIpSetCount}/${ipSets.length})` : `(${ipSets.length})`;
  const groupHeaderCounter = groupFilterProps.filteringText ? `(${filteredGroupsCount}/${groups.length})` : `(${groups.length})`;
  const aliasHeaderCounter = aliasFilterProps.filteringText ? `(${filteredAliasesCount}/${aliases.length})` : `(${aliases.length})`;

  const ruleFormContent = (
    <SpaceBetween size="m">
      {actionError ? <Alert type="error">{actionError}</Alert> : null}
      <FormField label={t("firewall.type")}><Select selectedOption={typeOptions.find((option) => option.value === ruleForm.type) ?? null} onChange={({ detail }) => setRuleForm((current) => ({ ...current, type: getTrackableValue(detail.selectedOption) || "in" }))} options={typeOptions} /></FormField>
      <FormField label={t("firewall.action")}><Select selectedOption={actionOptions.find((option) => option.value === ruleForm.action) ?? null} onChange={({ detail }) => setRuleForm((current) => ({ ...current, action: getTrackableValue(detail.selectedOption) || "ACCEPT" }))} options={actionOptions} /></FormField>
      <FormField label={t("firewall.macro")}><Select selectedOption={macroOptions.find((option) => option.value === ruleForm.macro) ?? null} onChange={({ detail }) => setRuleForm((current) => ({ ...current, macro: getTrackableValue(detail.selectedOption) }))} options={macroOptions} /></FormField>
      <FormField label={t("firewall.protocol")}><Select selectedOption={protocolOptions.find((option) => option.value === ruleForm.proto) ?? null} onChange={({ detail }) => setRuleForm((current) => ({ ...current, proto: getTrackableValue(detail.selectedOption) }))} options={protocolOptions} /></FormField>
      <FormField label={t("firewall.source")}><Input value={ruleForm.source} placeholder={t("firewall.sourcePlaceholder")} onChange={({ detail }) => setRuleForm((current) => ({ ...current, source: detail.value }))} /></FormField>
      <FormField label={t("firewall.destination")}><Input value={ruleForm.dest} placeholder={t("firewall.destinationPlaceholder")} onChange={({ detail }) => setRuleForm((current) => ({ ...current, dest: detail.value }))} /></FormField>
      <FormField label={t("firewall.destinationPort")}><Input value={ruleForm.dport} placeholder={t("firewall.destinationPortPlaceholder")} onChange={({ detail }) => setRuleForm((current) => ({ ...current, dport: detail.value }))} /></FormField>
      <FormField label={t("firewall.sourcePort")}><Input value={ruleForm.sport} placeholder={t("firewall.sourcePortPlaceholder")} onChange={({ detail }) => setRuleForm((current) => ({ ...current, sport: detail.value }))} /></FormField>
      <FormField label={t("firewall.comment")}><Textarea value={ruleForm.comment} placeholder={t("firewall.commentPlaceholder")} onChange={({ detail }) => setRuleForm((current) => ({ ...current, comment: detail.value }))} /></FormField>
      <Checkbox checked={ruleForm.enable} onChange={({ detail }) => setRuleForm((current) => ({ ...current, enable: detail.checked }))}>{t("firewall.enable")}</Checkbox>
    </SpaceBetween>
  );

  const entriesColumnDefinitions = useMemo<TableProps<FirewallIpSetEntry>["columnDefinitions"]>(
    () => [
      { id: "cidr", header: t("firewall.entry"), cell: ({ cidr }) => getTextValue(cidr, t("cluster.common.none")), isRowHeader: true },
      { id: "nomatch", header: t("firewall.nomatch"), cell: (entry) => (isEnabled(entry.nomatch) ? t("common.yes") : t("common.no")) },
      { id: "comment", header: t("firewall.comment"), cell: ({ comment }) => getTextValue(comment, t("cluster.common.none")) },
    ],
    [t],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={t("firewall.pageDescription")} actions={<Button iconName="refresh" onClick={() => void loadAll()}>{t("common.refresh")}</Button>}>
        {t("firewall.pageTitle")}
      </Header>

      {flashItems.length > 0 ? <Flashbar items={flashItems.map((item) => ({ ...item, onDismiss: () => dismissFlash(item.id ?? "") }))} /> : null}

      {error ? <Alert type="error" header={t("common.error")}>{error}</Alert> : null}

      <Tabs
        activeTabId={activeTabId}
        onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
        tabs={[
          {
            id: "rules",
            label: t("firewall.clusterRulesTab"),
            content: (
              <Table
                {...ruleCollectionProps}
                items={ruleItems}
                columnDefinitions={rulesColumnDefinitions}
                trackBy="pos"
                loading={rulesLoading}
                loadingText={t("firewall.loadingRules")}
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                wrapLines={rulePreferences.wrapLines}
                stripedRows={rulePreferences.stripedRows}
                contentDensity={rulePreferences.contentDensity}
                columnDisplay={rulePreferences.contentDisplay}
                empty={ruleFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("firewall.noRulesMatch"), <Button onClick={() => rulesActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : rulesEmptyState}
                header={<Header counter={ruleHeaderCounter} description={t("firewall.clusterRulesDescription")} actions={<SpaceBetween direction="horizontal" size="xs"><Button iconName="refresh" onClick={() => void loadRules()}>{t("common.refresh")}</Button><Button variant="primary" onClick={openCreateRuleModal}>{t("firewall.addRule")}</Button></SpaceBetween>}>{t("firewall.clusterRulesTab")}</Header>}
                filter={<TextFilter {...ruleFilterProps} filteringPlaceholder={t("firewall.findRules")} countText={`${filteredRulesCount ?? rules.length} ${t("common.matches")}`} />}
                pagination={<Pagination {...rulePaginationProps} />}
                preferences={<CollectionPreferences title={t("common.preferences")} confirmLabel={t("common.confirm")} cancelLabel={t("common.cancel")} preferences={rulePreferences} onConfirm={({ detail }) => updatePreferences(detail, setRulePreferences)} pageSizePreference={{ title: t("common.pageSize"), options: [{ value: 10, label: t("firewall.rulesCount10") }, { value: 20, label: t("firewall.rulesCount20") }, { value: 50, label: t("firewall.rulesCount50") }] }} wrapLinesPreference={{ label: t("common.wrapLines"), description: t("firewall.wrapLinesDesc") }} stripedRowsPreference={{ label: t("common.stripedRows"), description: t("firewall.stripedRowsDesc") }} contentDensityPreference={{ label: t("common.contentDensity"), description: t("firewall.contentDensityDesc") }} contentDisplayPreference={{ title: t("common.columnPreferences"), options: [{ id: "pos", label: t("firewall.position"), alwaysVisible: true }, { id: "type", label: t("firewall.type") }, { id: "action", label: t("firewall.action") }, { id: "macro", label: t("firewall.macro") }, { id: "proto", label: t("firewall.protocol") }, { id: "source", label: t("firewall.source") }, { id: "dest", label: t("firewall.destination") }, { id: "dport", label: t("firewall.destinationPort") }, { id: "sport", label: t("firewall.sourcePort") }, { id: "comment", label: t("firewall.comment") }, { id: "enable", label: t("firewall.enable") }, { id: "actions", label: t("common.actions") }] }} />}
              />
            ),
          },
          {
            id: "options",
            label: t("firewall.clusterOptionsTab"),
            content: (
              <SpaceBetween size="l">
                <Header description={t("firewall.clusterOptionsDescription")} actions={<SpaceBetween direction="horizontal" size="xs"><Button iconName="refresh" onClick={() => void loadOptions()}>{t("common.refresh")}</Button><Button variant="primary" onClick={openEditOptionsModal}>{t("common.edit")}</Button></SpaceBetween>}>{t("firewall.clusterOptionsTab")}</Header>
                {optionsLoading ? (
                  <Box>{t("firewall.loadingOptions")}</Box>
                ) : (
                  <KeyValuePairs columns={2} items={[{ label: t("firewall.enable"), value: <StatusIndicator type={optionsDetails.enable ? "success" : "stopped"}>{optionsDetails.enable ? t("firewall.enabled") : t("firewall.disabled")}</StatusIndicator> }, { label: t("firewall.policyIn"), value: actionLabel(optionsDetails.policyIn) }, { label: t("firewall.policyOut"), value: actionLabel(optionsDetails.policyOut) }, { label: t("firewall.logRateLimit"), value: getTextValue(optionsDetails.logRateLimit, t("cluster.common.none")) }, { label: t("firewall.ebtables"), value: <StatusIndicator type={optionsDetails.ebtables ? "success" : "stopped"}>{optionsDetails.ebtables ? t("common.yes") : t("common.no")}</StatusIndicator> }]} />
                )}
              </SpaceBetween>
            ),
          },
          {
            id: "ipsets",
            label: t("firewall.ipSetsTab"),
            content: (
              <Table
                {...ipSetCollectionProps}
                items={ipSetItems}
                columnDefinitions={ipSetColumnDefinitions}
                trackBy="name"
                loading={ipSetsLoading}
                loadingText={t("firewall.loadingIpSets")}
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                wrapLines={ipSetPreferences.wrapLines}
                stripedRows={ipSetPreferences.stripedRows}
                contentDensity={ipSetPreferences.contentDensity}
                columnDisplay={ipSetPreferences.contentDisplay}
                empty={ipSetFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("firewall.noIpSetsMatch"), <Button onClick={() => ipSetActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : ipSetsEmptyState}
                header={<Header counter={ipSetHeaderCounter} description={t("firewall.ipSetsDescription")} actions={<SpaceBetween direction="horizontal" size="xs"><Button iconName="refresh" onClick={() => void loadIpSets()}>{t("common.refresh")}</Button><Button variant="primary" onClick={openCreateIpSetModal}>{t("firewall.createIpSet")}</Button></SpaceBetween>}>{t("firewall.ipSetsTab")}</Header>}
                filter={<TextFilter {...ipSetFilterProps} filteringPlaceholder={t("firewall.findIpSets")} countText={`${filteredIpSetCount ?? ipSets.length} ${t("common.matches")}`} />}
                pagination={<Pagination {...ipSetPaginationProps} />}
                preferences={<CollectionPreferences title={t("common.preferences")} confirmLabel={t("common.confirm")} cancelLabel={t("common.cancel")} preferences={ipSetPreferences} onConfirm={({ detail }) => updatePreferences(detail, setIpSetPreferences)} pageSizePreference={{ title: t("common.pageSize"), options: [{ value: 10, label: t("firewall.ipSetsCount10") }, { value: 20, label: t("firewall.ipSetsCount20") }, { value: 50, label: t("firewall.ipSetsCount50") }] }} wrapLinesPreference={{ label: t("common.wrapLines"), description: t("firewall.wrapLinesDesc") }} stripedRowsPreference={{ label: t("common.stripedRows"), description: t("firewall.stripedRowsDesc") }} contentDensityPreference={{ label: t("common.contentDensity"), description: t("firewall.contentDensityDesc") }} contentDisplayPreference={{ title: t("common.columnPreferences"), options: [{ id: "name", label: t("common.name"), alwaysVisible: true }, { id: "comment", label: t("firewall.comment") }, { id: "digest", label: t("firewall.digest") }, { id: "actions", label: t("common.actions") }] }} />}
              />
            ),
          },
          {
            id: "security-groups",
            label: t("firewall.securityGroupsTab"),
            content: (
              <Table
                {...groupCollectionProps}
                items={groupItems}
                columnDefinitions={groupColumnDefinitions}
                trackBy="group"
                loading={groupsLoading}
                loadingText={t("firewall.loadingGroups")}
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                wrapLines={groupPreferences.wrapLines}
                stripedRows={groupPreferences.stripedRows}
                contentDensity={groupPreferences.contentDensity}
                columnDisplay={groupPreferences.contentDisplay}
                empty={groupFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("firewall.noGroupsMatch"), <Button onClick={() => groupActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : groupsEmptyState}
                header={<Header counter={groupHeaderCounter} description={t("firewall.securityGroupsDescription")} actions={<SpaceBetween direction="horizontal" size="xs"><Button iconName="refresh" onClick={() => void loadGroups()}>{t("common.refresh")}</Button><Button variant="primary" onClick={openCreateGroupModal}>{t("firewall.createGroup")}</Button></SpaceBetween>}>{t("firewall.securityGroupsTab")}</Header>}
                filter={<TextFilter {...groupFilterProps} filteringPlaceholder={t("firewall.findGroups")} countText={`${filteredGroupsCount ?? groups.length} ${t("common.matches")}`} />}
                pagination={<Pagination {...groupPaginationProps} />}
                preferences={<CollectionPreferences title={t("common.preferences")} confirmLabel={t("common.confirm")} cancelLabel={t("common.cancel")} preferences={groupPreferences} onConfirm={({ detail }) => updatePreferences(detail, setGroupPreferences)} pageSizePreference={{ title: t("common.pageSize"), options: [{ value: 10, label: t("firewall.groupsCount10") }, { value: 20, label: t("firewall.groupsCount20") }, { value: 50, label: t("firewall.groupsCount50") }] }} wrapLinesPreference={{ label: t("common.wrapLines"), description: t("firewall.wrapLinesDesc") }} stripedRowsPreference={{ label: t("common.stripedRows"), description: t("firewall.stripedRowsDesc") }} contentDensityPreference={{ label: t("common.contentDensity"), description: t("firewall.contentDensityDesc") }} contentDisplayPreference={{ title: t("common.columnPreferences"), options: [{ id: "group", label: t("firewall.groupName"), alwaysVisible: true }, { id: "comment", label: t("firewall.comment") }, { id: "actions", label: t("common.actions") }] }} />}
              />
            ),
          },
          {
            id: "aliases",
            label: t("firewall.aliasesTab"),
            content: (
              <Table
                {...aliasCollectionProps}
                items={aliasItems}
                columnDefinitions={aliasColumnDefinitions}
                trackBy="name"
                loading={aliasesLoading}
                loadingText={t("firewall.loadingAliases")}
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                wrapLines={aliasPreferences.wrapLines}
                stripedRows={aliasPreferences.stripedRows}
                contentDensity={aliasPreferences.contentDensity}
                columnDisplay={aliasPreferences.contentDisplay}
                empty={aliasFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("firewall.noAliasesMatch"), <Button onClick={() => aliasActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : aliasesEmptyState}
                header={<Header counter={aliasHeaderCounter} description={t("firewall.aliasesDescription")} actions={<SpaceBetween direction="horizontal" size="xs"><Button iconName="refresh" onClick={() => void loadAliases()}>{t("common.refresh")}</Button><Button variant="primary" onClick={openCreateAliasModal}>{t("firewall.createAlias")}</Button></SpaceBetween>}>{t("firewall.aliasesTab")}</Header>}
                filter={<TextFilter {...aliasFilterProps} filteringPlaceholder={t("firewall.findAliases")} countText={`${filteredAliasesCount ?? aliases.length} ${t("common.matches")}`} />}
                pagination={<Pagination {...aliasPaginationProps} />}
                preferences={<CollectionPreferences title={t("common.preferences")} confirmLabel={t("common.confirm")} cancelLabel={t("common.cancel")} preferences={aliasPreferences} onConfirm={({ detail }) => updatePreferences(detail, setAliasPreferences)} pageSizePreference={{ title: t("common.pageSize"), options: [{ value: 10, label: t("firewall.aliasesCount10") }, { value: 20, label: t("firewall.aliasesCount20") }, { value: 50, label: t("firewall.aliasesCount50") }] }} wrapLinesPreference={{ label: t("common.wrapLines"), description: t("firewall.wrapLinesDesc") }} stripedRowsPreference={{ label: t("common.stripedRows"), description: t("firewall.stripedRowsDesc") }} contentDensityPreference={{ label: t("common.contentDensity"), description: t("firewall.contentDensityDesc") }} contentDisplayPreference={{ title: t("common.columnPreferences"), options: [{ id: "name", label: t("firewall.aliasName"), alwaysVisible: true }, { id: "cidr", label: t("firewall.aliasCidr") }, { id: "comment", label: t("firewall.aliasComment") }, { id: "actions", label: t("common.actions") }] }} />}
              />
            ),
          },
        ]}
      />

      <Modal visible={createRuleVisible} onDismiss={() => setCreateRuleVisible(false)} header={t("firewall.addRuleModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setCreateRuleVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void submitRule("create")}>{t("common.create")}</Button></SpaceBetween>}>
        {ruleFormContent}
      </Modal>

      <Modal visible={editRuleVisible} onDismiss={() => setEditRuleVisible(false)} header={t("firewall.editRuleModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setEditRuleVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void submitRule("edit")}>{t("common.save")}</Button></SpaceBetween>}>
        {ruleFormContent}
      </Modal>

      <Modal visible={deleteRuleVisible} onDismiss={() => setDeleteRuleVisible(false)} header={t("firewall.deleteRuleModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setDeleteRuleVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void deleteRule()}>{t("common.delete")}</Button></SpaceBetween>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <Box>{selectedRule ? interpolate(t("firewall.ruleDeleteConfirmation"), { pos: selectedRule.pos }) : null}</Box>
        </SpaceBetween>
      </Modal>

      <Modal visible={editOptionsVisible} onDismiss={() => setEditOptionsVisible(false)} header={t("firewall.editOptionsModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setEditOptionsVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void submitOptions()}>{t("common.save")}</Button></SpaceBetween>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <Checkbox checked={optionsForm.enable} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, enable: detail.checked }))}>{t("firewall.enable")}</Checkbox>
          <FormField label={t("firewall.policyIn")}><Select selectedOption={actionOptions.find((option) => option.value === optionsForm.policyIn) ?? null} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, policyIn: getTrackableValue(detail.selectedOption) || "DROP" }))} options={actionOptions} /></FormField>
          <FormField label={t("firewall.policyOut")}><Select selectedOption={actionOptions.find((option) => option.value === optionsForm.policyOut) ?? null} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, policyOut: getTrackableValue(detail.selectedOption) || "ACCEPT" }))} options={actionOptions} /></FormField>
          <FormField label={t("firewall.logRateLimit")}><Input value={optionsForm.logRateLimit} placeholder={t("firewall.logRateLimitPlaceholder")} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, logRateLimit: detail.value }))} /></FormField>
          <Checkbox checked={optionsForm.ebtables} onChange={({ detail }) => setOptionsForm((current) => ({ ...current, ebtables: detail.checked }))}>{t("firewall.ebtables")}</Checkbox>
        </SpaceBetween>
      </Modal>

      <Modal visible={createIpSetVisible} onDismiss={() => setCreateIpSetVisible(false)} header={t("firewall.createIpSetModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setCreateIpSetVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void submitIpSet()}>{t("common.create")}</Button></SpaceBetween>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <FormField label={t("common.name")}><Input value={ipSetForm.name} placeholder={t("firewall.ipSetNamePlaceholder")} onChange={({ detail }) => setIpSetForm((current) => ({ ...current, name: detail.value }))} /></FormField>
          <FormField label={t("firewall.comment")}><Textarea value={ipSetForm.comment} placeholder={t("firewall.commentPlaceholder")} onChange={({ detail }) => setIpSetForm((current) => ({ ...current, comment: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>

      <Modal visible={deleteIpSetVisible} onDismiss={() => setDeleteIpSetVisible(false)} header={t("firewall.deleteIpSetModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setDeleteIpSetVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void deleteIpSet()}>{t("common.delete")}</Button></SpaceBetween>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <Box>{selectedIpSet ? interpolate(t("firewall.ipSetDeleteConfirmation"), { name: selectedIpSet.name }) : null}</Box>
        </SpaceBetween>
      </Modal>

      <Modal visible={viewEntriesVisible} onDismiss={() => setViewEntriesVisible(false)} size="large" header={selectedIpSet ? interpolate(t("firewall.ipSetEntriesModalTitle"), { name: selectedIpSet.name }) : t("firewall.entries")} footer={<Button onClick={() => setViewEntriesVisible(false)}>{t("common.cancel")}</Button>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <Table items={ipSetEntries} columnDefinitions={entriesColumnDefinitions} trackBy={(item) => `${item.cidr ?? "entry"}:${item.comment ?? ""}`} loading={entriesLoading} loadingText={t("firewall.loadingEntries")} empty={renderCenteredState(t("firewall.noIpSetEntries"), t("firewall.noIpSetEntriesDescription"))} header={<Header>{t("firewall.entries")}</Header>} />
        </SpaceBetween>
      </Modal>

      <Modal visible={createGroupVisible} onDismiss={() => setCreateGroupVisible(false)} header={t("firewall.createGroupModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setCreateGroupVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void submitGroup()}>{t("common.create")}</Button></SpaceBetween>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <FormField label={t("firewall.groupName")}><Input value={groupForm.group} placeholder={t("firewall.groupNamePlaceholder")} onChange={({ detail }) => setGroupForm((current) => ({ ...current, group: detail.value }))} /></FormField>
          <FormField label={t("firewall.comment")}><Textarea value={groupForm.comment} placeholder={t("firewall.commentPlaceholder")} onChange={({ detail }) => setGroupForm((current) => ({ ...current, comment: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>

      <Modal visible={deleteGroupVisible} onDismiss={() => setDeleteGroupVisible(false)} header={t("firewall.deleteGroupModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setDeleteGroupVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void deleteGroup()}>{t("common.delete")}</Button></SpaceBetween>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <Box>{selectedGroup ? interpolate(t("firewall.deleteGroupConfirmation"), { name: selectedGroup.group }) : null}</Box>
        </SpaceBetween>
      </Modal>

      <Modal visible={groupRulesVisible} onDismiss={() => { setGroupRulesVisible(false); setGroupRuleEditorVisible(false); setDeleteGroupRuleVisible(false); }} size="max" header={selectedGroup ? interpolate(t("firewall.groupRulesModalTitle"), { name: selectedGroup.group }) : t("firewall.viewGroupRules")} footer={<Button onClick={() => setGroupRulesVisible(false)}>{t("common.cancel")}</Button>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <Header actions={<SpaceBetween direction="horizontal" size="xs"><Button iconName="refresh" onClick={() => selectedGroup ? void loadGroupRules(selectedGroup.group) : undefined}>{t("common.refresh")}</Button><Button variant="primary" onClick={() => { setSelectedGroupRule(null); setRuleForm(EMPTY_RULE_FORM); setGroupRuleEditorMode("create"); setActionError(null); setGroupRuleEditorVisible(true); }}>{t("firewall.addGroupRule")}</Button></SpaceBetween>}>{t("firewall.viewGroupRules")}</Header>
          <Table items={groupRules} columnDefinitions={groupRulesColumnDefinitions} trackBy="pos" loading={groupRulesLoading} loadingText={t("firewall.loadingRules")} empty={renderCenteredState(t("firewall.noGroupRules"), t("firewall.noGroupRules"))} />
          {groupRuleEditorVisible ? (
            <SpaceBetween size="m">
              <Header>{groupRuleEditorMode === "create" ? t("firewall.addGroupRule") : t("firewall.editRule")}</Header>
              {ruleFormContent}
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => { setGroupRuleEditorVisible(false); setSelectedGroupRule(null); }}>{t("common.cancel")}</Button>
                <Button variant="primary" loading={submitting} onClick={() => void submitGroupRule(groupRuleEditorMode)}>{groupRuleEditorMode === "create" ? t("common.create") : t("common.save")}</Button>
              </SpaceBetween>
            </SpaceBetween>
          ) : null}
          {deleteGroupRuleVisible ? (
            <SpaceBetween size="m">
              <Header>{t("firewall.deleteGroupRule")}</Header>
              <Box>{selectedGroupRule ? interpolate(t("firewall.ruleDeleteConfirmation"), { pos: selectedGroupRule.pos }) : null}</Box>
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setDeleteGroupRuleVisible(false)}>{t("common.cancel")}</Button>
                <Button variant="primary" loading={submitting} onClick={() => void deleteGroupRule()}>{t("common.delete")}</Button>
              </SpaceBetween>
            </SpaceBetween>
          ) : null}
        </SpaceBetween>
      </Modal>

      <Modal visible={aliasEditorVisible} onDismiss={() => setAliasEditorVisible(false)} header={aliasEditorMode === "create" ? t("firewall.createAliasModalTitle") : t("firewall.editAliasModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setAliasEditorVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void submitAlias(aliasEditorMode)}>{aliasEditorMode === "create" ? t("common.create") : t("common.save")}</Button></SpaceBetween>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <FormField label={t("firewall.aliasName")}><Input value={aliasForm.name} placeholder={t("firewall.aliasNamePlaceholder")} disabled={aliasEditorMode === "edit"} onChange={({ detail }) => setAliasForm((current) => ({ ...current, name: detail.value }))} /></FormField>
          <FormField label={t("firewall.aliasCidr")}><Input value={aliasForm.cidr} placeholder={t("firewall.aliasCidrPlaceholder")} onChange={({ detail }) => setAliasForm((current) => ({ ...current, cidr: detail.value }))} /></FormField>
          <FormField label={t("firewall.aliasComment")}><Textarea value={aliasForm.comment} placeholder={t("firewall.aliasCommentPlaceholder")} onChange={({ detail }) => setAliasForm((current) => ({ ...current, comment: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>

      <Modal visible={deleteAliasVisible} onDismiss={() => setDeleteAliasVisible(false)} header={t("firewall.deleteAliasModalTitle")} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setDeleteAliasVisible(false)}>{t("common.cancel")}</Button><Button variant="primary" loading={submitting} onClick={() => void deleteAlias()}>{t("common.delete")}</Button></SpaceBetween>}>
        <SpaceBetween size="m">
          {actionError ? <Alert type="error">{actionError}</Alert> : null}
          <Box>{selectedAlias ? interpolate(t("firewall.deleteAliasConfirmation"), { name: selectedAlias.name }) : null}</Box>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
