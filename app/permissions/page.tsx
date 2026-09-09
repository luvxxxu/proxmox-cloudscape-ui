"use client";

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Multiselect from "@cloudscape-design/components/multiselect";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useTranslation } from "@/app/lib/use-translation";

import UserSecurity from "./user-security";
import { AccessApiError, accessRequest } from "./access-api";
import { accessList, parseExpireInput, formatExpireInput, isValidUserId, isValidAccessId, realmTfaType } from "./access-data";

interface PveToken {
  tokenid?: string;
}

interface PveUser {
  userid: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  realm?: string;
  enable?: number | boolean;
  enabled?: boolean;
  expire?: number;
  comment?: string;
  groups?: string[] | string;
  tokens?: PveToken[];
}

interface PveGroupListItem {
  groupid: string;
  comment?: string;
  users?: string;
}

interface GroupRow {
  groupid: string;
  comment?: string;
  users: string[];
}

interface PveRoleListItem {
  roleid: string;
  privs?: string[] | string;
  special?: number | boolean;
}

interface PveRoleDetails {
  roleid?: string;
  privs?: string[] | string;
  special?: number | boolean;
}

interface RoleRow {
  roleid: string;
  privs: string[];
  special: boolean;
}

interface PveAcl {
  path: string;
  ugid: string;
  type?: string;
  ugid_type?: string;
  roleid: string;
  propagate?: number | boolean;
}

interface AclRow {
  path: string;
  ugid: string;
  type: "user" | "group" | "token";
  roleid: string;
  propagate: boolean;
}

interface PveRealm {
  realm: string;
  type: string;
  comment?: string;
  default?: number | boolean;
  tfa?: string;
  server1?: string;
  server2?: string;
  base_dn?: string;
  user_attr?: string;
  port?: number;
  secure?: number | boolean;
  mode?: "ldap" | "ldaps" | "ldap+starttls";
  verify?: number | boolean;
  digest?: string;
  bind_dn?: string;
  domain?: string;
  "issuer-url"?: string;
  "client-id"?: string;
  "client-key"?: string;
  autocreate?: number | boolean;
  "username-claim"?: string;
}

type RealmType = "pam" | "pve" | "ldap" | "ad" | "openid";

interface RealmFormState {
  realm: string;
  type: RealmType | "";
  comment: string;
  default: boolean;
  tfa: "none" | "oath" | "yubico";
  server: string;
  baseDn: string;
  userAttribute: string;
  port: string;
  mode: "ldap" | "ldaps" | "ldap+starttls";
  verify: boolean;
  fallbackServer: string;
  digest: string;
  tfaConfig: string;
  bindDn: string;
  bindPassword: string;
  domain: string;
  issuerUrl: string;
  clientId: string;
  clientKey: string;
  autocreate: boolean;
  usernameClaim: string;
}

interface Preferences {
  pageSize: number;
  wrapLines: boolean;
  stripedRows: boolean;
  contentDensity: "comfortable" | "compact";
  contentDisplay: ReadonlyArray<CollectionPreferencesProps.ContentDisplayItem>;
}

interface UserFormState {
  userid: string;
  password: string;
  groups: string;
  email: string;
  firstname: string;
  lastname: string;
  comment: string;
  enabled: boolean;
  expire: string;
}

interface GroupFormState {
  groupid: string;
  comment: string;
}

interface RoleFormState {
  roleid: string;
  privs: string;
}

interface AclFormState {
  path: string;
  subjectType: "user" | "group" | "token";
  subjectId: string;
  roleid: string;
  propagate: boolean;
}

const DEFAULT_USER_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "userid", visible: true },
    { id: "firstname", visible: true },
    { id: "lastname", visible: true },
    { id: "email", visible: true },
    { id: "realm", visible: true },
    { id: "enabled", visible: true },
    { id: "expire", visible: true },
    { id: "comment", visible: true },
    { id: "actions", visible: true },
  ],
};

const DEFAULT_GROUP_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "groupid", visible: true },
    { id: "comment", visible: true },
    { id: "users", visible: true },
    { id: "actions", visible: true },
  ],
};

const DEFAULT_ROLE_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "roleid", visible: true },
    { id: "privs", visible: true },
    { id: "special", visible: true },
    { id: "actions", visible: true },
  ],
};

const DEFAULT_ACL_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "path", visible: true },
    { id: "type", visible: true },
    { id: "ugid", visible: true },
    { id: "roleid", visible: true },
    { id: "propagate", visible: true },
    { id: "actions", visible: true },
  ],
};

const DEFAULT_REALM_PREFERENCES: Preferences = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDensity: "comfortable",
  contentDisplay: [
    { id: "realm", visible: true },
    { id: "type", visible: true },
    { id: "comment", visible: true },
    { id: "default", visible: true },
    { id: "tfa", visible: true },
    { id: "actions", visible: true },
  ],
};

const EMPTY_USER_FORM: UserFormState = {
  userid: "",
  password: "",
  groups: "",
  email: "",
  firstname: "",
  lastname: "",
  comment: "",
  enabled: true,
  expire: "",
};

const EMPTY_GROUP_FORM: GroupFormState = {
  groupid: "",
  comment: "",
};

const EMPTY_ROLE_FORM: RoleFormState = {
  roleid: "",
  privs: "",
};

const EMPTY_ACL_FORM: AclFormState = {
  path: "/",
  subjectType: "user",
  subjectId: "",
  roleid: "",
  propagate: true,
};

const EMPTY_REALM_FORM: RealmFormState = {
  realm: "",
  type: "",
  comment: "",
  default: false,
  tfa: "none",
  server: "",
  baseDn: "",
  userAttribute: "uid",
  port: "",
  mode: "ldaps",
  verify: true,
  fallbackServer: "",
  digest: "",
  tfaConfig: "",
  bindDn: "",
  bindPassword: "",
  domain: "",
  issuerUrl: "",
  clientId: "",
  clientKey: "",
  autocreate: false,
  usernameClaim: "",
};

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

const toList = accessList;

function formatList(value?: string[] | string, emptyValue = "") {
  const items = toList(value);
  return items.length > 0 ? items.join(", ") : emptyValue;
}

function getRealm(user: PveUser, emptyValue = "") {
  if (user.realm) {
    return user.realm;
  }

  const separator = user.userid.lastIndexOf("@");
  return separator >= 0 ? user.userid.slice(separator + 1) : emptyValue;
}

function isUserEnabled(user: PveUser) {
  if (typeof user.enabled === "boolean") {
    return user.enabled;
  }

  if (typeof user.enable === "boolean") {
    return user.enable;
  }

  return user.enable !== 0;
}

function isRoleSpecial(role: PveRoleListItem | PveRoleDetails | RoleRow) {
  return role.special === true || role.special === 1;
}

function isRealmEnabled(value?: number | boolean) {
  return value === true || value === 1;
}

function isRealmType(value: string): value is RealmType {
  return value === "pam" || value === "pve" || value === "ldap" || value === "ad" || value === "openid";
}

function isBuiltInRealm(realm: PveRealm) {
  return realm.type === "pam" || realm.type === "pve";
}

function getAclType(entry: PveAcl): "user" | "group" | "token" {
  const type = (entry.type ?? entry.ugid_type ?? "").toLowerCase();
  if (type === "group") {
    return "group";
  }
  if (type === "token" || entry.ugid.includes("!")) {
    return "token";
  }
  return "user";
}

async function fetchProxmox<T>(path: string, _t: (key: string) => string, init?: RequestInit): Promise<T> {
  return accessRequest<T>(path, init);
}

function encodeFormBody(params: URLSearchParams) {
  return {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params.toString(),
  };
}

function getTrackableId(option: SelectProps.Option | null) {
  return typeof option?.value === "string" ? option.value : "";
}

function buildUserForm(user: PveUser): UserFormState {
  return {
    userid: user.userid,
    password: "",
    groups: toList(user.groups).join(", "),
    email: user.email ?? "",
    firstname: user.firstname ?? "",
    lastname: user.lastname ?? "",
    comment: user.comment ?? "",
    enabled: isUserEnabled(user),
    expire: formatExpireInput(user.expire),
  };
}

function buildGroupForm(group: GroupRow): GroupFormState {
  return {
    groupid: group.groupid,
    comment: group.comment ?? "",
  };
}

function buildRoleForm(role: RoleRow): RoleFormState {
  return {
    roleid: role.roleid,
    privs: role.privs.join(", "),
  };
}

