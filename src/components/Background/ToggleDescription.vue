<template>
  <div>
    <button
      @click="toggle"
      class="group inline-flex items-center gap-1 text-sm text-primary-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
      :aria-expanded="open.toString()"
      :aria-controls="contentId"
    >
      <span>{{ open ? 'Show less' : 'Show more' }}</span>
      <ChevronDown
        :class="[
          'size-4 transition-transform duration-300',
          open ? 'rotate-180' : ''
        ]"
      />
    </button>

    <!-- v-show, not v-if: a closed v-if leaves an empty comment in the server HTML that the minifier
         strips, and Vue then reports a hydration mismatch. This also keeps every description in the HTML. -->
    <transition name="accordion">
      <div
        v-show="open"
        :id="contentId"
        class="mt-2 description text-pretty overflow-hidden"
      >
        <slot />
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ChevronDown from '@components/Icons/ChevronDown.vue'

const props = defineProps({
  initialOpen: {
    type: Boolean,
    default: false,
  },
  // Given by the parent so the server-rendered markup and the hydrated one agree.
  contentId: {
    type: String,
    required: true,
  },
})

const open = ref(props.initialOpen)
const contentId = props.contentId

const toggle = () => {
  open.value = !open.value
}
</script>

<style scoped>
.accordion-enter-active,
.accordion-leave-active {
  transition: max-height 0.3s ease;
}
.accordion-enter-from,
.accordion-leave-to {
  max-height: 0;
}
.accordion-enter-to,
.accordion-leave-from {
  max-height: 500px;
}
.rotate-180 {
  transform: rotate(180deg);
}
</style>
