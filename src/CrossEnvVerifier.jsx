import { useState, useCallback } from 'react'
import JSZip from 'jszip'
import { X, GitCompare, Check, AlertTriangle, Minus as MinusIcon, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { parseZipStructure, readFileAsText } from './zipUtils'
import { computeDiffFingerprint } from './diffUtils'
import { fetchFileFromDrive, loadSettings } from './googleSheets'
import DiffViewer from './DiffViewer'

const ENV_STYLES = {
  Production: { bg: 'bg-rose-500/20', text: 'text-rose-300', dot: 'bg-rose-400' },
  'Pre-Prod': { bg: 'bg-amber-500/20', text: 'text-amber-300', dot: 'bg-amber-400' },
  SIT: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  UAT: { bg: 'bg-violet-500/20', text: 'text-violet-300', dot: 'bg-violet-400' },
  Dev: { bg: 'bg-sky-500/20', text: 'text-sky-300', dot: 'bg-sky-400' },
}

export default function CrossEnvVerifier({ patches, onClose }) {
  const [phase, setPhase] = useState('select') // select | processing | results
  const [selected, setSelected] = useState([]) // array of patch ids (max 3, one per env)
  const [search, setSearch] = useState('')
  const [progress, setProgress] = useState({ msg: '', pct: 0 })
  const [results, setResults] = useState(null)
  const [expanded, setExpanded] = useState({}) // expanded file rows
  const [diffState, setDiffState] = useState(null)

  const { webAppUrl } = loadSettings()

  // Filter patches with zip files
  const eligiblePatches = patches.filter(p =>
    p.codeFiles?.some(f => f.name?.toLowerCase().endsWith('.zip') && (f.fileId || f.url))
  )

  const filtered = eligiblePatches.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.name?.toLowerCase().includes(q) || p.environment?.toLowerCase().includes(q)
  })

  const toggleSelect = (patchId) => {
    const patch = patches.find(p => p.id === patchId)
    if (!patch) return

    if (selected.includes(patchId)) {
      setSelected(prev => prev.filter(id => id !== patchId))
      return
    }

    // Enforce one per environment
    const env = patch.environment
    const existingSameEnv = selected.find(id => patches.find(p => p.id === id)?.environment === env)
    if (existingSameEnv) {
      setSelected(prev => [...prev.filter(id => id !== existingSameEnv), patchId])
    } else if (selected.length < 3) {
      setSelected(prev => [...prev, patchId])
    }
  }

  const handleCompare = useCallback(async () => {
    if (selected.length < 2) return
    setPhase('processing')

    try {
      const envData = [] // { env, patchName, zip, parsed }

      for (let i = 0; i < selected.length; i++) {
        const patch = patches.find(p => p.id === selected[i])
        setProgress({ msg: `Fetching ${patch.name}...`, pct: Math.round((i / selected.length) * 50) })

        const zipFile = patch.codeFiles.find(f => f.name?.toLowerCase().endsWith('.zip') && (f.fileId || f.url))
        if (!zipFile?.fileId) throw new Error(`No zip for "${patch.name}"`)

        const blob = await fetchFileFromDrive(webAppUrl, zipFile.fileId)
        const zip = await JSZip.loadAsync(blob)
        const parsed = parseZipStructure(zip)

        envData.push({ env: patch.environment, patchName: patch.name, zip, parsed })
      }

      setProgress({ msg: 'Computing diffs...', pct: 60 })

      // Collect all relative paths
      const allPaths = new Set()
      envData.forEach(ed => ed.parsed.pairs.forEach(p => allPaths.add(p.relativePath)))

      const fileResults = []
      const pathArray = [...allPaths]

      for (let pi = 0; pi < pathArray.length; pi++) {
        const rel = pathArray[pi]
        if (pi % 10 === 0) setProgress({ msg: `Comparing files... (${pi}/${pathArray.length})`, pct: 60 + Math.round((pi / pathArray.length) * 35) })

        const envFingerprints = []

        for (const ed of envData) {
          const pair = ed.parsed.pairs.find(p => p.relativePath === rel)
          if (!pair) {
            envFingerprints.push({ env: ed.env, status: 'missing', fingerprint: null, oldContent: null, newContent: null })
            continue
          }

          try {
            const oldContent = pair.oldPath ? await readFileAsText(ed.zip, pair.oldPath) : ''
            const newContent = pair.newPath ? await readFileAsText(ed.zip, pair.newPath) : ''
            const fp = computeDiffFingerprint(oldContent, newContent)
            envFingerprints.push({ env: ed.env, status: 'ok', fingerprint: fp, oldContent, newContent })
          } catch {
            envFingerprints.push({ env: ed.env, status: 'error', fingerprint: null, oldContent: null, newContent: null })
          }
        }

        // Determine verdict
        const validFps = envFingerprints.filter(e => e.status === 'ok')
        const hasMissing = envFingerprints.some(e => e.status === 'missing' || e.status === 'error')

        let verdict = 'match'
        if (validFps.length === 0) {
          verdict = 'missing'
        } else if (hasMissing && validFps.length < envData.length) {
          verdict = 'missing'
        } else if (validFps.length >= 2) {
          const allSame = validFps.every(e => e.fingerprint.hash === validFps[0].fingerprint.hash)
          verdict = allSame ? 'match' : 'mismatch'
        }

        // Skip files with no changes in any environment
        const allIdentical = validFps.every(e => e.fingerprint?.hash === 'IDENTICAL')
        if (allIdentical && !hasMissing) continue

        fileResults.push({
          relativePath: rel,
          fileName: rel.split('/').pop(),
          verdict,
          environments: envFingerprints,
        })
      }

      // Sort: mismatch first, then missing, then match
      fileResults.sort((a, b) => {
        const order = { mismatch: 0, missing: 1, match: 2 }
        return (order[a.verdict] ?? 3) - (order[b.verdict] ?? 3) || a.relativePath.localeCompare(b.relativePath)
      })

      setResults({
        files: fileResults,
        envs: envData.map(e => e.env),
        matchCount: fileResults.filter(f => f.verdict === 'match').length,
        mismatchCount: fileResults.filter(f => f.verdict === 'mismatch').length,
        missingCount: fileResults.filter(f => f.verdict === 'missing').length,
      })
      setProgress({ msg: 'Done!', pct: 100 })
      setPhase('results')
    } catch (err) {
      setProgress({ msg: `Error: ${err.message}`, pct: 0 })
      setTimeout(() => setPhase('select'), 3000)
    }
  }, [selected, patches, webAppUrl])

  const verdictBadge = (verdict) => {
    const styles = {
      match: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', icon: <Check size={10} />, label: 'Match' },
      mismatch: { bg: 'bg-rose-500/15', text: 'text-rose-400', icon: <X size={10} />, label: 'Mismatch' },
      missing: { bg: 'bg-amber-500/15', text: 'text-amber-400', icon: <AlertTriangle size={10} />, label: 'Missing' },
    }
    const s = styles[verdict]
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg} ${s.text}`}>
        {s.icon} {s.label}
      </span>
    )
  }

  const envStatusIcon = (envEntry) => {
    if (envEntry.status === 'missing') return <MinusIcon size={10} className="text-amber-400" />
    if (envEntry.status === 'error') return <AlertTriangle size={10} className="text-rose-400" />
    if (envEntry.fingerprint?.hash === 'IDENTICAL') return <span className="text-[9px] text-[#6b7280]">No diff</span>
    return <Check size={10} className="text-emerald-400" />
  }

  return (
    <div className="fixed inset-0 z-[55] flex flex-col backdrop-animate"
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.95)', backdropFilter: 'blur(10px)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2b2f]">
        <div className="flex items-center gap-3">
          <GitCompare size={18} className="text-[#4ade80]" />
          <span className="text-sm font-bold text-[#4ade80]">Cross-Environment Verification</span>
        </div>
        <div className="flex items-center gap-2">
          {phase === 'results' && (
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
          <p className="text-xs text-[#6b7280] mb-4">
            Select 2-3 patches from different environments to verify that the code changes are identical.
          </p>

          {/* Selected */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {selected.map(id => {
                const p = patches.find(x => x.id === id)
                const env = ENV_STYLES[p?.environment] || ENV_STYLES.Dev
                return (
                  <div key={id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#212225] border border-[#2a2b2f]">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${env.bg} ${env.text}`}>{p?.environment}</span>
                    <span className="text-xs text-[#e0e0e0]">{p?.name}</span>
                    <button onClick={() => toggleSelect(id)} className="text-[#6b7280] hover:text-rose-400 ml-1"><X size={12} /></button>
                  </div>
                )
              })}
            </div>
          )}

          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patches..."
            className="w-full mb-4 px-4 py-2.5 rounded-xl text-sm bg-[#1b1c1e] text-[#e0e0e0] border border-[#2a2b2f] outline-none focus:border-[#4ade80]/30"
            style={{ boxShadow: 'inset 2px 2px 6px #111213, inset -2px -2px 6px #272a2d' }}
          />

          <div className="space-y-1.5">
            {filtered.map(p => {
              const env = ENV_STYLES[p.environment] || ENV_STYLES.Dev
              const isSelected = selected.includes(p.id)
              return (
                <button key={p.id} onClick={() => toggleSelect(p.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                    isSelected ? 'bg-[#4ade80]/5 border border-[#4ade80]/20' : 'bg-[#212225] border border-transparent hover:border-[#2a2b2f]'
                  }`}>
                  <div className={`w-5 h-5 rounded flex items-center justify-center ${
                    isSelected ? 'bg-[#4ade80]' : 'bg-[#2a2b2f]'
                  }`}>
                    {isSelected && <Check size={12} className="text-black" />}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${env.bg} ${env.text}`}>{p.environment}</span>
                  <span className="text-sm text-[#e0e0e0] flex-1 truncate">{p.name}</span>
                  <span className="text-[10px] text-[#6b7280] font-mono">{p.releaseDate || p.preparedDate}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={handleCompare} disabled={selected.length < 2} className="pt-btn flex items-center gap-2">
              <GitCompare size={14} /> Verify {selected.length} Environments
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
              <GitCompare size={18} className="text-[#4ade80]" />
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

      {/* Phase: Results */}
      {phase === 'results' && results && (
        <div className="flex-1 min-h-0 overflow-auto p-5">
          {/* Summary */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              {results.envs.map(env => {
                const s = ENV_STYLES[env] || ENV_STYLES.Dev
                return <span key={env} className={`text-[10px] px-2 py-0.5 rounded ${s.bg} ${s.text} font-medium`}>{env}</span>
              })}
            </div>
            <div className="flex-1" />
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
              {results.matchCount} Match
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-medium">
              {results.mismatchCount} Mismatch
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
              {results.missingCount} Missing
            </span>
          </div>

          {/* File results */}
          <div className="space-y-1">
            {results.files.map((file, i) => (
              <div key={i}>
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#212225] border border-[#2a2b2f] text-left hover:border-[#3a3b3f] transition-colors"
                >
                  {expanded[i] ? <ChevronDown size={12} className="text-[#6b7280]" /> : <ChevronRight size={12} className="text-[#6b7280]" />}
                  <span className="text-xs text-[#9ca3af] font-mono flex-1 truncate">{file.relativePath}</span>
                  {/* Per-env status */}
                  {file.environments.map((envEntry, ei) => (
                    <div key={ei} className="flex items-center gap-1 min-w-[60px]">
                      {envStatusIcon(envEntry)}
                    </div>
                  ))}
                  {verdictBadge(file.verdict)}
                </button>

                {/* Expanded: show per-env diff details */}
                {expanded[i] && file.verdict === 'mismatch' && (
                  <div className="ml-6 mt-1 mb-2 space-y-1">
                    {file.environments.filter(e => e.status === 'ok' && e.fingerprint?.hash !== 'IDENTICAL').map((envEntry, ei) => {
                      const envStyle = ENV_STYLES[envEntry.env] || ENV_STYLES.Dev
                      return (
                        <div key={ei} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#1b1c1e] border border-[#2a2b2f]">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${envStyle.bg} ${envStyle.text}`}>{envEntry.env}</span>
                          <span className="text-[10px] text-rose-400">-{envEntry.fingerprint.removed.length}</span>
                          <span className="text-[10px] text-emerald-400">+{envEntry.fingerprint.added.length}</span>
                          <div className="flex-1" />
                          <button
                            onClick={() => setDiffState({ oldContent: envEntry.oldContent, newContent: envEntry.newContent, fileName: `${file.fileName} (${envEntry.env})` })}
                            className="text-[10px] text-[#4ade80] hover:underline"
                          >
                            View Diff
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}

            {results.files.length === 0 && (
              <div className="text-center py-12 text-sm text-[#6b7280]">
                No changed files found across selected environments
              </div>
            )}
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
