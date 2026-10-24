import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readConversationBillingPreflight } from '@/lib/whatsapp/billing-runtime'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })

  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('account_id').eq('user_id', user.id).maybeSingle()
  if (profileError || !profile?.account_id) return NextResponse.json({ error: 'Cuenta no disponible.' }, { status: 403 })

  const conversationId = new URL(request.url).searchParams.get('conversation_id')
  if (!conversationId) return NextResponse.json({ error: 'Falta la conversación.' }, { status: 400 })

  try {
    // Usage reservations are service-role-only; auth + account membership
    // were checked above before reading the private monthly counter.
    const result = await readConversationBillingPreflight(supabaseAdmin(), profile.account_id, conversationId)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo verificar.' }, { status: 404 })
  }
}
