"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { useTranslation } from "@/app/lib/use-translation";
import { registerWebAuthn } from "@/app/lib/webauthn-client";
import { accessRequest, formRequest } from "./access-api";
import { formatExpireInput, isValidTokenId, makeTotpUri, parseExpireInput } from "./access-data";

type Token = { tokenid: string; comment?: string; expire?: number; privsep?: number | boolean };
type TfaEntry = { id: string; type: string; description?: string; enable?: number | boolean; created?: number };
type Action = "create" | "edit" | "delete" | "rotate";
type TokenForm = { action: Action; tokenid: string; comment: string; expire: string; inheritExpiration: boolean; privsep: boolean };
type TfaForm = { action: "create" | "edit" | "delete"; id: string; type: string; description: string; enable: boolean; uri: string; value: string; password: string };

export default function UserSecurity({ userid, onDismiss, onChanged }: {
  userid: string;
  onDismiss: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t, language } = useTranslation();
  const text = useCallback((en: string, ko: string) => language === "ko" ? ko : en, [language]);
  const [tab, setTab] = useState("tokens");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tfaEntries, setTfaEntries] = useState<TfaEntry[]>([]);
  const [permissions, setPermissions] = useState<{ path: string; privilege: string; propagate: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const registrationAbort = useRef<AbortController | null>(null);
  const [registrationPhase, setRegistrationPhase] = useState<"starting" | "prompt" | "saving" | null>(null);
  useEffect(() => () => registrationAbort.current?.abort(), []);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formError, setFormError] = useState("");
  const [tokenForm, setTokenForm] = useState<TokenForm | null>(null);
  const [tfaForm, setTfaForm] = useState<TfaForm | null>(null);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [confirmationPassword, setConfirmationPassword] = useState("");
  const [permissionSubject, setPermissionSubject] = useState(userid);
  const [unlockConfirm, setUnlockConfirm] = useState(false);
  const userPath = `/api/proxmox/access/users/${encodeURIComponent(userid)}`;
  const tfaPath = `/api/proxmox/access/tfa/${encodeURIComponent(userid)}`;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      if (tab === "tokens") { const result = await accessRequest<Token[]>(`${userPath}/token`, { signal }); if (!signal?.aborted) setTokens(result); }
      if (tab === "tfa") { const result = await accessRequest<TfaEntry[]>(tfaPath, { signal }); if (!signal?.aborted) setTfaEntries(result); }
      if (tab === "permissions") {
        const result = await accessRequest<Record<string, Record<string, number | boolean>>>(`/api/proxmox/access/permissions?${new URLSearchParams({ userid: permissionSubject })}`, { signal });
        if (!signal?.aborted) setPermissions(Object.entries(result).flatMap(([path, privileges]) => Object.entries(privileges).map(([privilege, propagate]) => ({ path, privilege, propagate: Boolean(propagate) }))));
      }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [permissionSubject, tab, tfaPath, userPath]);

  useEffect(() => {
    const controller = new AbortController();
    // Synchronize the remote collection when the selected user or tab changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFormError("");
    setSuccess("");
    try {
      await operation();
      setSuccess(text("Changes saved.", "변경 사항을 저장했습니다."));
      await Promise.all([load(), onChanged()]);
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) setFormError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setRegistrationPhase(null);
      registrationAbort.current = null;
    }
  };

  const selectToken = (token: Token, action: Action) => {
    setFormError("");
    setTokenForm({ action, tokenid: token.tokenid, comment: token.comment ?? "", expire: formatExpireInput(token.expire), inheritExpiration: !token.expire, privsep: token.privsep !== 0 && token.privsep !== false });
  };

  const saveToken = async () => {
    if (!tokenForm) return;
    if (!isValidTokenId(tokenForm.tokenid)) {
      setFormError(text("Token ID must start with a letter and contain at least two letters, digits, periods, hyphens or underscores.", "토큰 ID는 영문자로 시작하는 2자 이상의 영문자, 숫자, 마침표, 하이픈, 밑줄이어야 합니다."));
      return;
    }
    const expiry = parseExpireInput(tokenForm.expire);
    if (!tokenForm.inheritExpiration && !expiry.valid) { setFormError(t("permissions.invalidExpireDate")); return; }
    await run(async () => {
      const path = `${userPath}/token/${encodeURIComponent(tokenForm.tokenid)}`;
      if (tokenForm.action === "delete") {
        await accessRequest(path, { method: "DELETE" });
      } else {
        const params = new URLSearchParams();
        if (tokenForm.action === "rotate") params.set("regenerate", "1");
        else {
          params.set("comment", tokenForm.comment);
          params.set("privsep", tokenForm.privsep ? "1" : "0");
          if (!tokenForm.inheritExpiration) params.set("expire", expiry.epoch);
          else if (tokenForm.action === "edit") params.set("expire", "0");
        }
        const result = await accessRequest<{ "full-tokenid"?: string; value?: string }>(path, formRequest(tokenForm.action === "create" ? "POST" : "PUT", params));
        if (result?.value) setSecret({ id: result["full-tokenid"] ?? `${userid}!${tokenForm.tokenid}`, value: result.value });
      }
      setTokenForm(null);
    });
  };

  const savePassword = async () => {
    if (password.length < 8 || password.length > 64) { setFormError(text("Password must contain 8 to 64 characters.", "비밀번호는 8~64자여야 합니다.")); return; }
    if (password !== passwordRepeat) { setFormError(text("Passwords do not match.", "비밀번호가 일치하지 않습니다.")); return; }
    await run(async () => {
      const params = new URLSearchParams({ userid, password });
      if (confirmationPassword) params.set("confirmation-password", confirmationPassword);
      await accessRequest("/api/proxmox/access/password", formRequest("PUT", params));
      setPassword(""); setPasswordRepeat(""); setConfirmationPassword("");
    });
  };

  const openTfa = (entry?: TfaEntry, action: "create" | "edit" | "delete" = "create") => {
    setFormError("");
    setTfaForm({ action, id: entry?.id ?? "", type: entry?.type ?? "totp", description: entry?.description ?? "", enable: entry?.enable !== false && entry?.enable !== 0, uri: action === "create" ? makeTotpUri(userid, crypto.getRandomValues(new Uint8Array(20))) : "", value: "", password: "" });
  };

  const saveTfa = async () => {
    if (!tfaForm || busyRef.current) return;
    if (tfaForm.action === "create" && tfaForm.type === "totp" && !/^\d{6}$/.test(tfaForm.value)) { setFormError(text("Enter the current six-digit authenticator code.", "인증 앱의 현재 6자리 코드를 입력하세요.")); return; }
    if (tfaForm.action === "create" && tfaForm.type === "yubico" && !tfaForm.value.trim()) { setFormError(text("Enter a YubiKey OTP.", "YubiKey OTP를 입력하세요.")); return; }
    if (tfaForm.action === "create" && tfaForm.type === "webauthn" && !tfaForm.description.trim()) { setFormError(text("Enter a name for this security key.", "보안 키의 이름을 입력하세요.")); return; }
    await run(async () => {
      const params = new URLSearchParams();
      if (tfaForm.password) params.set("password", tfaForm.password);
      if (tfaForm.action === "create") {
        params.set("type", tfaForm.type);
        if (tfaForm.description) params.set("description", tfaForm.description);
        if (tfaForm.type === "totp") params.set("totp", tfaForm.uri);
        if (tfaForm.value) params.set("value", tfaForm.value);
        if (tfaForm.type === "webauthn") {
          const controller = new AbortController();
          registrationAbort.current = controller;
          setRegistrationPhase("starting");
          const result = await accessRequest<{ challenge?: string }>(tfaPath, { ...formRequest("POST", params), signal: controller.signal });
          if (typeof result?.challenge !== "string") throw new Error(text("Proxmox did not return a registration challenge.", "Proxmox가 등록 챌린지를 반환하지 않았습니다."));
          setRegistrationPhase("prompt");
          const attestation = await registerWebAuthn(result.challenge, controller.signal);
          if (controller.signal.aborted) throw controller.signal.reason;
          setRegistrationPhase("saving");
          const finish = new URLSearchParams({ type: "webauthn", challenge: attestation.challenge, value: attestation.value });
          if (tfaForm.password) finish.set("password", tfaForm.password);
          const registered = await accessRequest<{ id?: string }>(tfaPath, formRequest("POST", finish));
          if (typeof registered?.id !== "string") throw new Error(text("Registration returned no credential ID. Refresh the factor list before trying again.", "등록 결과에 인증 수단 ID가 없습니다. 다시 시도하기 전에 인증 수단 목록을 새로 고치세요."));
        } else {
          const result = await accessRequest<{ recovery?: string[] }>(tfaPath, formRequest("POST", params));
          if (result?.recovery) setRecoveryCodes(result.recovery);
        }
      } else {
        if (tfaForm.action === "edit") {
          params.set("description", tfaForm.description);
          params.set("enable", tfaForm.enable ? "1" : "0");
        }
        await accessRequest(`${tfaPath}/${encodeURIComponent(tfaForm.id)}`, formRequest(tfaForm.action === "delete" ? "DELETE" : "PUT", params));
      }
      setTfaForm(null);
    });
  };

  const copy = (value: string) => <CopyToClipboard variant="inline" copyButtonAriaLabel={text("Copy secret", "비밀 값 복사")} copySuccessText={text("Copied", "복사됨")} copyErrorText={text("Copy failed", "복사 실패")} textToCopy={value} />;
  const permissionOptions = useMemo(() => [{ label: userid, value: userid }, ...tokens.map((token) => ({ label: `${userid}!${token.tokenid}`, value: `${userid}!${token.tokenid}` }))], [tokens, userid]);

  return <Modal visible size="large" header={`${text("User security", "사용자 보안")} — ${userid}`} onDismiss={() => { if (!busy) onDismiss(); }} closeAriaLabel={text("Close user security", "사용자 보안 닫기")}
    footer={<Box float="right"><Button disabled={busy} onClick={onDismiss}>{text("Close", "닫기")}</Button></Box>}>
    <SpaceBetween size="l">
      {Boolean(error) && <Alert type="error" action={<Button onClick={() => void load()}>{t("common.refresh")}</Button>}>{error}</Alert>}
      {Boolean(success) && <Alert type="success" dismissible onDismiss={() => setSuccess("")}>{success}</Alert>}
      {secret && <Alert type="warning" header={text("Save this token secret", "토큰 비밀 값을 보관하세요")}>
        <SpaceBetween size="s"><Box>{text("This secret is displayed only once. Closing this panel removes it from the screen.", "비밀 값은 한 번만 표시됩니다. 이 창을 닫으면 화면에서 삭제됩니다.")}</Box><Box>{secret.id}</Box>{copy(secret.value)}<Button onClick={() => setSecret(null)}>{text("I saved the secret", "비밀 값 보관 완료")}</Button></SpaceBetween>
      </Alert>}
      {recoveryCodes.length > 0 && <Alert type="warning" header={text("Save recovery codes", "복구 코드 보관")}><SpaceBetween size="s"><Box>{text("Each code can be used once. Store them in a safe place before closing.", "각 코드는 한 번만 사용할 수 있습니다. 창을 닫기 전에 안전한 곳에 보관하세요.")}</Box>{copy(recoveryCodes.join("\n"))}<Button onClick={() => setRecoveryCodes([])}>{text("I saved the codes", "코드 보관 완료")}</Button></SpaceBetween></Alert>}
      <Tabs activeTabId={tab} onChange={({ detail }) => { if (!busy) { setTab(detail.activeTabId); setTokenForm(null); setTfaForm(null); setFormError(""); setPassword(""); setPasswordRepeat(""); setConfirmationPassword(""); } }} tabs={[
        { id: "tokens", label: text("API tokens", "API 토큰"), content: <SpaceBetween size="l">
          <Table items={tokens} trackBy="tokenid" loading={loading} loadingText={text("Loading API tokens", "API 토큰 불러오는 중")} empty={<Box>{text("No API tokens.", "API 토큰이 없습니다.")}</Box>}
            header={<Header counter={`(${tokens.length})`} actions={<Button variant="primary" disabled={busy || Boolean(secret)} onClick={() => selectToken({ tokenid: "", privsep: 1 }, "create")}>{t("common.create")}</Button>}>{text("API tokens", "API 토큰")}</Header>}
            columnDefinitions={[
              { id: "id", header: text("Token ID", "토큰 ID"), cell: (token) => token.tokenid, isRowHeader: true },
              { id: "comment", header: t("permissions.comment"), cell: (token) => token.comment || "—" },
              { id: "expire", header: t("permissions.expire"), cell: (token) => token.expire === undefined ? text("Same as user", "사용자와 동일") : token.expire ? formatExpireInput(token.expire) : t("permissions.never") },
              { id: "privsep", header: text("Separate privileges", "권한 분리"), cell: (token) => token.privsep !== 0 && token.privsep !== false ? t("common.yes") : t("common.no") },
              { id: "actions", header: t("common.actions"), cell: (token) => <SpaceBetween direction="horizontal" size="xs"><Button disabled={busy} onClick={() => selectToken(token, "edit")}>{t("common.edit")}</Button><Button disabled={busy || Boolean(secret)} onClick={() => selectToken(token, "rotate")}>{text("Rotate secret", "비밀 값 교체")}</Button><Button disabled={busy} onClick={() => selectToken(token, "delete")}>{t("common.delete")}</Button></SpaceBetween> },
            ]} />
          {tokenForm && <SpaceBetween size="l">
            <Header variant="h3">{tokenForm.action === "create" ? text("Create API token", "API 토큰 생성") : `${tokenForm.tokenid} — ${tokenForm.action === "edit" ? t("common.edit") : tokenForm.action === "delete" ? t("common.delete") : text("Rotate secret", "비밀 값 교체")}`}</Header>
            {tokenForm.action === "delete" || tokenForm.action === "rotate" ? <Alert type="warning">{tokenForm.action === "delete" ? text(`Delete ${userid}!${tokenForm.tokenid}? Applications using this token will lose access.`, `${userid}!${tokenForm.tokenid} 토큰을 삭제하면 이를 사용하는 애플리케이션의 접근이 중단됩니다.`) : text("Replacing the secret immediately invalidates the existing secret. Update every application using this token. This requires a Proxmox version that supports token regeneration.", "비밀 값을 교체하면 기존 값이 즉시 무효화됩니다. 이 토큰을 사용하는 모든 애플리케이션을 업데이트해야 합니다. 토큰 재생성을 지원하는 Proxmox 버전이 필요합니다.")}</Alert> : <>
              <FormField label={text("Token ID", "토큰 ID")}><Input disabled={busy || tokenForm.action === "edit"} value={tokenForm.tokenid} onChange={({ detail }) => setTokenForm({ ...tokenForm, tokenid: detail.value })} /></FormField>
              <FormField label={t("permissions.comment")}><Input disabled={busy} value={tokenForm.comment} onChange={({ detail }) => setTokenForm({ ...tokenForm, comment: detail.value })} /></FormField>
              <Checkbox disabled={busy} checked={tokenForm.privsep} onChange={({ detail }) => setTokenForm({ ...tokenForm, privsep: detail.checked })}>{text("Separate privileges (recommended)", "권한 분리 (권장)")}</Checkbox>
              <Box>{text("With privilege separation, grant ACLs to this token. Its effective privileges cannot exceed its user's privileges.", "권한을 분리하면 토큰에 ACL을 별도로 부여해야 합니다. 토큰의 유효 권한은 사용자의 권한을 넘을 수 없습니다.")}</Box>
              {!tokenForm.privsep && <Alert type="warning">{text("This token will inherit all permissions of its user.", "이 토큰은 사용자의 모든 권한을 상속합니다.")}</Alert>}
              <Checkbox disabled={busy} checked={tokenForm.inheritExpiration} onChange={({ detail }) => setTokenForm({ ...tokenForm, inheritExpiration: detail.checked })}>{text("No additional token expiration", "토큰 만료일을 별도로 지정하지 않음")}</Checkbox>
              {!tokenForm.inheritExpiration && <FormField label={t("permissions.expire")} constraintText={text("YYYY-MM-DD in your local time zone. Leave empty for no token expiration.", "현지 시간대 기준 YYYY-MM-DD. 비워 두면 토큰 만료일을 지정하지 않습니다.")}><Input disabled={busy} value={tokenForm.expire} onChange={({ detail }) => setTokenForm({ ...tokenForm, expire: detail.value })} /></FormField>}
            </>}
            {Boolean(formError) && <Alert type="error">{formError}</Alert>}
            <SpaceBetween direction="horizontal" size="xs"><Button disabled={busy} onClick={() => { setTokenForm(null); setFormError(""); }}>{t("common.cancel")}</Button><Button variant="primary" loading={busy} onClick={() => void saveToken()}>{tokenForm.action === "delete" ? t("common.delete") : tokenForm.action === "create" ? t("common.create") : t("common.confirm")}</Button></SpaceBetween>
          </SpaceBetween>}
        </SpaceBetween> },
        { id: "password", label: t("permissions.password"), content: <SpaceBetween size="l">
          <Alert type="info">{text("Enter the current password of the signed-in operator when Proxmox requests confirmation. PAM password changes apply only to the connected node. External directory passwords are managed by their identity provider.", "Proxmox에서 확인을 요구하는 경우 로그인한 작업자의 현재 비밀번호를 입력하세요. PAM 비밀번호 변경은 연결된 노드에만 적용됩니다. 외부 디렉터리 비밀번호는 해당 인증 제공자에서 관리합니다.")}</Alert>
          <FormField label={text("New password", "새 비밀번호")} constraintText={text("8 to 64 characters.", "8~64자.")}><Input type="password" autoComplete="new-password" value={password} disabled={busy} onChange={({ detail }) => setPassword(detail.value)} /></FormField>
          <FormField label={text("Repeat password", "비밀번호 확인")}><Input type="password" autoComplete="new-password" value={passwordRepeat} disabled={busy} onChange={({ detail }) => setPasswordRepeat(detail.value)} /></FormField>
          <FormField label={text("Operator password — optional", "작업자 비밀번호 — 선택 사항")}><Input type="password" autoComplete="current-password" value={confirmationPassword} disabled={busy} onChange={({ detail }) => setConfirmationPassword(detail.value)} /></FormField>
          {Boolean(formError) && <Alert type="error">{formError}</Alert>}
          <Button variant="primary" loading={busy} onClick={() => void savePassword()}>{text("Change password", "비밀번호 변경")}</Button>
        </SpaceBetween> },
        { id: "tfa", label: text("Two-factor authentication", "2단계 인증"), content: <SpaceBetween size="l">
          <Table items={tfaEntries} trackBy="id" loading={loading} loadingText={text("Loading authentication factors", "인증 수단 불러오는 중")} empty={<Box>{text("No authentication factors.", "등록된 인증 수단이 없습니다.")}</Box>}
            header={<Header actions={<SpaceBetween direction="horizontal" size="xs"><Button disabled={busy} onClick={() => setUnlockConfirm(true)}>{text("Unlock factors", "인증 잠금 해제")}</Button><Button variant="primary" disabled={busy} onClick={() => openTfa()}>{t("common.create")}</Button></SpaceBetween>}>{text("Authentication factors", "인증 수단")}</Header>}
            columnDefinitions={[
              { id: "type", header: t("permissions.type"), cell: (entry) => entry.type, isRowHeader: true },
              { id: "description", header: t("permissions.comment"), cell: (entry) => entry.description ?? entry.id },
              { id: "enabled", header: t("permissions.enabled"), cell: (entry) => entry.enable !== 0 && entry.enable !== false ? t("common.yes") : t("common.no") },
              { id: "actions", header: t("common.actions"), cell: (entry) => <SpaceBetween direction="horizontal" size="xs"><Button disabled={busy} onClick={() => openTfa(entry, "edit")}>{t("common.edit")}</Button><Button disabled={busy} onClick={() => openTfa(entry, "delete")}>{t("common.delete")}</Button></SpaceBetween> },
            ]} />
          {unlockConfirm && <Alert type="warning" action={<SpaceBetween direction="horizontal" size="xs"><Button disabled={busy} onClick={() => setUnlockConfirm(false)}>{t("common.cancel")}</Button><Button loading={busy} onClick={() => void run(async () => { await accessRequest(`${userPath}/unlock-tfa`, { method: "PUT" }); setUnlockConfirm(false); })}>{t("common.confirm")}</Button></SpaceBetween>}>{text(`Unlock TOTP and other authentication factors for ${userid}?`, `${userid}의 TOTP 및 다른 인증 수단의 잠금을 해제하시겠습니까?`)}</Alert>}
          {tfaForm && <SpaceBetween size="l">
            {tfaForm.action === "delete" ? <Alert type="warning">{text(`Delete ${tfaForm.description || tfaForm.id}? This factor can no longer be used to sign in.`, `${tfaForm.description || tfaForm.id} 인증 수단을 삭제하면 로그인에 사용할 수 없습니다.`)}</Alert> : <>
              {tfaForm.action === "create" && <FormField label={t("permissions.type")}><Select disabled={busy} selectedOption={{ label: tfaForm.type, value: tfaForm.type }} options={[{ label: "TOTP", value: "totp" }, { label: text("Recovery codes", "복구 코드"), value: "recovery" }, { label: "YubiKey OTP", value: "yubico" }, { label: text("Security key / passkey", "보안 키 / 패스키"), value: "webauthn" }]} onChange={({ detail }) => { const type = detail.selectedOption.value ?? "totp"; setFormError(""); setTfaForm({ ...tfaForm, type, uri: type === "totp" ? makeTotpUri(userid, crypto.getRandomValues(new Uint8Array(20))) : "", value: "", password: "" }); }} /></FormField>}
              <FormField label={t("permissions.comment")}><Input disabled={busy} value={tfaForm.description} onChange={({ detail }) => setTfaForm({ ...tfaForm, description: detail.value })} /></FormField>
              {tfaForm.action === "edit" && <Checkbox checked={tfaForm.enable} disabled={busy} onChange={({ detail }) => setTfaForm({ ...tfaForm, enable: detail.checked })}>{t("permissions.enabled")}</Checkbox>}
              {tfaForm.action === "create" && tfaForm.type === "totp" && <>
                <FormField label={text("Authenticator secret", "인증 앱 비밀 키")} description={text("Add this key to your authenticator: time-based, SHA1, six digits, 30 seconds. Then enter its current code.", "인증 앱에 이 키를 등록하세요. 시간 기반, SHA1, 6자리, 30초 설정으로 현재 코드를 입력합니다.")}>{copy(new URL(tfaForm.uri).searchParams.get("secret") ?? "")}</FormField>
                <FormField label={text("Authenticator URI", "인증 앱 URI")}>{copy(tfaForm.uri)}</FormField>
              </>}
              {tfaForm.action === "create" && ["totp", "yubico"].includes(tfaForm.type) && <FormField label={text("Verification code", "확인 코드")}><Input disabled={busy} autoComplete="one-time-code" value={tfaForm.value} onChange={({ detail }) => setTfaForm({ ...tfaForm, value: detail.value })} /></FormField>}
              {tfaForm.action === "create" && tfaForm.type === "webauthn" && <Alert type="info">{registrationPhase === "prompt" ? text("Follow the browser prompt to register your security key or passkey.", "브라우저의 안내에 따라 보안 키 또는 패스키를 등록하세요.") : text("The Proxmox WebAuthn RP ID and allowed origin must support this HTTPS site. Keep the existing RP ID to preserve enrolled keys. Your browser will ask you to create a credential.", "Proxmox의 WebAuthn RP ID와 허용 origin이 이 HTTPS 사이트를 지원해야 합니다. 기존에 등록한 키를 유지하려면 RP ID를 변경하지 마세요. 브라우저가 인증 수단 생성을 안내합니다.")}</Alert>}
              {tfaForm.action === "create" && tfaForm.type === "recovery" && <Alert type="info">{text("Recovery codes are displayed only once after creation. Existing unused codes must be removed before generating a replacement set.", "복구 코드는 생성 직후 한 번만 표시됩니다. 새 코드를 생성하려면 기존의 미사용 코드 세트를 먼저 삭제해야 합니다.")}</Alert>}
            </>}
            <FormField label={text("Operator password — optional", "작업자 비밀번호 — 선택 사항")} description={text("The current password of the signed-in operator, if Proxmox requires it.", "Proxmox에서 요구하는 경우 로그인한 작업자의 현재 비밀번호를 입력하세요.")}><Input type="password" autoComplete="current-password" disabled={busy} value={tfaForm.password} onChange={({ detail }) => setTfaForm({ ...tfaForm, password: detail.value })} /></FormField>
            <SpaceBetween direction="horizontal" size="xs"><Button disabled={busy && registrationPhase !== "prompt"} onClick={() => { registrationAbort.current?.abort(); setTfaForm(null); setFormError(""); }}>{t("common.cancel")}</Button><Button variant="primary" loading={busy} onClick={() => void saveTfa()}>{tfaForm.action === "delete" ? t("common.delete") : tfaForm.action === "create" ? t("common.create") : t("common.save")}</Button></SpaceBetween>
          </SpaceBetween>}
          {Boolean(formError) && <Alert type="error">{formError}</Alert>}
        </SpaceBetween> },
        { id: "permissions", label: text("Effective permissions", "유효 권한"), content: <SpaceBetween size="l">
          <FormField label={text("User or token", "사용자 또는 토큰")}><Select selectedOption={permissionOptions.find((option) => option.value === permissionSubject) ?? null} options={permissionOptions} onChange={({ detail }) => setPermissionSubject(detail.selectedOption.value ?? userid)} /></FormField>
          <Table items={permissions} loading={loading} loadingText={text("Loading permissions", "권한 불러오는 중")} trackBy={(entry) => `${entry.path}:${entry.privilege}`} empty={<Box>{text("No effective permissions.", "유효 권한이 없습니다.")}</Box>} columnDefinitions={[{ id: "path", header: t("permissions.path"), cell: (entry) => entry.path, isRowHeader: true }, { id: "privilege", header: t("permissions.privileges"), cell: (entry) => entry.privilege }, { id: "propagate", header: t("permissions.propagate"), cell: (entry) => entry.propagate ? t("common.yes") : t("common.no") }]} />
        </SpaceBetween> },
      ]} />
    </SpaceBetween>
  </Modal>;
}
