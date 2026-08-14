import express from "express";
import {
  queryTableFromMysql,
  loadApiResults,
  saveApiResults,
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
  generateRandomHash,
  registerEvaluationLink,
  getOrCreateHashForPatient,
  resolvePatientCodeFromHash,
  getNameFromHashOrCode,
  trackEvaluationAccess,
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
  loadEscalaPlantao,
  saveEscalaPlantao,
  requireAdmin,
  slugify,
  SITEMAP_OLD_EXAMS
} from "../dataStore.js";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

const router = express.Router();

// ================= PROCESSAMENTO DE FORMULÁRIOS ADICIONAIS =================

// Consulta de resultados (POST) (Preservado)
router.post('/resultados', (req, res) => {
  const { protocol, password, usuario, senha } = req.body;
  const finalProtocol = (protocol || usuario || '').toUpperCase().trim();
  const finalPassword = password || senha || '';
  
  if (!finalProtocol || !finalPassword) {
    return res.render('resultados', {
      error: 'Por favor, informe o protocolo/usuário e a senha impressos em seu comprovante.',
      patient: null,
      page: 'resultados'
    });
  }

  // 1. Verificar no banco de dados de resultados simulados (Mocks IN001 / IN002)
  let patientRecord = resultsDatabase[finalProtocol];
  let patientData = null;

  if (patientRecord && patientRecord.password === finalPassword) {
    const hash = getOrCreateHashForPatient(finalProtocol, patientRecord.patientName);
    patientData = {
      protocol: finalProtocol,
      hash: hash,
      ...patientRecord
    };
  } else {
    // 2. Verificar nas requisições cadastradas localmente pelo painel
    const requisitions = loadRequisitions();
    const foundReq = requisitions.find(r => 
      (String(r.requisitionCode || '').toUpperCase().trim() === finalProtocol || 
       String(r.patientUsername || '').toUpperCase().trim() === finalProtocol) &&
      String(r.patientPassword || '').trim() === finalPassword
    );

    if (foundReq) {
      const formattedReqs = formatRequisitionExams([foundReq]);
      const reqFormatted = formattedReqs[0];
      const hash = getOrCreateHashForPatient(foundReq.requisitionCode, foundReq.patientName);
      patientData = {
        protocol: foundReq.requisitionCode,
        hash: hash,
        password: foundReq.patientPassword,
        patientName: foundReq.patientName,
        date: reqFormatted.data || (foundReq.createdAt ? foundReq.createdAt.split(' ')[0] : new Date().toLocaleDateString('pt-BR')),
        doctor: foundReq.doctorName || 'Dr. Solicitante',
        status: foundReq.status || 'Liberado',
        exams: reqFormatted.exams
      };
    }
  }

  if (patientData) {
    return res.render('resultados', {
      error: null,
      patient: patientData,
      page: 'resultados',
      seoTitle: 'Laudo de Exames Online | InovaLab Cambará',
      seoDescription: 'Consulte seus resultados de exames de forma totalmente segura no portal do paciente.',
      seoKeywords: 'laudo online, resultados inovalab, portal paciente',
      canonicalPath: '/resultados'
    });
  } else {
    return res.render('resultados', {
      error: 'Protocolo não encontrado ou senha incorreta. Para testar, utilize o Protocolo IN001 ou IN002 e Senha 123',
      patient: null,
      page: 'resultados',
      seoTitle: 'Portal de Resultados Online | InovaLab Cambará',
      seoDescription: 'Consulte seus resultados de exames de forma totalmente segura no portal do paciente.',
      seoKeywords: 'laudo online, resultados inovalab, portal paciente',
      canonicalPath: '/resultados'
    });
  }
});

// Agendamento de coleta domiciliar (POST)
router.post('/agendar', (req, res) => {
  const { name, phone, email, date, address, examIds } = req.body;

  if (!name || !phone || !date || !address) {
    return res.render('servicos', {
      error: 'Por favor, preencha todos os campos obrigatórios para prosseguir com o agendamento.',
      successMessage: null,
      page: 'servicos'
    });
  }

  const exams = loadExams();
  const selectedExamList = examIds 
    ? (Array.isArray(examIds) ? examIds : [examIds])
    : [];

  const examsDetails = exams.filter(e => selectedExamList.includes(e.id));
  const examNames = examsDetails.map(e => e.name).join(', ') || 'Não especificado';

  const dateFormatted = new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

  const successMessage = `Olá ${name}! Recebemos seu pedido de agendamento de Coleta Residencial para o dia ${dateFormatted}. Nossa equipe administrativa em Cambará entrará em contato via WhatsApp no telefone ${phone} nas próximas horas para validar o endereço (${address}) e repassar as instruções de jejum dos exames (${examNames}). Obrigado pela preferência!`;

  res.render('servicos', {
    error: null,
    successMessage: successMessage,
    page: 'servicos'
  });
});

// Envio do formulário de contato (POST) (Preservado)
router.post('/contato', (req, res) => {
  const { name, phone, email, subject, message } = req.body;
  res.render('contato', {
    success: true,
    page: 'contato',
    clientName: name
  });
});

// 8. PÁGINA DE AVALIAÇÃO DE SATISFAÇÃO (NPS)

function markEvaluationAsSubmitted(code) {
  if (!code) return;
  const cleanCode = String(code).trim();
  if (!cleanCode) return;

  const accesses = loadEvalAccesses();
  const existingIndex = accesses.findIndex(a => String(a.id).trim().toLowerCase() === cleanCode.toLowerCase());

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR');

  if (existingIndex >= 0) {
    accesses[existingIndex].status = 'submitted';
    accesses[existingIndex].lastAccessDate = dateStr;
    accesses[existingIndex].lastAccessTime = timeStr;
    if (accesses[existingIndex].firstAccessDate === '-' || !accesses[existingIndex].firstAccessDate) {
      accesses[existingIndex].firstAccessDate = dateStr;
      accesses[existingIndex].firstAccessTime = timeStr;
    }
  } else {
    accesses.push({
      id: cleanCode,
      code: cleanCode,
      firstAccessDate: dateStr,
      firstAccessTime: timeStr,
      lastAccessDate: dateStr,
      lastAccessTime: timeStr,
      status: 'submitted'
    });
  }
  saveEvalAccesses(accesses);
}

router.get('/avaliar/:patientCode', (req, res) => {
  const patientCodeRaw = req.params.patientCode;
  const patientCode = resolvePatientCodeFromHash(patientCodeRaw);
  const rating = req.query.rating ? parseInt(req.query.rating) : null;
  const name = req.query.name || getNameFromHashOrCode(patientCodeRaw) || '';
  
  if (patientCode) {
    trackEvaluationAccess(patientCode);
  }

  res.render('avaliar', {
    success: false,
    rating: rating,
    preRating: rating,
    name: name,
    code: patientCode, // código real do paciente para rastrear no formulário oculto
    evaluationId: null,
    page: 'avaliar',
    seoTitle: 'Avalie Nosso Atendimento | InovaLab Cambará',
    seoDescription: 'Sua opinião é fundamental para mantermos nosso atendimento humanizado e nossa agilidade técnica.',
    seoKeywords: 'avaliar inovalab, opinião inovalab, reclamação inovalab, sugestão laboratório cambará',
    canonicalPath: '/avaliar'
  });
});

router.get('/avaliar', (req, res) => {
  const rating = req.query.rating ? parseInt(req.query.rating) : null;
  const codeRaw = req.query.code || '';
  const code = resolvePatientCodeFromHash(codeRaw);
  const name = req.query.name || getNameFromHashOrCode(codeRaw) || '';
  
  if (code) {
    trackEvaluationAccess(code);
  }

  res.render('avaliar', {
    success: false,
    rating: rating,
    preRating: rating,
    name: name,
    code: code, // código real do paciente
    evaluationId: null,
    page: 'avaliar',
    seoTitle: 'Avalie Nosso Atendimento | InovaLab Cambará',
    seoDescription: 'Sua opinião é fundamental para mantermos nosso atendimento humanizado e nossa agilidade técnica.',
    seoKeywords: 'avaliar inovalab, opinião inovalab, reclamação inovalab, sugestão laboratório cambará',
    canonicalPath: '/avaliar'
  });
});

