/**
 * Tests for blockers-file.ts - Blocker log file operations
 * 
 * Following TDD: Tests written BEFORE implementation
 * Tests cover: append, count, rotation, security, error handling
 * Target: 90%+ coverage
 * 
 * Uses real temp files for integration-style tests (more reliable than mocking)
 * 
 * @module tests/utils/blockers-file
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { resolve, join } from 'node:path'
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { appendBlocker, getBlockerCount, rotateIfNeeded, clearTemplateCache } from '../../src/utils/blockers-file'
import type { Blocker } from '../../src/types'

describe('blockers-file', () => {
  // Use real temp directory for tests
  const tempDir = resolve('/tmp/blocker-diverter-test')
  const mockFilePath = 'blockers.md'
  
  // Sample blocker for testing
  const sampleBlocker: Blocker = {
    id: '2026-02-13T10:00:00Z-session-123-abc',
    timestamp: '2026-02-13T10:00:00Z',
    sessionId: 'session-123',
    category: 'permission',
    question: 'Allow bash command: git status?',
    context: 'Checking repository status',
    blocksProgress: true,
  }

  beforeEach(async () => {
    // Create temp directory
    await mkdir(tempDir, { recursive: true })
    
    // Clear template cache to ensure test isolation
    clearTemplateCache()
  })

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('appendBlocker', () => {
    it('should append blocker entry to existing file', async () => {
      // Pre-create file with some content
      const filePath = join(tempDir, mockFilePath)
      await writeFile(filePath, '# Existing content\n', 'utf-8')
      
      const result = await appendBlocker(mockFilePath, sampleBlocker, tempDir)
      
      expect(result).toBe(true)
      
      // Verify file was appended to
      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain('# Existing content')
      expect(content).toContain(`## Blocker #${sampleBlocker.id}`)
      expect(content).toContain(sampleBlocker.question)
    })

    it('should create file if it does not exist', async () => {
      const filePath = join(tempDir, mockFilePath)
      
      // Verify file doesn't exist
      const fileExists = await Bun.file(filePath).exists()
      expect(fileExists).toBe(false)
      
      const result = await appendBlocker(mockFilePath, sampleBlocker, tempDir)
      
      expect(result).toBe(true)
      
      // Verify file was created
      const newFileExists = await Bun.file(filePath).exists()
      expect(newFileExists).toBe(true)
      
      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain(`## Blocker #${sampleBlocker.id}`)
    })

    it('should reject directory traversal attempts with relative paths', async () => {
      const traversalPath = '../../../etc/passwd'
      
      await expect(
        appendBlocker(traversalPath, sampleBlocker, tempDir)
      ).rejects.toThrow(/directory traversal/i)
    })

    it('should reject paths outside project directory (absolute)', async () => {
      const outsidePath = '/etc/passwd'
      
      await expect(
        appendBlocker(outsidePath, sampleBlocker, tempDir)
      ).rejects.toThrow(/outside project/i)
    })

    it('should reject paths with prefix-matching bypass attempt', async () => {
      // CRITICAL SECURITY TEST: Ensure /tmp/dir-evil is NOT inside /tmp/dir
      const maliciousPath = tempDir + '-evil/secret.md'
      
      await expect(
        appendBlocker(maliciousPath, sampleBlocker, tempDir)
      ).rejects.toThrow(/directory traversal/i)
    })

    it('should format blocker entry with all fields', async () => {
      const richBlocker: Blocker = {
        id: '2026-02-13T10:00:00Z-session-456-xyz',
        timestamp: '2026-02-13T10:00:00Z',
        sessionId: 'session-456',
        category: 'architecture',
        question: 'Which framework should we use?',
        context: 'Building new API service',
        blocksProgress: true,
        options: ['Express', 'Fastify', 'Hono'],
        chosenOption: 'Fastify',
        chosenReasoning: 'Better TypeScript support',
        clarified: 'pending',
      }
      
      const result = await appendBlocker(mockFilePath, richBlocker, tempDir)
      
      expect(result).toBe(true)
      
      const content = await readFile(join(tempDir, mockFilePath), 'utf-8')
      expect(content).toContain('## Blocker #')
      expect(content).toContain('**Timestamp:**')
      expect(content).toContain('**Session:**')
      expect(content).toContain('**Category:** architecture')
      expect(content).toContain('### Question')
      expect(content).toContain('Which framework should we use?')
      expect(content).toContain('### Options Considered')
      expect(content).toContain('1. Express')
      expect(content).toContain('2. Fastify')
      expect(content).toContain('3. Hono')
      expect(content).toContain('### Chosen Option')
      expect(content).toContain('Fastify')
      expect(content).toContain('### Reasoning')
      expect(content).toContain('Better TypeScript support')
      expect(content).toContain('**Status:** pending')
    })

    it('should allow absolute path within project directory', async () => {
      const validAbsolutePath = join(tempDir, 'logs', 'blockers.md')
      
      const result = await appendBlocker(validAbsolutePath, sampleBlocker, tempDir)
      
      expect(result).toBe(true)
      
      // Verify file was created
      const fileExists = await Bun.file(validAbsolutePath).exists()
      expect(fileExists).toBe(true)
    })

    it('should handle subdirectory creation', async () => {
      const subdir = join(tempDir, 'deep', 'nested', 'path')
      const nestedFile = join(subdir, 'blockers.md')
      
      const result = await appendBlocker(nestedFile, sampleBlocker, tempDir)
      
      expect(result).toBe(true)
      
      // Verify nested directory and file were created
      const fileExists = await Bun.file(nestedFile).exists()
      expect(fileExists).toBe(true)
    })

    it('should sanitize markdown injection in blocker fields', async () => {
      const maliciousBlocker: Blocker = {
        id: 'test-injection-123',
        timestamp: '2026-02-13T10:00:00Z',
        sessionId: 'session-evil',
        category: 'permission',
        question: '## Blocker #999\nThis could break counting',
        context: '```typescript\nconst evil = true\n```',
        blocksProgress: true,
        options: ['## Blocker #1000', 'Normal option'],
        chosenOption: '### Fake header',
        chosenReasoning: 'More ```code``` blocks',
      }
      
      const result = await appendBlocker(mockFilePath, maliciousBlocker, tempDir)
      expect(result).toBe(true)
      
      // Verify sanitization happened
      const filePath = join(tempDir, mockFilePath)
      const content = await readFile(filePath, 'utf-8')
      
      // The legitimate blocker header should exist
      expect(content).toContain('## Blocker #test-injection-123')
      
      // But injected headers in content should be escaped
      expect(content).toContain('\\## Blocker #999')
      expect(content).toContain('\\## Blocker #1000')
      expect(content).toContain('\\`\\`\\`')
      
      // Count should only find the legitimate blocker, not the injected ones
      const count = await getBlockerCount(mockFilePath, tempDir)
      expect(count).toBe(1) // Only one real blocker header
    })
  })

  describe('getBlockerCount', () => {
    it('should return 0 for empty file', async () => {
      const filePath = join(tempDir, mockFilePath)
      await writeFile(filePath, '', 'utf-8')
      
      const count = await getBlockerCount(mockFilePath, tempDir)
      
      expect(count).toBe(0)
    })

    it('should return 0 when file does not exist', async () => {
      const count = await getBlockerCount(mockFilePath, tempDir)
      
      expect(count).toBe(0)
    })

    it('should count blocker entries by "## Blocker #" headers', async () => {
      const fileContent = `
# Blockers Log

## Blocker #1
**Time:** 2026-02-13T10:00:00Z

## Blocker #2
**Time:** 2026-02-13T10:05:00Z

## Blocker #3
**Time:** 2026-02-13T10:10:00Z
`
      
      const filePath = join(tempDir, mockFilePath)
      await writeFile(filePath, fileContent, 'utf-8')
      
      const count = await getBlockerCount(mockFilePath, tempDir)
      
      expect(count).toBe(3)
    })

    it('should handle file with content but no blocker headers', async () => {
      const fileContent = `
# Some other content
This is not a blocker entry.
## Different header
More text.
`
      
      const filePath = join(tempDir, mockFilePath)
      await writeFile(filePath, fileContent, 'utf-8')
      
      const count = await getBlockerCount(mockFilePath, tempDir)
      
      expect(count).toBe(0)
    })

    it('should reject directory traversal attempts', async () => {
      const traversalPath = '../../etc/passwd'
      
      await expect(
        getBlockerCount(traversalPath, tempDir)
      ).rejects.toThrow(/directory traversal/i)
    })
  })

  describe('rotateIfNeeded', () => {
    it('should not rotate when count below maxCount', async () => {
      const fileContent = `
## Blocker #1
Content
`
      
      const filePath = join(tempDir, mockFilePath)
      await writeFile(filePath, fileContent, 'utf-8')
      
      const rotated = await rotateIfNeeded(mockFilePath, 10, tempDir)
      
      expect(rotated).toBe(false)
      
      // Verify original file still exists
      const fileExists = await Bun.file(filePath).exists()
      expect(fileExists).toBe(true)
    })

    it('should rotate when count equals maxCount', async () => {
      // Create file with exactly maxCount blockers
      let fileContent = '# Blockers Log\n'
      for (let i = 1; i <= 5; i++) {
        fileContent += `\n## Blocker #${i}\nContent\n`
      }
      
      const filePath = join(tempDir, mockFilePath)
      await writeFile(filePath, fileContent, 'utf-8')
      
      const rotated = await rotateIfNeeded(mockFilePath, 5, tempDir)
      
      expect(rotated).toBe(true)
      
      // Verify original file no longer exists (was renamed)
      const originalExists = await Bun.file(filePath).exists()
      expect(originalExists).toBe(false)
      
      // Verify backup file exists with timestamp
      const { readdir } = await import('node:fs/promises')
      const files = await readdir(tempDir)
      const backupFiles = files.filter(f => f.startsWith('blockers-') && f.endsWith('.md'))
      expect(backupFiles.length).toBe(1)
    })

    it('should rotate when count exceeds maxCount', async () => {
      // Create file with more than maxCount blockers
      let fileContent = '# Blockers Log\n'
      for (let i = 1; i <= 15; i++) {
        fileContent += `\n## Blocker #${i}\nContent\n`
      }
      
      const filePath = join(tempDir, mockFilePath)
      await writeFile(filePath, fileContent, 'utf-8')
      
      const rotated = await rotateIfNeeded(mockFilePath, 10, tempDir)
      
      expect(rotated).toBe(true)
      
      // Verify original file was renamed
      const originalExists = await Bun.file(filePath).exists()
      expect(originalExists).toBe(false)
    })

    it('should generate timestamped backup filename', async () => {
      let fileContent = '# Blockers Log\n'
      for (let i = 1; i <= 10; i++) {
        fileContent += `\n## Blocker #${i}\nContent\n`
      }
      
      const filePath = join(tempDir, mockFilePath)
      await writeFile(filePath, fileContent, 'utf-8')
      
      const rotated = await rotateIfNeeded(mockFilePath, 10, tempDir)
      
      expect(rotated).toBe(true)
      
      // Verify backup file matches expected pattern: blockers-YYYY-MM-DDTHH-mm-ss.md
      const files = await import('node:fs/promises').then(fs => fs.readdir(tempDir))
      const backupFiles = files.filter(f => f.startsWith('blockers-') && f.endsWith('.md'))
      
      expect(backupFiles.length).toBe(1)
      expect(backupFiles[0]).toMatch(/^blockers-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/)
    })

    it('should not rotate if file does not exist', async () => {
      const rotated = await rotateIfNeeded(mockFilePath, 10, tempDir)
      
      expect(rotated).toBe(false)
    })

    it('should reject directory traversal attempts', async () => {
      const traversalPath = '../../etc/passwd'
      
      await expect(
        rotateIfNeeded(traversalPath, 10, tempDir)
      ).rejects.toThrow(/directory traversal/i)
    })
  })

  describe('integration test', () => {
    it('should complete full workflow: append → count → rotate', async () => {
      // Append blockers until rotation threshold
      const maxBlockers = 5
      
      for (let i = 1; i <= maxBlockers + 2; i++) {
        const blocker: Blocker = {
          ...sampleBlocker,
          id: `blocker-${i}`,
          timestamp: `2026-02-13T10:${String(i).padStart(2, '0')}:00Z`,
        }
        
        await appendBlocker(mockFilePath, blocker, tempDir)
      }
      
      // Count should show all blockers
      const count = await getBlockerCount(mockFilePath, tempDir)
      expect(count).toBe(maxBlockers + 2)
      
      // Rotate should happen (count > maxBlockers)
      const rotated = await rotateIfNeeded(mockFilePath, maxBlockers, tempDir)
      expect(rotated).toBe(true)
      
      // After rotation, original file should be gone
      const originalExists = await Bun.file(join(tempDir, mockFilePath)).exists()
      expect(originalExists).toBe(false)
      
      // New appends should start fresh file
      await appendBlocker(mockFilePath, sampleBlocker, tempDir)
      
      const newCount = await getBlockerCount(mockFilePath, tempDir)
      expect(newCount).toBe(1)
    })
  })

  describe('template system', () => {
    it('should use default template when custom template does not exist', async () => {
      // No custom template in tempDir/.opencode/
      const result = await appendBlocker(mockFilePath, sampleBlocker, tempDir)
      
      expect(result).toBe(true)
      
      const content = await readFile(join(tempDir, mockFilePath), 'utf-8')
      // Default template format
      expect(content).toContain('## Blocker #')
      expect(content).toContain('**Timestamp:**')
      expect(content).toContain('**Session:**')
      expect(content).toContain('**Category:**')
      expect(content).toContain('### Question')
      expect(content).toContain('### Context')
      expect(content).toContain('### Additional Info')
      expect(content).toContain('Blocks Progress:')
    })

    it('should use custom template from .opencode/BLOCKERS.template.md', async () => {
      // Create custom template
      const opencodeDir = join(tempDir, '.opencode')
      await mkdir(opencodeDir, { recursive: true })
      
      const customTemplate = `
# BLOCKER {{id}}
Time: {{timestamp}}
Session: {{sessionId}}
Type: {{category}}

Q: {{question}}
Context: {{context}}

Progress blocked: {{blocksProgress}}

{{optionsSection}}
{{chosenSection}}
---
`
      
      await writeFile(join(opencodeDir, 'BLOCKERS.template.md'), customTemplate, 'utf-8')
      
      // Clear cache to force reload
      const { clearTemplateCache } = await import('../../src/utils/blockers-file')
      clearTemplateCache()
      
      // Append blocker
      const result = await appendBlocker(mockFilePath, sampleBlocker, tempDir)
      
      expect(result).toBe(true)
      
      const content = await readFile(join(tempDir, mockFilePath), 'utf-8')
      // Custom template format
      expect(content).toContain('# BLOCKER')
      expect(content).toContain('Time: 2026-02-13T10:00:00Z')
      expect(content).toContain('Session: session-123')
      expect(content).toContain('Type: permission')
      expect(content).toContain('Q: Allow bash command: git status?')
      expect(content).toContain('Context: Checking repository status')
      expect(content).toContain('Progress blocked: Yes')
    })

    it('should render optional sections correctly', async () => {
      const opencodeDir = join(tempDir, '.opencode')
      await mkdir(opencodeDir, { recursive: true })
      
      const customTemplate = `
## Blocker {{id}}
{{question}}
{{optionsSection}}
{{chosenSection}}
---
`
      
      await writeFile(join(opencodeDir, 'BLOCKERS.template.md'), customTemplate, 'utf-8')
      
      const { clearTemplateCache } = await import('../../src/utils/blockers-file')
      clearTemplateCache()
      
      const richBlocker: Blocker = {
        ...sampleBlocker,
        options: ['Option A', 'Option B', 'Option C'],
        chosenOption: 'Option B',
        chosenReasoning: 'Best performance'
      }
      
      const result = await appendBlocker(mockFilePath, richBlocker, tempDir)
      
      expect(result).toBe(true)
      
      const content = await readFile(join(tempDir, mockFilePath), 'utf-8')
      expect(content).toContain('### Options Considered')
      expect(content).toContain('1. Option A')
      expect(content).toContain('2. Option B')
      expect(content).toContain('3. Option C')
      expect(content).toContain('### Chosen Option')
      expect(content).toContain('Option B')
      expect(content).toContain('### Reasoning')
      expect(content).toContain('Best performance')
    })

    it('should cache template per project directory', async () => {
      // Create custom template BEFORE any calls
      const opencodeDir = join(tempDir, '.opencode')
      await mkdir(opencodeDir, { recursive: true })
      await writeFile(
        join(opencodeDir, 'BLOCKERS.template.md'),
        '# Custom {{id}}\n{{question}}\n---\n',
        'utf-8'
      )
      
      // First call - loads custom template
      await appendBlocker(mockFilePath, sampleBlocker, tempDir)
      
      // Modify template AFTER first call (should still use cached version)
      await writeFile(
        join(opencodeDir, 'BLOCKERS.template.md'),
        '# Modified {{id}}\n{{question}}\n---\n',
        'utf-8'
      )
      
      // Second call - should use CACHED custom template (not modified version)
      const blocker2: Blocker = {
        ...sampleBlocker,
        id: 'blocker-2',
      }
      await appendBlocker(mockFilePath, blocker2, tempDir)
      
      const content = await readFile(join(tempDir, mockFilePath), 'utf-8')
      // Should use cached "Custom" format, not "Modified"
      expect(content).toContain('# Custom')
      expect(content).not.toContain('# Modified')
    })

    it('should sanitize markdown in template variables', async () => {
      const maliciousBlocker: Blocker = {
        ...sampleBlocker,
        question: '## Blocker #999\n**Injected Header**',
        context: '```malicious code```\nAnd more ```evil```',
      }
      
      const result = await appendBlocker(mockFilePath, maliciousBlocker, tempDir)
      
      expect(result).toBe(true)
      
      const content = await readFile(join(tempDir, mockFilePath), 'utf-8')
      // Blocker header markers should be escaped
      expect(content).toContain('\\## Blocker #999')
      // Code blocks should be escaped
      expect(content).toContain('\\`\\`\\`malicious code\\`\\`\\`')
      expect(content).toContain('\\`\\`\\`evil\\`\\`\\`')
    })
  })
})
