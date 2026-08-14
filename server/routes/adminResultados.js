import express from "express";
import http from "http";
import { generatePdfForRequisition } from "./public.js";
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
  requireAdmin,
  slugify,
  SITEMAP_OLD_EXAMS
} from "../dataStore.js";
import PDFDocument from "pdfkit";

const router = express.Router();

// MENU RESULTADOS - DIGITAÇÃO DE RESULTADOS
// ==========================================
router.get('/admin/resultados/digitacao', requireAdmin, (req, res) => {
  try {
    const requisitions = loadRequisitions();
    const exams = getEnrichedExams();
    const medicos = loadMedicos();
    const convenios = loadConvenios();
    const patients = loadPatients();

    res.render('admin/resultados/digitacao', {
      requisitions,
      exams,
      medicos,
      convenios,
      patients,
      page: 'admin-resultados-digitacao'
    });
  } catch (err) {
    console.error('Erro ao carregar tela de digitação de resultados:', err);
    res.status(500).send('Erro interno ao carregar tela de digitação de resultados.');
  }
});

// Status de geração de PDF para requisição
router.get('/admin/resultados/pdf-status', requireAdmin, (req, res) => {
  try {
    const { requisitionId } = req.query;
    if (!requisitionId) return res.json({ ready: false, generating: false });
    const requisitions = loadRequisitions();
    const reqCodeClean = String(requisitionId).replace(/^#/, '').trim().toLowerCase();
    const targetReq = requisitions.find(r => 
      String(r.id || '').replace(/^#/, '').trim().toLowerCase() === reqCodeClean ||
      String(r.requisitionCode || '').replace(/^#/, '').trim().toLowerCase() === reqCodeClean
    );
    if (!targetReq) return res.json({ ready: false, generating: false });
    return res.json({
      ready: !targetReq.isPdfGenerating && !!(targetReq.pdfBase64 || targetReq.laudoPdfBase64),
      generating: !!targetReq.isPdfGenerating
    });
  } catch (err) {
    return res.json({ ready: false, generating: false });
  }
});

// Salvar Resultado de Exame Individual
router.post('/admin/resultados/salvar-exame', requireAdmin, async (req, res) => {
  try {
    const {
      requisitionId,
      examCode,
      result,
      referenceValue,
      method,
      material,
      equipment,
      equipamento,
      interpretation,
      observations,
      modeloLaudo,
      tituloLaudo,
      linhas,
      status
    } = req.body;

    if (!requisitionId || !examCode) {
      return res.status(400).json({ success: false, message: 'ID de requisição e código de exame são obrigatórios.' });
    }

    const requisitions = loadRequisitions();
    const targetReq = requisitions.find(r => 
      String(r.id || '').trim() === String(requisitionId).trim() ||
      String(r.requisitionCode || '').trim() === String(requisitionId).trim()
    );

    if (!targetReq) {
      return res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
    }

    if (!Array.isArray(targetReq.exams)) {
      targetReq.exams = [];
    }

    const examIdx = targetReq.exams.findIndex(e => (e.code || e.codigo) === examCode);
    if (examIdx === -1) {
      return res.status(404).json({ success: false, message: 'Exame não encontrado nesta requisição.' });
    }

    const ex = targetReq.exams[examIdx];
    const newStatus = status || 'Digitado';
    const userName = (req.session && req.session.user && req.session.user.name) ? req.session.user.name : 'Bioquímica';

    ex.result = result !== undefined ? result : (ex.result || '');
    ex.resultado = ex.result;
    if (req.body.unit !== undefined || req.body.unidade !== undefined) {
      const uVal = req.body.unit || req.body.unidade || '';
      ex.unit = uVal;
      ex.unidade = uVal;
    }
    ex.referenceValue = referenceValue !== undefined ? referenceValue : (ex.referenceValue || ex.valorReferencia || '');
    ex.valorReferencia = ex.referenceValue;
    ex.method = method !== undefined ? method : (ex.method || ex.metodo || '');
    ex.metodo = ex.method;
    if (material) ex.material = material;
    if (equipment !== undefined || equipamento !== undefined) {
      const eqVal = equipment || equipamento;
      ex.equipment = eqVal;
      ex.equipamento = eqVal;
    }
    if (interpretation !== undefined) {
      ex.interpretation = interpretation;
      ex.interpretacao = interpretation;
    }
    if (observations !== undefined) {
      ex.observations = observations;
      ex.observacoes = observations;
    }
    if (modeloLaudo !== undefined) {
      ex.modeloLaudo = modeloLaudo;
    }
    if (tituloLaudo !== undefined) {
      ex.tituloLaudo = tituloLaudo;
      if (tituloLaudo.trim()) {
        ex.name = tituloLaudo.trim();
      }
    }
    if (linhas !== undefined) {
      ex.linhas = linhas;
    }

    ex.status = newStatus;
    const nowIso = new Date().toISOString();

    if (newStatus === 'Digitado') {
      ex.typedAt = nowIso;
      ex.typedBy = userName;
    } else if (newStatus === 'Conferido') {
      ex.conferidoAt = nowIso;
      ex.conferidoBy = userName;
      if (!ex.typedAt) { ex.typedAt = nowIso; ex.typedBy = userName; }
    } else if (newStatus === 'Liberado') {
      ex.liberadoAt = nowIso;
      ex.liberadoBy = userName;
      ex.dataResultado = nowIso;
      ex.resultDate = nowIso;
      if (!ex.typedAt) { ex.typedAt = nowIso; ex.typedBy = userName; }
      if (!ex.conferidoAt) { ex.conferidoAt = nowIso; ex.conferidoBy = userName; }
    }

    // Recalcular status da requisição (Regra: Pronto se todos conferidos/liberados, Cancelado se cancelado, senão Em Andamento)
    const allConferidosOrLiberados = targetReq.exams.length > 0 && targetReq.exams.every(e => ['Conferido', 'Liberado', 'Pronto', 'Concluído'].includes(e.status));

    if (String(targetReq.status || '').toLowerCase().includes('cancel')) {
      targetReq.status = 'Cancelado';
    } else if (allConferidosOrLiberados) {
      targetReq.status = 'Pronto';
      targetReq.dataResultado = nowIso;
    } else {
      targetReq.status = 'Em Andamento';
    }

    // Marca requisição como 'gerando PDF' e invalida cache anterior
    targetReq.pdfBase64 = null;
    targetReq.laudoPdfBase64 = null;
    targetReq.pdfDataUri = null;
    targetReq.isPdfGenerating = true;
    saveRequisitions(requisitions);

    // Dispara a geração de PDF em segundo plano de forma assíncrona
    setTimeout(async () => {
      try {
        const pdfBuf = await generatePdfForRequisition(targetReq);
        const pdfB64 = pdfBuf.toString('base64');
        const reqs = loadRequisitions();
        const currentReq = reqs.find(r => 
          String(r.id || '').replace(/^#/, '').trim().toLowerCase() === String(targetReq.id || targetReq.requisitionCode).replace(/^#/, '').trim().toLowerCase() ||
          String(r.requisitionCode || '').replace(/^#/, '').trim().toLowerCase() === String(targetReq.requisitionCode || targetReq.id).replace(/^#/, '').trim().toLowerCase()
        );
        if (currentReq) {
          currentReq.pdfBase64 = pdfB64;
          currentReq.laudoPdfBase64 = pdfB64;
          currentReq.pdfDataUri = `data:application/pdf;base64,${pdfB64}`;
          currentReq.isPdfGenerating = false;
          currentReq.pdfGeneratedAt = new Date().toISOString();
          saveRequisitions(reqs);
        }
      } catch (pdfErr) {
        console.error("Erro ao gerar PDF em segundo plano ao salvar exame:", pdfErr);
        const reqs = loadRequisitions();
        const currentReq = reqs.find(r => 
          String(r.id || '').replace(/^#/, '').trim().toLowerCase() === String(targetReq.id || targetReq.requisitionCode).replace(/^#/, '').trim().toLowerCase() ||
          String(r.requisitionCode || '').replace(/^#/, '').trim().toLowerCase() === String(targetReq.requisitionCode || targetReq.id).replace(/^#/, '').trim().toLowerCase()
        );
        if (currentReq) {
          currentReq.isPdfGenerating = false;
          saveRequisitions(reqs);
        }
      }
    }, 100);

    return res.json({
      success: true,
      message: `Exame ${ex.code} atualizado para status "${newStatus}"!`,
      exam: ex,
      requisitionStatus: targetReq.status,
      examesJuntos: targetReq.examesJuntos,
      examesTexto: targetReq.examesTexto,
      examesConcatenados: targetReq.examesConcatenados,
      requisition: targetReq,
      isPdfGenerating: true
    });
  } catch (error) {
    console.error('Erro ao salvar resultado de exame:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao salvar resultado do exame.' });
  }
});

// Salvar Todos os Exames da Requisição (Lote / Ação Completa)
router.post('/admin/resultados/salvar-requisicao-completa', requireAdmin, async (req, res) => {
  try {
    const { requisitionId, action, exams } = req.body;
    if (!requisitionId) {
      return res.status(400).json({ success: false, message: 'ID da requisição é obrigatório.' });
    }

    const requisitions = loadRequisitions();
    const targetReq = requisitions.find(r => 
      String(r.id || '').trim() === String(requisitionId).trim() ||
      String(r.requisitionCode || '').trim() === String(requisitionId).trim()
    );

    if (!targetReq) {
      return res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
    }

    const userName = (req.session && req.session.user && req.session.user.name) ? req.session.user.name : 'Bioquímica';
    const nowIso = new Date().toISOString();

    if (Array.isArray(exams) && exams.length > 0) {
      exams.forEach(exData => {
        const ex = targetReq.exams.find(e => (e.code || e.codigo) === exData.code);
        if (ex) {
          if (exData.result !== undefined) { ex.result = exData.result; ex.resultado = exData.result; }
          if (exData.referenceValue !== undefined) { ex.referenceValue = exData.referenceValue; ex.valorReferencia = exData.referenceValue; }
          if (exData.method !== undefined) { ex.method = exData.method; ex.metodo = exData.method; }
          if (exData.material !== undefined) ex.material = exData.material;
          if (exData.equipment !== undefined || exData.equipamento !== undefined) {
            const eqVal = exData.equipment || exData.equipamento;
            ex.equipment = eqVal;
            ex.equipamento = eqVal;
          }
          if (exData.interpretation !== undefined) { ex.interpretation = exData.interpretation; ex.interpretacao = exData.interpretation; }
          if (exData.observations !== undefined) { ex.observations = exData.observations; ex.observacoes = exData.observacoes; }
          if (exData.modeloLaudo !== undefined) ex.modeloLaudo = exData.modeloLaudo;
          if (exData.linhas !== undefined) ex.linhas = exData.linhas;
          if (exData.status) {
            ex.status = exData.status;
            if (exData.status === 'Liberado') {
              ex.liberadoAt = nowIso;
              ex.liberadoBy = userName;
              ex.dataResultado = nowIso;
              ex.resultDate = nowIso;
            }
          }
        }
      });
    }

    if (action === 'conferir_todos') {
      targetReq.exams.forEach(ex => {
        ex.status = 'Conferido';
        ex.conferidoAt = nowIso;
        ex.conferidoBy = userName;
      });
      targetReq.status = 'Pronto';
    } else if (action === 'liberar_todos') {
      targetReq.exams.forEach(ex => {
        ex.status = 'Liberado';
        ex.liberadoAt = nowIso;
        ex.liberadoBy = userName;
        ex.dataResultado = nowIso;
        ex.resultDate = nowIso;
      });
      targetReq.status = 'Pronto';
      targetReq.liberadoAt = nowIso;
      targetReq.dataResultado = nowIso;
    } else {
      if (String(targetReq.status || '').toLowerCase().includes('cancel')) {
        targetReq.status = 'Cancelado';
      } else {
        const allConferidosOrLiberados = targetReq.exams.length > 0 && targetReq.exams.every(e => ['Conferido', 'Liberado', 'Pronto', 'Concluído'].includes(e.status));
        if (allConferidosOrLiberados) {
          targetReq.status = 'Pronto';
        } else {
          targetReq.status = 'Em Andamento';
        }
      }
    }

    // Marca requisição como 'gerando PDF' e invalida cache anterior
    targetReq.pdfBase64 = null;
    targetReq.laudoPdfBase64 = null;
    targetReq.pdfDataUri = null;
    targetReq.isPdfGenerating = true;
    saveRequisitions(requisitions);

    // Dispara a geração de PDF em segundo plano de forma assíncrona
    setTimeout(async () => {
      try {
        const pdfBuf = await generatePdfForRequisition(targetReq);
        const pdfB64 = pdfBuf.toString('base64');
        const reqs = loadRequisitions();
        const currentReq = reqs.find(r => 
          String(r.id || '').replace(/^#/, '').trim().toLowerCase() === String(targetReq.id || targetReq.requisitionCode).replace(/^#/, '').trim().toLowerCase() ||
          String(r.requisitionCode || '').replace(/^#/, '').trim().toLowerCase() === String(targetReq.requisitionCode || targetReq.id).replace(/^#/, '').trim().toLowerCase()
        );
        if (currentReq) {
          currentReq.pdfBase64 = pdfB64;
          currentReq.laudoPdfBase64 = pdfB64;
          currentReq.pdfDataUri = `data:application/pdf;base64,${pdfB64}`;
          currentReq.isPdfGenerating = false;
          currentReq.pdfGeneratedAt = new Date().toISOString();
          saveRequisitions(reqs);
        }
      } catch (pdfErr) {
        console.error("Erro ao gerar PDF em segundo plano ao salvar requisição completa:", pdfErr);
        const reqs = loadRequisitions();
        const currentReq = reqs.find(r => 
          String(r.id || '').replace(/^#/, '').trim().toLowerCase() === String(targetReq.id || targetReq.requisitionCode).replace(/^#/, '').trim().toLowerCase() ||
          String(r.requisitionCode || '').replace(/^#/, '').trim().toLowerCase() === String(targetReq.requisitionCode || targetReq.id).replace(/^#/, '').trim().toLowerCase()
        );
        if (currentReq) {
          currentReq.isPdfGenerating = false;
          saveRequisitions(reqs);
        }
      }
    }, 100);

    return res.json({
      success: true,
      message: 'Requisição atualizada com sucesso!',
      requisition: targetReq,
      isPdfGenerating: true
    });
  } catch (error) {
    console.error('Erro ao atualizar requisição em lote:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao atualizar requisição.' });
  }
});

// Gerar Lote para Envio Externo (Álvaro / Pardini)
router.post('/admin/triagem/gerar-lote', requireAdmin, (req, res) => {
  try {
    const { lab, items } = req.body; // lab: 'alvaro' ou 'pardini', items: array of { requisitionId, examCode }
    if (!lab || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhum exame selecionado para gerar lote.' });
    }

    const requisitions = loadRequisitions();
    const prefix = lab.toLowerCase().includes('alvaro') ? 'LOTE-ALV' : 'LOTE-PAR';
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12);
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const batchCode = `${prefix}-${timestamp}-${randomSuffix}`;
    const createdAt = new Date().toISOString();

    let updatedCount = 0;

    const affectedReqs = new Set();

    items.forEach(item => {
      const reqIdx = requisitions.findIndex(r => r.id === item.requisitionId || r.requisitionCode === item.requisitionId);
      if (reqIdx !== -1) {
        const targetReq = requisitions[reqIdx];
        if (Array.isArray(targetReq.exams)) {
          targetReq.exams.forEach(ex => {
            if ((ex.code === item.examCode || ex.codigo === item.examCode)) {
              ex.loteCode = batchCode;
              ex.idLote = batchCode;
              ex.loteAt = createdAt;
              ex.loteStatus = 'Lote criado';
              ex.status = 'Lote criado';
              updatedCount++;
            }
          });
        }
        affectedReqs.add(targetReq);
      }
    });

    affectedReqs.forEach(targetReq => {
      if (targetReq && Array.isArray(targetReq.exams) && targetReq.exams.length > 0) {
        const allInLote = targetReq.exams.every(ex => {
          const st = String(ex.status || '').trim().toLowerCase();
          const lst = String(ex.loteStatus || '').trim().toLowerCase();
          return st === 'lote criado' || lst === 'lote criado' || lst === 'gerado' || !!ex.loteCode || !!ex.idLote;
        });
        if (allInLote) {
          targetReq.status = 'Lote criado';
          targetReq.loteStatus = 'Lote criado';
        }
      }
    });

    saveRequisitions(requisitions);

    return res.json({
      success: true,
      batchCode,
      lab: lab.toUpperCase(),
      totalExams: updatedCount,
      createdAt
    });
  } catch (error) {
    console.error('Erro ao gerar lote:', error);
    return res.status(500).json({ success: false, message: 'Erro ao gerar lote de exames.' });
  }
});

// Confirmar e Salvar Lote Álvaro nos Exames das Requisições
router.post('/admin/triagem/confirmar-lote-alvaro', requireAdmin, (req, res) => {
  try {
    const { solicitacoes } = req.body;
    if (!Array.isArray(solicitacoes) || solicitacoes.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhuma solicitação informada.' });
    }

    const requisitions = loadRequisitions();
    let updatedCount = 0;

    solicitacoes.forEach(sol => {
      if (!sol.incluido) return;

      const idLisStr = String(sol.idLis || '').trim();
      const idAlvaroStr = String(sol.idAlvaro || sol.baseBarras || '').trim();

      const targetReq = requisitions.find(r => {
        if (!r) return false;
        const reqId = String(r.id || '').trim();
        const reqCode = String(r.requisitionCode || '').trim();
        const reqCodeAlt = String(r.code || '').trim();

        if (reqId === idLisStr || reqCode === idLisStr || reqCodeAlt === idLisStr) return true;

        const lisDigitsOnly = idLisStr.replace(/\D/g, '');
        let extractedReqNum = lisDigitsOnly;
        if (lisDigitsOnly.length >= 10 && lisDigitsOnly.startsWith('01')) {
          extractedReqNum = lisDigitsOnly.slice(2, lisDigitsOnly.length - 2).replace(/^0+/, '');
        }

        const reqNumOnly = (reqCode || reqId || reqCodeAlt).replace(/\D/g, '').replace(/^0+/, '');

        if (extractedReqNum && reqNumOnly && extractedReqNum === reqNumOnly) return true;
        if (reqId && idLisStr.includes(reqId)) return true;
        if (reqCode && idLisStr.includes(reqCode)) return true;

        return false;
      });

      if (targetReq && Array.isArray(targetReq.exams)) {
        targetReq.exams.forEach(ex => {
          if (ex.triagemDestination === 'alvaro' || !ex.triagemDestination) {
            ex.idLote = idAlvaroStr;
            ex.loteCode = idAlvaroStr;
            ex.loteId = idAlvaroStr;
            ex.status = 'Lote criado';
            ex.loteStatus = 'Lote criado';
            ex.loteAt = new Date().toISOString();
            updatedCount++;
          }
        });

        const allInLote = targetReq.exams.every(ex => {
          const st = String(ex.status || '').trim().toLowerCase();
          const lst = String(ex.loteStatus || '').trim().toLowerCase();
          return st === 'lote criado' || lst === 'lote criado' || lst === 'gerado' || !!ex.loteCode || !!ex.idLote;
        });
        if (allInLote) {
          targetReq.status = 'Lote criado';
          targetReq.loteStatus = 'Lote criado';
        }
      }
    });

    saveRequisitions(requisitions);
    return res.json({ success: true, updatedCount });
  } catch (error) {
    console.error('Erro ao confirmar lote Álvaro:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao salvar status do lote.' });
  }
});

// Laboratório Externo - Config Apoio
router.get('/admin/lab-externo/config', requireAdmin, (req, res) => {
  const configAlvaro = loadConfigApoioAlvaro();
  const configPardini = loadConfigApoioPardini();
  res.render('admin/lab-externo/config', {
    configAlvaro,
    configPardini,
    page: 'admin-lab-externo-config'
  });
});

router.get('/api/lab-externo/config/alvaro', requireAdmin, (req, res) => {
  try {
    const config = loadConfigApoioAlvaro();
    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao carregar configurações Álvaro.' });
  }
});

router.post('/api/lab-externo/config/alvaro/save', requireAdmin, (req, res) => {
  try {
    const { urlAmbiente, nomeLis, entidade, idAgente, senha, chave, setorPadrao } = req.body;
    const data = {
      urlAmbiente: (urlAmbiente || '').trim(),
      nomeLis: (nomeLis || 'InovalabLis').trim(),
      entidade: (entidade || '').trim(),
      idAgente: (idAgente || '').trim(),
      senha: (senha || '').trim(),
      chave: (chave || '').trim(),
      setorPadrao: (setorPadrao || '11').trim(),
      updatedAt: new Date().toISOString()
    };
    saveConfigApoioAlvaro(data);
    return res.json({ success: true, message: 'Parâmetros de integração do Álvaro salvos com sucesso!', config: data });
  } catch (err) {
    console.error('Erro ao salvar config Álvaro:', err);
    return res.status(500).json({ success: false, message: 'Erro ao salvar parâmetros de integração do Álvaro.' });
  }
});

// Executar envio PUT do XML de lote ao WebService do Apoio Álvaro
router.post('/api/lab-externo/alvaro/criar-lote', requireAdmin, async (req, res) => {
  try {
    const { xml } = req.body;
    if (!xml || !xml.trim()) {
      return res.status(400).json({ success: false, message: 'XML de envio é obrigatório.' });
    }

    const config = loadConfigApoioAlvaro();
    let targetUrl = (config.urlAmbiente || 'http://webservice.alvaro.com.br/webserviceaol/rest/homologacao').trim();

    console.log(`[Álvaro WebService] Enviando lote via PUT para: ${targetUrl}`);

    let responseText = '';
    let statusCode = 200;

    try {
      const apiRes = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/xml'
        },
        body: xml
      });
      statusCode = apiRes.status;
      responseText = await apiRes.text();
    } catch (netErr) {
      console.error('[Álvaro WebService] Erro de rede/conexão:', netErr.message);
      return res.json({
        success: false,
        statusCode: 500,
        url: targetUrl,
        message: `Falha de conexão com a URL do Álvaro (${targetUrl}): ${netErr.message}`,
        responseXml: `<?xml version="1.0" encoding="UTF-8"?>\n<erro>\n    <mensagem>Falha de conexão com a URL (${targetUrl}): ${netErr.message}</mensagem>\n</erro>`
      });
    }

    return res.json({
      success: statusCode >= 200 && statusCode < 300,
      statusCode,
      url: targetUrl,
      responseXml: responseText || '<resposta_vazia/>'
    });
  } catch (err) {
    console.error('[Álvaro WebService] Erro no servidor:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao processar requisição para o Álvaro.' });
  }
});

router.get('/api/lab-externo/config/pardini', requireAdmin, (req, res) => {
  try {
    const config = loadConfigApoioPardini();
    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao carregar configurações Pardini.' });
  }
});

router.post('/api/lab-externo/config/pardini/save', requireAdmin, (req, res) => {
  try {
    const data = req.body || {};
    saveConfigApoioPardini(data);
    return res.json({ success: true, message: 'Configurações Pardini salvas com sucesso!', config: data });
  } catch (err) {
    console.error('Erro ao salvar config Pardini:', err);
    return res.status(500).json({ success: false, message: 'Erro ao salvar configurações Pardini.' });
  }
});

// Laboratório Externo - Exames Álvaro
router.get('/admin/lab-externo/alvaro', requireAdmin, (req, res) => {
  const exames = loadLabExamesAlvaro();
  const materiais = loadMateriaisAlvaro();
  res.render('admin/lab-externo/alvaro', {
    exames,
    materiais,
    page: 'admin-lab-externo-alvaro'
  });
});

router.get('/api/lab-externo/alvaro/exames', requireAdmin, (req, res) => {
  try {
    const list = loadLabExamesAlvaro();
    return res.json({ success: true, exames: list });
  } catch (err) {
    return res.status(500).json({ success: false, exames: [] });
  }
});

router.post('/api/lab-externo/alvaro/save', requireAdmin, (req, res) => {
  try {
    const { id, codigo, descricao, valor, materiais, materialDefault, materialDefaultDesc, lastChange, possibleMaterials } = req.body;
    let list = loadLabExamesAlvaro();
    const idx = list.findIndex(item => String(item.id) === String(id));

    let cleanMatDefaultCode = materialDefault != null && String(materialDefault).trim() !== '' ? String(materialDefault).trim() : null;

    const newItem = {
      id: id || ('alv-' + Date.now()),
      codigo: codigo || '',
      descricao: descricao || '',
      valor: parseFloat(valor) || 0,
      lastChange: lastChange || '',
      materialDefault: cleanMatDefaultCode,
      materialDefaultDesc: materialDefaultDesc || '',
      possibleMaterials: Array.isArray(possibleMaterials) ? possibleMaterials : [],
      materiais: Array.isArray(materiais) ? materiais : []
    };

    if (idx !== -1) {
      list[idx] = { ...list[idx], ...newItem };
    } else {
      list.push(newItem);
    }

    saveLabExamesAlvaro(list);
    return res.json({ success: true, exames: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Erro ao salvar exame Álvaro.' });
  }
});

router.post('/api/lab-externo/alvaro/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    let list = loadLabExamesAlvaro();
    list = list.filter(item => String(item.id) !== String(id));
    saveLabExamesAlvaro(list);
    return res.json({ success: true, exames: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Erro ao excluir exame Álvaro.' });
  }
});

// Laboratório Externo - Materiais Álvaro
router.get('/admin/lab-externo/materiais-alvaro', requireAdmin, (req, res) => {
  const materiais = loadMateriaisAlvaro();
  res.render('admin/lab-externo/materiais-alvaro', {
    materiais,
    page: 'admin-lab-externo-materiais-alvaro'
  });
});

router.post('/api/lab-externo/materiais-alvaro/save', requireAdmin, (req, res) => {
  try {
    const { id, codigo, descricao } = req.body;
    let list = loadMateriaisAlvaro();
    const idx = list.findIndex(item => String(item.id) === String(id));
    const newItem = {
      id: id || ('mat-alv-' + Date.now()),
      codigo: (codigo || '').trim().toUpperCase(),
      descricao: (descricao || '').trim()
    };

    if (idx !== -1) {
      list[idx] = newItem;
    } else {
      list.push(newItem);
    }

    saveMateriaisAlvaro(list);
    return res.json({ success: true, materiais: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Erro ao salvar material Álvaro.' });
  }
});

router.post('/api/lab-externo/materiais-alvaro/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    let list = loadMateriaisAlvaro();
    list = list.filter(item => String(item.id) !== String(id));
    saveMateriaisAlvaro(list);
    return res.json({ success: true, materiais: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Erro ao excluir material Álvaro.' });
  }
});

router.post('/api/lab-externo/materiais-alvaro/sync', requireAdmin, async (req, res) => {
  try {
    const options = {
      hostname: 'webservice.alvaro.com.br',
      path: '/webserviceaol/rest/homologacao/v1/exames/criticas/all',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic MTY5Mzk2OjJDQUNBNg=='
      },
      timeout: 45000
    };

    const jsonText = await new Promise((resolve, reject) => {
      const request = http.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => { resolve(data); });
      });
      request.on('error', (err) => { reject(err); });
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Timeout ao conectar com o servidor Álvaro.'));
      });
      request.end();
    });

    let payload = {};
    try {
      payload = JSON.parse(jsonText);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Resposta JSON inválida do serviço Álvaro.' });
    }

    let list = loadMateriaisAlvaro();
    const existingMap = new Map();
    list.forEach(item => {
      if (item && item.codigo) {
        existingMap.set(String(item.codigo).trim().toUpperCase(), item);
      }
    });

    let countNew = 0;
    let countUpdated = 0;

    const addOrUpdateMat = (codeVal, descVal) => {
      if (codeVal == null || String(codeVal).trim() === '') return;
      const cod = String(codeVal).trim().toUpperCase();
      const desc = descVal ? String(descVal).trim() : '';

      if (!existingMap.has(cod)) {
        const newItem = {
          id: 'mat-alv-' + cod,
          codigo: String(codeVal).trim(),
          descricao: desc || String(codeVal).trim()
        };
        list.push(newItem);
        existingMap.set(cod, newItem);
        countNew++;
      } else {
        const item = existingMap.get(cod);
        if (desc && item.descricao !== desc) {
          item.descricao = desc;
          countUpdated++;
        }
      }
    };

    if (Array.isArray(payload.materials)) {
      payload.materials.forEach(m => {
        if (m) addOrUpdateMat(m.code, m.description);
      });
    }

    if (Array.isArray(payload.exams)) {
      payload.exams.forEach(ex => {
        if (ex.materialDefault) {
          addOrUpdateMat(ex.materialDefault.code, ex.materialDefault.description);
        }
        if (Array.isArray(ex.possibleMaterials)) {
          ex.possibleMaterials.forEach(pm => {
            if (pm) addOrUpdateMat(pm.code, pm.description);
          });
        }
      });
    }

    saveMateriaisAlvaro(list);

    return res.json({
      success: true,
      countNew,
      countUpdated,
      countTotal: list.length,
      materiais: list
    });

  } catch (err) {
    console.error('Erro na sincronização de materiais Álvaro:', err);
    return res.status(500).json({ success: false, message: 'Erro ao sincronizar com o serviço Álvaro: ' + (err.message || 'Erro interno') });
  }
});

router.post('/api/lab-externo/alvaro/sync-exames', requireAdmin, async (req, res) => {
  try {
    const options = {
      hostname: 'webservice.alvaro.com.br',
      path: '/webserviceaol/rest/homologacao/v1/exames/criticas/all',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic MTY5Mzk2OjJDQUNBNg=='
      },
      timeout: 45000
    };

    const jsonText = await new Promise((resolve, reject) => {
      const request = http.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => { resolve(data); });
      });
      request.on('error', (err) => { reject(err); });
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Timeout ao conectar com o servidor Álvaro.'));
      });
      request.end();
    });

    let payload = {};
    try {
      payload = JSON.parse(jsonText);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Resposta JSON inválida do serviço Álvaro.' });
    }

    // Atualizar cadastro de Materiais Álvaro
    let materiaisList = loadMateriaisAlvaro();
    const matMapByCode = new Map();
    materiaisList.forEach(m => {
      if (m && m.codigo) {
        matMapByCode.set(String(m.codigo).trim().toUpperCase(), m);
      }
    });

    const addOrUpdateMatCatalog = (codeVal, descVal) => {
      if (codeVal == null || String(codeVal).trim() === '') return;
      const codKey = String(codeVal).trim().toUpperCase();
      const codeStr = String(codeVal).trim();
      const descStr = descVal ? String(descVal).trim() : '';

      if (!matMapByCode.has(codKey)) {
        const newItem = {
          id: 'mat-alv-' + codeStr,
          codigo: codeStr,
          descricao: descStr || codeStr
        };
        materiaisList.push(newItem);
        matMapByCode.set(codKey, newItem);
      } else {
        const item = matMapByCode.get(codKey);
        if (descStr && item.descricao !== descStr) {
          item.descricao = descStr;
        }
      }
    };

    if (Array.isArray(payload.materials)) {
      payload.materials.forEach(m => {
        if (m) addOrUpdateMatCatalog(m.code, m.description);
      });
    }

    if (Array.isArray(payload.exams)) {
      payload.exams.forEach(ex => {
        if (ex.materialDefault) {
          addOrUpdateMatCatalog(ex.materialDefault.code, ex.materialDefault.description);
        }
        if (Array.isArray(ex.possibleMaterials)) {
          ex.possibleMaterials.forEach(pm => {
            if (pm) addOrUpdateMatCatalog(pm.code, pm.description);
          });
        }
      });
    }

    saveMateriaisAlvaro(materiaisList);

    // Mapeamento de exames
    let examesList = loadLabExamesAlvaro();
    const existingExamsMap = new Map();
    examesList.forEach(item => {
      if (item && item.codigo) {
        existingExamsMap.set(String(item.codigo).trim().toUpperCase(), item);
      }
    });

    let countNew = 0;
    let countUpdated = 0;

    if (Array.isArray(payload.exams)) {
      for (const ex of payload.exams) {
        if (!ex || !ex.code) continue;
        const codExame = String(ex.code).trim().toUpperCase();
        const descExame = ex.description ? String(ex.description).trim() : '';
        const lastChange = ex.lastChange || '';

        // Material Padrão: armazena SOMENTE o código (conforme solicitado pelo usuário)
        const matDefaultCode = (ex.materialDefault && ex.materialDefault.code != null) ? String(ex.materialDefault.code).trim() : null;
        const matDefaultDesc = (ex.materialDefault && ex.materialDefault.description) ? String(ex.materialDefault.description).trim() : '';

        // Materiais disponíveis
        const possMats = Array.isArray(ex.possibleMaterials) ? ex.possibleMaterials.map(pm => ({
          code: pm.code != null ? String(pm.code).trim() : '',
          description: pm.description ? String(pm.description).trim() : ''
        })) : [];

        // Format string array para o campo `materiais` (código - descrição)
        const materiaisArr = possMats.map(pm => {
          const c = String(pm.code || '').trim();
          const d = String(pm.description || '').trim();
          if (c && d && c.toLowerCase() !== d.toLowerCase()) {
            return `${c} - ${d}`;
          }
          return c || d;
        });

        if (existingExamsMap.has(codExame)) {
          const item = existingExamsMap.get(codExame);
          item.descricao = descExame || item.descricao;
          item.lastChange = lastChange;
          item.materialDefault = matDefaultCode; // somente código na tabela
          item.materialDefaultDesc = matDefaultDesc;
          item.possibleMaterials = possMats;
          item.materiais = materiaisArr;
          countUpdated++;
        } else {
          const newExam = {
            id: 'alv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
            codigo: codExame,
            descricao: descExame,
            valor: 0,
            lastChange: lastChange,
            materialDefault: matDefaultCode, // somente código na tabela
            materialDefaultDesc: matDefaultDesc,
            possibleMaterials: possMats,
            materiais: materiaisArr
          };
          examesList.push(newExam);
          existingExamsMap.set(codExame, newExam);
          countNew++;
        }
      }
    }

    saveLabExamesAlvaro(examesList);

    return res.json({
      success: true,
      countNew,
      countUpdated,
      countTotal: examesList.length,
      exames: examesList,
      materiais: materiaisList
    });

  } catch (err) {
    console.error('Erro na sincronização de exames Álvaro:', err);
    return res.status(500).json({ success: false, message: 'Erro ao sincronizar exames com Álvaro: ' + (err.message || 'Erro interno') });
  }
});

