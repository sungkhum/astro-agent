/**
 * agents-md: Generate Astro documentation index for AI coding agents.
 *
 * Downloads docs from GitHub, builds a compact index of all doc files,
 * and injects it into AGENTS.md or CLAUDE.md.
 */

import { execa } from 'execa'
import fs from 'fs'
import os from 'os'
import path from 'path'

export interface AgentsMdOptions {
  version?: string
  ref?: string
  output?: string
}

interface DetectResult {
  version: number | null
  error?: string
}

const DOCS_REPO_URL = 'https://github.com/withastro/docs.git'
const DOCS_DIR_NAME = '.astro-docs'
const EXTRA_DOCS_DIR_NAME = '.astro-docs-extra'
const START_MARKER = '<!-- ASTRO-AGENTS-MD-START -->'
const END_MARKER = '<!-- ASTRO-AGENTS-MD-END -->'
const INDEX_TITLE = 'Astro Docs Index'

export function detectAstroVersion(cwd: string): DetectResult {
  const packageJsonPath = path.join(cwd, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    return { version: null, error: 'No package.json found in the current directory.' }
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const dependencies = packageJson.dependencies || {}
    const devDependencies = packageJson.devDependencies || {}

    const versionValue = dependencies.astro || devDependencies.astro

    if (!versionValue) {
      return { version: null, error: 'Astro dependency not found in package.json.' }
    }

    const major = parseMajorVersion(String(versionValue))
    if (!major) {
      return { version: null, error: `Unrecognized Astro version: ${versionValue}` }
    }

    return { version: major }
  } catch (error) {
    return {
      version: null,
      error: `Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function parseMajorVersion(value: string): number | null {
  const cleaned = value.trim().toLowerCase().replace(/^v/, '')

  if (cleaned.endsWith('.x') || cleaned.endsWith('.*')) {
    const major = cleaned.split('.', 1)[0]
    return major && /^\d+$/.test(major) ? Number(major) : null
  }

  const match = cleaned.match(/(\d+)/)
  if (!match) return null
  return Number(match[1])
}

export function resolveDocsRef(major: number): string | null {
  if (major <= 4) return 'v4'
  if (major >= 5) return 'main'
  return null
}

interface PullResult {
  success: boolean
  error?: string
}

export async function pullDocs(ref: string, docsPath: string): Promise<PullResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-agent-'))

  try {
    try {
      await execa(
        'git',
        ['clone', '--depth', '1', '--single-branch', '--branch', ref, DOCS_REPO_URL, '.'],
        { cwd: tempDir }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('not found') || message.includes('did not match')) {
        throw new Error(`Could not find documentation for ref "${ref}".`)
      }
      throw error
    }

    if (fs.existsSync(docsPath)) {
      fs.rmSync(docsPath, { recursive: true })
    }

    fs.mkdirSync(docsPath, { recursive: true })
    fs.cpSync(tempDir, docsPath, { recursive: true })

    const gitDir = path.join(docsPath, '.git')
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true })
    }
  }
}

export function mergeExtraDocs(cwd: string, docsPath: string): boolean {
  const extraDocsPath = path.join(cwd, EXTRA_DOCS_DIR_NAME)
  if (!fs.existsSync(extraDocsPath)) return false

  const entries = fs.readdirSync(extraDocsPath)
  for (const entry of entries) {
    const source = path.join(extraDocsPath, entry)
    const destination = path.join(docsPath, entry)

    if (fs.existsSync(destination)) {
      fs.rmSync(destination, { recursive: true, force: true })
    }

    fs.cpSync(source, destination, { recursive: true })
  }

  return true
}

export function collectDocFiles(dir: string): { relativePath: string }[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter(
      (f) =>
        (f.endsWith('.md') || f.endsWith('.mdx')) &&
        !/[/\\]index\.mdx$/.test(f) &&
        !/[/\\]index\.md$/.test(f) &&
        !f.startsWith('index.')
    )
    .sort()
    .map((f) => ({ relativePath: f.replace(/\\/g, '/') }))
}

interface DocSection {
  name: string
  files: { relativePath: string }[]
  subsections: DocSection[]
}

export function buildDocTree(files: { relativePath: string }[]): DocSection[] {
  const sections: Map<string, DocSection> = new Map()

  for (const file of files) {
    const parts = file.relativePath.split(/[/\\]/)
    if (parts.length === 1) {
      const rootKey = '.'
      if (!sections.has(rootKey)) {
        sections.set(rootKey, {
          name: rootKey,
          files: [],
          subsections: [],
        })
      }
      sections.get(rootKey)!.files.push({ relativePath: file.relativePath })
      continue
    }

    const topLevelDir = parts[0]

    if (!sections.has(topLevelDir)) {
      sections.set(topLevelDir, {
        name: topLevelDir,
        files: [],
        subsections: [],
      })
    }

    const section = sections.get(topLevelDir)!

    if (parts.length === 2) {
      section.files.push({ relativePath: file.relativePath })
    } else {
      const subsectionDir = parts[1]
      let subsection = section.subsections.find((s) => s.name === subsectionDir)

      if (!subsection) {
        subsection = { name: subsectionDir, files: [], subsections: [] }
        section.subsections.push(subsection)
      }

      if (parts.length === 3) {
        subsection.files.push({ relativePath: file.relativePath })
      } else {
        const subSubDir = parts[2]
        let subSubsection = subsection.subsections.find(
          (s) => s.name === subSubDir
        )

        if (!subSubsection) {
          subSubsection = { name: subSubDir, files: [], subsections: [] }
          subsection.subsections.push(subSubsection)
        }

        subSubsection.files.push({ relativePath: file.relativePath })
      }
    }
  }

  const sortedSections = Array.from(sections.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  for (const section of sortedSections) {
    section.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    section.subsections.sort((a, b) => a.name.localeCompare(b.name))
    for (const subsection of section.subsections) {
      subsection.files.sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath)
      )
      subsection.subsections.sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  return sortedSections
}

function collectAllFilesFromSections(sections: DocSection[]): string[] {
  const files: string[] = []

  for (const section of sections) {
    for (const file of section.files) {
      files.push(file.relativePath)
    }
    files.push(...collectAllFilesFromSections(section.subsections))
  }

  return files
}

function groupByDirectory(files: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()

  for (const filePath of files) {
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    const dir = lastSlash === -1 ? '.' : filePath.slice(0, lastSlash)
    const fileName = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1)

    const existing = grouped.get(dir)
    if (existing) {
      existing.push(fileName)
    } else {
      grouped.set(dir, [fileName])
    }
  }

  return grouped
}

interface IndexData {
  docsPath: string
  sections: DocSection[]
  outputFile: string
}

export function generateDocsIndex(data: IndexData): string {
  const { docsPath, sections, outputFile } = data

  const parts: string[] = []

  parts.push(`[${INDEX_TITLE}]`)
  parts.push(`root: ${docsPath}`)
  parts.push(
    'STOP. What you remember about Astro is WRONG for this project. Always search docs and read before any task.'
  )
  parts.push(
    `If docs missing, run this command first: npx github:sungkhum/astro-agent agents-md --output ${outputFile}`
  )

  const allFiles = collectAllFilesFromSections(sections)
  const grouped = groupByDirectory(allFiles)

  for (const [dir, files] of grouped) {
    parts.push(`${dir}:{${files.join(',')}}`)
  }

  return parts.join('|')
}

export function injectIndex(targetContent: string, indexContent: string): string {
  const wrappedContent = `${START_MARKER}\n${indexContent}\n${END_MARKER}`

  if (targetContent.includes(START_MARKER)) {
    const startIdx = targetContent.indexOf(START_MARKER)
    const endIdx = targetContent.indexOf(END_MARKER) + END_MARKER.length

    return (
      targetContent.slice(0, startIdx) +
      wrappedContent +
      targetContent.slice(endIdx)
    )
  }

  const separator = targetContent.endsWith('\n') ? '\n' : '\n\n'
  return targetContent + separator + wrappedContent + '\n'
}

export interface GitignoreStatus {
  path: string
  updated: boolean
  alreadyPresent: boolean
}

export function ensureGitignoreEntry(cwd: string): GitignoreStatus {
  const gitignorePath = path.join(cwd, '.gitignore')
  const entryRegex = /^\s*\.astro-docs(?:\/.*)?$/

  let content = ''
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf-8')
  }

  const hasEntry = content.split(/\r?\n/).some((line) => entryRegex.test(line))

  if (hasEntry) {
    return { path: gitignorePath, updated: false, alreadyPresent: true }
  }

  const needsNewline = content.length > 0 && !content.endsWith('\n')
  const header = content.includes('# astro-agent') ? '' : '# astro-agent\n'
  const newContent = content + (needsNewline ? '\n' : '') + header + '.astro-docs/\n'

  fs.writeFileSync(gitignorePath, newContent, 'utf-8')

  return { path: gitignorePath, updated: true, alreadyPresent: false }
}

export function getDocsDirName(): string {
  return DOCS_DIR_NAME
}

export function getExtraDocsDirName(): string {
  return EXTRA_DOCS_DIR_NAME
}
