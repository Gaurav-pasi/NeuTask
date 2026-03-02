import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Search,
  Plus,
  Check,
  Trash2,
  X,
  History,
  LayoutDashboard,
  ChevronDown,
  ChevronUp,
  GripVertical,
} from 'lucide-react'

// ─── LocalStorage helpers ────────────────────────────────────────
const STORAGE_KEY = 'neutask_data'

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

// ─── Default seed data ───────────────────────────────────────────
const seedTasks = [
  {
    id: 1,
    title: 'Project Launch',
    subtasks: [
      { id: 's1', text: 'Finalize presentation', date: 'Today', done: false },
      { id: 's2', text: 'Record demo video', date: 'Oct 28', done: false },
      { id: 's3', text: 'Review analytics', date: 'Oct 28', done: false },
      { id: 's4', text: 'Send announcement email', date: 'Oct 28', done: false },
    ],
  },
  {
    id: 2,
    title: 'Website Redesign',
    subtasks: [
      { id: 's5', text: 'User flows & sketches', date: 'Today', done: false },
      { id: 's6', text: 'Design mockups', date: 'Oct 28', done: false },
      { id: 's7', text: 'Development Sprint 1', date: 'Oct 17', done: false },
    ],
  },
  {
    id: 3,
    title: 'Marketing Campaign',
    subtasks: [
      { id: 's8', text: 'Content planning', date: 'Oct 28', done: false },
      { id: 's9', text: 'Social Media Ad set', date: 'Oct 28', done: false },
    ],
  },
]

function getInitialState() {
  const saved = loadData()
  if (saved && saved.tasks && saved.history) return saved
  return { tasks: seedTasks, history: [] }
}

// ─── ID generator ────────────────────────────────────────────────
let _id = Date.now()
const uid = () => `id_${++_id}`

const formatNow = () =>
  new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const formatDate = () =>
  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// ─── Reorder helper ──────────────────────────────────────────────
function reorder(list, fromIndex, toIndex) {
  const result = [...list]
  const [moved] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, moved)
  return result
}

// ─── Checkbox ────────────────────────────────────────────────────
function NeuCheckbox({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`neu-checkbox ${checked ? 'checked' : ''}`}
      aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
    >
      {checked && <Check size={14} strokeWidth={3} className="text-white" />}
    </button>
  )
}