// Laboratório Externo - Exames Pardini
router.get('/admin/lab-externo/pardini', requireAdmin, (req, res) => {
  const exames = loadLabExamesPardini();
  res.render('admin/lab-externo/pardini', {
    exames,
    page: 'admin-lab-externo-pardini'
  });
});

router.get('/api/lab-externo/pardini/exames', requireAdmin, (req, res) => {
  try {
    const list = loadLabExamesPardini();
    return res.json({ success: true, exames: list });
  } catch (err) {
    return res.status(500).json({ success: false, exames: [] });
  }
});

router.post('/api/lab-externo/pardini/save', requireAdmin, (req, res) => {
  try {
    const { id, codigo, descricao, valor, materiais } = req.body;
    let list = loadLabExamesPardini();
    const idx = list.findIndex(item => String(item.id) === String(id));
    const newItem = {
      id: id || ('par-' + Date.now()),
      codigo: codigo || '',
      descricao: descricao || '',
      valor: parseFloat(valor) || 0,
      materiais: Array.isArray(materiais) ? materiais : []
    };

    if (idx !== -1) {
      list[idx] = newItem;
    } else {
      list.push(newItem);
    }

    saveLabExamesPardini(list);
    return res.json({ success: true, exames: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Erro ao salvar exame Pardini.' });
  }
});

router.post('/api/lab-externo/pardini/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    let list = loadLabExamesPardini();
    list = list.filter(item => String(item.id) !== String(id));
    saveLabExamesPardini(list);
    return res.json({ success: true, exames: list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Erro ao excluir exame Pardini.' });
  }
});

// Atualizar Destino de Triagem de Exame (Interno / Álvaro / Pardini)
router.post('/admin/triagem/update-exam-destination', requireAdmin, (req, res) => {
  try {
    const { requisitionId, examCode, destination, examIndex } = req.body;
    const requisitions = loadRequisitions();
    const reqIndex = requisitions.findIndex(r => r.id === requisitionId || r.requisitionCode === requisitionId);

    if (reqIndex !== -1) {
      const targetReq = requisitions[reqIndex];
      if (Array.isArray(targetReq.exams)) {
        if (typeof examIndex === 'number' && examIndex >= 0 && targetReq.exams[examIndex]) {
          targetReq.exams[examIndex].triagemDestination = destination;
          targetReq.exams[examIndex].triagemAt = new Date().toISOString();
        } else if (examCode) {
          const ex = targetReq.exams.find(e => e.code === examCode);
          if (ex) {
            ex.triagemDestination = destination;
            ex.triagemAt = new Date().toISOString();
          }
        } else {
          targetReq.exams.forEach(ex => {
            ex.triagemDestination = destination;
            ex.triagemAt = new Date().toISOString();
          });
        }
      }
      saveRequisitions(requisitions);
      return res.json({ success: true, requisition: targetReq });
    }
    return res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
  } catch (error) {
    console.error('Erro ao atualizar destino de triagem:', error);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// Atualizar Destino de Triagem em Lote
router.post('/admin/triagem/update-batch-destinations', requireAdmin, (req, res) => {
  try {
    const { items } = req.body; // [{ requisitionId, examCode, examIndex, destination }]
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'Dados de triagem inválidos.' });
    }
    const requisitions = loadRequisitions();
    let updatedCount = 0;

    items.forEach(item => {
      const targetReq = requisitions.find(r => r.id === item.requisitionId || r.requisitionCode === item.requisitionId);
      if (targetReq && Array.isArray(targetReq.exams)) {
        let ex;
        if (typeof item.examIndex === 'number' && item.examIndex >= 0 && targetReq.exams[item.examIndex]) {
          ex = targetReq.exams[item.examIndex];
        } else if (item.examCode) {
          ex = targetReq.exams.find(e => e.code === item.examCode);
        }
        if (ex) {
          ex.triagemDestination = item.destination;
          ex.triagemAt = new Date().toISOString();
          updatedCount++;
        }
      }
    });

    saveRequisitions(requisitions);
    return res.json({ success: true, updatedCount });
  } catch (error) {
    console.error('Erro ao atualizar triagem em lote:', error);
    return res.status(500).json({ success: false, message: 'Erro ao salvar triagem.' });
  }
});

// Confirmar Triagem de Paciente
router.post('/admin/triagem/confirm-triagem', requireAdmin, (req, res) => {
  try {
    const { requisitionId, destinations } = req.body;
    const requisitions = loadRequisitions();
    const reqIndex = requisitions.findIndex(r => r.id === requisitionId || r.requisitionCode === requisitionId);

    if (reqIndex !== -1) {
      const targetReq = requisitions[reqIndex];
      targetReq.status = 'Triado';
      targetReq.triado = true;
      targetReq.triadoAt = new Date().toISOString();

      if (Array.isArray(destinations)) {
        destinations.forEach(item => {
          if (Array.isArray(targetReq.exams)) {
            let ex;
            if (typeof item.examIndex === 'number' && item.examIndex >= 0 && targetReq.exams[item.examIndex]) {
              ex = targetReq.exams[item.examIndex];
            } else if (item.examCode) {
              ex = targetReq.exams.find(e => e.code === item.examCode);
            }
            if (ex) {
              if (item.destination) ex.triagemDestination = item.destination;
            }
          }
        });
      }

      if (Array.isArray(targetReq.exams)) {
        targetReq.exams.forEach(ex => {
          ex.status = 'Triado';
          ex.triado = true;
          ex.triadoAt = new Date().toISOString();
        });
      }

      saveRequisitions(requisitions);
      return res.json({ success: true, requisition: targetReq });
    }
    return res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
  } catch (error) {
    console.error('Erro ao confirmar triagem:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao confirmar triagem.' });
  }
});

// Cancelar Triagem de Paciente
router.post('/admin/triagem/cancel-triagem', requireAdmin, (req, res) => {
  try {
    const { requisitionId } = req.body;
    const requisitions = loadRequisitions();
    const reqIndex = requisitions.findIndex(r => r.id === requisitionId || r.requisitionCode === requisitionId);

    if (reqIndex !== -1) {
      const targetReq = requisitions[reqIndex];
      targetReq.status = 'Coletado';
      targetReq.triado = false;
      delete targetReq.triadoAt;

      if (Array.isArray(targetReq.exams)) {
        targetReq.exams.forEach(ex => {
          ex.status = 'Coletado';
          ex.triado = false;
          delete ex.triadoAt;
        });
      }

      saveRequisitions(requisitions);
      return res.json({ success: true, requisition: targetReq });
    }
    return res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
  } catch (error) {
    console.error('Erro ao cancelar triagem:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao cancelar triagem.' });
  }
});

