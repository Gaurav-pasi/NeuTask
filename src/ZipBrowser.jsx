import { useState, useEffect, useMemo } from 'react'
import JSZip from 'jszip'
import { X, ChevronRight, ChevronDown, File, FolderOpen, Folder, GitCompare, RefreshCw, Database } from 'lucide-react'
import DiffViewer from './DiffViewer'
import { parseZipStructure, readFileAsText as readFileAsTextUtil, fmtSize } from './zipUtils'

// Build a tree from a list of file paths
function buildTree(paths) {
  const root = { name: '', children: {}, files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children[parts[i]]) {
        node.children[parts[i]] = { name: parts[i], children: {}, files: [] }
      }
      node = node.children[parts[i]]
    }
    node.files.push({ name: parts[parts.length - 1], path })
  }
  return root
}

// Auto-expand all folders in a tree
function autoExpandAll(node, path = '', result = {}) {
  for (const name of Object.keys(node.children)) {
    const fullPath = path ? `${path}/${name}` : name
    result[fullPath] = true
    autoExpandAll(node.children[name], fullPath, result)
  }
  return result
}

export default function ZipBrowser({ zipBlob, zipName, onClose }) {
  const [zip, setZip] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [diffState, setDiffState] = useState(null)
  const [comparing, setComparing] = useState(null)
  const [mode, setMode] = useState('auto')
  // manual mode state
  const [expandedOld, setExpandedOld] = useState({})
  const [expandedNew, setExpandedNew] = useState({})
  const [oldFile, setOldFile] = useState(null)
  const [newFile, setNewFile] = useState(null)
  // JAR browser state
  const [jarBrowser, setJarBrowser] = useState(null) // { oldJar, newJar, jarName, files: [...] }

  useEffect(() => {
    if (!zipBlob) return
    setLoading(true)
    JSZip.loadAsync(zipBlob)
      .then(z => { setZip(z); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [zipBlob])

  // Analyze zip structure
  const { pairs, dbScripts, hasAutoDetect, oldPaths, newPaths } = useMemo(() => {
    if (!zip) return { pairs: [], dbScripts: [], hasAutoDetect: false, oldPaths: [], newPaths: [] }
    return parseZipStructure(zip)
  }, [zip])

  // Build separate trees for manual mode — old files only on left, new files only on right
  const { oldTree, newTree } = useMemo(() => {
    if (!zip || mode !== 'manual') return { oldTree: null, newTree: null }

    const oTree = buildTree(oldPaths)
    const nTree = buildTree(newPaths)

    setExpandedOld(autoExpandAll(oTree))
    setExpandedNew(autoExpandAll(nTree))

    return { oldTree: oTree, newTree: nTree }
  }, [zip, mode, oldPaths, newPaths])

  // If no old/new structure detected, build a full tree for both panes
  const fullTree = useMemo(() => {
    if (!zip || mode !== 'manual' || hasAutoDetect) return null
    const allFiles = []
    zip.forEach((path, entry) => { if (!entry.dir) allFiles.push(path) })
    const tree = buildTree(allFiles)
    setExpandedOld(prev => ({ ...prev, ...autoExpandAll(tree) }))
    setExpandedNew(prev => ({ ...prev, ...autoExpandAll(tree) }))
    return tree
  }, [zip, mode, hasAutoDetect])

  // Extract text files from inside a JAR for comparison
  const readTextFileFromJar = async (jarData, filePath) => {
    const innerZip = await JSZip.loadAsync(jarData)
    const file = innerZip.file(filePath)
    if (!file) return null
    return await file.async('string')
  }

  // Read file as text — delegates to shared utility
  const readFileAsText = async (path) => readFileAsTextUtil(zip, path)

  // Open JAR browser — extract both JARs, find all files, show browsable list
  const handleCompareJarContents = async (pair) => {
    if (!zip) return
    setComparing(pair.relativePath)
    try {
      const [oldData, newData] = await Promise.all([
        pair.oldPath ? zip.file(pair.oldPath).async('uint8array') : null,
        pair.newPath ? zip.file(pair.newPath).async('uint8array') : null,
      ])

      const oldJar = oldData ? await JSZip.loadAsync(oldData) : null
      const newJar = newData ? await JSZip.loadAsync(newData) : null

      const oldEntries = {}
      const newEntries = {}
      if (oldJar) oldJar.forEach((p, e) => { if (!e.dir) oldEntries[p] = { size: e._data?.uncompressedSize || 0 } })
      if (newJar) newJar.forEach((p, e) => { if (!e.dir) newEntries[p] = { size: e._data?.uncompressedSize || 0 } })

      const allPaths = [...new Set([...Object.keys(oldEntries), ...Object.keys(newEntries)])].sort()

      const files = allPaths.map(p => {
        const inOld = p in oldEntries
        const inNew = p in newEntries
        const oldSize = inOld ? oldEntries[p].size : 0
        const newSize = inNew ? newEntries[p].size : 0
        let status = 'unchanged'
        if (inOld && !inNew) status = 'removed'
        else if (!inOld && inNew) status = 'added'
        else if (oldSize !== newSize) status = 'modified'
        return { path: p, fileName: p.split('/').pop(), oldSize, newSize, status, inOld, inNew }
      })

      setJarBrowser({ oldJar, newJar, jarName: pair.fileName, files })
    } catch (err) {
      alert('Failed to open JAR: ' + err.message)
    }
    setComparing(null)
  }

  // Compare a single file from inside two JARs
  const handleCompareJarFile = async (jarFile) => {
    if (!jarBrowser) return
    setComparing(jarFile.path)
    const { oldJar, newJar } = jarBrowser
    const ext = jarFile.fileName.split('.').pop()?.toLowerCase()
    const binaryExts = ['class', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'bmp', 'zip', 'gz',
                         'exe', 'dll', 'so', 'o', 'pdf', 'woff', 'woff2', 'ttf', 'eot']
    try {
      let oldContent = ''
      let newContent = ''

      if (binaryExts.includes(ext)) {
        // Binary: show hex dump
        if (jarFile.inOld && oldJar) {
          const data = await oldJar.file(jarFile.path).async('uint8array')
          oldContent = formatBinaryPreview(data, jarFile.path)
        }
        if (jarFile.inNew && newJar) {
          const data = await newJar.file(jarFile.path).async('uint8array')
          newContent = formatBinaryPreview(data, jarFile.path)
        }
      } else {
        // Text: read as string
        if (jarFile.inOld && oldJar) {
          try { oldContent = await oldJar.file(jarFile.path).async('string') }
          catch { oldContent = '[Could not read as text]' }
        }
        if (jarFile.inNew && newJar) {
          try { newContent = await newJar.file(jarFile.path).async('string') }
          catch { newContent = '[Could not read as text]' }
        }
      }

      setDiffState({ oldContent, newContent, fileName: jarFile.fileName })
    } catch (err) {
      alert('Failed to read file: ' + err.message)
    }
    setComparing(null)
  }

  const formatBinaryPreview = (data, path) => {
    const hexLines = []
    const previewLen = Math.min(data.length, 512)
    for (let i = 0; i < previewLen; i += 16) {
      const hex = Array.from(data.slice(i, Math.min(i + 16, previewLen)))
        .map(b => b.toString(16).padStart(2, '0')).join(' ')
      const ascii = Array.from(data.slice(i, Math.min(i + 16, previewLen)))
        .map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('')
      hexLines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48)}  |${ascii}|`)
    }
    const ext = path.split('.').pop()?.toUpperCase()
    return `[Binary: ${ext}]  Size: ${fmtSize(data.length)}\n\n${hexLines.join('\n')}${data.length > previewLen ? '\n... (' + (data.length - previewLen) + ' more bytes)' : ''}`
  }

  const handleComparePair = async (pair) => {
    if (!zip) return
    // For JAR/WAR/EAR files, use the JAR contents comparison
    const ext = pair.fileName.split('.').pop()?.toLowerCase()
    if (['jar', 'war', 'ear'].includes(ext)) {
      return handleCompareJarContents(pair)
    }
    setComparing(pair.relativePath)
    try {
      const [oldContent, newContent] = await Promise.all([
        readFileAsText(pair.oldPath),
        readFileAsText(pair.newPath),
      ])
      setDiffState({ oldContent, newContent, fileName: pair.fileName })
    } catch (err) {
      alert('Failed to read files: ' + err.message)
    }
    setComparing(null)
  }

  const handleCompareManual = async () => {
    if (!oldFile || !newFile || !zip) return
    setComparing('manual')
    try {
      const [oldContent, newContent] = await Promise.all([
        readFileAsText(oldFile.path),
        readFileAsText(newFile.path),
      ])
      setDiffState({ oldContent, newContent, fileName: newFile.name })
    } catch (err) {
      alert('Failed to read files: ' + err.message)
    }
    setComparing(null)
  }

  const handleViewDB = async (path) => {
    if (!zip) return
    setComparing(path)
    try {
      const content = await zip.file(path).async('string')
      setDiffState({ oldContent: '', newContent: content, fileName: path.split('/').pop() })
    } catch (err) {
      alert('Failed to read file: ' + err.message)
    }
    setComparing(null)
  }

  if (diffState) {
    return <DiffViewer {...diffState} onClose={() => setDiffState(null)} />
  }

  // JAR browser view — shows files inside old/new JARs with compare buttons
  if (jarBrowser) {
    const { files, jarName } = jarBrowser
    const changed = files.filter(f => f.status !== 'unchanged')
    const unchangedCount = files.length - changed.length
    return (
      <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 backdrop-animate"
           style={{ backgroundColor: 'rgba(10, 10, 14, 0.9)', backdropFilter: 'blur(10px)' }}>
        <div className="modal-animate w-full max-w-3xl neu-raised max-h-[90vh] flex flex-col"
             onClick={e => e.stopPropagation()}>
          {/* header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2b2f]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                   style={{ boxShadow: '3px 3px 8px #111213, -3px -3px 8px #2e3035' }}>
                <Database size={16} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[#e0e0e0]">{jarName}</h2>
                <p className="text-[10px] text-[#6b7280]">
                  {files.length} files inside — {changed.length} changed{unchangedCount > 0 ? `, ${unchangedCount} unchanged` : ''}
                </p>
              </div>
            </div>
            <button onClick={() => setJarBrowser(null)} className="p-2 rounded-lg hover:bg-[#272a2d] transition-colors">
              <X size={16} className="text-[#9ca3af]" />
            </button>
          </div>

          {/* file list */}
          <div className="flex-1 overflow-y-auto min-h-0 p-4">
            {/* Changed files first */}
            {changed.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] uppercase tracking-widest text-[#6b7280] font-medium mb-3 px-1">
                  Changed Files
                </div>
                <div className="space-y-1.5">
                  {changed.map(f => (
                    <div key={f.path}
                         className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#222326] transition-colors"
                         style={{ boxShadow: 'inset 1px 1px 3px #111213, inset -1px -1px 3px #2a2b2f' }}>
                      <File size={13} className="text-[#6b7280] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#e0e0e0] truncate">{f.fileName}</p>
                        <p className="text-[10px] text-[#6b7280] truncate">{f.path}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {f.status === 'modified' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                            {fmtSize(f.oldSize)} → {fmtSize(f.newSize)}
                          </span>
                        )}
                        {f.status === 'removed' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-medium">Removed</span>
                        )}
                        {f.status === 'added' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">Added</span>
                        )}
                      </div>
                      <button onClick={() => handleCompareJarFile(f)}
                              disabled={!!comparing}
                              className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all
                                         bg-[#4ade80]/10 text-[#4ade80] hover:bg-[#4ade80]/20 disabled:opacity-50">
                        {comparing === f.path
                          ? <><RefreshCw size={11} className="animate-spin" /> Loading...</>
                          : <><GitCompare size={11} /> Compare</>}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Unchanged files (collapsed) */}
            {unchangedCount > 0 && (
              <div className="text-[10px] text-[#6b7280] px-1 mt-2">
                {unchangedCount} unchanged file{unchangedCount !== 1 ? 's' : ''} not shown
              </div>
            )}
          </div>

          {/* footer */}
          <div className="px-5 py-3 border-t border-[#2a2b2f] flex justify-end">
            <button onClick={() => setJarBrowser(null)} className="pt-btn-outline">Back</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 backdrop-animate"
         onClick={onClose}
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.9)', backdropFilter: 'blur(10px)' }}>
      <div className="modal-animate w-full max-w-3xl neu-raised max-h-[90vh] flex flex-col"
           onClick={e => e.stopPropagation()}>

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2b2f]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ boxShadow: '3px 3px 8px #111213, -3px -3px 8px #2e3035' }}>
              <FolderOpen size={16} className="text-[#4ade80]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#e0e0e0]">{zipName || 'Patch Archive'}</h2>
              <p className="text-[10px] text-[#6b7280]">
                {hasAutoDetect
                  ? `${pairs.length} file${pairs.length !== 1 ? 's' : ''} detected${dbScripts.length ? ` + ${dbScripts.length} DB script${dbScripts.length !== 1 ? 's' : ''}` : ''}`
                  : 'Browse and compare files'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasAutoDetect && (
              <div className="inline-flex rounded-lg overflow-hidden mr-2" style={{ boxShadow: 'inset 2px 2px 5px #111213, inset -2px -2px 5px #252629' }}>
                <button onClick={() => setMode('auto')}
                        className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${mode === 'auto' ? 'bg-[#4ade80]/20 text-[#4ade80]' : 'text-[#6b7280]'}`}>
                  Auto
                </button>
                <button onClick={() => setMode('manual')}
                        className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${mode === 'manual' ? 'bg-[#4ade80]/20 text-[#4ade80]' : 'text-[#6b7280]'}`}>
                  Manual
                </button>
              </div>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#272a2d] transition-colors">
              <X size={16} className="text-[#9ca3af]" />
            </button>
          </div>
        </div>

        {/* loading */}
        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-[#2a2b2f]" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#4ade80] animate-spin" />
              <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-[#4ade80]/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <FolderOpen size={16} className="text-[#4ade80]" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[#e0e0e0]">Extracting archive...</p>
              <p className="text-[10px] text-[#6b7280] mt-1">Reading zip file contents</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex-1 flex items-center justify-center py-16">
            <p className="text-sm text-rose-400">Failed to load zip: {error}</p>
          </div>
        )}

        {/* ═══ AUTO MODE ═══ */}
        {!loading && !error && zip && mode === 'auto' && hasAutoDetect && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {pairs.length > 0 && (
              <div className="p-4">
                <div className="text-[10px] uppercase tracking-widest text-[#6b7280] font-medium mb-3 px-1">
                  Code Files — old vs new
                </div>
                <div className="space-y-1.5">
                  {pairs.map(pair => (
                    <div key={pair.relativePath}
                         className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#222326] transition-colors"
                         style={{ boxShadow: 'inset 1px 1px 3px #111213, inset -1px -1px 3px #2a2b2f' }}>
                      <File size={13} className="text-[#6b7280] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#e0e0e0] truncate">{pair.fileName}</p>
                        <p className="text-[10px] text-[#6b7280] truncate">{pair.relativePath}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {pair.oldPath && pair.newPath && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">Modified</span>
                        )}
                        {pair.oldPath && !pair.newPath && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-medium">Deleted</span>
                        )}
                        {!pair.oldPath && pair.newPath && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">Added</span>
                        )}
                      </div>
                      <button onClick={() => handleComparePair(pair)}
                              disabled={!!comparing}
                              className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all
                                         bg-[#4ade80]/10 text-[#4ade80] hover:bg-[#4ade80]/20 disabled:opacity-50">
                        {comparing === pair.relativePath
                          ? <><RefreshCw size={11} className="animate-spin" /> Loading...</>
                          : <><GitCompare size={11} /> Compare</>}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {dbScripts.length > 0 && (
              <div className="p-4 pt-0">
                <div className="text-[10px] uppercase tracking-widest text-[#6b7280] font-medium mb-3 px-1 flex items-center gap-1.5">
                  <Database size={10} /> DB Scripts
                </div>
                <div className="space-y-1.5">
                  {dbScripts.map(path => {
                    const name = path.split('/').pop()
                    return (
                      <div key={path}
                           className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#222326] transition-colors"
                           style={{ boxShadow: 'inset 1px 1px 3px #111213, inset -1px -1px 3px #2a2b2f' }}>
                        <Database size={13} className="text-amber-400/60 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#e0e0e0] truncate">{name}</p>
                          <p className="text-[10px] text-[#6b7280] truncate">{path}</p>
                        </div>
                        <button onClick={() => handleViewDB(path)}
                                disabled={!!comparing}
                                className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all
                                           bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 disabled:opacity-50">
                          {comparing === path
                            ? <><RefreshCw size={11} className="animate-spin" /> Loading...</>
                            : <><File size={11} /> View</>}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ MANUAL MODE ═══ */}
        {!loading && !error && zip && (mode === 'manual' || !hasAutoDetect) && (
          <>
            <div className="flex items-center gap-4 px-5 py-3 border-b border-[#2a2b2f] bg-[#1a1b1d]">
              <div className="flex-1">
                <span className="text-[10px] uppercase tracking-widest text-rose-400/70 font-medium">Old file: </span>
                <span className="text-xs text-[#e0e0e0] font-mono">{oldFile ? oldFile.name : '— click to select —'}</span>
              </div>
              <div className="flex-1">
                <span className="text-[10px] uppercase tracking-widest text-emerald-400/70 font-medium">New file: </span>
                <span className="text-xs text-[#e0e0e0] font-mono">{newFile ? newFile.name : '— click to select —'}</span>
              </div>
            </div>

            <div className="flex flex-1 min-h-0 overflow-hidden relative">
              {comparing && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
                     style={{ backgroundColor: 'rgba(26, 27, 29, 0.92)' }}>
                  <div className="relative w-14 h-14">
                    <div className="absolute inset-0 rounded-full border-2 border-[#2a2b2f]" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#4ade80] animate-spin" />
                    <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-[#4ade80]/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <GitCompare size={16} className="text-[#4ade80]" />
                    </div>
                  </div>
                  <p className="text-sm font-medium text-[#e0e0e0]">Reading files...</p>
                </div>
              )}

              {/* Left pane — OLD files only */}
              <div className="flex-1 border-r border-[#2a2b2f] overflow-y-auto p-3">
                <div className="text-[10px] uppercase tracking-widest text-rose-400/70 font-medium mb-2 px-1">Select OLD version</div>
                {(hasAutoDetect && oldTree)
                  ? <TreeNode node={oldTree} path="" expanded={expandedOld} toggleExpand={p => setExpandedOld(prev => ({ ...prev, [p]: !prev[p] }))}
                              selected={oldFile?.path} onSelect={f => setOldFile(f)} color="rose" />
                  : fullTree && <TreeNode node={fullTree} path="" expanded={expandedOld} toggleExpand={p => setExpandedOld(prev => ({ ...prev, [p]: !prev[p] }))}
                              selected={oldFile?.path} onSelect={f => setOldFile(f)} color="rose" />
                }
              </div>
              {/* Right pane — NEW files only */}
              <div className="flex-1 overflow-y-auto p-3">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400/70 font-medium mb-2 px-1">Select NEW version</div>
                {(hasAutoDetect && newTree)
                  ? <TreeNode node={newTree} path="" expanded={expandedNew} toggleExpand={p => setExpandedNew(prev => ({ ...prev, [p]: !prev[p] }))}
                              selected={newFile?.path} onSelect={f => setNewFile(f)} color="emerald" />
                  : fullTree && <TreeNode node={fullTree} path="" expanded={expandedNew} toggleExpand={p => setExpandedNew(prev => ({ ...prev, [p]: !prev[p] }))}
                              selected={newFile?.path} onSelect={f => setNewFile(f)} color="emerald" />
                }
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#2a2b2f] flex justify-end gap-3">
              <button onClick={onClose} className="pt-btn-outline">Close</button>
              <button onClick={handleCompareManual} disabled={!oldFile || !newFile || !!comparing}
                      className="pt-btn flex items-center gap-2">
                {comparing
                  ? <><RefreshCw size={14} className="animate-spin" /> Comparing...</>
                  : <><GitCompare size={14} /> Compare Selected</>}
              </button>
            </div>
          </>
        )}

        {/* Footer for auto mode */}
        {!loading && !error && zip && mode === 'auto' && hasAutoDetect && (
          <div className="px-5 py-3 border-t border-[#2a2b2f] flex justify-end">
            <button onClick={onClose} className="pt-btn-outline">Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── recursive file tree node ──────────── */

function TreeNode({ node, path, expanded, toggleExpand, selected, onSelect, color }) {
  const folders = Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b))
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
  const colorClass = color === 'rose' ? 'bg-rose-500/20 ring-rose-500/40' : 'bg-emerald-500/20 ring-emerald-500/40'

  return (
    <div className="text-xs">
      {folders.map(([name, child]) => {
        const fullPath = path ? `${path}/${name}` : name
        const isOpen = expanded[fullPath]
        return (
          <div key={fullPath}>
            <button onClick={() => toggleExpand(fullPath)}
                    className="flex items-center gap-1.5 w-full px-2 py-1 rounded-lg hover:bg-[#272a2d] transition-colors text-left">
              {isOpen ? <ChevronDown size={12} className="text-[#6b7280] shrink-0" /> : <ChevronRight size={12} className="text-[#6b7280] shrink-0" />}
              {isOpen ? <FolderOpen size={12} className="text-[#4ade80] shrink-0" /> : <Folder size={12} className="text-[#4ade80] shrink-0" />}
              <span className="text-[#e0e0e0] font-medium truncate">{name}</span>
            </button>
            {isOpen && (
              <div className="ml-4 border-l border-[#2a2b2f] pl-1">
                <TreeNode node={child} path={fullPath} expanded={expanded} toggleExpand={toggleExpand}
                          selected={selected} onSelect={onSelect} color={color} />
              </div>
            )}
          </div>
        )
      })}
      {files.map(f => (
        <button key={f.path} onClick={() => onSelect(f)}
                className={`flex items-center gap-1.5 w-full px-2 py-1 rounded-lg transition-colors text-left ${
                  selected === f.path ? `${colorClass} ring-1` : 'hover:bg-[#272a2d]'
                }`}>
          <File size={11} className="text-[#6b7280] shrink-0 ml-[18px]" />
          <span className={`truncate ${selected === f.path ? 'text-[#e0e0e0] font-medium' : 'text-[#9ca3af]'}`}>{f.name}</span>
        </button>
      ))}
    </div>
  )
}
