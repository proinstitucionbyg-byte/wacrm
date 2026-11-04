import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { campaignPreviewSchema, previewCampaign } from '@/lib/multichannel/campaign-preview';
import { centralCampaignSchema, previewCentralCampaign } from '@/lib/multichannel/central-campaign';

export async function POST(request: Request) {
  try {
    await requireRole('owner');
    const body = await request.json().catch(() => null);
    if (body?.source === 'central-sheet') {
      const parsed = centralCampaignSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({error:parsed.error.flatten()}, {status:400});
      try {
        return NextResponse.json(previewCentralCampaign(parsed.data), {headers:{'Cache-Control':'no-store'}});
      } catch {
        return NextResponse.json({error:'Las cabeceras de COMUNICACIONES no coinciden con el formato verificado.'}, {status:400});
      }
    }
    const parsed = campaignPreviewSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({error:parsed.error.flatten()}, {status:400});
    // Preview deliberately works without the worker switch or any database write.
    return NextResponse.json(previewCampaign(parsed.data), {headers:{'Cache-Control':'no-store'}});
  } catch (error) { return toErrorResponse(error); }
}
