<template>
  <!-- Top right on every app page: the account's initials; the menu under it holds Settings and Log out -->
  <div ref="root" class="account" @keydown.esc="close(true)">
    <button
      ref="button" type="button" class="avatar" :class="{ open }"
      aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? 'account-menu' : undefined"
      :aria-label="me?.email ? `${m.account.menu}, ${me.email}` : m.account.menu"
      @click="toggle"
    >{{ letters }}</button>
    <Transition name="menu">
      <div v-if="open" id="account-menu" ref="menu" class="menu" role="menu" :aria-label="m.account.menu" @keydown="arrows">
        <p v-if="me?.email" class="who">{{ me.email }}</p>
        <NuxtLink to="/settings" role="menuitem" class="item" @click="close()">
          <AppIcon name="gear" />{{ m.account.settings }}
        </NuxtLink>
        <button type="button" role="menuitem" class="item" :disabled="busy" @click="logOut">
          <AppIcon name="logout" />{{ m.account.logOut }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
const { me } = useAuth()
const { m } = useLocale()
const logout = useLogout()
const route = useRoute()

const open = ref(false)
const busy = ref(false)
const root = ref<HTMLElement>()
const button = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const letters = computed(() => initials(me.value?.email))

const items = () => [...(menu.value?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]

async function toggle(e: MouseEvent) {
  open.value = !open.value
  // Opened from the keyboard: focus moves into the menu, as a menu button should
  if (open.value && e.detail === 0) {
    await nextTick()
    items()[0]?.focus()
  }
}

function close(refocus = false) {
  if (!open.value) return
  open.value = false
  if (refocus) button.value?.focus()
}

/** Up and down move between the items, Home and End to the first and last */
function arrows(e: KeyboardEvent) {
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key]
  if (to === undefined) return
  e.preventDefault()
  list[(to + list.length) % list.length]?.focus()
}

async function logOut() {
  busy.value = true
  try {
    await logout()
  } finally {
    busy.value = false
    open.value = false
  }
}

// A tap anywhere else, or another page, closes it
function outside(e: PointerEvent) {
  if (open.value && !root.value?.contains(e.target as Node)) close()
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
watch(() => route.fullPath, () => close())
</script>

<style scoped>
.account {
  position: absolute; z-index: 30;
  /* Level with the page title: centred on the first line of each page */
  top: calc(env(safe-area-inset-top) + 30px);
  right: calc(max(0px, (100% - 640px) / 2) + 16px);
}
.avatar {
  width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--text); color: var(--bg);
  font: 650 13px/1 var(--font); font-stretch: 112%; letter-spacing: 0.04em;
  transition: transform var(--dur-1) var(--ease-out), box-shadow var(--dur-2) var(--ease-out), background-color 1.2s, color 1.2s;
}
.avatar:hover { background: var(--text); box-shadow: 0 0 0 4px var(--fill); }
.avatar.open { box-shadow: 0 0 0 4px var(--fill); }
.avatar:active { transform: scale(0.92); }
.avatar:focus-visible { outline-offset: 3px; border-radius: 50%; }

.menu {
  position: absolute; top: calc(100% + 8px); right: 0;
  min-width: 232px; max-width: calc(100vw - 32px); padding: 6px;
  background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius);
  box-shadow: 0 12px 32px -12px rgba(11, 19, 43, 0.28), 0 2px 6px rgba(11, 19, 43, 0.06);
  transform-origin: top right;
}
.who {
  margin: 0; padding: 8px 10px 10px; border-bottom: 1px solid var(--rule); margin-bottom: 4px;
  font-size: 13px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px; border: 0; border-radius: var(--radius-sm); background: none;
  color: var(--text); font: 500 15px/1.2 var(--font); text-align: left; text-decoration: none;
  transition: background-color var(--dur-1);
}
.item svg { width: 18px; height: 18px; color: var(--text-2); flex: none; }
.item:hover, .item:focus-visible { background: var(--fill-2); outline: none; }
.item:active { transform: none; background: var(--fill); }

/* Opens from the button: a short drop and scale up from its corner; closes faster than it opens */
.menu-enter-active { transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-3) var(--ease-out); }
.menu-leave-active { transition: opacity var(--dur-1) ease-in, transform var(--dur-1) ease-in; }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-4px) scale(0.96); }

@media (min-width: 720px) {
  .account { top: calc(env(safe-area-inset-top) + 37px); right: calc(max(0px, (100% - 680px) / 2) + 16px); }
}
@media (min-width: 1024px) {
  /* Its own line above the page, level with the rail's logo: page columns start right at the top here */
  .account { top: calc(env(safe-area-inset-top) + 24px); right: max(var(--gutter), (100% - var(--rail) - var(--page)) / 2); }
}
</style>
