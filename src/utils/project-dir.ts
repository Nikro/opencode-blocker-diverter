import type { Plugin } from '../types'

/**
 * Resolve the best base directory for project-scoped plugin behavior.
 *
 * Prefer git worktree when available; for global sessions (worktree "/"),
 * fall back to current directory so BLOCKERS.md stays per-project-folder.
 */
export function getProjectBaseDir(ctx: Parameters<Plugin>[0]): string {
  const worktree = typeof ctx.worktree === 'string' ? ctx.worktree : ''
  const projectWorktree = typeof ctx.project?.worktree === 'string' ? ctx.project.worktree : ''
  const directory = typeof ctx.directory === 'string' ? ctx.directory : ''

  if (worktree && worktree !== '/') return worktree
  if (projectWorktree && projectWorktree !== '/') return projectWorktree
  if (directory && directory !== '/') return directory

  return worktree || projectWorktree || directory || '/'
}
