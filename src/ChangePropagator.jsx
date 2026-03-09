import { useState, useCallback, useRef } from 'react'
import JSZip from 'jszip'
import { X, Repeat, Check, AlertTriangle, Plus, Minus, Download, Upload, Eye, Loader2, FolderOpen, FileUp, ChevronDown, ChevronRight } from 'lucide-react'
import { parseZipStructure, readFileAsText, isBinaryExt, readFilesFromFileList, readFilesFromZip } from './zipUtils'
import { applyDiff, normalizeLineEndings } from './diffUtils'
import { fetchFileFromDrive, loadSettings } from './googleSheets'
import { consolidatePatches } from './PatchConsolidator'
import DiffViewer from './DiffViewer'

const ENV_STYLES = {
  Production: { bg: 'bg-rose-500/20', text: 'text-rose-300', dot: 'bg-rose-400' },
  'Pre-Prod': { bg: 'bg-amber-500/20', text: 'text-amber-300', dot: 'bg-amber-400' },
  SIT: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  UAT: { bg: 'bg-violet-500/20', text: 'text-violet-300', dot: 'bg-violet-400' },
  Dev: { bg: 'bg-sky-500/20', text: 'text-sky-300', dot: 'bg-sky-400' },
}

const TARGET_ENVS = ['Pre-Prod', 'Production', 'SIT', 'Dev']

