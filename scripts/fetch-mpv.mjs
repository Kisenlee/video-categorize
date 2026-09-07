import { createWriteStream, existsSync, mkdirSync, rmSync, readdirSync, cpSync } from 'fs'
import { join, dirname } from 'path'
import { pipeline } from 'stream/promises'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const vendorDir = join(root, 'vendor', 'mpv')
const marker = join(vendorDir, 'mpv.exe')

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'video-classifier-fetch-mpv' },
    redirect: 'follow'
  })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status}: ${url}`)
  }
  await pipeline(res.body, createWriteStream(dest))
}

function findMpvExe(dir) {
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const name of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, name.name)
      if (name.isDirectory()) stack.push(p)
      else if (name.isFile() && name.name.toLowerCase() === 'mpv.exe') return p
    }
  }
  return null
}

async function latestMpvAsset() {
  const api = 'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest'
  const res = await fetch(api, {
    headers: {
      'User-Agent': 'video-classifier-fetch-mpv',
      Accept: 'application/vnd.github+json'
    }
  })
  if (!res.ok) throw new Error(`GitHub API failed: ${res.status}`)
  const json = await res.json()
  const assets = json.assets || []
  const asset =
    assets.find((a) => /mpv-x86_64-.*\.7z$/i.test(a.name) && !/v3|v4|wayland/i.test(a.name)) ||
    assets.find((a) => /mpv-x86_64-.*\.7z$/i.test(a.name))
  if (!asset) throw new Error('No mpv-x86_64 .7z asset found in latest release')
  return { name: asset.name, url: asset.browser_download_url, tag: json.tag_name }
}

async function ensure7zr(cacheDir) {
  const seven = join(cacheDir, '7zr.exe')
  if (existsSync(seven)) return seven
  // Official 9xx/24xx 7zr single-file extractor
  const url = 'https://www.7-zip.org/a/7zr.exe'
  console.log('Downloading 7zr.exe…')
  await download(url, seven)
  return seven
}

async function main() {
  if (existsSync(marker) && process.argv.includes('--force') === false) {
    console.log(`mpv already present: ${marker}`)
    return
  }

  mkdirSync(join(root, 'vendor'), { recursive: true })
  const cacheDir = join(tmpdir(), `vc-mpv-${randomBytes(4).toString('hex')}`)
  mkdirSync(cacheDir, { recursive: true })

  try {
    const asset = await latestMpvAsset()
    console.log(`Fetching mpv ${asset.tag}: ${asset.name}`)
    const archive = join(cacheDir, asset.name)
    await download(asset.url, archive)

    const seven = await ensure7zr(cacheDir)
    const extractDir = join(cacheDir, 'out')
    mkdirSync(extractDir, { recursive: true })
    console.log('Extracting…')
    execFileSync(seven, ['x', archive, `-o${extractDir}`, '-y'], { stdio: 'inherit' })

    const exe = findMpvExe(extractDir)
    if (!exe) throw new Error('mpv.exe not found in archive')
    const exeDir = dirname(exe)

    if (existsSync(vendorDir)) rmSync(vendorDir, { recursive: true, force: true })
    mkdirSync(dirname(vendorDir), { recursive: true })
    cpSync(exeDir, vendorDir, { recursive: true })

    if (!existsSync(marker)) throw new Error('vendor/mpv/mpv.exe missing after extract')
    console.log(`OK: ${marker}`)
  } finally {
    rmSync(cacheDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
