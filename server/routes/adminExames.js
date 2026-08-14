import express from "express";
import {
  ai,
  upload,
  db,
  getMysqlPool,
  syncToFirestore,
  saveCollectionToMysql,
  loadCollectionFromMysql,
  saveJsonFile,
  loadLocalJson,
  initializeFirebaseCaches,
  cleanObsoleteDatabaseFields,
  formatRequisitionCode,
  loadRequisitions,
  updateRequisitionCombinedExams,
  saveRequisitions,
  loadCisnorpi,
  saveCisnorpi,
  loadCashClosures,
  saveCashClosures,
  loadBudgets,
  saveBudgets,
  loadSupportLabs,
  saveSupportLabs,
  loadConvenios,
  saveConvenios,
  loadLabExamesAlvaro,
  saveLabExamesAlvaro,
  loadMateriaisAlvaro,
  saveMateriaisAlvaro,
  loadConfigApoioAlvaro,
  saveConfigApoioAlvaro,
  loadLabExamesPardini,
  saveLabExamesPardini,
  loadConfigApoioPardini,
  saveConfigApoioPardini,
  loadRecipientes,
  saveRecipientes,
  loadMateriaisColetados,
  saveMateriaisColetados,
  loadSetores,
  saveSetores,
  loadImpressoras,
  saveImpressoras,
  loadLocaisColeta,
  saveLocaisColeta,
  loadMedicos,
  saveMedicos,
  loadPriceTables,
  savePriceTables,
  loadRequisitionShortcuts,
  saveRequisitionShortcuts,
  loadExams,
  saveExams,
  syncExamPricesToPriceTables,
  syncPriceTableToExams,
  cleanOrphanedPriceTableRows,
  syncAllExamsWithPriceTables,
  loadProfessionals,
  saveProfessionals,
  loadEvaluations,
  saveEvaluations,
  loadEvalAccesses,
  saveEvalAccesses,
  loadEvalHashes,
  saveEvalHashes,
  loadNonConformities,
  saveNonConformities,
  loadAccessProfiles,
  saveAccessProfiles,
  loadMessageTemplates,
  saveMessageTemplates,
  loadShortcuts,
  saveShortcuts,
  loadTransactions,
  saveTransactions,
  loadFinanceSettings,
  saveFinanceSettings,
  loadMovements,
  saveMovements,
  logFinancialMovement,
  getEnrichedExams,
  loadBlogPosts,
  saveBlogPosts,
  loadPops,
  savePops,
  loadDocuments,
  saveDocuments,
  loadPatients,
  savePatients,
  loadAppointments,
  saveAppointments,
  loadTemperaturas,
  saveTemperaturas,
  loadInterfaceData,
  loadEquipamentos,
  requireAdmin,
  slugify,
  SITEMAP_OLD_EXAMS
} from "../dataStore.js";

const router = express.Router();

router.get('/admin/exames', requireAdmin, (req, res) => {
  const exams = getEnrichedExams();
  const labs = loadSupportLabs();
  const priceTables = loadPriceTables();
  const recipientes = loadRecipientes();
  const materiaisColetadosMaster = loadMateriaisColetados();
  const setores = loadSetores();
  const examesAlvaro = loadLabExamesAlvaro();
  const examesPardini = loadLabExamesPardini();
  const equipamentos = loadEquipamentos();
  res.render('admin/exames', {
    exams,
    labs,
    priceTables,
    recipientes,
    materiaisColetadosMaster,
    setores,
    examesAlvaro,
    examesPardini,
    equipamentos,
    page: 'admin-exames'
  });
});

// Página de Instruções Detalhadas de Preparo e Coleta
router.get('/admin/exames/instrucoes', requireAdmin, (req, res) => {
  const exams = getEnrichedExams();
  res.render('admin/exames-instrucoes', {
    exams,
    page: 'admin-exames-instrucoes'
  });
});

