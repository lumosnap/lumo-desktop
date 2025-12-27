import { shell } from 'electron'
import http from 'http'

export interface OAuthResult {
  success: boolean
  user?: {
    id: string
    email: string
    name: string
    image?: string
  }
  session?: {
    token: string
  }
  error?: string
}

// Find an available port for the OAuth callback server
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

export async function startGoogleOAuth(
  clientId: string,
  backendUrl: string
): Promise<OAuthResult> {
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
    const redirectUri = `http://localhost:${port}`

    console.log(`[OAuth] Starting OAuth flow with redirect URI: ${redirectUri}`)

    // Build Google OAuth URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'openid email profile')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')

    return new Promise((resolve) => {
      // Create local server to capture the auth code
      server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '', redirectUri)
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (error) {
            console.error('[OAuth] Auth error:', error)
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(`
              <html>
                <head><title>Login Failed</title></head>
                <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1f; color: #fff;">
                  <div style="text-align: center;">
                    <h1 style="color: #ef4444;">Login Failed</h1>
                    <p>Error: ${error}</p>
                    <p>You can close this window.</p>
                  </div>
                </body>
              </html>
            `)
            cleanup()
            resolve({ success: false, error: error })
            return
          }

          if (code) {
            console.log('[OAuth] Received auth code, sending to backend...')

            // Send code to backend - backend will exchange for id_token
            try {
              const response = await fetch(`${backendUrl}/api/v1/auth/google/desktop`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code, redirectUri })
              })

              const data = await response.json()

              if (response.ok && data.success && data.user) {
                console.log('[OAuth] Backend auth successful')
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end(`
                  <html>
                    <head><title>Login Successful</title></head>
                    <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1f; color: #fff;">
                      <div style="text-align: center;">
                        <h1 style="color: #2dd4bf;">✓ Login Successful</h1>
                        <p>You can close this window and return to LumoSnap.</p>
                      </div>
                    </body>
                  </html>
                `)
                cleanup()
                resolve({
                  success: true,
                  user: data.user,
                  session: { token: data.token }
                })
              } else {
                console.error('[OAuth] Backend auth failed:', data)
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end(`
                  <html>
                    <head><title>Login Failed</title></head>
                    <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1f; color: #fff;">
                      <div style="text-align: center;">
                        <h1 style="color: #ef4444;">Login Failed</h1>
                        <p>${data.message || 'Authentication failed'}</p>
                        <p>You can close this window.</p>
                      </div>
                    </body>
                  </html>
                `)
                cleanup()
                resolve({ success: false, error: data.message || 'Backend auth failed' })
              }
            } catch (fetchError) {
              console.error('[OAuth] Failed to exchange code:', fetchError)
              res.writeHead(200, { 'Content-Type': 'text/html' })
              res.end(`
                <html>
                  <head><title>Login Failed</title></head>
                  <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1f; color: #fff;">
                    <div style="text-align: center;">
                      <h1 style="color: #ef4444;">Login Failed</h1>
                      <p>Failed to connect to server</p>
                      <p>You can close this window.</p>
                    </div>
                  </body>
                </html>
              `)
              cleanup()
              resolve({
                success: false,
                error: fetchError instanceof Error ? fetchError.message : 'Network error'
              })
            }
            return
          }

          // No code or error, ignore (might be favicon request etc)
          res.writeHead(200)
          res.end()
        } catch (err) {
          console.error('[OAuth] Server request error:', err)
          res.writeHead(500)
          res.end('Internal error')
        }
      })

      server.listen(port, () => {
        console.log(`[OAuth] Callback server listening on port ${port}`)
        // Open system browser
        shell.openExternal(authUrl.toString())
      })

      // Timeout after 5 minutes
      timeoutId = setTimeout(() => {
        console.log('[OAuth] Auth timed out')
        cleanup()
        resolve({ success: false, error: 'Authentication timed out' })
      }, 5 * 60 * 1000)
    })
  } catch (err) {
    console.error('[OAuth] Failed to start OAuth:', err)
    cleanup()
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to start OAuth'
    }
  }
}
