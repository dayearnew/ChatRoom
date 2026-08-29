<script setup lang="ts">
import ComputerOperations from "./ComputerOperations.vue";
import ComputerPreview from "./ComputerPreview.vue";
import ComputerStatus from "./ComputerStatus.vue";
import { useComputer } from "../composables/useComputer.js";

const props = defineProps<{ revision: number }>();
const computer = useComputer(() => props.revision);
</script>

<template>
  <div class="computer-view">
    <v-alert v-if="computer.error.value" type="error" variant="tonal">
      {{ computer.error.value }}
    </v-alert>

    <ComputerPreview
      :preview="computer.preview.value"
      :enabled="computer.status.value?.settings.enabled ?? false"
      :busy="computer.snapshotBusy.value"
      :remote-preview-blocked="computer.remotePreviewBlocked.value"
      @refresh="computer.refreshSnapshot"
    />

    <ComputerOperations
      :operations="computer.operations.value"
      :busy="computer.operationsBusy.value"
      @refresh="computer.refreshOperations"
    />

    <ComputerStatus
      :status="computer.status.value"
      :settings-busy="computer.settingsBusy.value"
      :permission-busy="computer.permissionBusy.value"
      :permission-requests-allowed="computer.permissionRequestsAllowed.value"
      @update-setting="computer.updateSetting"
      @request-permission="computer.requestPermission"
    />
  </div>
</template>

<style scoped>
.computer-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 14px;
}
</style>
