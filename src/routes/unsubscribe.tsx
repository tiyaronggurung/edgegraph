import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/unsubscribe')({
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const [state, setState] = useState<'loading' | 'valid' | 'already' | 'invalid' | 'success' | 'error'>('loading')
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get('token')
    setToken(t)
    if (!t) { setState('invalid'); return }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(t)}`)
      .then(r => r.json())
      .then(d => {
        if (d.valid) setState('valid')
        else if (d.reason === 'already_unsubscribed') setState('already')
        else setState('invalid')
      })
      .catch(() => setState('error'))
  }, [])

  const confirm = async () => {
    if (!token) return
    setState('loading')
    try {
      const r = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const d = await r.json()
      if (d.success) setState('success')
      else if (d.reason === 'already_unsubscribed') setState('already')
      else setState('error')
    } catch { setState('error') }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 font-mono">
      <div className="max-w-md w-full border border-border rounded p-6 text-center">
        <h1 className="text-lg font-bold uppercase tracking-widest mb-4">Unsubscribe</h1>
        {state === 'loading' && <p className="text-sm text-muted-foreground">Working…</p>}
        {state === 'valid' && (
          <>
            <p className="text-sm text-muted-foreground mb-4">Confirm you want to stop receiving emails from EdgeGraph AI.</p>
            <button onClick={confirm} className="rounded border border-[color:var(--color-primary)] px-4 py-2 text-sm uppercase tracking-wider text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/10">
              Confirm Unsubscribe
            </button>
          </>
        )}
        {state === 'already' && <p className="text-sm text-emerald-400">You're already unsubscribed.</p>}
        {state === 'success' && <p className="text-sm text-emerald-400">Unsubscribed. You won't receive further emails.</p>}
        {state === 'invalid' && <p className="text-sm text-red-400">This unsubscribe link is invalid or expired.</p>}
        {state === 'error' && <p className="text-sm text-red-400">Something went wrong. Please try again later.</p>}
      </div>
    </div>
  )
}
