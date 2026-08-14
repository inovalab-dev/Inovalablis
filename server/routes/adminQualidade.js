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
  requireAdmin,
  slugify,
  SITEMAP_OLD_EXAMS
} from "../dataStore.js";

const router = express.Router();

// ================= NÃO CONFORMIDADES (ADMIN) =================

// Carregar página de gestão de não conformidades
router.get('/admin/nao-conformidades', requireAdmin, (req, res) => {
  const list = loadNonConformities();
  
  // Sort list to make newest first
  const sorted = [...list].sort((a, b) => {
    return String(b.id).localeCompare(String(a.id));
  });

  const selectedId = req.query.id || (sorted.length > 0 ? sorted[0].id : null);
  const selectedNC = list.find(n => String(n.id) === String(selectedId)) || null;

  res.render('admin/nao-conformidades', {
    nonConformities: sorted,
    selectedNC: selectedNC,
    page: 'admin-nao-conformidades'
  });
});

// Criar ou Salvar uma Não Conformidade (POST via AJAX)
router.post('/admin/nao-conformidades/salvar', requireAdmin, (req, res) => {
  try {
    const list = loadNonConformities();
    let {
      id,
      status,
      dateOccurrence,
      timeOccurrence,
      dateRegistration,
      responsibleRegistration,
      unit,
      sector,
      process,
      subprocess,
      category,
      type,
      origin,
      severity,
      priority,
      description,
      patientName,
      patientCode,
      convenio,
      requisitionCode,
      exam,
      material,
      lot,
      reagent,
      equipment,
      pop,
      supplier,
      affected, // can be array or string or undefined
      impactDescription,
      causeAnalysisMethod,
      causeAnalysisRoot,
      actionPlanJson, // dynamic action plan stringified
      effectivenessResolved,
      effectivenessRecurred,
      effectivenessDescription,
      effectivenessResponsible,
      effectivenessDate,
      closureResponsible,
      closureDate,
      closureParecer,
      closureSignature
    } = req.body;

    let isNew = false;
    let targetNC;

    if (!id || String(id).trim() === '') {
      // Gerar novo ID
      const ncNumbers = list
        .map(n => {
          const match = n.id.match(/^NC-(\d+)$/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(num => num > 0);
      const nextNum = ncNumbers.length > 0 ? Math.max(...ncNumbers) + 1 : 146;
      id = `NC-${String(nextNum).padStart(6, '0')}`;
      
      targetNC = {
        id,
        comments: [],
        history: [],
        version: 1,
        createdAt: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
        createdBy: responsibleRegistration || 'Usuário Admin'
      };
      
      targetNC.history.push({
        user: responsibleRegistration || 'Usuário Admin',
        date: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
        action: 'Criação da Não Conformidade',
        comments: 'Não conformidade registrada no sistema.'
      });

      isNew = true;
    } else {
      targetNC = list.find(n => String(n.id) === String(id));
      if (!targetNC) {
        return res.status(404).json({ success: false, error: 'Não Conformidade não encontrada' });
      }
      
      // Incrementar versão e registrar histórico se houver mudanças importantes de status
      const oldStatus = targetNC.status;
      if (oldStatus !== status) {
        targetNC.history.push({
          user: responsibleRegistration || 'Usuário Admin',
          date: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
          action: 'Alteração de Status',
          comments: `Status alterado de "${oldStatus}" para "${status}".`
        });
      }
      targetNC.version = (targetNC.version || 1) + 1;
      targetNC.updatedAt = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
      targetNC.updatedBy = responsibleRegistration || 'Usuário Admin';
    }

    // Set simple fields
    targetNC.status = status || 'Aberta';
    targetNC.dateOccurrence = dateOccurrence || '';
    targetNC.timeOccurrence = timeOccurrence || '';
    targetNC.dateRegistration = dateRegistration || '';
    targetNC.responsibleRegistration = responsibleRegistration || '';
    targetNC.unit = unit || '';
    targetNC.sector = sector || '';
    targetNC.process = process || '';
    targetNC.subprocess = subprocess || '';
    targetNC.category = category || '';
    targetNC.type = type || '';
    targetNC.origin = origin || '';
    targetNC.severity = severity || 'Média';
    targetNC.priority = priority || 'Média';
    targetNC.description = description || '';

    // Patient info fields
    targetNC.patientName = patientName || '';
    targetNC.patientCode = patientCode || '';
    targetNC.convenio = convenio || '';
    targetNC.requisitionCode = requisitionCode || '';
    targetNC.exam = exam || '';
    targetNC.material = material || '';
    targetNC.lot = lot || '';
    targetNC.reagent = reagent || '';
    targetNC.equipment = equipment || '';
    targetNC.pop = pop || '';
    targetNC.supplier = supplier || '';

    // Impact
    if (Array.isArray(affected)) {
      targetNC.affected = affected;
    } else if (affected) {
      targetNC.affected = [affected];
    } else {
      targetNC.affected = [];
    }
    targetNC.impactDescription = impactDescription || '';

    // Evidences (Keep existing if any)
    if (!targetNC.evidences) {
      targetNC.evidences = [];
    }

    // Cause Analysis
    targetNC.causeAnalysisMethod = causeAnalysisMethod || '5 Porquês';
    targetNC.causeAnalysisRoot = causeAnalysisRoot || '';

    // Action Plan
    try {
      if (actionPlanJson) {
        targetNC.actionPlan = JSON.parse(actionPlanJson);
      } else {
        targetNC.actionPlan = targetNC.actionPlan || [];
      }
    } catch (parseErr) {
      console.error("Erro ao fazer parse do plano de ação:", parseErr);
      targetNC.actionPlan = targetNC.actionPlan || [];
    }

    // Effectiveness
    targetNC.effectivenessResolved = effectivenessResolved || '';
    targetNC.effectivenessRecurred = effectivenessRecurred || '';
    targetNC.effectivenessDescription = effectivenessDescription || '';
    targetNC.effectivenessResponsible = effectivenessResponsible || '';
    targetNC.effectivenessDate = effectivenessDate || '';

    // Closure
    targetNC.closureResponsible = closureResponsible || '';
    targetNC.closureDate = closureDate || '';
    targetNC.closureParecer = closureParecer || '';
    targetNC.closureSignature = closureSignature || '';

    if (isNew) {
      list.push(targetNC);
    } else {
      const idx = list.findIndex(n => String(n.id) === String(id));
      if (idx >= 0) {
        list[idx] = targetNC;
      }
    }

    saveNonConformities(list);

    res.json({
      success: true,
      id: id,
      message: 'Não Conformidade salva com sucesso!'
    });
  } catch (error) {
    console.error("Erro ao salvar não conformidade:", error);
    res.status(500).json({ success: false, error: 'Erro interno do servidor ao salvar dados.' });
  }
});

// Adicionar comentário ao chat (POST via AJAX)
router.post('/admin/nao-conformidades/comentar', requireAdmin, (req, res) => {
  try {
    const { id, text, user } = req.body;
    if (!id || !text || String(text).trim() === '') {
      return res.status(400).json({ success: false, error: 'Parâmetros inválidos' });
    }

    const list = loadNonConformities();
    const nc = list.find(n => String(n.id) === String(id));
    if (!nc) {
      return res.status(404).json({ success: false, error: 'Não Conformidade não encontrada' });
    }

    const comment = {
      user: user || 'Usuário Admin',
      date: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
      text: String(text).trim()
    };

    if (!nc.comments) {
      nc.comments = [];
    }
    nc.comments.push(comment);

    // Adicionar ao histórico de auditoria
    if (!nc.history) {
      nc.history = [];
    }
    nc.history.push({
      user: user || 'Usuário Admin',
      date: comment.date,
      action: 'Adição de Comentário',
      comments: `Adicionou um comentário no chat da NC.`
    });

    saveNonConformities(list);

    res.json({
      success: true,
      comment: comment
    });
  } catch (error) {
    console.error("Erro ao comentar na NC:", error);
    res.status(500).json({ success: false, error: 'Erro interno ao adicionar comentário.' });
  }
});

// Deletar Não Conformidade
router.post('/admin/nao-conformidades/deletar', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    let list = loadNonConformities();
    const initialLen = list.length;
    list = list.filter(n => String(n.id) !== String(id));

    if (list.length === initialLen) {
      return res.status(404).json({ success: false, error: 'Não Conformidade não encontrada' });
    }

    saveNonConformities(list);
    res.json({ success: true, message: 'Não Conformidade removida com sucesso!' });
  } catch (error) {
    console.error("Erro ao deletar NC:", error);
    res.status(500).json({ success: false, error: 'Erro interno ao deletar.' });
  }
});

// Integração com Inteligência Artificial Gemini (POST via AJAX)
router.post('/api/admin/nao-conformidades/ia', requireAdmin, async (req, res) => {
  try {
    const { action, text, context } = req.body;
    
    if (!action || !text) {
      return res.status(400).json({ success: false, error: 'Ação ou texto ausente.' });
    }

    let prompt = '';
    
    if (action === 'improve') {
      prompt = `Você é um especialista em Gestão da Qualidade Laboratorial (ISO 15189 / PALC). 
Melhore a seguinte descrição de não conformidade para torná-la extremamente técnica, objetiva, impessoal e clara. 
Mantenha os fatos essenciais intocados, mas utilize termos formais da área de análises clínicas. 

Texto original:
"${text}"

Descrição formal melhorada:`;
    } else if (action === 'summarize') {
      prompt = `Você é um especialista em qualidade laboratorial. Resuma a seguinte descrição de não conformidade laboratorial em um resumo executivo direto e claro de no máximo 1 ou 2 frases curtas.

Texto original:
"${text}"

Resumo curto:`;
    } else if (action === 'suggest_cause') {
      prompt = `Você é um especialista em engenharia da qualidade e análises clínicas. 
Com base na seguinte descrição de não conformidade do laboratório, sugira 3 causas prováveis plausíveis (humanas, físicas ou processuais) com soluções sugeridas breves para cada uma.

Setor: ${context?.sector || 'Não especificado'}
Processo: ${context?.process || 'Não especificado'}
Subprocesso: ${context?.subprocess || 'Não especificado'}

Descrição:
"${text}"

Sugestões de causas e soluções breves (em português, formato amigável com marcadores):`;
    } else if (action === 'generate_5whys') {
      prompt = `Você é um analista de qualidade sênior da área de saúde. 
Gere uma análise estruturada do método dos "5 Porquês" (5 Whys) para chegar à causa raiz, com base na descrição de não conformidade fornecida. 
Seja extremamente realista e prático, focado na rotina de análises laboratoriais.

Descrição:
"${text}"

Gere os 5 Porquês sequenciais de forma lógica, concluindo com uma Causa Raiz Clara e uma recomendação de ação preventiva imediata. Escreva em formato de texto limpo em português.`;
    } else {
      return res.status(400).json({ success: false, error: 'Ação de IA desconhecida.' });
    }

    console.log(`Chamando modelo gemini-3.5-flash com ação: ${action}`);

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        temperature: 0.7
      }
    });

    const resultText = response.text || '';
    res.json({
      success: true,
      result: resultText.trim()
    });

  } catch (error) {
    console.error("Erro na chamada da API do Gemini:", error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro na integração com a inteligência artificial Gemini. Por favor, verifique se a chave de API está ativa.' 
    });
  }
});


export default router;
