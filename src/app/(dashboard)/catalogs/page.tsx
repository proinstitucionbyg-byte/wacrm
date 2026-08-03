export default function CatalogsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Catálogos</h1>
        <p className="text-muted-foreground">
          Administra las colecciones y artículos que estarán disponibles para compartir por WhatsApp.
        </p>
      </div>

      <div className="rounded-lg border border-dashed p-10 text-center">
        <h2 className="text-xl font-semibold">Próximamente</h2>
        <p className="mt-2 text-muted-foreground">
          Aquí aparecerán tus catálogos, productos y colecciones.
        </p>
      </div>
    </div>
  );
}