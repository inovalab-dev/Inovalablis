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

router.get('/admin/orcamentos', requireAdmin, (req, res) => {
  const exams = loadExams();
  const budgets = loadBudgets();
  const patients = loadPatients();
  const convenios = loadConvenios();
  const priceTables = loadPriceTables();
  
  res.render('admin/orcamentos', {
    exams: exams.sort((a, b) => a.name.localeCompare(b.name)),
    budgets: [...budgets].reverse(), // Mais recentes primeiro
    patients: patients || [],
    convenios: convenios || [],
    priceTables: priceTables || [],
    medicos: loadMedicos(),
    page: 'admin-orcamentos'
  });
});

// Adicionar ou Editar Orçamento
router.post('/admin/orcamentos/add', requireAdmin, (req, res) => {
  try {
    const { 
      originalId,
      codigo,
      data: date,
      usuario,
      patientName, 
      patientCpf, 
      patientPhone, 
      patientEmail,
      solicitante,
      contatoNome,
      contatoFone,
      conselhoTipo,
      conselhoNum,
      conselhoUf,
      doctorName, 
      convenio, 
      observation,
      acrescimo,
      tipoAcrescimo,
      desconto,
      tipoDesconto,
      validade,
      examsJson
    } = req.body;
    
    const allExams = loadExams();
    const budgets = loadBudgets();

    let selectedExams = [];
    
    if (examsJson) {
      try {
        const parsed = JSON.parse(examsJson);
        if (Array.isArray(parsed)) {
          selectedExams = parsed;
        }
      } catch(e) {
        console.error("Erro ao fazer parse de examsJson:", e);
      }
    }

    // Fallback se não veio examsJson
    if (selectedExams.length === 0) {
      let selectedExamIds = req.body.exams;
      if (!selectedExamIds) {
        selectedExamIds = [];
      } else if (!Array.isArray(selectedExamIds)) {
        selectedExamIds = [selectedExamIds];
      }

      selectedExamIds.forEach(id => {
        const exam = allExams.find(e => e.id === id);
        if (exam) {
          const price = exam.pricePrivate ? parseFloat(exam.pricePrivate) : 0;
          selectedExams.push({
            id: exam.id,
            name: exam.name,
            code: exam.code || '',
            material: exam.material || 'Soro',
            category: exam.category || 'Geral',
            fasting: exam.fasting || 'Sem jejum',
            timeframe: exam.timeframe || '1 dia útil',
            instructions: exam.instructions || 'Nenhuma instrução especial.',
            price: price
          });
        }
      });
    }

    const cleanPatientName = (patientNameStr || 'Cliente Balcão').trim();
    
    if (selectedExams.length === 0) {
      return res.status(400).send("Selecione pelo menos um exame para o orçamento");
    }

    let subtotalPrice = 0;
    let maxFastingMinutes = 0;
    let maxFastingText = "Sem jejum";
    let maxTimeframeDays = 0;
    let maxTimeframeText = "1 dia útil";
    const instructionsList = [];

    selectedExams.forEach(item => {
      const price = parseFloat(item.price || 0);
      subtotalPrice += price;

      // Jejum Máximo
      const fastingStr = (item.fasting || '').toLowerCase();
      let fastingMinutes = 0;
      if (fastingStr.includes('12')) fastingMinutes = 12 * 60;
      else if (fastingStr.includes('8')) fastingMinutes = 8 * 60;
      else if (fastingStr.includes('4')) fastingMinutes = 4 * 60;
      else if (fastingStr.includes('jejum')) fastingMinutes = 8 * 60;

      if (fastingMinutes > maxFastingMinutes) {
        maxFastingMinutes = fastingMinutes;
        maxFastingText = item.fasting || 'Sem jejum';
      }

      // Prazo Máximo
      const tfStr = (item.timeframe || '').toLowerCase();
      let days = 1;
      const matches = tfStr.match(/\d+/);
      if (matches) days = parseInt(matches[0], 10);
      if (tfStr.includes('hora')) days = 0.5;

      if (days > maxTimeframeDays) {
        maxTimeframeDays = days;
        maxTimeframeText = item.timeframe || '1 dia útil';
      }

      if (item.instructions && item.instructions.trim() !== '' && !item.instructions.toLowerCase().includes('não há') && !item.instructions.toLowerCase().includes('nenhum')) {
        instructionsList.push({
          examName: item.name,
          text: item.instructions
        });
      }
    });

    // Aplicar acréscimo e desconto no total
    let acrescimoVal = parseFloat(acrescimo || 0);
    let descontoVal = parseFloat(desconto || 0);

    let finalAcrescimo = 0;
    if (tipoAcrescimo === '%') {
      finalAcrescimo = (subtotalPrice * acrescimoVal) / 100;
    } else {
      finalAcrescimo = acrescimoVal;
    }

    let finalDesconto = 0;
    if (tipoDesconto === '%') {
      finalDesconto = (subtotalPrice * descontoVal) / 100;
    } else {
      finalDesconto = descontoVal;
    }

    let totalPrice = Math.max(0, subtotalPrice + finalAcrescimo - finalDesconto);

    const targetId = (originalId && originalId.trim()) ? originalId.trim() : ((codigo && codigo.trim()) ? codigo.trim() : 'ORC' + Date.now().toString().slice(-6));

    const newBudget = {
      id: targetId,
      patientName: cleanPatientName,
      patientCpf: (patientCpf || '').trim(),
      patientPhone: (patientPhone || '').trim(),
      patientEmail: (patientEmail || '').trim(),
      solicitante: (solicitante || '').trim(),
      contatoNome: (contatoNome || '').trim(),
      contatoFone: (contatoFone || '').trim(),
      conselhoTipo: (conselhoTipo || 'CRM').trim(),
      conselhoNum: (conselhoNum || '').trim(),
      conselhoUf: (conselhoUf || 'PR').trim(),
      doctorName: (doctorName || 'Não Informado').trim(),
      convenio: (convenio || 'Particular').trim(),
      observation: (observation || '').trim(),
      user: (usuario || res.locals.adminUserName || 'Administrador').trim(),
      date: date || new Date().toISOString().split('T')[0],
      acrescimo: acrescimoVal,
      tipoAcrescimo: tipoAcrescimo || 'R$',
      desconto: descontoVal,
      tipoDesconto: tipoDesconto || 'R$',
      validade: validade || '30 dias',
      exams: selectedExams,
      subtotalPrice: subtotalPrice,
      totalPrice: totalPrice,
      maxFasting: maxFastingText,
      maxTimeframe: maxTimeframeText,
      instructions: instructionsList,
      createdAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      status: 'Aguardando Coleta'
    };
    
    let existingIndex = -1;
    if (originalId && originalId.trim()) {
      existingIndex = budgets.findIndex(b => b.id === originalId.trim());
    }
    if (existingIndex === -1 && codigo && codigo.trim()) {
      existingIndex = budgets.findIndex(b => b.id === codigo.trim());
    }

    if (existingIndex !== -1) {
      newBudget.createdAt = budgets[existingIndex].createdAt || newBudget.createdAt;
      newBudget.status = budgets[existingIndex].status || newBudget.status;
      budgets[existingIndex] = newBudget;
    } else {
      budgets.push(newBudget);
    }

    saveBudgets(budgets);
    
    res.redirect('/admin/orcamentos');
  } catch (error) {
    console.error("Erro ao adicionar/editar orçamento:", error);
    res.status(500).send("Erro interno ao salvar o orçamento");
  }
});

