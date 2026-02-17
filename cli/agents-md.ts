/**
 * CLI handler for `npx github:sungkhum/astro-agent agents-md`.
 */

import fs from 'fs'
import path from 'path'
import prompts from 'prompts'
import pc from 'picocolors'
import {
  AgentsMdOptions,
  buildDocTree,
  collectDocFiles,
  detectAstroVersion,
  ensureGitignoreEntry,
  generateDocsIndex,
  getDocsDirName,
  getExtraDocsDirName,
  injectIndex,
  mergeExtraDocs,
  parseMajorVersion,
  pullDocs,
  resolveDocsRef,
} from '../lib/agents-md'

class BadInput extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadInput'
  }
}

function onCancel(): void {
  console.log(pc.yellow('\nCancelled.'))
  process.exit(0)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

function parseOutputs(output?: string): string[] {
  if (!output) {
    return ['AGENTS.md', 'CLAUDE.md']
  }

  const outputs = output
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return outputs.length > 0 ? outputs : ['AGENTS.md', 'CLAUDE.md']
}

export async function runAgentsMd(options: AgentsMdOptions): Promise<void> {
  const cwd = process.cwd()

  const outputs = parseOutputs(options.output)
  const docsDirName = getDocsDirName()
  const docsPath = path.join(cwd, docsDirName)
  const docsLinkPath = `./${docsDirName}`

  let docsRef = options.ref

  if (!docsRef) {
    let major: number | null = null

    if (options.version) {
      major = parseMajorVersion(options.version)
      if (!major) {
        throw new BadInput(`Unrecognized Astro version: ${options.version}`)
      }
    } else {
      const detected = detectAstroVersion(cwd)
      if (detected.version) {
        major = detected.version
      }
    }

    if (!major) {
      major = await promptForVersion()
    }

    const resolved = resolveDocsRef(major)
    if (!resolved) {
      throw new BadInput(
        `Unsupported Astro major version: ${major}. Use --ref to specify a docs branch/tag/commit.`
      )
    }

    docsRef = resolved
  }

  console.log(
    `\nDownloading ${pc.cyan('Astro')} documentation (${pc.cyan(docsRef)}) to ${pc.cyan(docsDirName)}...`
  )

  const pullResult = await pullDocs(docsRef, docsPath)
  if (!pullResult.success) {
    throw new BadInput(`Failed to pull Astro docs: ${pullResult.error}`)
  }

  const mergedExtras = mergeExtraDocs(cwd, docsPath)

  const docFiles = collectDocFiles(docsPath)
  const sections = buildDocTree(docFiles)

  for (const outputFile of outputs) {
    const outputPath = path.join(cwd, outputFile)

    let content = ''
    let sizeBefore = 0
    let isNewFile = true

    if (fs.existsSync(outputPath)) {
      content = fs.readFileSync(outputPath, 'utf-8')
      sizeBefore = Buffer.byteLength(content, 'utf-8')
      isNewFile = false
    }

    const indexContent = generateDocsIndex({
      docsPath: docsLinkPath,
      sections,
      outputFile,
    })

    const updated = injectIndex(content, indexContent)
    fs.writeFileSync(outputPath, updated, 'utf-8')

    const sizeAfter = Buffer.byteLength(updated, 'utf-8')
    const action = isNewFile ? 'Created' : 'Updated'
    const sizeInfo = isNewFile
      ? formatSize(sizeAfter)
      : `${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`

    console.log(`${pc.green('✓')} ${action} ${pc.bold(outputFile)} (${sizeInfo})`)
  }

  const gitignoreResult = ensureGitignoreEntry(cwd)

  if (mergedExtras) {
    console.log(
      `${pc.green('✓')} Included extra docs from ${pc.bold(getExtraDocsDirName())}`
    )
  }
  if (gitignoreResult.updated) {
    console.log(`${pc.green('✓')} Added ${pc.bold(docsDirName)} to .gitignore`)
  }

  console.log('')
}

async function promptForVersion(): Promise<number> {
  const response = await prompts(
    {
      type: 'select',
      name: 'version',
      message: 'Astro major version for docs',
      choices: [
        { title: '5.x (main)', value: 5 },
        { title: '4.x (v4)', value: 4 },
      ],
      initial: 0,
    },
    { onCancel }
  )

  if (response.version === undefined) {
    console.log(pc.yellow('\nCancelled.'))
    process.exit(0)
  }

  return response.version as number
}
