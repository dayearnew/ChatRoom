<script setup lang="ts">
import { useLocale } from "vuetify";

interface PasskeySummary {
  id: string;
  name: string;
  lastUsedAt: string;
}

defineProps<{ passkeys: PasskeySummary[]; busy: boolean; error: string }>();
const emit = defineEmits<{ add: []; remove: [id: string] }>();
const open = defineModel<boolean>("open", { required: true });
const name = defineModel<string>("name", { required: true });
const locale = useLocale();
</script>

<template>
  <v-dialog v-model="open" max-width="560">
    <v-card class="passkey-dialog">
      <div class="panel-header">
        <div>
          <div class="panel-title">
            {{ locale.t("$vuetify.chatroom.auth.passkeys") }}
          </div>
          <div class="panel-subtitle">
            {{ locale.t("$vuetify.chatroom.auth.passkeyDescription") }}
          </div>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          @click="open = false"
        />
      </div>
      <v-divider />
      <v-card-text class="passkey-dialog-content">
        <div class="passkey-register-row">
          <v-text-field
            v-model="name"
            :label="locale.t('$vuetify.chatroom.auth.passkeyName')"
            prepend-inner-icon="mdi-laptop"
          />
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-fingerprint"
            :loading="busy"
            @click="emit('add')"
          >
            {{ locale.t("$vuetify.chatroom.auth.addPasskey") }}
          </v-btn>
        </div>
        <v-alert
          v-if="error"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-3"
        >
          {{ error }}
        </v-alert>
        <div v-if="passkeys.length" class="passkey-list">
          <div v-for="item in passkeys" :key="item.id" class="passkey-row">
            <v-icon icon="mdi-fingerprint" size="20" />
            <div class="passkey-row-main">
              <div class="font-weight-medium">{{ item.name }}</div>
              <div class="text-caption muted">
                {{ locale.t("$vuetify.chatroom.auth.lastUsed") }} ·
                {{ new Date(item.lastUsedAt).toLocaleString() }}
              </div>
            </div>
            <v-btn
              icon="mdi-delete-outline"
              variant="text"
              size="small"
              :aria-label="locale.t('$vuetify.chatroom.auth.removePasskey')"
              @click="emit('remove', item.id)"
            />
          </div>
        </div>
        <div v-else class="empty-inline">
          {{ locale.t("$vuetify.chatroom.auth.noPasskeys") }}
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
