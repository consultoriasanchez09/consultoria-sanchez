'use strict';

/** Textos del kit. Los datos de cada empresa entran por los campos {razon_social}, {ruc},
 *  {representante_legal}, {direccion}, {ciudad}, {actividad} y {fecha}. */

const PIE = 'Ley Orgánica para la Igualdad Salarial entre Mujeres y Hombres · Acuerdo Ministerial MDT-2025-006, Art. 4';

const posters = {
  valor: {
    band: '#1D4ED8',
    titles: ['EN ESTA EMPRESA', 'EL TRABAJO DE IGUAL VALOR', 'TIENE IGUAL REMUNERACIÓN'],
    lines: [
      'Valoramos cada puesto con criterios objetivos:',
      'competencias · esfuerzo · responsabilidad · condiciones de trabajo.',
      'El sexo o el género nunca determinan lo que ganas.',
      '',
      'Convenio 100 OIT · Art. 79 Código del Trabajo'
    ]
  },
  denuncia: {
    band: '#B91C1C',
    titles: ['CANAL CONFIDENCIAL', 'DE DENUNCIA CONTRA', 'EL ACOSO LABORAL'],
    lines: [
      'Si sufres o presencias acoso, hostigamiento o violencia,',
      'repórtalo a Talento Humano o al Representante Legal.',
      'Tu identidad se protege. Las represalias están prohibidas.',
      '',
      'Convenio 190 OIT · Código del Trabajo'
    ]
  },
  tolerancia: {
    band: '#047857',
    titles: ['TOLERANCIA CERO', 'A LA DISCRIMINACIÓN'],
    lines: [
      'Nadie será tratado de forma distinta por su sexo, género, embarazo,',
      'maternidad, paternidad, edad, discapacidad, etnia u orientación.',
      'Seleccionamos y ascendemos por méritos.',
      'Nunca pedimos pruebas de embarazo ni preguntamos sobre tu vida familiar.',
      '',
      'Art. 11.2 y 331 Constitución · MDT-2017-082'
    ]
  }
};

const politica = {
  titulo: 'POLÍTICA DE IGUALDAD SALARIAL, IGUALDAD DE GÉNERO Y NO DISCRIMINACIÓN',
  considerandos: [
    'Que la Constitución de la República reconoce la igualdad de todas las personas y prohíbe toda forma de discriminación (Art. 11.2) y garantiza a las mujeres igualdad en el acceso al empleo, formación, promoción y remuneración equitativa (Art. 331).',
    'Que el Art. 79 del Código del Trabajo dispone que a trabajo igual corresponde igual remuneración, sin discriminación.',
    'Que la Ley Orgánica para la Igualdad Salarial entre Mujeres y Hombres y el Acuerdo Ministerial MDT-2025-006 obligan a los empleadores a capacitar y sensibilizar a su personal en igualdad de género, no discriminación y trabajo de igual valor.',
    'Que el Ecuador ha ratificado los Convenios 100, 111, 156 y 190 de la Organización Internacional del Trabajo.'
  ],
  articulos: [
    ['Artículo 1. Objeto.-', 'Garantizar la igualdad de remuneración entre mujeres y hombres por trabajo de igual valor, prevenir toda forma de discriminación y erradicar la violencia y el acoso en el centro de trabajo.'],
    ['Artículo 2. Ámbito.-', 'Aplica a todos los trabajadores y trabajadoras, directivos, representante legal, practicantes, contratistas y visitantes, en todos los centros de trabajo de la empresa.'],
    ['Artículo 3. Igual remuneración.-', 'La empresa fija las remuneraciones con base en criterios objetivos: competencias y cualificaciones, esfuerzo, responsabilidad y condiciones de trabajo. Ningún componente de la remuneración (sueldo, bonos, comisiones, beneficios) se determina en razón del sexo o género de la persona.'],
    ['Artículo 4. Valoración de puestos.-', 'La empresa mantiene una matriz de valoración de puestos exenta de sesgo de género y la revisa al menos una vez al año o cuando se cree o modifique un cargo.'],
    ['Artículo 5. Selección y promoción.-', 'Queda prohibido exigir pruebas de embarazo, preguntar sobre estado civil, planes de maternidad o paternidad, o establecer requisitos de sexo, edad o apariencia física no justificados por la naturaleza del cargo. Las vacantes y ascensos se decidirán por méritos, con criterios públicos y verificables.'],
    ['Artículo 6. Tolerancia cero.-', 'Se prohíbe toda conducta de acoso laboral, acoso sexual, violencia o discriminación por sexo, género, orientación sexual, identidad de género, embarazo, maternidad, paternidad, edad, discapacidad, etnia, religión, condición migratoria o cualquier otra condición personal.'],
    ['Artículo 7. Canal de denuncia.-', 'Toda persona puede denunciar, de forma verbal o escrita y con garantía de confidencialidad, ante la unidad de Talento Humano o directamente ante el Representante Legal. La empresa investigará con imparcialidad y adoptará medidas en un plazo máximo de 15 días.'],
    ['Artículo 8. Prohibición de represalias.-', 'Se prohíbe cualquier represalia contra quien denuncie, testifique o reclame por desigualdad salarial, discriminación o acoso. La represalia se considera falta grave.'],
    ['Artículo 9. Corresponsabilidad y cuidados.-', 'La empresa respeta y facilita las licencias de maternidad, paternidad y lactancia, y promueve la corresponsabilidad en las tareas de cuidado conforme al Convenio 156 de la OIT y la Ley de Economía Violeta.'],
    ['Artículo 10. Capacitación.-', 'Todo el personal, incluido el directorio y el representante legal, cumplirá al menos 40 horas anuales de capacitación en los ejes del Art. 3 del Acuerdo MDT-2025-006.'],
    ['Artículo 11. Sensibilización.-', 'La empresa ejecutará y documentará acciones periódicas de sensibilización (afiches, boletines, charlas, encuestas) sobre igualdad de género y no discriminación, conforme al Art. 4 del Acuerdo MDT-2025-006.'],
    ['Artículo 12. Sanciones.-', 'El incumplimiento de esta Política se sancionará conforme al Reglamento Interno de Trabajo y el Código del Trabajo, pudiendo constituir causal de visto bueno.'],
    ['Artículo 13. Vigencia y difusión.-', 'Esta Política entra en vigencia desde su suscripción, se socializará a todo el personal con constancia de recepción y se exhibirá de forma permanente en la cartelera y canales internos de la empresa.']
  ]
};

