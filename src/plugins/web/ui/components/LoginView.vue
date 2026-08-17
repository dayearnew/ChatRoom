<script setup lang="ts">
import { useLocale } from "vuetify";
import type { AppLocale } from "../locales.js";

defineProps<{
  canUsePasskeys: boolean;
  passkeyRegistered: boolean;
  passkeyBusy: boolean;
  loginError: string;
  languageName: string;
  themeIcon: string;
}>();
const emit = defineEmits<{
  login: [];
  passkeyLogin: [];
  locale: [value: AppLocale];
  theme: [value: "system" | "light" | "dark"];
}>();
const token = defineModel<string>("token", { required: true });
const remember = defineModel<boolean>("remember", { required: true });
const locale = useLocale();
</script>

<template>
  <v-main class="login-page">
    <div class="login-utilities">
      <v-menu>
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            prepend-icon="mdi-translate"
            variant="text"
            size="small"
          >
            {{ languageName }}
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item title="简体中文" @click="emit('locale', 'zhHans')" />
          <v-list-item title="English" @click="emit('locale', 'en')" />
        </v-list>
      </v-menu>
      <v-menu>
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            :icon="themeIcon"
            variant="text"
            size="small"
          />
        </template>
        <v-list density="compact">
          <v-list-item
            :title="locale.t('$vuetify.chatroom.theme.system')"
            @click="emit('theme', 'system')"
          />
          <v-list-item
            :title="locale.t('$vuetify.chatroom.theme.light')"
            @click="emit('theme', 'light')"
          />
          <v-list-item
            :title="locale.t('$vuetify.chatroom.theme.dark')"
            @click="emit('theme', 'dark')"
          />
        </v-list>
      </v-menu>
    </div>

    <v-card class="login-card">
      <v-card-text class="login-card-content">
        <div class="login-brand">
          <div class="brand-mark brand-mark-large">C</div>
          <div>
            <div class="text-h6 font-weight-bold">ChatRoom</div>
            <div class="text-body-2 muted">
              {{ locale.t("$vuetify.chatroom.auth.ownerAccess") }}
            </div>
          </div>
        </div>

        <template v-if="canUsePasskeys && passkeyRegistered">
          <v-btn
            block
            size="large"
            variant="tonal"
            prepend-icon="mdi-fingerprint"
            :loading="passkeyBusy"
            @click="emit('passkeyLogin')"
          >
            {{ locale.t("$vuetify.chatroom.auth.signInWithPasskey") }}
          </v-btn>
          <div class="login-divider">
            <span>{{ locale.t("$vuetify.chatroom.auth.orToken") }}</span>
          </div>
        </template>

        <v-text-field
          v-model="token"
          type="password"
          :label="locale.t('$vuetify.chatroom.auth.ownerToken')"
          prepend-inner-icon="mdi-key-outline"
          autocomplete="current-password"
          @keyup.enter="emit('login')"
        />
        <v-checkbox
          v-model="remember"
          density="compact"
          hide-details
          :label="locale.t('$vuetify.chatroom.auth.rememberDevice')"
          class="remember-device"
        />
        <v-alert
          v-if="loginError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          {{ loginError }}
        </v-alert>
        <v-btn
          color="primary"
          variant="flat"
          block
          size="large"
          class="mt-5"
          :disabled="!token"
          @click="emit('login')"
        >
          {{ locale.t("$vuetify.chatroom.auth.signIn") }}
        </v-btn>
      </v-card-text>
    </v-card>
  </v-main>
</template>
