import { mkdir, writeFile, readFile, rm, readdir } from 'fs/promises'
import { join, extname, parse, basename } from 'path'
import { existsSync } from 'fs'
import { rename, copyFile, unlink, access, constants } from 'fs/promises'
import { tmpdir } from 'os'

async function uniqueTargetPath(dir, filename) {
  const parsed = parse(filename)
  let candidate = join(dir, filename)
  let i = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${parsed.name}_${i}${parsed.ext}`)
    i += 1
  }
  return candidate
}

function sanitizeBasename(name) {
  const trimmed = name.trim()
  if (!trimmed) return ''
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '')
}

async function classifySingle(sourcePath, newBasename, categoryPath) {
  try {
    await access(sourcePath, constants.R_OK)
    if (!existsSync(categoryPath)) return { ok: false, error: 'missing cat' }
    const ext = extname(sourcePath)
    const safeBase = sanitizeBasename(newBasename) || parse(sourcePath).name
    const dest = await uniqueTargetPath(categoryPath, `${safeBase}${ext}`)
    try {
      await rename(sourcePath, dest)
    } catch (err) {
      if (err.code === 'EXDEV') {
        await copyFile(sourcePath, dest)
        await unlink(sourcePath)
      } else throw err
    }
    return { ok: true, destinations: [dest] }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function classifyMulti(sourcePath, newBasename, categoryPaths) {
  try {
    await access(sourcePath, constants.R_OK)
    const ext = extname(sourcePath)
    const safeBase = sanitizeBasename(newBasename) || parse(sourcePath).name
    const destinations = []
    for (const cat of categoryPaths) {
      const dest = await uniqueTargetPath(cat, `${safeBase}${ext}`)
      await copyFile(sourcePath, dest)
      destinations.push(dest)
    }
    await unlink(sourcePath)
    return { ok: true, destinations }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function main() {
  const root = join(tmpdir(), `video-classifier-test-${Date.now()}`)
  const source = join(root, 'inbox')
  const target = join(root, 'sorted')
  const catA = join(target, 'Action')
  const catB = join(target, 'Comedy')
  await mkdir(source, { recursive: true })
  await mkdir(catA, { recursive: true })
  await mkdir(catB, { recursive: true })

  const file1 = join(source, 'clip-one.mp4')
  const file2 = join(source, 'clip-two.mp4')
  await writeFile(file1, 'video-bytes-1')
  await writeFile(file2, 'video-bytes-2')
  await writeFile(join(catA, 'renamed.mp4'), 'existing')

  const single = await classifySingle(file1, 'renamed', catA)
  if (!single.ok) throw new Error(`single failed: ${single.error}`)
  if (!single.destinations?.[0].endsWith('renamed_1.mp4')) {
    throw new Error(`expected conflict rename, got ${single.destinations?.[0]}`)
  }
  if (existsSync(file1)) throw new Error('source should be moved')
  const moved = await readFile(single.destinations[0], 'utf8')
  if (moved !== 'video-bytes-1') throw new Error('moved content mismatch')

  const multi = await classifyMulti(file2, 'multi-name', [catA, catB])
  if (!multi.ok) throw new Error(`multi failed: ${multi.error}`)
  if ((multi.destinations?.length ?? 0) !== 2) throw new Error('expected 2 copies')
  if (existsSync(file2)) throw new Error('source should be deleted after multi')
  for (const d of multi.destinations) {
    if (basename(d) !== 'multi-name.mp4') throw new Error(`bad name ${d}`)
    if ((await readFile(d, 'utf8')) !== 'video-bytes-2') throw new Error('copy mismatch')
  }

  const inboxLeft = await readdir(source)
  if (inboxLeft.length !== 0) throw new Error('inbox should be empty')

  console.log('OK: single move+conflict, multi copy+delete')
  await rm(root, { recursive: true, force: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
