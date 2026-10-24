'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'

type BillingRow = {
  id: string
  conversation_id: string
  sender_type: string
  sender_id: string | null
  billing_sender: string | null
  ai_generated: boolean | null
  content_type: string
  message_id: string | null
  status: string
  billing_status: 'free' | 'paid' | 'unknown' | null
  billing_billable: boolean | null
  billing_type: string | null
  billing_category: string | null
  billing_model: string | null
  billing_confirmed_at: string | null
  billing_delivered_at: string | null
  billing_estimated_cost: number | null
  billing_currency: string | null
  billing_phone_number_id: string | null
  billing_recipient_id: string | null
  source_referral: Record<string, unknown> | null
  display_label?: string | null
  created_at: string
  conversations: {
    account_id: string
    last_customer_message_at: string | null
    first_ad_referral: Record<string, unknown> | null
    first_ad_referral_at: string | null
    contacts: { name: string | null; phone: string | null } | null
  } | null
}

const stateLabel = {
  free: 'GRATIS · CONFIRMADO POR META',
  paid: 'DE PAGO · CONFIRMADO POR META',
  unknown: 'POR CONFIRMAR',
} as const

function sourceName(value: Record<string, unknown> | null | undefined) {
  if (!value) return 'Sin referencia publicitaria guardada'
  return String(value.headline || value.source_id || value.ad_id || value.ctwa_clid || 'Referencia de Meta')
}

function senderName(row: BillingRow) {
  if (row.billing_sender === 'ai' || row.ai_generated) return 'IA'
  if (row.billing_sender === 'automation') return 'Automatización'
  if (row.billing_sender === 'flow') return 'Flujo'
  if (row.billing_sender === 'broadcast') return 'Difusión'
  return row.sender_type === 'agent' ? 'Asesora' : row.sender_type === 'bot' ? 'Automatización' : 'Sistema'
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'No disponible'
  return new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' })
}