function buildRealmForm(realm: PveRealm): RealmFormState {
  return {
    realm: realm.realm,
    type: isRealmType(realm.type) ? realm.type : "",
    comment: realm.comment ?? "",
    default: isRealmEnabled(realm.default),
    tfa: realmTfaType(realm.tfa),
    server: realm.server1 ?? "",
    baseDn: realm.base_dn ?? "",
    userAttribute: realm.user_attr ?? "uid",
    port: realm.port ? String(realm.port) : "",
    mode: realm.mode ?? (isRealmEnabled(realm.secure) ? "ldaps" : "ldap"),
    verify: isRealmEnabled(realm.verify),
    fallbackServer: realm.server2 ?? "",
    digest: realm.digest ?? "",
    tfaConfig: realm.tfa?.includes("=") ? realm.tfa : realm.tfa ? `type=${realm.tfa}` : "",
    bindDn: realm.bind_dn ?? "",
    bindPassword: "",
    domain: realm.domain ?? "",
    issuerUrl: realm["issuer-url"] ?? "",
    clientId: realm["client-id"] ?? "",
    clientKey: "",
    autocreate: isRealmEnabled(realm.autocreate),
    usernameClaim: realm["username-claim"] ?? "",
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

export default function PermissionsPage() {
  const { t, language } = useTranslation();
  const text = useCallback((en: string, ko: string) => language === "ko" ? ko : en, [language]);
  const emptyValue = t("permissions.none");

  const [securityUser, setSecurityUser] = useState<string | null>(null);
  const [operationError, setOperationError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const loadSequence = useRef(0);
  const [activeTabId, setActiveTabId] = useState("users");
  const [users, setUsers] = useState<PveUser[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [acls, setAcls] = useState<AclRow[]>([]);
  const [realms, setRealms] = useState<PveRealm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const [userPreferences, setUserPreferences] = useState<Preferences>(DEFAULT_USER_PREFERENCES);
  const [groupPreferences, setGroupPreferences] = useState<Preferences>(DEFAULT_GROUP_PREFERENCES);
  const [rolePreferences, setRolePreferences] = useState<Preferences>(DEFAULT_ROLE_PREFERENCES);
  const [aclPreferences, setAclPreferences] = useState<Preferences>(DEFAULT_ACL_PREFERENCES);
  const [realmPreferences, setRealmPreferences] = useState<Preferences>(DEFAULT_REALM_PREFERENCES);

  const [createUserVisible, setCreateUserVisible] = useState(false);
  const [editUserVisible, setEditUserVisible] = useState(false);
  const [deleteUserVisible, setDeleteUserVisible] = useState(false);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>(EMPTY_USER_FORM);
  const [selectedUser, setSelectedUser] = useState<PveUser | null>(null);

  const [createGroupVisible, setCreateGroupVisible] = useState(false);
  const [editGroupVisible, setEditGroupVisible] = useState(false);
  const [deleteGroupVisible, setDeleteGroupVisible] = useState(false);
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [groupForm, setGroupForm] = useState<GroupFormState>(EMPTY_GROUP_FORM);
  const [selectedGroup, setSelectedGroup] = useState<GroupRow | null>(null);

  const [createRoleVisible, setCreateRoleVisible] = useState(false);
  const [editRoleVisible, setEditRoleVisible] = useState(false);
  const [deleteRoleVisible, setDeleteRoleVisible] = useState(false);
  const [roleSubmitting, setRoleSubmitting] = useState(false);
  const [roleForm, setRoleForm] = useState<RoleFormState>(EMPTY_ROLE_FORM);
  const [selectedRole, setSelectedRole] = useState<RoleRow | null>(null);

  const [createAclVisible, setCreateAclVisible] = useState(false);
  const [deleteAclVisible, setDeleteAclVisible] = useState(false);
  const [aclSubmitting, setAclSubmitting] = useState(false);
  const [aclForm, setAclForm] = useState<AclFormState>(EMPTY_ACL_FORM);
  const [selectedAcl, setSelectedAcl] = useState<AclRow | null>(null);

  const [createRealmVisible, setCreateRealmVisible] = useState(false);
  const [editRealmVisible, setEditRealmVisible] = useState(false);
  const [deleteRealmVisible, setDeleteRealmVisible] = useState(false);
  const [realmSubmitting, setRealmSubmitting] = useState(false);
  const [realmForm, setRealmForm] = useState<RealmFormState>(EMPTY_REALM_FORM);
  const [selectedRealm, setSelectedRealm] = useState<PveRealm | null>(null);

  const addFlash = useCallback((item: FlashbarProps.MessageDefinition) => {
    setFlashItems((current) => {
      const next = current.filter((entry) => entry.id !== item.id);
      return [item, ...next].slice(0, 5);
    });
  }, []);

  const dismissFlash = useCallback((id: string) => {
    setFlashItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const addSuccess = useCallback((content: string) => {
    setOperationError(""); setFieldErrors({});
    const id = `success-${Date.now()}`;
    addFlash({
      id,
      type: "success",
      content,
      dismissible: true,
      onDismiss: () => dismissFlash(id),
    });
  }, [addFlash, dismissFlash]);

  const addError = useCallback((content: string) => {
    setOperationError(content);
    const id = `error-${Date.now()}`;
    addFlash({
      id,
      type: "error",
      content,
      dismissible: true,
      onDismiss: () => dismissFlash(id),
    });
  }, [addFlash, dismissFlash]);

  const loadData = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    const results = await Promise.allSettled([
      fetchProxmox<PveUser[]>("/api/proxmox/access/users?full=1", t),
      fetchProxmox<PveGroupListItem[]>("/api/proxmox/access/groups", t),
      fetchProxmox<PveRoleListItem[]>("/api/proxmox/access/roles", t),
      fetchProxmox<PveAcl[]>("/api/proxmox/access/acl", t),
      fetchProxmox<PveRealm[]>("/api/proxmox/access/domains", t),
    ]);
    if (sequence !== loadSequence.current) return;
    const [userResult, groupResult, roleResult, aclResult, realmResult] = results;
    if (userResult.status === "fulfilled") setUsers((userResult.value ?? []).sort((a, b) => a.userid.localeCompare(b.userid)));
    if (groupResult.status === "fulfilled") setGroups((groupResult.value ?? []).map((group) => ({ ...group, users: toList(group.users) })).sort((a, b) => a.groupid.localeCompare(b.groupid)));
    if (roleResult.status === "fulfilled") setRoles((roleResult.value ?? []).map((role) => ({ roleid: role.roleid, privs: toList(role.privs), special: isRoleSpecial(role) })).sort((a, b) => a.roleid.localeCompare(b.roleid)));
    if (aclResult.status === "fulfilled") setAcls((aclResult.value ?? []).map((entry) => ({ ...entry, type: getAclType(entry), propagate: entry.propagate !== false && entry.propagate !== 0 })).sort((a, b) => `${a.path}:${a.ugid}:${a.roleid}`.localeCompare(`${b.path}:${b.ugid}:${b.roleid}`)));
    if (realmResult.status === "fulfilled") setRealms((realmResult.value ?? []).sort((a, b) => a.realm.localeCompare(b.realm)));
    const names = [t("permissions.usersTab"), t("permissions.groupsTab"), t("permissions.rolesTab"), t("permissions.aclTab"), t("permissions.realmsTab")];
    const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${names[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
    setError(errors.length ? errors.join("; ") : null);
    setLoading(false);
  }, [t]);

  const editRealm = useCallback(async (realm: PveRealm) => {
    setRealmSubmitting(true);
    setOperationError(""); setFieldErrors({});
    try {
      const details = await fetchProxmox<PveRealm>(`/api/proxmox/access/domains/${encodeURIComponent(realm.realm)}`, t);
      const complete = { ...realm, ...details };
      setSelectedRealm(complete);
      setRealmForm(buildRealmForm(complete));
      setOperationError(""); setFieldErrors({});
                setEditRealmVisible(true);
    } catch (cause) {
      addError(cause instanceof Error ? cause.message : String(cause));
    } finally { setRealmSubmitting(false); }
  }, [addError, t]);

  useEffect(() => {
    // Start an external request; loading state follows its asynchronous lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
    return () => { loadSequence.current += 1; };
  }, [loadData]);

  const userOptions = useMemo<SelectProps.Options>(
    () => users.map((user) => ({ label: user.userid, value: user.userid })),
    [users],
  );

  const tokenOptions = useMemo<SelectProps.Options>(
    () =>
      users.flatMap((user) =>
        (user.tokens ?? [])
          .filter((token) => Boolean(token.tokenid))
          .map((token) => ({
            label: `${user.userid}!${token.tokenid}`,
            value: `${user.userid}!${token.tokenid}`,
          })),
      ),
    [users],
  );

  const groupOptions = useMemo<SelectProps.Options>(
    () => groups.map((group) => ({ label: group.groupid, value: group.groupid })),
    [groups],
  );

  const roleOptions = useMemo<SelectProps.Options>(
    () => roles.map((role) => ({ label: role.roleid, value: role.roleid })),
    [roles],
  );

  const realmTypeOptions = useMemo<SelectProps.Options>(
    () => [
      ...(editRealmVisible ? [{ label: t("permissions.realmTypePam"), value: "pam" }, { label: t("permissions.realmTypePve"), value: "pve" }] : []),
      { label: t("permissions.realmTypeLdap"), value: "ldap" },
      { label: t("permissions.realmTypeAd"), value: "ad" },
      { label: t("permissions.realmTypeOpenid"), value: "openid" },
    ],
    [editRealmVisible, t],
  );

  const realmTfaOptions = useMemo<SelectProps.Options>(
    () => [
      { label: t("permissions.tfaNone"), value: "none" },
      { label: t("permissions.tfaOath"), value: "oath" },
      { label: t("permissions.tfaYubico"), value: "yubico" },
    ],
    [t],
  );


  const aclSubjectOptions = useMemo<SelectProps.Options>(() => {
    if (aclForm.subjectType === "group") {
      return groupOptions;
    }
    if (aclForm.subjectType === "token") {
      return tokenOptions;
    }
    return userOptions;
  }, [aclForm.subjectType, groupOptions, tokenOptions, userOptions]);

  const selectedAclRoleOption = useMemo(
    () => roleOptions.find((option) => option.value === aclForm.roleid) ?? null,
    [aclForm.roleid, roleOptions],
  );

  const selectedAclSubjectOption = useMemo(
    () => aclSubjectOptions.find((option) => option.value === aclForm.subjectId) ?? null,
    [aclForm.subjectId, aclSubjectOptions],
  );

  const selectedRealmTypeOption = useMemo(
    () => realmTypeOptions.find((option) => option.value === realmForm.type) ?? null,
    [realmForm.type, realmTypeOptions],
  );

  const selectedRealmTfaOption = useMemo(
    () => realmTfaOptions.find((option) => option.value === realmForm.tfa) ?? null,
    [realmForm.tfa, realmTfaOptions],
  );


  const getRealmTypeLabel = useCallback((type: string) => {
    switch (type) {
      case "pam":
        return t("permissions.realmTypePam");
      case "pve":
        return t("permissions.realmTypePve");
      case "ldap":
        return t("permissions.realmTypeLdap");
      case "ad":
        return t("permissions.realmTypeAd");
      case "openid":
        return t("permissions.realmTypeOpenid");
      default:
        return type || emptyValue;
    }
  }, [emptyValue, t]);

  const getRealmTfaLabel = useCallback((value?: string) => {
    switch (value) {
      case "oath":
        return t("permissions.tfaOath");
      case "yubico":
        return t("permissions.tfaYubico");
      case "none":
      case undefined:
      case "":
        return t("permissions.tfaNone");
      default:
        return value;
    }
  }, [t]);

  const userColumns = useMemo<TableProps<PveUser>["columnDefinitions"]>(
    () => [
      {
        id: "userid",
        header: t("permissions.userId"),
        cell: ({ userid }) => userid,
        sortingField: "userid",
        isRowHeader: true,
        minWidth: 180,
      },
      {
        id: "firstname",
        header: t("permissions.firstName"),
        cell: ({ firstname }) => firstname ?? emptyValue,
        sortingField: "firstname",
        minWidth: 150,
      },
      {
        id: "lastname",
        header: t("permissions.lastName"),
        cell: ({ lastname }) => lastname ?? emptyValue,
        sortingField: "lastname",
        minWidth: 150,
      },
      {
        id: "email",
        header: t("permissions.email"),
        cell: ({ email }) => email ?? emptyValue,
        sortingField: "email",
        minWidth: 220,
      },
      {
        id: "realm",
        header: t("permissions.realm"),
        cell: (user) => getRealm(user, emptyValue),
        sortingComparator: (a, b) => getRealm(a, emptyValue).localeCompare(getRealm(b, emptyValue)),
        minWidth: 140,
      },
      {
        id: "enabled",
        header: t("permissions.enabled"),
        cell: (user) => (
          <StatusIndicator type={isUserEnabled(user) ? "success" : "stopped"}>
            {isUserEnabled(user) ? t("permissions.enabled") : t("permissions.disabled")}
          </StatusIndicator>
        ),
        sortingComparator: (a, b) => Number(isUserEnabled(a)) - Number(isUserEnabled(b)),
        minWidth: 140,
      },
      {
        id: "expire",
        header: t("permissions.expire"),
        cell: ({ expire }) => (expire ? new Date(expire * 1000).toLocaleDateString() : t("permissions.never")),
        sortingComparator: (a, b) => (a.expire ?? 0) - (b.expire ?? 0),
        minWidth: 160,
      },
      {
        id: "comment",
        header: t("permissions.comment"),
        cell: ({ comment }) => comment ?? emptyValue,
        minWidth: 240,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (user) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button formAction="none"
              onClick={() => {
                setSelectedUser(user);
                setUserForm(buildUserForm(user));
                setOperationError(""); setFieldErrors({});
                setEditUserVisible(true);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button formAction="none" onClick={() => setSecurityUser(user.userid)}>{text("Security", "보안")}</Button>
            <Button formAction="none"
              variant="inline-icon"
              iconName="remove"
              disabled={user.userid === "root@pam"}
              ariaLabel={interpolate(t("permissions.deleteUserAriaLabel"), { userid: user.userid })}
              onClick={() => {
                setSelectedUser(user);
                setOperationError(""); setFieldErrors({});
                setDeleteUserVisible(true);
              }}
            />
          </SpaceBetween>
        ),
        minWidth: 180,
      },
    ],
    [emptyValue, t, text],
  );

  const groupColumns = useMemo<TableProps<GroupRow>["columnDefinitions"]>(
    () => [
      {
        id: "groupid",
        header: t("permissions.groupId"),
        cell: ({ groupid }) => groupid,
        sortingField: "groupid",
        isRowHeader: true,
        minWidth: 180,
      },
      {
        id: "comment",
        header: t("permissions.comment"),
        cell: ({ comment }) => comment ?? emptyValue,
        sortingField: "comment",
        minWidth: 260,
      },
      {
        id: "users",
        header: t("permissions.members"),
        cell: ({ users }) => formatList(users, emptyValue),
        sortingComparator: (a, b) => a.users.join(",").localeCompare(b.users.join(",")),
        minWidth: 260,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (group) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button formAction="none"
              onClick={() => {
                setSelectedGroup(group);
                setGroupForm(buildGroupForm(group));
                setOperationError(""); setFieldErrors({});
                setEditGroupVisible(true);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button formAction="none"
              variant="inline-icon"
              iconName="remove"
              ariaLabel={interpolate(t("permissions.deleteGroupAriaLabel"), { groupid: group.groupid })}
              onClick={() => {
                setSelectedGroup(group);
                setOperationError(""); setFieldErrors({});
                setDeleteGroupVisible(true);
              }}
            />
          </SpaceBetween>
        ),
        minWidth: 180,
      },
    ],
    [emptyValue, t],
  );

  const roleColumns = useMemo<TableProps<RoleRow>["columnDefinitions"]>(
    () => [
      {
        id: "roleid",
        header: t("permissions.roleId"),
        cell: ({ roleid }) => roleid,
        sortingField: "roleid",
        isRowHeader: true,
        minWidth: 180,
      },
      {
        id: "privs",
        header: t("permissions.privileges"),
        cell: ({ privs }) => formatList(privs, emptyValue),
        sortingComparator: (a, b) => a.privs.join(",").localeCompare(b.privs.join(",")),
        minWidth: 340,
      },
      {
        id: "special",
        header: t("permissions.special"),
        cell: ({ special }) => (
          <StatusIndicator type={special ? "info" : "success"}>
            {special ? t("permissions.builtIn") : t("permissions.custom")}
          </StatusIndicator>
        ),
        sortingComparator: (a, b) => Number(a.special) - Number(b.special),
        minWidth: 160,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (role) => {
          if (role.special) {
            return <Box color="text-body-secondary">{t("permissions.builtIn")}</Box>;
          }

          return (
            <SpaceBetween direction="horizontal" size="xs">
              <Button formAction="none"
                onClick={() => {
                  setSelectedRole(role);
                  setRoleForm(buildRoleForm(role));
                  setOperationError(""); setFieldErrors({});
                setEditRoleVisible(true);
                }}
              >
                {t("common.edit")}
              </Button>
              <Button formAction="none"
                variant="inline-icon"
                iconName="remove"
                ariaLabel={interpolate(t("permissions.deleteRoleAriaLabel"), { roleid: role.roleid })}
                onClick={() => {
                  setSelectedRole(role);
                  setOperationError(""); setFieldErrors({});
                setDeleteRoleVisible(true);
                }}
              />
            </SpaceBetween>
          );
        },
        minWidth: 180,
      },
    ],
    [emptyValue, t],
  );

  const aclColumns = useMemo<TableProps<AclRow>["columnDefinitions"]>(
    () => [
      {
        id: "path",
        header: t("permissions.path"),
        cell: ({ path }) => path,
        sortingField: "path",
        isRowHeader: true,
        minWidth: 220,
      },
      {
        id: "type",
        header: t("permissions.type"),
        cell: ({ type }) => t(`permissions.${type}`),
        sortingField: "type",
        minWidth: 140,
      },
      {
        id: "ugid",
        header: t("permissions.userOrGroupId"),
        cell: ({ ugid }) => ugid,
        sortingField: "ugid",
        minWidth: 220,
      },
      {
        id: "roleid",
        header: t("permissions.role"),
        cell: ({ roleid }) => roleid,
        sortingField: "roleid",
        minWidth: 180,
      },
      {
        id: "propagate",
        header: t("permissions.propagate"),
        cell: ({ propagate }) => (
          <StatusIndicator type={propagate ? "success" : "stopped"}>
            {propagate ? t("permissions.enabled") : t("permissions.disabled")}
          </StatusIndicator>
        ),
        sortingComparator: (a, b) => Number(a.propagate) - Number(b.propagate),
        minWidth: 160,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (acl) => (
          <Button formAction="none"
            variant="icon"
            iconName="remove"
            ariaLabel={interpolate(t("permissions.removeAclAriaLabel"), { path: acl.path, subject: acl.ugid })}
            onClick={() => {
              setSelectedAcl(acl);
              setOperationError(""); setFieldErrors({});
                setDeleteAclVisible(true);
            }}
          />
        ),
        minWidth: 120,
      },
    ],
    [t],
  );

  const realmColumns = useMemo<TableProps<PveRealm>["columnDefinitions"]>(
    () => [
      {
        id: "realm",
        header: t("permissions.realmId"),
        cell: ({ realm }) => realm,
        sortingField: "realm",
        isRowHeader: true,
        minWidth: 180,
      },
      {
        id: "type",
        header: t("permissions.realmType"),
        cell: ({ type }) => getRealmTypeLabel(type),
        sortingComparator: (a, b) => getRealmTypeLabel(a.type).localeCompare(getRealmTypeLabel(b.type)),
        minWidth: 160,
      },
      {
        id: "comment",
        header: t("permissions.realmComment"),
        cell: ({ comment }) => comment ?? emptyValue,
        sortingField: "comment",
        minWidth: 260,
      },
      {
        id: "default",
        header: t("permissions.realmDefault"),
        cell: (realm) => (
          <StatusIndicator type={isRealmEnabled(realm.default) ? "success" : "stopped"}>
            {isRealmEnabled(realm.default) ? t("common.yes") : t("common.no")}
          </StatusIndicator>
        ),
        sortingComparator: (a, b) => Number(isRealmEnabled(a.default)) - Number(isRealmEnabled(b.default)),
        minWidth: 140,
      },
      {
        id: "tfa",
        header: t("permissions.realmTfa"),
        cell: ({ tfa: realmTfa }) => getRealmTfaLabel(realmTfa),
        sortingComparator: (a, b) => getRealmTfaLabel(a.tfa).localeCompare(getRealmTfaLabel(b.tfa)),
        minWidth: 180,
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (realm) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button formAction="none"
              disabled={realmSubmitting}
              onClick={() => void editRealm(realm)}
            >
              {t("common.edit")}
            </Button>
            <Button formAction="none"
              variant="inline-icon"
              iconName="remove"
              disabled={isBuiltInRealm(realm)}
              ariaLabel={interpolate(t("permissions.deleteRealmAriaLabel"), { realm: realm.realm })}
              onClick={() => {
                if (isBuiltInRealm(realm)) {
                  addError(t("permissions.cannotDeleteBuiltIn"));
                  return;
                }
                setSelectedRealm(realm);
                setOperationError(""); setFieldErrors({});
                setDeleteRealmVisible(true);
              }}
            />
          </SpaceBetween>
        ),
        minWidth: 180,
      },
    ],
    [addError, editRealm, realmSubmitting, emptyValue, getRealmTfaLabel, getRealmTypeLabel, t],
  );

  const userEmptyState = renderCenteredState(
    t("permissions.noUsers"),
    t("permissions.noUsersDescription"),
    <Button formAction="none" onClick={() => void loadData()}>{t("common.refresh")}</Button>,
  );

  const groupEmptyState = renderCenteredState(
    t("permissions.noGroups"),
    t("permissions.noGroupsDescription"),
    <Button formAction="none" onClick={() => void loadData()}>{t("common.refresh")}</Button>,
  );

  const roleEmptyState = renderCenteredState(
    t("permissions.noRoles"),
    t("permissions.noRolesDescription"),
    <Button formAction="none" onClick={() => void loadData()}>{t("common.refresh")}</Button>,
  );

  const aclEmptyState = renderCenteredState(
    t("permissions.noAclEntries"),
    t("permissions.noAclEntriesDescription"),
    <Button formAction="none" onClick={() => void loadData()}>{t("common.refresh")}</Button>,
  );

  const realmEmptyState = renderCenteredState(
    t("permissions.noRealms"),
    t("permissions.noRealmsDescription"),
    <Button formAction="none" onClick={() => void loadData()}>{t("common.refresh")}</Button>,
  );

  const {
    actions: userActions,
    items: userItems,
    collectionProps: userCollectionProps,
    filterProps: userFilterProps,
    filteredItemsCount: filteredUserCount,
    paginationProps: userPaginationProps,
  } = useCollection(users, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [
          item.userid,
          item.firstname ?? "",
          item.lastname ?? "",
          item.email ?? "",
          getRealm(item),
          isUserEnabled(item) ? t("permissions.enabled") : t("permissions.disabled"),
          item.comment ?? "",
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: userEmptyState,
      noMatch: renderCenteredState(
        t("common.noMatches"),
        t("permissions.noUsersMatch"),
        // Cloudscape useCollection documents this deferred callback; it runs only after render initializes actions.
        // eslint-disable-next-line react-hooks/immutability
        <Button formAction="none" onClick={() => userActions.setFiltering("")}>{t("common.clearFilter")}</Button>,
      ),
    },
    sorting: {
      defaultState: {
        sortingColumn: userColumns[0],
      },
    },
    pagination: {
      pageSize: userPreferences.pageSize,
    },
  });

  const {
    actions: groupActions,
    items: groupItems,
    collectionProps: groupCollectionProps,
    filterProps: groupFilterProps,
    filteredItemsCount: filteredGroupCount,
    paginationProps: groupPaginationProps,
  } = useCollection(groups, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [item.groupid, item.comment ?? "", item.users.join(", ")].some((value) => value.toLowerCase().includes(query));
      },
      empty: groupEmptyState,
      noMatch: renderCenteredState(
        t("common.noMatches"),
        t("permissions.noGroupsMatch"),
        // Cloudscape useCollection documents this deferred callback; it runs only after render initializes actions.
        // eslint-disable-next-line react-hooks/immutability
        <Button formAction="none" onClick={() => groupActions.setFiltering("")}>{t("common.clearFilter")}</Button>,
      ),
    },
    sorting: {
      defaultState: {
        sortingColumn: groupColumns[0],
      },
    },
    pagination: {
      pageSize: groupPreferences.pageSize,
    },
  });

  const {
    actions: roleActions,
    items: roleItems,
    collectionProps: roleCollectionProps,
    filterProps: roleFilterProps,
    filteredItemsCount: filteredRoleCount,
    paginationProps: rolePaginationProps,
  } = useCollection(roles, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [
          item.roleid,
          item.privs.join(", "),
          item.special ? t("permissions.builtIn") : t("permissions.custom"),
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: roleEmptyState,
      noMatch: renderCenteredState(
        t("common.noMatches"),
        t("permissions.noRolesMatch"),
        // Cloudscape useCollection documents this deferred callback; it runs only after render initializes actions.
        // eslint-disable-next-line react-hooks/immutability
        <Button formAction="none" onClick={() => roleActions.setFiltering("")}>{t("common.clearFilter")}</Button>,
      ),
    },
    sorting: {
      defaultState: {
        sortingColumn: roleColumns[0],
      },
    },
    pagination: {
      pageSize: rolePreferences.pageSize,
    },
  });

  const {
    actions: aclActions,
    items: aclItems,
    collectionProps: aclCollectionProps,
    filterProps: aclFilterProps,
    filteredItemsCount: filteredAclCount,
    paginationProps: aclPaginationProps,
  } = useCollection(acls, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [
          item.path,
          item.ugid,
          item.roleid,
          t(`permissions.${item.type}`),
          item.propagate ? t("permissions.enabled") : t("permissions.disabled"),
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: aclEmptyState,
      noMatch: renderCenteredState(
        t("common.noMatches"),
        t("permissions.noAclEntriesMatch"),
        // Cloudscape useCollection documents this deferred callback; it runs only after render initializes actions.
        // eslint-disable-next-line react-hooks/immutability
        <Button formAction="none" onClick={() => aclActions.setFiltering("")}>{t("common.clearFilter")}</Button>,
      ),
    },
    sorting: {
      defaultState: {
        sortingColumn: aclColumns[0],
      },
    },
    pagination: {
      pageSize: aclPreferences.pageSize,
    },
  });

  const {
    actions: realmActions,
    items: realmItems,
    collectionProps: realmCollectionProps,
    filterProps: realmFilterProps,
    filteredItemsCount: filteredRealmCount,
    paginationProps: realmPaginationProps,
  } = useCollection(realms, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const query = filteringText.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return [
          item.realm,
          getRealmTypeLabel(item.type),
          item.comment ?? "",
          isRealmEnabled(item.default) ? t("common.yes") : t("common.no"),
          getRealmTfaLabel(item.tfa),
        ].some((value) => value.toLowerCase().includes(query));
      },
      empty: realmEmptyState,
      noMatch: renderCenteredState(
        t("common.noMatches"),
        t("permissions.noRealmsMatch"),
        // Cloudscape useCollection documents this deferred callback; it runs only after render initializes actions.
        // eslint-disable-next-line react-hooks/immutability
        <Button formAction="none" onClick={() => realmActions.setFiltering("")}>{t("common.clearFilter")}</Button>,
      ),
    },
    sorting: {
      defaultState: {
        sortingColumn: realmColumns[0],
      },
    },
    pagination: {
      pageSize: realmPreferences.pageSize,
    },
  });

  const updatePreferences = useCallback(
    (
      detail: CollectionPreferencesProps.Preferences<CollectionPreferencesProps.ContentDisplayItem>,
      setPreferences: Dispatch<SetStateAction<Preferences>>,
    ) => {
      setPreferences((current) => ({
        pageSize: detail.pageSize ?? current.pageSize,
        wrapLines: detail.wrapLines ?? current.wrapLines,
        stripedRows: detail.stripedRows ?? current.stripedRows,
        contentDensity: detail.contentDensity ?? current.contentDensity,
        contentDisplay: detail.contentDisplay ?? current.contentDisplay,
      }));
    },
    [],
  );

  const submitUser = useCallback(async (mode: "create" | "edit") => {
    if (!isValidUserId(userForm.userid.trim())) {
      setFieldErrors({ userid: text("Use name@realm, up to 64 characters.", "name@realm 형식으로 최대 64자를 입력하세요.") });
      addError(text("Enter a valid user ID including a realm, such as operator@pve (maximum 64 characters).", "operator@pve처럼 영역을 포함한 유효한 사용자 ID를 입력하세요 (최대 64자)."));
      return;
    }

    const realmId = userForm.userid.trim().slice(userForm.userid.trim().lastIndexOf("@") + 1);
    const userRealm = realms.find((realm) => realm.realm === realmId);
    if (mode === "create" && userForm.password && userRealm && userRealm.type !== "pve" && userRealm.type !== "pam") {
      addError(text("External directory passwords are managed by the identity provider. Clear the initial password to create this user.", "외부 디렉터리 비밀번호는 인증 제공자에서 관리합니다. 초기 비밀번호를 비우고 사용자를 생성하세요."));
      return;
    }
    const expireResult = parseExpireInput(userForm.expire);
    if (!expireResult.valid) {
      setFieldErrors({ expire: t("permissions.invalidExpireDate") });
      addError(t("permissions.invalidExpireDate"));
      return;
    }

    if (mode === "create" && userForm.password && (userForm.password.length < 8 || userForm.password.length > 64)) {
      addError(text("Password must contain 8 to 64 characters.", "비밀번호는 8~64자여야 합니다."));
      return;
    }

    try {
      setUserSubmitting(true);
      const params = new URLSearchParams();
      if (mode === "create") params.set("userid", userForm.userid.trim());
      params.set("groups", toList(userForm.groups).join(","));
      params.set("email", userForm.email.trim());
      params.set("firstname", userForm.firstname.trim());
      params.set("lastname", userForm.lastname.trim());
      params.set("comment", userForm.comment.trim());
      params.set("enable", userForm.enabled ? "1" : "0");
      params.set("expire", expireResult.epoch);

      if (mode === "create" && userForm.password) {
        params.set("password", userForm.password);
      }

      const path = mode === "create"
        ? "/api/proxmox/access/users"
        : `/api/proxmox/access/users/${encodeURIComponent(userForm.userid.trim())}`;

      await fetchProxmox<null>(path, t, {
        method: mode === "create" ? "POST" : "PUT",
        ...encodeFormBody(params),
      });

      await loadData();
      setCreateUserVisible(false);
      setEditUserVisible(false);
      setUserForm(EMPTY_USER_FORM);
      setSelectedUser(null);
      addSuccess(mode === "create" ? t("permissions.userCreated") : t("permissions.userUpdated"));
    } catch (submitError) {
      if (submitError instanceof AccessApiError) setFieldErrors(submitError.fields);
      addError(submitError instanceof Error ? submitError.message : t(mode === "create" ? "permissions.failedToCreateUser" : "permissions.failedToUpdateUser"));
    } finally {
      setUserSubmitting(false);
    }
  }, [addError, addSuccess, loadData, realms, t, text, userForm]);

  const deleteUser = useCallback(async () => {
    if (!selectedUser || selectedUser.userid === "root@pam") {
      return;
    }

    try {
      setUserSubmitting(true);
      await fetchProxmox<null>(`/api/proxmox/access/users/${encodeURIComponent(selectedUser.userid)}`, t, {
        method: "DELETE",
      });
      await loadData();
      setDeleteUserVisible(false);
      setSelectedUser(null);
      addSuccess(t("permissions.userDeleted"));
    } catch (deleteError) {
      if (deleteError instanceof AccessApiError) setFieldErrors(deleteError.fields);
      addError(deleteError instanceof Error ? deleteError.message : t("permissions.failedToDeleteUser"));
    } finally {
      setUserSubmitting(false);
    }
  }, [addError, addSuccess, loadData, selectedUser, t]);

  const submitGroup = useCallback(async (mode: "create" | "edit") => {
    if (!isValidAccessId(groupForm.groupid.trim())) {
      setFieldErrors({ groupid: text("Enter a valid group ID.", "유효한 그룹 ID를 입력하세요.") });
      addError(text("Group ID can contain letters, digits, periods, hyphens and underscores.", "그룹 ID에는 영문자, 숫자, 마침표, 하이픈, 밑줄을 사용할 수 있습니다."));
      return;
    }

    try {
      setGroupSubmitting(true);
      const params = new URLSearchParams();
      if (mode === "create") params.set("groupid", groupForm.groupid.trim());
      params.set("comment", groupForm.comment.trim());

      const path = mode === "create"
        ? "/api/proxmox/access/groups"
        : `/api/proxmox/access/groups/${encodeURIComponent(groupForm.groupid.trim())}`;

      await fetchProxmox<null>(path, t, {
        method: mode === "create" ? "POST" : "PUT",
        ...encodeFormBody(params),
      });

      await loadData();
      setCreateGroupVisible(false);
      setEditGroupVisible(false);
      setGroupForm(EMPTY_GROUP_FORM);
      setSelectedGroup(null);
      addSuccess(mode === "create" ? t("permissions.groupCreated") : t("permissions.groupUpdated"));
    } catch (submitError) {
      if (submitError instanceof AccessApiError) setFieldErrors(submitError.fields);
      addError(submitError instanceof Error ? submitError.message : t(mode === "create" ? "permissions.failedToCreateGroup" : "permissions.failedToUpdateGroup"));
    } finally {
      setGroupSubmitting(false);
    }
  }, [addError, addSuccess, groupForm, loadData, t, text]);

  const deleteGroup = useCallback(async () => {
    if (!selectedGroup) {
      return;
    }

    try {
      setGroupSubmitting(true);
      await fetchProxmox<null>(`/api/proxmox/access/groups/${encodeURIComponent(selectedGroup.groupid)}`, t, {
        method: "DELETE",
      });
      await loadData();
      setDeleteGroupVisible(false);
      setSelectedGroup(null);
      addSuccess(t("permissions.groupDeleted"));
    } catch (deleteError) {
      if (deleteError instanceof AccessApiError) setFieldErrors(deleteError.fields);
      addError(deleteError instanceof Error ? deleteError.message : t("permissions.failedToDeleteGroup"));
    } finally {
      setGroupSubmitting(false);
    }
  }, [addError, addSuccess, loadData, selectedGroup, t]);

  const submitRole = useCallback(async (mode: "create" | "edit") => {
    if (!isValidAccessId(roleForm.roleid.trim())) {
      setFieldErrors({ roleid: text("Enter a valid role ID.", "유효한 역할 ID를 입력하세요.") });
      addError(text("Role ID can contain letters, digits, periods, hyphens and underscores.", "역할 ID에는 영문자, 숫자, 마침표, 하이픈, 밑줄을 사용할 수 있습니다."));
      return;
    }

    try {
      setRoleSubmitting(true);
      const params = new URLSearchParams();
      if (mode === "create") params.set("roleid", roleForm.roleid.trim());
      params.set("privs", toList(roleForm.privs).join(","));

      const path = mode === "create"
        ? "/api/proxmox/access/roles"
        : `/api/proxmox/access/roles/${encodeURIComponent(roleForm.roleid.trim())}`;

      await fetchProxmox<null>(path, t, {
        method: mode === "create" ? "POST" : "PUT",
        ...encodeFormBody(params),
      });

      await loadData();
      setCreateRoleVisible(false);
      setEditRoleVisible(false);
      setRoleForm(EMPTY_ROLE_FORM);
      setSelectedRole(null);
      addSuccess(mode === "create" ? t("permissions.roleCreated") : t("permissions.roleUpdated"));
    } catch (submitError) {
      if (submitError instanceof AccessApiError) setFieldErrors(submitError.fields);
      addError(submitError instanceof Error ? submitError.message : t(mode === "create" ? "permissions.failedToCreateRole" : "permissions.failedToUpdateRole"));
    } finally {
      setRoleSubmitting(false);
    }
  }, [addError, addSuccess, loadData, roleForm, t, text]);

  const deleteRole = useCallback(async () => {
    if (!selectedRole || selectedRole.special) {
      return;
    }

    try {
      setRoleSubmitting(true);
      await fetchProxmox<null>(`/api/proxmox/access/roles/${encodeURIComponent(selectedRole.roleid)}`, t, {
        method: "DELETE",
      });
      await loadData();
      setDeleteRoleVisible(false);
      setSelectedRole(null);
      addSuccess(t("permissions.roleDeleted"));
    } catch (deleteError) {
      if (deleteError instanceof AccessApiError) setFieldErrors(deleteError.fields);
      addError(deleteError instanceof Error ? deleteError.message : t("permissions.failedToDeleteRole"));
    } finally {
      setRoleSubmitting(false);
    }
  }, [addError, addSuccess, loadData, selectedRole, t]);

  const submitAcl = useCallback(async () => {
    if (!aclForm.path.trim().startsWith("/") || /\s|\/\/|(?:^|\/)\.\.?(?:\/|$)/.test(aclForm.path.trim())) {
      addError(text("Enter an absolute Proxmox ACL path, such as /vms/100, without spaces or traversal segments.", "공백이나 상대 경로 없이 /vms/100처럼 절대 Proxmox ACL 경로를 입력하세요."));
      return;
    }

    if (!aclForm.subjectId.trim()) {
      addError(t("permissions.subjectRequired"));
      return;
    }

    if (!aclForm.roleid.trim()) {
      addError(t("permissions.roleRequired"));
      return;
    }

    try {
      setAclSubmitting(true);
      const params = new URLSearchParams();
      params.set("path", aclForm.path.trim());
      params.set("roles", aclForm.roleid.trim());
      params.set("propagate", aclForm.propagate ? "1" : "0");

      if (aclForm.subjectType === "group") {
        params.set("groups", aclForm.subjectId.trim());
      } else if (aclForm.subjectType === "token") {
        params.set("tokens", aclForm.subjectId.trim());
      } else {
        params.set("users", aclForm.subjectId.trim());
      }

      await fetchProxmox<null>("/api/proxmox/access/acl", t, {
        method: "PUT",
        ...encodeFormBody(params),
      });

      await loadData();
      setCreateAclVisible(false);
      setAclForm(EMPTY_ACL_FORM);
      addSuccess(t("permissions.aclAdded"));
    } catch (submitError) {
      if (submitError instanceof AccessApiError) setFieldErrors(submitError.fields);
      addError(submitError instanceof Error ? submitError.message : t("permissions.failedToAddAcl"));
    } finally {
      setAclSubmitting(false);
    }
  }, [aclForm, addError, addSuccess, loadData, t, text]);

  const deleteAcl = useCallback(async () => {
    if (!selectedAcl) {
      return;
    }

    try {
      setAclSubmitting(true);
      const params = new URLSearchParams();
      params.set("path", selectedAcl.path);
      params.set("roles", selectedAcl.roleid);
      params.set("delete", "1");
      params.set("propagate", selectedAcl.propagate ? "1" : "0");

      if (selectedAcl.type === "group") {
        params.set("groups", selectedAcl.ugid);
      } else if (selectedAcl.type === "token") {
        params.set("tokens", selectedAcl.ugid);
      } else {
        params.set("users", selectedAcl.ugid);
      }

      await fetchProxmox<null>("/api/proxmox/access/acl", t, {
        method: "PUT",
        ...encodeFormBody(params),
      });

      await loadData();
      setDeleteAclVisible(false);
      setSelectedAcl(null);
      addSuccess(t("permissions.aclRemoved"));
    } catch (deleteError) {
      if (deleteError instanceof AccessApiError) setFieldErrors(deleteError.fields);
      addError(deleteError instanceof Error ? deleteError.message : t("permissions.failedToRemoveAcl"));
    } finally {
      setAclSubmitting(false);
    }
  }, [addError, addSuccess, loadData, selectedAcl, t]);

  const userHeaderCounter = userFilterProps.filteringText ? `(${filteredUserCount}/${users.length})` : `(${users.length})`;
  const groupHeaderCounter = groupFilterProps.filteringText ? `(${filteredGroupCount}/${groups.length})` : `(${groups.length})`;
  const roleHeaderCounter = roleFilterProps.filteringText ? `(${filteredRoleCount}/${roles.length})` : `(${roles.length})`;
  const aclHeaderCounter = aclFilterProps.filteringText ? `(${filteredAclCount}/${acls.length})` : `(${acls.length})`;
  const realmHeaderCounter = realmFilterProps.filteringText ? `(${filteredRealmCount}/${realms.length})` : `(${realms.length})`;

  const submitRealm = useCallback(async (mode: "create" | "edit") => {
    if (!realmForm.realm.trim()) {
      addError(t("permissions.realmIdRequired"));
      return;
    }

    if (!realmForm.type) {
      addError(t("permissions.realmTypeRequired"));
      return;
    }

    if ((realmForm.type === "ldap" || realmForm.type === "ad") && !realmForm.server.trim()) {
      addError(t(realmForm.type === "ldap" ? "permissions.ldapServerRequired" : "permissions.adServerRequired"));
      return;
    }

    if (realmForm.type === "ldap" && !realmForm.baseDn.trim()) {
      addError(t("permissions.baseDnRequired"));
      return;
    }

    if (realmForm.type === "ad" && !realmForm.domain.trim()) {
      addError(t("permissions.adDomainRequired"));
      return;
    }

    if (realmForm.type === "openid" && !realmForm.issuerUrl.trim()) {
      addError(t("permissions.openidIssuerUrlRequired"));
      return;
    }

    if (realmForm.type === "openid" && !realmForm.clientId.trim()) {
      addError(t("permissions.openidClientIdRequired"));
      return;
    }

    if (mode === "create" && (!/^[A-Za-z][A-Za-z0-9._-]+$/.test(realmForm.realm.trim()) || realmForm.realm.length > 32 || realmForm.type === "pam" || realmForm.type === "pve")) {
      addError(text("Enter a new LDAP, AD or OpenID realm ID (2 to 32 characters, starting with a letter).", "새 LDAP, AD 또는 OpenID 영역 ID를 입력하세요 (영문자로 시작하는 2~32자)."));
      return;
    }
    if (realmForm.port && (!/^\d+$/.test(realmForm.port) || Number(realmForm.port) < 1 || Number(realmForm.port) > 65535)) {
      addError(text("Port must be an integer between 1 and 65535.", "포트는 1~65535 사이의 정수여야 합니다."));
      return;
    }
    if (realmForm.type === "openid") {
      try { const url = new URL(realmForm.issuerUrl); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { addError(text("Enter a valid OpenID issuer URL.", "유효한 OpenID 발급자 URL을 입력하세요.")); return; }
    }
    try {
      setRealmSubmitting(true);
      const params = new URLSearchParams();
      const deleteFields: string[] = [];
      if (mode === "edit" && realmForm.digest) params.set("digest", realmForm.digest);

      if (mode === "create") {
        params.set("realm", realmForm.realm.trim());
        params.set("type", realmForm.type);
      }

      params.set("comment", realmForm.comment.trim());
      params.set("default", realmForm.default ? "1" : "0");
      if (realmForm.type !== "openid") {
        if (realmForm.tfa === "none") { if (mode === "edit" && selectedRealm?.tfa) deleteFields.push("tfa"); }
        else params.set("tfa", realmForm.tfaConfig || `type=${realmForm.tfa}`);
      }

      if (realmForm.type === "ldap") {
        params.set("server1", realmForm.server.trim());
        params.set("base_dn", realmForm.baseDn.trim());
        params.set("user_attr", realmForm.userAttribute.trim() || "uid");
        if (realmForm.port) params.set("port", realmForm.port);
        else if (mode === "edit" && selectedRealm?.port) deleteFields.push("port");
        params.set("mode", realmForm.mode);
        params.set("verify", realmForm.verify ? "1" : "0");
        if (realmForm.fallbackServer) params.set("server2", realmForm.fallbackServer);
        else if (mode === "edit" && selectedRealm?.server2) deleteFields.push("server2");
        if (realmForm.bindDn.trim()) params.set("bind_dn", realmForm.bindDn.trim());
        else if (mode === "edit" && selectedRealm?.bind_dn) deleteFields.push("bind_dn");
        if (realmForm.bindPassword.trim()) {
          params.set("password", realmForm.bindPassword);
        }
      }

      if (realmForm.type === "ad") {
        if (realmForm.bindDn.trim()) params.set("bind_dn", realmForm.bindDn.trim());
        else if (mode === "edit" && selectedRealm?.bind_dn) deleteFields.push("bind_dn");
        if (realmForm.bindPassword) params.set("password", realmForm.bindPassword);
        params.set("server1", realmForm.server.trim());
        params.set("domain", realmForm.domain.trim());
        if (realmForm.port) params.set("port", realmForm.port);
        else if (mode === "edit" && selectedRealm?.port) deleteFields.push("port");
        params.set("mode", realmForm.mode);
        params.set("verify", realmForm.verify ? "1" : "0");
        if (realmForm.fallbackServer) params.set("server2", realmForm.fallbackServer);
        else if (mode === "edit" && selectedRealm?.server2) deleteFields.push("server2");
      }

      if (realmForm.type === "openid") {
        params.set("issuer-url", realmForm.issuerUrl.trim());
        params.set("client-id", realmForm.clientId.trim());
        params.set("autocreate", realmForm.autocreate ? "1" : "0");
        if (mode === "create" && realmForm.usernameClaim) params.set("username-claim", realmForm.usernameClaim);
        if (realmForm.clientKey.trim()) {
          params.set("client-key", realmForm.clientKey);
        }
      }

      if (deleteFields.length) params.set("delete", deleteFields.join(","));
      const realmId = realmForm.realm.trim();
      const path = mode === "create"
        ? "/api/proxmox/access/domains"
        : `/api/proxmox/access/domains/${encodeURIComponent(realmId)}`;

      await fetchProxmox<null>(path, t, {
        method: mode === "create" ? "POST" : "PUT",
        ...encodeFormBody(params),
      });

      await loadData();
      setCreateRealmVisible(false);
      setEditRealmVisible(false);
      setRealmForm(EMPTY_REALM_FORM);
      setSelectedRealm(null);
      addSuccess(interpolate(t(mode === "create" ? "permissions.realmCreated" : "permissions.realmUpdated"), { realm: realmId }));
    } catch (submitError) {
      if (submitError instanceof AccessApiError) setFieldErrors(submitError.fields);
      addError(submitError instanceof Error ? submitError.message : t(mode === "create" ? "permissions.createRealmFailed" : "permissions.updateRealmFailed"));
    } finally {
      setRealmSubmitting(false);
    }
  }, [addError, addSuccess, loadData, realmForm, selectedRealm, t, text]);

  const deleteRealm = useCallback(async () => {
    if (!selectedRealm) {
      return;
    }

    if (isBuiltInRealm(selectedRealm)) {
      addError(t("permissions.cannotDeleteBuiltIn"));
      return;
    }

    try {
      setRealmSubmitting(true);
      await fetchProxmox<null>(`/api/proxmox/access/domains/${encodeURIComponent(selectedRealm.realm)}`, t, {
        method: "DELETE",
      });
      await loadData();
      setDeleteRealmVisible(false);
      setSelectedRealm(null);
      addSuccess(interpolate(t("permissions.realmDeleted"), { realm: selectedRealm.realm }));
    } catch (deleteError) {
      if (deleteError instanceof AccessApiError) setFieldErrors(deleteError.fields);
      addError(deleteError instanceof Error ? deleteError.message : t("permissions.deleteRealmFailed"));
    } finally {
      setRealmSubmitting(false);
    }
  }, [addError, addSuccess, loadData, selectedRealm, t]);

  const realmFields = (
    <SpaceBetween size="l">
      <FormField errorText={fieldErrors["realm"]} label={t("permissions.realmId")}>
        <Input
          value={realmForm.realm}
          disabled={editRealmVisible}
          placeholder={t("permissions.realmIdPlaceholder")}
          onChange={({ detail }) => setRealmForm((current) => ({ ...current, realm: detail.value }))}
        />
      </FormField>
      <FormField errorText={fieldErrors["type"]} label={t("permissions.realmType")}>
        <Select
          selectedOption={selectedRealmTypeOption}
          options={realmTypeOptions}
          disabled={editRealmVisible}
          placeholder={t("permissions.selectRealmType")}
          onChange={({ detail }) => {
            const nextType = getTrackableId(detail.selectedOption);
            setRealmForm((current) => ({
              ...current,
              type: isRealmType(nextType) ? nextType : "",
              userAttribute: current.userAttribute || "uid",
              usernameClaim: current.usernameClaim,
            }));
          }}
        />
      </FormField>
      <FormField label={t("permissions.realmComment")}>
        <Textarea
          value={realmForm.comment}
          placeholder={t("permissions.realmCommentPlaceholder")}
          onChange={({ detail }) => setRealmForm((current) => ({ ...current, comment: detail.value }))}
        />
      </FormField>
      <Checkbox checked={realmForm.default} onChange={({ detail }) => setRealmForm((current) => ({ ...current, default: detail.checked }))}>
        {t("permissions.realmDefault")}
      </Checkbox>
      {realmForm.type !== "openid" && <FormField label={t("permissions.realmTfa")}>
        <Select
          selectedOption={selectedRealmTfaOption}
          options={realmTfaOptions}
          placeholder={t("permissions.selectTfa")}
          onChange={({ detail }) => {
            const nextValue = getTrackableId(detail.selectedOption);
            setRealmForm((current) => ({
              ...current,
              tfa: nextValue === "oath" || nextValue === "yubico" ? nextValue : "none",
              tfaConfig: nextValue === "none" ? "" : `type=${nextValue}`,
            }));
          }}
        />
      </FormField>}
      {realmForm.type !== "openid" && realmForm.tfa !== "none" && <FormField label={text("Realm TFA configuration", "영역 2단계 인증 설정")} constraintText="type=oath,digits=6,step=30 / type=yubico,id=…,key=…">
        <Input value={realmForm.tfaConfig} onChange={({ detail }) => setRealmForm((current) => ({ ...current, tfaConfig: detail.value }))} />
      </FormField>}
      {(realmForm.type === "ldap" || realmForm.type === "ad") && <>
        <FormField label={text("Fallback server — optional", "대체 서버 — 선택 사항")}><Input value={realmForm.fallbackServer} onChange={({ detail }) => setRealmForm((current) => ({ ...current, fallbackServer: detail.value }))} /></FormField>
        <FormField label={text("Connection security", "연결 보안")}><Select selectedOption={{ label: realmForm.mode, value: realmForm.mode }} options={[{ label: "LDAPS", value: "ldaps" }, { label: "LDAP with STARTTLS", value: "ldap+starttls" }, { label: "LDAP", value: "ldap" }]} onChange={({ detail }) => setRealmForm((current) => ({ ...current, mode: detail.selectedOption.value as RealmFormState["mode"] }))} /></FormField>
        <Checkbox checked={realmForm.verify} onChange={({ detail }) => setRealmForm((current) => ({ ...current, verify: detail.checked }))}>{text("Verify server certificate", "서버 인증서 검증")}</Checkbox>
          <FormField errorText={fieldErrors["bind_dn"]} label={t("permissions.bindDn")}>
            <Input
              value={realmForm.bindDn}
              placeholder={t("permissions.bindDnPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, bindDn: detail.value }))}
            />
          </FormField>
          <FormField errorText={fieldErrors["password"]} label={t("permissions.bindPassword")}>
            <Input
              type="password"
              value={realmForm.bindPassword}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, bindPassword: detail.value }))}
            />
          </FormField>

      </>}

      {realmForm.type === "ldap" ? (
        <>
          <FormField errorText={fieldErrors["server1"]} label={t("permissions.ldapServer")}>
            <Input
              value={realmForm.server}
              placeholder={t("permissions.ldapServerPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, server: detail.value }))}
            />
          </FormField>
          <FormField errorText={fieldErrors["base_dn"]} label={t("permissions.baseDn")}>
            <Input
              value={realmForm.baseDn}
              placeholder={t("permissions.baseDnPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, baseDn: detail.value }))}
            />
          </FormField>
          <FormField errorText={fieldErrors["user_attr"]} label={t("permissions.userAttribute")}>
            <Input
              value={realmForm.userAttribute}
              placeholder={t("permissions.userAttributePlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, userAttribute: detail.value }))}
            />
          </FormField>
          <FormField errorText={fieldErrors["port"]} label={t("permissions.ldapPort")}>
            <Input
              value={realmForm.port}
              placeholder={t("permissions.ldapPortPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, port: detail.value }))}
            />
          </FormField>

        </>
      ) : null}

      {realmForm.type === "ad" ? (
        <>
          <FormField errorText={fieldErrors["server1"]} label={t("permissions.adServer")}>
            <Input
              value={realmForm.server}
              placeholder={t("permissions.adServerPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, server: detail.value }))}
            />
          </FormField>
          <FormField errorText={fieldErrors["domain"]} label={t("permissions.adDomain")}>
            <Input
              value={realmForm.domain}
              placeholder={t("permissions.adDomainPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, domain: detail.value }))}
            />
          </FormField>
          <FormField errorText={fieldErrors["port"]} label={t("permissions.ldapPort")}>
            <Input
              value={realmForm.port}
              placeholder={t("permissions.ldapPortPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, port: detail.value }))}
            />
          </FormField>

        </>
      ) : null}

      {realmForm.type === "openid" ? (
        <>
          <FormField errorText={fieldErrors["issuer-url"]} label={t("permissions.openidIssuerUrl")}>
            <Input
              value={realmForm.issuerUrl}
              placeholder={t("permissions.openidIssuerUrlPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, issuerUrl: detail.value }))}
            />
          </FormField>
          <FormField errorText={fieldErrors["client-id"]} label={t("permissions.openidClientId")}>
            <Input
              value={realmForm.clientId}
              placeholder={t("permissions.openidClientIdPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, clientId: detail.value }))}
            />
          </FormField>
          <FormField label={t("permissions.openidClientKey")}>
            <Input
              type="password"
              value={realmForm.clientKey}
              placeholder={t("permissions.openidClientKeyPlaceholder")}
              onChange={({ detail }) => setRealmForm((current) => ({ ...current, clientKey: detail.value }))}
            />
          </FormField>
          <Checkbox checked={realmForm.autocreate} onChange={({ detail }) => setRealmForm((current) => ({ ...current, autocreate: detail.checked }))}>
            {t("permissions.openidAutocreate")}
          </Checkbox>
          <FormField label={t("permissions.openidUsernameClaim")} description={text("Leave empty to use the provider default. This setting cannot be changed after creation.", "비워 두면 제공자의 기본값을 사용합니다. 생성한 뒤에는 변경할 수 없습니다.")}>
            <Input disabled={editRealmVisible} value={realmForm.usernameClaim} onChange={({ detail }) => setRealmForm((current) => ({ ...current, usernameClaim: detail.value }))} />
          </FormField>
        </>
      ) : null}
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={t("permissions.pageDescription")}>
        {t("permissions.pageTitle")}
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
        <Alert type="error" header={t("permissions.failedToLoad")}>
          {error}
        </Alert>
      ) : null}

      <Tabs
        activeTabId={activeTabId}
        onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
        tabs={[
          {
            id: "users",
            label: t("permissions.usersTab"),
            content: (
              <Table
                {...userCollectionProps}
                items={userItems}
                columnDefinitions={userColumns}
                variant="full-page"
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                loading={loading}
                loadingText={t("permissions.loadingUsers")}
                trackBy="userid"
                empty={userFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("permissions.noUsersMatch"), <Button formAction="none" onClick={() => userActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : userEmptyState}
                wrapLines={userPreferences.wrapLines}
                stripedRows={userPreferences.stripedRows}
                contentDensity={userPreferences.contentDensity}
                columnDisplay={userPreferences.contentDisplay}
                header={
                  <Header
                    counter={userHeaderCounter}
                    description={t("permissions.usersDescription")}
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button formAction="none"
                          variant="primary"
                          onClick={() => {
                            setUserForm(EMPTY_USER_FORM);
                            setOperationError(""); setFieldErrors({});
                setCreateUserVisible(true);
                          }}
                        >
                          {t("permissions.createUser")}
                        </Button>
                        <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
                      </SpaceBetween>
                    }
                  >
                    {t("permissions.usersTab")}
                  </Header>
                }
                filter={
                  <TextFilter
                    {...userFilterProps}
                    filteringPlaceholder={t("permissions.findUsers")}
                    countText={`${filteredUserCount ?? users.length} ${t("common.matches")}`}
                  />
                }
                pagination={<Pagination {...userPaginationProps} />}
                preferences={
                  <CollectionPreferences
                    title={t("common.preferences")}
                    confirmLabel={t("common.confirm")}
                    cancelLabel={t("common.cancel")}
                    preferences={userPreferences}
                    onConfirm={({ detail }) => updatePreferences(detail, setUserPreferences)}
                    pageSizePreference={{
                      title: t("common.pageSize"),
                      options: [
                        { value: 10, label: t("permissions.usersCount10") },
                        { value: 20, label: t("permissions.usersCount20") },
                        { value: 50, label: t("permissions.usersCount50") },
                      ],
                    }}
                    wrapLinesPreference={{
                      label: t("common.wrapLines"),
                      description: t("permissions.wrapLinesDesc"),
                    }}
                    stripedRowsPreference={{
                      label: t("common.stripedRows"),
                      description: t("permissions.stripedRowsDesc"),
                    }}
                    contentDensityPreference={{
                      label: t("common.contentDensity"),
                      description: t("permissions.contentDensityDesc"),
                    }}
                    contentDisplayPreference={{
                      title: t("common.columnPreferences"),
                      options: [
                        { id: "userid", label: t("permissions.userId"), alwaysVisible: true },
                        { id: "firstname", label: t("permissions.firstName") },
                        { id: "lastname", label: t("permissions.lastName") },
                        { id: "email", label: t("permissions.email") },
                        { id: "realm", label: t("permissions.realm") },
                        { id: "enabled", label: t("permissions.enabled") },
                        { id: "expire", label: t("permissions.expire") },
                        { id: "comment", label: t("permissions.comment") },
                        { id: "actions", label: t("common.actions") },
                      ],
                    }}
                  />
                }
              />
            ),
          },
          {
            id: "groups",
            label: t("permissions.groupsTab"),
            content: (
              <Table
                {...groupCollectionProps}
                items={groupItems}
                columnDefinitions={groupColumns}
                variant="full-page"
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                loading={loading}
                loadingText={t("permissions.loadingGroups")}
                trackBy="groupid"
                empty={groupFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("permissions.noGroupsMatch"), <Button formAction="none" onClick={() => groupActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : groupEmptyState}
                wrapLines={groupPreferences.wrapLines}
                stripedRows={groupPreferences.stripedRows}
                contentDensity={groupPreferences.contentDensity}
                columnDisplay={groupPreferences.contentDisplay}
                header={
                  <Header
                    counter={groupHeaderCounter}
                    description={t("permissions.groupsDescription")}
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button formAction="none"
                          variant="primary"
                          onClick={() => {
                            setGroupForm(EMPTY_GROUP_FORM);
                            setOperationError(""); setFieldErrors({});
                setCreateGroupVisible(true);
                          }}
                        >
                          {t("permissions.createGroup")}
                        </Button>
                        <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
                      </SpaceBetween>
                    }
                  >
                    {t("permissions.groupsTab")}
                  </Header>
                }
                filter={
                  <TextFilter
                    {...groupFilterProps}
                    filteringPlaceholder={t("permissions.findGroups")}
                    countText={`${filteredGroupCount ?? groups.length} ${t("common.matches")}`}
                  />
                }
                pagination={<Pagination {...groupPaginationProps} />}
                preferences={
                  <CollectionPreferences
                    title={t("common.preferences")}
                    confirmLabel={t("common.confirm")}
                    cancelLabel={t("common.cancel")}
                    preferences={groupPreferences}
                    onConfirm={({ detail }) => updatePreferences(detail, setGroupPreferences)}
                    pageSizePreference={{
                      title: t("common.pageSize"),
                      options: [
                        { value: 10, label: t("permissions.groupsCount10") },
                        { value: 20, label: t("permissions.groupsCount20") },
                        { value: 50, label: t("permissions.groupsCount50") },
                      ],
                    }}
                    wrapLinesPreference={{
                      label: t("common.wrapLines"),
                      description: t("permissions.wrapLinesDesc"),
                    }}
                    stripedRowsPreference={{
                      label: t("common.stripedRows"),
                      description: t("permissions.stripedRowsDesc"),
                    }}
                    contentDensityPreference={{
                      label: t("common.contentDensity"),
                      description: t("permissions.contentDensityDesc"),
                    }}
                    contentDisplayPreference={{
                      title: t("common.columnPreferences"),
                      options: [
                        { id: "groupid", label: t("permissions.groupId"), alwaysVisible: true },
                        { id: "comment", label: t("permissions.comment") },
                        { id: "users", label: t("permissions.members") },
                        { id: "actions", label: t("common.actions") },
                      ],
                    }}
                  />
                }
              />
            ),
          },
          {
            id: "roles",
            label: t("permissions.rolesTab"),
            content: (
              <Table
                {...roleCollectionProps}
                items={roleItems}
                columnDefinitions={roleColumns}
                variant="full-page"
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                loading={loading}
                loadingText={t("permissions.loadingRoles")}
                trackBy="roleid"
                empty={roleFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("permissions.noRolesMatch"), <Button formAction="none" onClick={() => roleActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : roleEmptyState}
                wrapLines={rolePreferences.wrapLines}
                stripedRows={rolePreferences.stripedRows}
                contentDensity={rolePreferences.contentDensity}
                columnDisplay={rolePreferences.contentDisplay}
                header={
                  <Header
                    counter={roleHeaderCounter}
                    description={t("permissions.rolesDescription")}
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button formAction="none"
                          variant="primary"
                          onClick={() => {
                            setRoleForm(EMPTY_ROLE_FORM);
                            setOperationError(""); setFieldErrors({});
                setCreateRoleVisible(true);
                          }}
                        >
                          {t("permissions.createRole")}
                        </Button>
                        <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
                      </SpaceBetween>
                    }
                  >
                    {t("permissions.rolesTab")}
                  </Header>
                }
                filter={
                  <TextFilter
                    {...roleFilterProps}
                    filteringPlaceholder={t("permissions.findRoles")}
                    countText={`${filteredRoleCount ?? roles.length} ${t("common.matches")}`}
                  />
                }
                pagination={<Pagination {...rolePaginationProps} />}
                preferences={
                  <CollectionPreferences
                    title={t("common.preferences")}
                    confirmLabel={t("common.confirm")}
                    cancelLabel={t("common.cancel")}
                    preferences={rolePreferences}
                    onConfirm={({ detail }) => updatePreferences(detail, setRolePreferences)}
                    pageSizePreference={{
                      title: t("common.pageSize"),
                      options: [
                        { value: 10, label: t("permissions.rolesCount10") },
                        { value: 20, label: t("permissions.rolesCount20") },
                        { value: 50, label: t("permissions.rolesCount50") },
                      ],
                    }}
                    wrapLinesPreference={{
                      label: t("common.wrapLines"),
                      description: t("permissions.wrapLinesDesc"),
                    }}
                    stripedRowsPreference={{
                      label: t("common.stripedRows"),
                      description: t("permissions.stripedRowsDesc"),
                    }}
                    contentDensityPreference={{
                      label: t("common.contentDensity"),
                      description: t("permissions.contentDensityDesc"),
                    }}
                    contentDisplayPreference={{
                      title: t("common.columnPreferences"),
                      options: [
                        { id: "roleid", label: t("permissions.roleId"), alwaysVisible: true },
                        { id: "privs", label: t("permissions.privileges") },
                        { id: "special", label: t("permissions.special") },
                        { id: "actions", label: t("common.actions") },
                      ],
                    }}
                  />
                }
              />
            ),
          },
          {
            id: "realms",
            label: t("permissions.realmsTab"),
            content: (
              <Table
                {...realmCollectionProps}
                items={realmItems}
                columnDefinitions={realmColumns}
                variant="full-page"
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                loading={loading}
                loadingText={t("permissions.loadingRealms")}
                trackBy="realm"
                empty={realmFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("permissions.noRealmsMatch"), <Button formAction="none" onClick={() => realmActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : realmEmptyState}
                wrapLines={realmPreferences.wrapLines}
                stripedRows={realmPreferences.stripedRows}
                contentDensity={realmPreferences.contentDensity}
                columnDisplay={realmPreferences.contentDisplay}
                header={
                  <Header
                    counter={realmHeaderCounter}
                    description={t("permissions.realmsDescription")}
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button formAction="none"
                          variant="primary"
                          onClick={() => {
                            setRealmForm(EMPTY_REALM_FORM);
                            setSelectedRealm(null);
                            setOperationError(""); setFieldErrors({});
                setCreateRealmVisible(true);
                          }}
                        >
                          {t("permissions.createRealm")}
                        </Button>
                        <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
                      </SpaceBetween>
                    }
                  >
                    {t("permissions.realmsTab")}
                  </Header>
                }
                filter={
                  <TextFilter
                    {...realmFilterProps}
                    filteringPlaceholder={t("permissions.findRealms")}
                    countText={`${filteredRealmCount ?? realms.length} ${t("common.matches")}`}
                  />
                }
                pagination={<Pagination {...realmPaginationProps} />}
                preferences={
                  <CollectionPreferences
                    title={t("common.preferences")}
                    confirmLabel={t("common.confirm")}
                    cancelLabel={t("common.cancel")}
                    preferences={realmPreferences}
                    onConfirm={({ detail }) => updatePreferences(detail, setRealmPreferences)}
                    pageSizePreference={{
                      title: t("common.pageSize"),
                      options: [
                        { value: 10, label: t("permissions.realmsCount10") },
                        { value: 20, label: t("permissions.realmsCount20") },
                        { value: 50, label: t("permissions.realmsCount50") },
                      ],
                    }}
                    wrapLinesPreference={{
                      label: t("common.wrapLines"),
                      description: t("permissions.wrapLinesDesc"),
                    }}
                    stripedRowsPreference={{
                      label: t("common.stripedRows"),
                      description: t("permissions.stripedRowsDesc"),
                    }}
                    contentDensityPreference={{
                      label: t("common.contentDensity"),
                      description: t("permissions.contentDensityDesc"),
                    }}
                    contentDisplayPreference={{
                      title: t("common.columnPreferences"),
                      options: [
                        { id: "realm", label: t("permissions.realmId"), alwaysVisible: true },
                        { id: "type", label: t("permissions.realmType") },
                        { id: "comment", label: t("permissions.realmComment") },
                        { id: "default", label: t("permissions.realmDefault") },
                        { id: "tfa", label: t("permissions.realmTfa") },
                        { id: "actions", label: t("common.actions") },
                      ],
                    }}
                  />
                }
              />
            ),
          },
          {
            id: "acl",
            label: t("permissions.aclTab"),
            content: (
              <Table
                {...aclCollectionProps}
                items={aclItems}
                columnDefinitions={aclColumns}
                variant="full-page"
                stickyHeader
                resizableColumns
                enableKeyboardNavigation
                loading={loading}
                loadingText={t("permissions.loadingAcl")}
                trackBy={(item) => `${item.path}:${item.type}:${item.ugid}:${item.roleid}`}
                empty={aclFilterProps.filteringText ? renderCenteredState(t("common.noMatches"), t("permissions.noAclEntriesMatch"), <Button formAction="none" onClick={() => aclActions.setFiltering("")}>{t("common.clearFilter")}</Button>) : aclEmptyState}
                wrapLines={aclPreferences.wrapLines}
                stripedRows={aclPreferences.stripedRows}
                contentDensity={aclPreferences.contentDensity}
                columnDisplay={aclPreferences.contentDisplay}
                header={
                  <Header
                    counter={aclHeaderCounter}
                    description={t("permissions.aclDescription")}
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button formAction="none"
                          variant="primary"
                          onClick={() => {
                            setAclForm({
                              ...EMPTY_ACL_FORM,
                              subjectType: userOptions.length > 0 ? "user" : groupOptions.length > 0 ? "group" : tokenOptions.length > 0 ? "token" : "user",
                              subjectId: "",
                              roleid: "",
                            });
                            setOperationError(""); setFieldErrors({});
                setCreateAclVisible(true);
                          }}
                        >
                          {t("permissions.addAcl")}
                        </Button>
                        <Button iconName="refresh" onClick={() => void loadData()}>{t("common.refresh")}</Button>
                      </SpaceBetween>
                    }
                  >
                    {t("permissions.aclTab")}
                  </Header>
                }
                filter={
                  <TextFilter
                    {...aclFilterProps}
                    filteringPlaceholder={t("permissions.findAclEntries")}
                    countText={`${filteredAclCount ?? acls.length} ${t("common.matches")}`}
                  />
                }
                pagination={<Pagination {...aclPaginationProps} />}
                preferences={
                  <CollectionPreferences
                    title={t("common.preferences")}
                    confirmLabel={t("common.confirm")}
                    cancelLabel={t("common.cancel")}
                    preferences={aclPreferences}
                    onConfirm={({ detail }) => updatePreferences(detail, setAclPreferences)}
                    pageSizePreference={{
                      title: t("common.pageSize"),
                      options: [
                        { value: 10, label: t("permissions.aclCount10") },
                        { value: 20, label: t("permissions.aclCount20") },
                        { value: 50, label: t("permissions.aclCount50") },
                      ],
                    }}
                    wrapLinesPreference={{
                      label: t("common.wrapLines"),
                      description: t("permissions.wrapLinesDesc"),
                    }}
                    stripedRowsPreference={{
                      label: t("common.stripedRows"),
                      description: t("permissions.stripedRowsDesc"),
                    }}
                    contentDensityPreference={{
                      label: t("common.contentDensity"),
                      description: t("permissions.contentDensityDesc"),
                    }}
                    contentDisplayPreference={{
                      title: t("common.columnPreferences"),
                      options: [
                        { id: "path", label: t("permissions.path"), alwaysVisible: true },
                        { id: "type", label: t("permissions.type") },
                        { id: "ugid", label: t("permissions.userOrGroupId") },
                        { id: "roleid", label: t("permissions.role") },
                        { id: "propagate", label: t("permissions.propagate") },
                        { id: "actions", label: t("common.actions") },
                      ],
                    }}
                  />
                }
              />
            ),
          },
        ]}
      />

      {securityUser && <UserSecurity userid={securityUser} onDismiss={() => setSecurityUser(null)} onChanged={loadData} />}

      {createRealmVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!realmSubmitting) { setCreateRealmVisible(false); setOperationError(""); setFieldErrors({}); setRealmForm(EMPTY_REALM_FORM); } }}
        header={t("permissions.createRealmModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={realmSubmitting} onClick={() => { setCreateRealmVisible(false); setOperationError(""); setFieldErrors({}); setRealmForm(EMPTY_REALM_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={realmSubmitting} onClick={() => void submitRealm("create")}>{t("common.create")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
        {realmFields}
      </Modal>}

      {editRealmVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!realmSubmitting) { setEditRealmVisible(false); setOperationError(""); setFieldErrors({}); setRealmForm(EMPTY_REALM_FORM); } }}
        header={t("permissions.editRealmModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={realmSubmitting} onClick={() => { setEditRealmVisible(false); setOperationError(""); setFieldErrors({}); setRealmForm(EMPTY_REALM_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={realmSubmitting} onClick={() => void submitRealm("edit")}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
        {realmFields}
      </Modal>}

      {deleteRealmVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!realmSubmitting) { setDeleteRealmVisible(false); setOperationError(""); setFieldErrors({}); } }}
        header={t("permissions.deleteRealmModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={realmSubmitting} onClick={() => { setDeleteRealmVisible(false); setOperationError(""); setFieldErrors({}); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={realmSubmitting} onClick={() => void deleteRealm()}>{t("common.delete")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
        <Box>
          {selectedRealm ? interpolate(t("permissions.deleteRealmConfirmation"), { realm: selectedRealm.realm }) : null}
        </Box>
      </Modal>}

      {createUserVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!userSubmitting) { setCreateUserVisible(false); setOperationError(""); setFieldErrors({}); setUserForm(EMPTY_USER_FORM); } }}
        header={t("permissions.createUserModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={userSubmitting} onClick={() => { setCreateUserVisible(false); setOperationError(""); setFieldErrors({}); setUserForm(EMPTY_USER_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={userSubmitting} onClick={() => void submitUser("create")}>{t("common.create")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
          <FormField errorText={fieldErrors["userid"]} label={t("permissions.userId")}>
            <Input autoComplete="off" value={userForm.userid} placeholder={t("permissions.userIdPlaceholder")} onChange={({ detail }) => setUserForm((current) => ({ ...current, userid: detail.value }))} />
          </FormField>
          <FormField label={`${t("permissions.password")} — ${text("optional", "선택 사항")}`} description={text("Initial password for PVE accounts or existing PAM accounts. External directory users authenticate with their identity provider.", "PVE 계정 또는 기존 PAM 계정의 초기 비밀번호입니다. 외부 디렉터리 사용자는 해당 인증 제공자에서 인증합니다.")} constraintText={text("8 to 64 characters when provided.", "입력하는 경우 8~64자.")}>
            <Input type="password" autoComplete="new-password" value={userForm.password} onChange={({ detail }) => setUserForm((current) => ({ ...current, password: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["groups"]} label={t("permissions.groupsLabel")} description={text("Select the groups this user belongs to.", "사용자가 속할 그룹을 선택하세요.")}>
            <Multiselect filteringType="auto" selectedOptions={toList(userForm.groups).map((value) => ({ label: value, value }))} options={groupOptions} placeholder={t("permissions.groupsPlaceholder")} onChange={({ detail }) => setUserForm((current) => ({ ...current, groups: detail.selectedOptions.map((option) => option.value).join(",") }))} />
          </FormField>
          <FormField errorText={fieldErrors["email"]} label={t("permissions.email")}>
            <Input value={userForm.email} onChange={({ detail }) => setUserForm((current) => ({ ...current, email: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["firstname"]} label={t("permissions.firstName")}>
            <Input value={userForm.firstname} onChange={({ detail }) => setUserForm((current) => ({ ...current, firstname: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["lastname"]} label={t("permissions.lastName")}>
            <Input value={userForm.lastname} onChange={({ detail }) => setUserForm((current) => ({ ...current, lastname: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["expire"]} label={t("permissions.expire")} description={t("permissions.expireHelp")}>
            <Input value={userForm.expire} placeholder={t("permissions.expirePlaceholder")} onChange={({ detail }) => setUserForm((current) => ({ ...current, expire: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["comment"]} label={t("permissions.comment")}>
            <Textarea value={userForm.comment} onChange={({ detail }) => setUserForm((current) => ({ ...current, comment: detail.value }))} />
          </FormField>
          <Checkbox checked={userForm.enabled} onChange={({ detail }) => setUserForm((current) => ({ ...current, enabled: detail.checked }))}>
            {t("permissions.enabled")}
          </Checkbox>
        </SpaceBetween>
      </Modal>}

      {editUserVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!userSubmitting) { setEditUserVisible(false); setOperationError(""); setFieldErrors({}); setUserForm(EMPTY_USER_FORM); } }}
        header={t("permissions.editUserModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={userSubmitting} onClick={() => { setEditUserVisible(false); setOperationError(""); setFieldErrors({}); setUserForm(EMPTY_USER_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={userSubmitting} onClick={() => void submitUser("edit")}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
          <FormField errorText={fieldErrors["userid"]} label={t("permissions.userId")}>
            <Input value={userForm.userid} disabled />
          </FormField>
          <Alert type="info">{text("Change passwords and manage API tokens or two-factor authentication using the Security action on the user row.", "사용자 행의 보안 메뉴에서 비밀번호, API 토큰, 2단계 인증을 관리할 수 있습니다.")}</Alert>
          <FormField errorText={fieldErrors["groups"]} label={t("permissions.groupsLabel")} description={text("Select the groups this user belongs to.", "사용자가 속할 그룹을 선택하세요.")}>
            <Multiselect filteringType="auto" selectedOptions={toList(userForm.groups).map((value) => ({ label: value, value }))} options={groupOptions} placeholder={t("permissions.groupsPlaceholder")} onChange={({ detail }) => setUserForm((current) => ({ ...current, groups: detail.selectedOptions.map((option) => option.value).join(",") }))} />
          </FormField>
          <FormField errorText={fieldErrors["email"]} label={t("permissions.email")}>
            <Input value={userForm.email} onChange={({ detail }) => setUserForm((current) => ({ ...current, email: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["firstname"]} label={t("permissions.firstName")}>
            <Input value={userForm.firstname} onChange={({ detail }) => setUserForm((current) => ({ ...current, firstname: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["lastname"]} label={t("permissions.lastName")}>
            <Input value={userForm.lastname} onChange={({ detail }) => setUserForm((current) => ({ ...current, lastname: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["expire"]} label={t("permissions.expire")} description={t("permissions.expireHelp")}>
            <Input value={userForm.expire} placeholder={t("permissions.expirePlaceholder")} onChange={({ detail }) => setUserForm((current) => ({ ...current, expire: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["comment"]} label={t("permissions.comment")}>
            <Textarea value={userForm.comment} onChange={({ detail }) => setUserForm((current) => ({ ...current, comment: detail.value }))} />
          </FormField>
          <Checkbox checked={userForm.enabled} onChange={({ detail }) => setUserForm((current) => ({ ...current, enabled: detail.checked }))}>
            {t("permissions.enabled")}
          </Checkbox>
        </SpaceBetween>
      </Modal>}

      {deleteUserVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!userSubmitting) { setDeleteUserVisible(false); setOperationError(""); setFieldErrors({}); } }}
        header={t("permissions.deleteUserModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={userSubmitting} onClick={() => { setDeleteUserVisible(false); setOperationError(""); setFieldErrors({}); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={userSubmitting} onClick={() => void deleteUser()}>{t("common.delete")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
        <Box>{selectedUser ? interpolate(t("permissions.deleteUserConfirmation"), { userid: selectedUser.userid }) : null}</Box>
      </Modal>}

      {createGroupVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!groupSubmitting) { setCreateGroupVisible(false); setOperationError(""); setFieldErrors({}); setGroupForm(EMPTY_GROUP_FORM); } }}
        header={t("permissions.createGroupModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={groupSubmitting} onClick={() => { setCreateGroupVisible(false); setOperationError(""); setFieldErrors({}); setGroupForm(EMPTY_GROUP_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={groupSubmitting} onClick={() => void submitGroup("create")}>{t("common.create")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
          <FormField errorText={fieldErrors["groupid"]} label={t("permissions.groupId")}>
            <Input value={groupForm.groupid} onChange={({ detail }) => setGroupForm((current) => ({ ...current, groupid: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["comment"]} label={t("permissions.comment")}>
            <Textarea value={groupForm.comment} onChange={({ detail }) => setGroupForm((current) => ({ ...current, comment: detail.value }))} />
          </FormField>
        </SpaceBetween>
      </Modal>}

      {editGroupVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!groupSubmitting) { setEditGroupVisible(false); setOperationError(""); setFieldErrors({}); setGroupForm(EMPTY_GROUP_FORM); } }}
        header={t("permissions.editGroupModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={groupSubmitting} onClick={() => { setEditGroupVisible(false); setOperationError(""); setFieldErrors({}); setGroupForm(EMPTY_GROUP_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={groupSubmitting} onClick={() => void submitGroup("edit")}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
          <FormField errorText={fieldErrors["groupid"]} label={t("permissions.groupId")}>
            <Input value={groupForm.groupid} disabled />
          </FormField>
          <FormField errorText={fieldErrors["comment"]} label={t("permissions.comment")}>
            <Textarea value={groupForm.comment} onChange={({ detail }) => setGroupForm((current) => ({ ...current, comment: detail.value }))} />
          </FormField>
        </SpaceBetween>
      </Modal>}

      {deleteGroupVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!groupSubmitting) { setDeleteGroupVisible(false); setOperationError(""); setFieldErrors({}); } }}
        header={t("permissions.deleteGroupModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={groupSubmitting} onClick={() => { setDeleteGroupVisible(false); setOperationError(""); setFieldErrors({}); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={groupSubmitting} onClick={() => void deleteGroup()}>{t("common.delete")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
        <Box>{selectedGroup ? interpolate(t("permissions.deleteGroupConfirmation"), { groupid: selectedGroup.groupid }) : null}</Box>
      </Modal>}

      {createRoleVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!roleSubmitting) { setCreateRoleVisible(false); setOperationError(""); setFieldErrors({}); setRoleForm(EMPTY_ROLE_FORM); } }}
        header={t("permissions.createRoleModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={roleSubmitting} onClick={() => { setCreateRoleVisible(false); setOperationError(""); setFieldErrors({}); setRoleForm(EMPTY_ROLE_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={roleSubmitting} onClick={() => void submitRole("create")}>{t("common.create")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
          <FormField errorText={fieldErrors["roleid"]} label={t("permissions.roleId")}>
            <Input value={roleForm.roleid} onChange={({ detail }) => setRoleForm((current) => ({ ...current, roleid: detail.value }))} />
          </FormField>
          <FormField errorText={fieldErrors["privs"]} label={t("permissions.privileges")} description={text("Select privileges reported by this Proxmox server. Leave empty to create a role without privileges.", "Proxmox 서버에서 제공하는 권한을 선택하세요. 비워 두면 권한 없는 역할을 생성합니다.")}>
            <Multiselect filteringType="auto" selectedOptions={toList(roleForm.privs).map((value) => ({ label: value, value }))} options={[...new Set(roles.flatMap((role) => role.privs).concat(toList(roleForm.privs)))].sort().map((value) => ({ label: value, value }))} placeholder={t("permissions.privilegesPlaceholder")} onChange={({ detail }) => setRoleForm((current) => ({ ...current, privs: detail.selectedOptions.map((option) => option.value).join(",") }))} />
          </FormField>
        </SpaceBetween>
      </Modal>}

      {editRoleVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!roleSubmitting) { setEditRoleVisible(false); setOperationError(""); setFieldErrors({}); setRoleForm(EMPTY_ROLE_FORM); } }}
        header={t("permissions.editRoleModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={roleSubmitting} onClick={() => { setEditRoleVisible(false); setOperationError(""); setFieldErrors({}); setRoleForm(EMPTY_ROLE_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={roleSubmitting} onClick={() => void submitRole("edit")}>{t("common.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
          <FormField errorText={fieldErrors["roleid"]} label={t("permissions.roleId")}>
            <Input value={roleForm.roleid} disabled />
          </FormField>
          <FormField errorText={fieldErrors["privs"]} label={t("permissions.privileges")} description={text("Select privileges reported by this Proxmox server. Leave empty to create a role without privileges.", "Proxmox 서버에서 제공하는 권한을 선택하세요. 비워 두면 권한 없는 역할을 생성합니다.")}>
            <Multiselect filteringType="auto" selectedOptions={toList(roleForm.privs).map((value) => ({ label: value, value }))} options={[...new Set(roles.flatMap((role) => role.privs).concat(toList(roleForm.privs)))].sort().map((value) => ({ label: value, value }))} placeholder={t("permissions.privilegesPlaceholder")} onChange={({ detail }) => setRoleForm((current) => ({ ...current, privs: detail.selectedOptions.map((option) => option.value).join(",") }))} />
          </FormField>
        </SpaceBetween>
      </Modal>}

      {deleteRoleVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!roleSubmitting) { setDeleteRoleVisible(false); setOperationError(""); setFieldErrors({}); } }}
        header={t("permissions.deleteRoleModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={roleSubmitting} onClick={() => { setDeleteRoleVisible(false); setOperationError(""); setFieldErrors({}); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={roleSubmitting} onClick={() => void deleteRole()}>{t("common.delete")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
        <Box>{selectedRole ? interpolate(t("permissions.deleteRoleConfirmation"), { roleid: selectedRole.roleid }) : null}</Box>
      </Modal>}

      {createAclVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!aclSubmitting) { setCreateAclVisible(false); setOperationError(""); setFieldErrors({}); setAclForm(EMPTY_ACL_FORM); } }}
        header={t("permissions.addAclModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={aclSubmitting} onClick={() => { setCreateAclVisible(false); setOperationError(""); setFieldErrors({}); setAclForm(EMPTY_ACL_FORM); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={aclSubmitting} onClick={() => void submitAcl()}>{t("permissions.addAcl")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
          <FormField errorText={fieldErrors["path"]} label={t("permissions.path")} description={t("permissions.pathHelp")}>
            <Input value={aclForm.path} placeholder={t("permissions.pathPlaceholder")} onChange={({ detail }) => setAclForm((current) => ({ ...current, path: detail.value }))} />
          </FormField>
          <FormField label={t("permissions.subjectType")}>
            <Select
              selectedOption={{ label: t(`permissions.${aclForm.subjectType}`), value: aclForm.subjectType }}
              options={[
                { label: t("permissions.user"), value: "user" },
                { label: t("permissions.group"), value: "group" },
                { label: t("permissions.token"), value: "token" },
              ]}
              onChange={({ detail }) => {
                const subjectType = (getTrackableId(detail.selectedOption) || "user") as AclFormState["subjectType"];
                setAclForm((current) => ({
                  ...current,
                  subjectType,
                  subjectId: "",
                }));
              }}
            />
          </FormField>
          <FormField label={t("permissions.subject")}> 
            <Select
              selectedOption={selectedAclSubjectOption}
              options={aclSubjectOptions}
              placeholder={t("permissions.selectSubject")}
              onChange={({ detail }) => setAclForm((current) => ({ ...current, subjectId: getTrackableId(detail.selectedOption) }))}
            />
          </FormField>
          <FormField label={t("permissions.role")}>
            <Select
              selectedOption={selectedAclRoleOption}
              options={roleOptions}
              placeholder={t("permissions.selectRole")}
              onChange={({ detail }) => setAclForm((current) => ({ ...current, roleid: getTrackableId(detail.selectedOption) }))}
            />
          </FormField>
          <Checkbox checked={aclForm.propagate} onChange={({ detail }) => setAclForm((current) => ({ ...current, propagate: detail.checked }))}>
            {t("permissions.propagate")}
          </Checkbox>
        </SpaceBetween>
      </Modal>}

      {deleteAclVisible && <Modal
        visible
        closeAriaLabel={text("Close dialog", "대화 상자 닫기")}
        onDismiss={() => { if (!aclSubmitting) { setDeleteAclVisible(false); setOperationError(""); setFieldErrors({}); } }}
        header={t("permissions.removeAclModalTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={aclSubmitting} onClick={() => { setDeleteAclVisible(false); setOperationError(""); setFieldErrors({}); }}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={aclSubmitting} onClick={() => void deleteAcl()}>{t("common.delete")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {Boolean(operationError) && <Alert type="error">{operationError}</Alert>}
        <Box>
          {selectedAcl
            ? interpolate(t("permissions.removeAclConfirmation"), {
                path: selectedAcl.path,
                subject: selectedAcl.ugid,
                role: selectedAcl.roleid,
              })
            : null}
        </Box>
      </Modal>}
    </SpaceBetween>
  );
}
