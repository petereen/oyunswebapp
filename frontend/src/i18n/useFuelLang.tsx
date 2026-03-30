import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import translations, { FuelLang } from "./fuelAdminTranslations";

const LANG_STORAGE_KEY = "fuel_admin_lang";

function getInitialLang(): FuelLang {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (stored === "mn" || stored === "ru") return stored;
  return "ru";
}

interface FuelLangContextType {
  lang: FuelLang;
  setLang: (lang: FuelLang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const FuelLangContext = createContext<FuelLangContextType | null>(null);

export function FuelLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<FuelLang>(getInitialLang);

  const setLang = useCallback((newLang: FuelLang) => {
    setLangState(newLang);
    localStorage.setItem(LANG_STORAGE_KEY, newLang);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const entry = translations[key];
      if (!entry) return key;
      let text = entry[lang] || entry["ru"] || key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [lang],
  );

  return (
    <FuelLangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </FuelLangContext.Provider>
  );
}

export function useFuelLang() {
  const ctx = useContext(FuelLangContext);
  if (!ctx) throw new Error("useFuelLang must be used within FuelLangProvider");
  return ctx;
}
