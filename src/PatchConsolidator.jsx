import { useState, useCallback } from 'react'
import JSZip from 'jszip'
import { X, Layers, ChevronRight, AlertTriangle, Check, Plus, Minus, Download, Upload, Eye, Loader2 } from 'lucide-react'
import { parseZipStructure, readFileAsText, isBinaryExt } from './zipUtils'
import { fetchFileFromDrive, loadSettings } from './googleSheets'
import DiffViewer from './DiffViewer'

const ENV_STYLES = {
  Production: { bg: 'bg-rose-500/20', text: 'text-rose-300', dot: 'bg-rose-400' },
  'Pre-Prod': { bg: 'bg-amber-500/20', text: 'text-amber-300', dot: 'bg-amber-400' },
  SIT: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  UAT: { bg: 'bg-violet-500/20', text: 'text-violet-300', dot: 'bg-violet-400' },
  Dev: { bg: 'bg-sky-500/20', text: 'text-sky-300', dot: 'bg-sky-400' },
}

/**
 * Consolidate patches: merge sequential patches so first's old + last's new = consolidated.
 * Returns { files: [{ relativePath, status, oldContent, newContent }], dbScripts: string, warnings: [] }
 */
export async function consolidatePatches(zips, patchNames) {
  const parsed = zips.map(z => parseZipStructure(z))

  // Collect all relative paths across all patches
  const allPaths = new Set()
  for (const p of parsed) {
    for (const pair of p.pairs) allPaths.add(pair.relativePath)
  }

  const files = []
  const warnings = []

  for (const rel of allPaths) {
    // Find the first patch that has this file in old, and last that has it in new
    let firstOldZip = null, firstOldPath = null
    let lastNewZip = null, lastNewPath = null

    for (let i = 0; i < parsed.length; i++) {
      const pair = parsed[i].pairs.find(p => p.relativePath === rel)
      if (pair) {
        if (pair.oldPath && !firstOldZip) {
          firstOldZip = zips[i]
          firstOldPath = pair.oldPath
        }
        if (pair.newPath) {
          lastNewZip = zips[i]
          lastNewPath = pair.newPath
        }
      }
    }

    // Validate chain: check if Pi.new matches Pi+1.old for sequential patches
    for (let i = 0; i < parsed.length - 1; i++) {
      const currPair = parsed[i].pairs.find(p => p.relativePath === rel)
      const nextPair = parsed[i + 1].pairs.find(p => p.relativePath === rel)
      if (currPair?.newPath && nextPair?.oldPath) {
        try {
          const currNew = await zips[i].file(currPair.newPath).async('string')
          const nextOld = await zips[i + 1].file(nextPair.oldPath).async('string')
          if (currNew !== nextOld) {
            warnings.push(`Chain break: "${rel}" — ${patchNames[i]}'s new differs from ${patchNames[i + 1]}'s old`)
          }
        } catch { /* binary file, skip validation */ }
      }
    }

    // Read content
    let oldContent = null, newContent = null
    const ext = rel.split('.').pop()?.toLowerCase()
    const binary = isBinaryExt(ext)

    if (firstOldPath) {
      oldContent = binary
        ? await firstOldZip.file(firstOldPath).async('uint8array')
        : await readFileAsText(firstOldZip, firstOldPath)
    }
    if (lastNewPath) {
      newContent = binary
        ? await lastNewZip.file(lastNewPath).async('uint8array')
        : await readFileAsText(lastNewZip, lastNewPath)
    }

    // Determine status
    let status = 'modified'
    if (!firstOldPath) status = 'added'
    else if (!lastNewPath) status = 'deleted'
    else if (!binary && oldContent === newContent) status = 'unchanged'

    if (status !== 'unchanged') {
      files.push({ relativePath: rel, fileName: rel.split('/').pop(), status, oldContent, newContent, binary })
    }
  }

  // Consolidate DB scripts
  let dbScriptsContent = ''
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].dbScripts.length > 0) {
      dbScriptsContent += `-- === From Patch: ${patchNames[i]} ===\n\n`
      for (const dbPath of parsed[i].dbScripts) {
        const content = await readFileAsText(zips[i], dbPath)
        dbScriptsContent += content + '\n\n'
      }
    }
  }

  files.sort((a, b) => {
    const order = { deleted: 0, modified: 1, added: 2 }
    return (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.relativePath.localeCompare(b.relativePath)
  })

  return { files, dbScripts: dbScriptsContent, warnings }
}

