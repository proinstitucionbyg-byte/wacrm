"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, Hand, Undo2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";

// ------------------------------------------------------------
// Account AI status is the same for every conversation, so cache it per
// account and reuse it across thread switches instead of hitting
// /api/ai/config every time the agent opens a chat.
//
// Keyed by accountId (a multi-account user switching workspaces must not
// see the previous account's status), and only *successful* fetches are
// cached — a transient failure returns a default without poisoning the
// cache, so it retries on the next thread open rather than hiding the
// banner for the whole session.
// ------------------------------------------------------------
interface AiAccountStatus {
  autoReplyOn: boolean;
}
const statusCache = new Map<string, AiAccountStatus>();

async function fetchAiAccountStatus(accountId: string): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;
  try {
    const res = await fetch("/api/ai/config", { cache: "no-store" });
    if (!res.ok) return { autoReplyOn: false }; // don't cache a transient failure
    const j = await res.json();
    const status = {
      // AI auto-reply is "live" only when configured, the master switch
      // is on, and the inbound bot is enabled.
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false }; // don't cache
  }
}



/**
 * Inbox banner that surfaces + controls the AI auto-reply bot per
 * conversation:
 *   - bot active here → "AI is replying automatically" + [Take over]
 *   - bot paused here → the handoff note (if any) + [Resume AI]
 * Renders nothing when the account has no auto-reply configured, or when
 * the bot is active but a human already owns the thread (nothing to do).
 */
interface AiThreadBannerProps {
  conversationId: string;
  disabled: boolean;
  aiEnabled: boolean;
  automationEnabled: boolean;
  handoffSummary?: string | null;
  assignedAgentId?: string | null;
  currentUserId?: string | null;
  onChange?: (patch: {
  ai_enabled?: boolean;
  ai_autoreply_disabled?: boolean;
  automation_enabled?: boolean;
  assigned_agent_id?: string | null;
}) => void;
}

export function AiThreadBanner({ 
  conversationId, 
  disabled, 
  aiEnabled,
  automationEnabled, 
  handoffSummary, 
  onChange, 
}: AiThreadBannerProps) {
  const [aiDisabled, setAiDisabled] = useState(!aiEnabled);
  const [automationOn, setAutomationOn] = useState(automationEnabled);
  const [busy, setBusy] = useState(false);

  useEffect(() => { 
  setAiDisabled(!aiEnabled); 
}, [conversationId, aiEnabled]);

  useEffect(() => {
    setAutomationOn(automationEnabled);
  }, [conversationId, automationEnabled]);

  const toggleAI = useCallback(async () => {
    if (busy) return;

    const nextDisabled = !aiDisabled;
    setBusy(true);

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("conversations")
        .update({
          ai_enabled: !nextDisabled,
          ai_disabled_at: nextDisabled ? new Date().toISOString() : null,
        })
        .eq("id", conversationId);

      if (error) throw error;

      setAiDisabled(nextDisabled);

      onChange?.({
  ai_enabled: !nextDisabled,
});

      toast.success(
        nextDisabled ? "IA desactivada" : "IA activada"
      );
    } catch (error) {
      console.error("Failed to toggle AI:", error);
      toast.error("No se pudo cambiar el estado de la IA");
    } finally {
      setBusy(false);
    }
  }, [aiDisabled, busy, conversationId, onChange]);

  const toggleAutomation = useCallback(async () => {
    if (busy) return;

    const nextEnabled = !automationOn;
    setBusy(true);

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("conversations")
        .update({
          automation_enabled: nextEnabled,
          automation_disabled_at: nextEnabled ? null : new Date().toISOString(),
        })
        .eq("id", conversationId);

      if (error) throw error;

      setAutomationOn(nextEnabled);

      onChange?.({
        automation_enabled: nextEnabled,
      });

      toast.success(
        nextEnabled
          ? "Automatización activada"
          : "Automatización desactivada"
      );
    } catch (error) {
      console.error("Failed to toggle automation:", error);
      toast.error("No se pudo cambiar la automatización");
    } finally {
      setBusy(false);
    }
  }, [automationOn, busy, conversationId, onChange]);

  return (
    <Banner tone={aiDisabled && !automationOn ? "muted" : "primary"}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />

        <span className="truncate font-medium text-foreground">
          {aiDisabled ? "IA desactivada" : "IA activa"}
        </span>

        <span className="text-muted-foreground">•</span>

        <span className="truncate font-medium text-foreground">
          {automationOn
            ? "Automatización activa"
            : "Automatización desactivada"}
        </span>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        <BannerButton
          onClick={toggleAI}
          busy={busy}
          icon={Sparkles}
        >
          {aiDisabled ? "Activar IA" : "Desactivar IA"}
        </BannerButton>

        <BannerButton
          onClick={toggleAutomation}
          busy={busy}
          icon={Hand}
        >
          {automationOn
            ? "Desactivar automatización"
            : "Activar automatización"}
        </BannerButton>
      </div>
    </Banner>
  );
}
function Banner({
  tone,
  children,
}: {
  tone: "primary" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4",
        tone === "primary"
          ? "border-primary/20 bg-primary/5"
          : "border-border bg-muted/40",
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {children}
    </button>
  );
}
