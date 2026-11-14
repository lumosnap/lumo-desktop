<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import AuthSignIn from '../components/AuthSignIn.vue'
import AuthFrame from '../components/AuthFrame.vue'

const router = useRouter()
const route = useRoute()
</script>

<template>
  <div class="auth">
    <AuthFrame />
    <div class="auth-body">
      <div class="mark"><img src="../assets/logo.png" alt="" />LumoSnap</div>
      <div class="label">Welcome back</div>
      <h1>Sign in again</h1>
      <p class="lede">
        {{
          route.query.expired
            ? 'Your sign-in expired. Sign in again to keep syncing.'
            : 'You were signed out on this computer.'
        }}
        Your albums and uploads pick up where they stopped.
      </p>
      <AuthSignIn @done="router.push('/albums')" />
    </div>
  </div>
</template>
