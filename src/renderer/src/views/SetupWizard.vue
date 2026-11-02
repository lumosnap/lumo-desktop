<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AuthSignIn from '../components/AuthSignIn.vue'
import AuthFrame from '../components/AuthFrame.vue'

const router = useRouter()
const authStore = useAuthStore()
const step = ref(1)
</script>

<template>
  <div class="auth">
    <AuthFrame />
    <div class="auth-body">
      <div class="mark"><img src="../assets/logo.png" alt="" />LumoSnap</div>
      <div class="steps-bar" :aria-label="`Step ${step} of 3`">
        <span v-for="n in 3" :key="n" :class="{ on: n <= step }"></span>
      </div>

      <template v-if="step === 1">
        <div class="label">Step 1 of 3</div>
        <h1>Your shoots, in your client's hands</h1>
        <p class="lede">
          Put a folder of edited photos on this computer. LumoSnap compresses them, uploads them,
          and gives you one private link for the client.
        </p>
        <div class="act"><button class="btn primary" @click="step = 2">Get started</button></div>
      </template>

      <template v-else-if="step === 2">
        <div class="label">Step 2 of 3</div>
        <h1>Sign in to your account</h1>
        <p class="lede">
          Your browser opens to sign in with Google. Albums and settings stay with this account, on
          any computer.
        </p>
        <AuthSignIn @done="step = 3" />
      </template>

      <template v-else>
        <div class="label">Step 3 of 3</div>
        <h1>You're set</h1>
        <p class="lede">
          Signed in as {{ authStore.user?.email }}. Your first album starts with any folder of
          photos.
        </p>
        <div class="act">
          <button class="btn primary" @click="router.push('/albums')">Open LumoSnap</button>
        </div>
      </template>
    </div>
  </div>
</template>

