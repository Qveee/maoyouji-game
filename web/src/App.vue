<script setup lang="ts">
import { onMounted, ref } from "vue";

const dbState = ref("检测中…");

onMounted(async () => {
  try {
    const res = await fetch("/api/health");
    const data = (await res.json()) as { db: string };
    dbState.value = data.db;
  } catch {
    dbState.value = "无法连接后端";
  }
});
</script>

<template>
  <main class="boot">
    <h1>喵游记</h1>
    <p>后端状态：{{ dbState }}</p>
  </main>
</template>

<style scoped>
.boot {
  font-family: "Microsoft YaHei", "SimSun", sans-serif;
  color: #14506e;
}
</style>
