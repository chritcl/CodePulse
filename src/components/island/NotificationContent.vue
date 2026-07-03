<template>
  <div class="msg-box" style="cursor: pointer" @click="$emit('msg-click')">
    <div class="msg-avatar">
      <img :src="msgIcon" alt="消息图标" class="msg-avatar-img" />
    </div>
    <div class="msg-text-wrapper">
      <div class="msg-title">
        {{ msgTitle }}
      </div>
      <div class="msg-body">
        {{ msgBody }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  msgIcon: string;
  msgTitle: string;
  msgBody: string;
}

defineProps<Props>();

defineEmits<{
  'msg-click': [];
}>();
</script>

<style scoped>
.msg-box {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
  max-width: 300px;
}

.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.1);
}

.msg-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.msg-text-wrapper {
  flex: 1;
  overflow: hidden;
}

.msg-title {
  font-size: 11px;
  font-weight: 600;
  color: currentColor;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msg-body {
  font-size: 10px;
  color: currentColor;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
</style>
