import { describe, expect, it } from "vitest";
import { buildAdviserIntroduction, getAdviserIntroduction, getAdviserNickname, hasContactedSinceAssignment } from "./adviser-introduction";

describe("presentación manual de la asesora", () => {
  it('requires a new presentation after a new transfer to the same adviser',()=>{
    const messages=[{sender_type:'agent',sender_id:'ashley',created_at:'2026-10-09T12:00:00Z'}];
    expect(hasContactedSinceAssignment(messages,'ashley','2026-10-09T13:00:00Z')).toBe(false);
    expect(hasContactedSinceAssignment(messages,'ashley','2026-10-09T11:00:00Z')).toBe(true);
    expect(hasContactedSinceAssignment(messages,'other','2026-10-09T11:00:00Z')).toBe(false);
  });
  it("prepara ventas con el apodo", () => {
    expect(buildAdviserIntroduction("Ashley", "VENTAS")).toBe(
      "Hola, ¿qué tal? Soy Ashley, tu asesora de ventas. A partir de ahora te acompañaré con tu atención. ¿En qué puedo ayudarte?",
    );
  });

  it("reconoce fidelización con o sin tilde", () => {
    expect(buildAdviserIntroduction("Ashley", "FIDELIZACION")).toBe(buildAdviserIntroduction("Ashley", "fidelización"));
  });

  it("normaliza espacios sin eliminar las tildes del nombre", () => {
    expect(buildAdviserIntroduction("  María   José  ", "  finanzas  ")).toContain("Soy María José, tu asesora de finanzas.");
  });

  it("permite otra área sin inventar una", () => {
    expect(buildAdviserIntroduction("Ashley", "Soporte académico")).toContain("tu asesora de Soporte académico.");
    expect(buildAdviserIntroduction("Ashley", "  ")).toBeNull();
    expect(buildAdviserIntroduction("", "ventas")).toBeNull();
  });

  it("ofrece la presentación solo a quien tiene asignado el chat", () => {
    const profile = { full_name: "Maria Alejandra Perez", area: "VENTAS" };
    expect(getAdviserIntroduction("ashley", "ashley", profile, "Ashley")).toEqual({ name: "Ashley", area: "VENTAS" });
    expect(getAdviserIntroduction("maria", "ashley", profile, "Maria")).toBeNull();
  });

  it("no ofrece una identidad en chats sin asignación o sin sesión", () => {
    expect(getAdviserIntroduction("ashley", null, undefined, "Ashley")).toBeNull();
    expect(getAdviserIntroduction(undefined, "ashley", undefined, "Ashley")).toBeNull();
  });

  it("solicita el área cuando el perfil todavía no la tiene", () => {
    expect(getAdviserIntroduction("ashley", "ashley", undefined, "Ashley")).toEqual({ name: "Ashley", area: null });
  });

  it("no sustituye un apodo vacío por el nombre completo", () => {
    const profile = { full_name: "Maria Alejandra Perez", area: "VENTAS" };
    expect(getAdviserIntroduction("ashley", "ashley", profile, "")).toBeNull();
    expect(getAdviserIntroduction("ashley", "ashley", profile, " ")).toBeNull();
  });

  it("lee exclusivamente el apodo guardado y normaliza espacios", () => {
    expect(getAdviserNickname({ nickname: "  Ash   Ly  ", full_name: "Maria" })).toBe("Ash Ly");
    expect(getAdviserNickname({ full_name: "Maria" })).toBe("");
  });

  it("ignora metadatos ausentes o un apodo de tipo incorrecto", () => {
    for (const metadata of [null, undefined, "Ashley", { nickname: 123 }, { nickname: null }]) {
      expect(getAdviserNickname(metadata)).toBe("");
    }
  });
});
