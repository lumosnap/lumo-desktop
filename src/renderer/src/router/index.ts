import { createRouter, createWebHashHistory } from 'vue-router'
import AlbumView from '../views/AlbumView.vue'
import ImagesView from '../views/ImagesView.vue'
import LoginView from '../views/LoginView.vue'
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
      meta: { guestOnly: true }
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

  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  const guestOnly = to.matched.some((record) => record.meta.guestOnly)

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
