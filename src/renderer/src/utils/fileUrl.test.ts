import { describe, it, expect } from 'vitest'
import { fileUrl } from './fileUrl'

describe('fileUrl', () => {
  it('encodes characters that are URL syntax', () => {
    expect(fileUrl('/Volumes/SSD/Wedding #2/IMG?1 100%.jpg')).toBe(
      'file:///Volumes/SSD/Wedding%20%232/IMG%3F1%20100%25.jpg'
    )
  })
  it('handles Windows drive and UNC paths', () => {
    expect(fileUrl('D:\\Photos\\Café\\a.jpg')).toBe('file:///D:/Photos/Caf%C3%A9/a.jpg')
    expect(fileUrl('\\\\nas\\share\\a b.jpg')).toBe('file://nas/share/a%20b.jpg')
  })
  it('resolves back to the same path (POSIX)', async () => {
    const { fileURLToPath } = await import('url')
    for (const p of ['/a/b c/d#e.jpg', '/x/ü/100%.png', '/t/[1]/a&b.jpg', '/q/?x=1'])
      expect(fileURLToPath(fileUrl(p))).toBe(p)
  })
})