router.post('/avaliar', (req, res) => {
  const { rating, name, phone, comment_positive, comment_negative, code } = req.body;
  const finalRating = parseInt(rating);
  const finalName = (name || '').trim() || 'Anônimo';
  const finalComment = finalRating >= 4 ? (comment_positive || '') : (comment_negative || '');
  const finalCode = resolvePatientCodeFromHash((code || '').trim()) || null;
  
  if (finalCode) {
    markEvaluationAsSubmitted(finalCode);
  }

  const evaluations = loadEvaluations();
  const now = new Date();
  
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR');

  const newEvaluation = {
    id: String(Date.now()), // ID único baseado em timestamp
    name: finalName,
    phone: (phone || '').trim(),
    rating: finalRating,
    comment: finalComment.trim() || 'Sem comentários adicionais.',
    date: dateStr,
    time: timeStr,
    code: finalCode,
    type: finalRating >= 4 ? 'positive' : 'constructive',
    googleClicked: false
  };

  evaluations.push(newEvaluation);
  saveEvaluations(evaluations);

  res.render('avaliar', {
    success: true,
    rating: finalRating,
    preRating: finalRating,
    name: finalName,
    code: finalCode,
    evaluationId: newEvaluation.id,
    page: 'avaliar',
    seoTitle: 'Obrigado pela sua Avaliação | InovaLab Cambará',
    seoDescription: 'Sua opinião é fundamental para mantermos nosso atendimento humanizado e nossa agilidade técnica.',
    seoKeywords: 'avaliar inovalab, opinião inovalab, reclamação inovalab, sugestão laboratório cambará',
    canonicalPath: '/avaliar'
  });
});

// ================= ENDPOINTS DE API (AJAX) =================

// Busca dinâmica de exames (JSON)
router.get('/api/exames', (req, res) => {
  const query = req.query.q ? req.query.q.toString().toLowerCase() : '';
  const exams = loadExams();
  const filtered = exams.filter(exam => 
    exam.name.toLowerCase().includes(query) || 
    exam.category.toLowerCase().includes(query) ||
    exam.instructions.toLowerCase().includes(query)
  );
  res.json(filtered);
});

// Registrar clique no botão "Avaliar no Google 5 Estrelas"
router.post('/api/avaliar/google-click', (req, res) => {
  const { evaluationId } = req.body;
  if (!evaluationId) {
    return res.status(400).json({ error: 'ID da avaliação não fornecido.' });
  }

  const evaluations = loadEvaluations();
  const index = evaluations.findIndex(e => String(e.id) === String(evaluationId));
  if (index >= 0) {
    evaluations[index].googleClicked = true;
    saveEvaluations(evaluations);
    return res.json({ success: true, message: 'Clique no Google registrado com sucesso.' });
  }

  return res.status(404).json({ error: 'Avaliação não encontrada.' });
});

// Gerar link de avaliação anonimizado com hash de 20 dígitos
router.post('/api/avaliar/gerar-link', (req, res) => {
  const { patientCode, patientName } = req.body;
  if (!patientCode) {
    return res.status(400).json({ error: 'Código de paciente não fornecido.' });
  }

  const cleanCode = String(patientCode).trim();
  const cleanName = String(patientName || '').trim();
  const hash = getOrCreateHashForPatient(cleanCode, cleanName);
  const domain = `${req.protocol}://${req.get('host')}`;
  const link = `${domain}/avaliar/${hash}`;

  return res.json({
    success: true,
    patientCode: cleanCode,
    patientName: cleanName,
    hash: hash,
    link: link
  });
});

// Obter hash para um código de paciente (ou criar se não existir)
router.post('/api/avaliar/obter-hash', (req, res) => {
  const { patientCode, patientName } = req.body;
  if (!patientCode) {
    return res.status(400).json({ error: 'Código de paciente não fornecido.' });
  }

  const cleanCode = String(patientCode).trim();
  const cleanName = String(patientName || '').trim();
  const hash = getOrCreateHashForPatient(cleanCode, cleanName);
  const storedName = getNameFromHashOrCode(hash);

  return res.json({
    success: true,
    patientCode: cleanCode,
    patientName: storedName,
    hash: hash
  });
});

// Atualizar os templates de mensagem
router.post('/api/avaliar/save-templates', requireAdmin, (req, res) => {
  const { invite, reminder, resultReady } = req.body;
  if (!invite || !reminder) {
    return res.status(400).json({ error: 'Os templates de convite e cobrança são obrigatórios.' });
  }

  const templates = { invite, reminder };
  if (resultReady !== undefined) {
    templates.resultReady = resultReady;
  }

  const success = saveMessageTemplates(templates);
  if (success) {
    return res.json({ success: true, message: 'Templates de mensagem salvos com sucesso!' });
  } else {
    return res.status(500).json({ error: 'Erro ao salvar os templates no servidor.' });
  }
});

// --- SUB-MÓDULO: RECURSOS HUMANOS & FINANÇAS DE COLABORADORES (ADMIN) ---

// Escala & Planejamento de Férias (Timeline / Calendário)
router.get('/admin/financeiro/ferias', requireAdmin, (req, res) => {
  const professionals = loadProfessionals();
  let changed = false;
  professionals.forEach(prof => {
    if (prof.admissionDate) {
      const calc = computeCltVacationData(prof.admissionDate, prof.faltas || 0, prof.diasGozados || 0);
      if (calc) {
        if (!prof.vencidaEm || prof.vencidaEm === '-') { prof.vencidaEm = calc.vencidaEm; changed = true; }
        if (prof.diasDireito === undefined || prof.diasDireito === 0) { prof.diasDireito = calc.diasDireito; changed = true; }
        if (prof.saldoAGozar === undefined) { prof.saldoAGozar = calc.saldoAGozar; changed = true; }
        if (!prof.concederAvisoAte) { prof.concederAvisoAte = calc.concederAvisoAte; changed = true; }
        if (!prof.proximoVencimento) { prof.proximoVencimento = calc.proximoVencimento; changed = true; }
      }
    }
  });
  if (changed) {
    saveProfessionals(professionals);
  }

  const selectedYear = req.query.year || '2026';
  const selectedSector = req.query.sector || 'Todos';

  const sectorsSet = new Set();
  professionals.forEach(p => {
    if (p.sector) sectorsSet.add(p.sector);
  });
  const sectors = Array.from(sectorsSet).sort();

  res.render('admin/financeiro/ferias', {
    page: 'admin-rh-ferias',
    professionals,
    selectedYear,
    selectedSector,
    sectors,
    computeAllVacationPeriods,
    userPermissions: req.userPermissions,
    user: req.adminUser
  });
});

