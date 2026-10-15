import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireRole('owner');
    const { data, error } = await ctx.supabase
      .from('member_session_audit')
      .select('session_id,user_id,first_seen_at,last_seen_at,user_agent,reported_ip,latitude,longitude,accuracy_m,location_seen_at,location_declined_at')
      .eq('account_id', ctx.accountId)
      .order('last_seen_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    return NextResponse.json({ sessions: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => ({}));
    const location = body && typeof body === 'object' && body.location;
    let latitude: number | null = null;
    let longitude: number | null = null;
    let accuracy: number | null = null;
    if (location) {
      latitude = location.latitude;
      longitude = location.longitude;
      accuracy = location.accuracy;
      if (![latitude, longitude, accuracy].every((value) => typeof value === 'number' && Number.isFinite(value)) ||
        latitude! < -90 || latitude! > 90 || longitude! < -180 || longitude! > 180 || accuracy! < 0) {
        return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
      }
    }

    // These headers describe the connection as reported by the proxy. They
    // are useful audit hints, not proof of a person's physical location.
    const forwarded = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = forwarded && /^[\da-fA-F:.]+$/.test(forwarded) ? forwarded : null;
    const { error } = await ctx.supabase.rpc('touch_member_session', {
      p_user_agent: request.headers.get('user-agent') ?? '',
      p_reported_ip: ip,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracy,
      p_location_declined: body?.locationDeclined === true,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
