"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  FileText,
  MessageCircle,
  Clock,
  Users,
  PhoneCall,
  Loader2,
  Folder,
  FolderPlus,
  FolderInput,
  ChevronDown,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import { useTranslations } from "next-intl"
import type { Automation } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import { triggerMeta, formatRelative } from "@/lib/automations/trigger-meta"
import { cn } from "@/lib/utils"

const TEMPLATE_ORDER: TemplateSlug[] = [
  "welcome_message",
  "out_of_office",
  "lead_qualifier",
  "follow_up_reminder",
]

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  out_of_office: Clock,
  lead_qualifier: Users,
  follow_up_reminder: PhoneCall,
}
type AutomationFolder = {
  id: string
  name: string
  parent_id: string | null
  created_at: string
  updated_at: string
}

type AutomationWithFolder = Automation & {
  folder_id: string | null
}

export default function AutomationsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
const selectedFolderId = searchParams.get("folder")
  const canCreate = useCan("send-messages")
  const t = useTranslations("Automations.list")
  const [automations, setAutomations] = useState<AutomationWithFolder[] | null>(null)
const [folders, setFolders] = useState<AutomationFolder[] | null>(null)
const [error, setError] = useState<string | null>(null)
const [creatingFolder, setCreatingFolder] = useState(false)
const [folderName, setFolderName] = useState("")
const [newFolderName, setNewFolderName] = useState("")
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null)
  const [pendingFolderDelete, setPendingFolderDelete] =
  useState<AutomationFolder | null>(null)

const [renamingFolder, setRenamingFolder] =
  useState<AutomationFolder | null>(null)


const [movingFolder, setMovingFolder] =
  useState<AutomationFolder | null>(null)

const [movingAutomation, setMovingAutomation] =
  useState<AutomationWithFolder | null>(null)

