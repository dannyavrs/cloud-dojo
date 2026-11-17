import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeZip } from './zip'
import type { LessonServer } from './lesson-kit'

/** Text files the editor may create or overwrite inside a module's working folder. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const EXT = /\.(json|mjs|js|py|txt|md|yaml|yml)$/i
export const MAX_FILE_BYTES = 20_000
const MAX_FILES = 40

export type WriteResult = { ok: true; rebuilt: string[] } | { ok: false; error: string }

/**
 * Write one text file inside `dir` (the module working folder) and nothing else.
 * Names are plain basenames, so there is no way to address a parent or sibling folder.
 * After a write, any zip in the lesson definition that contains this file is rebuilt from the
 * current files on disk (this is how an edited Lambda handler becomes a deployable zip).
 */
export function writeModuleFile(dir: string, lesson: LessonServer | undefined, name: string, text: string): WriteResult {
  if (typeof name !== 'string' || !NAME.test(name) || name !== path.basename(name)) return { ok: false, error: 'File names may use letters, digits, dot, dash and underscore only.' }
  if (name.toLowerCase().endsWith('.zip')) return { ok: false, error: 'Zip archives are built by the server from your source files and cannot be edited.' }
  if (!EXT.test(name)) return { ok: false, error: 'Only .json, .mjs, .js, .py, .txt, .md and .yaml files can be edited.' }
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FILE_BYTES) return { ok: false, error: `Files are limited to ${MAX_FILE_BYTES} bytes.` }
  const target = path.join(dir, name)
  if (path.dirname(path.resolve(target)) !== path.resolve(dir)) return { ok: false, error: 'Path escapes the module folder.' }
  mkdirSync(dir, { recursive: true })
  if (!existsSync(target) && readdirSync(dir).length >= MAX_FILES) return { ok: false, error: 'Too many files in this folder.' }
  writeFileSync(target, text)
  return { ok: true, rebuilt: rebuildZips(dir, lesson, name) }
}

export function rebuildZips(dir: string, lesson: LessonServer | undefined, changed: string): string[] {
  const rebuilt: string[] = []
  for (const [zipName, entries] of Object.entries(lesson?.zips ?? {})) {
    if (!(changed in entries)) continue
    const files: Record<string, string> = {}
    for (const entry of Object.keys(entries)) {
      const p = path.join(dir, entry)
      files[entry] = existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : entries[entry]
    }
    writeFileSync(path.join(dir, zipName), makeZip(files))
    rebuilt.push(zipName)
  }
  return rebuilt
}
