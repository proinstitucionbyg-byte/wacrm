'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { EnrollmentData } from '@/lib/matriculas/enrollment';

export function EnrollmentEvidenceEditor({ id, version, data, disabled, onChange }: { id: string; version: number; data: EnrollmentData; disabled?: boolean; onChange: (patch: EnrollmentData) => void | Promise<void> }) {
  const fileInput=useRef<HTMLInputElement>(null);const [fileName,setFileName]=useState('');
  const [source, setSource] = useState('call'), [phone, setPhone] = useState(data.phone1 || ''), [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false), [kind, setKind] = useState('declaration');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState(''), [notice, setNotice] = useState(''), [photoId, setPhotoId] = useState('');
  async function attach(file?: File) {
    setBusy(true); setError(''); setNotice('');
    try {
      const form = new FormData(); form.set('version', String(version)); form.set('kind', file ? kind : 'confirmation');
      if (file) form.set('file', file); else { form.set('data', JSON.stringify(data)); form.set('source', source); form.set('phone', phone); form.set('note', note); form.set('confirmed', String(confirmed)); }
      const response = await fetch(`/api/enrollments/${id}/evidence`, { method: 'POST', body: form });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'No se pudo adjuntar.');
      const item = result.evidence;
      if (item.kind === 'declaration') await onChange({ declaration_message_ids: [item.id], identity_message_ids: [], identity_confirmed: false });
      else if (item.kind === 'guardian') await onChange({ guardian_message_ids: [...new Set([...(data.guardian_message_ids || []), item.id])].slice(-4) });
      else await onChange({ identity_message_ids: [...new Set([...(data.identity_message_ids || []), item.id])].slice(-4), declaration_message_ids: [], identity_confirmed: false });
      setPhotoId(['front','back'].includes(item.kind) ? item.id : '');
      setPreview(item.url); setNotice("✓ Respaldo guardado. No necesitas seleccionar además una foto antigua si confirmaste los datos por llamada.");
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo adjuntar.'); } finally { setBusy(false); }
  }
  return <details className="rounded-lg border border-primary/30 p-3 text-sm"><summary className="cursor-pointer font-semibold">Datos por llamada / otro WhatsApp, o adjuntar respaldo</summary><fieldset disabled={disabled || busy} className="mt-3 space-y-3">
    <p>No necesitas que el estudiante vuelva a escribir todo en este chat. Completa nombre, documento y correo en la ficha y confirma cómo los obtuviste. El pago sigue requiriendo validación.</p>
    <div className="grid gap-3 sm:grid-cols-2"><label>¿Dónde confirmaste los datos?<select className="mt-1 w-full rounded border bg-background p-2" value={source} onChange={e => setSource(e.target.value)}><option value="call">Por llamada</option><option value="other_whatsapp">Por otro WhatsApp</option></select></label><label>Teléfono del estudiante en esa comunicación<input className="mt-1 w-full rounded border bg-background p-2" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+51…" /></label></div>
    <label className="block">Nota de la confirmación (opcional)<textarea className="mt-1 min-h-20 w-full rounded border bg-background p-2" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="Por ejemplo: confirmó su correo durante la llamada de hoy." /></label>
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmé con el estudiante el nombre, documento y correo que aparecen en esta ficha.</label>
    <Button type="button" size="sm" disabled={!confirmed || busy || disabled} onClick={() => void attach()}>Confirmar datos sin captura</Button>
    <details className="space-y-2 border-t pt-3"><summary className="min-h-11 cursor-pointer font-medium">Otra opción: adjuntar una imagen de mi computadora</summary><p>Puede ser una foto del documento o una captura de otro WhatsApp donde se vea el teléfono del estudiante. Selecciona y revisa la imagen correcta.</p><label className="block">Tipo de respaldo<select className="ml-2 rounded border bg-background p-2" value={kind} onChange={e => setKind(e.target.value)}><option value="declaration">Captura / respaldo de los datos</option><option value="front">Documento: primera cara</option><option value="back">Documento: segunda cara</option><option value="guardian">Documento del tutor</option></select></label><Button type="button" variant="outline" className="min-h-11 w-full border-primary text-sm" onClick={()=>fileInput.current?.click()}>📎 Seleccionar imagen</Button><input ref={fileInput} className="hidden" aria-label="Adjuntar respaldo de matrícula" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) {setFileName(file.name);void attach(file);} }} />{fileName&&<p className="break-all text-xs" role="status">Archivo: {fileName}</p>}</details>
    {photoId && <label className="flex items-start gap-2"><input type="checkbox" checked={data.identity_confirmed===true} onChange={e=>onChange({identity_confirmed:e.target.checked})} />Revisé la foto adjuntada y coincide con el nombre y documento de la ficha.</label>}
    {busy && <p role="status">Adjuntando respaldo…</p>}{error && <p role="alert" className="text-destructive">{error}</p>}{notice && <p role="status">{notice}</p>}{preview && <a className="block underline" href={preview} target="_blank" rel="noopener noreferrer">Ver respaldo adjuntado</a>}
  </fieldset></details>;
}
