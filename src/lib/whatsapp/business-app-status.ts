/** Read-only coexistence check. Missing fields are unknown, never disconnected. */
export type BusinessAppStatus = {
  status: 'coexistence' | 'cloud_only' | 'unknown';
  checkedAt: string;
  reason: 'confirmed' | 'invalid_config' | 'provider_unavailable' | 'incomplete_response';
};

export async function checkBusinessAppStatus(args: {
  phoneNumberId: string; accessToken: string;
}): Promise<BusinessAppStatus> {
  const checkedAt = new Date().toISOString();
  const unknown = (reason: BusinessAppStatus['reason']): BusinessAppStatus => ({ status: 'unknown', checkedAt, reason });
  if (!/^\d+$/.test(args.phoneNumberId) || !args.accessToken) return unknown('invalid_config');
  try {
    // This metadata endpoint does not change the version of existing send helpers.
    const response = await fetch(`https://graph.facebook.com/v26.0/${args.phoneNumberId}?fields=is_on_biz_app,platform_type`, {
      method: 'GET', headers: { Authorization: `Bearer ${args.accessToken}` },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return unknown('provider_unavailable');
    const data = await response.json();
    if (data.id !== args.phoneNumberId || data.platform_type !== 'CLOUD_API' || typeof data.is_on_biz_app !== 'boolean') {
      return unknown('incomplete_response');
    }
    return { status: data.is_on_biz_app ? 'coexistence' : 'cloud_only', checkedAt, reason: 'confirmed' };
  } catch { return unknown('provider_unavailable'); }
}