// ==========================================
// SUB-MÓDULO: MONITORAMENTO AMBIENTAL E TEMPERATURAS
// ==========================================

// Listagem de Equipamentos e Monitoramento
router.get('/admin/temperaturas', requireAdmin, async (req, res) => {
  const items = await loadTemperaturas();
  res.render('admin/temperaturas', {
    items: items,
    page: 'admin-temperaturas'
  });
});

// Adicionar Novo Equipamento (POST)
router.post('/admin/temperaturas/add-equipamento', requireAdmin, async (req, res) => {
  try {
    const { name, code, type, brand, model, serialNumber, patrimony, sector, location, responsible, sensor, minTemp, maxTemp, currentTemp, content } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).send("Nome do equipamento é obrigatório");
    }

    const items = await loadTemperaturas();
    const minT = parseFloat(minTemp) || 0;
    const maxT = parseFloat(maxTemp) || 0;
    const currT = parseFloat(currentTemp) || 0;

    let status = "🟢 Dentro da Faixa";
    if (currT < minT || currT > maxT) {
      status = "🔴 Fora da Faixa";
    }

    const newItem = {
      id: 'EQ-' + Date.now(),
      name: name.trim(),
      code: (code || '').trim(),
      type: (type || 'Geladeira').trim(),
      brand: (brand || '').trim(),
      model: (model || '').trim(),
      serialNumber: (serialNumber || '').trim(),
      patrimony: (patrimony || '').trim(),
      sector: (sector || '').trim(),
      location: (location || '').trim(),
      responsible: (responsible || '').trim(),
      sensor: (sensor || '').trim(),
      minTemp: minT,
      maxTemp: maxT,
      currentTemp: currT,
      status: status,
      nextReading: "14:00",
      lastReadingTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      content: (content || '').trim(),
      readings: [
        {
          date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          temp: currT,
          responsible: (responsible || 'Sistema').trim(),
          method: 'Manual',
          notes: 'Leitura inicial de ativação do equipamento.',
          status: currT < minT || currT > maxT ? '🔴' : '🟢'
        }
      ],
      occurrences: [],
      maintenances: [],
      checklist: {
        ligado: true,
        vedacao: true,
        porta: true,
        alarmes: true,
        limpeza: true,
        gelo: false,
        updatedAt: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        responsible: (responsible || 'Sistema').trim()
      },
      documents: [],
      timeline: [
        {
          date: new Date().toLocaleDateString('pt-BR'),
          event: "Instalado",
          description: "Equipamento cadastrado e ativado no sistema."
        }
      ]
    };

    // Se começou fora da faixa, cria ocorrência automática
    if (currT < minT || currT > maxT) {
      newItem.occurrences.push({
        date: new Date().toLocaleDateString('pt-BR'),
        temp: currT,
        reason: "Temperatura inicial fora dos limites regulamentares.",
        status: "Aberta",
        timeOutside: "0 min",
        identifiedBy: (responsible || 'Sistema').trim(),
        description: `Equipamento ativado fora da faixa de segurança (Configurado: ${minT}°C a ${maxT}°C, Atual: ${currT}°C).`,
        immediateAction: "Aguardar estabilização térmica e monitorar.",
        responsible: (responsible || 'Sistema').trim(),
        result: ""
      });
      newItem.timeline.push({
        date: new Date().toLocaleDateString('pt-BR'),
        event: "Temperatura Fora",
        description: `Temperatura fora dos limites registrada na ativação (${currT}°C).`
      });
    }

    items.push(newItem);
    await saveTemperaturas(items);
    res.redirect('/admin/temperaturas?success=added');
  } catch (error) {
    console.error("Erro ao adicionar equipamento:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

// Editar Equipamento (POST)
router.post('/admin/temperaturas/edit-equipamento', requireAdmin, async (req, res) => {
  try {
    const { id, name, code, type, brand, model, serialNumber, patrimony, sector, location, responsible, sensor, minTemp, maxTemp, content } = req.body;
    
    if (!id || !name || name.trim() === '') {
      return res.status(400).send("ID e Nome são obrigatórios");
    }

    const items = await loadTemperaturas();
    const idx = items.findIndex(item => item.id === id);
    if (idx === -1) {
      return res.status(404).send("Equipamento não encontrado");
    }

    const minT = parseFloat(minTemp) || 0;
    const maxT = parseFloat(maxTemp) || 0;

    // Atualiza campos
    items[idx].name = name.trim();
    items[idx].code = (code || '').trim();
    items[idx].type = (type || 'Geladeira').trim();
    items[idx].brand = (brand || '').trim();
    items[idx].model = (model || '').trim();
    items[idx].serialNumber = (serialNumber || '').trim();
    items[idx].patrimony = (patrimony || '').trim();
    items[idx].sector = (sector || '').trim();
    items[idx].location = (location || '').trim();
    items[idx].responsible = (responsible || '').trim();
    items[idx].sensor = (sensor || '').trim();
    items[idx].minTemp = minT;
    items[idx].maxTemp = maxT;
    items[idx].content = (content || '').trim();

    // Recalcula status com base na temperatura atual e novas faixas
    if (items[idx].currentTemp < minT || items[idx].currentTemp > maxT) {
      items[idx].status = "🔴 Fora da Faixa";
    } else {
      items[idx].status = "🟢 Dentro da Faixa";
    }

    items[idx].timeline.push({
      date: new Date().toLocaleDateString('pt-BR'),
      event: "Configuração Alterada",
      description: "Parâmetros e limites operacionais atualizados."
    });

    await saveTemperaturas(items);
    res.redirect('/admin/temperaturas?success=edited&eqId=' + id);
  } catch (error) {
    console.error("Erro ao editar equipamento:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

// Excluir Equipamento (POST)
router.post('/admin/temperaturas/delete-equipamento', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).send("ID é obrigatório");
    }

    const items = await loadTemperaturas();
    const filtered = items.filter(item => item.id !== id);
    await saveTemperaturas(filtered);
    res.redirect('/admin/temperaturas?success=deleted');
  } catch (error) {
    console.error("Erro ao excluir equipamento:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

// Adicionar Leitura de Temperatura (POST)
router.post('/admin/temperaturas/add-reading', requireAdmin, async (req, res) => {
  try {
    const { eqId, temp, date, time, responsible, method, notes, photo } = req.body;
    if (!eqId || temp === undefined) {
      return res.status(400).send("ID do equipamento e temperatura são obrigatórios");
    }

    const items = await loadTemperaturas();
    const idx = items.findIndex(item => item.id === eqId);
    if (idx === -1) {
      return res.status(404).send("Equipamento não encontrado");
    }

    const tVal = parseFloat(temp);
    const minT = items[idx].minTemp;
    const maxT = items[idx].maxTemp;

    let isOut = tVal < minT || tVal > maxT;
    let iconStatus = isOut ? '🔴' : '🟢';

    const newReading = {
      date: date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      time: time || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      temp: tVal,
      responsible: responsible || 'Sistema',
      method: method || 'Manual',
      notes: notes || '',
      status: iconStatus,
      photo: photo || null
    };

    items[idx].currentTemp = tVal;
    items[idx].lastReadingTime = newReading.time;
    items[idx].status = isOut ? "🔴 Fora da Faixa" : "🟢 Dentro da Faixa";

    if (!items[idx].readings) items[idx].readings = [];
    items[idx].readings.unshift(newReading); // Mais recente primeiro

    // Criar ocorrência automática se estiver fora da faixa
    if (isOut) {
      if (!items[idx].occurrences) items[idx].occurrences = [];
      
      const newOcc = {
        date: date || new Date().toLocaleDateString('pt-BR'),
        temp: tVal,
        reason: notes || "Temperatura registrada fora dos limites operacionais de segurança.",
        status: "Aberta",
        timeOutside: "A apurar",
        identifiedBy: responsible || 'Sistema',
        description: `Leitura manual/sensor indicou temperatura de ${tVal}°C, ultrapassando os limites de ${minT}°C a ${maxT}°C.`,
        immediateAction: "Avisar o Responsável Técnico e verificar vedação/energia.",
        responsible: responsible || 'Sistema',
        result: ""
      };
      items[idx].occurrences.unshift(newOcc);

      if (!items[idx].timeline) items[idx].timeline = [];
      items[idx].timeline.push({
        date: new Date().toLocaleDateString('pt-BR'),
        event: "Temperatura Fora",
        description: `Registrada temperatura crítica de ${tVal}°C por ${responsible || 'Sistema'}.`
      });
    }

    await saveTemperaturas(items);
    res.redirect('/admin/temperaturas?success=reading&eqId=' + eqId);
  } catch (error) {
    console.error("Erro ao registrar leitura de temperatura:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

// Adicionar Ocorrência Manualmente (POST)
router.post('/admin/temperaturas/add-occurrence', requireAdmin, async (req, res) => {
  try {
    const { eqId, date, temp, reason, identifiedBy, description, immediateAction, responsible } = req.body;
    if (!eqId) {
      return res.status(400).send("ID do equipamento é obrigatório");
    }

    const items = await loadTemperaturas();
    const idx = items.findIndex(item => item.id === eqId);
    if (idx === -1) {
      return res.status(404).send("Equipamento não encontrado");
    }

    const newOcc = {
      date: date || new Date().toLocaleDateString('pt-BR'),
      temp: parseFloat(temp) || items[idx].currentTemp,
      reason: reason || 'Ocorrência operacional sem motivo especificado',
      status: "Aberta",
      timeOutside: "0 min",
      identifiedBy: identifiedBy || 'Sistema',
      description: description || '',
      immediateAction: immediateAction || '',
      responsible: responsible || '',
      result: ""
    };

    if (!items[idx].occurrences) items[idx].occurrences = [];
    items[idx].occurrences.unshift(newOcc);

    if (!items[idx].timeline) items[idx].timeline = [];
    items[idx].timeline.push({
      date: new Date().toLocaleDateString('pt-BR'),
      event: "Ocorrência Registrada",
      description: reason || "Problema ou desvio técnico registrado."
    });

    await saveTemperaturas(items);
    res.redirect('/admin/temperaturas?success=occurrence&eqId=' + eqId);
  } catch (error) {
    console.error("Erro ao registrar ocorrência:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

// Resolver/Fechar Ocorrência (POST)
router.post('/admin/temperaturas/resolve-occurrence', requireAdmin, async (req, res) => {
  try {
    const { eqId, occurrenceIndex, result, timeOutside } = req.body;
    if (!eqId || occurrenceIndex === undefined) {
      return res.status(400).send("ID do equipamento e índice da ocorrência são obrigatórios");
    }

    const items = await loadTemperaturas();
    const idx = items.findIndex(item => item.id === eqId);
    if (idx === -1) {
      return res.status(404).send("Equipamento não encontrado");
    }

    const occIdx = parseInt(occurrenceIndex);
    if (!items[idx].occurrences || !items[idx].occurrences[occIdx]) {
      return res.status(404).send("Ocorrência não encontrada");
    }

    items[idx].occurrences[occIdx].status = "Fechada";
    items[idx].occurrences[occIdx].result = result || "Ação de correção executada com sucesso.";
    if (timeOutside) {
      items[idx].occurrences[occIdx].timeOutside = timeOutside;
    }

    if (!items[idx].timeline) items[idx].timeline = [];
    items[idx].timeline.push({
      date: new Date().toLocaleDateString('pt-BR'),
      event: "Ocorrência Resolvida",
      description: `Ocorrência fechada: ${result || 'Concluída.'}`
    });

    await saveTemperaturas(items);
    res.redirect('/admin/temperaturas?success=resolved&eqId=' + eqId);
  } catch (error) {
    console.error("Erro ao resolver ocorrência:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

// Adicionar Manutenção (POST)
router.post('/admin/temperaturas/add-maintenance', requireAdmin, async (req, res) => {
  try {
    const { eqId, date, type, description, responsible, cost } = req.body;
    if (!eqId) {
      return res.status(400).send("ID do equipamento é obrigatório");
    }

    const items = await loadTemperaturas();
    const idx = items.findIndex(item => item.id === eqId);
    if (idx === -1) {
      return res.status(404).send("Equipamento não encontrado");
    }

    const newMaint = {
      date: date || new Date().toLocaleDateString('pt-BR'),
      type: type || 'Preventiva',
      description: description || '',
      responsible: responsible || '',
      cost: parseFloat(cost) || 0
    };

    if (!items[idx].maintenances) items[idx].maintenances = [];
    items[idx].maintenances.unshift(newMaint);

    if (!items[idx].timeline) items[idx].timeline = [];
    items[idx].timeline.push({
      date: new Date().toLocaleDateString('pt-BR'),
      event: "Manutenção",
      description: `Realizada manutenção ${type}: ${description}`
    });

    await saveTemperaturas(items);
    res.redirect('/admin/temperaturas?success=maintenance&eqId=' + eqId);
  } catch (error) {
    console.error("Erro ao registrar manutenção:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

// Atualizar Checklist Operacional Diário (POST)
router.post('/admin/temperaturas/update-checklist', requireAdmin, async (req, res) => {
  try {
    const { eqId, ligado, vedacao, porta, alarmes, limpeza, gelo, responsible } = req.body;
    if (!eqId) {
      return res.status(400).send("ID do equipamento é obrigatório");
    }

    const items = await loadTemperaturas();
    const idx = items.findIndex(item => item.id === eqId);
    if (idx === -1) {
      return res.status(404).send("Equipamento não encontrado");
    }

    items[idx].checklist = {
      ligado: ligado === 'on' || ligado === true,
      vedacao: vedacao === 'on' || vedacao === true,
      porta: porta === 'on' || porta === true,
      alarmes: alarmes === 'on' || alarmes === true,
      limpeza: limpeza === 'on' || limpeza === true,
      gelo: gelo === 'on' || gelo === true,
      updatedAt: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      responsible: responsible || 'Sistema'
    };

    if (!items[idx].timeline) items[idx].timeline = [];
    items[idx].timeline.push({
      date: new Date().toLocaleDateString('pt-BR'),
      event: "Checklist Realizado",
      description: `Verificação técnica diária realizada por ${responsible || 'Sistema'}.`
    });

    await saveTemperaturas(items);
    res.redirect('/admin/temperaturas?success=checklist&eqId=' + eqId);
  } catch (error) {
    console.error("Erro ao atualizar checklist:", error);
    res.status(500).send("Erro interno do servidor");
  }
});

// Adicionar Documento do Equipamento (POST)
router.post('/admin/temperaturas/add-document', requireAdmin, async (req, res) => {
  try {
    const { eqId, name, type, date } = req.body;
    if (!eqId || !name) {
      return res.status(400).send("ID do equipamento e nome do documento são obrigatórios");
    }

    const items = await loadTemperaturas();
    const idx = items.findIndex(item => item.id === eqId);
    if (idx === -1) {
      return res.status(404).send("Equipamento não encontrado");
    }

    const newDoc = {
      name: name.trim(),
      type: type || 'Outro',
      date: date || new Date().toLocaleDateString('pt-BR')
    };

    if (!items[idx].documents) items[idx].documents = [];
    items[idx].documents.push(newDoc);

    if (!items[idx].timeline) items[idx].timeline = [];
    items[idx].timeline.push({
      date: new Date().toLocaleDateString('pt-BR'),
      event: "Documento Anexado",
      description: `Inserido documento: ${name} (${type}).`
    });

    await saveTemperaturas(items);
    res.redirect('/admin/temperaturas?success=document&eqId=' + eqId);
  } catch (error) {
    console.error("Erro ao adicionar documento:", error);
    res.status(500).send("Erro interno do servidor");
  }
});


// Página Principal de Novas Requisições Simplificadas
router.get('/admin/requisicoes', requireAdmin, (req, res) => {
  const requisitions = loadRequisitions();
  const patients = loadPatients();
  const exams = loadExams();
  
  let maxReq = 1000;
  requisitions.forEach(r => {
    if (r.requisitionCode) {
      const num = parseInt(String(r.requisitionCode).replace(/\D/g, ''), 10);
      if (!isNaN(num) && num > maxReq) maxReq = num;
    }
  });
  const nextReqCode = String(maxReq + 1).padStart(8, '0');

  res.render('admin/requisicoes', {
    requisitions: [...requisitions].reverse().slice(0, 50), // Mais recentes primeiro (máximo 50)
    patients,
    exams,
    convenios: loadConvenios(),
    priceTables: loadPriceTables(),
    medicos: loadMedicos(),
    nextReqCode,
    messageTemplates: loadMessageTemplates(),
    requisitionShortcuts: loadRequisitionShortcuts(),
    paymentMethods: loadFinanceSettings().paymentMethods || [],
    page: 'admin-requisitions'
  });
});


export default router;
