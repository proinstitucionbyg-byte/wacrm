"use client";

import Link from "next/link";
import {InboxSearchShortcut} from "./inbox-search-shortcut";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Bell, Bot, GraduationCap, LayoutDashboard, FolderOpen, Zap, UsersRound, Radio, GitBranch, PackageOpen, ShieldCheck, Workflow, ChartNoAxesCombined, LogOut, Menu, MessageCircle, Settings as SettingsIcon, User } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IncomingMessageSoundToggle } from "@/components/media/incoming-message-sound";
import { ModeToggle } from "@/components/layout/mode-toggle";

const pageTitles: Record<string, string> = {
  "/dashboard": "dashboard",
  "/inbox": "inbox",
  "/notifications": "notifications",
  "/contacts": "contacts",
  "/pipelines": "pipelines",
  "/broadcasts": "broadcasts",
  "/automations": "automations",
  "/settings": "settings",
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "dashboard";
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

import { useTranslations } from "next-intl";

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const titleKey = getPageTitleKey(pathname);
  const workspaceTitles: Record<string, string> = {
    '/multichannel':'Bot multicanal','/agents':'Agentes IA','/catalogs':'Catálogos',
    '/reports':'Estadísticas de primeras frases','/automations/media':'Mis archivos',
    '/enrollments':'Registro de matrículas','/payments':'Validación de pagos','/team-chat':'Chat interno',
    '/flows':'Flujos',
  };
  const workspaceTitle = Object.entries(workspaceTitles).find(([path]) => pathname === path || pathname.startsWith(path+'/'))?.[1];
  const pageIcons={'/automations/media':FolderOpen,'/automations':Zap,'/inbox':MessageCircle,'/multichannel':Bot,'/agents':Bot,'/enrollments':GraduationCap,'/payments':ShieldCheck,'/settings':SettingsIcon,'/contacts':UsersRound,'/team-chat':UsersRound,'/broadcasts':Radio,'/pipelines':GitBranch,'/catalogs':PackageOpen,'/flows':Workflow,'/reports':ChartNoAxesCombined,'/notifications':Bell};
  const PageIcon=Object.entries(pageIcons).find(([path])=>pathname===path||pathname.startsWith(path+'/'))?.[1]??LayoutDashboard;

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="crm-header flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
      <div className="crm-header-page-title flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="crm-header-icon" data-section={pathname.split("/")[1]} aria-hidden="true"><PageIcon className="size-5"/></span>
        <div className="min-w-0"><h1 className="truncate text-base font-semibold text-foreground sm:text-xl">
          {workspaceTitle ?? t(titleKey as string)}
        </h1><p className="crm-header-description truncate">{pathname.startsWith("/inbox") ? "Conversaciones, matrículas y seguimiento" : pathname.startsWith("/multichannel") ? "Mensajes y conexiones en un solo lugar" : "Tu espacio de trabajo · INSTICRECE"}</p></div>
      </div>

      <InboxSearchShortcut/>
      <div className="crm-header-tools flex items-center gap-1 sm:gap-2">
        <Link href="/notifications" aria-label="Notificaciones" className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Bell className="size-5"/></Link>
        <IncomingMessageSoundToggle/>
        <ModeToggle />

        <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70 sm:gap-3 sm:pl-1 sm:pr-3"
          aria-label={t("openAccountMenu")}
        >
          <Avatar className="size-8">
            {profile?.avatar_url ? (
              <AvatarImage
                src={profile.avatar_url}
                alt={profile.full_name ?? t("defaultAvatar")}
              />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {profile?.full_name ?? t("defaultUser")}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-56 bg-popover text-popover-foreground ring-border"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">
              {profile?.full_name ?? t("defaultUser")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {profile?.email ?? ""}
            </p>
          </div>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=profile"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <User className="size-4" />
            {t("menuProfile")}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=whatsapp"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <SettingsIcon className="size-4" />
            {t("menuSettings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            onClick={signOut}
            className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <LogOut className="size-4" />
            {t("menuSignOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
