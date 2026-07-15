import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function AuditLogPanel() {
  const [logs, setLogs] = useState([])
  const [actors, setActors] = useState({})

  useEffect(() => {
    supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(async ({ data }) => {
        setLogs(data ?? [])
        const ids = Array.from(new Set((data ?? []).map((l) => l.actor_id).filter(Boolean)))
        if (ids.length > 0) {
          const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', ids)
          setActors(Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name])))
        }
      })
  }, [])

  return (
    <div className="p-4">
      <h2 className="mb-4 text-base font-semibold text-[var(--ink)]">Audit log</h2>
      <div className="overflow-hidden rounded-xl border border-[var(--line)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--panel)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Transition</th>
            </tr>
          </thead>
          <tbody className="bg-[var(--panel)]">
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-[var(--line)] last:border-0">
                <td className="px-3 py-2 font-mono-data text-xs text-[var(--muted)]">
                  {new Date(l.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td className="px-3 py-2 text-[var(--ink)]">{actors[l.actor_id] ?? '—'}</td>
                <td className="px-3 py-2 text-[var(--ink)]">{l.action}</td>
                <td className="px-3 py-2 font-mono-data text-xs text-[var(--muted)]">
                  {l.from_status ?? '·'} → {l.to_status ?? '·'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
