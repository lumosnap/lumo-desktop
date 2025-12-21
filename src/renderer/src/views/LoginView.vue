<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AuthLayout from '../layouts/AuthLayout.vue'
import Input from '../components/ui/Input.vue'
import Button from '../components/ui/Button.vue'

const router = useRouter()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  loading.value = true
  error.value = ''

  try {
    await authStore.login({ email: email.value, password: password.value })
    router.push('/albums')
  } catch (e: any) {
    error.value = e.message || 'Failed to login'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-white mb-2">Welcome Back</h1>
      <p class="text-gray-400">Sign in to manage your albums</p>
    </div>

    <form @submit.prevent="handleLogin" class="space-y-6">
      <Input
        v-model="email"
        type="email"
        label="Email Address"
        placeholder="you@example.com"
        :error="error && !email ? 'Email is required' : ''"
      />

      <Input v-model="password" type="password" label="Password" placeholder="••••••••" />

      <div
        v-if="error"
        class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center"
      >
        {{ error }}
      </div>

      <Button type="submit" variant="primary" class="w-full" :loading="loading"> Sign In </Button>

      <div class="text-center mt-6">
        <p class="text-sm text-gray-400">
          Don't have an account?
          <router-link
            to="/signup"
            class="text-[#2DD4BF] hover:text-[#14B8A6] font-medium transition-colors"
          >
            Create account
          </router-link>
        </p>
      </div>
    </form>
  </AuthLayout>
</template>
