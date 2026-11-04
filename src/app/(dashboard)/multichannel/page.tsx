import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { CampaignManager } from '@/components/multichannel/campaign-manager';

export default async function MultichannelPage() {
  try { await requireRole('owner'); }
  catch(error) {
    if(error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return <p className="p-6">El bot multicanal está disponible solo para el propietario.</p>;
    }
    throw error;
  }
  return <CampaignManager/>;
}
