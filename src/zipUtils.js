/**
 * Shared zip parsing utilities for ZipBrowser, CrossEnvVerifier, PatchConsolidator, ChangePropagator.
 */
import JSZip from 'jszip'

/**
 * Format file size for display
 */
export function fmtSize(n) {
  if (n > 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB'
  if (n > 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

/**
 * Parse a zip's structure to detect old/new pairs and DB scripts.
 * Returns { pairs, dbScripts, hasAutoDetect, oldPaths, newPaths, oldFiles, newFiles }
 */
export function parseZipStructure(zip) {
  const allFiles = []
  zip.forEach((path, entry) => { if (!entry.dir) allFiles.push(path) })

  const oldFiles = {}  // relativePath → full zip path
  const newFiles = {}
  const dbFiles = []
  const oldPathList = []
  const newPathList = []

  for (const path of allFiles) {
    const lower = path.toLowerCase()
    if (lower.includes('dbscript') || lower.includes('db_script') || lower.includes('db script')) {
      dbFiles.push(path)
      continue
    }

    const oldMatch = path.match(/^(.*?)\/(old)\/(.*)/i)
    const newMatch = path.match(/^(.*?)\/(new)\/(.*)/i)

    if (oldMatch) {
      oldFiles[oldMatch[3]] = path
      oldPathList.push(path)
    } else if (newMatch) {
      newFiles[newMatch[3]] = path
      newPathList.push(path)
    }
  }

  const pairList = []
  const allRelativePaths = new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)])
  for (const rel of allRelativePaths) {
    pairList.push({
      relativePath: rel,
      fileName: rel.split('/').pop(),
      oldPath: oldFiles[rel] || null,
      newPath: newFiles[rel] || null,
    })
  }
  pairList.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  return {
    pairs: pairList,
    dbScripts: dbFiles.sort(),
    hasAutoDetect: pairList.length > 0,
    oldPaths: oldPathList,
    newPaths: newPathList,
    oldFiles,
    newFiles,
  }
}

/**
 * Read a file from a JSZip instance as text, with binary/JAR fallback.
 */
export async function readFileAsText(zip, path) {
  if (!path) return ''
  const ext = path.split('.').pop()?.toLowerCase()

  // JAR/WAR/EAR — open as nested zip, list contents
  const archiveExts = ['jar', 'war', 'ear']
  if (archiveExts.includes(ext)) {
    const data = await zip.file(path).async('uint8array')
    return await listJarContents(data, `${ext.toUpperCase()} Archive: ${path.split('/').pop()}`)
  }

  // Binary files — hex dump
  const binaryExts = ['class', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'bmp',
    'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib', 'o',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'woff', 'woff2', 'ttf', 'eot']
  if (binaryExts.includes(ext)) {
    const data = await zip.file(path).async('uint8array')
    const hexLines = []
    const previewLen = Math.min(data.length, 512)
    for (let i = 0; i < previewLen; i += 16) {
      const hex = Array.from(data.slice(i, Math.min(i + 16, previewLen)))
        .map(b => b.toString(16).padStart(2, '0')).join(' ')
      const ascii = Array.from(data.slice(i, Math.min(i + 16, previewLen)))
        .map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('')
      hexLines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48)}  |${ascii}|`)
    }
    return `[Binary: ${ext.toUpperCase()}]  Size: ${fmtSize(data.length)}\nPath: ${path}\n\n${hexLines.join('\n')}${data.length > previewLen ? '\n... (' + (data.length - previewLen) + ' more bytes)' : ''}`
  }

  // Text files
  try {
    return await zip.file(path).async('string')
  } catch {
    const data = await zip.file(path).async('uint8array')
    return `[Binary file - ${data.length} bytes]\nCannot display as text.`
  }
}

/**
 * Generate JAR/WAR contents listing
 */
async function listJarContents(data, label) {
  try {
    const innerZip = await JSZip.loadAsync(data)
    const entries = []
    innerZip.forEach((p, e) => { if (!e.dir) entries.push({ path: p, size: e._data?.uncompressedSize || 0 }) })
    entries.sort((a, b) => a.path.localeCompare(b.path))

    const lines = [`[${label}]`, `Entries: ${entries.length}`, `Total: ${fmtSize(data.length)}`, '']
    let lastDir = ''
    for (const e of entries) {
      const dir = e.path.includes('/') ? e.path.substring(0, e.path.lastIndexOf('/') + 1) : ''
      if (dir !== lastDir) {
        if (lastDir) lines.push('')
        lines.push(`--- ${dir || '(root)'} ---`)
        lastDir = dir
      }
      const name = e.path.split('/').pop()
      lines.push(`  ${name.padEnd(50)} ${fmtSize(e.size).padStart(10)}`)
    }
    return lines.join('\n')
  } catch {
    return `[Failed to read as archive]\nSize: ${fmtSize(data.length)}`
  }
}

/**
 * Check if a file extension is binary
 */
export function isBinaryExt(ext) {
  const binaryExts = ['class', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'bmp',
    'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib', 'o',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'woff', 'woff2', 'ttf', 'eot',
    'jar', 'war', 'ear']
  return binaryExts.includes(ext?.toLowerCase())
}

/**
 * Load a zip from a Blob or File
 */
export async function loadZip(blobOrFile) {
  return await JSZip.loadAsync(blobOrFile)
}

/**
 * Read files from a FileList (drag-drop or folder picker) into a map of { relativePath: content }
 */
export async function readFilesFromFileList(fileList) {
  const files = {}
  for (const file of fileList) {
    // webkitRelativePath has the folder structure, fallback to name
    const path = file.webkitRelativePath || file.name
    // Strip the root folder name from webkitRelativePath (e.g., "MyFolder/com/app/X.java" → "com/app/X.java")
    const parts = path.split('/')
    const relativePath = parts.length > 1 ? parts.slice(1).join('/') : parts[0]
    try {
      const content = await file.text()
      files[relativePath] = content
    } catch {
      // Binary file — read as arraybuffer
      const buf = await file.arrayBuffer()
      files[relativePath] = new Uint8Array(buf)
    }
  }
  return files
}

/**
 * Read files from a zip blob into a flat map { relativePath: content(string) }
 * Strips root folder if all files share the same root.
 */
export async function readFilesFromZip(zipBlob) {
  const zip = await JSZip.loadAsync(zipBlob)
  const files = {}
  const allPaths = []
  zip.forEach((path, entry) => { if (!entry.dir) allPaths.push(path) })

  // Detect common root prefix
  let commonRoot = ''
  if (allPaths.length > 0) {
    const firstParts = allPaths[0].split('/')
    if (firstParts.length > 1) {
      const candidate = firstParts[0] + '/'
      if (allPaths.every(p => p.startsWith(candidate))) {
        commonRoot = candidate
      }
    }
  }

  for (const path of allPaths) {
    const relativePath = commonRoot ? path.slice(commonRoot.length) : path
    const ext = path.split('.').pop()?.toLowerCase()
    if (isBinaryExt(ext)) {
      files[relativePath] = await zip.file(path).async('uint8array')
    } else {
      try {
        files[relativePath] = await zip.file(path).async('string')
      } catch {
        files[relativePath] = await zip.file(path).async('uint8array')
      }
    }
  }
  return files
}
