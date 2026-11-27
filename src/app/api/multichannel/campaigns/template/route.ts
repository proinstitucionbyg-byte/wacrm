import ExcelJS from 'exceljs';
import{requireRole,toErrorResponse}from'@/lib/auth/account';
export const runtime='nodejs';
export async function GET(){
 try{await requireRole('owner');}catch(e){return toErrorResponse(e);}
 const book=new ExcelJS.Workbook();book.creator='INSTICRECE';
 const sheet=book.addWorksheet('Destinatarios',{views:[{state:'frozen',ySplit:1}]});
 sheet.columns=[{header:'Orden',key:'orden',width:12},{header:'Telefono',key:'telefono',width:28},{header:'Nombre',key:'nombre',width:38}];
 for(let i=1;i<=1000;i++)sheet.addRow({orden:i,telefono:'',nombre:''});
 sheet.getColumn('telefono').numFmt='@';
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF075EEA'}};sheet.getRow(1).height=26;
 sheet.autoFilter='A1:C1001';sheet.getCell('A1').note='El CRM conserva el orden de las filas; esta columna es solo una referencia.';
 sheet.getCell('B1').note='Pega el teléfono tal como lo tienes. Celulares de Perú: nueve dígitos o número completo con 51. Otros países: número internacional completo. Se aceptan +, espacios y guiones; el CRM reconoce el país y normaliza el teléfono.';
 const guide=book.addWorksheet('Como usar');guide.columns=[{width:115}];
 for(const line of ['PLANTILLA DE DESTINATARIOS — INSTICRECE','1. En Destinatarios, pega celular y nombre en la misma fila. No se incluyen números de ejemplo.','2. Solo completa Telefono y Nombre. El CRM reconoce el país desde el número completo, con o sin +. Para celulares de Perú también acepta los nueve dígitos.','3. Orden es solo referencia: se respeta el orden físico de las filas, sin ordenar por ese número.','4. Puedes dejar sin usar las filas que sobren. Máximo: 1000 destinatarios por campaña.','5. Guarda este Excel y cárgalo en Bot multicanal → Cargar lista de teléfonos → Revisar teléfonos.','6. También puedes copiar las columnas con sus encabezados y pegarlas directamente en el cuadro de destinatarios.','7. Fechas y otras variables se asignan desde el panel; también puedes añadir columnas fecha1, fecha2, etc.','8. Si el teléfono es nuevo, revisa su nombre y pulsa Registrar contactos nuevos antes de guardar la campaña.'])guide.addRow([line]);
 guide.getRow(1).font={bold:true,size:16};
 return new Response(new Uint8Array(await book.xlsx.writeBuffer()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="plantilla-destinatarios-insticrece.xlsx"','Cache-Control':'private, no-store'}});
}
