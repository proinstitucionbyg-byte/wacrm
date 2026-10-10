import { describe, expect, it } from 'vitest';
import { folderPath, isFolderDescendant } from './folder-path';
const folders = [{ id: 'a', name: 'VENTAS', parent_id: null }, { id: 'b', name: 'PAGOS', parent_id: 'a' }, { id: 'c', name: 'PAGOS', parent_id: null }];
describe('carpetas de automatizaciones', () => {
  it('distingue carpetas de igual nombre mediante su ruta', () => {
    expect(folderPath(folders, 'b')).toBe('PRINCIPAL / VENTAS / PAGOS');
    expect(folderPath(folders, 'c')).toBe('PRINCIPAL / PAGOS');
  });
  it('excluye destino propio y descendientes', () => {
    expect(isFolderDescendant(folders, 'b', 'a')).toBe(true);
    expect(isFolderDescendant(folders, 'a', 'a')).toBe(true);
    expect(isFolderDescendant(folders, 'c', 'a')).toBe(false);
  });
  it('no queda en bucle ante referencias invalidas', () => {
    expect(folderPath([], 'missing')).toBe('PRINCIPAL');
    expect(folderPath([{id:'a', name:'A', parent_id:'a'}], 'a')).toBe('PRINCIPAL / A');
  });
});