// Atualizar Status do Orçamento
router.post('/admin/orcamentos/status', requireAdmin, (req, res) => {
  try {
    const { id, status } = req.body;
    const budgets = loadBudgets();
    const index = budgets.findIndex(b => b.id === id);
    if (index !== -1) {
      budgets[index].status = status;
      saveBudgets(budgets);
      return res.json({ success: true });
    }
    res.status(404).json({ success: false, message: 'Orçamento não encontrado.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});

// Excluir Orçamento
router.post('/admin/orcamentos/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    const budgets = loadBudgets();
    const filtered = budgets.filter(b => b.id !== id);
    saveBudgets(filtered);
    res.redirect('/admin/orcamentos');
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao excluir orçamento");
  }
});


// ==========================================
// CRUD Tabela Cisnorpi
// ==========================================

// Página Listagem/CRUD Tabela Cisnorpi
router.get('/admin/cisnorpi', requireAdmin, (req, res) => {
  const items = loadCisnorpi();
  res.render('admin/cisnorpi', {
    items: items,
    page: 'admin-cisnorpi'
  });
});

// Adicionar Item Cisnorpi
router.post('/admin/cisnorpi/add', requireAdmin, (req, res) => {
  try {
    const { codJalis, codCisnorpi, codAlvaro, codPardini, name, priceCisnorpi } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).send("Nome é obrigatório");
    }

    const items = loadCisnorpi();
    const newItem = {
      id: 'CIS-' + Date.now(),
      codJalis: (codJalis || '').trim(),
      codCisnorpi: (codCisnorpi || '').trim(),
      codAlvaro: (codAlvaro || '').trim(),
      codPardini: (codPardini || '').trim(),
      name: name.trim(),
      priceCisnorpi: parseFloat(priceCisnorpi) || 0,
      createdAt: new Date().toISOString()
    };

    items.push(newItem);
    saveCisnorpi(items);
    res.redirect('/admin/cisnorpi');
  } catch (error) {
    console.error("Erro ao adicionar item Cisnorpi:", error);
    res.status(500).send("Erro interno ao adicionar item Cisnorpi");
  }
});

// Atualizar Item Cisnorpi
router.post('/admin/cisnorpi/update', requireAdmin, (req, res) => {
  try {
    const { id, codJalis, codCisnorpi, codAlvaro, codPardini, name, priceCisnorpi } = req.body;
    
    if (!id || !name || name.trim() === '') {
      return res.status(400).send("Campos obrigatórios ausentes");
    }

    const items = loadCisnorpi();
    const index = items.findIndex(item => item.id === id);
    if (index !== -1) {
      items[index] = {
        ...items[index],
        codJalis: (codJalis || '').trim(),
        codCisnorpi: (codCisnorpi || '').trim(),
        codAlvaro: (codAlvaro || '').trim(),
        codPardini: (codPardini || '').trim(),
        name: name.trim(),
        priceCisnorpi: parseFloat(priceCisnorpi) || 0,
        updatedAt: new Date().toISOString()
      };
      saveCisnorpi(items);
      res.redirect('/admin/cisnorpi');
    } else {
      res.status(404).send("Item Cisnorpi não encontrado");
    }
  } catch (error) {
    console.error("Erro ao atualizar item Cisnorpi:", error);
    res.status(500).send("Erro interno ao atualizar item Cisnorpi");
  }
});

// Deletar/Excluir Item Cisnorpi
router.post('/admin/cisnorpi/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).send("ID é obrigatório");
    }

    const items = loadCisnorpi();
    const filtered = items.filter(item => item.id !== id);
    saveCisnorpi(filtered);
    res.redirect('/admin/cisnorpi');
  } catch (error) {
    console.error("Erro ao excluir item Cisnorpi:", error);
    res.status(500).send("Erro ao excluir item Cisnorpi");
  }
});

