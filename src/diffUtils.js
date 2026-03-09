/**
 * Shared diff algorithms for cross-env verification, consolidation, and change propagation.
 */

/**
 * Normalize line endings to \n
 */
export function normalizeLineEndings(content) {
  if (!content) return ''
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * LCS-based line diff. Returns { oldDecorations, newDecorations } where each decoration
 * is { line (1-based), type: 'removed'|'added' }.
 * Also returns oldStatus/newStatus arrays ('unchanged'|'removed'|'added') for hunk computation.
 */
export function computeLineDiff(oldLines, newLines) {
  const m = oldLines.length, n = newLines.length

  // For very large files, fall back to simple line-by-line
  if (m * n > 5_000_000) {
    return simpleLineDiff(oldLines, newLines)
  }

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack
  let i = m, j = n
  const oldStatus = new Array(m).fill('removed')
  const newStatus = new Array(n).fill('added')

  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      oldStatus[i - 1] = 'unchanged'
      newStatus[j - 1] = 'unchanged'
      i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  const oldDecorations = []
  const newDecorations = []
  for (let k = 0; k < m; k++) {
    if (oldStatus[k] === 'removed') oldDecorations.push({ line: k + 1, type: 'removed' })
  }
  for (let k = 0; k < n; k++) {
    if (newStatus[k] === 'added') newDecorations.push({ line: k + 1, type: 'added' })
  }

  return { oldDecorations, newDecorations, oldStatus, newStatus }
}

function simpleLineDiff(oldLines, newLines) {
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  const oldDecorations = []
  const newDecorations = []
  const oldStatus = oldLines.map(l => newSet.has(l) ? 'unchanged' : 'removed')
  const newStatus = newLines.map(l => oldSet.has(l) ? 'unchanged' : 'added')

  oldLines.forEach((_, i) => {
    if (oldStatus[i] === 'removed') oldDecorations.push({ line: i + 1, type: 'removed' })
  })
  newLines.forEach((_, i) => {
    if (newStatus[i] === 'added') newDecorations.push({ line: i + 1, type: 'added' })
  })

  return { oldDecorations, newDecorations, oldStatus, newStatus }
}

/**
 * Compute diff hunks from old→new. Each hunk: { oldStart, oldLines[], newLines[], contextBefore[], contextAfter[] }
 */
export function computeHunks(oldContent, newContent) {
  const oldLines = normalizeLineEndings(oldContent).split('\n')
  const newLines = normalizeLineEndings(newContent).split('\n')
  const { oldStatus, newStatus } = computeLineDiff(oldLines, newLines)

  // Walk through both arrays in parallel via LCS alignment
  const aligned = [] // { type: 'unchanged'|'removed'|'added', oldLine?, newLine?, oldIdx?, newIdx? }
  let oi = 0, ni = 0
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && oldStatus[oi] === 'removed') {
      aligned.push({ type: 'removed', line: oldLines[oi], oldIdx: oi })
      oi++
    } else if (ni < newLines.length && newStatus[ni] === 'added') {
      aligned.push({ type: 'added', line: newLines[ni], newIdx: ni })
      ni++
    } else if (oi < oldLines.length && ni < newLines.length) {
      aligned.push({ type: 'unchanged', line: oldLines[oi], oldIdx: oi, newIdx: ni })
      oi++; ni++
    } else if (oi < oldLines.length) {
      aligned.push({ type: 'removed', line: oldLines[oi], oldIdx: oi })
      oi++
    } else {
      aligned.push({ type: 'added', line: newLines[ni], newIdx: ni })
      ni++
    }
  }

  // Group consecutive changed lines into hunks
  const hunks = []
  let i = 0
  while (i < aligned.length) {
    if (aligned[i].type === 'unchanged') { i++; continue }

    // Found a change — collect consecutive removed/added lines
    const hunkOldLines = []
    const hunkNewLines = []
    let oldStart = aligned[i].oldIdx != null ? aligned[i].oldIdx : -1

    while (i < aligned.length && aligned[i].type !== 'unchanged') {
      if (aligned[i].type === 'removed') {
        if (oldStart === -1) oldStart = aligned[i].oldIdx
        hunkOldLines.push(aligned[i].line)
      } else {
        hunkNewLines.push(aligned[i].line)
      }
      i++
    }

    // Gather context lines (3 before, 3 after) for matching
    const contextBefore = []
    const contextAfter = []
    // Find position in aligned array where this hunk started
    let hunkStartIdx = i - hunkOldLines.length - hunkNewLines.length
    for (let c = hunkStartIdx - 1; c >= Math.max(0, hunkStartIdx - 3); c--) {
      if (aligned[c].type === 'unchanged') contextBefore.unshift(aligned[c].line)
    }
    for (let c = i; c < Math.min(aligned.length, i + 3); c++) {
      if (aligned[c].type === 'unchanged') contextAfter.push(aligned[c].line)
    }

    hunks.push({
      oldStart: oldStart >= 0 ? oldStart : 0,
      oldLines: hunkOldLines,
      newLines: hunkNewLines,
      contextBefore,
      contextAfter,
    })
  }

  return hunks
}