// Cadastrar Novo Exame (POST)
router.post('/admin/exames/add', requireAdmin, async (req, res) => {
  const {
    name, category, fasting, timeframe, instructions, code, jalisCode, supportLab, pricePrivate,
    codigoAlvaro, codigoPardini, sinonimia, idadeMin, idadeMinUnidade, idadeMax, idadeMaxUnidade,
    sexo, amostras, tagsResultado, filtro, bloquearExame, permitirSalvarParcialmente, servico,
    importarPdf, tipoBPA, setores, materiaisColetados, historico, webConfig,
    modeloLaudo, formularioColeta, cabecalho, observacoesLaudo,
    tituloLaudo, materialLaudo, metodoLaudo, valorReferenciaLaudo,
    mascaraResultado, mascarasCampos
  } = req.body;

  const exams = loadExams();
  const labs = loadSupportLabs();
  const alvaroLab = labs.find(l => l.name.toLowerCase().includes('alvaro') || l.name.toLowerCase().includes('álvaro'));
  const pardiniLab = labs.find(l => l.name.toLowerCase().includes('pardini'));

  const cleanAlvaroCode = (codigoAlvaro || '').trim();
  const cleanPardiniCode = (codigoPardini || '').trim();
  const examCode = (code || jalisCode || '').trim().slice(0, 6);

  const supportLabsData = {};
  if (alvaroLab && cleanAlvaroCode) {
    supportLabsData[alvaroLab.id] = { code: cleanAlvaroCode, price: 0, originalName: cleanAlvaroCode };
  }
  if (pardiniLab && cleanPardiniCode) {
    supportLabsData[pardiniLab.id] = { code: cleanPardiniCode, price: 0, originalName: cleanPardiniCode };
  }
  
  let parsedSetores = [];
  try { parsedSetores = typeof setores === 'string' ? JSON.parse(setores) : (setores || []); } catch(e){}
  
  let parsedMateriais = [];
  try { parsedMateriais = typeof materiaisColetados === 'string' ? JSON.parse(materiaisColetados) : (materiaisColetados || []); } catch(e){}

  let parsedWeb = {};
  try { parsedWeb = typeof webConfig === 'string' ? JSON.parse(webConfig) : (webConfig || {}); } catch(e){}

  let parsedMascarasCampos = [];
  try { parsedMascarasCampos = typeof mascarasCampos === 'string' ? JSON.parse(mascarasCampos) : (mascarasCampos || []); } catch(e){}

  const newExam = {
    id: Date.now().toString(),
    name: (name || '').trim(),
    category: (category || filtro || 'Geral').trim(),
    fasting: (fasting || 'Não obrigatório').trim(),
    timeframe: (timeframe || '24 horas').trim(),
    instructions: (instructions || '').trim(),
    code: examCode,
    jalisCode: examCode,
    codigoAlvaro: cleanAlvaroCode,
    codigoPardini: cleanPardiniCode,
    priceAlvaro: 0,
    pricePardini: 0,
    supportLabsData,
    supportLab: (supportLab || 'Próprio').trim(),
    pricePrivate: pricePrivate ? parseFloat(pricePrivate) : 0,
    sinonimia: (sinonimia || '').trim(),
    idadeMin: idadeMin || '0',
    idadeMinUnidade: idadeMinUnidade || 'Anos',
    idadeMax: idadeMax || '0',
    idadeMaxUnidade: idadeMaxUnidade || 'Anos',
    sexo: sexo || 'Ambos',
    amostras: amostras || '0',
    tagsResultado: (tagsResultado || '').trim(),
    bloquearExame: bloquearExame === 'true' || bloquearExame === 'on' || bloquearExame === true,
    permitirSalvarParcialmente: permitirSalvarParcialmente === 'true' || permitirSalvarParcialmente === 'on' || permitirSalvarParcialmente === true,
    servico: servico === 'true' || servico === 'on' || servico === true,
    importarPdf: importarPdf === 'true' || importarPdf === 'on' || importarPdf === true,
    tipoBPA: tipoBPA || 'Individualizado',
    setores: parsedSetores,
    materiaisColetados: parsedMateriais,
    historico: (historico || '').trim(),
    webConfig: parsedWeb,
    modeloLaudo: (modeloLaudo || 'Padrão LIS InovaLab').trim(),
    formularioColeta: (formularioColeta || 'Ficha Padrão de Coleta').trim(),
    cabecalho: (cabecalho || '').trim(),
    observacoesLaudo: (observacoesLaudo || '').trim(),
    tituloLaudo: (tituloLaudo || name || '').trim(),
    materialLaudo: (materialLaudo || category || '').trim(),
    metodoLaudo: (metodoLaudo || '').trim(),
    valorReferenciaLaudo: (valorReferenciaLaudo || '').trim(),
    mascaraResultado: (mascaraResultado || '0,00').trim(),
    mascarasCampos: parsedMascarasCampos
  };

  exams.push(newExam);
  await saveExams(exams);
  syncExamPricesToPriceTables(newExam.code, newExam.name, newExam.materiaisColetados, newExam.pricePrivate);
  
  if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Exame cadastrado com sucesso!', exam: newExam, exams: getEnrichedExams() });
  }
  res.redirect('/admin/exames');
});

