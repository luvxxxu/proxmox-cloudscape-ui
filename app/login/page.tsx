"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { answerWebAuthn, type WebAuthnChallenge } from "@/app/lib/webauthn-client";
import { useTranslation } from "@/app/lib/use-translation";

const REALM_OPTIONS: ReadonlyArray<SelectProps.Option> = [
  { label: "Linux PAM", value: "pam" },
  { label: "Proxmox VE Authentication", value: "pve" },
];

interface LoginResponse {
  error?: string;
  secondFactorRequired?: boolean;
  methods?: string[];
  webauthn?: WebAuthnChallenge;
}

export default function LoginPage() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const realmTouched = useRef(false);
  const [realmOptions, setRealmOptions] = useState<ReadonlyArray<SelectProps.Option>>(REALM_OPTIONS);
  const [methods, setMethods] = useState<string[]>([]);
  const [factor, setFactor] = useState<SelectProps.Option | null>(null);
  const [otp, setOtp] = useState("");
  const [webauthn, setWebauthn] = useState<WebAuthnChallenge | null>(null);
  const [openIdRealms, setOpenIdRealms] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [realm, setRealm] = useState<SelectProps.Option>(REALM_OPTIONS[0]!);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(() => searchParams.get("openid") === "failed"
    ? "OpenID sign-in failed. Try again and check the realm redirect URI configuration."
    : searchParams.get("expired") === "1" ? "Your session expired. Sign in again." : null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/realms", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const json = await response.json();
      if (!Array.isArray(json.data)) return;
      const options = json.data.filter((item: { realm?: unknown }) => typeof item.realm === "string")
        .map((item: { realm: string; comment?: string; type?: string; default?: number }) => ({
          label: item.comment || item.realm, value: item.realm,
          description: item.type,
        }));
      if (!controller.signal.aborted && options.length) {
        const defaultRealm = json.data.find((item: { default?: number }) => item.default);
        if (!realmTouched.current && defaultRealm) setRealm(options.find((option: SelectProps.Option) => option.value === defaultRealm.realm) ?? options[0]);
        setRealmOptions(options); setOpenIdRealms(json.data.filter((item: { type?: string }) => item.type === "openid").map((item: { realm: string }) => item.realm)); }
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  const handleSubmit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError(null);

    try {
      if (!methods.length && openIdRealms.includes(realm.value || "")) {
        const result = await fetch("/api/auth/openid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ realm: realm.value }) });
        const data = await result.json();
        if (!result.ok || !data.url) throw new Error(data.error || "OpenID sign-in failed");
        window.location.assign(data.url);
        return;
      }
      const verification = factor?.value === "webauthn" && webauthn ? await answerWebAuthn(webauthn) : otp;
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(methods.length ? { otp: verification, factor: factor?.value } : { username, password, realm: realm.value }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as LoginResponse;
        throw new Error(data.error ?? t("auth.loginFailed"));
      }

      const data = await response.json() as LoginResponse;
      if (data.secondFactorRequired && data.methods?.length) {
        setPassword("");
        setMethods(data.methods);
        setWebauthn(data.webauthn || null);
        setFactor({ label: data.methods[0], value: data.methods[0] });
        return;
      }
      // A successful sign-in starts a fresh AuthProvider and clears the previous account's client cache.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("auth.loginFailed"));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <Box padding={{ top: "xxxl", horizontal: "l", bottom: "xxxl" }}>
      <Box textAlign="center" margin={{ bottom: "xl" }}>
        <Header variant="h1">{t("common.loginTitle")}</Header>
        <Box color="text-body-secondary">{t("auth.signInToDashboard")}</Box>
      </Box>
      <div
        style={{
          maxWidth: "420px",
          margin: "0 auto",
        }}
      >
        <Container header={<Header variant="h2">{t("auth.login")}</Header>}>
          <form onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
          <Form variant="embedded" actions={<Button variant="primary" formAction="submit" loading={loading} disabled={methods.length ? factor?.value !== "webauthn" && !otp : !openIdRealms.includes(realm.value || "") && (!username.trim() || !password)}>{methods.length ? "Verify" : t("auth.logIn")}</Button>}>
          <SpaceBetween size="l">
            {error ? <Alert type="error">{error}</Alert> : null}
            {methods.length ? <>
              <FormField label="Verification method"><Select disabled={loading} selectedOption={factor} options={methods.map((method) => ({ label: method === "totp" ? "Authenticator code" : method === "recovery" ? "Recovery code" : method === "webauthn" ? "Security key / passkey" : "YubiKey OTP", value: method }))} onChange={({ detail }) => setFactor(detail.selectedOption)} /></FormField>
              {factor?.value === "webauthn" ? <Alert type="info">Press Verify and follow your browser’s security key prompt. The WebAuthn RP ID and allowed origin configured in Proxmox must include this site.</Alert> : <FormField label="Verification code"><Input disabled={loading} value={otp} onChange={({ detail }) => setOtp(detail.value)} autoFocus autoComplete="one-time-code" /></FormField>}
              <Button disabled={loading} formAction="none" onClick={() => { setMethods([]); setOtp(""); setError(null); }}>Back to sign in</Button>
            </> : <>
            {!openIdRealms.includes(realm.value || "") && <>
            <FormField label={t("auth.username")}>
              <Input
                disabled={loading}
                value={username}
                placeholder="root"
                autoComplete="username"
                onChange={({ detail }) => setUsername(detail.value)}
              />
            </FormField>
            <FormField label={t("auth.password")}>
              <Input
                disabled={loading}
                value={password}
                type="password"
                autoComplete="current-password"
                onChange={({ detail }) => setPassword(detail.value)}
              />
            </FormField>
            </>}
            <FormField label={t("auth.realm")}>
              <Select
                disabled={loading}
                selectedOption={realm}
                options={realmOptions}
                onChange={({ detail }) => { realmTouched.current = true; setRealm(detail.selectedOption); }}
              />
            </FormField>
            </>}
          </SpaceBetween>
          </Form>
          </form>
        </Container>
      </div>
    </Box>
  );
}
