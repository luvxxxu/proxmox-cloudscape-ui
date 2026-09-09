"use client";

import { useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useTranslation } from "@/app/lib/use-translation";

export type GuestPowerAction = "start" | "shutdown" | "stop" | "reboot";

export function GuestPowerConfirmation({ action, guests, busy, onDismiss, onConfirm }: {
  action: GuestPowerAction | null;
  guests: readonly { vmid: number; name?: string }[];
  busy: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const { t, language } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  const korean = language === "ko";
  const label = action === "shutdown" ? t("nodeDetail.shutdown") : t(`vms.${action ?? "start"}`);
  const confirmationText = guests.map((guest) => guest.vmid).join(", ");
  return <Modal
    visible={action !== null}
    header={label}
    onDismiss={() => { if (!busy) { setConfirmation(""); onDismiss(); } }}
    footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs">
      <Button disabled={busy} onClick={() => { setConfirmation(""); onDismiss(); }}>{t("common.cancel")}</Button>
      <Button variant="primary" loading={busy} disabled={!guests.length || (action === "stop" && confirmation !== confirmationText)} onClick={() => { setConfirmation(""); onConfirm(); }}>{label}</Button>
    </SpaceBetween></Box>}
  ><SpaceBetween size="m">
    {action !== "start" && <Alert type={action === "stop" ? "warning" : "info"}>
      {action === "stop"
        ? (korean ? "강제 중지는 전원을 즉시 끕니다. 저장하지 않은 데이터가 손실될 수 있습니다. 정상 종료가 가능하면 종료를 사용하세요." : "Stop immediately powers off the selected guests. Unsaved data can be lost. Use shutdown when the guest can shut down normally.")
        : (korean ? "선택한 게스트의 서비스가 중단됩니다." : "Services in the selected guests will be interrupted.")}
    </Alert>}
    {guests.map((guest) => <Box key={guest.vmid}><b>{guest.vmid}</b>{guest.name ? ` · ${guest.name}` : ""}</Box>)}
    {action === "stop" && <FormField label={korean ? `확인하려면 ${confirmationText} 입력` : `To confirm, enter ${confirmationText}`}>
      <Input value={confirmation} onChange={({ detail }) => setConfirmation(detail.value)} autoFocus />
    </FormField>}
  </SpaceBetween></Modal>;
}
