import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdviserIntroductionCard } from "./adviser-introduction-card";

describe("tarjeta de presentación", () => {
  it("keeps the presentation collapsed after human contact", () => {
    const html = renderToStaticMarkup(<AdviserIntroductionCard storageKey="seen" alreadyContacted adviser={{name:"Ashley",area:"VENTAS"}} disabled={false} hasDraft={false} onUse={vi.fn()} />);
    expect(html).not.toContain("Soy Ashley, tu asesora de ventas.");
    expect(html).toContain("Preparar mi presentación");
  });
  it("muestra un borrador sin invocar la acción de usarlo", () => {
    const onUse = vi.fn();
    const html = renderToStaticMarkup(<AdviserIntroductionCard storageKey="test-intro" adviser={{ name: "Ashley", area: "VENTAS" }} disabled={false} hasDraft={false} onUse={onUse} />);
    expect(html).toContain("Soy Ashley, tu asesora de ventas.");
    expect(html).toContain("No se envía automáticamente.");
    expect(onUse).not.toHaveBeenCalled();
  });

  it("bloquea la inserción si ya hay un borrador", () => {
    const html = renderToStaticMarkup(<AdviserIntroductionCard storageKey="test-intro" adviser={{ name: "Ashley", area: "VENTAS" }} disabled={false} hasDraft={true} onUse={vi.fn()} />);
    expect(html).toContain("Ya tienes un borrador.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Usar presentación<\/button>/);
  });

  it("bloquea la inserción fuera de la ventana o mientras se envía", () => {
    const html = renderToStaticMarkup(<AdviserIntroductionCard storageKey="test-intro" adviser={{ name: "Ashley", area: "VENTAS" }} disabled={true} hasDraft={false} onUse={vi.fn()} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Usar presentación<\/button>/);
  });

  it("pide el área y no prepara una presentación incompleta", () => {
    const html = renderToStaticMarkup(<AdviserIntroductionCard storageKey="test-intro" adviser={{ name: "Ashley", area: null }} disabled={false} hasDraft={false} onUse={vi.fn()} />);
    expect(html).toContain("Indica tu área");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Usar presentación<\/button>/);
  });
});
