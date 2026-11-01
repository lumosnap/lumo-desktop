// Fail the build when better-sqlite3 was packed for the wrong CPU: v0.2.6-alpha's Intel mac app
// shipped an arm64 build of it and could not open its database.
const { execFileSync } = require('child_process')
const { Arch } = require('electron-builder')

exports.default = async ({ appOutDir, arch, electronPlatformName, packager }) => {
  if (electronPlatformName !== 'darwin') return
  const want = arch === Arch.arm64 ? 'arm64' : 'x86_64'
  const node = `${appOutDir}/${packager.appInfo.productFilename}.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`
  const got = execFileSync('file', [node]).toString()
  if (!got.includes(want)) throw new Error(`better-sqlite3 is not ${want}: ${got}`)
}