const [deleting, setDeleting] = useState(false)

  async function load() {
    try {
      const supabase = createClient()

let query = supabase
  .from("automations")
  .select("*")
  .order("created_at", { ascending: false })

if (selectedFolderId) {
  query = query.eq("folder_id", selectedFolderId)
} else {
  query = query.is("folder_id", null)
}

const { data, error: fetchErr } = await query

if (fetchErr) throw fetchErr

const foldersRes = await fetch("/api/automations/folders")

if (!foldersRes.ok) {
  const body = await foldersRes.json().catch(() => ({}))
  throw new Error(body?.error ?? "Failed to load folders")
}

const foldersBody = await foldersRes.json()

setAutomations((data ?? []) as AutomationWithFolder[])
setFolders((foldersBody.folders ?? []) as AutomationFolder[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations")
    }
  }
  async function createFolder() {
    const name = newFolderName.trim()

    if (!name) return

    const res = await fetch("/api/automations/folders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
  name,
  parent_id: selectedFolderId,
}),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? "Failed to create folder")
    }

    setNewFolderName("")
    setCreatingFolder(false)

    await load()
  }
    async function renameFolder() {
    if (!renamingFolder) return

    const name = folderName.trim()
    if (!name) return

    const res = await fetch("/api/automations/folders", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: renamingFolder.id,
        name,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? "No se pudo renombrar la carpeta")
      return
    }

    toast.success("Carpeta renombrada")
    setRenamingFolder(null)
    setFolderName("")
    await load()
  }
  async function duplicateFolder(folder: AutomationFolder) {
  const res = await fetch("/api/automations/folders/duplicate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: folder.id,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    toast.error(body?.error ?? "No se pudo duplicar la carpeta")
    return
  }

  toast.success("Carpeta duplicada correctamente")
  await load()
}
    async function deleteFolder() {
    if (!pendingFolderDelete) return

    const res = await fetch("/api/automations/folders", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: pendingFolderDelete.id,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? "No se pudo eliminar la carpeta")
      return
    }

    toast.success("Carpeta eliminada")
    setPendingFolderDelete(null)
    await load()
  }
  useEffect(() => {
  load()
}, [selectedFolderId])

  async function toggleActive(a: Automation, next: boolean) {
    // Optimistic flip so the switch feels instant.
    setAutomations((prev) =>
      prev?.map((x) => (x.id === a.id ? { ...x, is_active: next } : x)) ?? prev,
    )
    const res = await fetch(`/api/automations/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    })
    if (!res.ok) {
      // Roll back on error.
      setAutomations((prev) =>
        prev?.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x)) ?? prev,
      )
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.updateError"))
      return
    }
    toast.success(next ? t("toasts.activated") : t("toasts.paused"))
  }

  async function duplicate(a: Automation) {
    const res = await fetch(`/api/automations/${a.id}/duplicate`, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.duplicateError"))
      return
    }
    toast.success(t("toasts.duplicated"))
    load()
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const res = await fetch(`/api/automations/${pendingDelete.id}`, { method: "DELETE" })
    setDeleting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.deleteError"))
      return
    }
    toast.success(t("toasts.deleted"))
    setPendingDelete(null)
    load()
  }

  async function startFromTemplate(slug: TemplateSlug) {
    router.push(`/automations/new?template=${slug}`)
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
      </div>
    )
  }

  if (automations === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const showTemplates = automations.length < 3
  const folderList = folders ?? []
  const visibleFolders = folderList.filter(
  (folder) => folder.parent_id === selectedFolderId,
)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create automations"
          onClick={() =>
  router.push(
    selectedFolderId
      ? `/automations/new?folder=${selectedFolderId}`
      : "/automations/new",
  )
}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t("create")}
        </GatedButton>
      </div>

      {showTemplates && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("templatesTitle")}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {TEMPLATE_ORDER.map((slug) => {
              const t = AUTOMATION_TEMPLATES[slug]
              const Icon = TEMPLATE_ICON[slug]
              return (
                <button
                  key={slug}
                  onClick={() => startFromTemplate(slug)}
                  className="group flex flex-col items-start rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-card/80"
                >
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold text-foreground">{t.name}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                </button>
              )
            })}
          </div>
        </section>
      )}

<section className="space-y-3">
  <div className="flex items-center justify-between">
    <h2 className="text-sm font-semibold text-muted-foreground">
      Carpetas
    </h2>

    <Button
      variant="outline"
      size="sm"
      onClick={() => setCreatingFolder(true)}
    >
      <FolderPlus className="mr-2 h-4 w-4" />
      Nueva carpeta
    </Button>
  </div>
    {creatingFolder && (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
      <input
        value={newFolderName}
        onChange={(e) => setNewFolderName(e.target.value)}
        placeholder="Nombre de la carpeta"
        className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
        autoFocus
      />

      <Button
        size="sm"
        onClick={createFolder}
        disabled={!newFolderName.trim()}
      >
        Crear
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setCreatingFolder(false)
          setNewFolderName("")
        }}
      >
        Cancelar
      </Button>
    </div>
  )}

  {folderList.length > 0 && (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
   {visibleFolders.map((folder) => (
  <div
    key={folder.id}
    className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
  >
    <button
      type="button"
      onClick={() => {
        router.push(`/automations?folder=${folder.id}`)
      }}
      className="flex min-w-0 flex-1 items-center gap-3 text-left"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Folder className="h-5 w-5 text-primary" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {folder.name}
        </p>
      </div>
    </button>

    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Opciones de carpeta"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        

        <DropdownMenuItem
          onClick={() => {
            setRenamingFolder(folder)
            setFolderName(folder.name)
          }}
        >
          <Pencil className="h-4 w-4" />
          Renombrar
        </DropdownMenuItem>
        <DropdownMenuItem
  onClick={() => {
    duplicateFolder(folder)
  }}
>
  <Copy className="h-4 w-4" />
  Duplicar carpeta
</DropdownMenuItem>
<DropdownMenuItem
  onClick={() => {
    setMovingFolder(folder)
  }}
>
  <FolderInput className="h-4 w-4" />
  Mover
</DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            setPendingFolderDelete(folder)
          }}
        >
          <Trash2 className="h-4 w-4" />
          Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
))}
    </div>
  )}
</section>

      {automations.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("emptyDesc")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {automations.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              onToggle={(next) => toggleActive(a, next)}
              onEdit={() => router.push(`/automations/${a.id}/edit`)}
              onDuplicate={() => duplicate(a)}
              onMove={() => setMovingAutomation(a)}
              onLogs={() => router.push(`/automations/${a.id}/logs`)}
              onDelete={() => setPendingDelete(a)}
              t={t}
            />
          ))}
        </ul>
      )}

      <Dialog
  open={!!pendingDelete}
  onOpenChange={(v) => !v && setPendingDelete(null)}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{t("deleteTitle")}</DialogTitle>
      <DialogDescription>
        {t("deleteDesc", { name: pendingDelete?.name ?? "" })}
      </DialogDescription>
    </DialogHeader>

    <DialogFooter>
      <Button
        variant="ghost"
        onClick={() => setPendingDelete(null)}
        disabled={deleting}
      >
        {t("cancel")}
      </Button>

      <Button
        variant="destructive"
        onClick={confirmDelete}
        disabled={deleting}
      >
        {deleting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        {t("delete")}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<Dialog
  open={!!movingFolder}
  onOpenChange={(open) => {
    if (!open) setMovingFolder(null)
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Mover carpeta</DialogTitle>
      <DialogDescription>
        Selecciona dónde quieres mover "{movingFolder?.name}".
      </DialogDescription>
    </DialogHeader>

    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start"
        onClick={async () => {
          if (!movingFolder) return

          const res = await fetch("/api/automations/folders", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: movingFolder.id,
              parent_id: null,
            }),
          })

          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            toast.error(body?.error ?? "No se pudo mover la carpeta")
            return
          }

          toast.success("Carpeta movida")
          setMovingFolder(null)
          await load()
        }}
      >
        <Folder className="mr-2 h-4 w-4" />
        Carpeta principal
      </Button>

      {folderList
        .filter((folder) => folder.id !== movingFolder?.id)
        .map((folder) => (
          <Button
            key={folder.id}
            type="button"
            variant="outline"
            className="w-full justify-start"
            onClick={async () => {
              if (!movingFolder) return

              const res = await fetch("/api/automations/folders", {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  id: movingFolder.id,
                  parent_id: folder.id,
                }),
              })

              if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                toast.error(body?.error ?? "No se pudo mover la carpeta")
                return
              }

              toast.success("Carpeta movida")
              setMovingFolder(null)
              await load()
            }}
          >
            <Folder className="mr-2 h-4 w-4" />
            {folder.name}
          </Button>
        ))}
    </div>
  </DialogContent>
</Dialog>
<Dialog
  open={!!movingAutomation}
  onOpenChange={(open) => {
    if (!open) setMovingAutomation(null)
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Mover automatización</DialogTitle>
      <DialogDescription>
        Selecciona la carpeta donde quieres mover "{movingAutomation?.name}".
      </DialogDescription>
    </DialogHeader>

    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start"
        onClick={async () => {
          if (!movingAutomation) return

          const res = await fetch(`/api/automations/${movingAutomation.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              folder_id: null,
            }),
          })

          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            toast.error(
              body?.error ?? "No se pudo mover la automatización",
            )
            return
          }

          toast.success("Automatización movida")
          setMovingAutomation(null)
          await load()
        }}
      >
        <Folder className="mr-2 h-4 w-4" />
        Carpeta principal
      </Button>

      {folderList.map((folder) => (
        <Button
          key={folder.id}
          type="button"
          variant="outline"
          className="w-full justify-start"
          onClick={async () => {
            if (!movingAutomation) return

            const res = await fetch(`/api/automations/${movingAutomation.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                folder_id: folder.id,
              }),
            })

            if (!res.ok) {
              const body = await res.json().catch(() => ({}))
              toast.error(
                body?.error ?? "No se pudo mover la automatización",
              )
              return
            }

            toast.success("Automatización movida")
            setMovingAutomation(null)
            await load()
          }}
        >
          <Folder className="mr-2 h-4 w-4" />
          {folder.name}
        </Button>
      ))}
    </div>
  </DialogContent>
</Dialog>
<Dialog
  open={!!renamingFolder}
  onOpenChange={(open) => {
    if (!open) {
      setRenamingFolder(null)
      setFolderName("")
    }
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Renombrar carpeta</DialogTitle>
      <DialogDescription>
        Escribe el nuevo nombre de la carpeta.
      </DialogDescription>
    </DialogHeader>

    <input
      value={folderName}
      onChange={(e) => setFolderName(e.target.value)}
      placeholder="Nombre de la carpeta"
      autoFocus
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
    />

    <DialogFooter>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setRenamingFolder(null)
          setFolderName("")
        }}
      >
        Cancelar
      </Button>

      <Button
        type="button"
        onClick={renameFolder}
        disabled={!folderName.trim()}
      >
        Guardar
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
<Dialog
  open={!!pendingFolderDelete}
  onOpenChange={(open) => {
    if (!open) setPendingFolderDelete(null)
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Eliminar carpeta</DialogTitle>
      <DialogDescription>
        ¿Estás seguro de que quieres eliminar la carpeta "
        {pendingFolderDelete?.name}"?
        Las automatizaciones no se eliminarán.
      </DialogDescription>
    </DialogHeader>

    <DialogFooter>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setPendingFolderDelete(null)}
      >
        Cancelar
      </Button>

      <Button
        type="button"
        variant="destructive"
        onClick={deleteFolder}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Eliminar
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
    </div>
  )
}

function AutomationCard({
  automation,
  onToggle,
  onEdit,
  onDuplicate,
  onMove,
  onLogs,
  onDelete,
  t,
}: {
  automation: Automation
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onMove: () => void
  onLogs: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const meta = triggerMeta(automation.trigger_type)
  return (
    <li className="rounded-xl border border-border bg-card transition-colors hover:border-border">
      <div className="flex items-center gap-4 p-4">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10"
          aria-hidden
        >
          <Zap className="h-5 w-5 text-primary" />
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {automation.name}
            </span>
            {automation.is_active && (
              <span className="relative flex h-2 w-2" aria-label="active">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            )}
          </div>
          {automation.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{automation.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                meta.pillClass,
              )}
            >
              {meta.label}
            </span>
            <span className="tabular-nums">
              {automation.execution_count === 1
                ? t("runs", { count: automation.execution_count })
                : t("runsPlural", { count: automation.execution_count })}
            </span>
            <span aria-hidden>·</span>
            <span>{t("lastRun", { time: formatRelative(automation.last_executed_at) })}</span>
          </div>
        </button>

        <div className="flex items-center gap-3">
          <Switch
            checked={automation.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={automation.is_active ? t("deactivate") : t("activate")}
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Open menu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              
  <DropdownMenuItem onClick={onEdit}>
    <Pencil className="h-4 w-4" />
    {t("edit")}
  </DropdownMenuItem>

  <DropdownMenuItem onClick={onDuplicate}>
    <Copy className="h-4 w-4" />
    {t("duplicate")}
  </DropdownMenuItem>

  <DropdownMenuItem onClick={onMove}>
    <FolderInput className="h-4 w-4" />
    Mover
  </DropdownMenuItem>

  <DropdownMenuItem onClick={onLogs}>
    <FileText className="h-4 w-4" />
    {t("viewLogs")}
  </DropdownMenuItem>

  <DropdownMenuSeparator />

  <DropdownMenuItem variant="destructive" onClick={onDelete}>
    <Trash2 className="h-4 w-4" />
    {t("delete")}
  </DropdownMenuItem>
</DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  )
}
