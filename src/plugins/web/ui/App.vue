<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useDisplay, useLocale, useTheme } from "vuetify";
import { api } from "./api.js";
import type { AppLocale } from "./locales.js";
import LoginView from "./components/LoginView.vue";
import OperationsView from "./components/OperationsView.vue";
import PasskeyManagerDialog from "./components/PasskeyManagerDialog.vue";
import WorkspacesView from "./components/WorkspacesView.vue";
import ProcessesView from "./components/ProcessesView.vue";
import CloudView from "./components/CloudView.vue";
import ComputerView from "./components/ComputerView.vue";

type View = "workspaces" | "processes" | "computer" | "cloud" | "operations";
type ThemeMode = "system" | "light" | "dark";
type RegistrationOptionsJSON = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];
type AuthenticationOptionsJSON = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];

interface AuthStatus {
  authenticated: boolean;
  passkeyAvailable: boolean;
  passkeyRegistered: boolean;
}

interface PasskeySummary {
  id: string;
  name: string;
  lastUsedAt: string;
}

interface RuntimeStatus {
  version: string;
  mcpRequests: number;
  uptimeMinutes: number;
}

const nav = [
  { id: "workspaces", titleKey: "nav.workspaces", icon: "mdi-folder-outline" },
  { id: "processes", titleKey: "nav.processes", icon: "mdi-console-line" },
  { id: "computer", titleKey: "nav.computer", icon: "mdi-monitor" },
  { id: "cloud", titleKey: "nav.cloud", icon: "mdi-cloud-outline" },
  {
    id: "operations",
    titleKey: "nav.operations",
    icon: "mdi-text-box-outline",
  },
] as const;

const authenticated = ref<boolean | null>(null);
const passkeyServerAvailable = ref(false);
const passkeyRegistered = ref(false);
const passkeyBrowserAvailable = ref(false);
const passkeyBusy = ref(false);
const passkeyDialog = ref(false);
const passkeys = ref<PasskeySummary[]>([]);
const passkeyName = ref("");
const view = ref<View>(viewFromPath());
const revision = ref(0);
const token = ref("");
const remember = ref(true);
const loginError = ref("");
const passkeyError = ref("");
const themeMode = ref<ThemeMode>(readThemeMode());
const theme = useTheme();
const locale = useLocale();
const display = useDisplay();
const drawer = ref(!display.smAndDown.value);
const runtime = ref<RuntimeStatus | null>(null);
let stream: EventSource | null = null;
let media: MediaQueryList | null = null;
let runtimeTimer: ReturnType<typeof setInterval> | null = null;

const current = computed(() => nav.find((item) => item.id === view.value)!);
const currentTitle = computed(() =>
  locale.t(`$vuetify.chatroom.${current.value.titleKey}`),
);
const currentComponent = computed(
  () =>
    ({
      workspaces: WorkspacesView,
      processes: ProcessesView,
      computer: ComputerView,
      cloud: CloudView,
      operations: OperationsView,
    })[view.value],
);
const themeIcon = computed(() => {
  if (themeMode.value === "system") return "mdi-theme-light-dark";
  return themeMode.value === "dark" ? "mdi-weather-night" : "mdi-weather-sunny";
});
const languageName = computed(() =>
  locale.current.value === "zhHans" ? "简体中文" : "English",
);
const canUsePasskeys = computed(
  () => passkeyServerAvailable.value && passkeyBrowserAvailable.value,
);

watch(
  () => display.smAndDown.value,
  (compact) => {
    drawer.value = !compact;
  },
);

onMounted(async () => {
  media = window.matchMedia("(prefers-color-scheme: dark)");
  document.documentElement.lang =
    locale.current.value === "zhHans" ? "zh-CN" : "en-US";
  applyTheme();
  media.addEventListener("change", applyTheme);
  window.addEventListener("popstate", syncViewFromPath);
  passkeyBrowserAvailable.value = browserSupportsWebAuthn();
  try {
    const status = await api<AuthStatus>("/auth/status");
    authenticated.value = status.authenticated;
    passkeyServerAvailable.value = status.passkeyAvailable;
    passkeyRegistered.value = status.passkeyRegistered;
  } catch {
    authenticated.value = false;
  }
  if (authenticated.value) {
    connectEvents();
    startRuntimeStatus();
  }
});

onBeforeUnmount(() => {
  stream?.close();
  if (runtimeTimer) clearInterval(runtimeTimer);
  media?.removeEventListener("change", applyTheme);
  window.removeEventListener("popstate", syncViewFromPath);
});

function readThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem("chatroom.theme");
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function applyTheme() {
  const dark =
    themeMode.value === "dark" ||
    (themeMode.value === "system" && media?.matches);
  theme.global.name.value = dark ? "dark" : "light";
}

