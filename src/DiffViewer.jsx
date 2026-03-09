import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Editor from '@monaco-editor/react'
import { X, Maximize2, Minimize2, GitCompare } from 'lucide-react'
import { computeLineDiff } from './diffUtils'

export default function DiffViewer({ oldContent, newContent, fileName, onClose }) {
  const [editorsReady, setEditorsReady] = useState({ old: false, new: false })
  const oldEditorRef = useRef(null)
  const newEditorRef = useRef(null)
  const oldMonacoRef = useRef(null)
  const newMonacoRef = useRef(null)
  const isSyncing = useRef(false)
  const oldDecorationsRef = useRef([])
  const newDecorationsRef = useRef([])

  const bothReady = editorsReady.old && editorsReady.new

  // Compute diff decorations
  const diffResult = useMemo(() => {
    const oldLines = (oldContent || '').split('\n')
    const newLines = (newContent || '').split('\n')
    return computeLineDiff(oldLines, newLines)
  }, [oldContent, newContent])

  // Apply decorations when editors are ready
  useEffect(() => {
    if (!bothReady) return

    const applyDecorations = () => {
      const oldEditor = oldEditorRef.current
      const newEditor = newEditorRef.current
      if (!oldEditor || !newEditor) return

      // Old editor: highlight removed lines in red
      oldDecorationsRef.current = oldEditor.deltaDecorations(
        oldDecorationsRef.current,
        diffResult.oldDecorations.map(d => ({
          range: new oldMonacoRef.current.Range(d.line, 1, d.line, 1),
          options: {
            isWholeLine: true,
            className: 'diff-line-removed',
            glyphMarginClassName: 'diff-glyph-removed',
          }
        }))
      )

      // New editor: highlight added lines in green
      newDecorationsRef.current = newEditor.deltaDecorations(
        newDecorationsRef.current,
        diffResult.newDecorations.map(d => ({
          range: new newMonacoRef.current.Range(d.line, 1, d.line, 1),
          options: {
            isWholeLine: true,
            className: 'diff-line-added',
            glyphMarginClassName: 'diff-glyph-added',
          }
        }))
      )
    }

    // Apply immediately and after a short delay (for layout settling)
    applyDecorations()
    const t = setTimeout(applyDecorations, 300)
    return () => clearTimeout(t)
  }, [bothReady, diffResult])

  // Synchronized scrolling
  useEffect(() => {
    if (!bothReady) return
    const oldEditor = oldEditorRef.current
    const newEditor = newEditorRef.current
    if (!oldEditor || !newEditor) return

    const d1 = oldEditor.onDidScrollChange((e) => {
      if (isSyncing.current) return
      isSyncing.current = true
      newEditor.setScrollTop(e.scrollTop)
      newEditor.setScrollLeft(e.scrollLeft)
      isSyncing.current = false
    })

    const d2 = newEditor.onDidScrollChange((e) => {
      if (isSyncing.current) return
      isSyncing.current = true
      oldEditor.setScrollTop(e.scrollTop)
      oldEditor.setScrollLeft(e.scrollLeft)
      isSyncing.current = false
    })

    return () => { d1.dispose(); d2.dispose() }
  }, [bothReady])

  const defineTheme = useCallback((monaco) => {
    monaco.editor.defineTheme('neu-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1b1c1e',
        'editor.lineHighlightBackground': '#22242700',
        'editorLineNumber.foreground': '#4a4b4f',
        'editorLineNumber.activeForeground': '#4ade80',
        'scrollbarSlider.background': '#3a3b3f88',
        'scrollbarSlider.hoverBackground': '#4a4b4faa',
      }
    })
  }, [])

  const editorOptions = useMemo(() => ({
    readOnly: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    wrappingStrategy: 'advanced',
    lineNumbers: 'on',
    renderWhitespace: 'all',
    padding: { top: 12 },
    glyphMargin: true,
    folding: false,
    scrollbar: {
      vertical: 'visible',
      horizontal: 'visible',
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
  }), [])

  const language = getLanguage(fileName)

  const handleOldMount = useCallback((editor, monaco) => {
    oldEditorRef.current = editor
    oldMonacoRef.current = monaco
    setEditorsReady(prev => ({ ...prev, old: true }))
  }, [])

  const handleNewMount = useCallback((editor, monaco) => {
    newEditorRef.current = editor
    newMonacoRef.current = monaco
    setEditorsReady(prev => ({ ...prev, new: true }))
  }, [])

  // Stats
  const addedCount = diffResult.newDecorations.length
  const removedCount = diffResult.oldDecorations.length

  return (
    <div className="fixed inset-0 z-[60] flex flex-col backdrop-animate"
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.95)', backdropFilter: 'blur(10px)' }}>

      {/* Inject diff decoration styles */}
      <style>{`
        .diff-line-removed { background: rgba(239, 68, 68, 0.12) !important; }
        .diff-line-added { background: rgba(34, 197, 94, 0.12) !important; }
        .diff-glyph-removed { background: rgba(239, 68, 68, 0.6); width: 3px !important; margin-left: 3px; }
        .diff-glyph-added { background: rgba(34, 197, 94, 0.6); width: 3px !important; margin-left: 3px; }
      `}</style>

      {/* header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2b2f]">
        <div className="flex items-center gap-3">
          <GitCompare size={16} className="text-[#4ade80]" />
          <span className="text-sm font-bold text-[#4ade80]">Compare</span>
          <span className="text-xs text-[#9ca3af] font-mono">{fileName}</span>
          {bothReady && (
            <div className="flex items-center gap-2 ml-3">
              {removedCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">
                  −{removedCount}
                </span>
              )}
              {addedCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                  +{addedCount}
                </span>
              )}
            </div>
          )}
        </div>
        <button onClick={onClose}
                className="p-2 rounded-lg hover:bg-[#272a2d] transition-colors">
          <X size={16} className="text-[#9ca3af]" />
        </button>
      </div>

      {/* labels */}
      <div className="flex border-b border-[#2a2b2f]">
        <div className="flex-1 px-5 py-1.5 text-[10px] uppercase tracking-widest text-rose-400/70 font-medium border-r border-[#2a2b2f]">
          Old Version
        </div>
        <div className="flex-1 px-5 py-1.5 text-[10px] uppercase tracking-widest text-emerald-400/70 font-medium">
          New Version
        </div>
      </div>

      {/* Two side-by-side editors */}
      <div className="flex-1 min-h-0 relative flex">
        {/* Loading overlay */}
        {!bothReady && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
               style={{ backgroundColor: '#1b1c1e' }}>
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-[#2a2b2f]" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#4ade80] animate-spin" />
              <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-[#4ade80]/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <GitCompare size={16} className="text-[#4ade80]" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[#e0e0e0]">Loading diff editor...</p>
              <p className="text-[10px] text-[#6b7280] mt-1">Initializing Monaco Editor</p>
            </div>
          </div>
        )}

        {/* Old (left) editor */}
        <div className="flex-1 min-w-0 border-r border-[#2a2b2f]">
          <Editor
            value={oldContent || ''}
            language={language}
            theme="neu-dark"
            beforeMount={defineTheme}
            onMount={handleOldMount}
            options={editorOptions}
          />
        </div>

        {/* New (right) editor */}
        <div className="flex-1 min-w-0">
          <Editor
            value={newContent || ''}
            language={language}
            theme="neu-dark"
            beforeMount={defineTheme}
            onMount={handleNewMount}
            options={editorOptions}
          />
        </div>
      </div>
    </div>
  )
}

function getLanguage(filename) {
  if (!filename) return 'plaintext'
  const ext = filename.split('.').pop()?.toLowerCase()
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    java: 'java', py: 'python', sql: 'sql', xml: 'xml', html: 'html',
    htm: 'html', xhtml: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell',
    bat: 'bat', cmd: 'bat', ps1: 'powershell',
    properties: 'ini', cfg: 'ini', ini: 'ini', conf: 'ini',
    txt: 'plaintext', log: 'plaintext', csv: 'plaintext',
    md: 'markdown', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp', rb: 'ruby', go: 'go', rs: 'rust',
    php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
    groovy: 'groovy', gradle: 'groovy', scala: 'scala',
    r: 'r', lua: 'lua', perl: 'perl', pl: 'perl',
    jsp: 'html', jspx: 'xml', jsf: 'xml', xsl: 'xml', xslt: 'xml',
    wsdl: 'xml', xsd: 'xml', pom: 'xml', dtd: 'xml',
    dockerfile: 'dockerfile', tf: 'hcl',
  }
  return map[ext] || 'plaintext'
}
