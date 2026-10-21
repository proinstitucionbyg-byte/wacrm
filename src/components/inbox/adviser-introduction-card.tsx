"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildAdviserIntroduction, type AdviserIntroduction } from "@/lib/inbox/adviser-introduction";

export function AdviserIntroductionCard({
  adviser,
  disabled,
  hasDraft,
  onUse,
  storageKey,
  alreadyContacted = false,
}: {
  adviser: AdviserIntroduction;
  disabled: boolean;
  hasDraft: boolean;
  onUse: (text: string) => void;
  storageKey: string;
  alreadyContacted?: boolean;
}) {
  const [area, setArea] = useState(adviser.area ?? "");
  const [dismissed, setDismissed] = useState(() => {
    if (alreadyContacted) return true;
    try { return typeof window !== 'undefined' && localStorage.getItem(storageKey) === 'seen'; }
    catch { return false; }
  });
  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(storageKey, 'seen'); } catch { /* Private browsing may disable storage. */ }
  }
  const preview = buildAdviserIntroduction(adviser.name, area);
  useEffect(() => {
    try { localStorage.setItem(storageKey, 'seen'); } catch { /* Storage is optional. */ }
  }, [storageKey]);

  if (dismissed) {
    return (
      <Button type="button" variant="ghost" size="sm" className="mb-1 h-7 px-2 text-xs sm:mb-2 sm:h-8 sm:text-sm" onClick={() => setDismissed(false)} disabled={disabled}>
        Preparar mi presentación
      </Button>
    );
  }

  return (
    <section className="mb-1 rounded-md border border-primary/25 bg-primary/5 p-2 sm:mb-3 sm:rounded-lg sm:p-3" aria-label="Presentación de la asesora">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium sm:text-sm">Tu presentación · {adviser.name}</p>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs sm:h-8 sm:text-sm" onClick={dismiss}>Cerrar</Button>
      </div>
      <label className="mt-1 block text-[11px] sm:mt-2 sm:text-xs">
        Área de atención
        <input
          value={area}
          onChange={(event) => setArea(event.target.value)}
          placeholder="Ventas, fidelización, administración…"
          maxLength={80}
          disabled={disabled}
          className="mt-1 block h-8 w-full rounded-md border bg-background px-2 py-1 text-xs sm:h-auto sm:py-1.5 sm:text-sm"
        />
      </label>
      <p className="mt-1 text-xs sm:mt-2 sm:text-sm">{preview ?? "Indica tu área para preparar la presentación."}</p>
      <p className="mt-1 hidden text-xs text-muted-foreground sm:mt-2 sm:block">
        {hasDraft ? "Ya tienes un borrador. Envíalo o bórralo antes de usar esta presentación." : "Podrás editarla antes de pulsar Enviar o Enter. No se envía automáticamente."}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1 h-7 px-2 text-xs sm:mt-2 sm:h-8 sm:text-sm"
        disabled={disabled || hasDraft || !preview}
        onClick={() => {
          if (disabled || hasDraft || !preview) return;
          onUse(preview);
          dismiss();
        }}
      >
        Usar presentación
      </Button>
    </section>
  );
}
