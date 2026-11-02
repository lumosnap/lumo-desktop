<script setup lang="ts">
import { useRouter } from 'vue-router'
import AuthSignIn from '../components/AuthSignIn.vue'
import AuthFrame from '../components/AuthFrame.vue'

const router = useRouter()
</script>

<template>
  <div class="auth">
    <AuthFrame />
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

