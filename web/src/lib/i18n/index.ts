import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ptBR from "./locales/pt-BR.json";
import ru from "./locales/ru.json";
import zhCN from "./locales/zh-CN.json";

export const LANGUAGES = ["en", "de", "es", "fr", "pt-BR", "ru", "zh-CN"] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = "vs-webui-language";

function detectLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (LANGUAGES as readonly string[]).includes(stored)) {
    return stored as Language;
  }
  const browser = navigator.language;
  if (browser.startsWith("pt")) return "pt-BR";
  if (browser.startsWith("zh")) return "zh-CN";
  const short = browser.split("-")[0];
  return (LANGUAGES as readonly string[]).includes(short) ? (short as Language) : "en";
}

const initialLanguage = detectLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
    es: { translation: es },
    fr: { translation: fr },
    "pt-BR": { translation: ptBR },
    ru: { translation: ru },
    "zh-CN": { translation: zhCN },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

document.documentElement.lang = initialLanguage;
i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

export function setLanguage(language: string): Promise<void> {
  localStorage.setItem(STORAGE_KEY, language);
  return i18n.changeLanguage(language).then(() => undefined);
}

export default i18n;
