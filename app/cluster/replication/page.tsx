"use client";

import { requestResource, useResourceTaskRefresh } from "@/app/lib/resource-request";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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
import { useTranslation } from "@/app/lib/use-translation";
import { buildReplicationParameters } from "@/app/lib/resource-api";

interface ReplicationJob {
  id: string;
  guest?: number | string;
  type?: string;
  source?: string;
  target?: string;
  schedule?: string;
  rate?: number | string;
  comment?: string;
  disable?: number | boolean;
  duration?: number;
  last_sync?: number;
  next_sync?: number;
  error?: string;
  status?: string;
  state?: string;
  pid?: number;
}

interface Preferences {
  pageSize: number;
  wrapLines: boolean;
  stripedRows: boolean;
  contentDensity: "comfortable" | "compact";
  contentDisplay: ReadonlyArray<CollectionPreferencesProps.ContentDisplayItem>;
}

interface ReplicationFormState {
  guest: string;
  target: string;
  schedule: string;
  rate: string;
  comment: string;
  type: string;
}

const DEFAULT_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "id", visible: true },
    { id: "guest", visible: true },
    { id: "type", visible: true },
    { id: "source", visible: true },
    { id: "target", visible: true },
    { id: "schedule", visible: true },
    { id: "rate", visible: true },
    { id: "comment", visible: true },
    { id: "status", visible: true },
    { id: "duration", visible: true },
    { id: "lastSync", visible: true },
    { id: "nextSync", visible: true },
    { id: "error", visible: true },
    { id: "actions", visible: true },
  ],
};

const EMPTY_FORM: ReplicationFormState = {
  guest: "",
  target: "",
  schedule: "*/15",
  rate: "",
  comment: "",
  type: "local",
};

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}



function formatTimestamp(value?: number) {
  if (!value) {
    return "-";
  }

  return new Date(value * 1000).toLocaleString();
}

function formatDuration(value: number | undefined, t: (key: string) => string) {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return `${Math.round(value * 10) / 10}${t("cluster.common.secondsShort")}`;
}

function isDisabled(job: ReplicationJob) {
  return job.disable === 1 || job.disable === true;
}

function getStatusType(job: ReplicationJob): "success" | "stopped" | "error" | "in-progress" | "info" {
  if (job.error) {
    return "error";
  }

  if (job.pid || (job.status ?? job.state ?? "").toLowerCase().includes("sync")) {
    return "in-progress";
  }

  if (isDisabled(job)) {
    return "stopped";
  }

  return job.last_sync ? "success" : "info";
}

function getStatusLabel(job: ReplicationJob, t: (key: string) => string) {
  if (job.error) {
    return job.error;
  }

  if (job.status?.trim()) {
    return job.status;
  }

  if (job.state?.trim()) {
    return job.state;
  }

  if (job.pid) {
    return t("cluster.replication.syncing");
  }

  if (isDisabled(job)) {
    return t("cluster.replication.disabled");
  }

  return job.last_sync ? t("cluster.replication.ok") : t("cluster.replication.statusUnavailable");
}