export default function PatchConsolidator({ patches, onClose }) {
  const [phase, setPhase] = useState('select') // select | processing | preview | generate
  const [selected, setSelected] = useState([]) // ordered array of patch ids
  const [search, setSearch] = useState('')
  const [progress, setProgress] = useState({ msg: '', pct: 0 })
  const [result, setResult] = useState(null) // { files, dbScripts, warnings }
  const [diffState, setDiffState] = useState(null) // { oldContent, newContent, fileName }
  const [generating, setGenerating] = useState(false)

  const { webAppUrl } = loadSettings()

  // Filter patches that have zip files
  const eligiblePatches = patches.filter(p =>
    p.codeFiles?.some(f => f.name?.toLowerCase().endsWith('.zip') && (f.fileId || f.url))
  )

  const filtered = eligiblePatches.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.name?.toLowerCase().includes(q) || p.environment?.toLowerCase().includes(q) || p.responsiblePerson?.toLowerCase().includes(q)
  })

  const toggleSelect = (patchId) => {
    setSelected(prev =>
      prev.includes(patchId)
        ? prev.filter(id => id !== patchId)
        : prev.length < 5 ? [...prev, patchId] : prev
    )
  }

  const handleAnalyze = useCallback(async () => {
    if (selected.length < 2) return
    setPhase('processing')

    try {
      const zips = []
      const names = []

      for (let i = 0; i < selected.length; i++) {
        const patch = patches.find(p => p.id === selected[i])
        names.push(patch.name)
        setProgress({ msg: `Fetching ${patch.name}...`, pct: Math.round((i / selected.length) * 60) })

        const zipFile = patch.codeFiles.find(f => f.name?.toLowerCase().endsWith('.zip') && (f.fileId || f.url))
        if (!zipFile?.fileId) throw new Error(`No zip file found for "${patch.name}"`)

        const blob = await fetchFileFromDrive(webAppUrl, zipFile.fileId)
        const zip = await JSZip.loadAsync(blob)
        zips.push(zip)
      }

      setProgress({ msg: 'Consolidating...', pct: 70 })
      const consolidated = await consolidatePatches(zips, names)

      setProgress({ msg: 'Done!', pct: 100 })
      setResult(consolidated)
      setPhase('preview')
    } catch (err) {
      setProgress({ msg: `Error: ${err.message}`, pct: 0 })
      setTimeout(() => setPhase('select'), 3000)
    }
  }, [selected, patches, webAppUrl])

  const handleGenerate = useCallback(async () => {
    if (!result) return
    setGenerating(true)

    try {
      const zip = new JSZip()

      for (const file of result.files) {
        if (file.oldContent != null) {
          zip.file(`old/${file.relativePath}`, file.oldContent)
        }
        if (file.newContent != null) {
          zip.file(`new/${file.relativePath}`, file.newContent)
        }
      }

      if (result.dbScripts) {
        zip.file('DBScript/consolidated_scripts.sql', result.dbScripts)
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'consolidated_patch.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to generate zip: ' + err.message)
    } finally {
      setGenerating(false)
    }
  }, [result])

  const statusBadge = (status) => {
    const styles = {
      modified: 'bg-amber-500/15 text-amber-400',
      added: 'bg-emerald-500/15 text-emerald-400',
      deleted: 'bg-rose-500/15 text-rose-400',
    }
    const icons = { modified: null, added: <Plus size={10} />, deleted: <Minus size={10} /> }
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${styles[status]}`}>
        {icons[status]} {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-[55] flex flex-col backdrop-animate"
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.95)', backdropFilter: 'blur(10px)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2b2f]">
        <div className="flex items-center gap-3">
          <Layers size={18} className="text-[#4ade80]" />
          <span className="text-sm font-bold text-[#4ade80]">Patch Consolidation</span>
          {phase === 'preview' && (
            <span className="text-[10px] text-[#6b7280]">
              {result?.files.length} files, {result?.warnings.length} warnings
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {phase === 'preview' && (
            <button onClick={() => setPhase('select')} className="px-3 py-1.5 text-xs text-[#9ca3af] hover:text-white rounded-lg hover:bg-[#272a2d] transition-colors">
              Back
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#272a2d] transition-colors">
            <X size={16} className="text-[#9ca3af]" />
          </button>
        </div>
      </div>

      {/* Phase: Select */}
      {phase === 'select' && (
        <div className="flex-1 min-h-0 overflow-auto p-5">
          {/* Selected patches */}
          {selected.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-widest text-[#6b7280] mb-2">
                Selected ({selected.length}) — Order: first = oldest patch
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.map((id, idx) => {
                  const p = patches.find(x => x.id === id)
                  const env = ENV_STYLES[p?.environment] || ENV_STYLES.Dev
                  return (
                    <div key={id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#212225] border border-[#2a2b2f]">
                      <span className="text-[10px] text-[#4ade80] font-mono font-bold">#{idx + 1}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${env.bg} ${env.text}`}>{p?.environment}</span>
                      <span className="text-xs text-[#e0e0e0]">{p?.name}</span>
                      <button onClick={() => toggleSelect(id)} className="text-[#6b7280] hover:text-rose-400 ml-1">
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Search */}
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patches..."
            className="w-full mb-4 px-4 py-2.5 rounded-xl text-sm bg-[#1b1c1e] text-[#e0e0e0] border border-[#2a2b2f] outline-none focus:border-[#4ade80]/30"
            style={{ boxShadow: 'inset 2px 2px 6px #111213, inset -2px -2px 6px #272a2d' }}
          />

          {/* Patch list */}
          <div className="space-y-1.5">
            {filtered.map(p => {
              const env = ENV_STYLES[p.environment] || ENV_STYLES.Dev
              const isSelected = selected.includes(p.id)
              const idx = selected.indexOf(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => toggleSelect(p.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                    isSelected ? 'bg-[#4ade80]/5 border border-[#4ade80]/20' : 'bg-[#212225] border border-transparent hover:border-[#2a2b2f]'
                  }`}
                >
                  <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                    isSelected ? 'bg-[#4ade80] text-black' : 'bg-[#2a2b2f] text-[#6b7280]'
                  }`}>
                    {isSelected ? idx + 1 : ''}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${env.bg} ${env.text}`}>{p.environment}</span>
                  <span className="text-sm text-[#e0e0e0] flex-1 truncate">{p.name}</span>
                  <span className="text-[10px] text-[#6b7280] font-mono">{p.releaseDate || p.preparedDate}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-sm text-[#6b7280]">
                {eligiblePatches.length === 0 ? 'No patches with zip files found' : 'No matches'}
              </div>
            )}
          </div>

          {/* Action */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleAnalyze}
              disabled={selected.length < 2}
              className="pt-btn flex items-center gap-2"
            >
              <Layers size={14} /> Consolidate {selected.length} Patches
            </button>
          </div>
        </div>
      )}

      {/* Phase: Processing */}
      {phase === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-[#2a2b2f]" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#4ade80] animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Layers size={18} className="text-[#4ade80]" />
            </div>
          </div>
          <div className="w-72 text-center">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-[#e0e0e0]">{progress.msg}</p>
              <span className="text-[10px] text-[#4ade80] font-mono font-bold">{progress.pct}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#111213', boxShadow: 'inset 1px 1px 3px #0a0a0c' }}>
              <div className="h-full rounded-full transition-all duration-500 ease-out"
                   style={{ width: `${progress.pct}%`, background: 'linear-gradient(90deg, #22c55e, #4ade80)' }} />
            </div>
          </div>
        </div>
      )}

      {/* Phase: Preview */}
      {phase === 'preview' && result && (
        <div className="flex-1 min-h-0 overflow-auto p-5">
          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-amber-400" />
                <span className="text-xs font-medium text-amber-400">Chain Warnings ({result.warnings.length})</span>
              </div>
              {result.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-300/70 ml-5 mb-0.5">{w}</p>
              ))}
            </div>
          )}

          {/* Summary */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
              {result.files.filter(f => f.status === 'modified').length} Modified
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
              {result.files.filter(f => f.status === 'added').length} Added
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-medium">
              {result.files.filter(f => f.status === 'deleted').length} Deleted
            </span>
          </div>

          {/* Files */}
          <div className="space-y-1.5">
            {result.files.map((file, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#212225] border border-[#2a2b2f]">
                <span className="text-xs text-[#9ca3af] font-mono flex-1 truncate">{file.relativePath}</span>
                {statusBadge(file.status)}
                {!file.binary && file.status !== 'deleted' && (
                  <button
                    onClick={() => setDiffState({ oldContent: file.oldContent || '', newContent: file.newContent || '', fileName: file.fileName })}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-[#4ade80] rounded hover:bg-[#4ade80]/10 transition-colors"
                  >
                    <Eye size={12} /> Compare
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* DB Scripts */}
          {result.dbScripts && (
            <div className="mt-4 p-3 rounded-xl bg-[#212225] border border-[#2a2b2f]">
              <div className="text-[10px] uppercase tracking-widest text-[#6b7280] mb-2">Consolidated DB Scripts</div>
              <pre className="text-[11px] text-[#9ca3af] font-mono max-h-40 overflow-auto whitespace-pre-wrap">{result.dbScripts}</pre>
            </div>
          )}

          {/* Generate */}
          <div className="mt-6 flex justify-end gap-3">
            <button onClick={handleGenerate} disabled={generating} className="pt-btn flex items-center gap-2">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {generating ? 'Generating...' : 'Download Consolidated ZIP'}
            </button>
          </div>
        </div>
      )}

      {/* DiffViewer */}
      {diffState && (
        <DiffViewer
          oldContent={diffState.oldContent}
          newContent={diffState.newContent}
          fileName={diffState.fileName}
          onClose={() => setDiffState(null)}
        />
      )}
    </div>
  )
}
