import { describe, it, expect } from 'bun:test'
import { getProjectBaseDir } from '../../src/utils/project-dir'

describe('getProjectBaseDir', () => {
  it('prefers ctx.worktree when it is a non-root path', () => {
    const ctx = {
      worktree: '/tmp/worktree-a',
      project: { worktree: '/tmp/worktree-b' },
      directory: '/tmp/workdir',
    } as any

    expect(getProjectBaseDir(ctx)).toBe('/tmp/worktree-a')
  })

  it('falls back to project.worktree when ctx.worktree is root', () => {
    const ctx = {
      worktree: '/',
      project: { worktree: '/tmp/project-worktree' },
      directory: '/tmp/workdir',
    } as any

    expect(getProjectBaseDir(ctx)).toBe('/tmp/project-worktree')
  })

  it('falls back to directory when worktree values are root', () => {
    const ctx = {
      worktree: '/',
      project: { worktree: '/' },
      directory: '/tmp/opencode-demo',
    } as any

    expect(getProjectBaseDir(ctx)).toBe('/tmp/opencode-demo')
  })

  it('returns root only when no non-root directory exists', () => {
    const ctx = {
      worktree: '/',
      project: { worktree: '/' },
      directory: '/',
    } as any

    expect(getProjectBaseDir(ctx)).toBe('/')
  })
})