// Editar Exame Existente (POST)
router.post('/admin/exames/edit', requireAdmin, async (req, res) => {
  const {
    id, name, category, fasting, timeframe, instructions, code, jalisCode, supportLab, pricePrivate,
    codigoAlvaro, codigoPardini, sinonimia, idadeMin, idadeMinUnidade, idadeMax, idadeMaxUnidade,
    sexo, amostras, tagsResultado, filtro, bloquearExame, permitirSalvarParcialmente, servico,
    importarPdf, tipoBPA, setores, materiaisColetados, historico, webConfig,
    modeloLaudo, formularioColeta, cabecalho, observacoesLaudo,
    tituloLaudo, materialLaudo, metodoLaudo, valorReferenciaLaudo,
    mascaraResultado, mascarasCampos
  } = req.body;

  const exams = loadExams();
  const index = exams.findIndex(e => e.id === id);
  
  if (index !== -1) {
    const labs = loadSupportLabs();
    const alvaroLab = labs.find(l => l.name.toLowerCase().includes('alvaro') || l.name.toLowerCase().includes('álvaro'));
    const pardiniLab = labs.find(l => l.name.toLowerCase().includes('pardini'));

    const cleanAlvaroCode = (codigoAlvaro || '').trim();
    const cleanPardiniCode = (codigoPardini || '').trim();
    const examCode = (code || jalisCode || '').trim().slice(0, 6);

    // Sincronizar dados do supportLabsData
    const supportLabsData = exams[index].supportLabsData || {};
    
    if (alvaroLab) {
      if (cleanAlvaroCode) {
        supportLabsData[alvaroLab.id] = supportLabsData[alvaroLab.id] || { price: 0 };
        supportLabsData[alvaroLab.id].code = cleanAlvaroCode;
      } else {
        delete supportLabsData[alvaroLab.id];
      }
    }
    if (pardiniLab) {
      if (cleanPardiniCode) {
        supportLabsData[pardiniLab.id] = supportLabsData[pardiniLab.id] || { price: 0 };
        supportLabsData[pardiniLab.id].code = cleanPardiniCode;
      } else {
        delete supportLabsData[pardiniLab.id];
      }
    }

    let parsedSetores = exams[index].setores || [];
    if (setores !== undefined) {
      try { parsedSetores = typeof setores === 'string' ? JSON.parse(setores) : setores; } catch(e){}
    }

    let parsedMateriais = exams[index].materiaisColetados || [];
    if (materiaisColetados !== undefined) {
      try { parsedMateriais = typeof materiaisColetados === 'string' ? JSON.parse(materiaisColetados) : materiaisColetados; } catch(e){}
    }

    let parsedWeb = exams[index].webConfig || {};
    if (webConfig !== undefined) {
      try { parsedWeb = typeof webConfig === 'string' ? JSON.parse(webConfig) : webConfig; } catch(e){}
    }

    let parsedMascarasCampos = exams[index].mascarasCampos || [];
    if (mascarasCampos !== undefined) {
      try { parsedMascarasCampos = typeof mascarasCampos === 'string' ? JSON.parse(mascarasCampos) : mascarasCampos; } catch(e){}
    }

    exams[index] = {
      ...exams[index],
      name: (name || '').trim(),
      category: (category || filtro || 'Geral').trim(),
      fasting: (fasting || 'Não obrigatório').trim(),
      timeframe: (timeframe || '24 horas').trim(),
      instructions: (instructions || '').trim(),
      code: examCode,
      jalisCode: examCode,
      codigoAlvaro: cleanAlvaroCode,
      codigoPardini: cleanPardiniCode,
      supportLabsData,
      supportLab: (supportLab || 'Próprio').trim(),
      pricePrivate: pricePrivate !== undefined ? parseFloat(pricePrivate) : (exams[index].pricePrivate || 0),
      sinonimia: (sinonimia || '').trim(),
      idadeMin: idadeMin || '0',
      idadeMinUnidade: idadeMinUnidade || 'Anos',
      idadeMax: idadeMax || '0',
      idadeMaxUnidade: idadeMaxUnidade || 'Anos',
      sexo: sexo || 'Ambos',
      amostras: amostras || '0',
      tagsResultado: (tagsResultado || '').trim(),
      bloquearExame: bloquearExame === 'true' || bloquearExame === 'on' || bloquearExame === true,
      permitirSalvarParcialmente: permitirSalvarParcialmente === 'true' || permitirSalvarParcialmente === 'on' || permitirSalvarParcialmente === true,
      servico: servico === 'true' || servico === 'on' || servico === true,
      importarPdf: importarPdf === 'true' || importarPdf === 'on' || importarPdf === true,
      tipoBPA: tipoBPA || 'Individualizado',
      setores: parsedSetores,
      materiaisColetados: parsedMateriais,
      historico: (historico || '').trim(),
      webConfig: parsedWeb,
      modeloLaudo: modeloLaudo !== undefined ? (modeloLaudo || 'Padrão LIS InovaLab').trim() : (exams[index].modeloLaudo || 'Padrão LIS InovaLab'),
      formularioColeta: formularioColeta !== undefined ? (formularioColeta || 'Ficha Padrão de Coleta').trim() : (exams[index].formularioColeta || 'Ficha Padrão de Coleta'),
      cabecalho: cabecalho !== undefined ? (cabecalho || '').trim() : (exams[index].cabecalho || ''),
      observacoesLaudo: observacoesLaudo !== undefined ? (observacoesLaudo || '').trim() : (exams[index].observacoesLaudo || ''),
      tituloLaudo: tituloLaudo !== undefined ? (tituloLaudo || name || '').trim() : (exams[index].tituloLaudo || exams[index].name || ''),
      materialLaudo: materialLaudo !== undefined ? (materialLaudo || category || '').trim() : (exams[index].materialLaudo || exams[index].category || ''),
      metodoLaudo: metodoLaudo !== undefined ? (metodoLaudo || '').trim() : (exams[index].metodoLaudo || ''),
      valorReferenciaLaudo: valorReferenciaLaudo !== undefined ? (valorReferenciaLaudo || '').trim() : (exams[index].valorReferenciaLaudo || ''),
      mascaraResultado: mascaraResultado !== undefined ? (mascaraResultado || '0,00').trim() : (exams[index].mascaraResultado || '0,00'),
      mascarasCampos: parsedMascarasCampos
    };
    await saveExams(exams);
    syncExamPricesToPriceTables(exams[index].code, exams[index].name, exams[index].materiaisColetados, exams[index].pricePrivate);
  }
  
  if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Exame atualizado com sucesso!', exam: index !== -1 ? exams[index] : null, exams: getEnrichedExams() });
  }
  res.redirect('/admin/exames');
});

