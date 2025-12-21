<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AuthLayout from '../layouts/AuthLayout.vue'
import Input from '../components/ui/Input.vue'
import Button from '../components/ui/Button.vue'

const router = useRouter()
const authStore = useAuthStore()

const name = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const handleSignup = async () => {
  loading.value = true
  error.value = ''

  try {
    await authStore.signup({ name: name.value, email: email.value, password: password.value })
    router.push('/albums')
  } catch (e: any) {
    error.value = e.message || 'Failed to create account'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-white mb-2">Create Account</h1>
      <p class="text-gray-400">Join LumoSnap to share your work</p>
    </div>

    <form @submit.prevent="handleSignup" class="space-y-6">
      <Input v-model="name" label="Full Name" placeholder="John Doe" />

      <Input v-model="email" type="email" label="Email Address" placeholder="you@example.com" />

      <Input v-model="password" type="password" label="Password" placeholder="••••••••" />

      <div
        v-if="error"
        class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center"
      >
        {{ error }}
      </div>

      <Button type="submit" variant="primary" class="w-full" :loading="loading">
        Create Account
      </Button>

      <div class="text-center mt-6">
        <p class="text-sm text-gray-400">
          Already have an account?
          <router-link
            to="/login"
            class="text-[#2DD4BF] hover:text-[#14B8A6] font-medium transition-colors"
          >
            Sign in
          </router-link>
        </p>
      </div>
    </form>
  </AuthLayout>
</template>
