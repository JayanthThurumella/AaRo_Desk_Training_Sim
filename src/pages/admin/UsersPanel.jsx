import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

const ROLES = ['customer', 'agent', 'senior_agent', 'admin']
const PRESENCE_LABEL = { available: 'Available', busy: 'Busy', break: 'On break', offline: 'Offline' }
const PRESENCE_COLOR = {
  available: 'var(--status-active)', busy: 'var(--status-hold)', break: 'var(--signal)', offline: 'var(--status-cancelled)',
}

export default function UsersPanel() {
  const [users, setUsers] = useState([])
  const [teams, setTeams] = useState([])
  const [filter, setFilter] = useState('staff')
  const [savingId, setSavingId] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setUsers(data ?? [])
    const { data: t } = await supabase.from('teams').select('*')
    setTeams(t ?? [])
  }

  useEffect(() => { load() }, [])

  const updateField = async (id, patch) => {
    setSavingId(id)
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    setSavingId(null)
    if (error) alert(error.message)
    else setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  }

  const visible = users.filter((u) => (filter === 'staff' ? u.role !== 'customer' : filter === 'all' ? true : u.role === 'customer'))

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--ink)]">Users</h2>
        <div className="flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5 text-sm">
          {['staff', 'customer', 'all'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 capitalize ${filter === f ? 'bg-[var(--brand)] text-white' : 'text-[var(--muted)]'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--line)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--panel)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Team</th>
              <th className="px-3 py-2 font-medium">Max tickets</th>
            </tr>
          </thead>
          <tbody className="bg-[var(--panel)]">
            {visible.map((u) => (
              <tr key={u.id} className="border-b border-[var(--line)] last:border-0">
                <td className="px-3 py-2 font-medium text-[var(--ink)]">{u.full_name}</td>
                <td className="px-3 py-2">
                  <select
                    value={u.role}
                    disabled={savingId === u.id}
                    onChange={(e) => updateField(u.id, { role: e.target.value })}
                    className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-xs"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {u.role === 'customer' ? (
                    <span className="text-[var(--muted)]">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: PRESENCE_COLOR[u.status] }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PRESENCE_COLOR[u.status] }} />
                      {PRESENCE_LABEL[u.status] ?? u.status}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {u.role === 'customer' ? (
                    <span className="text-[var(--muted)]">—</span>
                  ) : (
                    <select
                      value={u.team_id ?? ''}
                      disabled={savingId === u.id}
                      onChange={(e) => updateField(u.id, { team_id: e.target.value || null })}
                      className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-xs"
                    >
                      <option value="">Unassigned</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="px-3 py-2">
                  {u.role === 'customer' ? (
                    <span className="text-[var(--muted)]">—</span>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      value={u.max_concurrent_tickets}
                      disabled={savingId === u.id}
                      onChange={(e) => updateField(u.id, { max_concurrent_tickets: Number(e.target.value) })}
                      className="w-16 rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-xs font-mono-data"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

