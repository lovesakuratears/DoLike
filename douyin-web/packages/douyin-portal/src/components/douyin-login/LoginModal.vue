<script setup lang="ts">
import BridgePanel from './BridgePanel.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'bound', accountId: number): void
}>()

const handleIssued = (id: number) => {
  emit('bound', id)
}
</script>

<template>
  <el-dialog
    :model-value="props.modelValue"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    title="绑定浏览器插件"
    width="560px"
    :close-on-click-modal="false"
  >
    <BridgePanel @issued="handleIssued" />
  </el-dialog>
</template>
