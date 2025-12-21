import { createRouter, createWebHashHistory } from 'vue-router'
import AlbumView from '../views/AlbumView.vue'
import ImagesView from '../views/ImagesView.vue'
import LoginView from '../views/LoginView.vue'
import SignupView from '../views/SignupView.vue'
import ProfileView from '../views/ProfileView.vue'
import SetupView from '../views/SetupView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/albums'
    },
    {
      path: '/setup',
      name: 'setup',
      component: SetupView,
      meta: { requiresAuth: false, skipConfigCheck: true }
    },
    {
      path: '/albums',
      name: 'albums',
      component: AlbumView,
      meta: { requiresAuth: true }
    },
    {
      path: '/albums/:id',
      name: 'images',
      component: ImagesView,
      meta: { requiresAuth: true }
    },
    {
      path: '/profile',
      name: 'profile',
      component: ProfileView,
      meta: { requiresAuth: true }
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { guestOnly: true, skipConfigCheck: true }
    },
    {
      path: '/signup',
      name: 'signup',
      component: SignupView,
      meta: { guestOnly: true, skipConfigCheck: true }
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

  // Check session on first navigation
  if (!authStore.user && localStorage.getItem('lumo_token')) {
    authStore.checkSession()
  }

  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  const guestOnly = to.matched.some((record) => record.meta.guestOnly)
  const skipConfigCheck = to.matched.some((record) => record.meta.skipConfigCheck)

  // Check if app is configured (unless route skips config check)
  if (!skipConfigCheck && window.api) {
    try {
      const isConfigured = await window.api.config.isConfigured()
      if (!isConfigured && to.path !== '/setup') {
        next('/setup')
        return
      }
    } catch (error) {
      console.error('Failed to check configuration:', error)
    }
  }

  if (requiresAuth && !authStore.isAuthenticated) {
    // Redirect to login if trying to access protected route
    next('/login')
  } else if (guestOnly && authStore.isAuthenticated) {
    // Redirect to albums if already logged in and trying to access login/signup
    next('/albums')
  } else {
    next()
  }
})

export default router
