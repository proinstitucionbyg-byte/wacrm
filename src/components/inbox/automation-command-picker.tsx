'use client';
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
export function AutomationCommandPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (text: string) => void;
}) {
  const [blocks, setBlocks] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch('/api/inbox/commands')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) setBlocks(data.blocks);
      })
      .catch((error) => toast.error(error.message));
    return () => {
      active = false;
    };
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>BLOQUES PREPARADOS</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Selecciona la promoción, malla o medios de pago. Después pulsa ENVIAR
          en el chat.
        </p>
        <Input
          aria-label="Buscar bloque preparado"
          placeholder="BUSCAR"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {blocks
            .filter((block) =>
              block.name.toLowerCase().includes(search.toLowerCase())
            )
            .map((block) => (
              <Button
                key={block.id}
                variant="outline"
                className="h-auto w-full justify-start text-left whitespace-normal"
                onClick={() => {
                  onPick(`MANDAR(${block.name})`);
                  onOpenChange(false);
                }}
              >
                {block.name}
              </Button>
            ))}
          {blocks.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No hay bloques activos disponibles.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
