import { describe, expect, it } from 'vitest';
import { quoteReportCell } from './report-csv';
describe('report CSV', () => {
  it('escapes quotes and preserves line breaks', () => {
    expect(quoteReportCell('Hola "Luis"\nInformación')).toBe('"Hola ""Luis""\nInformación"');
  });
  it.each(['=1+1', '+SUM(1)', '-1+1', '@SUM(1)', '  =1'])('exports %s as literal text', text => {
    expect(quoteReportCell(text)).toBe('"\'' + text + '"');
  });
});