// ─── Draggable Subtask ───────────────────────────────────────────
function Subtask({ subtask, index, onToggle, onDelete, onDragStart, onDragOver, onDrop }) {
  const isTodayDate = subtask.date === 'Today'

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      className="neu-subtask flex items-center gap-2 px-3 py-3 group cursor-grab active:cursor-grabbing"
    >
      <span className="text-neu-muted/40 group-hover:text-neu-muted transition-colors drag-handle">
        <GripVertical size={14} />
      </span>
      <NeuCheckbox checked={subtask.done} onChange={onToggle} />
      <span
        className={`flex-1 text-sm ${
          subtask.done ? 'line-through text-neu-muted' : 'text-neu-text'
        }`}
      >
        {subtask.text}
      </span>
      <span
        className={`text-xs px-2.5 py-1 rounded-full font-medium ${
          isTodayDate
            ? 'bg-blue-500/15 text-blue-400'
            : 'bg-white/5 text-neu-muted'
        }`}
      >
        {subtask.date}
      </span>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-opacity"
        title="Delete subtask"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Add Subtask Inline ──────────────────────────────────────────
function AddSubtaskInput({ onAdd }) {
  const [text, setText] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    onAdd(text.trim())
    setText('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-1">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a subtask..."
        className="flex-1 bg-transparent text-sm text-neu-text placeholder-neu-muted outline-none neu-pressed-sm px-3 py-2"
      />
      <button
        type="submit"
        className="text-green-400 hover:text-green-300 transition-colors px-2"
        title="Add subtask"
      >
        <Plus size={16} />
      </button>
    </form>
  )
}

// ─── Task Card ───────────────────────────────────────────────────
function TaskCard({
  task,
  index,
  onToggleSubtask,
  onDeleteSubtask,
  onAddSubtask,
  onDeleteTask,
  onReorderSubtasks,
  onTaskDragStart,
  onTaskDragOver,
  onTaskDrop,
}) {
  const completedCount = task.subtasks.filter((s) => s.done).length
  const total = task.subtasks.length
  const computedProgress = total > 0 ? Math.round((completedCount / total) * 100) : 0
  const allDone = total > 0 && completedCount === total

  const dragItem = useRef(null)
  const dragOver = useRef(null)

  const handleSubDragStart = (e, idx) => {
    dragItem.current = idx
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  const handleSubDragOver = (e, idx) => {
    e.preventDefault()
    dragOver.current = idx
    e.stopPropagation()
  }

  const handleSubDrop = (e, idx) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragItem.current === null || dragOver.current === null) return
    if (dragItem.current !== dragOver.current) {
      onReorderSubtasks(task.id, dragItem.current, dragOver.current)
    }
    dragItem.current = null
    dragOver.current = null
  }

  return (
    <div
      draggable
      onDragStart={(e) => onTaskDragStart(e, index)}
      onDragOver={(e) => onTaskDragOver(e, index)}
      onDrop={(e) => onTaskDrop(e, index)}
      className="neu-raised neu-card-hover p-5 flex flex-col gap-4 cursor-grab active:cursor-grabbing"
    >
      {/* Card Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-neu-muted/40">
            <GripVertical size={16} />
          </span>
          <span className="text-lg font-semibold text-neu-text">
            {index + 1}. {task.title}
          </span>
        </div>
        <button
          onClick={() => onDeleteTask(task.id)}
          className="text-neu-muted hover:text-red-400 transition-colors"
          title="Delete task"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Status & Progress */}
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-medium px-3 py-1 rounded-full ${
            allDone
              ? 'bg-green-500/15 text-green-400'
              : computedProgress > 0
                ? 'bg-yellow-500/10 text-yellow-400'
                : 'bg-white/5 text-neu-muted'
          }`}
        >
          {allDone ? 'Completed' : computedProgress > 0 ? `Progress ${computedProgress}%` : 'Not started'}
        </span>
        <span className="text-xs text-neu-muted">
          {completedCount}/{total} done
        </span>
      </div>

      {/* Progress Bar */}
      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${computedProgress}%` }}
        />
      </div>

      {/* Subtasks */}
      <div className="flex flex-col gap-2.5 mt-1">
        {task.subtasks.map((subtask, idx) => (
          <Subtask
            key={subtask.id}
            subtask={subtask}
            index={idx}
            onToggle={() => onToggleSubtask(task.id, subtask.id)}
            onDelete={() => onDeleteSubtask(task.id, subtask.id)}
            onDragStart={handleSubDragStart}
            onDragOver={handleSubDragOver}
            onDrop={handleSubDrop}
          />
        ))}
        <AddSubtaskInput onAdd={(text) => onAddSubtask(task.id, text)} />
      </div>
    </div>
  )
}

