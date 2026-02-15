/**
 * Blocker log file operations
 * 
 * Provides secure, async file operations for the blockers.md log file:
 * - Append blocker entries (markdown format)
 * - Count existing blockers (for rotation logic)
 * - Rotate file when max count exceeded
 * - Load custom blocker templates from .opencode/BLOCKERS.template.md
 * 
 * All operations include path validation to prevent directory traversal attacks.
 * Graceful error handling ensures file I/O failures don't crash the plugin.
 * 
 * @module utils/blockers-file
 */

import { resolve, dirname, basename, relative, isAbsolute, sep, normalize, join } from 'node:path'
import { appendFile, rename, mkdir, readFile } from 'node:fs/promises'
import type { Blocker } from '../types'

/**
 * Default blocker template (used when custom template not found)
 * Uses simple {{variable}} syntax for replacement
 */
const DEFAULT_TEMPLATE = `
## Blocker #{{id}}
**Timestamp:** {{timestamp}}  
**Session:** {{sessionId}}  
**Category:** {{category}}

### Question
{{question}}

### Context
{{context}}

{{optionsSection}}
{{chosenSection}}

### Additional Info
Blocks Progress: {{blocksProgress}}

---
`

/**
 * Cache for loaded template to avoid repeated file reads
 * Key: projectDir, Value: template string
 */
let templateCache: Map<string, string> = new Map()

/**
 * Clears the template cache (for testing)
 */
export function clearTemplateCache(): void {
  templateCache.clear()
}

/**
 * Loads blocker template from .opencode/BLOCKERS.template.md
 * 
 * Attempts to read custom template from project's .opencode directory.
 * Falls back to DEFAULT_TEMPLATE if file not found or read error.
 * Results are cached per projectDir for performance.
 * 
 * @param projectDir - Project root directory
 * @returns Promise<string> - Template content with {{variable}} placeholders
 */
async function loadTemplate(projectDir: string): Promise<string> {
  // Check cache first
  const cached = templateCache.get(projectDir)
  if (cached !== undefined) {
    return cached
  }

  // Try to load custom template
  try {
    const templatePath = join(projectDir, '.opencode', 'BLOCKERS.template.md')
    const content = await readFile(templatePath, 'utf-8')
    
    // Cache and return
    templateCache.set(projectDir, content)
    return content
  } catch (error) {
    // File not found or read error - use default
    // Cache the default for this project
    templateCache.set(projectDir, DEFAULT_TEMPLATE)
    return DEFAULT_TEMPLATE
  }
}

/**
 * Renders template by replacing {{variable}} placeholders
 * 
 * Supports simple variable replacement and conditional sections:
 * - {{variable}} - replaced with sanitized value
 * - {{optionsSection}} - replaced with formatted options list or empty string
 * - {{chosenSection}} - replaced with chosen option section or empty string
 * 
 * @param template - Template string with placeholders
 * @param blocker - Blocker object with data
 * @returns Rendered markdown string
 */
function renderTemplate(template: string, blocker: Blocker): string {
  let rendered = template

  // Replace simple variables
  rendered = rendered.replace(/\{\{id\}\}/g, blocker.id)
  rendered = rendered.replace(/\{\{timestamp\}\}/g, blocker.timestamp)
  rendered = rendered.replace(/\{\{sessionId\}\}/g, blocker.sessionId)
  rendered = rendered.replace(/\{\{category\}\}/g, blocker.category)
  rendered = rendered.replace(/\{\{question\}\}/g, sanitizeMarkdown(blocker.question))
  rendered = rendered.replace(/\{\{context\}\}/g, sanitizeMarkdown(blocker.context || 'No additional context'))
  rendered = rendered.replace(/\{\{blocksProgress\}\}/g, blocker.blocksProgress ? 'Yes' : 'No')

  // Handle optional options section
  let optionsSection = ''
  if (blocker.options && blocker.options.length > 0) {
    optionsSection = '### Options Considered\n'
    blocker.options.forEach((opt, idx) => {
      optionsSection += `${idx + 1}. ${sanitizeMarkdown(opt)}\n`
    })
    optionsSection += '\n'
  }
  rendered = rendered.replace(/\{\{optionsSection\}\}/g, optionsSection)

  // Handle optional chosen option section
  let chosenSection = ''
  if (blocker.chosenOption) {
    chosenSection = `### Chosen Option\n${sanitizeMarkdown(blocker.chosenOption)}\n\n`
    if (blocker.chosenReasoning) {
      chosenSection += `### Reasoning\n${sanitizeMarkdown(blocker.chosenReasoning)}\n\n`
    }
  }
  rendered = rendered.replace(/\{\{chosenSection\}\}/g, chosenSection)

  return rendered
}

