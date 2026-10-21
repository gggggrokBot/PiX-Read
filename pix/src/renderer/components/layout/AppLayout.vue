<script setup lang="ts">
/**
 * AppLayout - Three-panel workspace shell
 *
 * Desktop: left | center | right with collapse.
 * Narrow (<960px): chat becomes an overlay.
 * Phone (<640px): left also overlays; a bottom nav switches library / notes / chat.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  leftTab?: "library" | "notes";
}>();

const emit = defineEmits<{
  "expand-right": [];
  "update:leftCollapsed": [value: boolean];
  "update:leftTab": [value: "library" | "notes"];
}>();

const NARROW_QUERY = "(max-width: 959px)";
const PHONE_QUERY = "(max-width: 639px)";
const narrow = ref(window.matchMedia(NARROW_QUERY).matches);
const phone = ref(window.matchMedia(PHONE_QUERY).matches);
const chatOpen = ref(false);
const libraryOpen = ref(false);

const chatVisible = computed(() => (narrow.value ? chatOpen.value : !props.rightCollapsed));
const leftVisible = computed(() => {
  if (phone.value) return libraryOpen.value;
  return !props.leftCollapsed;
});

function openChat(): void {
  if (phone.value) libraryOpen.value = false;
  if (narrow.value) chatOpen.value = true;
  else emit("expand-right");
}

function openLibrary(): void {
  chatOpen.value = false;
  if (phone.value) {
    libraryOpen.value = true;
    emit("update:leftTab", "library");
    return;
  }
  emit("update:leftCollapsed", false);
  emit("update:leftTab", "library");
}

function openNotes(): void {
  chatOpen.value = false;
  if (phone.value) {
    libraryOpen.value = true;
    emit("update:leftTab", "notes");
    return;
  }
  emit("update:leftCollapsed", false);
  emit("update:leftTab", "notes");
}

function focusReader(): void {
  chatOpen.value = false;
  libraryOpen.value = false;
  if (!phone.value) emit("update:leftCollapsed", true);
}

function onNarrowChange(event: MediaQueryListEvent): void {
  narrow.value = event.matches;
  if (!event.matches) chatOpen.value = false;
}

function onPhoneChange(event: MediaQueryListEvent): void {
  phone.value = event.matches;
  if (!event.matches) libraryOpen.value = false;
}

let narrowMq: MediaQueryList | null = null;
let phoneMq: MediaQueryList | null = null;

onMounted(() => {
  narrowMq = window.matchMedia(NARROW_QUERY);
  phoneMq = window.matchMedia(PHONE_QUERY);
  narrow.value = narrowMq.matches;
  phone.value = phoneMq.matches;
  narrowMq.addEventListener("change", onNarrowChange);
  phoneMq.addEventListener("change", onPhoneChange);
  if (phone.value) emit("update:leftCollapsed", true);
});

onBeforeUnmount(() => {
  narrowMq?.removeEventListener("change", onNarrowChange);
  phoneMq?.removeEventListener("change", onPhoneChange);
  narrowMq = null;
  phoneMq = null;
});

watch(
  () => props.leftCollapsed,
  (collapsed) => {
    if (phone.value && collapsed === false) libraryOpen.value = true;
    if (phone.value && collapsed === true) libraryOpen.value = false;
  },
);
</script>

<template>
  <div class="app-shell" :class="{ phone }">
    <div class="pix-drag-bar"></div>

    <div class="app-layout" :class="{ 'left-collapsed': !leftVisible && !phone, phone }">
      <aside
        v-show="leftVisible"
        class="layout-left"
        :class="{ 'left-overlay': phone }"
      >
        <div v-if="phone" class="panel-overlay-bar">
          <span class="panel-overlay-title">{{ leftTab === 'notes' ? '笔记' : '资料库' }}</span>
          <button
            type="button"
            class="panel-overlay-close"
            title="关闭"
            aria-label="关闭"
            @click="libraryOpen = false; emit('update:leftCollapsed', true)"
          >
            <v-icon size="16">mdi-close</v-icon>
          </button>
        </div>
        <slot name="left" />
      </aside>

      <main class="layout-center">
        <slot name="center" />
      </main>

      <aside v-show="chatVisible" class="layout-right" :class="{ 'chat-overlay': narrow }">
        <div v-if="narrow" class="chat-overlay-bar">
          <span class="chat-overlay-title">Agent 对话</span>
          <button
            type="button"
            class="chat-overlay-close"
            title="收起对话面板"
            aria-label="收起对话面板"
            @click="chatOpen = false"
          >
            <v-icon size="16">mdi-close</v-icon>
          </button>
        </div>
        <div class="chat-slot">
          <slot name="right" :narrow="narrow" :phone="phone" />
        </div>
      </aside>

      <button
        v-if="!chatVisible && !phone"
        type="button"
        class="chat-open-btn"
        title="打开对话面板"
        aria-label="打开对话面板"
        @click="openChat"
      >
        <v-icon size="16">mdi-chat-outline</v-icon>
        <span>对话</span>
      </button>

      <nav v-if="phone" class="phone-bottom-nav" aria-label="主导航">
        <button type="button" class="nav-item" :class="{ active: libraryOpen && leftTab === 'library' }" @click="openLibrary">
          <v-icon size="20">mdi-folder-outline</v-icon>
          <span>资料库</span>
        </button>
        <button type="button" class="nav-item" :class="{ active: !libraryOpen && !chatOpen }" @click="focusReader">
          <v-icon size="20">mdi-book-open-page-variant-outline</v-icon>
          <span>阅读</span>
        </button>
        <button type="button" class="nav-item" :class="{ active: chatOpen }" @click="openChat">
          <v-icon size="20">mdi-chat-outline</v-icon>
          <span>对话</span>
        </button>
        <button type="button" class="nav-item" :class="{ active: libraryOpen && leftTab === 'notes' }" @click="openNotes">
          <v-icon size="20">mdi-notebook-outline</v-icon>
          <span>笔记</span>
        </button>
      </nav>

      <slot name="overlay" />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--pix-bg-app);
}

.app-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  gap: 8px;
  padding: 4px 12px 10px 10px;
  background: var(--pix-bg-app);
}

.layout-left {
  width: var(--pix-left-width);
  min-width: var(--pix-left-width);
  background: var(--pix-bg-left);
  border: 1px solid var(--pix-border-light);
  border-radius: var(--pix-radius-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--pix-shadow-sm);
}

.layout-center {
  flex: 1;
  min-width: 0;
  background: var(--pix-bg-content);
  border: 1px solid var(--pix-border-light);
  border-radius: var(--pix-radius-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--pix-shadow-sm);
  position: relative;
  z-index: 1;
}

.layout-right {
  width: var(--pix-right-width);
  min-width: var(--pix-right-width);
  background: var(--pix-bg-right);
  border: 1px solid var(--pix-border-light);
  border-radius: var(--pix-radius-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--pix-shadow-sm);
}

.chat-slot {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.chat-overlay-bar,
.panel-overlay-bar {
  display: none;
}

.left-collapsed .layout-left {
  display: none;
}

.chat-open-btn {
  position: absolute;
  right: 26px;
  bottom: 22px;
  z-index: 15;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--pix-border-light);
  border-radius: 999px;
  background: var(--pix-bg-elevated);
  box-shadow: var(--pix-shadow-md);
  color: var(--pix-text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.chat-open-btn:hover {
  background: var(--pix-bg-hover);
}

.phone-bottom-nav {
  display: none;
}

@media (max-width: 959px) {
  .app-layout {
    gap: 6px;
    padding: 4px 8px 8px;
  }

  .layout-left {
    width: 220px;
    min-width: 220px;
  }

  .chat-open-btn {
    right: 14px;
  }

  .layout-right.chat-overlay {
    position: absolute;
    top: 4px;
    right: 8px;
    bottom: 8px;
    width: min(var(--pix-right-width), calc(100% - 16px));
    min-width: 0;
    z-index: 20;
    box-shadow: var(--pix-shadow-lg);
  }

  .chat-overlay-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--pix-border-light);
    flex-shrink: 0;
  }

  .chat-overlay-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--pix-text-secondary);
  }

  .chat-overlay-close,
  .panel-overlay-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--pix-text-secondary);
    cursor: pointer;
    padding: 0;
  }

  .chat-overlay-close:hover,
  .panel-overlay-close:hover {
    background: var(--pix-bg-hover);
    color: var(--pix-text-primary);
  }
}

@media (max-width: 639px) {
  .app-layout.phone {
    padding: 0;
    gap: 0;
    padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  }

  .layout-center {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }

  .layout-left.left-overlay,
  .layout-right.chat-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    min-width: 0;
    border-radius: 0;
    z-index: 25;
    bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  }

  .panel-overlay-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 10px 10px 14px;
    border-bottom: 1px solid var(--pix-border-light);
    flex-shrink: 0;
  }

  .panel-overlay-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--pix-text-primary);
  }

  .phone-bottom-nav {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    height: calc(56px + env(safe-area-inset-bottom, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--pix-bg-elevated, #fff);
    border-top: 1px solid var(--pix-border-light);
  }

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: none;
    background: transparent;
    color: var(--pix-text-secondary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .nav-item.active {
    color: var(--pix-accent, #31424f);
  }
}

:global(html.pix-capacitor) .pix-drag-bar,
:global([data-pix-platform="browser"]) .pix-drag-bar,
:global([data-pix-platform="capacitor"]) .pix-drag-bar {
  display: none;
}

:global(html.pix-capacitor),
:global([data-pix-platform="capacitor"]) {
  padding-top: env(safe-area-inset-top, 0px);
}
</style>