function setThemeMode(value: ThemeMode) {
  themeMode.value = value;
  window.localStorage.setItem("chatroom.theme", value);
  applyTheme();
}

function setLocale(value: AppLocale) {
  locale.current.value = value;
  window.localStorage.setItem("chatroom.locale", value);
  document.documentElement.lang = value === "zhHans" ? "zh-CN" : "en-US";
}

function navigate(next: View) {
  view.value = next;
  const path = next === "workspaces" ? "/" : `/${next}`;
  if (window.location.pathname !== path)
    window.history.pushState(null, "", path);
  if (display.smAndDown.value) drawer.value = false;
}

function connectEvents() {
  stream?.close();
  stream = new EventSource("/api/events");
  stream.addEventListener("runtime", () => {
    revision.value++;
  });
}

function startRuntimeStatus() {
  if (runtimeTimer) clearInterval(runtimeTimer);
  void loadRuntimeStatus();
  runtimeTimer = setInterval(() => {
    void loadRuntimeStatus();
  }, 5000);
}

async function loadRuntimeStatus() {
  try {
    runtime.value = await api<RuntimeStatus>("/runtime");
  } catch {
    // Runtime metadata is informational and must not affect the main UI.
  }
}

function viewFromPath(): View {
  switch (window.location.pathname) {
    case "/processes":
      return "processes";
    case "/computer":
      return "computer";
    case "/cloud":
      return "cloud";
    case "/operations":
      return "operations";
    default:
      return "workspaces";
  }
}

function syncViewFromPath() {
  view.value = viewFromPath();
}

function formatUptime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return locale.t(
    "$vuetify.chatroom.runtime.uptimeHoursMinutes",
    hours,
    minutes,
  );
}

async function login() {
  loginError.value = "";
  try {
    await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        ownerToken: token.value,
        remember: remember.value,
      }),
    });
    completeLogin();
  } catch (error) {
    loginError.value = (error as Error).message;
  }
}

async function loginWithPasskey() {
  loginError.value = "";
  passkeyBusy.value = true;
  try {
    const request = await api<{
      challengeId: string;
      options: AuthenticationOptionsJSON;
    }>("/auth/passkey/options", { method: "POST" });
    const response = await startAuthentication({
      optionsJSON: request.options,
    });
    await api("/auth/passkey/verify", {
      method: "POST",
      body: JSON.stringify({
        challengeId: request.challengeId,
        response,
        remember: remember.value,
      }),
    });
    completeLogin();
  } catch (error) {
    loginError.value = (error as Error).message;
  } finally {
    passkeyBusy.value = false;
  }
}

function completeLogin() {
  authenticated.value = true;
  token.value = "";
  loginError.value = "";
  connectEvents();
  startRuntimeStatus();
}

async function logout() {
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  if (runtimeTimer) {
    clearInterval(runtimeTimer);
    runtimeTimer = null;
  }
  runtime.value = null;
  stream?.close();
  stream = null;
  authenticated.value = false;
  view.value = "workspaces";
  window.history.replaceState(null, "", "/");
  drawer.value = !display.smAndDown.value;
}

async function openPasskeyManager() {
  passkeyDialog.value = true;
  passkeyError.value = "";
  passkeyName.value = locale.t("$vuetify.chatroom.auth.thisDevice");
  await loadPasskeys();
}

async function loadPasskeys() {
  try {
    passkeys.value = await api<PasskeySummary[]>("/auth/passkeys");
    passkeyRegistered.value = passkeys.value.length > 0;
  } catch (error) {
    passkeyError.value = (error as Error).message;
  }
}

async function registerPasskey() {
  passkeyError.value = "";
  passkeyBusy.value = true;
  try {
    const request = await api<{
      challengeId: string;
      options: RegistrationOptionsJSON;
    }>("/auth/passkeys/register/options", { method: "POST" });
    const response = await startRegistration({ optionsJSON: request.options });
    await api("/auth/passkeys/register/verify", {
      method: "POST",
      body: JSON.stringify({
        challengeId: request.challengeId,
        response,
        name: passkeyName.value,
      }),
    });
    await loadPasskeys();
  } catch (error) {
    passkeyError.value = (error as Error).message;
  } finally {
    passkeyBusy.value = false;
  }
}