/**
 * Validates file path is within project directory
 * 
 * Prevents directory traversal attacks using relative path comparison.
 * This prevents prefix-matching bypasses (e.g., /tmp/proj vs /tmp/proj-evil).
 * 
 * @param filePath - User-provided path (relative or absolute)
 * @param projectDir - Project root directory
 * @returns Resolved absolute path
 * @throws Error if path is outside project directory
 */
function validatePath(filePath: string, projectDir: string): string {
  const resolvedPath = resolve(projectDir, filePath)
  const normalizedProjectDir = normalize(projectDir)
  
  // Use relative path to check containment
  const rel = relative(normalizedProjectDir, resolvedPath)
  
  // If relative path starts with '..' or is absolute, it's outside project
  if (rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(
      `Invalid path: Path "${filePath}" resolves outside project directory (attempted directory traversal)`
    )
  }
  
  return resolvedPath
}

/**
 * Sanitizes markdown content to prevent injection attacks
 * 
 * Escapes markdown headers that could interfere with blocker counting
 * and other special markdown syntax that could break parsing.
 * 
 * @param text - Raw text from blocker fields
 * @returns Sanitized text safe for markdown embedding
 */
function sanitizeMarkdown(text: string): string {
  return text
    .replace(/^(#{1,6})\s+Blocker\s+#/gmi, '\\$1 Blocker #') // Escape blocker header markers
    .replace(/```/g, '\\`\\`\\`') // Escape code blocks
}

/**
 * Formats blocker object as markdown entry using template
 * 
 * Loads template from .opencode/BLOCKERS.template.md (or uses default).
 * Renders template by replacing {{variable}} placeholders with blocker data.
 * Sanitizes all user-provided content to prevent markdown injection.
 * 
 * @param blocker - Blocker object to serialize
 * @param projectDir - Project root directory (for template loading)
 * @returns Promise<string> - Markdown string with trailing newline
 */
async function formatBlockerEntry(blocker: Blocker, projectDir: string): Promise<string> {
  // Load template (cached after first load)
  const template = await loadTemplate(projectDir)
  
  // Render template with blocker data
  let entry = renderTemplate(template, blocker)

  // Add status fields if present (not in template - legacy support)
  if (blocker.clarified) {
    entry += `\n**Status:** ${blocker.clarified}\n`
  }

  if (blocker.clarification) {
    entry += `\n### User Clarification\n${sanitizeMarkdown(blocker.clarification)}\n`
  }

  // Ensure trailing separator
  if (!entry.endsWith('\n---\n')) {
    entry += '\n---\n'
  }

  return entry
}

/**
 * Appends a blocker entry to the blockers markdown file
 * 
 * Creates file if it doesn't exist. Validates path security.
 * Uses atomic append operation (fs.appendFile).
 * Loads and renders custom template from .opencode/BLOCKERS.template.md.
 * 
 * @param filePath - Relative or absolute path to blockers.md
 * @param blocker - Blocker object to serialize
 * @param projectDir - Project root directory (for path validation and template loading)
 * @returns Promise<boolean> - true if successful, false on error
 * @throws Error if path is invalid/traversal attempt
 * 
 * @example
 * ```typescript
 * const success = await appendBlocker(
 *   './blockers.md',
 *   blocker,
 *   '/project/root'
 * )
 * if (!success) {
 *   console.error('Failed to append blocker')
 * }
 * ```
 */
export async function appendBlocker(
  filePath: string,
  blocker: Blocker,
  projectDir: string
): Promise<boolean> {
  try {
    // Validate path security
    const resolvedPath = validatePath(filePath, projectDir)
    
    // Format blocker as markdown using template
    const entry = await formatBlockerEntry(blocker, projectDir)
    
    // Ensure parent directory exists
    const dir = dirname(resolvedPath)
    await mkdir(dir, { recursive: true })
    
    // Append to file (creates if missing)
    await appendFile(resolvedPath, entry, 'utf-8')
    
    return true
  } catch (error) {
    // Re-throw validation errors (security-critical)
    if (error instanceof Error && error.message.includes('directory traversal')) {
      throw error
    }
    
    // Log I/O errors for debugging (graceful degradation per FR-024)
    console.error('[blocker-diverter] Failed to append blocker:', error)
    return false
  }
}

/**
 * Counts blocker entries in file by counting "## Blocker #" headers
 * 
 * Uses regex to match blocker headers. Returns 0 if file doesn't exist.
 * 
 * @param filePath - Path to blockers.md
 * @param projectDir - Project root for validation
 * @returns Promise<number> - Count of blockers (0 if file missing or error)
 * @throws Error if path validation fails
 * 
 * @example
 * ```typescript
 * const count = await getBlockerCount('./blockers.md', projectDir)
 * if (count >= maxBlockers) {
 *   await rotateIfNeeded('./blockers.md', maxBlockers, projectDir)
 * }
 * ```
 */
export async function getBlockerCount(
  filePath: string,
  projectDir: string
): Promise<number> {
  try {
    // Validate path security
    const resolvedPath = validatePath(filePath, projectDir)
    
    // Check if file exists
    const file = Bun.file(resolvedPath)
    const exists = await file.exists()
    
    if (!exists) {
      return 0
    }
    
    // Read file content
    const content = await file.text()
    
    // Count "## Blocker #" headers
    const blockerHeaderRegex = /^## Blocker #/gm
    const matches = content.match(blockerHeaderRegex)
    
    return matches ? matches.length : 0
  } catch (error) {
    // Re-throw validation errors
    if (error instanceof Error && error.message.includes('directory traversal')) {
      throw error
    }
    
    // Log read errors for debugging (graceful degradation)
    console.error('[blocker-diverter] Failed to count blockers:', error)
    return 0
  }
}

/**
 * Rotates blockers file if count >= maxCount
 * 
 * Renames current file to timestamped backup: blockers-YYYY-MM-DDTHH-mm-ss.md
 * This creates a new empty file for future blockers.
 * 
 * @param filePath - Path to blockers.md
 * @param maxCount - Max blockers before rotation
 * @param projectDir - Project root
 * @returns Promise<boolean> - true if rotated, false if not needed or failed
 * @throws Error if path validation fails
 * 
 * @example
 * ```typescript
 * const rotated = await rotateIfNeeded('./blockers.md', 50, projectDir)
 * if (rotated) {
 *   console.log('Blockers file rotated to timestamped backup')
 * }
 * ```
 */
export async function rotateIfNeeded(
  filePath: string,
  maxCount: number,
  projectDir: string
): Promise<boolean> {
  try {
    // Validate path security
    const resolvedPath = validatePath(filePath, projectDir)
    
    // Check current count
    const count = await getBlockerCount(filePath, projectDir)
    
    // No rotation needed
    if (count < maxCount) {
      return false
    }
    
    // Check if file exists (getBlockerCount returns 0 if missing)
    const file = Bun.file(resolvedPath)
    const exists = await file.exists()
    
    if (!exists) {
      return false
    }
    
    // Generate timestamped backup filename
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '') // Remove milliseconds
    
    const dir = dirname(resolvedPath)
    const ext = basename(resolvedPath)
    const baseNameWithoutExt = ext.replace(/\.md$/, '')
    const backupPath = resolve(dir, `${baseNameWithoutExt}-${timestamp}.md`)
    
    // Rename current file to backup
    await rename(resolvedPath, backupPath)
    
    return true
  } catch (error) {
    // Re-throw validation errors
    if (error instanceof Error && error.message.includes('directory traversal')) {
      throw error
    }
    
    // Log rotation errors for debugging (graceful degradation)
    console.error('[blocker-diverter] Failed to rotate blockers file:', error)
    return false
  }
}