// Importar Itens Cisnorpi em Lote
router.post('/admin/cisnorpi/import', requireAdmin, (req, res) => {
  try {
    const { items, replace } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: "Dados de importação inválidos." });
    }

    let currentItems = replace ? [] : loadCisnorpi();

    // Validar e higienizar itens importados
    const parsedItems = items.map((item, index) => {
      // Garantir que temos o nome
      const name = String(item.name || '').trim();
      
      // Converter valor de preço de forma robusta
      let price = 0;
      if (item.priceCisnorpi !== undefined && item.priceCisnorpi !== null) {
        if (typeof item.priceCisnorpi === 'number') {
          price = item.priceCisnorpi;
        } else {
          // Remover R$, espaços e corrigir vírgulas brasileiras
          let strPrice = String(item.priceCisnorpi)
            .replace(/R\$/g, '')
            .replace(/\s/g, '')
            .replace(/\./g, '') // Remover separador de milhar (ponto) se houver
            .replace(',', '.'); // Trocar vírgula por ponto decimal
          price = parseFloat(strPrice) || 0;
        }
      }

      return {
        id: 'CIS-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        codJalis: String(item.codJalis !== undefined && item.codJalis !== null ? item.codJalis : '').trim(),
        codCisnorpi: String(item.codCisnorpi !== undefined && item.codCisnorpi !== null ? item.codCisnorpi : '').trim(),
        codAlvaro: String(item.codAlvaro !== undefined && item.codAlvaro !== null ? item.codAlvaro : '').trim(),
        codPardini: String(item.codPardini !== undefined && item.codPardini !== null ? item.codPardini : '').trim(),
        name: name,
        priceCisnorpi: price,
        createdAt: new Date().toISOString()
      };
    }).filter(item => item.name !== ''); // O nome é obrigatório

    if (parsedItems.length === 0) {
      return res.status(400).json({ success: false, message: "Nenhum item válido com nome foi encontrado para importar." });
    }

    const updatedItems = [...currentItems, ...parsedItems];
    saveCisnorpi(updatedItems);

    res.json({ success: true, count: parsedItems.length });
  } catch (error) {
    console.error("Erro ao importar tabela Cisnorpi:", error);
    res.status(500).json({ success: false, message: "Erro interno do servidor ao importar os dados." });
  }
});

