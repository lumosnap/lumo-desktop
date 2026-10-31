<script setup lang="ts">
import { useRouter } from 'vue-router'
import AuthSignIn from '../components/AuthSignIn.vue'

const router = useRouter()
</script>

<template>
  <div class="auth">
    <!-- no photos before sign-in, so the contact sheet is blank frames -->
    <div class="sheet" aria-hidden="true"><span v-for="i in 12" :key="i"></span></div>
    <div class="auth-body">
      <div class="mark"><img src="../assets/logo.png" alt="" />LumoSnap</div>
      <div class="label">Welcome back</div>
      <h1>Sign in again</h1>
      <p class="lede">
        You were signed out on this computer. Your albums and uploads pick up where they stopped.
      </p>
      <AuthSignIn @done="router.push('/albums')" />
    </div>
  </div>
</template>

<style scoped>
.sheet span {
  background: var(--inset);
  border-radius: 8px;
  min-height: 0;
}
</style>