router.get('/admin/financeiro/rh', requireAdmin, (req, res) => {
  const professionals = loadProfessionals();
  const selectedProfId = req.query.profId || (professionals.length > 0 ? professionals[0].id : '');
  const selectedProf = professionals.find(p => p.id === selectedProfId);

  // Calcular estatísticas da folha do mês corrente (Julho de 2026 como base)
  let totalSalaries = 0;
  let totalOvertime = 0;
  let totalShiftsPay = 0;
  let totalBenefits = 0;
  let totalTaxes = 0;

  // Setor / Departamentos stats
  const sectorSalaries = {};
  const sectorCounts = {};

  professionals.forEach(p => {
    const base = (p.salaryData && p.salaryData.baseSalary) ? Number(p.salaryData.baseSalary) : 0;
    totalSalaries += base;

    // Calcular estatísticas por setor
    const sector = p.sector || 'Geral';
    sectorSalaries[sector] = (sectorSalaries[sector] || 0) + base;
    sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;

    // Horas Extras e Plantões do mês corrente "2026-07"
    if (p.financialEvents) {
      p.financialEvents.forEach(evt => {
        if (evt.month === '2026-07') {
          const val = Number(evt.value) || 0;
          if (evt.type === 'provento') {
            if (evt.category === 'Horas Extras') totalOvertime += val;
            else if (evt.category === 'Plantões') totalShiftsPay += val;
            else if (evt.category === 'Vale Transporte' || evt.category === 'Convênios') totalBenefits += val;
          } else {
            // Descontos de benefícios
            if (evt.category === 'Vale Transporte' || evt.category === 'Convênios') totalBenefits += val;
          }
        }
      });
    }
  });

  // Encargos estimados (eg. 34.8% de encargos patronais estimados sobre salário base)
  totalTaxes = Math.round(totalSalaries * 0.348);
  const totalCost = totalSalaries + totalOvertime + totalShiftsPay + totalBenefits + totalTaxes;

  const hrStats = {
    totalSalaries,
    totalOvertime,
    totalShiftsPay,
    totalBenefits,
    totalTaxes,
    totalCost,
    sectorSalaries,
    sectorCounts
  };

  res.render('admin/financeiro/rh', {
    professionals,
    selectedProf,
    selectedProfId,
    stats: hrStats,
    page: 'admin-financeiro-rh',
    error: req.query.error || null,
    success: req.query.success || null
  });
});

// Atualizar Dados Salariais & Chave PIX e Registrar Reajustes
router.post('/admin/financeiro/rh/update-salary', requireAdmin, (req, res) => {
  const { profId, baseSalary, role, categoryFloor, type, bank, agency, account, pixKey, reason } = req.body;
  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => p.id === profId);

  if (index !== -1) {
    const prof = professionals[index];
    const oldSalary = (prof.salaryData && prof.salaryData.baseSalary) ? Number(prof.salaryData.baseSalary) : 0;
    const newSalary = Number(baseSalary) || 0;

    // Se houve mudança no salário, salva no histórico de reajustes
    if (oldSalary > 0 && oldSalary !== newSalary) {
      if (!prof.adjustments) prof.adjustments = [];
      prof.adjustments.push({
        date: new Date().toLocaleDateString('pt-BR'),
        originalSalary: oldSalary,
        newSalary: newSalary,
        reason: reason || 'Reajuste Salarial'
      });
    }

    prof.salaryData = {
      baseSalary: newSalary,
      role: role || prof.role || '',
      lastAdjustmentDate: oldSalary !== newSalary ? new Date().toISOString().split('T')[0] : (prof.salaryData && prof.salaryData.lastAdjustmentDate || ''),
      categoryFloor: Number(categoryFloor) || 0,
      type: type || 'Mensalista',
      bank: bank || '',
      agency: agency || '',
      account: account || '',
      pixKey: pixKey || ''
    };

    saveProfessionals(professionals);
    res.redirect(`/admin/financeiro/rh?success=salary_updated&profId=${profId}`);
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// Adicionar Evento Financeiro Variável
router.post('/admin/financeiro/rh/add-event', requireAdmin, (req, res) => {
  const { profId, month, type, category, value, description } = req.body;
  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => p.id === profId);

  if (index !== -1) {
    const prof = professionals[index];
    if (!prof.financialEvents) prof.financialEvents = [];
    
    prof.financialEvents.push({
      month: month || '2026-07',
      type: type || 'provento',
      category: category || 'Outros',
      value: Number(value) || 0,
      description: description || ''
    });

    saveProfessionals(professionals);
    res.redirect(`/admin/financeiro/rh?success=event_added&profId=${profId}`);
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// Deletar Evento Financeiro Variável
router.get('/admin/financeiro/rh/delete-event/:profId/:index', requireAdmin, (req, res) => {
  const { profId, index } = req.params;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => p.id === profId);

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.financialEvents && prof.financialEvents[index]) {
      prof.financialEvents.splice(index, 1);
      saveProfessionals(professionals);
      res.redirect(`/admin/financeiro/rh?success=event_deleted&profId=${profId}`);
    } else {
      res.redirect(`/admin/financeiro/rh?error=event_not_found&profId=${profId}`);
    }
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// Adicionar Holerite
router.post('/admin/financeiro/rh/add-paystub', requireAdmin, (req, res) => {
  const { profId, month, payDate, status } = req.body;
  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => p.id === profId);

  if (index !== -1) {
    const prof = professionals[index];
    if (!prof.paystubs) prof.paystubs = [];

    prof.paystubs.push({
      month: month || '2026-07',
      fileUrl: '#',
      receiptUrl: '#',
      payDate: payDate || '',
      status: status || 'Pendente',
      signed: false
    });

    saveProfessionals(professionals);
    res.redirect(`/admin/financeiro/rh?success=paystub_added&profId=${profId}`);
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// Deletar Holerite
router.get('/admin/financeiro/rh/delete-paystub/:profId/:index', requireAdmin, (req, res) => {
  const { profId, index } = req.params;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => p.id === profId);

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.paystubs && prof.paystubs[index]) {
      prof.paystubs.splice(index, 1);
      saveProfessionals(professionals);
      res.redirect(`/admin/financeiro/rh?success=paystub_deleted&profId=${profId}`);
    } else {
      res.redirect(`/admin/financeiro/rh?error=paystub_not_found&profId=${profId}`);
    }
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// Adicionar Férias
router.post('/admin/financeiro/rh/add-vacation', requireAdmin, (req, res) => {
  const { profId, aquisitivePeriod, concessivePeriod, startDate, endDate, abono, abonoDays, amountPaid, status, redirectUrl } = req.body;
  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => String(p.id) === String(profId));

  if (index !== -1) {
    const prof = professionals[index];
    if (!prof.vacations) prof.vacations = [];

    let parsedAbonoDays = Number(abonoDays) || 0;
    if (!parsedAbonoDays && abono && typeof abono === 'string') {
      const match = abono.match(/\d+/);
      if (match) parsedAbonoDays = parseInt(match[0], 10);
      else if (abono === 'Sim' || abono.toLowerCase().includes('sim')) parsedAbonoDays = 10;
    }

    // Validar se os dias solicitados + abono ultrapassam o saldo máximo do período
    let requestedDays = 0;
    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        requestedDays = Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1;
      }
    }

    const totalDaysToDebit = requestedDays + parsedAbonoDays;

    if (totalDaysToDebit > 0) {
      let gozadaDaysInPeriod = 0;
      if (aquisitivePeriod && prof.vacations.length > 0) {
        prof.vacations.forEach(v => {
          if (v.aquisitivePeriod === aquisitivePeriod && (v.status === 'Gozadas' || v.status === 'Em Gozo')) {
            let vAbono = Number(v.abonoDays) || 0;
            if (!vAbono && v.abono && typeof v.abono === 'string') {
              const m = v.abono.match(/\d+/);
              if (m) vAbono = parseInt(m[0], 10);
              else if (v.abono.toLowerCase().includes('sim')) vAbono = 10;
            }
            if (v.startDate && v.endDate) {
              const vs = new Date(v.startDate);
              const ve = new Date(v.endDate);
              if (!isNaN(vs.getTime()) && !isNaN(ve.getTime())) {
                gozadaDaysInPeriod += (Math.ceil((ve - vs) / (1000 * 60 * 60 * 24)) + 1) + vAbono;
              }
            } else if (vAbono > 0) {
              gozadaDaysInPeriod += vAbono;
            }
          }
        });
      }

      let faltas = Number(prof.faltas) || 0;
      let diasDireito = 30;
      if (faltas > 32) diasDireito = 0;
      else if (faltas >= 24) diasDireito = 12;
      else if (faltas >= 15) diasDireito = 18;
      else if (faltas >= 6) diasDireito = 24;

      const maxAvailable = Math.max(0, diasDireito - gozadaDaysInPeriod);

      if (totalDaysToDebit > maxAvailable) {
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
          return res.status(400).json({ error: `Dias solicitados/vendidos (${totalDaysToDebit}d) excedem o saldo disponível (${maxAvailable}d)` });
        }
        const targetRedir = redirectUrl || '/admin/financeiro/ferias';
        const sep = targetRedir.includes('?') ? '&' : '?';
        return res.redirect(`${targetRedir}${sep}error=exceeds_balance&requested=${totalDaysToDebit}&max=${maxAvailable}`);
      }
    }

    const newVacation = {
      id: Date.now().toString(),
      aquisitivePeriod: aquisitivePeriod || '',
      concessivePeriod: concessivePeriod || '',
      startDate: startDate || '',
      endDate: endDate || '',
      abono: abono || (parsedAbonoDays > 0 ? `Sim (${parsedAbonoDays} dias)` : 'Não'),
      abonoDays: parsedAbonoDays,
      amountPaid: Number(amountPaid) || 0,
      status: status || 'Planejada'
    };

    prof.vacations.push(newVacation);

    saveProfessionals(professionals);

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ success: true, vacation: newVacation });
    }

    const targetRedirect = redirectUrl || `/admin/financeiro/rh?success=vacation_added&profId=${profId}`;
    res.redirect(targetRedirect);
  } else {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(404).json({ error: 'Profissional não encontrado' });
    }
    res.redirect(redirectUrl || '/admin/financeiro/rh?error=prof_not_found');
  }
});

