'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { quoteReportCell } from '@/lib/inbox/report-csv';
type Case = {
  id: string;
  reason: string;
  solution: string;
  status: string;
  adviser: string;
  area: string;
  conversation_id: string;
};
type Report = {
  period_kind: string;
  period_start: string;
  period_end: string;
  cases: Case[];
};
export function CaseReports({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<Report[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void createClient()
      .from('case_reports')
      .select('*')
      .eq('account_id', accountId)
      .order('period_start', { ascending: false })
      .limit(24)
      .then(({ data, error }) => {
        if (active) {
          setRows(data ?? []);
          setError(error ? 'No se pudieron cargar los reportes de casos.' : '');
        }
      });
    return () => {
      active = false;
    };
  }, [accountId]);
  function exportCsv(report: Report) {
    const csv =
      '\uFEFF' +
      [
        'MOTIVO;SOLUCIÓN;ESTADO;RESPONSABLE;ÁREA',
        ...report.cases.map((row) =>
          [row.reason, row.solution, row.status, row.adviser, row.area]
            .map(quoteReportCell)
            .join(';')
        ),
      ].join('\r\n');
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `casos-${report.period_kind}-${report.period_start.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="space-y-3 border-t pt-5">
      <h2 className="text-xl font-bold">QUEJAS, MOTIVOS Y SOLUCIONES</h2>
      <p className="text-muted-foreground text-sm">
        Casos registrados por el equipo en la ficha lateral del chat. Informe
        semanal los sábados a las 7:00 a. m. de Lima y acumulado mensual. Se
        agrupan por fecha de registro del caso; el estado corresponde a la fecha
        del informe.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!rows.length && !error && (
        <p className="text-sm">
          El primer informe se generará el próximo sábado.
        </p>
      )}
      {rows.map((report) => (
        <article
          key={report.period_kind + report.period_start}
          className="space-y-3 rounded-xl border p-4"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <h3 className="font-semibold">
                {report.period_kind === 'week'
                  ? 'SEMANA COMPLETA'
                  : 'ACUMULADO MENSUAL'}
              </h3>
              <p className="text-xs">
                {new Date(report.period_start).toLocaleDateString('es-PE', {
                  timeZone: 'America/Lima',
                })}{' '}
                a{' '}
                {new Date(report.period_end).toLocaleDateString('es-PE', {
                  timeZone: 'America/Lima',
                })}{' '}
                · {report.cases.length} casos ·{' '}
                {report.cases.filter((row) => row.status === 'resolved').length}{' '}
                resueltos
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportCsv(report)}
            >
              DESCARGAR CSV
            </Button>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Motivo</th>
                  <th className="p-2 text-left">Solución</th>
                  <th className="p-2 text-left">Estado</th>
                  <th className="p-2 text-left">Responsable / área</th>
                </tr>
              </thead>
              <tbody>
                {report.cases.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="p-2 align-top">
                      <a
                        className="text-primary underline"
                        href={`/inbox?c=${row.conversation_id}`}
                      >
                        {row.reason}
                      </a>
                    </td>
                    <td className="p-2 align-top break-words whitespace-pre-wrap">
                      {row.solution || 'Sin solución registrada'}
                    </td>
                    <td className="p-2 align-top">
                      {row.status === 'resolved' ? 'Resuelto' : 'Pendiente'}
                    </td>
                    <td className="p-2 align-top">
                      {row.adviser} / {row.area}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!report.cases.length && (
              <p className="text-sm">Sin casos registrados en este periodo.</p>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
