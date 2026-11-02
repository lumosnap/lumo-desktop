<script setup lang="ts">
// a client gallery: one wide frame, then portraits and landscapes, as an edited set mixes them
const tiles = [
  [302, 126, 86, 40],
  [302, 172, 39, 52],
  [349, 172, 39, 52],
  [302, 230, 39, 34],
  [349, 230, 39, 34]
]
// each pair of tiles shows as a travelling frame reaches the end of the route bar
const landAt = [1.25, 1.35, 1.6, 1.7, 1.95]
</script>

<!--
  The left side of sign-in and setup: the whole job in one drawing. A folder of photos, the route
  bar filling as frames travel, the client's link opening on a phone, one frame hearted.
  Plays once and settles on the finished frame (also the reduced-motion frame); styles in main.css.
-->
<template>
  <figure class="auth-frame" aria-hidden="true">
    <svg viewBox="20 43 400 280" role="presentation">
      <!-- folder of edited photos -->
      <rect x="40" y="140" width="46" height="24" rx="6" class="af-back" />
      <rect x="40" y="150" width="120" height="98" rx="10" class="af-back" />
      <g class="af-print" transform="rotate(-7 82 160)">
        <rect x="52" y="128" width="62" height="46" rx="4" />
        <rect x="57" y="133" width="52" height="36" rx="2" class="af-img" />
        <circle cx="98" cy="142" r="4" class="af-scene" />
        <path d="M57 169 75 152l11 8 9-6 14 12v3Z" class="af-scene" />
      </g>
      <g class="af-print" transform="rotate(5 112 158)">
        <rect x="82" y="124" width="62" height="46" rx="4" />
        <rect x="87" y="129" width="52" height="36" rx="2" class="af-img" />
        <circle cx="128" cy="138" r="4" class="af-scene" />
        <path d="M87 165 103 147l12 11 9-7 15 12v2Z" class="af-scene" />
      </g>
      <rect x="40" y="174" width="120" height="74" rx="10" class="af-front" />

      <!-- route bar: compressed and uploaded -->
      <circle cx="178" cy="196" r="4" class="af-end" />
      <circle cx="270" cy="196" r="4" class="af-end" />
      <rect x="186" y="193" width="76" height="6" rx="3" class="af-track" />
      <rect x="186" y="193" width="76" height="6" rx="3" class="af-fill" />
      <rect
        v-for="n in 3"
        :key="n"
        x="176"
        y="172"
        width="20"
        height="15"
        rx="3"
        class="af-fly"
        :style="{ animationDelay: `${0.05 + n * 0.35}s` }"
      />

      <!-- the client's phone, opened from the one private link -->
      <rect x="290" y="90" width="110" height="186" rx="20" class="af-phone" />
      <rect x="312" y="104" width="66" height="14" rx="7" class="af-url" />
      <rect x="322" y="110" width="40" height="2" rx="1" class="af-link" />
      <rect
        v-for="(t, i) in tiles"
        :key="i"
        :x="t[0]"
        :y="t[1]"
        :width="t[2]"
        :height="t[3]"
        rx="4"
        :class="['af-tile', { alt: i === 1 || i === 4 }]"
        :style="{ animationDelay: `${landAt[i]}s` }"
      />
      <g transform="translate(374 186)">
        <g class="af-heart">
          <circle r="13" />
          <path
            transform="scale(1.5)"
            d="M0 3.4C-3.8.7-4.8-1.4-3.6-3-2.5-4.2-.8-3.9 0-2.5.8-3.9 2.5-4.2 3.6-3 4.8-1.4 3.8.7 0 3.4Z"
          />
        </g>
      </g>
    </svg>
  </figure>
</template>