// Confirmar Baixa de Férias (Mudar status para 'Gozadas' e atualizar saldo)
router.post('/admin/financeiro/rh/confirm-baixa-vacation', requireAdmin, (req, res) => {
  const { profId, vacationId, vacationIndex, redirectUrl } = req.body;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => String(p.id) === String(profId));

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.vacations && prof.vacations.length > 0) {
      let vIdx = -1;
      if (vacationId) {
        vIdx = prof.vacations.findIndex(v => String(v.id) === String(vacationId));
      }
      if (vIdx === -1 && vacationIndex !== undefined && vacationIndex !== '') {
        const idx = Number(vacationIndex);
        if (!isNaN(idx) && idx >= 0 && idx < prof.vacations.length) {
          vIdx = idx;
        }
      }

      if (vIdx !== -1) {
        prof.vacations[vIdx].status = 'Gozadas';

        // Recalcular dias gozados e saldo a gozar do profissional
        let gozadaDays = 0;
        prof.vacations.forEach(v => {
          if (v.startDate && v.endDate && (v.status === 'Gozadas' || v.status === 'Em Gozo')) {
            const s = new Date(v.startDate);
            const e = new Date(v.endDate);
            if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
              const diffDays = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
              gozadaDays += diffDays;
            }
          }
        });
        prof.diasGozados = gozadaDays;
        prof.saldoAGozar = Math.max(0, (prof.diasDireito !== undefined ? prof.diasDireito : 30) - gozadaDays);

        saveProfessionals(professionals);

        if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
          return res.json({ success: true, message: 'Baixa efetuada com sucesso! As férias foram marcadas como Gozadas e o saldo foi atualizado.', vacation: prof.vacations[vIdx] });
        }
        return res.redirect(redirectUrl || `/admin/financeiro/ferias?success=vacation_baixa`);
      }
    }
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(404).json({ error: 'Férias ou profissional não encontrado' });
  }
  return res.redirect(redirectUrl || '/admin/financeiro/ferias?error=vacation_not_found');
});

router.get('/admin/financeiro/rh/confirm-baixa-vacation/:profId/:vacationIndex', requireAdmin, (req, res) => {
  const { profId, vacationIndex } = req.params;
  const redirectUrl = req.query.redirectUrl || `/admin/financeiro/ferias?success=vacation_baixa`;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => String(p.id) === String(profId));

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.vacations && prof.vacations.length > 0) {
      let vIdx = prof.vacations.findIndex(v => String(v.id) === String(vacationIndex));
      if (vIdx === -1) {
        const numericIdx = Number(vacationIndex);
        if (!isNaN(numericIdx) && numericIdx >= 0 && numericIdx < prof.vacations.length) {
          vIdx = numericIdx;
        }
      }

      if (vIdx !== -1) {
        prof.vacations[vIdx].status = 'Gozadas';

        let gozadaDays = 0;
        prof.vacations.forEach(v => {
          if (v.startDate && v.endDate && (v.status === 'Gozadas' || v.status === 'Em Gozo')) {
            const s = new Date(v.startDate);
            const e = new Date(v.endDate);
            if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
              const diffDays = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
              gozadaDays += diffDays;
            }
          }
        });
        prof.diasGozados = gozadaDays;
        prof.saldoAGozar = Math.max(0, (prof.diasDireito !== undefined ? prof.diasDireito : 30) - gozadaDays);

        saveProfessionals(professionals);
        return res.redirect(redirectUrl);
      }
    }
  }

  return res.redirect('/admin/financeiro/ferias?error=vacation_not_found');
});

// Deletar / Remover Agendamento de Férias (POST e GET)
router.post('/admin/financeiro/rh/delete-vacation', requireAdmin, (req, res) => {
  const { profId, vacationId, vacationIndex, redirectUrl } = req.body;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => String(p.id) === String(profId));

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.vacations && prof.vacations.length > 0) {
      let vIdx = -1;
      if (vacationId) {
        vIdx = prof.vacations.findIndex(v => String(v.id) === String(vacationId));
      }
      if (vIdx === -1 && vacationIndex !== undefined && vacationIndex !== '') {
        const idx = Number(vacationIndex);
        if (!isNaN(idx) && idx >= 0 && idx < prof.vacations.length) {
          vIdx = idx;
        }
      }

      if (vIdx !== -1) {
        prof.vacations.splice(vIdx, 1);

        // Recalcular saldo e dias gozados
        let gozadaDays = 0;
        prof.vacations.forEach(v => {
          if (v.startDate && v.endDate && (v.status === 'Gozadas' || v.status === 'Em Gozo')) {
            const s = new Date(v.startDate);
            const e = new Date(v.endDate);
            if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
              const diffDays = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
              gozadaDays += diffDays;
            }
          }
        });
        prof.diasGozados = gozadaDays;
        prof.saldoAGozar = Math.max(0, (prof.diasDireito !== undefined ? prof.diasDireito : 30) - gozadaDays);

        saveProfessionals(professionals);

        if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
          return res.json({ success: true, message: 'Agendamento de férias removido com sucesso!' });
        }
        return res.redirect(redirectUrl || `/admin/financeiro/ferias?success=vacation_deleted`);
      }
    }
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(404).json({ error: 'Férias ou profissional não encontrado' });
  }
  return res.redirect(redirectUrl || '/admin/financeiro/ferias?error=vacation_not_found');
});

router.get('/admin/financeiro/rh/delete-vacation/:profId/:vacationIndex', requireAdmin, (req, res) => {
  const { profId, vacationIndex } = req.params;
  const redirectUrl = req.query.redirectUrl || `/admin/financeiro/ferias?success=vacation_deleted`;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => String(p.id) === String(profId));

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.vacations && prof.vacations.length > 0) {
      let vIdx = prof.vacations.findIndex(v => String(v.id) === String(vacationIndex));
      if (vIdx === -1) {
        const numericIdx = Number(vacationIndex);
        if (!isNaN(numericIdx) && numericIdx >= 0 && numericIdx < prof.vacations.length) {
          vIdx = numericIdx;
        }
      }

      if (vIdx !== -1) {
        prof.vacations.splice(vIdx, 1);

        let gozadaDays = 0;
        prof.vacations.forEach(v => {
          if (v.startDate && v.endDate && (v.status === 'Gozadas' || v.status === 'Em Gozo')) {
            const s = new Date(v.startDate);
            const e = new Date(v.endDate);
            if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
              const diffDays = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
              gozadaDays += diffDays;
            }
          }
        });
        prof.diasGozados = gozadaDays;
        prof.saldoAGozar = Math.max(0, (prof.diasDireito !== undefined ? prof.diasDireito : 30) - gozadaDays);

        saveProfessionals(professionals);
        return res.redirect(redirectUrl);
      }
    }
  }

  return res.redirect('/admin/financeiro/ferias?error=vacation_not_found');
});

