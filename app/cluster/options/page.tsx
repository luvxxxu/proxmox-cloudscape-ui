"use client";

import { requestResource } from "@/app/lib/resource-request";

import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Modal from "@cloudscape-design/components/modal";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Textarea from "@cloudscape-design/components/textarea";
import { useTranslation } from "@/app/lib/use-translation";

interface ClusterOptions {
  keyboard?: string;
  http_proxy?: string;
  email_from?: string;
  migration?: string;
  migration_type?: string;
  migration_cidr?: string;
  console?: string;
  mac_prefix?: string;
  ha?: string;
  ha_shutdown_policy?: string;
  u2f?: string;
  u2f_appid?: string;
  description?: string;
}

interface OptionsFormState {
  keyboard: string;
  httpProxy: string;
  emailFrom: string;
  migrationType: string;
  migrationNetwork: string;
  console: string;
  macPrefix: string;
  haShutdownPolicy: string;
  u2fAppId: string;
  description: string;
}

const EMPTY_FORM: OptionsFormState = {
  keyboard: "",
  httpProxy: "",
  emailFrom: "",
  migrationType: "",
  migrationNetwork: "",
  console: "",
  macPrefix: "",
  haShutdownPolicy: "",
  u2fAppId: "",
  description: "",
};





function parseConfigValue(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((result, entry) => {
      const [rawKey, ...rawValue] = entry.split("=");
      const key = rawKey?.trim();
      if (!key) {
        return result;
      }

      result[key] = rawValue.join("=").trim();
      return result;
    }, {});
}

function buildFormState(options: ClusterOptions): OptionsFormState {
  const migration = parseConfigValue(options.migration);
  const ha = parseConfigValue(options.ha);
  const u2f = parseConfigValue(options.u2f);

  return {
    keyboard: options.keyboard ?? "",
    httpProxy: options.http_proxy ?? "",
    emailFrom: options.email_from ?? "",
    migrationType: options.migration_type ?? migration.type ?? "",
    migrationNetwork: options.migration_cidr ?? migration.network ?? "",
    console: options.console ?? "",
    macPrefix: options.mac_prefix ?? "",
    haShutdownPolicy: options.ha_shutdown_policy ?? ha.shutdown_policy ?? ha["shutdown-policy"] ?? "",
    u2fAppId: options.u2f_appid ?? u2f.appid ?? "",
    description: options.description ?? "",
  };
}

