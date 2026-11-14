/**
 * A file:// URL for a local path. `file://${path}` breaks on #, ? and % in folder or file names
 * (they read as URL syntax) and on Windows drive and UNC paths. Resolves to the same path as
 * Node's pathToFileURL, which the renderer can't import.
 */
export function fileUrl(path: string | null | undefined): string {
  if (!path) return ''
  let p = path.replace(/\\/g, '/')
  const unc = p.startsWith('//')
  if (unc) p = p.slice(2)
  else if (/^[A-Za-z]:/.test(p)) p = `/${p}` // C:/x → /C:/x
  try {
    const encoded = p
      .split('/')
      .map((seg, i) => (!unc && i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
      .join('/')
    return `file://${encoded}`
  } catch {
    return `file://${p}` // a lone UTF-16 surrogate (NTFS allows it): this one image may not load
  }
}
