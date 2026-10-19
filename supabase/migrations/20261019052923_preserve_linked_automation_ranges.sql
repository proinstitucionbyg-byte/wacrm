-- Service-only transaction: the authenticated route checks edit permission,
-- computes the preview and supplies an optimistic snapshot of every changed row.
create or replace function public.save_automation_with_references(
  p_account uuid, p_id uuid, p_expected jsonb, p_update jsonb,
  p_steps jsonb, p_links jsonb, p_pending jsonb, p_structural boolean
) returns void language plpgsql security invoker set search_path = public as $$
declare actual jsonb; item jsonb;
begin
  -- Serialize step writes, including older REST editors, so no partial save is visible.
  lock table public.automations in share row exclusive mode;
  lock table public.automation_steps in share row exclusive mode;
  lock table public.automation_pending_executions in share row exclusive mode;
  select to_jsonb(a) into actual from automations a where id=p_id and account_id=p_account;
  if actual is null or actual is distinct from p_expected->'automation' then
    raise exception 'La automatización cambió. Vuelve a revisar antes de guardar.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into actual from automation_steps s where automation_id=p_id;
  if actual is distinct from p_expected->'steps' then raise exception 'Los bloques cambiaron. Vuelve a guardar para revisar los cambios.'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into actual
    from automation_steps s join automations a on a.id=s.automation_id
    where a.account_id=p_account and s.step_type='run_automation' and s.step_config->>'automation_id'=p_id::text;
  if actual is distinct from p_expected->'links' then raise exception 'Un enlace cambió. Vuelve a revisar la lista.'; end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) into actual
    from automation_pending_executions p where account_id=p_account and status in ('pending','running','cancelled')
    and (automation_id=p_id or (context->'automation_step_end_by_id') ? p_id::text);
  if actual is distinct from p_expected->'pending' then raise exception 'Una conversación avanzó. Vuelve a guardar para actualizar la revisión.'; end if;
  if p_structural and exists(select 1 from jsonb_array_elements(actual) x where x->>'status'='running') then
    raise exception 'Hay un envío en curso. Espera unos segundos y vuelve a guardar.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_steps) x join automation_steps s on s.id=(x->>'id')::uuid where s.automation_id<>p_id)
    then raise exception 'Un bloque pertenece a otra automatización.'; end if;
  if exists(select 1 from jsonb_array_elements(p_steps) x where (x->>'automation_id')::uuid<>p_id)
    then raise exception 'Identificador de automatización incorrecto.'; end if;
  if p_update->>'folder_id' is not null and not exists(select 1 from automation_folders where id=(p_update->>'folder_id')::uuid and account_id=p_account)
    then raise exception 'La carpeta pertenece a otra cuenta.'; end if;
  -- Preserving IDs lets callers continue to follow the same block after it moves.
  insert into automation_steps(id,automation_id,parent_step_id,branch,step_type,step_config,position)
    select id,p_id,parent_step_id,branch,step_type,step_config,position
    from jsonb_to_recordset(p_steps) as s(id uuid,automation_id uuid,parent_step_id uuid,branch text,step_type text,step_config jsonb,position integer)
    on conflict(id) do update set parent_step_id=excluded.parent_step_id,branch=excluded.branch,
      step_type=excluded.step_type,step_config=excluded.step_config,position=excluded.position;
  for item in select * from jsonb_array_elements(p_links) loop
    update automation_steps s set step_config=item->'step_config'
      where s.id=(item->>'id')::uuid and exists(select 1 from automations a where a.id=s.automation_id and a.account_id=p_account);
  end loop;
  for item in select * from jsonb_array_elements(p_pending) loop
    update automation_pending_executions set next_step_position=(item->>'next_step_position')::int,context=item->'context'
      where id=(item->>'id')::uuid and account_id=p_account;
  end loop;
  delete from automation_steps s where automation_id=p_id and not exists(select 1 from jsonb_array_elements(p_steps) x where (x->>'id')::uuid=s.id);
  update automations set name=case when p_update ? 'name' then p_update->>'name' else name end,
    description=case when p_update ? 'description' then p_update->>'description' else description end,
    trigger_type=case when p_update ? 'trigger_type' then p_update->>'trigger_type' else trigger_type end,
    trigger_config=case when p_update ? 'trigger_config' then p_update->'trigger_config' else trigger_config end,
    is_active=case when p_update ? 'is_active' then (p_update->>'is_active')::boolean else is_active end,
    folder_id=case when p_update ? 'folder_id' then (p_update->>'folder_id')::uuid else folder_id end,updated_at=now()
    where id=p_id and account_id=p_account;
end $$;
revoke all on function public.save_automation_with_references(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_automation_with_references(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) to service_role;
