import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ManualEnrollment} from './manual-enrollment';

describe('entrada de matrícula manual',()=>{
  it('muestra una entrada visible y mantiene el formulario fuera de la lista inicial',()=>{
    const onCreated=vi.fn();
    const html=renderToStaticMarkup(<ManualEnrollment onCreated={onCreated}/>);
    expect(html).toContain('Ingresar un estudiante');
    expect(html).toContain('+ Nueva matrícula manual');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="file"');
    expect(onCreated).not.toHaveBeenCalled();
  });
});