export default function ChangePropagator({ patches, onClose }) {
  const [step, setStep] = useState(1) // 1=select source, 2=provide targets, 3=processing, 4=preview
  const [sourceSelected, setSourceSelected] = useState([]) // source patch ids
  const [searchSource, setSearchSource] = useState('')
  const [targets, setTargets] = useState([]) // [{ env, files: { relPath: content }, label }]
  const [targetEnv, setTargetEnv] = useState('Pre-Prod')
  const [progress, setProgress] = useState({ msg: '', pct: 0 })
  const [results, setResults] = useState(null) // [{ env, files: [...], dbScripts }]
  const [diffState, setDiffState] = useState(null)
  const [generating, setGenerating] = useState(null) // env being generated
  const [expanded, setExpanded] = useState({})
  const [dragOver, setDragOver] = useState(false)
  const folderInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const zipInputRef = useRef(null)

  const { webAppUrl } = loadSettings()

  // Source patches (with zip files)
  const eligiblePatches = patches.filter(p =>
    p.codeFiles?.some(f => f.name?.toLowerCase().endsWith('.zip') && (f.fileId || f.url))
  )

  const filteredSource = eligiblePatches.filter(p => {
    if (!searchSource) return true
    const q = searchSource.toLowerCase()
    return p.name?.toLowerCase().includes(q) || p.environment?.toLowerCase().includes(q)
  })

  const toggleSource = (id) => {
    setSourceSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 5 ? [...prev, id] : prev
    )
  }

  // Handle target file upload (zip)
  const handleTargetZip = useCallback(async (files, env) => {
    const file = files[0]
    if (!file) return
    setProgress({ msg: `Reading ${file.name}...`, pct: 0 })
    try {
      const fileMap = await readFilesFromZip(file)
      setTargets(prev => {
        const existing = prev.filter(t => t.env !== env)
        return [...existing, { env, files: fileMap, label: file.name }]
      })
    } catch (err) {
      alert('Failed to read zip: ' + err.message)
    }
    setProgress({ msg: '', pct: 0 })
  }, [])

  // Handle target folder upload
  const handleTargetFolder = useCallback(async (fileList, env) => {
    if (!fileList || fileList.length === 0) return
    setProgress({ msg: 'Reading folder...', pct: 0 })
    try {
      const fileMap = await readFilesFromFileList(fileList)
      const folderName = fileList[0]?.webkitRelativePath?.split('/')[0] || 'folder'
      setTargets(prev => {
        const existing = prev.filter(t => t.env !== env)
        return [...existing, { env, files: fileMap, label: folderName }]
      })
    } catch (err) {
      alert('Failed to read folder: ' + err.message)
    }
    setProgress({ msg: '', pct: 0 })
  }, [])

  // Handle individual files drop/select
  const handleTargetFiles = useCallback(async (fileList, env) => {
    if (!fileList || fileList.length === 0) return
    setProgress({ msg: 'Reading files...', pct: 0 })
    try {
      const fileMap = await readFilesFromFileList(fileList)
      setTargets(prev => {
        const existing = prev.filter(t => t.env !== env)
        return [...existing, { env, files: fileMap, label: `${fileList.length} files` }]
      })
    } catch (err) {
      alert('Failed to read files: ' + err.message)
    }
    setProgress({ msg: '', pct: 0 })
  }, [])

  // Handle drag-and-drop
  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setDragOver(false)
    const items = e.dataTransfer.items
    const files = e.dataTransfer.files

    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
      await handleTargetZip([files[0]], targetEnv)
    } else {
      await handleTargetFiles(files, targetEnv)
    }
  }, [targetEnv, handleTargetZip, handleTargetFiles])

  // Main propagation logic
  const handlePropagate = useCallback(async () => {
    if (sourceSelected.length < 1 || targets.length < 1) return
    setStep(3)

    try {
      // Step 1: Fetch and consolidate source patches
      const zips = []
      const names = []

      for (let i = 0; i < sourceSelected.length; i++) {
        const patch = patches.find(p => p.id === sourceSelected[i])
        names.push(patch.name)
        setProgress({ msg: `Fetching source: ${patch.name}...`, pct: Math.round((i / sourceSelected.length) * 30) })

        const zipFile = patch.codeFiles.find(f => f.name?.toLowerCase().endsWith('.zip') && (f.fileId || f.url))
        if (!zipFile?.fileId) throw new Error(`No zip for "${patch.name}"`)

        const blob = await fetchFileFromDrive(webAppUrl, zipFile.fileId)
        const zip = await JSZip.loadAsync(blob)
        zips.push(zip)
      }

      setProgress({ msg: 'Consolidating source patches...', pct: 35 })
      const consolidated = await consolidatePatches(zips, names)

      // Step 2: For each target environment, apply the consolidated diff
      const envResults = []

      for (let ti = 0; ti < targets.length; ti++) {
        const target = targets[ti]
        setProgress({ msg: `Applying changes to ${target.env}...`, pct: 40 + Math.round((ti / targets.length) * 55) })

        const targetFiles = target.files
        const resultFiles = []

        for (const srcFile of consolidated.files) {
          const rel = srcFile.relativePath
          const ext = rel.split('.').pop()?.toLowerCase()

          if (srcFile.status === 'added') {
            // New file — just include it
            resultFiles.push({
              relativePath: rel,
              fileName: srcFile.fileName,
              status: 'added',
              oldContent: null,
              newContent: srcFile.newContent,
              conflicts: [],
              binary: srcFile.binary,
            })
            continue
          }

          if (srcFile.status === 'deleted') {
            // File deleted in source
            const targetContent = targetFiles[rel]
            resultFiles.push({
              relativePath: rel,
              fileName: srcFile.fileName,
              status: 'deleted',
              oldContent: typeof targetContent === 'string' ? targetContent : srcFile.oldContent,
              newContent: null,
              conflicts: [],
              binary: srcFile.binary,
            })
            continue
          }

          // Modified file — apply diff
          const targetContent = targetFiles[rel]
          if (targetContent == null) {
            // File not found in target
            resultFiles.push({
              relativePath: rel,
              fileName: srcFile.fileName,
              status: 'not_found',
              oldContent: srcFile.oldContent,
              newContent: srcFile.newContent,
              conflicts: [{ reason: `File not found in ${target.env}` }],
              binary: srcFile.binary,
            })
            continue
          }

          if (srcFile.binary || isBinaryExt(ext)) {
            // Binary: copy new version directly
            resultFiles.push({
              relativePath: rel,
              fileName: srcFile.fileName,
              status: 'binary_replaced',
              oldContent: targetContent,
              newContent: srcFile.newContent,
              conflicts: [],
              binary: true,
            })
            continue
          }

          // Text file: apply diff
          const targetStr = typeof targetContent === 'string' ? targetContent : ''
          const { content, conflicts, applied } = applyDiff(
            targetStr,
            srcFile.oldContent || '',
            srcFile.newContent || ''
          )

          resultFiles.push({
            relativePath: rel,
            fileName: srcFile.fileName,
            status: conflicts.length > 0 ? 'conflict' : 'applied',
            oldContent: targetStr,
            newContent: content,
            conflicts,
            applied,
            binary: false,
          })
        }

        // Sort results
        resultFiles.sort((a, b) => {
          const order = { conflict: 0, not_found: 1, applied: 2, added: 3, deleted: 4, binary_replaced: 5 }
          return (order[a.status] ?? 6) - (order[b.status] ?? 6) || a.relativePath.localeCompare(b.relativePath)
        })

        envResults.push({
          env: target.env,
          label: target.label,
          files: resultFiles,
          dbScripts: consolidated.dbScripts,
          stats: {
            applied: resultFiles.filter(f => f.status === 'applied').length,
            conflicts: resultFiles.filter(f => f.status === 'conflict').length,
            added: resultFiles.filter(f => f.status === 'added').length,
            deleted: resultFiles.filter(f => f.status === 'deleted').length,
            notFound: resultFiles.filter(f => f.status === 'not_found').length,
            binary: resultFiles.filter(f => f.status === 'binary_replaced').length,
          }
        })
      }

      setResults(envResults)
      setStep(4)
    } catch (err) {
      setProgress({ msg: `Error: ${err.message}`, pct: 0 })
      setTimeout(() => setStep(2), 3000)
    }
  }, [sourceSelected, targets, patches, webAppUrl])

  const handleGenerateZip = useCallback(async (envResult) => {
    setGenerating(envResult.env)
    try {
      const zip = new JSZip()

      for (const file of envResult.files) {
        if (file.status === 'deleted') {
          // Only old, no new
          if (file.oldContent != null) zip.file(`old/${file.relativePath}`, file.oldContent)
          continue
        }
        if (file.oldContent != null) {
          zip.file(`old/${file.relativePath}`, file.oldContent)
        }
        if (file.newContent != null) {
          zip.file(`new/${file.relativePath}`, file.newContent)
        }
      }

      if (envResult.dbScripts) {
        zip.file('DBScript/consolidated_scripts.sql', envResult.dbScripts)
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${envResult.env.replace(/\s+/g, '_')}_patch.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to generate zip: ' + err.message)
    } finally {
      setGenerating(null)
    }
  }, [])

  const statusBadge = (status) => {
    const map = {
      applied: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Applied' },
      conflict: { bg: 'bg-rose-500/15', text: 'text-rose-400', label: 'Conflict' },
      added: { bg: 'bg-sky-500/15', text: 'text-sky-400', label: 'New File' },
      deleted: { bg: 'bg-rose-500/15', text: 'text-rose-400', label: 'Deleted' },
      not_found: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Not Found' },
      binary_replaced: { bg: 'bg-violet-500/15', text: 'text-violet-400', label: 'Binary' },
    }
    const s = map[status] || { bg: 'bg-[#2a2b2f]', text: 'text-[#6b7280]', label: status }
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg} ${s.text}`}>{s.label}</span>
  }

  return (
    <div className="fixed inset-0 z-[55] flex flex-col backdrop-animate"
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.95)', backdropFilter: 'blur(10px)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2b2f]">
        <div className="flex items-center gap-3">
          <Repeat size={18} className="text-[#4ade80]" />
          <span className="text-sm font-bold text-[#4ade80]">Propagate Changes</span>
          <span className="text-[10px] text-[#6b7280]">
            {step === 1 && 'Step 1: Select source patches'}
            {step === 2 && 'Step 2: Upload target environment files'}
            {step === 3 && 'Processing...'}
            {step === 4 && 'Step 3: Review & Download'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(step === 2 || step === 4) && (
            <button onClick={() => setStep(step === 4 ? 2 : 1)} className="px-3 py-1.5 text-xs text-[#9ca3af] hover:text-white rounded-lg hover:bg-[#272a2d] transition-colors">
              Back
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#272a2d] transition-colors">
            <X size={16} className="text-[#9ca3af]" />
          </button>
        </div>
      </div>

      {/* Step 1: Select Source Patches */}
      {step === 1 && (
        <div className="flex-1 min-h-0 overflow-auto p-5">
          <p className="text-xs text-[#6b7280] mb-4">
            Select the source patches (e.g., UAT) whose changes you want to propagate to other environments.
          </p>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {sourceSelected.map((id, idx) => {
                const p = patches.find(x => x.id === id)
                const env = ENV_STYLES[p?.environment] || ENV_STYLES.Dev
                return (
                  <div key={id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#212225] border border-[#2a2b2f]">
                    <span className="text-[10px] text-[#4ade80] font-mono font-bold">#{idx + 1}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${env.bg} ${env.text}`}>{p?.environment}</span>
                    <span className="text-xs text-[#e0e0e0]">{p?.name}</span>
                    <button onClick={() => toggleSource(id)} className="text-[#6b7280] hover:text-rose-400 ml-1"><X size={12} /></button>
                  </div>
                )
              })}
            </div>
          )}

          <input
            value={searchSource} onChange={e => setSearchSource(e.target.value)}
            placeholder="Search patches..."
            className="w-full mb-4 px-4 py-2.5 rounded-xl text-sm bg-[#1b1c1e] text-[#e0e0e0] border border-[#2a2b2f] outline-none focus:border-[#4ade80]/30"
            style={{ boxShadow: 'inset 2px 2px 6px #111213, inset -2px -2px 6px #272a2d' }}
          />

          <div className="space-y-1.5">
            {filteredSource.map(p => {
              const env = ENV_STYLES[p.environment] || ENV_STYLES.Dev
              const isSelected = sourceSelected.includes(p.id)
              const idx = sourceSelected.indexOf(p.id)
              return (
                <button key={p.id} onClick={() => toggleSource(p.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                    isSelected ? 'bg-[#4ade80]/5 border border-[#4ade80]/20' : 'bg-[#212225] border border-transparent hover:border-[#2a2b2f]'
                  }`}>
                  <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                    isSelected ? 'bg-[#4ade80] text-black' : 'bg-[#2a2b2f] text-[#6b7280]'
                  }`}>{isSelected ? idx + 1 : ''}</div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${env.bg} ${env.text}`}>{p.environment}</span>
                  <span className="text-sm text-[#e0e0e0] flex-1 truncate">{p.name}</span>
                  <span className="text-[10px] text-[#6b7280] font-mono">{p.releaseDate || p.preparedDate}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={() => setStep(2)} disabled={sourceSelected.length < 1} className="pt-btn flex items-center gap-2">
              Next: Upload Target Files <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Upload Target Environment Files */}
      {step === 2 && (
        <div className="flex-1 min-h-0 overflow-auto p-5">
          <p className="text-xs text-[#6b7280] mb-4">
            Upload the current files from the target environment(s). These are NOT patches — just the files as they exist now.
          </p>

          {/* Environment selector */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs text-[#9ca3af]">Target environment:</span>
            <div className="flex gap-1.5">
              {TARGET_ENVS.map(env => {
                const s = ENV_STYLES[env] || ENV_STYLES.Dev
                const hasFiles = targets.some(t => t.env === env)
                return (
                  <button key={env} onClick={() => setTargetEnv(env)}
                    className={`text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all ${
                      targetEnv === env
                        ? `${s.bg} ${s.text} border border-current/20`
                        : hasFiles
                          ? 'bg-[#212225] text-emerald-400 border border-emerald-500/20'
                          : 'bg-[#212225] text-[#6b7280] border border-transparent hover:border-[#2a2b2f]'
                    }`}>
                    {hasFiles && <Check size={8} className="inline mr-1" />}{env}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Uploaded targets summary */}
          {targets.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {targets.map(t => {
                const s = ENV_STYLES[t.env] || ENV_STYLES.Dev
                return (
                  <div key={t.env} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#212225] border border-[#2a2b2f]">
                    <Check size={12} className="text-emerald-400" />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>{t.env}</span>
                    <span className="text-xs text-[#e0e0e0]">{t.label}</span>
                    <span className="text-[10px] text-[#6b7280]">{Object.keys(t.files).length} files</span>
                    <div className="flex-1" />
                    <button onClick={() => setTargets(prev => prev.filter(x => x.env !== t.env))} className="text-[#6b7280] hover:text-rose-400">
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
              dragOver ? 'border-[#4ade80] bg-[#4ade80]/5' : 'border-[#2a2b2f] hover:border-[#3a3b3f]'
            }`}
          >
            <div className="flex flex-col items-center gap-4">
              <Upload size={28} className="text-[#4ade80]/50" />
              <p className="text-sm text-[#9ca3af]">
                Drag & drop files or a zip for <span className="font-bold text-[#e0e0e0]">{targetEnv}</span>
              </p>
              <div className="flex items-center gap-3">
                {/* Zip upload */}
                <input ref={zipInputRef} type="file" accept=".zip" className="hidden"
                       onChange={e => e.target.files?.[0] && handleTargetZip([e.target.files[0]], targetEnv)} />
                <button onClick={() => zipInputRef.current?.click()}
                  className="pt-btn-outline flex items-center gap-1.5 !text-[11px]">
                  <FileUp size={12} /> Upload Zip
                </button>

                {/* Folder upload */}
                <input ref={folderInputRef} type="file" className="hidden"
                       {...{ webkitdirectory: '', directory: '' }}
                       onChange={e => handleTargetFolder(e.target.files, targetEnv)} />
                <button onClick={() => folderInputRef.current?.click()}
                  className="pt-btn-outline flex items-center gap-1.5 !text-[11px]">
                  <FolderOpen size={12} /> Pick Folder
                </button>

                {/* Individual files */}
                <input ref={fileInputRef} type="file" multiple className="hidden"
                       onChange={e => handleTargetFiles(e.target.files, targetEnv)} />
                <button onClick={() => fileInputRef.current?.click()}
                  className="pt-btn-outline flex items-center gap-1.5 !text-[11px]">
                  <Upload size={12} /> Pick Files
                </button>
              </div>
            </div>
          </div>

          {/* Progress during file reading */}
          {progress.msg && (
            <div className="mt-3 text-xs text-[#6b7280] text-center">{progress.msg}</div>
          )}

          {/* Action */}
          <div className="mt-6 flex justify-end">
            <button onClick={handlePropagate} disabled={targets.length < 1}
              className="pt-btn flex items-center gap-2">
              <Repeat size={14} /> Propagate to {targets.length} Environment{targets.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Processing */}
      {step === 3 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-[#2a2b2f]" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#4ade80] animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Repeat size={18} className="text-[#4ade80]" />
            </div>
          </div>
          <div className="w-80 text-center">
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

      {/* Step 4: Preview Results */}
      {step === 4 && results && (
        <div className="flex-1 min-h-0 overflow-auto p-5">
          {results.map((envResult, ei) => {
            const envStyle = ENV_STYLES[envResult.env] || ENV_STYLES.Dev
            const st = envResult.stats
            const envKey = `env_${ei}`
            const isExpanded = expanded[envKey] !== false // default expanded

            return (
              <div key={ei} className="mb-6">
                {/* Environment header */}
                <button onClick={() => setExpanded(prev => ({ ...prev, [envKey]: !isExpanded }))}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#212225] border border-[#2a2b2f] mb-2">
                  {isExpanded ? <ChevronDown size={14} className="text-[#6b7280]" /> : <ChevronRight size={14} className="text-[#6b7280]" />}
                  <span className={`text-xs px-2 py-0.5 rounded ${envStyle.bg} ${envStyle.text} font-medium`}>{envResult.env}</span>
                  <span className="text-xs text-[#9ca3af]">{envResult.label}</span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-2 text-[10px]">
                    {st.applied > 0 && <span className="text-emerald-400">{st.applied} applied</span>}
                    {st.conflicts > 0 && <span className="text-rose-400">{st.conflicts} conflicts</span>}
                    {st.added > 0 && <span className="text-sky-400">{st.added} new</span>}
                    {st.deleted > 0 && <span className="text-rose-300">{st.deleted} deleted</span>}
                    {st.notFound > 0 && <span className="text-amber-400">{st.notFound} not found</span>}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleGenerateZip(envResult) }}
                    disabled={generating === envResult.env}
                    className="pt-btn-outline flex items-center gap-1.5 !text-[10px] !px-3 !py-1.5 ml-3"
                  >
                    {generating === envResult.env ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                    Download
                  </button>
                </button>

                {/* Files */}
                {isExpanded && (
                  <div className="space-y-1 ml-4">
                    {envResult.files.map((file, fi) => (
                      <div key={fi} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#1b1c1e] border border-[#2a2b2f]">
                        <span className="text-[11px] text-[#9ca3af] font-mono flex-1 truncate">{file.relativePath}</span>
                        {file.conflicts?.length > 0 && file.status === 'conflict' && (
                          <span className="text-[9px] text-rose-400">{file.conflicts.length} hunks failed</span>
                        )}
                        {file.applied > 0 && (
                          <span className="text-[9px] text-emerald-400">{file.applied} hunks</span>
                        )}
                        {statusBadge(file.status)}
                        {!file.binary && file.newContent != null && (
                          <button
                            onClick={() => setDiffState({ oldContent: file.oldContent || '', newContent: file.newContent || '', fileName: `${file.fileName} (${envResult.env})` })}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[#4ade80] rounded hover:bg-[#4ade80]/10 transition-colors"
                          >
                            <Eye size={10} /> View
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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
