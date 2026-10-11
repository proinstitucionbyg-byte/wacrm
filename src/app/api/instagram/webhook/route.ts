import { receiveSocialWebhook, verifySocialSubscription } from '@/lib/social/webhook'

export const maxDuration = 60
export const GET = verifySocialSubscription
export async function POST(request: Request) {
  return receiveSocialWebhook(request, 'instagram')
}