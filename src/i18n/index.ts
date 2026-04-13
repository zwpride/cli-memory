import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export type Language = "zh" | "en" | "ja";

const DEFAULT_LANGUAGE: Language = "zh";
const FALLBACK_LANGUAGE: Language = "en";

const localeLoaders: Record<Language, () => Promise<{ default: object }>> = {
  en: () => import("./locales/en.json"),
  ja: () => import("./locales/ja.json"),
  zh: () => import("./locales/zh.json"),
};

const getInitialLanguage = (): Language => {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("language");
      if (stored === "zh" || stored === "en" || stored === "ja") {
        return stored;
      }
    } catch (error) {
      console.warn("[i18n] Failed to read stored language preference", error);
    }
  }

  const navigatorLang =
    typeof navigator !== "undefined"
      ? (navigator.language?.toLowerCase() ??
        navigator.languages?.[0]?.toLowerCase())
      : undefined;

  if (navigatorLang?.startsWith("zh")) {
    return "zh";
  }

  if (navigatorLang?.startsWith("ja")) {
    return "ja";
  }

  if (navigatorLang?.startsWith("en")) {
    return "en";
  }

  return DEFAULT_LANGUAGE;
};

async function ensureLanguageLoaded(lang: Language) {
  if (i18n.hasResourceBundle(lang, "translation")) {
    return;
  }

  const module = await localeLoaders[lang]();
  i18n.addResourceBundle(lang, "translation", module.default, true, true);
}

const initialLanguage = getInitialLanguage();

export const i18nReady = (async () => {
  const initialModule = await localeLoaders[initialLanguage]();

  await i18n.use(initReactI18next).init({
    resources: {
      [initialLanguage]: {
        translation: initialModule.default,
      },
    },
    lng: initialLanguage, // 根据本地存储或系统语言选择默认语言
    fallbackLng: FALLBACK_LANGUAGE, // 如果缺少中文翻译则退回英文

    interpolation: {
      escapeValue: false, // React 已经默认转义
    },

    // 开发模式下显示调试信息
    debug: false,
  });

  if (initialLanguage !== FALLBACK_LANGUAGE) {
    void ensureLanguageLoaded(FALLBACK_LANGUAGE);
  }
})();

export async function changeAppLanguage(lang: Language) {
  await ensureLanguageLoaded(lang);
  await i18n.changeLanguage(lang);
}

export default i18n;