// ==========================================
// SUB-MÓDULO: RECEPÇÃO LIS (PACIENTES, AGENDAMENTOS, COLETA E RECEBIMENTO)
// ==========================================

// Pacientes (PEP)
router.get('/admin/recepcao/pacientes', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const patients = loadPatients();
  res.render('admin/recepcao/pacientes', {
    patients,
    page: 'admin-pacientes'
  });
});

router.post('/admin/recepcao/pacientes/save', requireAdmin, async (req, res) => {
  try {
    const { 
      id, code, name, socialName, sex, gender, biologicalSex, sexo, birthDate, ageValue, ageUnit, weight, height, color,
      dum, bloodType, rhFactor, du, obs, clinicalNotes, photo,
      // Tab Adicionais
      maritalStatus, childrenCount, passport, profession, smoker, diabetic, noInfoDiabetic, email,
      cpf, rg, motherName, fatherName, responsibleName, responsibleCpf, payerName, payerCpf,
      company, indication, webPassword, whatsapp, respondsWhatsapp, whatsappAlt,
      // Checkboxes Adicionais
      isVip, prohibitRegistration, prohibitWeb, incapacitated, noSms, noEmail, noPush, noWhatsapp, sendDirectMail, printCard,
      // Tab Endereço
      cep, street, number, neighborhood, city, state, complement, referencePoint,
      // Tab Convênio
      convenio, insuranceNumber, insuranceValidity, cns, plan, defaultDoctor,
      // Tab Medicamento
      continuousMedications, useAnticoagulant, useAntibiotic, antibioticDetails, otherDrugs,
      // Tab Obs. Coleta
      allergies, collectionNotes, butterflyNeedle, requiresEscort, bedriddenPatient
    } = req.body;

    let patients = loadPatients();

    let maxCode = 0;
    patients.forEach(p => {
      if (p.code) {
        const num = parseInt(p.code, 10);
        if (!isNaN(num) && num > maxCode) maxCode = num;
      }
      if (p.id) {
        const idNum = parseInt(String(p.id).replace('PAC-', ''), 10);
        if (!isNaN(idNum) && idNum > maxCode && idNum < 10000) maxCode = idNum;
      }
    });
    const nextCodeStr = String(maxCode + 1);

    let age = 0;
    if (birthDate) {
      const birth = new Date(birthDate);
      const now = new Date();
      age = now.getFullYear() - birth.getFullYear();
      if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
        age--;
      }
    } else if (ageValue) {
      age = parseInt(ageValue) || 0;
    }

    let patientCode = (code || '').trim();
    if (!id) {
      // Para paciente novo, sempre calcula e gera o próximo código incremental sozinho no salvamento
      patientCode = nextCodeStr;
    } else {
      const existing = patients.find(p => p.id === id);
      if (existing && existing.code) {
        patientCode = existing.code;
      } else if (!patientCode) {
        patientCode = nextCodeStr;
      }
    }

    let selectedSex = (sex || biologicalSex || sexo || gender || '').trim();
    if (selectedSex === 'M' || selectedSex === 'm') selectedSex = 'Masculino';
    if (selectedSex === 'F' || selectedSex === 'f') selectedSex = 'Feminino';
    if (!selectedSex) selectedSex = 'Não informado';

    let selectedGender = (gender || selectedSex || 'Não informado').trim();
    if (selectedGender === 'M' || selectedGender === 'm') selectedGender = 'Masculino';
    if (selectedGender === 'F' || selectedGender === 'f') selectedGender = 'Feminino';

    const patientData = {
      code: patientCode,
      name: (name || '').trim(),
      socialName: (socialName || '').trim(),
      sex: selectedSex,
      sexo: selectedSex,
      biologicalSex: selectedSex,
      gender: selectedGender,
      birthDate: birthDate || '',
      age,
      ageValue: ageValue || age,
      ageUnit: ageUnit || 'Ano(s)',
      weight: weight || '',
      height: height || '',
      color: color || 'Branco',
      dum: dum || '',
      bloodType: bloodType || '',
      rhFactor: rhFactor || '',
      du: du || '',
      obs: (obs || '').trim(),
      clinicalNotes: (clinicalNotes || '').trim(),
      photo: photo || '',

      // Tab Adicionais
      maritalStatus: maritalStatus || 'Solteiro',
      childrenCount: childrenCount || '0',
      passport: (passport || '').trim(),
      profession: (profession || '').trim(),
      smoker: smoker || 'Não',
      diabetic: diabetic || 'Não',
      noInfoDiabetic: noInfoDiabetic === 'on' || noInfoDiabetic === 'true' || noInfoDiabetic === true,
      email: (email || '').trim(),
      cpf: (cpf || '').trim(),
      rg: (rg || '').trim(),
      motherName: (motherName || '').trim(),
      fatherName: (fatherName || '').trim(),
      responsibleName: (responsibleName || '').trim(),
      responsibleCpf: (responsibleCpf || '').trim(),
      payerName: (payerName || '').trim(),
      payerCpf: (payerCpf || '').trim(),
      company: (company || '').trim(),
      indication: (indication || '').trim(),
      webPassword: (webPassword || '').trim(),

      // Checkboxes
      isVip: isVip === 'on' || isVip === 'true' || isVip === true,
      prohibitRegistration: prohibitRegistration === 'on' || prohibitRegistration === 'true' || prohibitRegistration === true,
      prohibitWeb: prohibitWeb === 'on' || prohibitWeb === 'true' || prohibitWeb === true,
      incapacitated: incapacitated === 'on' || incapacitated === 'true' || incapacitated === true,
      noSms: noSms === 'on' || noSms === 'true' || noSms === true,
      noEmail: noEmail === 'on' || noEmail === 'true' || noEmail === true,
      noPush: noPush === 'on' || noPush === 'true' || noPush === true,
      noWhatsapp: noWhatsapp === 'on' || noWhatsapp === 'true' || noWhatsapp === true,
      sendDirectMail: sendDirectMail === 'on' || sendDirectMail === 'true' || sendDirectMail === true,
      printCard: printCard === 'on' || printCard === 'true' || printCard === true,

      // Tab Endereço
      cep: (cep || '').trim(),
      street: (street || '').trim(),
      number: (number || '').trim(),
      neighborhood: (neighborhood || '').trim(),
      city: (city || 'Cambará').trim(),
      state: (state || 'PR').trim(),
      complement: (complement || '').trim(),
      referencePoint: (referencePoint || '').trim(),

      // Tab Convênio
      convenio: (convenio || 'Particular').trim(),
      insuranceNumber: (insuranceNumber || '').trim(),
      insuranceValidity: insuranceValidity || '',
      cns: (cns || '').trim(),
      plan: (plan || '').trim(),
      defaultDoctor: (defaultDoctor || '').trim(),

      // Tab Medicamento
      continuousMedications: (continuousMedications || '').trim(),
      useAnticoagulant: useAnticoagulant || 'Não',
      useAntibiotic: useAntibiotic || 'Não',
      antibioticDetails: (antibioticDetails || '').trim(),
      otherDrugs: (otherDrugs || '').trim(),

      // Tab Obs. Coleta
      allergies: (allergies || 'Nenhuma').trim(),
      collectionNotes: (collectionNotes || '').trim(),
      butterflyNeedle: butterflyNeedle === 'on' || butterflyNeedle === 'true',
      requiresEscort: requiresEscort === 'on' || requiresEscort === 'true',
      bedriddenPatient: bedriddenPatient === 'on' || bedriddenPatient === 'true',

      whatsapp: (whatsapp || req.body.phone || '').trim(),
      respondsWhatsapp: respondsWhatsapp === 'Não' || respondsWhatsapp === 'false' || respondsWhatsapp === false ? 'Não' : 'Sim',
      whatsappAlt: (whatsappAlt || '').trim(),
      phone: (whatsapp || req.body.phone || '').trim(),
      updatedAt: new Date().toISOString()
    };

    let savedPatient = null;

    if (id || patientCode) {
      const idx = patients.findIndex(p => 
        (id && String(p.id) === String(id)) || 
        (id && String(p.code) === String(id)) || 
        (patientCode && String(p.code) === String(patientCode)) ||
        (patientCode && String(p.id) === String('PAC-' + patientCode))
      );
      if (idx !== -1) {
        patients[idx] = {
          ...patients[idx],
          ...patientData
        };
        savedPatient = patients[idx];
      } else {
        savedPatient = {
          id: id || ('PAC-' + patientCode),
          prontuario: 'PEP-' + String(patientCode || Date.now()).padStart(5, '0'),
          createdAt: new Date().toISOString(),
          ...patientData
        };
        patients.push(savedPatient);
      }
    } else {
      const newId = 'PAC-' + patientCode;
      savedPatient = {
        id: newId,
        prontuario: 'PEP-' + String(patientCode).padStart(5, '0'),
        createdAt: new Date().toISOString(),
        ...patientData
      };
      patients.push(savedPatient);
    }

    await savePatients(patients);

    const isAjax = req.xhr || 
      (req.headers.accept && req.headers.accept.includes('application/json')) ||
      req.headers['x-requested-with'] === 'XMLHttpRequest' ||
      req.query.format === 'json';

    if (isAjax) {
      return res.json({ 
        success: true, 
        message: 'Paciente salvo com sucesso!', 
        patient: savedPatient, 
        patients 
      });
    }

    res.redirect('/admin/recepcao/pacientes');
  } catch (err) {
    console.error("Erro ao salvar paciente:", err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(500).json({ success: false, error: 'Erro ao salvar paciente' });
    }
    res.redirect('/admin/recepcao/pacientes?error=erro_salvar');
  }
});