async function removePasskey(id: string) {
  passkeyError.value = "";
  try {
    await api(`/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadPasskeys();
  } catch (error) {
    passkeyError.value = (error as Error).message;
  }
}
</script>

<template>
  <v-app class="app-shell">
    <template v-if="authenticated">
      <v-navigation-drawer
        v-model="drawer"
        :temporary="display.smAndDown.value"
        :width="display.smAndDown.value ? 272 : 220"
        class="app-drawer"
        border="e"
      >
        <v-list nav density="comfortable" class="nav-list">
          <v-list-item
            v-for="item in nav"
            :key="item.id"
            :active="view === item.id"
            :prepend-icon="item.icon"
            :title="locale.t(`$vuetify.chatroom.${item.titleKey}`)"
            rounded="lg"
            @click="navigate(item.id)"
          />
        </v-list>

        <template #append>
          <div class="drawer-runtime">
            <div class="drawer-runtime-row">
              <span>{{ locale.t("$vuetify.chatroom.runtime.version") }}</span>
              <strong>{{ runtime?.version ?? "—" }}</strong>
            </div>
            <div class="drawer-runtime-row">
              <span>{{
                locale.t("$vuetify.chatroom.runtime.mcpRequests")
              }}</span>
              <strong>{{ runtime?.mcpRequests ?? "—" }}</strong>
            </div>
            <div class="drawer-runtime-row">
              <span>{{ locale.t("$vuetify.chatroom.runtime.uptime") }}</span>
              <strong>{{
                runtime ? formatUptime(runtime.uptimeMinutes) : "—"
              }}</strong>
            </div>
          </div>
          <div class="drawer-actions">
            <v-btn
              v-if="canUsePasskeys"
              icon="mdi-fingerprint"
              variant="text"
              size="small"
              :aria-label="locale.t('$vuetify.chatroom.auth.passkeys')"
              @click="openPasskeyManager"
            />

            <v-menu location="top start">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-translate"
                  variant="text"
                  size="small"
                  :aria-label="locale.t('$vuetify.chatroom.common.language')"
                />
              </template>
              <v-list density="compact" min-width="160">
                <v-list-item
                  title="简体中文"
                  :active="locale.current.value === 'zhHans'"
                  @click="setLocale('zhHans')"
                />
                <v-list-item
                  title="English"
                  :active="locale.current.value === 'en'"
                  @click="setLocale('en')"
                />
              </v-list>
            </v-menu>

            <v-menu location="top start">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  :icon="themeIcon"
                  variant="text"
                  size="small"
                  :aria-label="locale.t('$vuetify.chatroom.common.theme')"
                />
              </template>
              <v-list density="compact" min-width="170">
                <v-list-item
                  prepend-icon="mdi-theme-light-dark"
                  :title="locale.t('$vuetify.chatroom.theme.system')"
                  :active="themeMode === 'system'"
                  @click="setThemeMode('system')"
                />
                <v-list-item
                  prepend-icon="mdi-weather-sunny"
                  :title="locale.t('$vuetify.chatroom.theme.light')"
                  :active="themeMode === 'light'"
                  @click="setThemeMode('light')"
                />
                <v-list-item
                  prepend-icon="mdi-weather-night"
                  :title="locale.t('$vuetify.chatroom.theme.dark')"
                  :active="themeMode === 'dark'"
                  @click="setThemeMode('dark')"
                />
              </v-list>
            </v-menu>

            <v-btn
              icon="mdi-logout"
              variant="text"
              size="small"
              :aria-label="locale.t('$vuetify.chatroom.common.signOut')"
              @click="logout"
            />
          </div>
        </template>
      </v-navigation-drawer>

      <v-app-bar flat class="app-bar" height="64">
        <v-app-bar-nav-icon @click="drawer = !drawer" />
        <v-app-bar-title class="page-title">
          {{ currentTitle }}
        </v-app-bar-title>
        <template #append>
          <div class="connection-state">
            <span class="connection-dot" />
            <span class="connection-state-label">{{
              locale.t("$vuetify.chatroom.common.connected")
            }}</span>
          </div>
        </template>
      </v-app-bar>

      <v-main>
        <v-container fluid class="app-content">
          <component :is="currentComponent" :revision="revision" />
        </v-container>
      </v-main>
    </template>

    <LoginView
      v-else-if="authenticated === false"
      v-model:token="token"
      v-model:remember="remember"
      :can-use-passkeys="canUsePasskeys"
      :passkey-registered="passkeyRegistered"
      :passkey-busy="passkeyBusy"
      :login-error="loginError"
      :language-name="languageName"
      :theme-icon="themeIcon"
      @login="login"
      @passkey-login="loginWithPasskey"
      @locale="setLocale"
      @theme="setThemeMode"
    />

    <v-main v-else class="login-page">
      <v-progress-circular indeterminate color="primary" />
    </v-main>

    <PasskeyManagerDialog
      v-model:open="passkeyDialog"
      v-model:name="passkeyName"
      :passkeys="passkeys"
      :busy="passkeyBusy"
      :error="passkeyError"
      @add="registerPasskey"
      @remove="removePasskey"
    />
  </v-app>
</template>
