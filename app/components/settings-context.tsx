"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { applyMode, Mode, applyDensity, Density } from "@cloudscape-design/global-styles";
import type { Language } from "@/app/lib/translations";

export type ThemeMode = "light" | "dark" | "system";
export type TableDensity = "comfortable" | "compact";
export type DateFormat = "relative" | "absolute" | "iso";

interface Settings {
  theme: ThemeMode;
  language: Language;
  tableDensity: TableDensity;
  refreshInterval: number;
  dateFormat: DateFormat;
  confirmPowerActions: boolean;
  showVmTags: boolean;
  pageSize: number;
}

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  language: "en",
  tableDensity: "comfortable",
  refreshInterval: 30,
  dateFormat: "relative",
  confirmPowerActions: true,
  showVmTags: true,
  pageSize: 20,
};

interface SettingsContextValue extends Settings {
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  ...DEFAULT_SETTINGS,
  update: () => {},
  reset: () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}

const STORAGE_KEY = "pve-settings";

export function parseSettings(raw: string | null): Settings {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_SETTINGS;
    const out = { ...DEFAULT_SETTINGS };
    for (const key of ["theme", "language", "tableDensity", "dateFormat"] as const) {
      const allowed = { theme: ["light", "dark", "system"], language: ["en", "ko"], tableDensity: ["comfortable", "compact"], dateFormat: ["relative", "absolute", "iso"] };
      if (allowed[key].includes(parsed[key])) Object.assign(out, { [key]: parsed[key] });
    }
    for (const key of ["refreshInterval", "pageSize"] as const) {
      const allowed = key === "refreshInterval" ? [0, 5, 10, 15, 30, 60, 120, 300] : [10, 20, 50, 100];
      if (allowed.includes(parsed[key])) out[key] = parsed[key];
    }
    for (const key of ["confirmPowerActions", "showVmTags"] as const) if (typeof parsed[key] === "boolean") out[key] = parsed[key];
    return out;
  } catch { return DEFAULT_SETTINGS; }
}

let previousRaw: string | null | undefined;
let snapshot = DEFAULT_SETTINGS;
let volatileSettings: Settings | null = null;
function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  if (volatileSettings) return volatileSettings;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== previousRaw) { previousRaw = saved; snapshot = parseSettings(saved); }
    return snapshot;
  } catch {}
  return snapshot;
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    volatileSettings = null;
  } catch { volatileSettings = settings; }
  snapshot = settings;
  previousRaw = JSON.stringify(settings);
  window.dispatchEvent(new Event("pve-settings-change"));
}

function subscribeSettings(callback: () => void) {
  window.addEventListener("pve-settings-change", callback);
  const storage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    volatileSettings = null; previousRaw = undefined; callback();
  };
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener("pve-settings-change", callback); window.removeEventListener("storage", storage); };
}
const getServerSettings = () => DEFAULT_SETTINGS;

function applyTheme(theme: ThemeMode) {
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyMode(prefersDark ? Mode.Dark : Mode.Light);
  } else {
    applyMode(theme === "dark" ? Mode.Dark : Mode.Light);
  }
}

function applyTableDensity(density: TableDensity) {
  applyDensity(density === "compact" ? Density.Compact : Density.Comfortable);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSyncExternalStore(subscribeSettings, loadSettings, getServerSettings);

  useEffect(() => {
    applyTheme(settings.theme);
    applyTableDensity(settings.tableDensity);
    document.documentElement.lang = settings.language;
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings.theme, settings.tableDensity, settings.language]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    saveSettings(parseSettings(JSON.stringify({ ...loadSettings(), [key]: value })));
  }, []);
  const reset = useCallback(() => saveSettings(DEFAULT_SETTINGS), []);

  return (
    <SettingsContext.Provider value={{ ...settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}
