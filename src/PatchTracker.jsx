import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Plus, Search, X, Trash2, Filter, Calendar, Shield, Server,
  CheckCircle2, FileText, User, Edit3, ArrowUpDown, Bandage,
  Download, Upload, Settings, Cloud, CloudOff, RefreshCw,
  ExternalLink, FolderOpen, Link, Copy, Check, ChevronDown,
  Database, Code, File as FileIcon, AlertCircle, LayoutDashboard, GitCompare, Folder
} from 'lucide-react'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import {
  loadSettings, saveSettings, pushPatches, pullPatches,
  uploadFileToDrive, fetchFileFromDrive, generateAppsScript, extractFolderIdFromUrl, extractSheetIdFromUrl
} from './googleSheets'
import ZipBrowser from './ZipBrowser'
import CrossEnvVerifier from './CrossEnvVerifier'
import PatchConsolidator from './PatchConsolidator'
import ChangePropagator from './ChangePropagator'

/* ── helpers ───────────────────────────────────── */

const uid = (() => { let c = Date.now(); return () => `p_${c++}` })()
const STORAGE_KEY = 'patch_tracker_data'

const ENV_STYLES = {
  Production: { bg: 'bg-rose-500/20', text: 'text-rose-300', dot: 'bg-rose-400' },
  'Pre-Prod':  { bg: 'bg-amber-500/20', text: 'text-amber-300', dot: 'bg-amber-400' },
  SIT:         { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  UAT:         { bg: 'bg-violet-500/20', text: 'text-violet-300', dot: 'bg-violet-400' },
  Dev:         { bg: 'bg-sky-500/20', text: 'text-sky-300', dot: 'bg-sky-400' },
}
const TEST_STYLES = {
  Passed:        { bg: 'bg-emerald-500/20', text: 'text-emerald-300' },
  'In Progress': { bg: 'bg-amber-500/20', text: 'text-amber-300' },
  Failed:        { bg: 'bg-rose-500/20', text: 'text-rose-300' },
  Pending:       { bg: 'bg-neutral-500/20', text: 'text-neutral-400' },
}
const DEPLOY_STYLES = {
  Deployed:    { bg: 'bg-emerald-500/20', text: 'text-emerald-300' },
  'In Queue':  { bg: 'bg-amber-500/20', text: 'text-amber-300' },
  Rolled_Back: { bg: 'bg-rose-500/20', text: 'text-rose-300' },
  Scheduled:   { bg: 'bg-sky-500/20', text: 'text-sky-300' },
}

const ENVIRONMENTS = Object.keys(ENV_STYLES)
const TEST_STATUSES = Object.keys(TEST_STYLES)
const DEPLOY_STATUSES = Object.keys(DEPLOY_STYLES)

function formatDateShort(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function todayStr() { return new Date().toISOString().split('T')[0] }

/** Parse a Windows/Unix path → { name, directory, isDbScript } */
function parsePath(fullPath) {
  const p = fullPath.replace(/\\/g, '/')
  const parts = p.split('/').filter(Boolean)
  const name = parts[parts.length - 1] || ''
  const directory = parts.slice(0, -1).join('/')
  const isDbScript = /dbscript/i.test(p)
  return { name, directory, fullPath, isDbScript }
}

/* ── seed data ─────────────────────────────────── */

const SEED = [
  { id: uid(), name: 'Status API patch', preparedDate: '2026-03-23', releaseDate: '2026-03-23',
    environment: 'Production', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey',
    codeFiles: [{ id: uid(), name: 'RCA_GenBillAmt_Failure_on_RB', oldPath: '', newPath: '', url: '' }],
    dbScripts: [] },
  { id: uid(), name: 'Pre-Prod patch release (KDAC signoff)', preparedDate: '2026-03-02', releaseDate: '2026-03-02',
    environment: 'Pre-Prod', testingStatus: 'In Progress', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', codeFiles: [], dbScripts: [] },
  { id: uid(), name: 'KR200 / STP patch release', preparedDate: '2026-02-12', releaseDate: '2026-02-12',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', codeFiles: [], dbScripts: [] },
  { id: uid(), name: 'RBI optimization patch with STP', preparedDate: '2026-02-11', releaseDate: '2026-02-11',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', codeFiles: [], dbScripts: [] },
  { id: uid(), name: 'STP point patch #8', preparedDate: '2026-02-10', releaseDate: '2026-02-11',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey',
    codeFiles: [{ id: uid(), name: 'KB100084366101072 / LRS API d...', oldPath: '', newPath: '', url: '' }],
    dbScripts: [] },
]

/* ── small UI pieces ───────────────────────────── */

function Badge({ label, styles }) {
  const s = styles || { bg: 'bg-neutral-500/20', text: 'text-neutral-400' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg ${s.bg} ${s.text}`}>
      {s.dot && <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${label === 'In Progress' || label === 'In Queue' ? 'dot-pulse' : ''}`} />}
      {label}
    </span>
  )
}

function StatCard({ icon: Icon, label, value, delay }) {
  return (
    <div className="stat-animate neu-raised-sm flex items-center gap-3 px-4 py-3"
         style={{ animationDelay: `${delay}ms` }}>
      <div className="w-9 h-9 rounded-lg bg-neu-bg flex items-center justify-center"
           style={{ boxShadow: 'inset 2px 2px 5px #111213, inset -2px -2px 5px #252629' }}>
        <Icon size={16} className="text-neu-accent" />
      </div>
      <div>
        <div className="text-lg font-bold text-neu-text">{value}</div>
        <div className="text-[10px] uppercase tracking-widest text-neu-muted font-medium">{label}</div>
      </div>
    </div>
  )
}

function NeuInput({ label, value, onChange, type = 'text', placeholder = '', className = '' }) {
  return (
    <div className={className}>
      {label && <label className="block text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-1.5">{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
             className="w-full pt-input" />
    </div>
  )
}

function NeuSelect({ label, value, onChange, options, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="block text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-1.5">{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full pt-select">
        {options.map(o => <option key={o} value={o}>{o || '— All —'}</option>)}
      </select>
    </div>
  )
}

/* ── file entry component ──────────────────────── */

function FileEntry({ file, onRemove, onUpdate, webAppUrl, patchName, onBrowseZip }) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const isZip = file.name?.toLowerCase().endsWith('.zip')

  const handleUpload = async (e) => {
    const f = e.target.files?.[0]
    if (!f || !webAppUrl) return
    setUploading(true)
    try {
      const result = await uploadFileToDrive(webAppUrl, f, patchName)
      onUpdate({ ...file, name: file.name || result.fileName, url: result.fileUrl, fileId: result.fileId })
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setUploading(false)
    e.target.value = ''
  }

  return (
    <div className="file-item flex items-start gap-3 group">
      <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isZip ? <FolderOpen size={11} className="text-[#4ade80] shrink-0" /> : <FileIcon size={11} className="text-neu-muted shrink-0" />}
          <span className="text-xs font-medium text-neu-text truncate">{file.name || 'Unnamed file'}</span>
          {file.url && (
            <a href={file.url} target="_blank" rel="noopener noreferrer"
               className="text-neu-accent hover:underline text-[10px] flex items-center gap-0.5 shrink-0">
              <ExternalLink size={9} /> Drive
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {/* Browse & Compare for zip files */}
        {isZip && file.url && onBrowseZip && (
          <button onClick={() => onBrowseZip(file)}
                  className="px-2 py-1 rounded-lg text-[10px] font-medium flex items-center gap-1 hover:bg-[#4ade80]/10 transition-colors text-[#4ade80]">
            <GitCompare size={10} /> Browse & Compare
          </button>
        )}
        {webAppUrl && !file.url && (
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="px-2 py-1 rounded-lg text-[10px] font-medium flex items-center gap-1 hover:bg-neu-light transition-colors text-neu-accent"
                  title="Pick file & upload to Drive">
            {uploading
              ? <><RefreshCw size={10} className="animate-spin" /> Uploading...</>
              : <><Upload size={10} /> Upload</>}
          </button>
        )}
        {file.url && !isZip && (
          <span className="text-[10px] text-emerald-400 flex items-center gap-0.5 px-1">
            <CheckCircle2 size={10} /> Uploaded
          </span>
        )}
        <button onClick={onRemove} className="p-1.5 rounded-lg hover:bg-rose-500/15 transition-colors" title="Remove">
          <Trash2 size={12} className="text-rose-400/60" />
        </button>
      </div>
    </div>
  )
}

/* ── file section (code or db scripts) ─────────── */

function FileSection({ label, icon: Icon, files, setFiles, webAppUrl, patchName, onBrowseZip }) {
  const [urlInput, setUrlInput] = useState('')
  const [mode, setMode] = useState('folder') // 'folder' | 'file' | 'url'
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0) // 0-100
  const [dragging, setDragging] = useState(false)
  const fileSectionRef = useRef(null)
  const folderRef = useRef(null)

  // Zip files from FileList and upload to Drive
  const zipAndUpload = async (fileList, folderName) => {
    if (!fileList.length || !webAppUrl) return
    setUploading(true)
    setUploadProgress(0)
    setUploadMsg(`Reading ${fileList.length} files...`)
    try {
      const zip = new JSZip()
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i]
        const path = f.webkitRelativePath || f.name
        zip.file(path, f)
        setUploadProgress(Math.round(((i + 1) / fileList.length) * 30)) // 0-30%
        setUploadMsg(`Reading files... (${i + 1}/${fileList.length})`)
      }
      const zipName = (folderName || patchName || 'patch') + '.zip'
      setUploadMsg('Compressing to zip...')
      setUploadProgress(30)
      const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        // meta.percent goes 0-100, map to 30-70%
        setUploadProgress(30 + Math.round(meta.percent * 0.4))
        setUploadMsg(`Compressing... ${Math.round(meta.percent)}%`)
      })
      setUploadProgress(70)
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(1)
      setUploadMsg(`Uploading ${sizeMB} MB to Drive...`)
      const zipFile = new File([blob], zipName, { type: 'application/zip' })
      const result = await uploadFileToDrive(webAppUrl, zipFile, patchName)
      setUploadProgress(100)
      setUploadMsg('Done!')
      setFiles(prev => [...prev, {
        id: uid(), name: zipName, oldPath: '', newPath: '',
        url: result.fileUrl, fileId: result.fileId,
      }])
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setUploading(false)
    setUploadMsg('')
    setUploadProgress(0)
  }

  // Single file upload (zip or any file)
  const addFromFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const newFile = { id: uid(), name: f.name, oldPath: '', newPath: '', url: '' }
    if (webAppUrl) {
      setUploading(true)
      setUploadMsg('Uploading to Drive...')
      try {
        const result = await uploadFileToDrive(webAppUrl, f, patchName)
        newFile.url = result.fileUrl
        newFile.fileId = result.fileId
        newFile.name = result.fileName || f.name
      } catch (err) {
        alert('Upload failed: ' + err.message)
      }
      setUploading(false)
      setUploadMsg('')
    }
    setFiles(prev => [...prev, newFile])
    e.target.value = ''
  }

  // Folder picker (webkitdirectory)
  const handleFolderSelect = async (e) => {
    const fileList = Array.from(e.target.files || [])
    if (!fileList.length) return
    // Extract root folder name from webkitRelativePath
    const rootName = fileList[0]?.webkitRelativePath?.split('/')[0] || patchName
    await zipAndUpload(fileList, rootName)
    e.target.value = ''
  }

  // Drag and drop
  const handleDrop = async (e) => {
    e.preventDefault()
    setDragging(false)
    const items = e.dataTransfer.items
    if (!items) return

    const allFiles = []
    const readEntry = async (entry, path = '') => {
      if (entry.isFile) {
        const file = await new Promise(res => entry.file(res))
        // Preserve directory structure
        Object.defineProperty(file, 'webkitRelativePath', { value: path + file.name })
        allFiles.push(file)
      } else if (entry.isDirectory) {
        const reader = entry.createReader()
        const entries = await new Promise(res => reader.readEntries(res))
        for (const child of entries) {
          await readEntry(child, path + entry.name + '/')
        }
      }
    }

    for (const item of items) {
      const entry = item.webkitGetAsEntry?.()
      if (entry) await readEntry(entry)
    }

    if (allFiles.length) {
      const rootName = allFiles[0]?.webkitRelativePath?.split('/')[0] || patchName
      await zipAndUpload(allFiles, rootName)
    }
  }

  const addFromUrl = () => {
    if (!urlInput.trim()) return
    const urlName = urlInput.split('/').pop() || 'Linked file'
    setFiles(prev => [...prev, {
      id: uid(), name: urlName, oldPath: '', newPath: '', url: urlInput.trim(),
    }])
    setUrlInput('')
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} className="text-neu-accent" />
        <span className="text-[10px] uppercase tracking-widest text-neu-muted font-medium">{label}</span>
        <span className="text-[10px] text-neu-muted">({files.length})</span>
      </div>

      {/* existing files */}
      {files.length > 0 && (
        <div className="space-y-2 mb-3">
          {files.map(f => (
            <FileEntry key={f.id} file={f} patchName={patchName} webAppUrl={webAppUrl}
                       onRemove={() => setFiles(prev => prev.filter(x => x.id !== f.id))}
                       onUpdate={updated => setFiles(prev => prev.map(x => x.id === f.id ? updated : x))}
                       onBrowseZip={onBrowseZip} />
          ))}
        </div>
      )}

      {/* mode tabs */}
      <div className="space-y-2">
        <div className="inline-flex rounded-lg overflow-hidden" style={{ boxShadow: 'inset 2px 2px 5px #111213, inset -2px -2px 5px #252629' }}>
          {[{k:'folder',l:'Folder'},{k:'file',l:'File'},{k:'url',l:'URL'}].map(({k,l}) => (
            <button key={k} type="button" onClick={() => setMode(k)}
                    className={`px-3 py-1.5 text-[10px] font-medium transition-colors ${
                      mode === k ? 'bg-neu-accent/20 text-neu-accent' : 'bg-neu-bg text-neu-muted'
                    }`}>{l}</button>
          ))}
        </div>

        {/* Folder mode — picker + drag & drop */}
        {mode === 'folder' && (
          <div>
            <input ref={folderRef} type="file" className="hidden" onChange={handleFolderSelect}
                   {...{ webkitdirectory: '', mozdirectory: '', directory: '' }} multiple />
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`rounded-xl border-2 border-dashed transition-all py-5 text-center cursor-pointer ${
                dragging ? 'border-[#4ade80] bg-[#4ade80]/5' : 'border-[#3a3b3f] hover:border-[#4ade80]/40'
              }`}
              onClick={() => !uploading && folderRef.current?.click()}
            >
              {uploading ? (
                <div className="px-6 py-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <RefreshCw size={12} className="animate-spin text-[#4ade80]" />
                      <span className="text-xs text-[#e0e0e0] font-medium">{uploadMsg}</span>
                    </div>
                    <span className="text-[10px] text-[#4ade80] font-mono font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#111213', boxShadow: 'inset 1px 1px 3px #0a0a0c' }}>
                    <div className="h-full rounded-full transition-all duration-300 ease-out"
                         style={{ width: `${uploadProgress}%`, background: 'linear-gradient(90deg, #22c55e, #4ade80)' }} />
                  </div>
                </div>
              ) : (
                <>
                  <Folder size={20} className="text-[#4ade80] mx-auto mb-1" />
                  <p className="text-xs text-[#9ca3af]">
                    <span className="text-[#4ade80] font-medium">Pick folder</span> or drag & drop here
                  </p>
                  <p className="text-[10px] text-[#6b7280] mt-0.5">Auto-zips and uploads to Drive</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* File mode — single file upload */}
        {mode === 'file' && (
          <div>
            <input ref={fileSectionRef} type="file" className="hidden" onChange={addFromFile} />
            <button type="button" onClick={() => fileSectionRef.current?.click()} disabled={uploading}
                    className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors"
                    style={{ boxShadow: 'inset 2px 2px 6px #111213, inset -2px -2px 6px #272a2d', background: '#1b1c1e' }}>
              {uploading
                ? <><RefreshCw size={12} className="animate-spin text-neu-accent" /> {uploadMsg || 'Uploading...'}</>
                : <><Upload size={12} className="text-neu-accent" /> <span className="text-neu-muted">Pick zip or file — uploads to Drive</span></>}
            </button>
          </div>
        )}

        {/* URL mode */}
        {mode === 'url' && (
          <div className="flex gap-2">
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFromUrl() } }}
                   placeholder="https://drive.google.com/..."
                   className="flex-1 pt-input text-xs !py-2 !rounded-lg" />
            <button type="button" onClick={addFromUrl}
                    className="px-3 py-1.5 rounded-lg bg-neu-surface text-neu-accent text-xs font-medium"
                    style={{ boxShadow: '2px 2px 6px #111213, -2px -2px 6px #2e3035' }}>
              <Plus size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── patch create/edit modal ───────────────────── */

function PatchModal({ patch, onSave, onClose, onBrowseZip }) {
  const isEdit = !!patch
  const settings = loadSettings()
  const [form, setForm] = useState(patch || {
    name: '', preparedDate: todayStr(), releaseDate: todayStr(),
    environment: 'SIT', testingStatus: 'Pending', deploymentStatus: 'In Queue',
    responsiblePerson: '', codeFiles: [], dbScripts: [],
  })

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave({ ...form, id: form.id || uid() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-animate"
         onClick={onClose}
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.8)', backdropFilter: 'blur(10px)' }}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
            className="modal-animate w-full max-w-2xl neu-raised p-6 max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-neu-accent">{isEdit ? 'Edit Patch' : 'New Patch'}</h2>
          <button type="button" onClick={onClose}
                  className="p-2 rounded-lg hover:bg-neu-light transition-colors">
            <X size={16} className="text-neu-muted" />
          </button>
        </div>

        <div className="space-y-5">
          <NeuInput label="Patch Name" value={form.name} onChange={v => set('name', v)} placeholder="e.g. Status API patch" />

          <div className="grid grid-cols-2 gap-4">
            <NeuInput label="Prepared Date" type="date" value={form.preparedDate} onChange={v => set('preparedDate', v)} />
            <NeuInput label="Release Date" type="date" value={form.releaseDate} onChange={v => set('releaseDate', v)} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <NeuSelect label="Environment" value={form.environment} onChange={v => set('environment', v)} options={ENVIRONMENTS} />
            <NeuSelect label="Testing" value={form.testingStatus} onChange={v => set('testingStatus', v)} options={TEST_STATUSES} />
            <NeuSelect label="Deployment" value={form.deploymentStatus} onChange={v => set('deploymentStatus', v)} options={DEPLOY_STATUSES} />
          </div>

          <NeuInput label="Responsible Person" value={form.responsiblePerson} onChange={v => set('responsiblePerson', v)} placeholder="e.g. Adarsh Pandey" />

          {/* ── patch files ── */}
          <div className="border-t border-neu-light pt-4">
            <FileSection label="Patch Files" icon={FolderOpen} files={[...form.codeFiles, ...form.dbScripts]}
                         setFiles={newFiles => {
                           // Keep all files in codeFiles for simplicity (Drive-based tracking)
                           set('codeFiles', typeof newFiles === 'function' ? newFiles([...form.codeFiles, ...form.dbScripts]) : newFiles)
                           set('dbScripts', [])
                         }}
                         webAppUrl={settings.webAppUrl} patchName={form.name} onBrowseZip={onBrowseZip} />
            <p className="text-[9px] text-neu-muted mt-2 ml-[21px]">Upload patch folder/zip to Drive — browse & compare files inside</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose} className="pt-btn-outline">Cancel</button>
          <button type="submit" className="pt-btn">{isEdit ? 'Save Changes' : 'Create Patch'}</button>
        </div>
      </form>
    </div>
  )
}

/* ── view toggle ───────────────────────────────── */

function ViewToggle({ view, setView }) {
  return (
    <div className="inline-flex neu-pressed-sm p-1 gap-1">
      {['All Patches', 'Recent'].map(v => (
        <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                  view === v
                    ? 'bg-neu-accent text-neu-dark shadow-md'
                    : 'text-neu-muted hover:text-neu-text'
                }`}>
          {v}
        </button>
      ))}
    </div>
  )
}

/* ── sort button ───────────────────────────────── */

function SortBtn({ column, sortBy, sortDir, onSort }) {
  const active = sortBy === column
  return (
    <button onClick={() => onSort(column)}
            className={`transition-colors ${active ? 'text-neu-accent' : 'text-neu-muted hover:text-neu-text'}`}>
      <ArrowUpDown size={11} />
    </button>
  )
}

/* ── filter dropdown ───────────────────────────── */

function FilterDropdown({ filters, setFilters }) {
  const [open, setOpen] = useState(false)
  const active = filters.environment || filters.testingStatus || filters.deploymentStatus

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                active ? 'neu-raised-sm text-neu-accent' : 'neu-raised-sm text-neu-muted'
              }`}>
        <Filter size={13} />
        Filters
        {active && <span className="w-1.5 h-1.5 rounded-full bg-neu-accent" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 neu-raised p-4 modal-animate">
            <div className="space-y-3">
              <NeuSelect label="Environment" value={filters.environment}
                         onChange={v => setFilters(p => ({ ...p, environment: v }))}
                         options={['', ...ENVIRONMENTS]} />
              <NeuSelect label="Testing Status" value={filters.testingStatus}
                         onChange={v => setFilters(p => ({ ...p, testingStatus: v }))}
                         options={['', ...TEST_STATUSES]} />
              <NeuSelect label="Deployment Status" value={filters.deploymentStatus}
                         onChange={v => setFilters(p => ({ ...p, deploymentStatus: v }))}
                         options={['', ...DEPLOY_STATUSES]} />
              <button onClick={() => { setFilters({ environment: '', testingStatus: '', deploymentStatus: '' }); setOpen(false) }}
                      className="w-full text-[10px] text-neu-muted hover:text-neu-accent transition-colors pt-1">
                Clear all filters
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ── setup / settings modal ────────────────────── */

function SetupGuide({ copied, onCopy }) {
  const [folderUrl, setFolderUrl] = useState('')
  const [scriptGenerated, setScriptGenerated] = useState(false)

  const folderId = folderUrl ? extractFolderIdFromUrl(folderUrl) : ''
  const generatedScript = generateAppsScript(folderId)

  const handleCopyGenerated = () => {
    navigator.clipboard.writeText(generatedScript)
    setScriptGenerated(true)
    setTimeout(() => setScriptGenerated(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Step 1: Paste URLs */}
      <div className="neu-pressed p-4 space-y-3">
        <p className="font-semibold text-neu-accent text-xs">Step 1 — Paste your Google Drive folder URL</p>
        <input value={folderUrl} onChange={e => setFolderUrl(e.target.value)}
               placeholder="https://drive.google.com/drive/folders/..."
               className="w-full pt-input text-xs font-mono" />
        {folderId && (
          <div className="flex items-center gap-2 text-[10px]">
            <Check size={11} className="text-emerald-400" />
            <span className="text-emerald-300">Folder ID extracted: <code className="text-neu-accent bg-neu-dark px-1 py-0.5 rounded">{folderId.slice(0, 20)}...</code></span>
          </div>
        )}
      </div>

      {/* Step 2: Copy generated script */}
      <div className="neu-pressed p-4 space-y-3">
        <p className="font-semibold text-neu-accent text-xs">Step 2 — Copy the auto-generated script</p>
        <p className="text-[10px] text-neu-muted">
          {folderId
            ? 'Script is ready with your folder ID pre-filled. Copy it below.'
            : 'Paste your folder URL above first to generate the script with your folder ID.'}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-neu-muted font-medium">Apps Script Code</span>
          <button onClick={handleCopyGenerated} disabled={!folderId}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all disabled:opacity-30"
                  style={{ boxShadow: '2px 2px 6px #111213, -2px -2px 6px #2e3035' }}>
            {scriptGenerated ? <><Check size={11} className="text-emerald-400" /> Copied!</>
                             : <><Copy size={11} className="text-neu-muted" /> Copy Script</>}
          </button>
        </div>
        <pre className="neu-pressed p-3 text-[9px] text-neu-muted font-mono overflow-x-auto max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed">
          {generatedScript}
        </pre>
      </div>

      {/* Step 3: Deploy instructions */}
      <div className="neu-pressed p-4 space-y-3 text-xs">
        <p className="font-semibold text-neu-accent">Step 3 — Deploy in Google Sheets</p>
        <ol className="list-decimal list-inside space-y-1.5 text-neu-muted text-[11px]">
          <li>Open your Google Spreadsheet</li>
          <li>Go to <strong className="text-neu-text">Extensions → Apps Script</strong></li>
          <li>Delete any existing code, <strong className="text-neu-text">paste the copied script</strong></li>
          <li>Click <strong className="text-neu-text">Deploy → New deployment</strong></li>
          <li>Type: <strong className="text-neu-text">Web app</strong> — Execute as: <strong className="text-neu-text">Me</strong> — Access: <strong className="text-neu-text">Anyone</strong></li>
          <li>Click Deploy, authorize when prompted</li>
          <li><strong className="text-neu-text">Copy the Web App URL</strong> → go to Connect tab → paste it</li>
        </ol>
      </div>

      <div className="neu-pressed-sm p-3 flex items-start gap-2">
        <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-neu-muted">
          <strong className="text-amber-300">No Google Cloud Console needed.</strong> The script only accesses the current spreadsheet and creates files in your specified folder. No delete access. You share the Sheet & folder with your team manually.
        </p>
      </div>
    </div>
  )
}

function SetupModal({ onClose, patches, setPatches }) {
  const [settings, setSettings_] = useState(loadSettings())
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState('')
  const [tab, setTab] = useState('connect') // 'connect' | 'setup'

  const set = (k, v) => setSettings_(prev => ({ ...prev, [k]: v }))

  const handleSaveSettings = () => {
    saveSettings(settings)
    setStatus('Settings saved!')
    setTimeout(() => setStatus(''), 2000)
  }

  const handlePush = async () => {
    if (!settings.webAppUrl) { setStatus('Enter Web App URL first'); return }
    setLoading('push')
    try {
      await pushPatches(settings.webAppUrl, patches)
      setStatus(`Pushed ${patches.length} patches to Google Sheets!`)
    } catch (err) { setStatus(`Push failed: ${err.message}`) }
    setLoading('')
  }

  const handlePull = async () => {
    if (!settings.webAppUrl) { setStatus('Enter Web App URL first'); return }
    setLoading('pull')
    try {
      const pulled = await pullPatches(settings.webAppUrl)
      setPatches(pulled)
      setStatus(`Pulled ${pulled.length} patches from Google Sheets!`)
    } catch (err) { setStatus(`Pull failed: ${err.message}`) }
    setLoading('')
  }



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-animate"
         onClick={onClose}
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.8)', backdropFilter: 'blur(10px)' }}>
      <div onClick={e => e.stopPropagation()}
           className="modal-animate w-full max-w-lg neu-raised p-6 max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-neu-accent flex items-center gap-2">
            <Cloud size={18} /> Google Sheets & Drive
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-neu-light transition-colors">
            <X size={16} className="text-neu-muted" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {[['connect', 'Connect'], ['setup', 'Setup Guide']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                      tab === k ? 'bg-neu-accent/15 text-neu-accent' : 'text-neu-muted hover:text-neu-text'
                    }`}
                    style={tab === k ? {} : { boxShadow: 'inset 2px 2px 5px #111213, inset -2px -2px 5px #252629' }}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'connect' && (
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-1.5">
                Web App URL
              </label>
              <input value={settings.webAppUrl || ''} onChange={e => set('webAppUrl', e.target.value)}
                     placeholder="https://script.google.com/macros/s/.../exec"
                     className="w-full pt-input text-xs font-mono" />
              <p className="text-[9px] text-neu-muted mt-1">
                Get this from Apps Script → Deploy → Web app → URL
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`relative w-9 h-5 rounded-full transition-colors ${settings.autoSync ? 'bg-neu-accent' : 'bg-neu-dark'}`}
                   style={{ boxShadow: 'inset 2px 2px 4px #111213, inset -2px -2px 4px #252629' }}
                   onClick={() => set('autoSync', !settings.autoSync)}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${settings.autoSync ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs text-neu-text">Auto-sync on every change</span>
            </label>

            <button onClick={handleSaveSettings} className="w-full pt-btn-outline">Save Settings</button>

            {settings.webAppUrl && (
              <div className="flex gap-2 pt-2">
                <button onClick={handlePush} disabled={!!loading}
                        className="flex-1 pt-btn-outline flex items-center justify-center gap-2 !text-neu-accent">
                  {loading === 'push' ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
                  Push to Sheets
                </button>
                <button onClick={handlePull} disabled={!!loading}
                        className="flex-1 pt-btn-outline flex items-center justify-center gap-2">
                  {loading === 'pull' ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
                  Pull from Sheets
                </button>
              </div>
            )}

            {status && (
              <div className={`px-3 py-2 rounded-lg text-xs font-medium ${
                status.includes('fail') || status.includes('Error') || status.includes('Enter')
                  ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'
              }`}>{status}</div>
            )}
          </div>
        )}

        {tab === 'setup' && (
          <SetupGuide />
        )}
      </div>
    </div>
  )
}

/* ── data menu ─────────────────────────────────── */

function DataMenu({ patches, setPatches, onOpenSetup }) {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')
  const fileRef = useRef(null)
  const settings = loadSettings()

  const handleExport = () => {
    const COLS = [
      { key: 'name', h: 'Patch Name' }, { key: 'preparedDate', h: 'Prepared Date' },
      { key: 'releaseDate', h: 'Release Date' }, { key: 'environment', h: 'Environment' },
      { key: 'testingStatus', h: 'Testing Status' }, { key: 'deploymentStatus', h: 'Deployment Status' },
      { key: 'responsiblePerson', h: 'Responsible Person' },
      { key: 'codeFiles', h: 'Code Files' }, { key: 'dbScripts', h: 'DB Scripts' },
    ]
    const rows = patches.map(p => Object.fromEntries(COLS.map(c => {
      let val = p[c.key]
      if (Array.isArray(val)) val = val.map(f => f.name + (f.url ? ` (${f.url})` : '')).join('; ')
      return [c.h, val || '']
    })))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = COLS.map(c => ({ wch: Math.max(c.h.length, 22) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Patches')
    XLSX.writeFile(wb, `PatchTracker_${new Date().toISOString().slice(0, 10)}.xlsx`)
    setOpen(false)
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      const imported = rows.map(row => ({
        id: uid(), name: row['Patch Name'] || 'Unnamed',
        preparedDate: row['Prepared Date'] || todayStr(),
        releaseDate: row['Release Date'] || todayStr(),
        environment: row['Environment'] || 'SIT',
        testingStatus: row['Testing Status'] || 'Pending',
        deploymentStatus: row['Deployment Status'] || 'In Queue',
        responsiblePerson: row['Responsible Person'] || '',
        codeFiles: [], dbScripts: [],
      }))
      setPatches(prev => [...imported, ...prev])
      setToast(`Imported ${imported.length} patches`)
    } catch { setToast('Import failed') }
    e.target.value = ''
    setOpen(false)
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div className="relative">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
      <button onClick={() => setOpen(!open)} className="neu-raised-sm flex items-center gap-2 px-3 py-2 text-xs font-medium text-neu-muted">
        <Settings size={13} /> Data
        {settings.webAppUrl && settings.autoSync && <span className="w-1.5 h-1.5 rounded-full bg-neu-accent dot-pulse" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-56 neu-raised overflow-hidden modal-animate">
            <div className="px-3 py-2 border-b border-neu-light">
              <span className="text-[9px] uppercase tracking-widest text-neu-muted font-medium">Excel</span>
            </div>
            <button onClick={handleExport}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-neu-text hover:bg-neu-light transition-colors">
              <Download size={14} className="text-neu-accent" /> Export to Excel
            </button>
            <button onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-neu-text hover:bg-neu-light transition-colors">
              <Upload size={14} className="text-neu-accent" /> Import from Excel
            </button>
            <div className="px-3 py-2 border-t border-b border-neu-light">
              <span className="text-[9px] uppercase tracking-widest text-neu-muted font-medium">Google Sheets & Drive</span>
            </div>
            <button onClick={() => { onOpenSetup(); setOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-neu-text hover:bg-neu-light transition-colors">
              <Cloud size={14} className="text-neu-accent" />
              {settings.webAppUrl ? 'Sync Settings' : 'Connect Google Sheets'}
              {settings.webAppUrl && <span className="ml-auto text-[9px] text-emerald-400">Active</span>}
            </button>
          </div>
        </>
      )}
      {toast && (
        <div className={`absolute right-0 top-full mt-2 z-50 px-3 py-2 rounded-lg text-xs whitespace-nowrap ${
          toast.includes('fail') ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'
        }`}>{toast}</div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════ */

export default function PatchTracker() {
  const [patches, setPatches] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : SEED
    } catch { return SEED }
  })

  const [search, setSearch] = useState('')
  const [view, setView] = useState('All Patches')
  const [showModal, setShowModal] = useState(false)
  const [editPatch, setEditPatch] = useState(null)
  const [sortBy, setSortBy] = useState('releaseDate')
  const [sortDir, setSortDir] = useState('desc')
  const [filters, setFilters] = useState({ environment: '', testingStatus: '', deploymentStatus: '' })
  const [showSetup, setShowSetup] = useState(false)
  const [zipBrowserState, setZipBrowserState] = useState(null) // { zipBlob, zipName }
  const [showCrossEnvVerifier, setShowCrossEnvVerifier] = useState(false)
  const [showConsolidator, setShowConsolidator] = useState(false)
  const [showPropagator, setShowPropagator] = useState(false)
  const [zipLoading, setZipLoading] = useState(false) // loading zip from Drive
  const [zipLoadMsg, setZipLoadMsg] = useState('')
  const [zipLoadProgress, setZipLoadProgress] = useState(0)

  // Persist + auto-sync
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patches))
    const s = loadSettings()
    if (s.autoSync && s.webAppUrl) {
      pushPatches(s.webAppUrl, patches).catch(() => {})
    }
  }, [patches])

  // Browse zip: fetch from Drive and open ZipBrowser
  const handleBrowseZip = useCallback(async (file) => {
    const settings = loadSettings()
    if (!settings.webAppUrl || !file.fileId) {
      if (file.url) {
        setZipLoading(true)
        setZipLoadMsg('Connecting to Drive...')
        setZipLoadProgress(10)
        try {
          const resp = await fetch(file.url)
          setZipLoadMsg('Downloading zip...')
          setZipLoadProgress(40)
          const blob = await resp.blob()
          setZipLoadMsg('Processing...')
          setZipLoadProgress(90)
          setZipBrowserState({ zipBlob: blob, zipName: file.name })
        } catch {
          // Fall through
        }
        setZipLoading(false)
        setZipLoadProgress(0)
        return
      }
      if (!settings.webAppUrl) {
        alert('Configure Google Sheets connection first to browse zip files from Drive')
        return
      }
    }
    setZipLoading(true)
    setZipLoadMsg('Connecting to Apps Script...')
    setZipLoadProgress(10)
    try {
      // Start a progress animation since we can't track actual download %
      const progressInterval = setInterval(() => {
        setZipLoadProgress(prev => {
          if (prev >= 85) { clearInterval(progressInterval); return 85 }
          return prev + 5
        })
      }, 500)
      setZipLoadMsg('Downloading from Drive...')
      setZipLoadProgress(20)
      const blob = await fetchFileFromDrive(settings.webAppUrl, file.fileId)
      clearInterval(progressInterval)
      setZipLoadMsg('Done!')
      setZipLoadProgress(100)
      setZipBrowserState({ zipBlob: blob, zipName: file.name })
    } catch (err) {
      alert('Failed to fetch zip from Drive: ' + err.message)
    }
    setZipLoading(false)
    setZipLoadMsg('')
    setZipLoadProgress(0)
  }, [])

  const handleSort = useCallback((col) => {
    setSortBy(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col }
      setSortDir('desc')
      return col
    })
  }, [])

  const handleSave = useCallback((patch) => {
    setPatches(prev => {
      const idx = prev.findIndex(p => p.id === patch.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = patch; return next }
      return [patch, ...prev]
    })
    setShowModal(false)
    setEditPatch(null)
  }, [])

  const handleDelete = useCallback(id => setPatches(prev => prev.filter(p => p.id !== id)), [])
  const handleEdit = useCallback(patch => { setEditPatch(patch); setShowModal(true) }, [])

  const filteredPatches = useMemo(() => {
    let list = patches
    if (view === 'Recent') {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
      list = list.filter(p => new Date(p.releaseDate) >= cutoff)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.responsiblePerson.toLowerCase().includes(q) ||
        p.environment.toLowerCase().includes(q) ||
        (p.codeFiles || []).some(f => f.name.toLowerCase().includes(q)) ||
        (p.dbScripts || []).some(f => f.name.toLowerCase().includes(q))
      )
    }
    if (filters.environment) list = list.filter(p => p.environment === filters.environment)
    if (filters.testingStatus) list = list.filter(p => p.testingStatus === filters.testingStatus)
    if (filters.deploymentStatus) list = list.filter(p => p.deploymentStatus === filters.deploymentStatus)
    return [...list].sort((a, b) => {
      let av = a[sortBy], bv = b[sortBy]
      if (sortBy.includes('Date')) { av = new Date(av); bv = new Date(bv) }
      else { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase() }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [patches, search, view, filters, sortBy, sortDir])

  const stats = useMemo(() => ({
    total: patches.length,
    deployed: patches.filter(p => p.deploymentStatus === 'Deployed').length,
    passed: patches.filter(p => p.testingStatus === 'Passed').length,
    production: patches.filter(p => p.environment === 'Production').length,
  }), [patches])

  const TABLE_COLS = [
    { key: 'name', label: 'Patch Name', icon: FileText },
    { key: 'preparedDate', label: 'Prepared', icon: Calendar },
    { key: 'releaseDate', label: 'Released', icon: Calendar },
    { key: 'environment', label: 'Environment', icon: Server },
    { key: 'testingStatus', label: 'Testing', icon: Shield },
    { key: 'deploymentStatus', label: 'Deployment', icon: CheckCircle2 },
    { key: 'responsiblePerson', label: 'Responsible', icon: User },
    { key: 'filesChanged', label: 'Files', icon: FolderOpen },
  ]

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-12 max-w-[1440px] mx-auto">

      {/* ── header ── */}
      <header className="header-animate mb-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-neu-surface flex items-center justify-center"
                   style={{ boxShadow: '3px 3px 8px #111213, -3px -3px 8px #2e3035' }}>
                <Bandage size={20} className="text-neu-accent" />
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-neu-text tracking-tight">
                Patch <span className="text-neu-accent">Tracker</span>
              </h1>
              <a
                href={`${import.meta.env.BASE_URL}`}
                className="neu-raised-sm flex items-center gap-2 px-3 py-2 text-xs font-medium text-neu-muted hover:text-green-400 transition-all hover:shadow-lg ml-2"
              >
                <LayoutDashboard size={14} />
                NeuTask
              </a>
            </div>
            <p className="text-xs text-neu-muted mt-1 ml-1">Track deployment patches across environments</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
            <DataMenu patches={patches} setPatches={setPatches} onOpenSetup={() => setShowSetup(true)} />
            <button onClick={() => setShowCrossEnvVerifier(true)} className="pt-btn-outline flex items-center gap-1.5 !text-[11px] !px-3 !py-2">
              <GitCompare size={12} /> Verify Envs
            </button>
            <button onClick={() => setShowConsolidator(true)} className="pt-btn-outline flex items-center gap-1.5 !text-[11px] !px-3 !py-2">
              <Code size={12} /> Consolidate
            </button>
            <button onClick={() => setShowPropagator(true)} className="pt-btn-outline flex items-center gap-1.5 !text-[11px] !px-3 !py-2">
              <Copy size={12} /> Propagate
            </button>
            <button onClick={() => { setEditPatch(null); setShowModal(true) }} className="pt-btn flex items-center gap-2">
              <Plus size={16} strokeWidth={2.5} /> New Patch
            </button>
          </div>
        </div>

        {/* ── stats ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={FileText} label="Total" value={stats.total} delay={100} />
          <StatCard icon={CheckCircle2} label="Deployed" value={stats.deployed} delay={200} />
          <StatCard icon={Shield} label="Passed" value={stats.passed} delay={300} />
          <StatCard icon={Server} label="Production" value={stats.production} delay={400} />
        </div>

        {/* ── toolbar ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <ViewToggle view={view} setView={setView} />
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <FilterDropdown filters={filters} setFilters={setFilters} />
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neu-muted" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patches..."
                     className="pt-input pl-9 pr-8 !py-2 text-xs w-56" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neu-muted hover:text-neu-text">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── table ── */}
      <div className="pt-table-wrapper neu-raised overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-neu-light">
              {TABLE_COLS.map(col => (
                <th key={col.key} className="px-4 py-3 text-[10px] uppercase tracking-widest text-neu-muted font-medium whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <col.icon size={11} className="text-neu-muted opacity-50" />
                    {col.label}
                    <SortBtn column={col.key} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </div>
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filteredPatches.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center text-sm text-neu-muted">
                  {search || filters.environment || filters.testingStatus || filters.deploymentStatus
                    ? 'No patches match your filters' : 'No patches yet. Create your first patch!'}
                </td>
              </tr>
            ) : filteredPatches.map((patch, i) => {
              const filesCount = (patch.codeFiles?.length || 0) + (patch.dbScripts?.length || 0)
              const filesLabel = (patch.codeFiles || []).map(f => f.name).concat((patch.dbScripts || []).map(f => f.name)).join(', ')
              return (
                <tr key={patch.id} className="row-animate table-row-hover border-b border-neu-dark/50 last:border-b-0"
                    style={{ animationDelay: `${i * 40}ms` }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={13} className="text-neu-muted shrink-0" />
                      <span className="text-sm font-medium text-neu-text truncate max-w-[220px]">{patch.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-neu-muted font-mono">{formatDateShort(patch.preparedDate)}</td>
                  <td className="px-4 py-3 text-xs text-neu-muted font-mono">{formatDateShort(patch.releaseDate)}</td>
                  <td className="px-4 py-3"><Badge label={patch.environment} styles={ENV_STYLES[patch.environment]} /></td>
                  <td className="px-4 py-3"><Badge label={patch.testingStatus} styles={TEST_STYLES[patch.testingStatus]} /></td>
                  <td className="px-4 py-3"><Badge label={patch.deploymentStatus} styles={DEPLOY_STYLES[patch.deploymentStatus]} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-neu-bg flex items-center justify-center text-[10px] font-bold text-neu-accent"
                           style={{ boxShadow: 'inset 1px 1px 3px #111213, inset -1px -1px 3px #252629' }}>
                        {patch.responsiblePerson ? patch.responsiblePerson.split(' ').map(n => n[0]).join('') : '?'}
                      </div>
                      <span className="text-xs text-neu-text">{patch.responsiblePerson || '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {filesCount > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-neu-muted truncate max-w-[120px]" title={filesLabel}>
                          <span className="text-neu-accent font-medium">{filesCount}</span> {filesCount === 1 ? 'file' : 'files'}
                        </span>
                        {(patch.codeFiles || []).some(f => f.name?.toLowerCase().endsWith('.zip') && f.url) && (
                          <button onClick={() => {
                            const zipFile = (patch.codeFiles || []).find(f => f.name?.toLowerCase().endsWith('.zip') && f.url)
                            if (zipFile) handleBrowseZip(zipFile)
                          }}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium text-[#4ade80] hover:bg-[#4ade80]/10 transition-colors flex items-center gap-0.5">
                            <GitCompare size={9} /> Compare
                          </button>
                        )}
                      </div>
                    ) : <span className="text-xs text-neu-muted">—</span>}
                  </td>
                  <td className="px-2 py-3">
                    <div className="action-reveal flex items-center gap-1">
                      <button onClick={() => handleEdit(patch)}
                              className="p-1.5 rounded-lg hover:bg-neu-light transition-colors" title="Edit">
                        <Edit3 size={12} className="text-neu-muted" />
                      </button>
                      <button onClick={() => handleDelete(patch.id)}
                              className="p-1.5 rounded-lg hover:bg-rose-500/15 transition-colors" title="Delete">
                        <Trash2 size={12} className="text-rose-400/60" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── footer ── */}
      <div className="mt-4 flex items-center justify-between px-1">
        <span className="text-[10px] text-neu-muted font-mono">{filteredPatches.length} of {patches.length} patches</span>
        <span className="text-[10px] text-neu-muted">
          {loadSettings().webAppUrl ? 'Synced to Google Sheets' : 'localStorage only'}
        </span>
      </div>

      {/* ── modals ── */}
      {showModal && <PatchModal patch={editPatch} onSave={handleSave} onClose={() => { setShowModal(false); setEditPatch(null) }} onBrowseZip={handleBrowseZip} />}
      {showSetup && <SetupModal onClose={() => setShowSetup(false)} patches={patches} setPatches={setPatches} />}
      {zipBrowserState && <ZipBrowser {...zipBrowserState} onClose={() => setZipBrowserState(null)} />}
      {showCrossEnvVerifier && <CrossEnvVerifier patches={patches} onClose={() => setShowCrossEnvVerifier(false)} />}
      {showConsolidator && <PatchConsolidator patches={patches} onClose={() => setShowConsolidator(false)} />}
      {showPropagator && <ChangePropagator patches={patches} onClose={() => setShowPropagator(false)} />}

      {/* Loading overlay for fetching zip from Drive */}
      {zipLoading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center"
             style={{ backgroundColor: 'rgba(10, 10, 14, 0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="flex flex-col items-center gap-4 w-72">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-[#2a2b2f]" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#4ade80] animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <FolderOpen size={18} className="text-[#4ade80]" />
              </div>
            </div>
            <div className="text-center w-full">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-[#e0e0e0]">{zipLoadMsg || 'Fetching from Drive...'}</p>
                <span className="text-[10px] text-[#4ade80] font-mono font-bold">{zipLoadProgress}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#111213', boxShadow: 'inset 1px 1px 3px #0a0a0c' }}>
                <div className="h-full rounded-full transition-all duration-500 ease-out"
                     style={{ width: `${zipLoadProgress}%`, background: 'linear-gradient(90deg, #22c55e, #4ade80)' }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