// ─── History Card ────────────────────────────────────────────────
function HistoryCard({ task, onRestore, onPermanentDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="neu-raised p-4 flex flex-col gap-3 opacity-75">
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-3 cursor-pointer flex-1"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="neu-checkbox checked w-5 h-5">
            <Check size={12} strokeWidth={3} className="text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-neu-muted line-through">
              {task.title}
            </span>
            <span className="text-[10px] text-neu-muted/50">
              {task.completedAt}
            </span>
          </div>
          {expanded ? (
            <ChevronUp size={14} className="text-neu-muted" />
          ) : (
            <ChevronDown size={14} className="text-neu-muted" />
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onRestore(task.id)}
            className="text-xs text-green-400/70 hover:text-green-400 transition-colors"
            title="Restore to dashboard"
          >
            Restore
          </button>
          <button
            onClick={() => onPermanentDelete(task.id)}
            className="text-neu-muted hover:text-red-400 transition-colors"
            title="Delete permanently"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="flex flex-col gap-1.5 pl-8">
          {task.subtasks.map((st) => (
            <span key={st.id} className="text-xs text-neu-muted line-through">
              {st.text}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Create Task Modal ───────────────────────────────────────────
function CreateTaskModal({ onClose, onCreate }) {
  const [title, setTitle] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onCreate(title.trim())
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="neu-raised p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-neu-text">New Task</h2>
          <button
            onClick={onClose}
            className="text-neu-muted hover:text-neu-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task name..."
            autoFocus
            className="bg-transparent text-neu-text placeholder-neu-muted outline-none neu-pressed px-4 py-3 text-sm"
          />
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium text-sm hover:from-green-400 hover:to-emerald-500 transition-all"
          >
            Create Task
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Top Bar ─────────────────────────────────────────────────────
function TopBar({
  doneCount,
  totalCount,
  searchQuery,
  setSearchQuery,
  onAddTask,
  view,
  setView,
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
      {/* Title */}
      <h1 className="text-3xl font-bold tracking-tight text-neu-text text-shadow-soft flex-shrink-0">
        NeuTask
      </h1>

      {/* Controls */}
      <div className="flex items-center gap-4 flex-1 justify-end flex-wrap">
        {/* View Toggle */}
        <div className="neu-pressed-sm flex p-1 gap-1">
          <button
            onClick={() => setView('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              view === 'dashboard'
                ? 'bg-neu-light text-green-400 shadow-md'
                : 'text-neu-muted hover:text-neu-text'
            }`}
          >
            <LayoutDashboard size={14} />
            Tasks
          </button>
          <button
            onClick={() => setView('history')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              view === 'history'
                ? 'bg-neu-light text-green-400 shadow-md'
                : 'text-neu-muted hover:text-neu-text'
            }`}
          >
            <History size={14} />
            History
          </button>
        </div>

        {/* Stats */}
        <span className="text-sm font-medium text-neu-muted whitespace-nowrap">
          <span className="text-green-400 font-semibold">{doneCount}</span>
          <span>/{totalCount}</span> Done
        </span>

        {/* Search */}
        <div className="neu-pressed flex items-center gap-2 px-4 py-2.5 w-52">
          <Search size={16} className="text-neu-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent outline-none text-sm text-neu-text placeholder-neu-muted w-full"
          />
        </div>

        {/* Add Button */}
        <button
          onClick={onAddTask}
          className="w-11 h-11 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center glow-green hover:scale-105 transition-transform flex-shrink-0 cursor-pointer"
          title="Create new task"
        >
          <Plus size={22} strokeWidth={2.5} className="text-white" />
        </button>
      </div>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(getInitialState)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [view, setView] = useState('dashboard')

  const { tasks, history } = state

  // Persist on every change
  useEffect(() => {
    saveData(state)
  }, [state])

  // Auto-move fully completed tasks to history after a short delay
  useEffect(() => {
    const completed = tasks.filter(
      (t) => t.subtasks.length > 0 && t.subtasks.every((s) => s.done)
    )
    if (completed.length === 0) return

    const timeout = setTimeout(() => {
      setState((prev) => {
        const now = formatNow()
        const completedIds = completed.map((c) => c.id)
        return {
          tasks: prev.tasks.filter((t) => !completedIds.includes(t.id)),
          history: [
            ...completed.map((t) => ({ ...t, completedAt: now })),
            ...prev.history,
          ],
        }
      })
    }, 1500)
    return () => clearTimeout(timeout)
  }, [tasks])

  // ── Task drag & drop ─────────────────────────────
  const taskDragItem = useRef(null)
  const taskDragOver = useRef(null)

  const handleTaskDragStart = (e, idx) => {
    taskDragItem.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleTaskDragOver = (e, idx) => {
    e.preventDefault()
    taskDragOver.current = idx
  }

  const handleTaskDrop = (e) => {
    e.preventDefault()
    if (taskDragItem.current === null || taskDragOver.current === null) return
    if (taskDragItem.current !== taskDragOver.current) {
      setState((prev) => ({
        ...prev,
        tasks: reorder(prev.tasks, taskDragItem.current, taskDragOver.current),
      }))
    }
    taskDragItem.current = null
    taskDragOver.current = null
  }

  // ── Callbacks ────────────────────────────────────
  const toggleSubtask = useCallback((taskId, subtaskId) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              subtasks: task.subtasks.map((st) =>
                st.id === subtaskId ? { ...st, done: !st.done } : st
              ),
            }
          : task
      ),
    }))
  }, [])

  const deleteSubtask = useCallback((taskId, subtaskId) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId
          ? { ...task, subtasks: task.subtasks.filter((st) => st.id !== subtaskId) }
          : task
      ),
    }))
  }, [])

  const addSubtask = useCallback((taskId, text) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              subtasks: [
                ...task.subtasks,
                { id: uid(), text, date: formatDate(), done: false },
              ],
            }
          : task
      ),
    }))
  }, [])

  const reorderSubtasks = useCallback((taskId, fromIdx, toIdx) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId
          ? { ...task, subtasks: reorder(task.subtasks, fromIdx, toIdx) }
          : task
      ),
    }))
  }, [])

  const deleteTask = useCallback((taskId) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.filter((t) => t.id !== taskId),
    }))
  }, [])

  const createTask = useCallback((title) => {
    setState((prev) => ({
      ...prev,
      tasks: [...prev.tasks, { id: uid(), title, subtasks: [] }],
    }))
  }, [])

  const restoreTask = useCallback((taskId) => {
    setState((prev) => {
      const task = prev.history.find((t) => t.id === taskId)
      if (!task) return prev
      const { completedAt, ...restored } = task
      return {
        tasks: [
          ...prev.tasks,
          { ...restored, subtasks: restored.subtasks.map((s) => ({ ...s, done: false })) },
        ],
        history: prev.history.filter((t) => t.id !== taskId),
      }
    })
  }, [])

  const permanentDelete = useCallback((taskId) => {
    setState((prev) => ({
      ...prev,
      history: prev.history.filter((t) => t.id !== taskId),
    }))
  }, [])

  // Computed
  const totalSubtasks = tasks.reduce((a, t) => a + t.subtasks.length, 0)
  const doneSubtasks = tasks.reduce(
    (a, t) => a + t.subtasks.filter((s) => s.done).length,
    0
  )

  const filteredTasks = searchQuery.trim()
    ? tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.subtasks.some((s) =>
            s.text.toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : tasks

  const filteredHistory = searchQuery.trim()
    ? history.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.subtasks.some((s) =>
            s.text.toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : history

  return (
    <div className="min-h-screen bg-neu-bg">
      <div className="max-w-7xl mx-auto p-6 md:p-8">
        <TopBar
          doneCount={doneSubtasks}
          totalCount={totalSubtasks}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onAddTask={() => setShowCreate(true)}
          view={view}
          setView={setView}
        />

        {/* Dashboard View */}
        {view === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredTasks.map((task, i) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  index={i}
                  onToggleSubtask={toggleSubtask}
                  onDeleteSubtask={deleteSubtask}
                  onAddSubtask={addSubtask}
                  onDeleteTask={deleteTask}
                  onReorderSubtasks={reorderSubtasks}
                  onTaskDragStart={handleTaskDragStart}
                  onTaskDragOver={handleTaskDragOver}
                  onTaskDrop={handleTaskDrop}
                />
              ))}
            </div>

            {filteredTasks.length === 0 && (
              <div className="flex flex-col items-center justify-center mt-20 text-neu-muted">
                <LayoutDashboard size={48} strokeWidth={1} className="mb-4 opacity-30" />
                <p className="text-lg">
                  {searchQuery ? 'No tasks match your search' : 'No active tasks'}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="mt-4 text-sm text-green-400 hover:text-green-300 transition-colors"
                  >
                    Create your first task
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* History View */}
        {view === 'history' && (
          <>
            {filteredHistory.length > 0 && (
              <p className="text-xs text-neu-muted mb-4">
                {filteredHistory.length} completed task
                {filteredHistory.length !== 1 ? 's' : ''}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredHistory.map((task) => (
                <HistoryCard
                  key={task.id}
                  task={task}
                  onRestore={restoreTask}
                  onPermanentDelete={permanentDelete}
                />
              ))}
            </div>

            {filteredHistory.length === 0 && (
              <div className="flex flex-col items-center justify-center mt-20 text-neu-muted">
                <History size={48} strokeWidth={1} className="mb-4 opacity-30" />
                <p className="text-lg">
                  {searchQuery ? 'No history matches your search' : 'No completed tasks yet'}
                </p>
              </div>
            )}
          </>
        )}

        {showCreate && (
          <CreateTaskModal
            onClose={() => setShowCreate(false)}
            onCreate={createTask}
          />
        )}
      </div>
    </div>
  )
}