const acta = {
  titulo: 'ACTA DE SOCIALIZACIÓN · POLÍTICA DE IGUALDAD SALARIAL Y NO DISCRIMINACIÓN',
  declaracion: 'Las personas que suscriben declaran haber recibido y comprendido la Política de Igualdad Salarial, Igualdad de Género y No Discriminación de la empresa, conocer el canal confidencial de denuncia y haber participado en la acción de sensibilización realizada en cumplimiento del Art. 4 del Acuerdo Ministerial MDT-2025-006.',
  nota: 'Conservar esta acta en el expediente de cumplimiento; es la evidencia de la acción de sensibilización ante una inspección del Ministerio del Trabajo.',
  columnas: ['N°', 'Nombres y apellidos', 'Cédula', 'Cargo', 'Firma']
};

const encuesta = {
  titulo: 'ENCUESTA ANÓNIMA DE CLIMA LABORAL · IGUALDAD Y NO DISCRIMINACIÓN',
  intro: 'Esta encuesta es anónima y voluntaria. Marque con una X: 1 = Totalmente en desacuerdo · 5 = Totalmente de acuerdo.',
  afirmaciones: [
    'En esta empresa, hombres y mujeres reciben igual remuneración por trabajo de igual valor.',
    'Los procesos de selección y ascenso se deciden por méritos y no por el sexo o la situación familiar.',
    'Conozco el canal confidencial para denunciar acoso o discriminación.',
    'Si denunciara una situación de acoso, confío en que no habría represalias.',
    'Las licencias de maternidad, paternidad y lactancia se respetan sin afectar la carrera de la persona.',
    'No he presenciado comentarios o bromas sexistas o discriminatorias en el último año.',
    'Mi jefatura inmediata trata con respeto e igualdad a todas las personas del equipo.',
    'La empresa comunica y promueve la igualdad de género de forma visible.',
    'He recibido capacitación sobre igualdad salarial y no discriminación.',
    'Me siento seguro/a y respetado/a en mi lugar de trabajo.'
  ],
  sugerencia: '¿Qué sugerencia daría para mejorar la igualdad y el respeto en la empresa?',
  tabulacion: 'Tabulación sugerida: promedio por pregunta; puntuaciones menores a 3,5 requieren un plan de acción. Conserve el resumen tabulado como evidencia del Art. 4.'
};

const instructivo = {
  titulo: 'INSTRUCTIVO · CÓMO CUMPLIR EL ART. 4 (SENSIBILIZACIÓN) CON ESTE KIT',
  pasos: [
    'Imprimir y firmar la Política (archivo 4) por el Representante Legal; exhibirla en cartelera y enviarla por correo o WhatsApp a todo el personal.',
    'Imprimir los 3 afiches (archivos 1 a 3) en A4 o A3 y colocarlos en cartelera, comedor y recepción. Tomar una fotografía con fecha visible.',
    'Realizar una charla corta (15 a 30 minutos) para socializar la Política y el canal de denuncia; hacer firmar el Acta (archivo 5).',
    'Aplicar la Encuesta anónima (archivo 6) y conservar el resumen tabulado.',
    'Registrar cada acción en la plataforma AMU (sección 4 · Sensibilización) con fecha, tipo y número de participantes: ese registro se exporta en el Excel que se reporta al Ministerio.',
    'Guardar fotos, acta firmada y encuestas en una carpeta digital; en una inspección hay 10 días para presentarlas.'
  ]
};

const reporte = {
  titulo: 'Reporte de capacitación - Ley Orgánica para la Igualdad Salarial (Acuerdo MDT-2025-006)',
  hojas: {
    consolidado: 'Consolidado',
    bitacora: 'Bitácora videos',
    tareas: 'Tareas y evaluaciones',
    art4: 'Sensibilización (Art. 4)'
  },
  columnas: {
    consolidado: ['Nombre', 'Cédula', 'Cargo', 'Directivo/Rep. legal', 'Horas video', 'Horas tareas', 'Horas total', '% de 40h', 'Cumple'],
    bitacora: ['Trabajador', 'Cédula', 'Clase', 'Eje temático', 'Minutos vistos', 'Marcada por el trabajador', 'Primer acceso', 'Último acceso'],
    tareas: ['Trabajador', 'Cédula', 'Tarea', 'Tipo', 'Eje temático', 'Horas', 'Estado', 'Nota', 'Fecha entrega', 'Fecha revisión', 'Comentario', 'Respuesta'],
    art4: ['Fecha', 'Tipo de acción', 'Descripción', 'Participantes']
  }
};

module.exports = { PIE, posters, politica, acta, encuesta, instructivo, reporte };
