import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useLocale, useTheme } from "vuetify";
import type { AppLocale } from "../locales.js";

type ThemeMode = "system" | "light" | "dark";

export function useAppPreferences() {
  const theme = useTheme();
  const locale = useLocale();
  const themeMode = ref<ThemeMode>(readThemeMode());
  let colorScheme: MediaQueryList | null = null;

  const themeIcon = computed(() => {
    if (themeMode.value === "system") return "$mdiThemeLightDark";
    return themeMode.value === "dark" ? "$mdiWeatherNight" : "$mdiWeatherSunny";
  });
  const languageName = computed(() =>
    locale.current.value === "zhHans" ? "简体中文" : "English",
  );

  onMounted(() => {
    colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    applyLocale(locale.current.value as AppLocale);
    applyTheme();
    colorScheme.addEventListener("change", applyTheme);
  });

  onBeforeUnmount(() => colorScheme?.removeEventListener("change", applyTheme));

  function setThemeMode(value: ThemeMode) {
    themeMode.value = value;
    window.localStorage.setItem("chatroom.theme", value);
    applyTheme();
  }

  function setLocale(value: AppLocale) {
    locale.current.value = value;
    window.localStorage.setItem("chatroom.locale", value);
    applyLocale(value);
  }

  function applyTheme() {
    const dark =
      themeMode.value === "dark" ||
      (themeMode.value === "system" && colorScheme?.matches);
    theme.change(dark ? "dark" : "light");
  }

  return { themeMode, themeIcon, languageName, setThemeMode, setLocale };
}

function readThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem("chatroom.theme");
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function applyLocale(locale: AppLocale) {
  document.documentElement.lang = locale === "zhHans" ? "zh-CN" : "en-US";
}
