import { ForbiddenError, getCurrentAccount, type AccountContext } from './account';

/** The same database permission used by RLS and the member settings screen. */
export async function canInAccount(ctx: AccountContext, module: string, action: string): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc('has_member_permission', {
    p_user_id: ctx.userId, p_module: module, p_action: action,
  });
  if (error) throw error;
  return data === true;
}

export async function requirePermission(module: string, action: string): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!await canInAccount(ctx, module, action)) {
    throw new ForbiddenError('No tienes permiso para acceder a esta función.');
  }
  if (['edit', 'review'].includes(action) && !await canInAccount(ctx, module, 'view')) {
    throw new ForbiddenError('Necesitas permiso para ver esta sección antes de modificarla.');
  }
  return ctx;
}