// Atualizar Dados do Relatório Contábil de Férias
router.post('/admin/financeiro/rh/update-accounting-vacation', requireAdmin, (req, res) => {
  const { profId, code, vencidaEm, faltas, diasDireito, diasGozados, saldoAGozar, concederAvisoAte, proximoVencimento, redirectUrl } = req.body;
  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => String(p.id) === String(profId));

  if (index !== -1) {
    const prof = professionals[index];
    if (code !== undefined) prof.code = Number(code) || prof.code;
    if (vencidaEm !== undefined) prof.vencidaEm = vencidaEm;
    if (faltas !== undefined) prof.faltas = Number(faltas) || 0;
    if (diasDireito !== undefined) prof.diasDireito = Number(diasDireito) || 0;
    if (diasGozados !== undefined) prof.diasGozados = Number(diasGozados) || 0;
    if (saldoAGozar !== undefined) prof.saldoAGozar = Number(saldoAGozar) || 0;
    if (concederAvisoAte !== undefined) prof.concederAvisoAte = concederAvisoAte;
    if (proximoVencimento !== undefined) prof.proximoVencimento = proximoVencimento;

    saveProfessionals(professionals);

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ success: true, professional: prof });
    }

    return res.redirect(redirectUrl || '/admin/financeiro/ferias?success=accounting_updated');
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(404).json({ error: 'Profissional não encontrado' });
  }
  return res.redirect(redirectUrl || '/admin/financeiro/ferias?error=prof_not_found');
});

// Recalcular Férias Automaticamente pela Data de Admissão (CLT)
router.post('/admin/financeiro/rh/recalculate-all-vacations', requireAdmin, (req, res) => {
  const professionals = loadProfessionals();
  let updatedCount = 0;

  professionals.forEach(prof => {
    if (prof.admissionDate) {
      const periods = computeAllVacationPeriods(prof);
      if (periods && periods.length > 0) {
        // Pega os dados do último período vencido ou mais urgente
        const vencidos = periods.filter(p => p.isVencida);
        const refPeriod = vencidos.length > 0 ? vencidos[vencidos.length - 1] : periods[0];
        if (refPeriod) {
          prof.vencidaEm = refPeriod.vencidaEm;
          prof.diasDireito = refPeriod.diasDireito;
          prof.saldoAGozar = refPeriod.saldoAGozar;
          prof.concederAvisoAte = refPeriod.concederAvisoAte;
          prof.proximoVencimento = refPeriod.proximoVencimento;
          updatedCount++;
        }
      }
    }
  });

  saveProfessionals(professionals);

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.json({ success: true, updatedCount });
  }

  return res.redirect('/admin/financeiro/ferias?success=recalculated_all');
});

function calculateAccruedAvos(startPeriod, today, endPeriod) {
  if (!startPeriod || !today) return 0;
  if (today >= endPeriod) return 12;
  if (today < startPeriod) return 0;

  let avos = 0;
  let curr = new Date(startPeriod.getFullYear(), startPeriod.getMonth(), startPeriod.getDate());

  while (avos < 12) {
    let origDay = curr.getDate();
    let nextM = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
    let maxDaysInNext = new Date(nextM.getFullYear(), nextM.getMonth() + 1, 0).getDate();
    nextM.setDate(Math.min(origDay, maxDaysInNext));

    if (today >= nextM) {
      avos++;
      curr = nextM;
    } else {
      let diffMs = today.getTime() - curr.getTime();
      let diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays >= 14) {
        avos++;
      }
      break;
    }
  }

  return Math.min(12, avos);
}

function computeAllVacationPeriods(prof, todayDateStr = '2026-07-22') {
  if (!prof || !prof.admissionDate) {
    let fallbackPlanned = 0;
    if (prof && prof.vacations && prof.vacations.length > 0) {
      prof.vacations.forEach(v => {
        if (v.startDate && v.endDate && v.status !== 'Gozadas' && v.status !== 'Em Gozo') {
          const s = new Date(v.startDate);
          const e = new Date(v.endDate);
          if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
            fallbackPlanned += Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
          }
        }
      });
    }
    return [{
      periodIndex: 0,
      aquisitivePeriod: prof && prof.vencidaEm ? `Até ${prof.vencidaEm}` : 'Aquisitivo Atual',
      vencidaEm: (prof && prof.vencidaEm) || '-',
      faltas: (prof && prof.faltas) || 0,
      diasDireito: prof && prof.diasDireito !== undefined ? prof.diasDireito : 30,
      avosAcumulados: 12,
      diasAcumulados: prof && prof.diasDireito !== undefined ? prof.diasDireito : 30,
      diasGozados: (prof && prof.diasGozados) || 0,
      diasPlanejados: fallbackPlanned,
      saldoAGozar: prof && prof.saldoAGozar !== undefined ? prof.saldoAGozar : 30,
      concederAvisoAte: (prof && prof.concederAvisoAte) || '-',
      concederAvisoAteBr: prof && prof.concederAvisoAte ? prof.concederAvisoAte.split('-').reverse().join('/') : '-',
      proximoVencimento: (prof && prof.proximoVencimento) || '-',
      isVencida: true,
      isAtual: false,
      statusLabel: 'Férias Vencidas',
      vacations: (prof && prof.vacations) || []
    }];
  }

  let admDate;
  if (prof.admissionDate.includes('/')) {
    const parts = prof.admissionDate.split('/');
    admDate = new Date(parts[2], parts[1] - 1, parts[0]);
  } else {
    const parts = prof.admissionDate.split('-');
    admDate = new Date(parts[0], parts[1] - 1, parts[2]);
  }

  if (isNaN(admDate.getTime())) {
    return [];
  }

  const today = new Date(todayDateStr);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtBr = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const fmtIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const periods = [];
  let i = 0;

  while (true) {
    let startPeriod = new Date(admDate.getFullYear() + i, admDate.getMonth(), admDate.getDate());
    let endPeriod = new Date(admDate.getFullYear() + i + 1, admDate.getMonth(), admDate.getDate() - 1);

    if (startPeriod > today) {
      break;
    }

    const aquisitivePeriodStr = `${fmtBr(startPeriod)} a ${fmtBr(endPeriod)}`;

    let gozadaDays = 0;
    let plannedDays = 0;
    let registeredVacations = [];

    if (prof.vacations && prof.vacations.length > 0) {
      prof.vacations.forEach(v => {
        let matches = false;
        if (v.aquisitivePeriod && String(v.aquisitivePeriod).trim() !== '') {
          const startBrStr = fmtBr(startPeriod);
          const aqTrim = String(v.aquisitivePeriod).trim();
          if (aqTrim === aquisitivePeriodStr || aqTrim.includes(startBrStr)) {
            matches = true;
          }
        } else if (v.startDate) {
          let vStart = new Date(v.startDate);
          let concessiveEnd = new Date(endPeriod.getFullYear() + 1, endPeriod.getMonth(), endPeriod.getDate());
          if (vStart >= startPeriod && vStart <= concessiveEnd) {
            matches = true;
          }
        }

        if (matches) {
          registeredVacations.push(v);

          let vAbono = Number(v.abonoDays) || 0;
          if (!vAbono && v.abono && typeof v.abono === 'string') {
            const m = v.abono.match(/\d+/);
            if (m) vAbono = parseInt(m[0], 10);
            else if (v.abono.toLowerCase().includes('sim')) vAbono = 10;
          }

          if (v.startDate && v.endDate) {
            const s = new Date(v.startDate);
            const e = new Date(v.endDate);
            if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
              const diffDays = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
              if (v.status === 'Gozadas' || v.status === 'Em Gozo') {
                gozadaDays += diffDays + vAbono;
              } else {
                plannedDays += diffDays + vAbono;
              }
            }
          } else if (vAbono > 0) {
            if (v.status === 'Gozadas' || v.status === 'Em Gozo') {
              gozadaDays += vAbono;
            } else {
              plannedDays += vAbono;
            }
          }
        }
      });
    }

    let numFaltas = Number(prof.faltas) || 0;
    let diasDireitoTotal = 30;
    if (numFaltas > 32) diasDireitoTotal = 0;
    else if (numFaltas >= 24) diasDireitoTotal = 12;
    else if (numFaltas >= 15) diasDireitoTotal = 18;
    else if (numFaltas >= 6) diasDireitoTotal = 24;

    const isVencida = endPeriod <= today;
    const isAtual = startPeriod <= today && endPeriod > today;

    let avosAcumulados = 12;
    if (!isVencida) {
      avosAcumulados = calculateAccruedAvos(startPeriod, today, endPeriod);
    }

    let diasAcumulados = isVencida ? diasDireitoTotal : Math.min(diasDireitoTotal, Math.round(avosAcumulados * (diasDireitoTotal / 12)));

    let vencidaEm = '';
    let concederAvisoAteIso = '';
    let concederAvisoAteBr = '-';
    let proximoVencimentoBr = '-';

    if (isVencida) {
      vencidaEm = fmtBr(endPeriod);
      let concessiveEndDate = new Date(endPeriod.getFullYear() + 1, endPeriod.getMonth(), endPeriod.getDate());
      let concederAvisoDate = new Date(concessiveEndDate.getTime() - (60 * 24 * 60 * 60 * 1000));
      concederAvisoAteIso = fmtIso(concederAvisoDate);
      concederAvisoAteBr = fmtBr(concederAvisoDate);
      proximoVencimentoBr = fmtBr(concessiveEndDate);
    } else {
      vencidaEm = '-';
      proximoVencimentoBr = fmtBr(endPeriod);
    }

    let saldoAGozar = Math.max(0, diasAcumulados - gozadaDays);

    let statusLbl = 'Aquisitivo Atual (A Vencer)';
    if (saldoAGozar === 0 && isVencida) {
      statusLbl = 'Quitada';
    } else if (isVencida) {
      statusLbl = 'Férias Vencidas';
    }

    periods.push({
      periodIndex: i,
      aquisitivePeriod: aquisitivePeriodStr,
      startPeriod: fmtIso(startPeriod),
      endPeriod: fmtIso(endPeriod),
      vencidaEm: vencidaEm,
      faltas: numFaltas,
      diasDireito: diasDireitoTotal,
      avosAcumulados: avosAcumulados,
      diasAcumulados: diasAcumulados,
      diasGozados: gozadaDays,
      diasPlanejados: plannedDays,
      saldoAGozar: saldoAGozar,
      concederAvisoAte: concederAvisoAteIso,
      concederAvisoAteBr: concederAvisoAteBr,
      proximoVencimento: proximoVencimentoBr,
      isVencida: isVencida,
      isAtual: isAtual,
      statusLabel: statusLbl,
      vacations: registeredVacations
    });

    i++;
    if (i > 30) break;
  }

  // Filtrar períodos relevantes para exibição
  if (periods.length > 2) {
    const relevant = periods.filter(p => p.isAtual || (p.isVencida && (p.saldoAGozar > 0 || p.vacations.length > 0)));
    if (relevant.length >= 2) {
      return relevant;
    }
    return periods.slice(-2);
  }

  return periods;
}

