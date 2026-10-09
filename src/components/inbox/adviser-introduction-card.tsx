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
      <Button type="button" variant="ghost" size="sm" className="mb-2" onClick={() => setDismissed(false)} disabled={disabled}>
        Preparar mi presentación
      </Button>
    );
  }

  return (
    <section className="mb-3 rounded-lg border border-primary/25 bg-primary/5 p-3" aria-label="Presentación de la asesora">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Tu presentación · {adviser.name}</p>
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>Cerrar</Button>
      </div>
      <label className="mt-2 block text-xs">
        Área de atención
        <input
          value={area}
          onChange={(event) => setArea(event.target.value)}
          placeholder="Ventas, fidelización, administración…"
          maxLength={80}
          disabled={disabled}
          className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <p className="mt-2 text-sm">{preview ?? "Indica tu área para preparar la presentación."}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {hasDraft ? "Ya tienes un borrador. Envíalo o bórralo antes de usar esta presentación." : "Podrás editarla antes de pulsar Enviar o Enter. No se envía automáticamente."}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
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
