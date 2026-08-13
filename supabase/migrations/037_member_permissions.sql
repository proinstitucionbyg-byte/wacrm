-- ============================================================
-- MEMBER PERMISSIONS
-- Permisos personalizados por usuario dentro de una cuenta.
-- ============================================================

-- Catálogo de permisos disponibles en el sistema.
CREATE TABLE IF NOT EXISTS public.permission_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT permission_definitions_module_action_key
    UNIQUE (module, action)
);

-- Permisos generales por rol.
-- Permite mantener un acceso base para Admin / Agent / Viewer.
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role account_role_enum NOT NULL,
  permission_id UUID NOT NULL
    REFERENCES public.permission_definitions(id)
    ON DELETE CASCADE,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,

  PRIMARY KEY (role, permission_id)
);

-- Excepciones personalizadas para cada miembro.
-- Si existe una fila aquí, prevalece sobre el permiso del rol.
CREATE TABLE IF NOT EXISTS public.member_permission_overrides (
  user_id UUID NOT NULL
    REFERENCES public.profiles(user_id)
    ON DELETE CASCADE,
  permission_id UUID NOT NULL
    REFERENCES public.permission_definitions(id)
    ON DELETE CASCADE,
  allowed BOOLEAN NOT NULL,

  PRIMARY KEY (user_id, permission_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_permission_definitions_module
  ON public.permission_definitions(module);

CREATE INDEX IF NOT EXISTS idx_member_permission_overrides_user
  ON public.member_permission_overrides(user_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role
  ON public.role_permissions(role);

-- ============================================================
-- SEED: MODULES / ACTIONS
-- ============================================================

INSERT INTO public.permission_definitions
  (module, action, label, description)
VALUES

-- Inbox
('inbox', 'view', 'Ver Inbox', 'Puede acceder al Inbox'),
('inbox', 'send', 'Enviar mensajes', 'Puede enviar mensajes'),
('inbox', 'assign', 'Asignar conversaciones', 'Puede asignar conversaciones'),
('inbox', 'tag', 'Gestionar etiquetas', 'Puede agregar o quitar etiquetas'),
('inbox', 'delete', 'Eliminar mensajes', 'Puede eliminar mensajes'),

-- Contacts
('contacts', 'view', 'Ver contactos', 'Puede acceder a contactos'),
('contacts', 'create', 'Crear contactos', 'Puede crear contactos'),
('contacts', 'edit', 'Editar contactos', 'Puede editar contactos'),
('contacts', 'delete', 'Eliminar contactos', 'Puede eliminar contactos'),

-- Pipelines
('pipelines', 'view', 'Ver pipelines', 'Puede acceder a pipelines'),
('pipelines', 'create', 'Crear registros', 'Puede crear registros'),
('pipelines', 'edit', 'Editar registros', 'Puede editar registros'),
('pipelines', 'delete', 'Eliminar registros', 'Puede eliminar registros'),

-- Broadcasts
('broadcasts', 'view', 'Ver broadcasts', 'Puede acceder a broadcasts'),
('broadcasts', 'create', 'Crear broadcasts', 'Puede crear broadcasts'),
('broadcasts', 'edit', 'Editar broadcasts', 'Puede editar broadcasts'),
('broadcasts', 'delete', 'Eliminar broadcasts', 'Puede eliminar broadcasts'),

-- Automations
('automations', 'view', 'Ver automatizaciones', 'Puede acceder a automatizaciones'),
('automations', 'create', 'Crear automatizaciones', 'Puede crear automatizaciones'),
('automations', 'edit', 'Editar automatizaciones', 'Puede editar automatizaciones'),
('automations', 'delete', 'Eliminar automatizaciones', 'Puede eliminar automatizaciones'),

-- Catalogs
('catalogs', 'view', 'Ver catálogos', 'Puede acceder a catálogos'),
('catalogs', 'create', 'Crear catálogos', 'Puede crear catálogos'),
('catalogs', 'edit', 'Editar catálogos', 'Puede editar catálogos'),
('catalogs', 'delete', 'Eliminar catálogos', 'Puede eliminar catálogos'),

-- Notifications
('notifications', 'view', 'Ver notificaciones', 'Puede ver notificaciones'),

-- AI Agents
('ai_agents', 'view', 'Ver agentes IA', 'Puede acceder a agentes IA'),
('ai_agents', 'create', 'Crear agentes IA', 'Puede crear agentes IA'),
('ai_agents', 'edit', 'Editar agentes IA', 'Puede editar agentes IA'),
('ai_agents', 'delete', 'Eliminar agentes IA', 'Puede eliminar agentes IA')

ON CONFLICT (module, action) DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.permission_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Los permisos disponibles son públicos para usuarios autenticados.
CREATE POLICY permission_definitions_select_authenticated
ON public.permission_definitions
FOR SELECT
TO authenticated
USING (true);

-- Los roles base pueden ser consultados por usuarios autenticados.
CREATE POLICY role_permissions_select_authenticated
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);

-- Un usuario solamente puede consultar sus propios overrides.
CREATE POLICY member_permission_overrides_select_own
ON public.member_permission_overrides
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- ============================================================
-- FUNCIÓN CENTRAL DE PERMISOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_member_permission(
  p_user_id UUID,
  p_module TEXT,
  p_action TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role account_role_enum;
  v_permission_id UUID;
  v_override BOOLEAN;
  v_role_permission BOOLEAN;
BEGIN

  -- Buscar el rol actual del usuario.
  SELECT account_role
  INTO v_role
  FROM public.profiles
  WHERE user_id = p_user_id;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Owner y Admin mantienen acceso total.
  IF v_role IN ('owner', 'admin') THEN
    RETURN TRUE;
  END IF;

  -- Buscar el permiso.
  SELECT id
  INTO v_permission_id
  FROM public.permission_definitions
  WHERE module = p_module
    AND action = p_action;

  IF v_permission_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- El override individual tiene prioridad.
  SELECT allowed
  INTO v_override
  FROM public.member_permission_overrides
  WHERE user_id = p_user_id
    AND permission_id = v_permission_id;

  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- Si no hay override, usar el permiso del rol.
  SELECT allowed
  INTO v_role_permission
  FROM public.role_permissions
  WHERE role = v_role
    AND permission_id = v_permission_id;

  RETURN COALESCE(v_role_permission, FALSE);
END;
$$;

ALTER FUNCTION public.has_member_permission(UUID, TEXT, TEXT)
  OWNER TO postgres;

REVOKE ALL
ON FUNCTION public.has_member_permission(UUID, TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.has_member_permission(UUID, TEXT, TEXT)
TO authenticated;

-- ============================================================
-- ASIGNAR PERMISO PERSONALIZADO A UN MIEMBRO
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_permission(
  p_user_id UUID,
  p_module TEXT,
  p_action TEXT,
  p_allowed BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_permission_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM public.profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id
  INTO v_target_account_id
  FROM public.profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found'
      USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  SELECT id
  INTO v_permission_id
  FROM public.permission_definitions
  WHERE module = p_module
    AND action = p_action;

  IF v_permission_id IS NULL THEN
    RAISE EXCEPTION 'Permission not found'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.member_permission_overrides (
    user_id,
    permission_id,
    allowed
  )
  VALUES (
    p_user_id,
    v_permission_id,
    p_allowed
  )
  ON CONFLICT (user_id, permission_id)
  DO UPDATE SET allowed = EXCLUDED.allowed;
END;
$$;

ALTER FUNCTION public.set_member_permission(
  UUID,
  TEXT,
  TEXT,
  BOOLEAN
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_member_permission(
  UUID,
  TEXT,
  TEXT,
  BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_member_permission(
  UUID,
  TEXT,
  TEXT,
  BOOLEAN
) TO authenticated;