function computeCltVacationData(admissionDateStr, faltas = 0, diasGozados = 0) {
  const dummyProf = { admissionDate: admissionDateStr, faltas: faltas, diasGozados: diasGozados };
  const periods = computeAllVacationPeriods(dummyProf);
  if (!periods || periods.length === 0) return null;
  const vencidos = periods.filter(p => p.isVencida);
  const ref = vencidos.length > 0 ? vencidos[vencidos.length - 1] : periods[0];
  return {
    vencidaEm: ref.vencidaEm,
    diasDireito: ref.diasDireito,
    diasGozados: ref.diasGozados,
    saldoAGozar: ref.saldoAGozar,
    concederAvisoAte: ref.concederAvisoAte,
    concederAvisoAteBr: ref.concederAvisoAteBr,
    proximoVencimento: ref.proximoVencimento
  };
}

// Editar Férias
router.post('/admin/financeiro/rh/edit-vacation', requireAdmin, (req, res) => {
  const { profId, vacationIndex, aquisitivePeriod, concessivePeriod, startDate, endDate, abono, amountPaid, status, redirectUrl } = req.body;
  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => String(p.id) === String(profId));

  if (index !== -1) {
    const prof = professionals[index];
    if (!prof.vacations) prof.vacations = [];
    const vIdx = parseInt(vacationIndex, 10);

    if (prof.vacations[vIdx] !== undefined) {
      prof.vacations[vIdx] = {
        ...prof.vacations[vIdx],
        aquisitivePeriod: aquisitivePeriod || prof.vacations[vIdx].aquisitivePeriod || '',
        concessivePeriod: concessivePeriod || prof.vacations[vIdx].concessivePeriod || '',
        startDate: startDate || prof.vacations[vIdx].startDate || '',
        endDate: endDate || prof.vacations[vIdx].endDate || '',
        abono: abono || prof.vacations[vIdx].abono || 'Não',
        amountPaid: amountPaid !== undefined ? Number(amountPaid) : (prof.vacations[vIdx].amountPaid || 0),
        status: status || prof.vacations[vIdx].status || 'Planejada'
      };

      let gozadaDays = 0;
      prof.vacations.forEach(v => {
        if (v.startDate && v.endDate && (v.status === 'Gozadas' || v.status === 'Em Gozo')) {
          const s = new Date(v.startDate);
          const e = new Date(v.endDate);
          if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
            const diffDays = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
            gozadaDays += diffDays;
          }
        }
      });
      prof.diasGozados = gozadaDays;
      prof.saldoAGozar = Math.max(0, (prof.diasDireito !== undefined ? prof.diasDireito : 30) - gozadaDays);

      saveProfessionals(professionals);

      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.json({ success: true, vacation: prof.vacations[vIdx] });
      }

      const targetRedirect = redirectUrl || `/admin/financeiro/rh?success=vacation_updated&profId=${profId}`;
      return res.redirect(targetRedirect);
    }
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(404).json({ error: 'Férias ou Profissional não encontrado' });
  }
  res.redirect(redirectUrl || '/admin/financeiro/rh?error=vacation_not_found');
});

// Deletar Férias
router.get('/admin/financeiro/rh/delete-vacation/:profId/:index', requireAdmin, (req, res) => {
  const { profId, index } = req.params;
  const redirectUrl = req.query.redirectUrl;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => p.id === profId);

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.vacations && prof.vacations[index]) {
      prof.vacations.splice(index, 1);
      saveProfessionals(professionals);

      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.json({ success: true });
      }

      const targetRedirect = redirectUrl || `/admin/financeiro/rh?success=vacation_deleted&profId=${profId}`;
      return res.redirect(targetRedirect);
    }
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(404).json({ error: 'Férias não encontradas' });
  }
  res.redirect(redirectUrl || '/admin/financeiro/rh?error=prof_not_found');
});