async function fetchProxmox<T>(path: string, _t: (key: string) => string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function ClusterOptionsPage() {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ClusterOptions | null>(null);
  const [form, setForm] = useState<OptionsFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const addFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 5));
  }, []);

  const dismissFlash = useCallback((id: string) => {
    setFlashItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      setLoading(true);
      const nextOptions = await fetchProxmox<ClusterOptions>("/api/proxmox/cluster/options", t);
      setOptions(nextOptions ?? {});
      setError(null);
      setActionError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("cluster.options.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadOptions();
  }, [loadOptions]);

  const keyboardOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("cluster.options.keyboardEnUs"), value: "en-us" },
      { label: t("cluster.options.keyboardDe"), value: "de" },
      { label: t("cluster.options.keyboardEs"), value: "es" },
      { label: t("cluster.options.keyboardFr"), value: "fr" },
      { label: t("cluster.options.keyboardIt"), value: "it" },
      { label: t("cluster.options.keyboardJa"), value: "ja" },
      { label: t("cluster.options.keyboardKo"), value: "ko" },
      { label: t("cluster.options.keyboardNo"), value: "no" },
      { label: t("cluster.options.keyboardPt"), value: "pt" },
      { label: t("cluster.options.keyboardRu"), value: "ru" },
      { label: t("cluster.options.keyboardSv"), value: "sv" },
    ],
    [t],
  );

  const migrationTypeOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("cluster.options.migrationSecure"), value: "secure" },
      { label: t("cluster.options.migrationInsecure"), value: "insecure" },
    ],
    [t],
  );

  const consoleOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("cluster.options.consoleHtml5"), value: "html5" },
      { label: t("cluster.options.consoleXtermjs"), value: "xtermjs" },
      { label: t("cluster.options.consoleSpice"), value: "spice" },
      { label: t("cluster.options.consoleVv"), value: "vv" },
    ],
    [t],
  );

  const haPolicyOptions = useMemo<SelectProps.Option[]>(
    () => [
      { label: t("cluster.options.haPolicyConditional"), value: "conditional" },
      { label: t("cluster.options.haPolicyFreeze"), value: "freeze" },
      { label: t("cluster.options.haPolicyFailover"), value: "failover" },
      { label: t("cluster.options.haPolicyMigrate"), value: "migrate" },
    ],
    [t],
  );

  const optionLabel = useCallback((optionsList: SelectProps.Option[], value: string) => {
    return optionsList.find((option) => option.value === value)?.label ?? (value || t("cluster.common.none"));
  }, [t]);

  const openEditModal = useCallback(() => {
    setForm(options ? buildFormState(options) : EMPTY_FORM);
    setActionError(null);
    setEditVisible(true);
  }, [options]);

  const submitForm = useCallback(async () => {
    try {
      setSaving(true);
      setActionError(null);

      const params = new URLSearchParams();
      const deleteKeys: string[] = [];

      const keyboard = form.keyboard.trim();
      const httpProxy = form.httpProxy.trim();
      const emailFrom = form.emailFrom.trim();
      const migrationType = form.migrationType.trim();
      const migrationNetwork = form.migrationNetwork.trim();
      const consoleValue = form.console.trim();
      const macPrefix = form.macPrefix.trim();
      const haShutdownPolicy = form.haShutdownPolicy.trim();
      const u2fAppId = form.u2fAppId.trim();
      const description = form.description.trim();

      if (keyboard) params.set("keyboard", keyboard); else deleteKeys.push("keyboard");
      if (httpProxy) params.set("http_proxy", httpProxy); else deleteKeys.push("http_proxy");
      if (emailFrom) params.set("email_from", emailFrom); else deleteKeys.push("email_from");
      if (consoleValue) params.set("console", consoleValue); else deleteKeys.push("console");
      if (macPrefix) params.set("mac_prefix", macPrefix); else deleteKeys.push("mac_prefix");
      if (description) params.set("description", description); else deleteKeys.push("description");

      if (migrationType || migrationNetwork) {
        const migrationValue = [
          migrationType ? `type=${migrationType}` : "",
          migrationNetwork ? `network=${migrationNetwork}` : "",
        ].filter(Boolean).join(",");
        params.set("migration", migrationValue);
      } else {
        deleteKeys.push("migration");
      }

      if (haShutdownPolicy) {
        params.set("ha", `shutdown_policy=${haShutdownPolicy}`);
      } else {
        deleteKeys.push("ha");
      }

      if (u2fAppId) {
        params.set("u2f", `appid=${u2fAppId}`);
      } else {
        deleteKeys.push("u2f");
      }

      if (deleteKeys.length > 0) {
        params.set("delete", deleteKeys.join(","));
      }

      await fetchProxmox<string>("/api/proxmox/cluster/options", t, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: params.toString(),
      });

      setEditVisible(false);
      addFlash({
        id: `cluster-options-success-${Date.now()}`,
        type: "success",
        content: t("cluster.options.saveSuccess"),
        dismissible: true,
      });
      await loadOptions();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : t("cluster.options.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [addFlash, form, loadOptions, t]);

  const details = options ? buildFormState(options) : EMPTY_FORM;

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={t("cluster.options.pageDescription")}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="refresh" onClick={() => void loadOptions()}>{t("common.refresh")}</Button>
            <Button variant="primary" onClick={openEditModal}>{t("common.edit")}</Button>
          </SpaceBetween>
        }
      >
        {t("cluster.options.pageTitle")}
      </Header>

      {flashItems.length > 0 ? (
        <Flashbar
          items={flashItems.map((item) => ({
            ...item,
            onDismiss: item.id ? () => dismissFlash(item.id as string) : undefined,
          }))}
        />
      ) : null}

      {error ? (
        <Alert type="error" header={t("cluster.options.failedToLoad")}>
          {error}
        </Alert>
      ) : null}

      {actionError ? (
        <Alert type="error" header={t("cluster.options.saveFailed")}>
          {actionError}
        </Alert>
      ) : null}

      <Box>
        {loading ? (
          <StatusIndicator type="in-progress">{t("cluster.options.loading")}</StatusIndicator>
        ) : (
          <KeyValuePairs
            columns={2}
            items={[
              { label: t("cluster.options.keyboard"), value: optionLabel(keyboardOptions, details.keyboard) },
              { label: t("cluster.options.httpProxy"), value: details.httpProxy || t("cluster.common.none") },
              { label: t("cluster.options.emailFrom"), value: details.emailFrom || t("cluster.common.none") },
              { label: t("cluster.options.migrationType"), value: details.migrationType ? optionLabel(migrationTypeOptions, details.migrationType) : t("cluster.common.none") },
              { label: t("cluster.options.migrationNetwork"), value: details.migrationNetwork || t("cluster.common.none") },
              { label: t("cluster.options.consoleViewer"), value: details.console ? optionLabel(consoleOptions, details.console) : t("cluster.common.none") },
              { label: t("cluster.options.macPrefix"), value: details.macPrefix || t("cluster.common.none") },
              { label: t("cluster.options.haShutdownPolicy"), value: details.haShutdownPolicy ? optionLabel(haPolicyOptions, details.haShutdownPolicy) : t("cluster.common.none") },
              { label: t("cluster.options.u2fAppId"), value: details.u2fAppId || t("cluster.common.none") },
              { label: t("cluster.options.description"), value: details.description || t("cluster.common.none") },
            ]}
          />
        )}
      </Box>

      <Modal
        visible={editVisible}
        onDismiss={() => setEditVisible(false)}
        header={t("cluster.options.editModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setEditVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={saving} onClick={() => void submitForm()}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField label={t("cluster.options.keyboard")}>
            <Select
              selectedOption={keyboardOptions.find((option) => option.value === form.keyboard) ?? null}
              options={keyboardOptions}
              placeholder={t("cluster.options.selectKeyboard")}
              onChange={({ detail }) => setForm((current) => ({ ...current, keyboard: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "" }))}
            />
          </FormField>
          <FormField label={t("cluster.options.httpProxy")}>
            <Input value={form.httpProxy} placeholder={t("cluster.options.proxyPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, httpProxy: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.options.emailFrom")}>
            <Input value={form.emailFrom} placeholder={t("cluster.options.emailPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, emailFrom: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.options.migrationType")}>
            <Select
              selectedOption={migrationTypeOptions.find((option) => option.value === form.migrationType) ?? null}
              options={migrationTypeOptions}
              placeholder={t("cluster.options.selectMigrationType")}
              onChange={({ detail }) => setForm((current) => ({ ...current, migrationType: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "" }))}
            />
          </FormField>
          <FormField label={t("cluster.options.migrationNetwork")}>
            <Input value={form.migrationNetwork} placeholder={t("cluster.options.cidrPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, migrationNetwork: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.options.consoleViewer")}>
            <Select
              selectedOption={consoleOptions.find((option) => option.value === form.console) ?? null}
              options={consoleOptions}
              placeholder={t("cluster.options.selectConsole")}
              onChange={({ detail }) => setForm((current) => ({ ...current, console: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "" }))}
            />
          </FormField>
          <FormField label={t("cluster.options.macPrefix")}>
            <Input value={form.macPrefix} placeholder={t("cluster.options.macPrefixPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, macPrefix: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.options.haShutdownPolicy")}>
            <Select
              selectedOption={haPolicyOptions.find((option) => option.value === form.haShutdownPolicy) ?? null}
              options={haPolicyOptions}
              placeholder={t("cluster.options.selectHaShutdownPolicy")}
              onChange={({ detail }) => setForm((current) => ({ ...current, haShutdownPolicy: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "" }))}
            />
          </FormField>
          <FormField label={t("cluster.options.u2fAppId")}>
            <Input value={form.u2fAppId} placeholder={t("cluster.options.u2fPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, u2fAppId: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.options.description")}>
            <Textarea value={form.description} placeholder={t("cluster.options.descriptionPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, description: detail.value }))} />
          </FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