/**
 * Compute a diff fingerprint for cross-environment comparison.
 * Two files have the same changes if their fingerprints match.
 */
export function computeDiffFingerprint(oldContent, newContent) {
  const oldNorm = normalizeLineEndings(oldContent)
  const newNorm = normalizeLineEndings(newContent)
  if (oldNorm === newNorm) return { hash: 'IDENTICAL', removed: [], added: [] }

  const oldLines = oldNorm.split('\n')
  const newLines = newNorm.split('\n')
  const { oldDecorations, newDecorations } = computeLineDiff(oldLines, newLines)

  const removed = oldDecorations.map(d => oldLines[d.line - 1])
  const added = newDecorations.map(d => newLines[d.line - 1])

  return {
    hash: JSON.stringify({ removed, added }),
    removed,
    added,
  }
}

/**
 * Apply a diff from source (oldContent→newContent) to a target file.
 * Returns { content: string, conflicts: Hunk[], applied: number }
 */
export function applyDiff(targetContent, sourceOldContent, sourceNewContent) {
  const targetNorm = normalizeLineEndings(targetContent)
  const sourceOldNorm = normalizeLineEndings(sourceOldContent)
  const sourceNewNorm = normalizeLineEndings(sourceNewContent)

  // If source had no changes, return target as-is
  if (sourceOldNorm === sourceNewNorm) {
    return { content: targetContent, conflicts: [], applied: 0 }
  }

  const hunks = computeHunks(sourceOldContent, sourceNewContent)
  const result = targetNorm.split('\n')
  const conflicts = []
  let offset = 0
  let applied = 0

  for (const hunk of hunks) {
    const pos = findLines(result, hunk.oldLines, hunk.oldStart + offset, hunk.contextBefore, hunk.contextAfter)
    if (pos >= 0) {
      result.splice(pos, hunk.oldLines.length, ...hunk.newLines)
      offset += (hunk.newLines.length - hunk.oldLines.length)
      applied++
    } else if (hunk.oldLines.length === 0 && hunk.newLines.length > 0) {
      // Pure addition — find position by context
      const insertPos = findInsertPosition(result, hunk.contextBefore, hunk.contextAfter, hunk.oldStart + offset)
      if (insertPos >= 0) {
        result.splice(insertPos, 0, ...hunk.newLines)
        offset += hunk.newLines.length
        applied++
      } else {
        conflicts.push(hunk)
      }
    } else {
      conflicts.push(hunk)
    }
  }

  return { content: result.join('\n'), conflicts, applied }
}

/**
 * Search for a sequence of lines in the target array.
 * Strategy: exact position → nearby (±20) → global → fuzzy.
 */
function findLines(target, lines, expectedPos, contextBefore, contextAfter) {
  if (lines.length === 0) return -1

  // Strategy 1: exact position
  if (matchAt(target, lines, expectedPos)) return expectedPos

  // Strategy 2: nearby (±20 lines)
  for (let d = 1; d <= 20; d++) {
    if (matchAt(target, lines, expectedPos - d)) return expectedPos - d
    if (matchAt(target, lines, expectedPos + d)) return expectedPos + d
  }

  // Strategy 3: global search
  for (let p = 0; p <= target.length - lines.length; p++) {
    if (matchAt(target, lines, p)) return p
  }

  // Strategy 4: fuzzy match (trimmed whitespace)
  for (let p = 0; p <= target.length - lines.length; p++) {
    if (fuzzyMatchAt(target, lines, p)) return p
  }

  return -1
}

function matchAt(target, lines, pos) {
  if (pos < 0 || pos + lines.length > target.length) return false
  for (let i = 0; i < lines.length; i++) {
    if (target[pos + i] !== lines[i]) return false
  }
  return true
}

function fuzzyMatchAt(target, lines, pos) {
  if (pos < 0 || pos + lines.length > target.length) return false
  for (let i = 0; i < lines.length; i++) {
    if (target[pos + i].trim() !== lines[i].trim()) return false
  }
  return true
}

/**
 * Find insert position for pure additions using context lines.
 */
function findInsertPosition(target, contextBefore, contextAfter, expectedPos) {
  // Try to find contextBefore lines just above expectedPos
  if (contextBefore.length > 0) {
    const lastCtx = contextBefore[contextBefore.length - 1]
    // Search near expected position first
    for (let d = 0; d <= 30; d++) {
      const p = expectedPos - d
      if (p >= 0 && p < target.length && target[p] === lastCtx) return p + 1
      const p2 = expectedPos + d
      if (p2 >= 0 && p2 < target.length && target[p2] === lastCtx) return p2 + 1
    }
    // Global search
    for (let p = 0; p < target.length; p++) {
      if (target[p] === lastCtx) return p + 1
    }
  }

  // Fallback: use expected position
  if (expectedPos >= 0 && expectedPos <= target.length) return expectedPos
  return -1
}
