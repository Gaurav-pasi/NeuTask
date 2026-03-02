import { useState, useCallback } from 'react'
import {
  Home,
  ClipboardList,
  Inbox,
  CalendarDays,
  Settings,
  Search,
  Plus,
  Check,
  Sparkles,
} from 'lucide-react'

// ─── Initial Data ────────────────────────────────────────────────
const initialTasks = [
  {
    id: 1,
    title: 'Project Launch',
    status: 'Active',
    progress: 60,
    subtasks: [
      { id: 's1', text: 'Finalize presentation', date: 'Today', done: false },
      { id: 's2', text: 'Record demo video', date: 'Oct 28', done: false },
      { id: 's3', text: 'Review analytics', date: 'Oct 28', done: false },
      { id: 's4', text: 'Send announcement email', date: 'Oct 28', done: true },
    ],
  },
  {
    id: 2,
    title: 'Website Redesign',
    status: 'Progress 75%',
    progress: 75,
    subtasks: [
      { id: 's5', text: 'User flows & sketches', date: 'Today', done: true },
      { id: 's6', text: 'Design mockups', date: 'Active', done: false },
      { id: 's7', text: 'Development Sprint 1', date: 'Oct 17', done: false },
    ],
  },
  {
    id: 3,
    title: 'Marketing Campaign',
    status: 'Progress 20%',
    progress: 20,
    subtasks: [
      { id: 's8', text: 'Content planning', date: 'Oct 28', done: false },
      { id: 's9', text: 'Social Media Ad set', date: 'Oct 28', done: false },
    ],
  },
]

const sidebarItems = [
  { icon: Home, label: 'Home' },
  { icon: ClipboardList, label: 'Tasks' },
  { icon: Inbox, label: 'Inbox' },
  { icon: CalendarDays, label: 'Calendar' },
  { icon: Settings, label: 'Settings' },
]

// ─── Checkbox Component ──────────────────────────────────────────
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

// ─── Subtask Component ───────────────────────────────────────────
function Subtask({ subtask, onToggle }) {
  const isActiveDate = subtask.date === 'Active'
  const isTodayDate = subtask.date === 'Today'

  return (
    <div className="neu-subtask flex items-center gap-3 px-4 py-3">
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
          isActiveDate
            ? 'bg-green-500/15 text-green-400'
            : isTodayDate
              ? 'bg-blue-500/15 text-blue-400'
              : 'bg-white/5 text-neu-muted'
        }`}
      >
        {subtask.date}
      </span>
    </div>
  )
}

// ─── Task Card Component ─────────────────────────────────────────
function TaskCard({ task, index, onToggleSubtask }) {
  const isActive = task.status === 'Active'
  const completedCount = task.subtasks.filter((s) => s.done).length
  const computedProgress = Math.round(
    (completedCount / task.subtasks.length) * 100
  )

  return (
    <div className="neu-raised neu-card-hover p-5 flex flex-col gap-4">
      {/* Card Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-neu-text">
            {index + 1}. {task.title}
          </span>
        </div>
        {isActive && (
          <div className="neu-checkbox checked w-6 h-6 flex-shrink-0">
            <Check size={14} strokeWidth={3} className="text-white" />
          </div>
        )}
      </div>

      {/* Status & Progress */}
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-medium px-3 py-1 rounded-full ${
            isActive
              ? 'bg-green-500/15 text-green-400'
              : 'bg-white/5 text-neu-muted'
          }`}
        >
          {isActive ? 'Active' : task.status}
        </span>
        <span className="text-xs text-neu-muted">
          {completedCount}/{task.subtasks.length} done
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
        {task.subtasks.map((subtask) => (
          <Subtask
            key={subtask.id}
            subtask={subtask}
            onToggle={() => onToggleSubtask(task.id, subtask.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Sidebar Component ───────────────────────────────────────────
function Sidebar({ activeNav, setActiveNav }) {
  return (
    <aside className="neu-sidebar w-[68px] flex flex-col items-center py-6 gap-2 flex-shrink-0">
      {/* Logo Mark */}
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center mb-6 shadow-lg">
        <Sparkles size={20} className="text-white" />
      </div>

      {/* Nav Icons */}
      {sidebarItems.map((item) => (
        <button
          key={item.label}
          className={`sidebar-icon ${activeNav === item.label ? 'active' : ''}`}
          onClick={() => setActiveNav(item.label)}
          title={item.label}
        >
          <item.icon size={20} />
        </button>
      ))}
    </aside>
  )
}

// ─── Top Bar Component ───────────────────────────────────────────
function TopBar({ doneCount, totalCount, searchQuery, setSearchQuery }) {
  return (
    <div className="flex items-center justify-between gap-6 mb-8">
      {/* Title */}
      <div className="flex-shrink-0">
        <h1 className="text-3xl font-bold tracking-tight text-neu-text text-shadow-soft">
          Claude Code
        </h1>
        <p className="text-xs text-neu-muted mt-0.5 tracking-wide">
          minimal 3D font
        </p>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 flex-1 justify-end">
        <span className="text-sm font-medium text-neu-muted whitespace-nowrap">
          <span className="text-green-400 font-semibold">{doneCount}</span>
          <span className="text-neu-muted">/{totalCount}</span>{' '}
          <span className="text-neu-muted">Done</span>
        </span>

        {/* Search */}
        <div className="neu-pressed flex items-center gap-2 px-4 py-2.5 w-56">
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
        <button className="w-11 h-11 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center glow-green hover:scale-105 transition-transform flex-shrink-0 cursor-pointer">
          <Plus size={22} strokeWidth={2.5} className="text-white" />
        </button>
      </div>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks] = useState(initialTasks)
  const [activeNav, setActiveNav] = useState('Tasks')
  const [searchQuery, setSearchQuery] = useState('')

  const toggleSubtask = useCallback((taskId, subtaskId) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? {
              ...task,
              subtasks: task.subtasks.map((st) =>
                st.id === subtaskId ? { ...st, done: !st.done } : st
              ),
            }
          : task
      )
    )
  }, [])

  // Computed stats
  const totalSubtasks = tasks.reduce((a, t) => a + t.subtasks.length, 0)
  const doneSubtasks = tasks.reduce(
    (a, t) => a + t.subtasks.filter((s) => s.done).length,
    0
  )

  // Filter tasks by search
  const filteredTasks = searchQuery.trim()
    ? tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.subtasks.some((s) =>
            s.text.toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : tasks

  return (
    <div className="flex h-screen overflow-hidden bg-neu-bg">
      {/* Sidebar */}
      <Sidebar activeNav={activeNav} setActiveNav={setActiveNav} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {/* Top Bar */}
        <TopBar
          doneCount={doneSubtasks}
          totalCount={totalSubtasks}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />

        {/* Task Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredTasks.map((task, i) => (
            <TaskCard
              key={task.id}
              task={task}
              index={i}
              onToggleSubtask={toggleSubtask}
            />
          ))}
        </div>

        {/* Empty State */}
        {filteredTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-20 text-neu-muted">
            <Search size={48} strokeWidth={1} className="mb-4 opacity-30" />
            <p className="text-lg">No tasks match your search</p>
          </div>
        )}

        {/* Decorative Sparkle */}
        <div className="fixed bottom-6 right-6 text-neu-muted/20">
          <Sparkles size={32} />
        </div>
      </main>
    </div>
  )
}
