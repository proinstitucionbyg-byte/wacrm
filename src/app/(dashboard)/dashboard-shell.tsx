"use client";

import { useCallback, useEffect, useState } from "react";
import "@/app/crm-workspace.css";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { IncomingMessageSoundProvider } from "@/components/media/incoming-message-sound";
import { WorkspaceAudioProvider, WorkspaceAudioPlayer } from "@/components/media/workspace-audio";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { PendingInboxTitle } from '@/components/inbox/pending-title';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, accountId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <WorkspaceAudioProvider key={user.id+":"+accountId}><IncomingMessageSoundProvider>
    <div className="crm-shell flex h-screen overflow-hidden bg-background max-lg:h-dvh" data-crm-section={pathname.split("/")[1]}>
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <PendingInboxTitle />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="crm-content flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <WorkspaceAudioPlayer/>
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="crm-main flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
    </IncomingMessageSoundProvider></WorkspaceAudioProvider>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