export default function WhatsAppBillingPage() {
  const { accountId, accountRole } = useAuth()
  const [rows, setRows] = useState<BillingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!accountId || accountRole !== 'owner') return
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const supabase = createClient()
    const loadPages = async (kind: 'messages' | 'broadcasts') => {
      const rows: Array<Record<string, unknown>> = []
      for (let offset = 0; ; offset += 1000) {
        const result = kind === 'messages'
          ? await supabase.from('messages')
            .select('id,conversation_id,sender_type,sender_id,billing_sender,ai_generated,content_type,status,billing_status,billing_billable,billing_type,billing_category,billing_model,billing_confirmed_at,billing_delivered_at,billing_estimated_cost,billing_currency,billing_phone_number_id,billing_recipient_id,source_referral,created_at,conversations!inner(account_id,last_customer_message_at,first_ad_referral,first_ad_referral_at,contacts(name,phone))')
            .eq('conversations.account_id', accountId)
            .neq('sender_type', 'customer')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .range(offset, offset + 999)
          : await supabase.from('broadcast_recipients')
            .select('id,status,whatsapp_message_id,billing_status,billing_billable,billing_type,billing_category,billing_model,billing_confirmed_at,billing_phone_number_id,billing_recipient_id,billing_estimated_cost,billing_currency,created_at,delivered_at,broadcasts!inner(account_id,template_name),contacts(name,phone)')
            .eq('broadcasts.account_id', accountId)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .range(offset, offset + 999)
        if (result.error) return { rows, error: result.error.message }
        rows.push(...(result.data ?? []) as unknown as Array<Record<string, unknown>>)
        if ((result.data?.length ?? 0) < 1000) break
      }
      return { rows, error: null as string | null }
    }
    void Promise.all([loadPages('messages'), loadPages('broadcasts')]).then(([messageResult, broadcastResult]) => {
        if (cancelled) return
        const messageRows = messageResult.rows as unknown as BillingRow[]
        const broadcastRows = broadcastResult.rows.map((raw) => {
          const contact = raw.contacts as { name: string | null; phone: string | null } | null
          const broadcast = raw.broadcasts as { account_id: string; template_name: string } | null
          return {
            id: `broadcast:${String(raw.id)}`,
            conversation_id: '',
            sender_type: 'system',
            sender_id: null,
            billing_sender: 'broadcast',
            ai_generated: false,
            content_type: 'template',
            message_id: (raw.whatsapp_message_id as string | null) ?? null,
            status: String(raw.status ?? 'pending'),
            billing_status: (raw.billing_status as BillingRow['billing_status']) ?? 'unknown',
            billing_billable: (raw.billing_billable as boolean | null) ?? null,
            billing_type: (raw.billing_type as string | null) ?? null,
            billing_category: (raw.billing_category as string | null) ?? null,
            billing_model: (raw.billing_model as string | null) ?? null,
            billing_confirmed_at: (raw.billing_confirmed_at as string | null) ?? null,
            billing_delivered_at: (raw.delivered_at as string | null) ?? null,
            billing_estimated_cost: (raw.billing_estimated_cost as number | null) ?? null,
            billing_currency: (raw.billing_currency as string | null) ?? null,
            billing_phone_number_id: (raw.billing_phone_number_id as string | null) ?? null,
            billing_recipient_id: (raw.billing_recipient_id as string | null) ?? null,
            source_referral: null,
            display_label: `Difusión · ${broadcast?.template_name ?? 'plantilla'}`,
            created_at: (raw.delivered_at as string | null) ?? String(raw.created_at),
            conversations: {
              account_id: accountId,
              last_customer_message_at: null,
              first_ad_referral: null,
              first_ad_referral_at: null,
              contacts: contact,
            },
          } satisfies BillingRow
        })
        setRows([...messageRows, ...broadcastRows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)))
        setError(messageResult.error || broadcastResult.error ? 'No se pudo leer todo el registro de facturación. Confirma que la migración esté aplicada y vuelve a cargar.' : '')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [accountId, accountRole])

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc.total++
    const status = row.billing_status ?? 'unknown'
    acc[status]++
    if (typeof row.billing_estimated_cost === 'number') {
      acc.knownCost += row.billing_estimated_cost
      acc.currency = row.billing_currency ?? acc.currency
      acc.costRows++
    }
    return acc
  }, { total: 0, free: 0, paid: 0, unknown: 0, knownCost: 0, costRows: 0, currency: 'USD' }), [rows])

  const dailyTotals = useMemo(() => {
    const grouped = new Map<string, { total: number; free: number; paid: number; unknown: number; cost: number; costRows: number; currency: string }>()
    for (const row of rows) {
      const day = new Date(row.created_at).toLocaleDateString('sv-SE', { timeZone: 'America/Lima' })
      const entry = grouped.get(day) ?? { total: 0, free: 0, paid: 0, unknown: 0, cost: 0, costRows: 0, currency: 'USD' }
      entry.total++
      entry[row.billing_status ?? 'unknown']++
      if (typeof row.billing_estimated_cost === 'number') {
        entry.cost += row.billing_estimated_cost
        entry.currency = row.billing_currency ?? entry.currency
        entry.costRows++
      }
      grouped.set(day, entry)
    }
    return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [rows])

  const conversationTotals = useMemo(() => {
    const grouped = new Map<string, { label: string; total: number; free: number; paid: number; unknown: number; cost: number; costRows: number; currency: string }>()
    for (const row of rows) {
      const contact = row.conversations?.contacts
      const key = contact?.phone || row.conversation_id || row.id
      const entry = grouped.get(key) ?? {
        label: `${contact?.name || 'Contacto'} · ${contact?.phone || 'sin número'}`,
        total: 0, free: 0, paid: 0, unknown: 0, cost: 0, costRows: 0, currency: 'USD',
      }
      entry.total++
      entry[row.billing_status ?? 'unknown']++
      if (typeof row.billing_estimated_cost === 'number') {
        entry.cost += row.billing_estimated_cost
        entry.currency = row.billing_currency ?? entry.currency
        entry.costRows++
      }
      grouped.set(key, entry)
    }
    return [...grouped.values()].sort((a, b) => b.total - a.total)
  }, [rows])

  if (accountRole !== 'owner') return <p>Este panel de costos es exclusivo del propietario.</p>

  return <div className="space-y-5">
    <div>
      <h1 className="text-2xl font-bold">Control de costos de WhatsApp</h1>
      <p className="mt-1 text-sm text-muted-foreground">Últimos 30 días, hasta 1.000 mensajes salientes. La ventana de 24 horas y la ventana gratuita de anuncios de 72 horas se muestran por separado.</p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <section className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Mensajes revisados</p><p className="text-2xl font-semibold">{loading ? '…' : totals.total}</p></section>
      <section className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Gratis, Meta confirmado</p><p className="text-2xl font-semibold text-emerald-600">{loading ? '…' : totals.free}</p></section>
      <section className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">De pago, Meta confirmado</p><p className="text-2xl font-semibold text-rose-600">{loading ? '…' : totals.paid}</p></section>
      <section className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Por confirmar / sin histórico</p><p className="text-2xl font-semibold">{loading ? '…' : totals.unknown}</p></section>
    </div>

    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <h2 className="font-semibold">Costos y comparación con Meta</h2>
      <p className="mt-1">Meta confirma si el mensaje entregado fue facturable y su categoría. La cuenta no tiene una tarifa oficial verificada cargada, por eso el CRM no inventa importes: costo estimado y diferencia contra la factura quedan pendientes hasta configurar esa tarifa.</p>
      <p className="mt-2">Importe calculable con tarifas configuradas: {totals.costRows ? `${totals.knownCost.toFixed(2)} ${totals.currency}` : 'No disponible'} · Mensajes cubiertos por tarifa: {totals.costRows}</p>
      <p className="mt-1 text-muted-foreground">Los mensajes anteriores a esta captura no se pueden reclasificar: Meta no dejó su `pricing` en la base histórica.</p>
    </section>

    {!loading && <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-xl border p-4">
        <h2 className="font-semibold">Resumen diario (hora de Lima)</h2>
        <div className="mt-3 max-h-72 space-y-2 overflow-auto text-xs">
          {dailyTotals.map(([day, item]) => <div key={day} className="grid grid-cols-1 gap-1 border-b pb-2 sm:grid-cols-[1fr_auto_auto_auto] sm:gap-3">
            <span>{day}</span><span>{item.total} mensajes · {item.paid} pagados</span>
            <span>{item.free} gratis · {item.unknown} por confirmar</span>
            <span>{item.costRows ? `${item.cost.toFixed(2)} ${item.currency}` : 'costo no disponible'}</span>
          </div>)}
        </div>
      </div>
      <div className="rounded-xl border p-4">
        <h2 className="font-semibold">Resumen por contacto</h2>
        <div className="mt-3 max-h-72 space-y-2 overflow-auto text-xs">
          {conversationTotals.map((item, index) => <div key={`${item.label}:${index}`} className="grid grid-cols-1 gap-1 border-b pb-2 sm:grid-cols-[1fr_auto_auto] sm:gap-3">
            <span>{item.label}</span><span>{item.total} mensajes · {item.paid} pagados · {item.unknown} por confirmar</span>
            <span>{item.costRows ? `${item.cost.toFixed(2)} ${item.currency}` : 'costo no disponible'}</span>
          </div>)}
        </div>
      </div>
    </section>}

    {error && <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
    {loading ? <p>Cargando registro…</p> : !rows.length ? <p>No hay mensajes salientes en el periodo.</p> :
      <div className="space-y-3">
        {rows.map((row) => {
          const conv = row.conversations
          const contact = conv?.contacts
          const state = row.billing_status ?? 'unknown'
          const referral = row.source_referral ?? conv?.first_ad_referral
          return <article key={row.id} className="rounded-xl border p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="font-semibold">{contact?.name || 'Contacto'} · {contact?.phone || 'sin número'}</h2><p className="text-xs text-muted-foreground">{formatDate(row.created_at)} · {row.display_label || row.content_type} · {senderName(row)}</p></div>
              <span className={state === 'free' ? 'rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700' : state === 'paid' ? 'rounded-full bg-rose-500/10 px-2 py-1 text-xs text-rose-700' : 'rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-800'}>{stateLabel[state]}</span>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <p>Origen: {sourceName(referral)}</p>
              <p>Categoría Meta: {row.billing_category || 'Sin dato'}</p>
              <p>Entrega: {formatDate(row.billing_delivered_at)}</p>
              <p>Confirmación económica Meta: {formatDate(row.billing_confirmed_at)}</p>
              <p>Número empresarial (ID Meta): {row.billing_phone_number_id || 'No capturado'}</p>
              <p>Destinatario Meta: {row.billing_recipient_id || contact?.phone || 'No disponible'}</p>
              <p>Costo: {row.billing_estimated_cost == null ? 'Sin tarifa confirmada' : `${row.billing_estimated_cost} ${row.billing_currency ?? ''}`}</p>
              <p>Ventana de atención 24 h hasta: {formatDate(conv?.last_customer_message_at ? new Date(Date.parse(conv.last_customer_message_at) + 24 * 60 * 60 * 1000).toISOString() : null)}</p>
              <p>Ventana gratuita de anuncio 72 h hasta: {formatDate(conv?.first_ad_referral_at ? new Date(Date.parse(conv.first_ad_referral_at) + 72 * 60 * 60 * 1000).toISOString() : null)}</p>
              <p>Modelo de precio: {row.billing_model || 'Sin dato'}</p>
              <p>ID Meta: {row.message_id || 'No disponible'}</p>
            </div>
          </article>
        })}
      </div>}
  </div>
}
