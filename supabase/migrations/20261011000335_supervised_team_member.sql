-- Atomic permissions presets; existing members change only on an explicit panel action.
create or replace function public.apply_member_preset(p_user_id uuid, p_preset text)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller public.profiles; v_target public.profiles;
begin
  select * into v_caller from public.profiles where user_id = auth.uid();
  if v_caller.account_role is null or v_caller.account_role not in ('owner','admin') then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  select * into v_target from public.profiles where user_id=p_user_id for update;
  if v_target.account_id is distinct from v_caller.account_id or v_target.user_id is null
    or p_user_id=auth.uid() or v_target.account_role='owner' then
    raise exception 'Invalid target' using errcode='42501';
  end if;
  if p_preset not in ('ventas','fidelizacion','coordinador','administrador') or p_preset is null then
    raise exception 'Invalid preset' using errcode='22023';
  end if;
  if (p_preset='administrador' or v_target.account_role='admin') and v_caller.account_role<>'owner' then
    raise exception 'Only CEO can manage administrators' using errcode='42501';
  end if;
  update public.profiles set
    account_role=case when p_preset='administrador' then 'admin'::account_role_enum else 'agent'::account_role_enum end,
    area=case p_preset when 'ventas' then 'VENTAS' when 'fidelizacion' then 'FIDELIZACION' when 'administrador' then 'ADMINISTRATIVA' else coalesce(v_target.area,'SIN AREA') end,
    cargo=case p_preset when 'coordinador' then 'COORDINADOR' when 'administrador' then 'ADMINISTRADOR' else 'AGENTE' end
  where user_id=p_user_id;
  insert into public.member_permission_overrides(user_id,permission_id,allowed)
  select p_user_id,id,
    (module='inbox' and action in ('view','send','assign','tag'))
    or (module='notifications' and action='view')
    or (module='enrollments' and action in ('view','edit'))
    or (module='payments' and action='refer')
    or (p_preset='coordinador' and ((module='inbox' and action='supervise') or (module='tags' and action='manage') or (module in ('contacts','pipelines') and action in ('view','create','edit'))))
  from public.permission_definitions
  on conflict(user_id,permission_id) do update set allowed=excluded.allowed;
  -- Never carry sales distribution into a non-sales role.
  if p_preset not in ('ventas','coordinador') and exists(select 1 from public.member_sales_routing where account_id=v_caller.account_id and user_id=p_user_id and percentage>0) then
    update public.member_sales_routing set percentage=0 where account_id=v_caller.account_id and user_id=p_user_id;
    update public.account_sales_routing set enabled=false,version=version+1 where account_id=v_caller.account_id;
  end if;
end; $$;
revoke all on function public.apply_member_preset(uuid,text) from public,anon;
grant execute on function public.apply_member_preset(uuid,text) to authenticated;

-- Only the server can attach an Auth user it has just created. Never adopt existing accounts.
create or replace function public.attach_created_team_member(p_caller uuid,p_account uuid,p_user uuid,p_preset text,p_name text,p_nickname text)
returns void language plpgsql security definer set search_path=public as $$
declare v_target public.profiles; v_role account_role_enum;
begin
  select account_role into v_role from public.profiles where user_id=p_caller and account_id=p_account;
  if v_role is null or v_role not in ('owner','admin') or (p_preset='administrador' and v_role<>'owner') then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  if p_preset is null or p_preset not in ('ventas','fidelizacion','coordinador','administrador') then
    raise exception 'Invalid preset' using errcode='22023';
  end if;
  select * into v_target from public.profiles where user_id=p_user for update;
  if v_target.user_id is null or v_target.account_role<>'owner' or v_target.created_at < now()-interval '5 minutes'
    or not exists(select 1 from public.accounts where id=v_target.account_id and owner_user_id=p_user)
    or (select count(*) from public.profiles where account_id=v_target.account_id)<>1 then
    raise exception 'Not a new personal account' using errcode='42501';
  end if;
  update public.profiles set account_id=p_account,account_role='agent',full_name=p_name,nickname=p_nickname where user_id=p_user;
  -- apply_member_preset checks the original authenticated administrator.
  perform set_config('request.jwt.claim.sub',p_caller::text,true);
  perform public.apply_member_preset(p_user,p_preset);
end; $$;
revoke all on function public.attach_created_team_member(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.attach_created_team_member(uuid,uuid,uuid,text,text,text) to service_role;