// Adicionar Afastamento
router.post('/admin/financeiro/rh/add-leave', requireAdmin, (req, res) => {
  const { profId, type, startDate, endDate, adminReason, status } = req.body;
  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => p.id === profId);

  if (index !== -1) {
    const prof = professionals[index];
    if (!prof.leaves) prof.leaves = [];

    prof.leaves.push({
      type: type || 'Outros',
      startDate: startDate || '',
      endDate: endDate || '',
      adminReason: adminReason || '',
      status: status || 'Aprovado'
    });

    saveProfessionals(professionals);
    res.redirect(`/admin/financeiro/rh?success=leave_added&profId=${profId}`);
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// Deletar Afastamento
router.get('/admin/financeiro/rh/delete-leave/:profId/:index', requireAdmin, (req, res) => {
  const { profId, index } = req.params;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => p.id === profId);

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.leaves && prof.leaves[index]) {
      prof.leaves.splice(index, 1);
      saveProfessionals(professionals);
      res.redirect(`/admin/financeiro/rh?success=leave_deleted&profId=${profId}`);
    } else {
      res.redirect(`/admin/financeiro/rh?error=leave_not_found&profId=${profId}`);
    }
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// Adicionar Plantão para Escala
router.post('/admin/financeiro/rh/add-shift', requireAdmin, (req, res) => {
  const { profId, date, type, description } = req.body;
  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => p.id === profId);

  if (index !== -1) {
    const prof = professionals[index];
    if (!prof.shifts) prof.shifts = [];

    prof.shifts.push({
      date: date || '',
      type: type || 'Plantão Regular',
      description: description || ''
    });

    saveProfessionals(professionals);
    res.redirect(`/admin/financeiro/rh?success=shift_added&profId=${profId}`);
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// Deletar Plantão da Escala
router.get('/admin/financeiro/rh/delete-shift/:profId/:index', requireAdmin, (req, res) => {
  const { profId, index } = req.params;
  const professionals = loadProfessionals();
  const pIndex = professionals.findIndex(p => p.id === profId);

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.shifts && prof.shifts[index]) {
      prof.shifts.splice(index, 1);
      saveProfessionals(professionals);
      res.redirect(`/admin/financeiro/rh?success=shift_deleted&profId=${profId}`);
    } else {
      res.redirect(`/admin/financeiro/rh?error=shift_not_found&profId=${profId}`);
    }
  } else {
    res.redirect('/admin/financeiro/rh?error=prof_not_found');
  }
});

// --- SUB-MÓDULO: ESCALA DE PLANTÃO PARA O PRONTO SOCORRO ---

router.get('/admin/financeiro/escala-plantao', requireAdmin, (req, res) => {
  const professionals = loadProfessionals();
  const escala = loadEscalaPlantao();
  
  res.render('admin/financeiro/escala-plantao', {
    escala,
    professionals,
    page: 'admin-escala-plantao',
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/admin/financeiro/escala-plantao/save', requireAdmin, (req, res) => {
  try {
    const { year, months, groups, assignments, notices } = req.body;
    
    const escala = {
      year: parseInt(year) || 2026,
      months: Array.isArray(months) ? months.map(m => parseInt(m)) : [parseInt(months)],
      groups: Array.isArray(groups) ? groups : [],
      assignments: assignments || {},
      notices: Array.isArray(notices) ? notices : []
    };
    
    saveEscalaPlantao(escala);
    
    res.json({ success: true, message: 'Escala de plantão salva com sucesso!' });
  } catch (error) {
    console.error("Erro ao salvar escala de plantão:", error);
    res.status(500).json({ success: false, error: 'Erro interno ao salvar escala de plantão.' });
  }
});

// --- SUB-MÓDULO: ÁREA DO COLABORADOR / MEU RH (PORTAL INDIVIDUAL) ---

router.get('/admin/meu-rh', requireAdmin, (req, res) => {
  const professionals = loadProfessionals();
  let profId = req.cookies.admin_professional_id || 'admin';
  
  // Se for o administrador geral, permite simular qualquer profissional para visualização/teste fácil
  if (profId === 'admin') {
    profId = req.query.simulateId || (professionals.length > 0 ? professionals[0].id : '1');
  }

  const professional = professionals.find(p => p.id === profId);

  if (!professional) {
    return res.redirect('/admin?error=prof_not_found');
  }

  const isSimulation = (req.cookies.admin_professional_id === 'admin' || !req.cookies.admin_professional_id);

  res.render('admin/financeiro/meu-rh', {
    professional,
    professionals, // Para fins de simulação se for o admin
    simulation: isSimulation,
    page: 'admin-meu-rh',
    error: req.query.error || null,
    success: req.query.success || null
  });
});

// Registrar Ponto (Timesheet)
router.post('/admin/meu-rh/bater-ponto', requireAdmin, (req, res) => {
  const { entry, breakStart, breakEnd, exit } = req.body;
  const professionals = loadProfessionals();
  let profId = req.cookies.admin_professional_id || 'admin';

  if (profId === 'admin') {
    profId = req.body.simulateId || '1';
  }

  const index = professionals.findIndex(p => p.id === profId);

  if (index !== -1) {
    const prof = professionals[index];
    if (!prof.timesheet) prof.timesheet = [];

    // Calcular o total de horas trabalhadas no dia
    let totalMinutes = 0;
    if (entry && exit) {
      const [hEntry, mEntry] = entry.split(':').map(Number);
      const [hExit, mExit] = exit.split(':').map(Number);
      const startMin = hEntry * 60 + mEntry;
      const endMin = hExit * 60 + mExit;
      
      let breakMin = 60; // default 1 hora de intervalo
      if (breakStart && breakEnd) {
        const [hBS, mBS] = breakStart.split(':').map(Number);
        const [hBE, mBE] = breakEnd.split(':').map(Number);
        breakMin = (hBE * 60 + mBE) - (hBS * 60 + mBS);
      }
      
      totalMinutes = (endMin - startMin) - breakMin;
    }

    const workedHoursStr = totalMinutes > 0 
      ? `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`
      : '0h 00m';

    // Saldo com base em jornada de 8h (480 minutos)
    const expectedMinutes = 480;
    const balanceMinutes = totalMinutes - expectedMinutes;

    prof.timesheet.push({
      date: new Date().toLocaleDateString('pt-BR'),
      entry: entry || '08:00',
      breakStart: breakStart || '12:00',
      breakEnd: breakEnd || '13:00',
      exit: exit || '17:00',
      totalHours: workedHoursStr,
      balance: balanceMinutes // Saldo em minutos
    });

    saveProfessionals(professionals);
    res.redirect(`/admin/meu-rh?success=ponto_registrado${req.body.simulateId ? '&simulateId=' + req.body.simulateId : ''}`);
  } else {
    res.redirect('/admin/meu-rh?error=prof_not_found');
  }
});

// Assinar Holerite Eletronicamente
router.post('/admin/meu-rh/sign-paystub', requireAdmin, (req, res) => {
  const { paystubIndex } = req.body;
  const professionals = loadProfessionals();
  let profId = req.cookies.admin_professional_id || 'admin';

  if (profId === 'admin') {
    profId = req.body.simulateId || '1';
  }

  const pIndex = professionals.findIndex(p => p.id === profId);

  if (pIndex !== -1) {
    const prof = professionals[pIndex];
    if (prof.paystubs && prof.paystubs[paystubIndex]) {
      prof.paystubs[paystubIndex].signed = true;
      prof.paystubs[paystubIndex].signedAt = new Date().toISOString();
      prof.paystubs[paystubIndex].status = 'Pago';

      saveProfessionals(professionals);
      res.redirect(`/admin/meu-rh?success=signed${req.body.simulateId ? '&simulateId=' + req.body.simulateId : ''}`);
    } else {
      res.redirect(`/admin/meu-rh?error=paystub_not_found${req.body.simulateId ? '&simulateId=' + req.body.simulateId : ''}`);
    }
  } else {
    res.redirect('/admin/meu-rh?error=prof_not_found');
  }
});

// Endpoint administrativo para execução do script de limpeza de campos e colunas obsoletas
router.post('/api/admin/clean-obsolete-fields', async (req, res) => {
  try {
    const result = await cleanObsoleteDatabaseFields();
    res.json({
      success: true,
      message: 'Script de limpeza executado com sucesso!',
      details: result
    });
  } catch (err) {
    console.error("Erro ao executar script de limpeza:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/admin/clean-obsolete-fields', async (req, res) => {
  try {
    const result = await cleanObsoleteDatabaseFields();
    res.json({
      success: true,
      message: 'Script de limpeza executado com sucesso!',
      details: result
    });
  } catch (err) {
    console.error("Erro ao executar script de limpeza:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= API DE IMPORTAÇÃO E PARÂMETROS DE EXAMES / LAUDO PREENCHIDO =================

function processApiExamResultPayload(reqBody) {
  const items = Array.isArray(reqBody.exames) ? reqBody.exames : (Array.isArray(reqBody.exams) ? reqBody.exams : [reqBody]);
  const results = [];
  const requisitions = loadRequisitions();
  const apiResultsLog = loadApiResults();

  for (const item of items) {
    const reqId = String(item.requisitionId || item.requisicaoId || item.requisicao || item.codigoRequisicao || item.protocolo || item.reqId || '').trim();
    const examCode = String(item.examCode || item.codigoExame || item.exame || item.codigo || item.examId || '').trim().toUpperCase();
    const resultVal = item.resultado !== undefined ? item.resultado : (item.result !== undefined ? item.result : item.valor);
    const refVal = item.valoresDeReferencia !== undefined ? item.valoresDeReferencia : (item.valorReferencia !== undefined ? item.valorReferencia : (item.referenceValue !== undefined ? item.referenceValue : (item.referencia || item.valRef)));
    const titleVal = item.titulo || item.tituloLaudo || item.nomeExame || item.examTitle || item.tituloResultado || item.nome;
    const unitVal = item.unidade || item.unit;
    const methodVal = item.metodo || item.method;
    const matVal = item.material;
    const equipVal = item.equipamento || item.equipment;
    const obsVal = item.observacoes || item.observations || item.interpretacao || item.interpretation || item.obs;
    const statusVal = item.status || 'Digitado';
    const patientName = item.patientName || item.nomePaciente || item.paciente || 'Paciente API';

    if (!reqId || !examCode) {
      results.push({
        success: false,
        requisitionId: reqId,
        examCode: examCode,
        message: 'Parâmetros obrigatórios ausentes: informe requisitionId (ou protocolo/requisicao) e examCode (ou codigoExame/exame).'
      });
      continue;
    }

    let targetReq = requisitions.find(r => 
      String(r.id || '').trim().toLowerCase() === reqId.toLowerCase() ||
      String(r.requisitionCode || '').replace(/^#/, '').trim().toLowerCase() === reqId.replace(/^#/, '').trim().toLowerCase() ||
      String(r.patientUsername || '').trim().toLowerCase() === reqId.toLowerCase()
    );

    if (!targetReq) {
      targetReq = {
        id: reqId,
        requisitionCode: reqId.startsWith('#') ? reqId : '#' + reqId,
        patientName: patientName,
        createdAt: new Date().toLocaleString('pt-BR'),
        status: statusVal === 'Liberado' ? 'Liberado' : 'Digitado',
        exams: []
      };
      requisitions.push(targetReq);
    }

    if (!Array.isArray(targetReq.exams)) {
      targetReq.exams = [];
    }

    let ex = targetReq.exams.find(e => 
      String(e.code || e.codigo || '').trim().toUpperCase() === examCode ||
      String(e.name || e.titulo || '').trim().toLowerCase() === (titleVal || '').trim().toLowerCase()
    );

    if (!ex) {
      ex = {
        code: examCode,
        codigo: examCode,
        name: titleVal || examCode,
        status: statusVal
      };
      targetReq.exams.push(ex);
    }

    if (resultVal !== undefined) {
      ex.result = String(resultVal);
      ex.resultado = String(resultVal);
    }
    if (refVal !== undefined) {
      ex.referenceValue = String(refVal);
      ex.valorReferencia = String(refVal);
      ex.valorReferenciaLaudo = String(refVal);
    }
    if (titleVal !== undefined && String(titleVal).trim()) {
      ex.tituloLaudo = String(titleVal).trim();
      ex.name = String(titleVal).trim();
      ex.titulo = String(titleVal).trim();
    }
    if (unitVal !== undefined) {
      ex.unit = String(unitVal);
      ex.unidade = String(unitVal);
    }
    if (methodVal !== undefined) {
      ex.method = String(methodVal);
      ex.metodo = String(methodVal);
    }
    if (matVal !== undefined) {
      ex.material = String(matVal);
    }
    if (equipVal !== undefined) {
      ex.equipment = String(equipVal);
      ex.equipamento = String(equipVal);
    }
    if (obsVal !== undefined) {
      ex.observations = String(obsVal);
      ex.observacoes = String(obsVal);
    }
    if (item.linhas !== undefined) {
      ex.linhas = item.linhas;
    }
    if (item.modeloLaudo !== undefined) {
      ex.modeloLaudo = item.modeloLaudo;
    }

    ex.status = statusVal;
    targetReq.pdfBase64 = null;
    targetReq.laudoPdfBase64 = null;
    targetReq.pdfDataUri = null;
    targetReq.pdfGeneratedAt = null;
    const nowIso = new Date().toISOString();
    ex.typedAt = nowIso;
    ex.typedBy = 'API Integration';
    ex.source = 'API';

    const logEntry = {
      id: 'API_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: nowIso,
      requisitionId: targetReq.requisitionCode || targetReq.id,
      patientName: targetReq.patientName || patientName,
      examCode: examCode,
      titulo: ex.tituloLaudo || ex.name || examCode,
      resultado: ex.result,
      valoresDeReferencia: ex.valorReferencia,
      unidade: ex.unidade || '',
      metodo: ex.metodo || '',
      material: ex.material || '',
      equipamento: ex.equipamento || '',
      observacoes: ex.observacoes || '',
      status: ex.status
    };
    apiResultsLog.unshift(logEntry);

    results.push({
      success: true,
      requisitionId: targetReq.requisitionCode || targetReq.id,
      examCode: examCode,
      examTitle: ex.tituloLaudo || ex.name,
      result: ex.result,
      referenceValue: ex.valorReferencia,
      status: ex.status,
      message: 'Parâmetros de exame e resultado armazenados com sucesso. Tela de edição preenchida!'
    });
  }

  saveRequisitions(requisitions);
  saveApiResults(apiResultsLog.slice(0, 500));

  return results;
}

router.post('/api/exames/resultado', (req, res) => {
  try {
    const results = processApiExamResultPayload(req.body);
    const hasFailures = results.some(r => !r.success);
    return res.status(hasFailures ? 270 : 200).json({
      success: !hasFailures,
      processedCount: results.length,
      data: results.length === 1 ? results[0] : results
    });
  } catch (err) {
    console.error('Erro no endpoint POST /api/exames/resultado:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/resultados/importar', (req, res) => {
  try {
    const results = processApiExamResultPayload(req.body);
    const hasFailures = results.some(r => !r.success);
    return res.status(hasFailures ? 270 : 200).json({
      success: !hasFailures,
      processedCount: results.length,
      data: results.length === 1 ? results[0] : results
    });
  } catch (err) {
    console.error('Erro no endpoint POST /api/resultados/importar:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/exames/resultado', (req, res) => {
  try {
    const logs = loadApiResults();
    const { requisitionId, examCode } = req.query;
    let filtered = logs;
    if (requisitionId) {
      const q = String(requisitionId).toLowerCase();
      filtered = filtered.filter(l => String(l.requisitionId || '').toLowerCase().includes(q));
    }
    if (examCode) {
      const q = String(examCode).toLowerCase();
      filtered = filtered.filter(l => String(l.examCode || '').toLowerCase().includes(q));
    }
    return res.json({ success: true, count: filtered.length, data: filtered });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint genérico para consulta direta e paginada de qualquer tabela no banco MySQL
router.get('/api/db/:table', async (req, res) => {
  try {
    const { table } = req.params;
    const { page = 1, limit = 50, search = '', searchCols, orderBy } = req.query;
    
    let cols = [];
    if (searchCols) {
      cols = typeof searchCols === 'string' ? searchCols.split(',') : searchCols;
    }

    const result = await queryTableFromMysql({
      table,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      search: search || '',
      searchCols: cols,
      orderBy: orderBy || 'order_index ASC'
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error(`Erro na rota GET /api/db/${req.params.table}:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Inicialização do Servidor

export default router;
