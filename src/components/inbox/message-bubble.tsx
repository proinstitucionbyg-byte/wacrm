"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";
import { MediaViewer } from "@/components/media/media-viewer";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  selectionMode: boolean;
selected: boolean;
onToggleSelection: () => void;
onStartSelection: () => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

function AudioTranscript({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const cleanedText = text.replace(/^🎤\s*/, "").trim();
  const words = cleanedText.split(/\s+/).filter(Boolean);
  const canExpand = words.length > 3 && !/^\[.*\]$/.test(cleanedText);
  const preview = words.slice(0, 3).join(" ");

  return (
    <p className="mt-1 whitespace-pre-wrap break-words text-sm">
      🎤 {expanded || !canExpand ? cleanedText : `${preview}…`}
      {canExpand && (
        <button
          type="button"
          className="ml-1 underline underline-offset-2"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Leer menos" : "Leer más"}
        </button>
      )}
    </p>
  );
}

const IMAGE_ANALYSIS_LABELS: Record<string, string> = {
  document_type: "Tipo de documento",
  full_name: "Nombre",
  document_number: "Número de documento",
  amount: "Monto",
  currency: "Moneda",
  date: "Fecha",
  transaction_reference: "Código de operación",
  payer: "Pagador",
  recipient: "Destinatario",
  institution: "Entidad",
};

function ImageAnalysisPanel({ message }: { message: Message }) {
  const analysis = message.image_analysis;
  if (!analysis) return null;

  if (analysis.status === "failed") {
    const reason = analysis.failure_reason;
    const details =
      reason === "unsupported_format"
        ? "Este formato no se puede leer automáticamente."
        : reason === "too_large"
          ? "La imagen supera el tamaño que se puede revisar automáticamente."
          : reason === "not_configured"
            ? "La lectura automática no está disponible."
            : "No se pudo leer con claridad.";
    return (
      <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        <p className="font-medium">Revisión manual pendiente</p>
        <p className="mt-1 text-muted-foreground">{details} Revisa la imagen directamente.</p>
      </div>
    );
  }

  const fields = Object.entries(analysis.fields ?? {}).filter(
    ([, value]) => typeof value === "string" && value.trim(),
  );
  const category =
    analysis.category === "identity_document"
      ? "Posible documento de identidad"
      : analysis.category === "payment_receipt"
        ? "Posible comprobante de pago"
        : analysis.category === "other"
          ? "Otra imagen"
          : "Tipo de imagen no claro";

  return (
    <div className="mt-2 max-w-72 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
      <p className="font-medium">Lectura de IA · pendiente de revisión</p>
      <p className="mt-1 text-muted-foreground">{category}</p>
      {analysis.summary && <p className="mt-2 whitespace-pre-wrap">{analysis.summary}</p>}
      {analysis.recipient_check && (
        <div className="mt-2">
          <p>Destinatario esperado: {analysis.recipient_check.expected}</p>
          <p className="font-medium">
            {analysis.recipient_check.status === "exact_match"
              ? "El nombre completo coincide. Pago pendiente de aprobación."
              : analysis.recipient_check.status === "missing"
                ? "No se pudo leer el destinatario. Revisión requerida."
                : "Nombre abreviado o diferente. Revisión requerida."}
          </p>
        </div>
      )}
      {fields.length > 0 && (
        <dl className="mt-2 space-y-1">
          {fields.map(([key, value]) => (
            <div key={key} className="flex gap-1">
              <dt className="shrink-0 font-medium">{IMAGE_ANALYSIS_LABELS[key] ?? key}:</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(analysis.observations?.length ?? 0) > 0 && (
        <ul className="mt-2 list-inside list-disc text-muted-foreground">
          {analysis.observations?.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>
      )}
      <p className="mt-2 text-muted-foreground">
        La lectura no confirma que el documento o el pago sean válidos. Verifícalos antes de aprobar.
      </p>
    </div>
  );
}

function MediaImage({
  url,
  alt,
  onOpen,
}: {
  url: string;
  alt: string;
  onOpen: (url: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <img
  src={src ?? ""}
  alt={alt}
  className="max-h-72 max-w-72 rounded-2xl object-cover cursor-pointer shadow-lg"
  onClick={() => {
    if (src) onOpen(src);
  }}
  onError={() => setError(true)}
/>
  );
}

function MessageContent({
  message,
  t,
  onOpenImage,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  onOpenImage: (url: string) => void;
}) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage
  url={message.media_url}
  alt="Shared image"
  onOpen={onOpenImage}
/>
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
          <ImageAnalysisPanel message={message} />
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-72 max-w-72 rounded-2xl shadow-lg"
            />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
          {message.content_text && <AudioTranscript text={message.content_text} />}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || t("document")}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  selectionMode,
  selected,
  onToggleSelection,
  onStartSelection,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
className={cn(
  "flex flex-col",
  isAgent ? "items-end" : "items-start",
  selectionMode && "cursor-pointer",
)}
  onClick={() => {
    if (selectionMode) {
      onToggleSelection();
    }
  }}
  onContextMenu={(e) => {
  e.preventDefault();

  console.log("RIGHT CLICK");
  console.log(onStartSelection);

  console.log("ANTES");
  onStartSelection();
  console.log("DESPUÉS");
}}
>
      <div
  className={cn(
    "relative rounded-3xl px-4 py-3 shadow-lg",
    isAgent
      ? "rounded-br-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/20"
      : "rounded-bl-lg border border-slate-700 bg-slate-900/70 text-white",
      selected && "ring-2 ring-primary"
  )}
>
  {selected && (
    <div className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
      ✓
    </div>
  )}
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent
  message={message}
  t={t}
  onOpenImage={(url) => {
    setViewerUrl(url);
    setViewerOpen(true);
  }}
/>
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
<MediaViewer
  open={viewerOpen}
  imageUrl={viewerUrl}
  onOpenChange={setViewerOpen}
/>
    </div>
  );
}