function buildFormState(job: ReplicationJob): ReplicationFormState {
  return {
    guest: String(job.guest ?? job.id.split("-")[0]),
    target: job.target ?? "",
    schedule: job.schedule ?? "*/15",
    rate: job.rate !== undefined ? String(job.rate) : "",
    comment: job.comment ?? "",
    type: job.type ?? "local",
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

async function fetchProxmox<T>(path: string, _t: (key: string) => string, init?: RequestInit): Promise<T> {
  return requestResource<T>(path, init);
}

export default function ClusterReplicationPage() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<ReplicationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ReplicationJob | null>(null);
  const [form, setForm] = useState<ReplicationFormState>(EMPTY_FORM);

  const addFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 5));
  }, []);

  const dismissFlash = useCallback((id: string) => {
    setFlashItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      const [nextJobs, nodes] = await Promise.all([
        fetchProxmox<ReplicationJob[]>("/api/proxmox/cluster/replication", t),
        fetchProxmox<Array<{ node: string; status: string }>>("/api/proxmox/nodes", t),
      ]);
      const liveResults = await Promise.allSettled((nodes ?? []).filter((node) => node.status === "online").map(async ({ node }) => {
        const statuses = await fetchProxmox<ReplicationJob[]>(`/api/proxmox/nodes/${encodeURIComponent(node)}/replication`, t);
        return (statuses ?? []).map((status) => ({ ...status, source: node }));
      }));
      const liveJobs = new Map(liveResults.flatMap((result) => result.status === "fulfilled" ? result.value : []).map((job) => [job.id, job]));
      setJobs((nextJobs ?? []).map((job) => ({ ...job, ...liveJobs.get(job.id), guest: job.guest ?? job.id.split("-")[0] })).sort((a, b) => a.id.localeCompare(b.id)));
      const errors = liveResults.flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []);
      setError(errors.length ? errors.join("; ") : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("cluster.replication.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useResourceTaskRefresh(loadJobs);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadJobs();
  }, [loadJobs]);

  const typeOptions = useMemo<SelectProps.Option[]>(() => [{ label: t("cluster.replication.typeLocal"), value: "local" }], [t]);

  const submitJob = useCallback(async (mode: "create" | "edit") => {
    try {
      const params = buildReplicationParameters(form, mode, jobs.map((job) => job.id));
      setSubmitting(true);

      if (mode === "create") {
        await fetchProxmox<string>("/api/proxmox/cluster/replication", t, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: params.toString(),
        });
        setCreateVisible(false);
        addFlash({ id: `replication-create-${Date.now()}`, type: "success", content: t("cluster.replication.createSuccess"), dismissible: true });
      } else {
        if (!selectedJob) {
          throw new Error(t("cluster.replication.updateFailed"));
        }

        await fetchProxmox<string>(`/api/proxmox/cluster/replication/${encodeURIComponent(selectedJob.id)}`, t, {
          method: "PUT",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: params.toString(),
        });
        setEditVisible(false);
        addFlash({ id: `replication-update-${Date.now()}`, type: "success", content: t("cluster.replication.updateSuccess"), dismissible: true });
      }

      await loadJobs();
    } catch (submitError) {
      const fallback = mode === "create" ? t("cluster.replication.createFailed") : t("cluster.replication.updateFailed");
      setError(submitError instanceof Error ? submitError.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, form, jobs, loadJobs, selectedJob, t]);

  const deleteJob = useCallback(async () => {
    if (!selectedJob) {
      return;
    }

    try {
      setSubmitting(true);
      await fetchProxmox<string>(`/api/proxmox/cluster/replication/${encodeURIComponent(selectedJob.id)}`, t, {
        method: "DELETE",
      });
      setDeleteVisible(false);
      addFlash({ id: `replication-delete-${Date.now()}`, type: "success", content: t("cluster.replication.deleteSuccess"), dismissible: true });
      await loadJobs();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("cluster.replication.deleteFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadJobs, selectedJob, t]);

  const runJobNow = useCallback(async (job: ReplicationJob) => {
    if (!job.source || isDisabled(job)) return;
    try {
      setSubmitting(true);
      await fetchProxmox(`/api/proxmox/nodes/${encodeURIComponent(job.source)}/replication/${encodeURIComponent(job.id)}/schedule_now`, t, { method: "POST" });
      addFlash({ id: `replication-run-${job.id}`, type: "success", content: t("cluster.replication.runQueued"), dismissible: true });
      await loadJobs();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }, [addFlash, loadJobs, t]);

  const columns = useMemo<TableProps<ReplicationJob>["columnDefinitions"]>(
    () => [
      { id: "id", header: t("cluster.replication.jobId"), cell: ({ id }) => id, sortingField: "id", isRowHeader: true, minWidth: 180 },
      { id: "guest", header: t("cluster.replication.guestId"), cell: ({ guest }) => String(guest ?? "-"), sortingComparator: (a, b) => Number(a.guest ?? 0) - Number(b.guest ?? 0), minWidth: 120 },
      { id: "type", header: t("cluster.replication.type"), cell: ({ type }) => type ?? t("cluster.common.none"), sortingField: "type", minWidth: 120 },
      { id: "source", header: t("cluster.replication.source"), cell: ({ source }) => source ?? t("cluster.common.none"), sortingField: "source", minWidth: 140 },
      { id: "target", header: t("cluster.replication.target"), cell: ({ target }) => target ?? t("cluster.common.none"), sortingField: "target", minWidth: 140 },
      { id: "schedule", header: t("cluster.replication.schedule"), cell: ({ schedule }) => schedule ?? t("cluster.common.none"), minWidth: 140 },
      { id: "rate", header: t("cluster.replication.rateLimit"), cell: ({ rate }) => rate !== undefined ? String(rate) : t("cluster.common.none"), sortingComparator: (a, b) => Number(a.rate ?? 0) - Number(b.rate ?? 0), minWidth: 140 },
      { id: "comment", header: t("cluster.replication.comment"), cell: ({ comment }) => comment ?? t("cluster.common.none"), minWidth: 220 },
      {
        id: "status",
        header: t("cluster.replication.status"),
        cell: (job) => <StatusIndicator type={getStatusType(job)}>{getStatusLabel(job, t)}</StatusIndicator>,
        minWidth: 180,
      },
      { id: "duration", header: t("cluster.replication.duration"), cell: ({ duration }) => formatDuration(duration, t), sortingComparator: (a, b) => (a.duration ?? 0) - (b.duration ?? 0), minWidth: 120 },
      { id: "lastSync", header: t("cluster.replication.lastSync"), cell: ({ last_sync }) => formatTimestamp(last_sync), sortingComparator: (a, b) => (a.last_sync ?? 0) - (b.last_sync ?? 0), minWidth: 180 },
      { id: "nextSync", header: t("cluster.replication.nextSync"), cell: ({ next_sync }) => formatTimestamp(next_sync), sortingComparator: (a, b) => (a.next_sync ?? 0) - (b.next_sync ?? 0), minWidth: 180 },
      { id: "error", header: t("cluster.replication.error"), cell: ({ error: jobError }) => jobError ?? t("cluster.common.none"), minWidth: 240 },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (job) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="inline-link" disabled={submitting || !job.source || isDisabled(job)} onClick={() => void runJobNow(job)}>{t("cluster.replication.runNow")}</Button>
            <Button
              variant="inline-link"
              onClick={() => {
                setSelectedJob(job);
                setForm(buildFormState(job));
                setEditVisible(true);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button
              variant="inline-link"
              onClick={() => {
                setSelectedJob(job);
                setDeleteVisible(true);
              }}
            >
              {t("common.delete")}
            </Button>
          </SpaceBetween>
        ),
        minWidth: 160,
      },
    ],
    [runJobNow, submitting, t],
  );

  const emptyState = renderCenteredState(
    t("cluster.replication.noJobs"),
    t("cluster.replication.noJobsDescription"),
    <Button onClick={() => void loadJobs()}>{t("common.refresh")}</Button>,
  );

  const { actions, items, collectionProps, filterProps, filteredItemsCount, paginationProps } = useCollection(jobs, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [
          item.id,
          String(item.guest ?? ""),
          item.type ?? "",
          item.source ?? "",
          item.target ?? "",
          item.schedule ?? "",
          String(item.rate ?? ""),
          item.comment ?? "",
          getStatusLabel(item, t),
          formatDuration(item.duration, t),
          formatTimestamp(item.last_sync),
          formatTimestamp(item.next_sync),
          item.error ?? "",
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: emptyState,
      noMatch: renderCenteredState(
        t("common.noMatches"),
        t("cluster.replication.noJobsMatch"),
        // eslint-disable-next-line react-hooks/immutability -- Cloudscape calls this event handler only after useCollection has returned its actions.
        <Button onClick={() => actions.setFiltering("")}>{t("common.clearFilter")}</Button>,
      ),
    },
    sorting: {
      defaultState: {
        sortingColumn: columns[0],
      },
    },
    pagination: {
      pageSize: preferences.pageSize,
    },
  });

  const headerCounter = filterProps.filteringText ? `(${filteredItemsCount}/${jobs.length})` : `(${jobs.length})`;

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={t("cluster.replication.pageDescription")}>
        {t("cluster.replication.pageTitle")}
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
        <Alert type="error" header={t("cluster.replication.failedToLoad")}>
          {error}
        </Alert>
      ) : null}

      <Table
        {...collectionProps}
        items={items}
        columnDefinitions={columns}
        variant="full-page"
        stickyHeader
        resizableColumns
        enableKeyboardNavigation
        trackBy="id"
        loading={loading}
        loadingText={t("cluster.replication.loading")}
        empty={filterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("cluster.replication.noJobsMatch"), <Button onClick={() => actions.setFiltering("")}>{t("common.clearFilter")}</Button>) : emptyState}
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        columnDisplay={preferences.contentDisplay}
        header={
          <Header
            counter={headerCounter}
            description={t("cluster.replication.pageDescription")}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  variant="primary"
                  onClick={() => {
                    setForm(EMPTY_FORM);
                    setSelectedJob(null);
                    setCreateVisible(true);
                  }}
                >
                  {t("cluster.replication.createJob")}
                </Button>
                <Button iconName="refresh" onClick={() => void loadJobs()}>{t("common.refresh")}</Button>
              </SpaceBetween>
            }
          >
            {t("cluster.replication.pageTitle")}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder={t("cluster.replication.findJobs")}
            countText={`${filteredItemsCount ?? jobs.length} ${t("common.matches")}`}
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
                { value: 10, label: t("cluster.replication.jobsCount10") },
                { value: 20, label: t("cluster.replication.jobsCount20") },
                { value: 50, label: t("cluster.replication.jobsCount50") },
              ],
            }}
            wrapLinesPreference={{
              label: t("common.wrapLines"),
              description: t("cluster.replication.wrapLinesDesc"),
            }}
            stripedRowsPreference={{
              label: t("common.stripedRows"),
              description: t("cluster.replication.stripedRowsDesc"),
            }}
            contentDensityPreference={{
              label: t("common.contentDensity"),
              description: t("cluster.replication.contentDensityDesc"),
            }}
            contentDisplayPreference={{
              title: t("common.columnPreferences"),
              options: [
                { id: "id", label: t("cluster.replication.jobId"), alwaysVisible: true },
                { id: "guest", label: t("cluster.replication.guestId") },
                { id: "type", label: t("cluster.replication.type") },
                { id: "source", label: t("cluster.replication.source") },
                { id: "target", label: t("cluster.replication.target") },
                { id: "schedule", label: t("cluster.replication.schedule") },
                { id: "rate", label: t("cluster.replication.rateLimit") },
                { id: "comment", label: t("cluster.replication.comment") },
                { id: "status", label: t("cluster.replication.status") },
                { id: "duration", label: t("cluster.replication.duration") },
                { id: "lastSync", label: t("cluster.replication.lastSync") },
                { id: "nextSync", label: t("cluster.replication.nextSync") },
                { id: "error", label: t("cluster.replication.error") },
                { id: "actions", label: t("common.actions") },
              ],
            }}
          />
        }
      />

      <Modal
        visible={createVisible}
        onDismiss={() => setCreateVisible(false)}
        header={t("cluster.replication.createModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setCreateVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={submitting} onClick={() => void submitJob("create")}>{t("common.create")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {error ? <Alert type="error">{error}</Alert> : null}
          <FormField label={t("cluster.replication.guestId")}>
            <Input value={form.guest} onChange={({ detail }) => setForm((current) => ({ ...current, guest: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.targetNode")}>
            <Input value={form.target} placeholder={t("cluster.replication.targetNodePlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, target: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.schedule")}>
            <Input value={form.schedule} placeholder={t("cluster.replication.schedulePlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, schedule: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.rateLimit")}>
            <Input value={form.rate} placeholder={t("cluster.replication.rateLimitPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, rate: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.comment")}>
            <Textarea value={form.comment} placeholder={t("cluster.replication.commentPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, comment: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.type")}>
            <Select
              selectedOption={typeOptions.find((option) => option.value === form.type) ?? null}
              options={typeOptions}
              onChange={({ detail }) => setForm((current) => ({ ...current, type: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "local" }))}
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={editVisible}
        onDismiss={() => setEditVisible(false)}
        header={t("cluster.replication.editModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setEditVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={submitting} onClick={() => void submitJob("edit")}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {error ? <Alert type="error">{error}</Alert> : null}
          <FormField label={t("cluster.replication.jobId")}>
            <Input value={selectedJob?.id ?? ""} disabled />
          </FormField>
          <FormField label={t("cluster.replication.guestId")}>
            <Input value={form.guest} disabled />
          </FormField>
          <FormField label={t("cluster.replication.targetNode")}>
            <Input disabled value={form.target} placeholder={t("cluster.replication.targetNodePlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, target: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.schedule")}>
            <Input value={form.schedule} placeholder={t("cluster.replication.schedulePlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, schedule: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.rateLimit")}>
            <Input value={form.rate} placeholder={t("cluster.replication.rateLimitPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, rate: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.comment")}>
            <Textarea value={form.comment} placeholder={t("cluster.replication.commentPlaceholder")} onChange={({ detail }) => setForm((current) => ({ ...current, comment: detail.value }))} />
          </FormField>
          <FormField label={t("cluster.replication.type")}>
            <Select
              disabled
              selectedOption={typeOptions.find((option) => option.value === form.type) ?? null}
              options={typeOptions}
              onChange={({ detail }) => setForm((current) => ({ ...current, type: typeof detail.selectedOption.value === "string" ? detail.selectedOption.value : "local" }))}
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={deleteVisible}
        onDismiss={() => setDeleteVisible(false)}
        header={t("cluster.replication.deleteModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setDeleteVisible(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={submitting} onClick={() => void deleteJob()}>{t("common.delete")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Box>
          {selectedJob ? interpolate(t("cluster.replication.deleteConfirmation"), { id: selectedJob.id }) : null}
        </Box>
      </Modal>
    </SpaceBetween>
  );
}
