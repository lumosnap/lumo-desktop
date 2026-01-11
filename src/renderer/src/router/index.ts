import { createRouter, createWebHashHistory } from 'vue-router'
import AlbumView from '../views/AlbumView.vue'
import ImagesView from '../views/ImagesView.vue'
import LoginView from '../views/LoginView.vue'
import SetupWizard from '../views/SetupWizard.vue'
import ProfileView from '../views/ProfileView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/albums'
    },
    {
      path: '/albums',
      name: 'albums',
      component: AlbumView,
      meta: { requiresAuth: true, requiresSetup: true }
    },
    {
      path: '/albums/:id',
      name: 'images',
      component: ImagesView,
      meta: { requiresAuth: true, requiresSetup: true }
    },
    {
      path: '/profile',
      name: 'profile',
      component: ProfileView,
      meta: { requiresAuth: true, requiresSetup: true }
    },
    {
      path: '/bookings',
      name: 'bookings',
      component: () => import('../views/BookingsView.vue'),
      meta: { requiresAuth: true, requiresSetup: true }
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { guestOnly: true }
    },
    {
      path: '/setup',
      name: 'setup',
      component: SetupWizard,
      meta: { setupOnly: true }
    },
    {
      path: '/billing',
      redirect: '/profile'
    }
  ]
})

// Navigation guard
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore()

  // Check stored auth on first navigation
  if (!authStore.user) {
    await authStore.checkSession()
  }

  // Check if master folder is configured (setup complete)
  let isSetupComplete = false
  try {
    const masterFolder = await window.api.config.getMasterFolder()
    isSetupComplete = !!masterFolder
  } catch {
    isSetupComplete = false
  }

  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  const requiresSetup = to.matched.some((record) => record.meta.requiresSetup)
  const guestOnly = to.matched.some((record) => record.meta.guestOnly)
  const setupOnly = to.matched.some((record) => record.meta.setupOnly)

  // First-time user: redirect to setup wizard
  if (requiresAuth && requiresSetup && !isSetupComplete && !authStore.isAuthenticated) {
    next('/setup')
  }
  // Authenticated but setup not complete: redirect to setup
  else if (requiresSetup && authStore.isAuthenticated && !isSetupComplete) {
    next('/setup')
  }
  // Setup page but already completed: redirect to albums
  else if (setupOnly && isSetupComplete && authStore.isAuthenticated) {
    next('/albums')
  }
  // Protected route without auth: redirect to login
  else if (requiresAuth && !authStore.isAuthenticated) {
    next('/login')
  }
  // Guest-only route with auth: redirect to albums
  else if (guestOnly && authStore.isAuthenticated) {
    next('/albums')
  } else {
    next()
  }
})

export default router
