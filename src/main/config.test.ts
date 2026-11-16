import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({ app: { getPath: () => dir.path } }))
const fail = vi.hoisted(() => ({ write: false }))
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    writeFileSync: (...a: Parameters<typeof real.writeFileSync>) => {
      if (fail.write) throw Object.assign(new Error('locked'), { code: 'EPERM' })
      return real.writeFileSync(...a)
    }
  }
})

import { getConfig, initConfig } from './config'

describe('config', () => {
  it('a locked config.json during the one-time flag override keeps the parsed config', () => {
    dir.path = mkdtempSync(join(tmpdir(), 'lumo-config-'))
    const saved = { storageLocation: '/photos', isFirstLaunch: false, userId: 'u1' }
    writeFileSync(join(dir.path, 'config.json'), JSON.stringify(saved)) // no flagsOn: override runs
    fail.write = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => initConfig()).not.toThrow()
    expect(getConfig()).toMatchObject({ ...saved, portableSnapshot: true, flagsOn: true })
  })
})
