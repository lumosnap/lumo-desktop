/**
 * Auth Handler for LumoSnap Desktop
 *
 * Simplified flow:
 * 1. Start local HTTP server on random port
 * 2. Open browser to AUTH_URL with callback parameter
 * 3. Receive token at callback endpoint
 * 4. Store token securely and return result
 */

import { shell } from 'electron'
import http from 'http'
import { saveAuth, StoredUser } from './auth-storage'

export interface AuthResult {
  success: boolean
  user?: StoredUser
  error?: string
}

/**
 * Find an available port for the callback server
 */
async function findAvailablePort(startPort: number = 9876): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.listen(startPort, () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        server.close(() => resolve(address.port))
      } else {
        server.close(() => reject(new Error('Could not get server address')))
      }
    })
    server.on('error', () => {
      // Port in use, try next
      resolve(findAvailablePort(startPort + 1))
    })
  })
}

/**
 * Start the authentication flow
 *
 * Opens browser to auth URL, waits for callback with token
 */
export async function startAuth(): Promise<AuthResult> {
  const authUrl = process.env.AUTH_URL || 'https://lumosnap.app/auth/desktop'

  let server: http.Server | null = null
  let timeoutId: NodeJS.Timeout | null = null

  const cleanup = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (server) {
      server.close()
      server = null
    }
  }

  try {
    // Find available port
    const port = await findAvailablePort()
    const callbackUrl = `http://localhost:${port}/auth/callback`

    console.log(`[Auth] Starting auth flow with callback: ${callbackUrl}`)

    return new Promise((resolve) => {
      // Create local server to receive the callback
      server = http.createServer((req, res) => {
        try {
          const url = new URL(req.url || '', `http://localhost:${port}`)

          // Handle callback
          if (url.pathname === '/auth/callback') {
            const token = url.searchParams.get('token')
            const userParam = url.searchParams.get('user')
            const error = url.searchParams.get('error')

            if (error) {
              console.error('[Auth] Auth error:', error)
              res.writeHead(200, { 'Content-Type': 'text/html' })
              res.end(getErrorPage(error))
              cleanup()
              resolve({ success: false, error })
              return
            }

            if (token && userParam) {
              try {
                // Decode user data (base64 encoded JSON)
                const userJson = Buffer.from(userParam, 'base64').toString('utf-8')
                const user = JSON.parse(userJson) as StoredUser

                console.log('[Auth] Received auth callback')
                console.log('[Auth] User:', user.email)

                // Store auth data securely
                saveAuth(token, user)

                // Send success response
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end(getSuccessPage())
                cleanup()
                resolve({ success: true, user })
              } catch (parseError) {
                console.error('[Auth] Failed to parse user data:', parseError)
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end(getErrorPage('Invalid user data'))
                cleanup()
                resolve({ success: false, error: 'Failed to parse user data' })
              }
              return
            }

            // Missing required params
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(getErrorPage('Missing token or user data'))
            cleanup()
            resolve({ success: false, error: 'Missing token or user data' })
            return
          }

          // Ignore other requests (favicon, etc)
          res.writeHead(200)
          res.end()
        } catch (err) {
          console.error('[Auth] Server request error:', err)
          res.writeHead(500)
          res.end('Internal error')
        }
      })

      server.listen(port, () => {
        console.log(`[Auth] Callback server listening on port ${port}`)

        // Build auth URL with callback
        const fullAuthUrl = new URL(authUrl)
        fullAuthUrl.searchParams.set('callback', callbackUrl)

        // Open system browser
        shell.openExternal(fullAuthUrl.toString())
      })

      // Timeout after 5 minutes
      timeoutId = setTimeout(
        () => {
          console.log('[Auth] Auth timed out')
          cleanup()
          resolve({ success: false, error: 'Authentication timed out' })
        },
        5 * 60 * 1000
      )
    })
  } catch (err) {
    console.error('[Auth] Failed to start auth:', err)
    cleanup()
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to start auth'
    }
  }
}

/**
 * Success page HTML
 */
function getSuccessPage(): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Login Successful</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #fff;
          }
          .container {
            text-align: center;
            padding: 2rem;
          }
          .icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #2dd4bf 0%, #14b8a6 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.5rem;
            font-size: 2.5rem;
          }
          h1 {
            margin: 0 0 0.5rem;
            font-size: 1.5rem;
            color: #2dd4bf;
          }
          p {
            margin: 0;
            color: #94a3b8;
            font-size: 1rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">✓</div>
          <h1>Login Successful</h1>
          <p>You can close this window and return to LumoSnap.</p>
        </div>
      </body>
    </html>
  `
}

/**
 * Error page HTML
 */
function getErrorPage(error: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Login Failed</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #fff;
          }
          .container {
            text-align: center;
            padding: 2rem;
          }
          .icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.5rem;
            font-size: 2.5rem;
          }
          h1 {
            margin: 0 0 0.5rem;
            font-size: 1.5rem;
            color: #ef4444;
          }
          p {
            margin: 0;
            color: #94a3b8;
            font-size: 1rem;
          }
          .error {
            margin-top: 1rem;
            padding: 0.75rem 1rem;
            background: rgba(239, 68, 68, 0.1);
            border-radius: 0.5rem;
            color: #fca5a5;
            font-size: 0.875rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">✕</div>
          <h1>Login Failed</h1>
          <p>You can close this window.</p>
          <div class="error">${error}</div>
        </div>
      </body>
    </html>
  `
}
