import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import NotificationsBell from '../../components/NotificationsBell'
import OverviewPanel from './OverviewPanel'
import ConversationReviewPanel from './ConversationReviewPanel'
import UsersPanel from './UsersPanel'
import CategoriesPanel from './CategoriesPanel'
import AiKnowledgePanel from './AiKnowledgePanel'
import ReportsPanel from './ReportsPanel'
import KpiHelpPanel from './KpiHelpPanel'
import AuditLogPanel from './AuditLogPanel'

const TABS = [
  { id: 'overview', label: 'Overview', Component: OverviewPanel },
  { id: 'conversations', label: 'Conversations', Component: ConversationReviewPanel },
  { id: 'reports', label: 'Reports', Component: ReportsPanel },
  { id: 'users', label: 'Users', Component: UsersPanel },
  { id: 'categories', label: 'Categories & SLAs', Component: CategoriesPanel },
  { id: 'ai-knowledge', label: 'AI Knowledge', Component: AiKnowledgePanel },
  { id: 'kpi-help', label: 'KPI Help', Component: KpiHelpPanel },
  { id: 'audit', label: 'Audit log', Component: AuditLogPanel },
]

export default function AdminDashboard() {
  const { profile, signOut } = useAuth()
  const [tab, setTab] = useState('overview')
  const Active = TABS.find((t) => t.id === tab).Component

  return (
    <div className="flex h-screen flex-col bg-[var(--paper)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="signal-bars text-[var(--brand)]"><span></span><span></span><span></span><span></span></span>
          <span className="text-sm font-bold text-[var(--ink)]">AaRo Desk · Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--muted)]">{profile.full_name}</span>
          <NotificationsBell />
          <button onClick={signOut} className="text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]">
            Sign out
          </button>
        </div>
      </header>

      <div className="flex overflow-x-auto border-b border-[var(--line)] bg-[var(--panel)] px-4 text-sm font-medium">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap border-b-2 -mb-px px-3 py-2.5 ${tab === t.id ? 'border-[var(--brand)] text-[var(--ink)]' : 'border-transparent text-[var(--muted)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-hidden">
        <div className={tab === 'conversations' || tab === 'reports' ? 'h-full' : 'h-full overflow-y-auto'}>
          <Active />
        </div>
      </main>
    </div>
  )
}