router.post('/admin/recepcao/pacientes/delete', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    let patients = loadPatients();
    if (id) {
      patients = patients.filter(p => String(p.id) !== String(id) && String(p.code) !== String(id));
      await savePatients(patients);
    }

    const isAjax = req.xhr || 
      (req.headers.accept && req.headers.accept.includes('application/json')) ||
      req.headers['x-requested-with'] === 'XMLHttpRequest';

    if (isAjax) {
      return res.json({ success: true, message: 'Paciente excluído com sucesso!', patients });
    }

    res.redirect('/admin/recepcao/pacientes');
  } catch (err) {
    console.error("Erro ao excluir paciente:", err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(500).json({ success: false, error: 'Erro ao excluir paciente' });
    }
    res.redirect('/admin/recepcao/pacientes?error=erro_excluir');
  }
});

router.post('/admin/recepcao/pacientes/toggle-status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (id) {
      let patients = loadPatients();
      const patient = patients.find(p => p.id === id || p.code === id);
      if (patient) {
        patient.status = (patient.status === 'Inativo') ? 'Ativo' : 'Inativo';
        await savePatients(patients);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao alterar status do paciente:", err);
    res.status(500).json({ error: "Erro interno ao alterar status" });
  }
});

// Importar Pacientes em Lote (JSON / CSV)
router.post('/admin/recepcao/pacientes/import', requireAdmin, async (req, res) => {
  try {
    const { patients: importedList, overwrite = true } = req.body;
    if (!Array.isArray(importedList) || importedList.length === 0) {
      return res.status(400).json({ success: false, error: 'Lista de pacientes para importação vazia ou inválida.' });
    }

    let currentPatients = loadPatients();

    let maxCode = 0;
    currentPatients.forEach(p => {
      if (p.code) {
        const num = parseInt(p.code, 10);
        if (!isNaN(num) && num > maxCode) maxCode = num;
      }
      if (p.id) {
        const idNum = parseInt(String(p.id).replace('PAC-', ''), 10);
        if (!isNaN(idNum) && idNum > maxCode && idNum < 10000) maxCode = idNum;
      }
    });

    let newCount = 0;
    let updatedCount = 0;

    importedList.forEach(rawItem => {
      if (!rawItem || typeof rawItem !== 'object') return;

      const name = (rawItem.name || rawItem.nome || rawItem.nomePaciente || rawItem.paciente || '').toString().trim();
      if (!name) return;

      const cpfRaw = (rawItem.cpf || rawItem.CPF || rawItem.documento || '').toString().trim();
      const codeRaw = (rawItem.code || rawItem.codigo || rawItem.prontuario || rawItem.id || '').toString().trim().replace('PAC-', '');

      let rawSex = (rawItem.sex || rawItem.sexo || rawItem.biologicalSex || rawItem.genero || '').toString().trim();
      if (['M', 'm', 'Masculino', 'MALE', 'male'].includes(rawSex)) rawSex = 'Masculino';
      else if (['F', 'f', 'Feminino', 'FEMALE', 'female'].includes(rawSex)) rawSex = 'Feminino';
      else rawSex = 'Não informado';

      let birthDate = (rawItem.birthDate || rawItem.dataNascimento || rawItem.nascimento || rawItem.data_nascimento || '').toString().trim();
      let age = parseInt(rawItem.age || rawItem.idade) || 0;
      if (birthDate) {
        if (birthDate.includes('/')) {
          const parts = birthDate.split('/');
          if (parts.length === 3) {
            if (parts[0].length === 4) {
              birthDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            } else if (parts[2].length === 4) {
              birthDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
          }
        }
        const birth = new Date(birthDate);
        if (!isNaN(birth.getTime())) {
          const now = new Date();
          age = now.getFullYear() - birth.getFullYear();
          if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
            age--;
          }
        }
      }

      let existingIndex = -1;
      if (cpfRaw) {
        existingIndex = currentPatients.findIndex(p => p.cpf && p.cpf.replace(/\D/g, '') === cpfRaw.replace(/\D/g, ''));
      }
      if (existingIndex === -1 && codeRaw) {
        existingIndex = currentPatients.findIndex(p => 
          String(p.code) === codeRaw || 
          String(p.id) === 'PAC-' + codeRaw || 
          String(p.id) === codeRaw
        );
      }
      if (existingIndex === -1) {
        existingIndex = currentPatients.findIndex(p => 
          p.name && p.name.toLowerCase() === name.toLowerCase() && 
          (birthDate ? p.birthDate === birthDate : true)
        );
      }

      const phone = (rawItem.whatsapp || rawItem.phone || rawItem.celular || rawItem.telefone || '').toString().trim();
      const city = (rawItem.city || rawItem.cidade || 'Cambará').toString().trim();
      const state = (rawItem.state || rawItem.uf || rawItem.estado || 'PR').toString().trim();

      if (existingIndex !== -1 && overwrite) {
        const p = currentPatients[existingIndex];
        currentPatients[existingIndex] = {
          ...p,
          name: name || p.name,
          socialName: (rawItem.socialName || rawItem.nomeSocial || p.socialName || '').toString().trim(),
          sex: rawSex || p.sex,
          sexo: rawSex || p.sexo,
          biologicalSex: rawSex || p.biologicalSex,
          gender: rawSex || p.gender,
          birthDate: birthDate || p.birthDate,
          age: age || p.age,
          cpf: cpfRaw || p.cpf,
          rg: (rawItem.rg || rawItem.RG || p.rg || '').toString().trim(),
          email: (rawItem.email || p.email || '').toString().trim(),
          whatsapp: phone || p.whatsapp,
          phone: phone || p.phone,
          street: (rawItem.street || rawItem.endereco || rawItem.logradouro || p.street || '').toString().trim(),
          number: (rawItem.number || rawItem.numero || p.number || '').toString().trim(),
          neighborhood: (rawItem.neighborhood || rawItem.bairro || p.neighborhood || '').toString().trim(),
          city: city || p.city,
          state: state || p.state,
          cep: (rawItem.cep || rawItem.CEP || p.cep || '').toString().trim(),
          convenio: (rawItem.convenio || p.convenio || 'Particular').toString().trim(),
          updatedAt: new Date().toISOString()
        };
        updatedCount++;
      } else if (existingIndex === -1) {
        maxCode++;
        const newCode = codeRaw || String(maxCode);
        const newId = 'PAC-' + newCode;
        const newPatient = {
          id: newId,
          code: newCode,
          prontuario: 'PEP-' + String(newCode).padStart(5, '0'),
          name,
          socialName: (rawItem.socialName || rawItem.nomeSocial || '').toString().trim(),
          sex: rawSex,
          sexo: rawSex,
          biologicalSex: rawSex,
          gender: rawSex,
          birthDate,
          age,
          weight: (rawItem.weight || '').toString().trim(),
          height: (rawItem.height || '').toString().trim(),
          cpf: cpfRaw,
          rg: (rawItem.rg || rawItem.RG || '').toString().trim(),
          email: (rawItem.email || '').toString().trim(),
          whatsapp: phone,
          phone: phone,
          respondsWhatsapp: 'Sim',
          street: (rawItem.street || rawItem.endereco || rawItem.logradouro || '').toString().trim(),
          number: (rawItem.number || rawItem.numero || '').toString().trim(),
          neighborhood: (rawItem.neighborhood || rawItem.bairro || '').toString().trim(),
          city,
          state,
          cep: (rawItem.cep || rawItem.CEP || '').toString().trim(),
          convenio: (rawItem.convenio || 'Particular').toString().trim(),
          status: 'Ativo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        currentPatients.push(newPatient);
        newCount++;
      }
    });

    await savePatients(currentPatients);

    return res.json({
      success: true,
      message: `Importação concluída! ${newCount} novos pacientes cadastrados e ${updatedCount} atualizados.`,
      newCount,
      updatedCount,
      totalCount: newCount + updatedCount,
      patients: currentPatients
    });
  } catch (err) {
    console.error("Erro na importação de pacientes:", err);
    return res.status(500).json({ success: false, error: 'Erro ao processar importação no servidor.' });
  }
});

// Agendamentos
router.get('/admin/recepcao/agendamentos', requireAdmin, (req, res) => {
  const appointments = loadAppointments();
  res.render('admin/recepcao/agendamentos', {
    appointments,
    page: 'admin-agendamentos'
  });
});

router.post('/admin/recepcao/agendamentos/save', requireAdmin, (req, res) => {
  try {
    const { patientName, phone, type, date, time, exams, address, notes } = req.body;
    let appointments = loadAppointments();

    const newApt = {
      id: 'AGD-' + Date.now().toString().slice(-6),
      patientName: (patientName || '').trim(),
      phone: (phone || '').trim(),
      type: (type || 'Presencial').trim(),
      date: date || new Date().toISOString().split('T')[0],
      time: time || '08:00',
      exams: (exams || 'Exames Gerais').trim(),
      address: (address || '').trim(),
      notes: (notes || '').trim(),
      status: 'Confirmado',
      createdAt: new Date().toISOString()
    };

    appointments.push(newApt);
    saveAppointments(appointments);
    res.redirect('/admin/recepcao/agendamentos');
  } catch (err) {
    console.error("Erro ao salvar agendamento:", err);
    res.redirect('/admin/recepcao/agendamentos?error=erro_salvar');
  }
});

// Coleta de Materiais
router.get('/admin/recepcao/coleta', requireAdmin, (req, res) => {
  const requisitions = loadRequisitions();
  const exams = getEnrichedExams();
  const recipientes = loadRecipientes();
  const patients = loadPatients();
  const setores = loadSetores();
  res.render('admin/recepcao/coleta', {
    requisitions,
    exams,
    recipientes,
    patients,
    setores,
    page: 'admin-coleta'
  });
});

// Recebimento e Triagem
router.get('/admin/recepcao/recebimento', requireAdmin, (req, res) => {
  const requisitions = loadRequisitions();
  res.render('admin/recepcao/recebimento', {
    requisitions,
    page: 'admin-recebimento'
  });
});

// Triagem de Amostras
router.get('/admin/triagem/amostras', requireAdmin, (req, res) => {
  const requisitions = loadRequisitions();
  const exams = getEnrichedExams();
  const recipientes = loadRecipientes();
  const patients = loadPatients();
  const setores = loadSetores();
  const labs = loadSupportLabs();

  res.render('admin/triagem/amostras', {
    requisitions,
    exams,
    recipientes,
    patients,
    setores,
    labs,
    page: 'admin-triagem-amostras'
  });
});

// Criar Lote (Alvaro e Pardini - Pacientes Triados)
router.get('/admin/triagem/criar-lote', requireAdmin, (req, res) => {
  const requisitions = loadRequisitions();
  const exams = getEnrichedExams();
  const recipientes = loadRecipientes();
  const patients = loadPatients();
  const setores = loadSetores();
  const labs = loadSupportLabs();
  const configAlvaro = loadConfigApoioAlvaro();

  res.render('admin/triagem/criar-lote', {
    requisitions,
    exams,
    recipientes,
    patients,
    setores,
    labs,
    configAlvaro,
    medicos: loadMedicos(),
    page: 'admin-triagem-criar-lote'
  });
});

// ==========================================

export default router;
