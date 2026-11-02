// Fail the build when a mac zip ships better-sqlite3 for the wrong CPU: v0.2.6 and v0.2.8's
// Intel apps carried an arm64 build of it and could not open their database. Runs after all
// artifacts, not after pack: on CI electron-builder hard-links files into the app, so the arm64
// rebuild rewrote the x64 app's copy after an afterPack check had passed.
const { execFileSync } = require('child_process')
const { mkdtempSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

exports.default = async ({ artifactPaths, configuration }) => {
  for (const zip of artifactPaths.filter((p) => p.endsWith('-mac.zip'))) {
    const want = zip.includes('arm64') ? 'arm64' : 'x86_64'
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-arch-'))
    const node = `${configuration.productName}.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`
    execFileSync('unzip', ['-q', zip, node, '-d', dir])
    const got = execFileSync('file', [join(dir, node)]).toString()
    if (!got.includes(want)) throw new Error(`${zip}: better-sqlite3 is not ${want}: ${got}`)
  }
  return []
}