function formatReferenceText(rawText) {
  if (!rawText) return '';

  return String(rawText)
    // Converte literais '\n' para quebras reais
    .replace(/\\n/g, '\n')
    // Adiciona quebra de linha caso "Crianças e adolescentes" esteja colado no texto seguinte
    .replace(/(Crianças e adolescentes)\s*(\d)/gi, '$1\n$2')
    // Adiciona quebra de linha caso "Referência bibliográfica:" esteja colada no texto seguinte
    .replace(/(Referência bibliográfica:)\s*([^\n])/gi, '$1\n$2')
    // Garante que "Referência bibliográfica:" tenha uma linha em branco antes dela se estiver colada no bloco anterior
    .replace(/([^\n])\n*(Referência bibliográfica:)/gi, '$1\n\n$2');
}

function parsePriceValue(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  
  let str = String(val).replace('R$', '').replace(/\s/g, '').trim();
  if (!str) return 0;

  // Se houver vírgula e ponto, descobrimos qual é o decimal
  if (str.includes(',') && str.includes('.')) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      // Formato brasileiro: 1.234,56
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato americano: 1,234.56
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Apenas vírgula, ex: 40,00 ou 1234,5
    str = str.replace(',', '.');
  } else if (str.includes('.')) {
    // Apenas ponto. Se tiver exatamente 3 dígitos após o ponto, ex: 40.000, pode ser milhar brasileiro.
    // Se tiver 1, 2 ou mais de 3, é decimal.
    const parts = str.split('.');
    const lastPart = parts[parts.length - 1];
    if (lastPart.length === 3 && parts[0].length > 0) {
      str = str.replace(/\./g, '');
    }
  }
  
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// --- SUB-MÓDULO: REQUISIÇÕES E ORÇAMENTOS DE EXAMES (NOVO) ---

// Página Principal de Orçamentos

export default router;
