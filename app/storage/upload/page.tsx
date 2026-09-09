"use client";

import { requestResource } from "@/app/lib/resource-request";

import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useTranslation } from "@/app/lib/use-translation";
import { createStorageUploadForm, isStorageActive, resourceErrorMessage } from "@/app/lib/resource-api";
import FileUpload from "@cloudscape-design/components/file-upload";

interface NodeSummary {
  node: string;
  status: string;
}

interface StorageSummary {
  storage: string;
  content?: string;
  active?: number;
  enabled?: number;
}

function optionValue(option: SelectProps.Option | null) {
  return typeof option?.value === "string" ? option.value : "";
}

async function fetchProxmox<T>(path: string): Promise<T> {
  return requestResource<T>(path);
}

function parseUploadError(status: number, responseText: string) {
  try {
    return resourceErrorMessage(JSON.parse(responseText), `HTTP ${status}`);
  } catch {
    return `HTTP ${status}`;
  }
}

export default function StorageUploadPage() {
  const { t } = useTranslation();
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [loadingStorages, setLoadingStorages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [nodeOptions, setNodeOptions] = useState<ReadonlyArray<SelectProps.Option>>([]);
  const [storageOptions, setStorageOptions] = useState<StorageSummary[]>([]);
  const [selectedNode, setSelectedNode] = useState<SelectProps.Option | null>(null);
  const [storageSelection, setSelectedStorage] = useState<SelectProps.Option | null>(null);
  const [selectedContentType, setSelectedContentType] = useState<SelectProps.Option | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const contentTypeOptions = useMemo(
    () => [
      { label: t("storage.isoImage"), value: "iso" },
      { label: t("storage.containerTemplate"), value: "vztmpl" },
    ],
    [t],
  );

  const loadNodes = useCallback(async () => {
    try {
      setLoadingNodes(true);
      const nodes = await fetchProxmox<NodeSummary[]>("/api/proxmox/nodes");
      const options = (nodes ?? [])
        .filter((node) => node.status === "online")
        .map((node) => ({ label: node.node, value: node.node }));

      setNodeOptions(options);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("storage.uploadFailed"));
    } finally {
      setLoadingNodes(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external API request and its loading indicator when this view mounts.
    void loadNodes();
  }, [loadNodes]);

  useEffect(() => {
    const node = optionValue(selectedNode);

    if (!node) return;

    let cancelled = false;

    const loadStorages = async () => {
      try {
        setLoadingStorages(true);
        const storages = await fetchProxmox<StorageSummary[]>(`/api/proxmox/nodes/${node}/storage`);

        if (cancelled) {
          return;
        }

        const supportedStorages = (storages ?? []).filter((storage) => {
          const content = storage.content?.split(",").map((entry) => entry.trim()) ?? [];
          return isStorageActive(storage) && (content.includes("iso") || content.includes("vztmpl"));
        });

        setStorageOptions(supportedStorages);
        setSelectedStorage((current) => {
          if (!current) {
            return null;
          }

          return supportedStorages.some((storage) => storage.storage === current.value) ? current : null;
        });
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setStorageOptions([]);
          setSelectedStorage(null);
          setError(loadError instanceof Error ? loadError.message : t("storage.uploadFailed"));
        }
      } finally {
        if (!cancelled) {
          setLoadingStorages(false);
        }
      }
    };

    void loadStorages();

    return () => {
      cancelled = true;
    };
  }, [selectedNode, t]);

  const filteredStorageOptions = useMemo<ReadonlyArray<SelectProps.Option>>(() => {
    const contentType = optionValue(selectedContentType);

    return storageOptions
      .filter((storage) => {
        if (!contentType) {
          return true;
        }

        const content = storage.content?.split(",").map((entry) => entry.trim()) ?? [];
        return content.includes(contentType);
      })
      .map((storage) => ({ label: storage.storage, value: storage.storage }));
  }, [selectedContentType, storageOptions]);

  const selectedStorage = filteredStorageOptions.find((option) => option.value === storageSelection?.value) ?? null;

  const canSubmit =
    !uploading &&
    Boolean(optionValue(selectedNode)) &&
    Boolean(optionValue(selectedStorage)) &&
    Boolean(optionValue(selectedContentType)) &&
    selectedFile !== null;

  const handleUpload = useCallback(async () => {
    if (!canSubmit || !selectedFile) {
      return;
    }

    const node = optionValue(selectedNode);
    const storage = optionValue(selectedStorage);
    const contentType = optionValue(selectedContentType);

    try {
      const formData = createStorageUploadForm(selectedFile, contentType);
      setUploading(true);
      setProgress(0);
      setError(null);
      setFlashbarItems([]);

      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();

        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable && event.total > 0) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        request.addEventListener("load", () => {
          if (request.status >= 200 && request.status < 300) {
            setProgress(100);
            resolve();
            return;
          }

          try {
            reject(new Error(parseUploadError(request.status, request.responseText)));
          } catch {
            reject(new Error(t("storage.uploadFailed")));
          }
        });

        request.addEventListener("error", () => {
          reject(new Error(t("storage.uploadFailed")));
        });

        request.addEventListener("abort", () => {
          reject(new Error(t("storage.uploadFailed")));
        });

        request.timeout = 2 * 60 * 60 * 1000;
        request.addEventListener("timeout", () => reject(new Error(t("storage.uploadFailed"))));
        request.open("POST", `/api/proxmox/nodes/${node}/storage/${storage}/upload`);
        request.send(formData);
      });

      setFlashbarItems([
        {
          id: "storage-upload-success",
          type: "success",
          dismissible: true,
          content: t("storage.uploadedSuccessfully")
            .replace("{name}", selectedFile.name)
            .replace("{storage}", storage),
        },
      ]);
      setSelectedFile(null);
      setProgress(0);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t("storage.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }, [canSubmit, selectedContentType, selectedFile, selectedNode, selectedStorage, t]);

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{t("storage.uploadIsoTemplate")}</Header>
      {flashbarItems.length > 0 ? <Flashbar items={flashbarItems.map((item) => ({ ...item, onDismiss: item.onDismiss ?? (() => setFlashbarItems((current) => current.filter((entry) => entry.id !== item.id))) }))} /> : null}
      {error ? (
        <Alert type="error" header={t("storage.uploadFailed")}>
          {error}
        </Alert>
      ) : null}
      <Container>
        <SpaceBetween size="l">
          <FormField label={t("storage.node")}>
            <Select
              selectedOption={selectedNode}
              onChange={({ detail }) => { setSelectedNode(detail.selectedOption); setStorageOptions([]); setSelectedStorage(null); }}
              options={nodeOptions}
              placeholder={t("storage.selectNode")}
              statusType={loadingNodes ? "loading" : "finished"}
              loadingText={t("storage.loadingNodes")}
              disabled={uploading}
              empty={t("storage.noOnlineNodes")}
            />
          </FormField>

          <FormField label={t("storage.storage")}>
            <Select
              selectedOption={selectedStorage}
              onChange={({ detail }) => setSelectedStorage(detail.selectedOption)}
              options={filteredStorageOptions}
              placeholder={optionValue(selectedNode) ? t("storage.selectStorage") : t("storage.selectNodeFirst")}
              statusType={loadingStorages ? "loading" : "finished"}
              loadingText={t("storage.loadingStorageSelect")}
              disabled={!optionValue(selectedNode) || uploading}
              empty={t("storage.noMatchingStorage")}
            />
          </FormField>

          <FormField label={t("storage.contentType")}>
            <Select
              selectedOption={selectedContentType}
              onChange={({ detail }) => setSelectedContentType(detail.selectedOption)}
              options={contentTypeOptions}
              placeholder={t("storage.selectContentType")}
              disabled={uploading}
            />
          </FormField>

          <FormField label={t("storage.file")}>
            {uploading ? <Box>{selectedFile?.name}</Box> : <FileUpload
              value={selectedFile ? [selectedFile] : []}
              onChange={({ detail }) => setSelectedFile(detail.value[0] ?? null)}
              accept={optionValue(selectedContentType) === "iso" ? ".iso,.img" : ".tar.gz,.tar.xz,.tar.zst,.tar.lzo"}
              showFileSize
              i18nStrings={{
                uploadButtonText: () => t("storage.file"),
                dropzoneText: () => t("storage.file"),
                removeFileAriaLabel: () => t("common.delete"),
                errorIconAriaLabel: t("common.error"),
              }}
            />}
          </FormField>

          {uploading ? <ProgressBar value={progress} label={t("storage.uploadProgress")} /> : null}

          <Box>
            <Button variant="primary" onClick={() => void handleUpload()} disabled={!canSubmit} loading={uploading}>
              {t("storage.upload")}
            </Button>
          </Box>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
