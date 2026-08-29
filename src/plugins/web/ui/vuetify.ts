import { createVuetify } from "vuetify";
import { mdi } from "vuetify/iconsets/mdi";
import { chatroomLocaleMessages, initialAppLocale } from "./locales.js";

export const vuetify = createVuetify({
  icons: { defaultSet: "mdi", sets: { mdi } },
  locale: {
    locale: initialAppLocale(),
    fallback: "en",
    messages: chatroomLocaleMessages,
  },
  theme: {
    defaultTheme: "light",
    themes: {
      light: {
        dark: false,
        colors: {
          background: "#f6f7f9",
          surface: "#ffffff",
          "surface-variant": "#eef1f4",
          primary: "#315cdd",
          secondary: "#5f6b7a",
          success: "#16855b",
          warning: "#a96b12",
          error: "#c83b45",
          outline: "#7b8491",
        },
      },
      dark: {
        dark: true,
        colors: {
          background: "#111316",
          surface: "#181b1f",
          "surface-variant": "#22262b",
          primary: "#86a2ff",
          secondary: "#9aa5b3",
          success: "#62c69b",
          warning: "#e2ad5b",
          error: "#ff7b83",
          outline: "#737b86",
        },
      },
    },
  },
  defaults: {
    VCard: { elevation: 0, border: true, rounded: "xl" },
    VBtn: { rounded: "lg", elevation: 0 },
    VTextField: {
      variant: "outlined",
      density: "comfortable",
      hideDetails: "auto",
    },
    VSelect: { variant: "outlined", density: "compact", hideDetails: "auto" },
    VSwitch: {
      color: "primary",
      density: "compact",
      hideDetails: true,
      inset: true,
      size: "small",
    },
    VChip: { size: "small", variant: "tonal" },
    VTabs: { color: "primary" },
  },
});
