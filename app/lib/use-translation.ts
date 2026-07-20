"use client";

import { useCallback } from "react";
import { useSettings } from "@/app/components/settings-context";
import { translations } from "@/app/lib/translations";

function getTranslationValue(source: unknown, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, source);

  return typeof value === "string" ? value : undefined;
}

export function useTranslation() {
  const { language } = useSettings();

  const t = useCallback((key: string) => {
    return getTranslationValue(translations[language], key)
      ?? getTranslationValue(translations.en, key)
      ?? key;
  }, [language]);

  return { language, t };
}
