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
  loadPessoas,
  savePessoas,
  requireAdmin,
  slugify,
  SITEMAP_OLD_EXAMS
} from "../dataStore.js";
import * as XLSX from "xlsx";

const router = express.Router();

// ================= SUB-MÓDULO: GESTÃO FINANCEIRA (CONTAS A PAGAR E RECEBER) =================

// --- CONFIGURAÇÕES FINANCEIRAS (ABAS UNIFICADAS) ---
router.get('/admin/financeiro/configuracoes', requireAdmin, (req, res) => {
  const settings = loadFinanceSettings();
  const currentTab = req.query.tab || 'contas-bancarias';
  res.render('admin/financeiro/configuracoes', {
    bankAccounts: settings.bankAccounts || [],
    documentTypes: settings.documentTypes || [],
    accountCategories: settings.accountCategories || [],
    chartOfAccountsTree: settings.chartOfAccountsTree || [],
    paymentMethods: settings.paymentMethods || [],
    page: 'admin-financeiro-configuracoes',
    currentTab,
    selectedMethodId: req.query.selectedMethod || null,
    success_msg: req.query.success,
    error_msg: req.query.error
  });
});

// --- FORMAS E CONDIÇÕES DE PAGAMENTO ---
router.get('/admin/financeiro/pagamentos', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=pagamentos');
});

router.get('/api/finance/payment-methods', (req, res) => {
  const settings = loadFinanceSettings();
  res.json({
    success: true,
    paymentMethods: settings.paymentMethods || []
  });
});

// Adicionar Forma de Pagamento
router.post('/admin/financeiro/pagamentos/metodo/add', requireAdmin, (req, res) => {
  const { name, discountType, discountValue, active } = req.body;
  if (!name || !name.trim()) {
    return res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&error=O+nome+da+forma+de+pagamento+é+obrigatório.');
  }
  const settings = loadFinanceSettings();
  settings.paymentMethods = settings.paymentMethods || [];

  const maxId = settings.paymentMethods.reduce((max, curr) => Math.max(max, parseInt(curr.id) || 0), 0);
  const newId = String(maxId + 1);

  settings.paymentMethods.push({
    id: newId,
    name: name.trim(),
    discountType: discountType === 'currency' ? 'currency' : 'percent',
    discountValue: parseFloat(discountValue) || 0,
    active: active === 'false' || active === false ? false : true,
    conditions: []
  });

  saveFinanceSettings(settings);
  res.redirect(`/admin/financeiro/configuracoes?tab=pagamentos&selectedMethod=${newId}&success=Forma+de+pagamento+cadastrada+com+sucesso.`);
});

// Editar Forma de Pagamento
router.post('/admin/financeiro/pagamentos/metodo/edit', requireAdmin, (req, res) => {
  const { id, name, discountType, discountValue, active } = req.body;
  if (!id || !name || !name.trim()) {
    return res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&error=Dados+inválidos+para+a+forma+de+pagamento.');
  }
  const settings = loadFinanceSettings();
  settings.paymentMethods = settings.paymentMethods || [];
  const method = settings.paymentMethods.find(m => String(m.id) === String(id));
  if (method) {
    method.name = name.trim();
    method.discountType = discountType === 'currency' ? 'currency' : 'percent';
    method.discountValue = parseFloat(discountValue) || 0;
    method.active = active === 'false' || active === false ? false : true;
    saveFinanceSettings(settings);
    res.redirect(`/admin/financeiro/configuracoes?tab=pagamentos&selectedMethod=${id}&success=Forma+de+pagamento+atualizada+com+sucesso.`);
  } else {
    res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&error=Forma+de+pagamento+não+encontrada.');
  }
});

// Excluir Forma de Pagamento
router.get('/admin/financeiro/pagamentos/metodo/delete/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const settings = loadFinanceSettings();
  settings.paymentMethods = settings.paymentMethods || [];
  settings.paymentMethods = settings.paymentMethods.filter(m => String(m.id) !== String(id));
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&success=Forma+de+pagamento+excluída+com+sucesso.');
});

// Adicionar Condição de Pagamento
router.post('/admin/financeiro/pagamentos/condicao/add', requireAdmin, (req, res) => {
  const { methodId, description, installments, discountType, discountValue, active } = req.body;
  if (!methodId || !description || !description.trim()) {
    return res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&error=Preencha+a+descrição+da+condição+de+pagamento.');
  }
  const settings = loadFinanceSettings();
  settings.paymentMethods = settings.paymentMethods || [];
  const method = settings.paymentMethods.find(m => String(m.id) === String(methodId));
  if (!method) {
    return res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&error=Forma+de+pagamento+não+encontrada.');
  }

  method.conditions = method.conditions || [];
  const maxCondId = method.conditions.reduce((max, curr) => Math.max(max, parseInt(curr.id) || 0), parseInt(methodId) * 100);
  const newCondId = String(maxCondId + 1);

  method.conditions.push({
    id: newCondId,
    description: description.trim(),
    installments: parseInt(installments) || 1,
    discountType: discountType === 'currency' ? 'currency' : 'percent',
    discountValue: parseFloat(discountValue) || 0,
    active: active === 'false' || active === false ? false : true
  });

  saveFinanceSettings(settings);
  res.redirect(`/admin/financeiro/configuracoes?tab=pagamentos&selectedMethod=${methodId}&success=Condição+de+pagamento+adicionada+com+sucesso.`);
});

// Editar Condição de Pagamento
router.post('/admin/financeiro/pagamentos/condicao/edit', requireAdmin, (req, res) => {
  const { methodId, conditionId, description, installments, discountType, discountValue, active } = req.body;
  if (!methodId || !conditionId || !description || !description.trim()) {
    return res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&error=Dados+inválidos+para+a+condição+de+pagamento.');
  }
  const settings = loadFinanceSettings();
  settings.paymentMethods = settings.paymentMethods || [];
  const method = settings.paymentMethods.find(m => String(m.id) === String(methodId));
  if (method && method.conditions) {
    const condition = method.conditions.find(c => String(c.id) === String(conditionId));
    if (condition) {
      condition.description = description.trim();
      condition.installments = parseInt(installments) || 1;
      condition.discountType = discountType === 'currency' ? 'currency' : 'percent';
      condition.discountValue = parseFloat(discountValue) || 0;
      condition.active = active === 'false' || active === false ? false : true;
      saveFinanceSettings(settings);
      return res.redirect(`/admin/financeiro/configuracoes?tab=pagamentos&selectedMethod=${methodId}&success=Condição+de+pagamento+atualizada+com+sucesso.`);
    }
  }
  res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&error=Condição+de+pagamento+não+encontrada.');
});

// Excluir Condição de Pagamento
router.get('/admin/financeiro/pagamentos/condicao/delete/:methodId/:conditionId', requireAdmin, (req, res) => {
  const { methodId, conditionId } = req.params;
  const settings = loadFinanceSettings();
  settings.paymentMethods = settings.paymentMethods || [];
  const method = settings.paymentMethods.find(m => String(m.id) === String(methodId));
  if (method && method.conditions) {
    method.conditions = method.conditions.filter(c => String(c.id) !== String(conditionId));
    saveFinanceSettings(settings);
    return res.redirect(`/admin/financeiro/configuracoes?tab=pagamentos&selectedMethod=${methodId}&success=Condição+de+pagamento+removida+com+sucesso.`);
  }
  res.redirect('/admin/financeiro/configuracoes?tab=pagamentos&error=Condição+de+pagamento+não+encontrada.');
});

// --- CONTAS BANCÁRIAS ---
router.get('/admin/financeiro/contas-bancarias', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias');
});

router.post('/admin/financeiro/contas-bancarias/add', requireAdmin, (req, res) => {
  const { description } = req.body;
  if (!description) {
    return res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias&error=A+descrição+é+obrigatória.');
  }
  const settings = loadFinanceSettings();
  settings.bankAccounts = settings.bankAccounts || [];
  
  const maxId = settings.bankAccounts.reduce((max, curr) => Math.max(max, parseInt(curr.id) || 0), 0);
  const newId = String(maxId + 1);
  
  settings.bankAccounts.push({ id: newId, description });
  settings.banks = settings.bankAccounts.map(b => b.description);

  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias&success=Conta+bancária+cadastrada+com+sucesso.');
});

router.post('/admin/financeiro/contas-bancarias/edit', requireAdmin, (req, res) => {
  const { id, description } = req.body;
  if (!id || !description) {
    return res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias&error=Dados+inválidos.');
  }
  const settings = loadFinanceSettings();
  settings.bankAccounts = settings.bankAccounts || [];
  const account = settings.bankAccounts.find(b => b.id === String(id));
  if (account) {
    account.description = description;
    settings.banks = settings.bankAccounts.map(b => b.description);
    saveFinanceSettings(settings);
    res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias&success=Conta+bancária+atualizada+com+sucesso.');
  } else {
    res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias&error=Conta+bancária+não+encontrada.');
  }
});

router.get('/admin/financeiro/contas-bancarias/delete/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const settings = loadFinanceSettings();
  settings.bankAccounts = settings.bankAccounts || [];
  settings.bankAccounts = settings.bankAccounts.filter(b => b.id !== String(id));
  settings.banks = settings.bankAccounts.map(b => b.description);
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias&success=Conta+bancária+excluída+com+sucesso.');
});

// --- TIPOS DE DOCUMENTOS ---
router.get('/admin/financeiro/documentos', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=documentos');
});

router.post('/admin/financeiro/documentos/add', requireAdmin, (req, res) => {
  const { description } = req.body;
  if (!description) {
    return res.redirect('/admin/financeiro/configuracoes?tab=documentos&error=A+descrição+é+obrigatória.');
  }
  const settings = loadFinanceSettings();
  settings.documentTypes = settings.documentTypes || [];
  
  const maxId = settings.documentTypes.reduce((max, curr) => Math.max(max, parseInt(curr.id) || 0), 0);
  const newId = String(maxId + 1);
  
  settings.documentTypes.push({ id: newId, description });
  settings.docTypes = settings.documentTypes.map(d => d.description);
  
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=documentos&success=Tipo+de+documento+cadastrado+com+sucesso.');
});

router.post('/admin/financeiro/documentos/edit', requireAdmin, (req, res) => {
  const { id, description } = req.body;
  if (!id || !description) {
    return res.redirect('/admin/financeiro/configuracoes?tab=documentos&error=Dados+inválidos.');
  }
  const settings = loadFinanceSettings();
  settings.documentTypes = settings.documentTypes || [];
  const doc = settings.documentTypes.find(d => d.id === String(id));
  if (doc) {
    doc.description = description;
    settings.docTypes = settings.documentTypes.map(d => d.description);
    saveFinanceSettings(settings);
    res.redirect('/admin/financeiro/configuracoes?tab=documentos&success=Tipo+de+documento+atualizado+com+sucesso.');
  } else {
    res.redirect('/admin/financeiro/configuracoes?tab=documentos&error=Tipo+de+documento+não+encontrado.');
  }
});

router.get('/admin/financeiro/documentos/delete/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const settings = loadFinanceSettings();
  settings.documentTypes = settings.documentTypes || [];
  settings.documentTypes = settings.documentTypes.filter(d => d.id !== String(id));
  settings.docTypes = settings.documentTypes.map(d => d.description);
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=documentos&success=Tipo+de+documento+excluído+com+sucesso.');
});

// --- CATEGORIAS DE PLANO DE CONTAS ---
router.get('/admin/financeiro/categorias', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=categorias');
});

router.post('/admin/financeiro/categorias/add', requireAdmin, (req, res) => {
  const { description, indicator, dreRange } = req.body;
  if (!description || !indicator || !dreRange) {
    return res.redirect('/admin/financeiro/configuracoes?tab=categorias&error=Preencha+todos+os+campos.');
  }
  const settings = loadFinanceSettings();
  settings.accountCategories = settings.accountCategories || [];
  
  const maxId = settings.accountCategories.reduce((max, curr) => Math.max(max, parseInt(curr.id) || 0), 0);
  const newId = String(maxId + 1);
  
  settings.accountCategories.push({ id: newId, description, indicator, dreRange });
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=categorias&success=Categoria+cadastrada+com+sucesso.');
});

router.post('/admin/financeiro/categorias/edit', requireAdmin, (req, res) => {
  const { id, description, indicator, dreRange } = req.body;
  if (!id || !description || !indicator || !dreRange) {
    return res.redirect('/admin/financeiro/configuracoes?tab=categorias&error=Dados+inválidos.');
  }
  const settings = loadFinanceSettings();
  settings.accountCategories = settings.accountCategories || [];
  const cat = settings.accountCategories.find(c => c.id === String(id));
  if (cat) {
    cat.description = description;
    cat.indicator = indicator;
    cat.dreRange = dreRange;
    saveFinanceSettings(settings);
    res.redirect('/admin/financeiro/configuracoes?tab=categorias&success=Categoria+atualizada+com+sucesso.');
  } else {
    res.redirect('/admin/financeiro/configuracoes?tab=categorias&error=Categoria+não+encontrada.');
  }
});

router.get('/admin/financeiro/categorias/delete/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const settings = loadFinanceSettings();
  settings.accountCategories = settings.accountCategories || [];
  settings.accountCategories = settings.accountCategories.filter(c => c.id !== String(id));
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=categorias&success=Categoria+excluída+com+sucesso.');
});

// --- PLANO DE CONTAS (ÁRVORE DINÂMICA) ---
router.get('/admin/financeiro/plano-contas', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=plano-contas');
});

router.post('/admin/financeiro/plano-contas/add', requireAdmin, (req, res) => {
  const { description, categoryId, parentId } = req.body;
  if (!description || !categoryId) {
    return res.redirect('/admin/financeiro/configuracoes?tab=plano-contas&error=Descrição+e+categoria+são+obrigatórias.');
  }
  const settings = loadFinanceSettings();
  settings.chartOfAccountsTree = settings.chartOfAccountsTree || [];
  
  const maxId = settings.chartOfAccountsTree.reduce((max, curr) => Math.max(max, parseInt(curr.id) || 0), 0);
  const newId = String(maxId + 1);

  let initialCode = String(settings.chartOfAccountsTree.length + 1);
  if (parentId) {
    const parent = settings.chartOfAccountsTree.find(x => x.id === String(parentId));
    if (parent) {
      const siblings = settings.chartOfAccountsTree.filter(x => x.parentId === String(parentId));
      initialCode = `${parent.code}.${siblings.length + 1}`;
    }
  }
  
  settings.chartOfAccountsTree.push({
    id: newId,
    code: initialCode,
    description,
    categoryId,
    parentId: parentId ? String(parentId) : null
  });

  settings.chartsOfAccounts = settings.chartOfAccountsTree.map(x => `${x.code} - ${x.description}`);

  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=plano-contas&success=Conta+do+plano+cadastrada+com+sucesso.');
});

router.post('/admin/financeiro/plano-contas/edit', requireAdmin, (req, res) => {
  const { id, description, categoryId } = req.body;
  if (!id || !description || !categoryId) {
    return res.redirect('/admin/financeiro/configuracoes?tab=plano-contas&error=Dados+inválidos.');
  }
  const settings = loadFinanceSettings();
  settings.chartOfAccountsTree = settings.chartOfAccountsTree || [];
  const item = settings.chartOfAccountsTree.find(x => x.id === String(id));
  if (item) {
    item.description = description;
    item.categoryId = categoryId;
    settings.chartsOfAccounts = settings.chartOfAccountsTree.map(x => `${x.code} - ${x.description}`);
    saveFinanceSettings(settings);
    res.redirect('/admin/financeiro/configuracoes?tab=plano-contas&success=Conta+atualizada+com+sucesso.');
  } else {
    res.redirect('/admin/financeiro/configuracoes?tab=plano-contas&error=Conta+não+encontrada.');
  }
});

router.post('/admin/financeiro/plano-contas/reorder', requireAdmin, (req, res) => {
  const { tree, categories } = req.body;
  if (!Array.isArray(tree)) {
    return res.status(400).json({ success: false, error: "Formato de árvore inválido." });
  }
  const settings = loadFinanceSettings();
  settings.chartOfAccountsTree = tree;

  if (Array.isArray(categories) && categories.length > 0) {
    settings.accountCategories = categories;
  }

  settings.chartsOfAccounts = tree.map(x => `${x.code} - ${x.description}`);
  saveFinanceSettings(settings);
  res.json({ success: true });
});

router.get('/admin/financeiro/plano-contas/delete/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const settings = loadFinanceSettings();
  settings.chartOfAccountsTree = settings.chartOfAccountsTree || [];
  
  settings.chartOfAccountsTree = settings.chartOfAccountsTree.filter(x => x.id !== String(id));
  settings.chartOfAccountsTree.forEach(x => {
    if (x.parentId === String(id)) {
      x.parentId = null;
    }
  });

  settings.chartsOfAccounts = settings.chartOfAccountsTree.map(x => `${x.code} - ${x.description}`);
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=plano-contas&success=Conta+excluída+com+sucesso.');
});

// --- CADASTRO DE CLIENTES E FORNECEDORES ---
router.get('/admin/financeiro/pessoas', requireAdmin, (req, res) => {
  res.render('admin/financeiro/pessoas', {
    pessoas: pessoasCache,
    page: 'admin-financeiro-pessoas',
    success_msg: req.query.success === 'saved' ? 'Cadastro salvo com sucesso!' : 
                 (req.query.success === 'deleted' ? 'Cadastro excluído com sucesso!' : 
                 (req.query.success === 'imported' ? (req.query.count ? `${req.query.count} cadastros importados com sucesso!` : 'Importação de CSV realizada com sucesso!') : null)),
    error_msg: req.query.error === 'empty_csv' ? 'Nenhum dado CSV válido foi encontrado.' : 
               (req.query.error === 'csv_import_failed' ? 'Falha ao importar o arquivo CSV. Verifique a formatação.' : 
               (req.query.error ? 'Ocorreu um erro ao processar a solicitação.' : null))
  });
});

router.post('/admin/financeiro/pessoas/save', requireAdmin, (req, res) => {
  try {
    const {
      id,
      personType,
      cpfCnpj,
      name,
      birthday,
      phone,
      email,
      contactName,
      observation,
      cep,
      city,
      uf,
      address,
      bairro,
      number,
      complement
    } = req.body;

    if (!name || !name.trim()) {
      return res.redirect('/admin/financeiro/pessoas?error=missing_name');
    }

    const cleanName = name.trim();

    if (id && id.trim()) {
      // Editar existente
      const idx = pessoasCache.findIndex(p => p.id === id);
      if (idx !== -1) {
        pessoasCache[idx] = {
          ...pessoasCache[idx],
          personType,
          cpfCnpj,
          name: cleanName,
          birthday,
          phone,
          email,
          contactName,
          observation,
          cep,
          city,
          uf,
          address,
          bairro,
          number,
          complement,
          updatedAt: new Date().toISOString()
        };
      } else {
        return res.redirect('/admin/financeiro/pessoas?error=not_found');
      }
    } else {
      // Criar novo
      // Achar maior code e somar 1
      const maxCode = pessoasCache.reduce((max, p) => {
        const c = Number(p.code);
        return (!isNaN(c) && c > max) ? c : max;
      }, 0);
      const nextCode = maxCode > 0 ? maxCode + 1 : 1;
      const nextId = `PES-${Date.now()}`;

      const newPerson = {
        id: nextId,
        code: nextCode,
        personType: personType || 'Cliente',
        cpfCnpj: cpfCnpj || '',
        name: cleanName,
        birthday: birthday || '',
        phone: phone || '',
        email: email || '',
        contactName: contactName || '',
        observation: observation || '',
        cep: cep || '',
        city: city || '',
        uf: uf || 'PR',
        address: address || '',
        bairro: bairro || '',
        number: number || '',
        complement: complement || '',
        createdAt: new Date().toISOString()
      };

      pessoasCache.push(newPerson);
    }

    // Salvar no banco MySQL
    savePessoas(pessoasCache);

    // Sincronizar nome na lista de fornecedores de finance_settings.json
    const settings = loadFinanceSettings();
    if (cleanName && !settings.providers.includes(cleanName)) {
      settings.providers.push(cleanName);
      saveFinanceSettings(settings);
      financeSettingsCache = settings; // Keep cache in sync
    }

    res.redirect('/admin/financeiro/pessoas?success=saved');
  } catch (error) {
    console.error("Erro ao salvar cliente/fornecedor:", error);
    res.redirect('/admin/financeiro/pessoas?error=true');
  }
});

router.post('/admin/financeiro/pessoas/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.redirect('/admin/financeiro/pessoas?error=missing_id');
    }

    const idx = pessoasCache.findIndex(p => p.id === id);
    if (idx !== -1) {
      pessoasCache.splice(idx, 1);
      savePessoas(pessoasCache);
      res.redirect('/admin/financeiro/pessoas?success=deleted');
    } else {
      res.redirect('/admin/financeiro/pessoas?error=not_found');
    }
  } catch (error) {
    console.error("Erro ao excluir cliente/fornecedor:", error);
    res.redirect('/admin/financeiro/pessoas?error=true');
  }
});

// Helper de parsing CSV para Pessoas
function parseCsvRows(content) {
  if (!content) return [];
  let text = content.replace(/^\uFEFF/, '').trim();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  const firstLine = lines[0] || '';
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolonCount >= commaCount ? ';' : ',';

  const rows = [];
  for (let l of lines) {
    if (!l.trim()) continue;
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"' || c === "'") {
        if (inQuotes && l[i + 1] === c) {
          cur += c;
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur.trim());
    rows.push(fields);
  }
  return rows;
}

// Importar Clientes / Fornecedores via CSV (POST)
router.post('/admin/financeiro/pessoas/import-csv', requireAdmin, upload.single('csvFile'), (req, res) => {
  try {
    let rawCsvText = '';
    if (req.file && req.file.buffer) {
      rawCsvText = req.file.buffer.toString('utf-8');
    } else if (req.body && req.body.csvText) {
      rawCsvText = req.body.csvText;
    } else if (req.body && req.body.csvData) {
      rawCsvText = req.body.csvData;
    }

    if (!rawCsvText || !rawCsvText.trim()) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(400).json({ error: 'Nenhum dado CSV fornecido.' });
      }
      return res.redirect('/admin/financeiro/pessoas?error=empty_csv');
    }

    const rows = parseCsvRows(rawCsvText);
    if (rows.length === 0) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(400).json({ error: 'Arquivo CSV sem linhas válidas.' });
      }
      return res.redirect('/admin/financeiro/pessoas?error=empty_csv');
    }

    // Mapeamento de Colunas
    let startIdx = 0;
    const headerRow = rows[0].map(h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    
    // Layout padrão solicitado:
    // 0: Código, 1: CPF/CNPJ, 2: Nome, 3: Tipo, 4: Telefone, 5: Email,
    // 6: Contato, 7: Cidade, 8: UF, 9: Endereco, 10: CEP, 11: Aniversario, 12: Observacao
    let codeIdx = 0;
    let cpfCnpjIdx = 1;
    let nameIdx = 2;
    let typeIdx = 3;
    let phoneIdx = 4;
    let emailIdx = 5;
    let contactIdx = 6;
    let cityIdx = 7;
    let ufIdx = 8;
    let addressIdx = 9;
    let cepIdx = 10;
    let birthdayIdx = 11;
    let obsIdx = 12;

    const hasHeaderKeywords = headerRow.some(h => 
      h.includes('nome') || h.includes('codigo') || h.includes('cpf') || h.includes('tipo')
    );

    if (hasHeaderKeywords) {
      startIdx = 1;
      headerRow.forEach((col, idx) => {
        if (col.includes('codigo') || col.includes('code')) codeIdx = idx;
        else if (col.includes('cpf') || col.includes('cnpj')) cpfCnpjIdx = idx;
        else if (col.includes('nome') && !col.includes('contato')) nameIdx = idx;
        else if (col.includes('tipo')) typeIdx = idx;
        else if (col.includes('telef') || col.includes('cel')) phoneIdx = idx;
        else if (col.includes('mail')) emailIdx = idx;
        else if (col.includes('contato')) contactIdx = idx;
        else if (col.includes('cidade')) cityIdx = idx;
        else if (col.includes('uf') || col.includes('estado')) ufIdx = idx;
        else if (col.includes('ender') || col.includes('rua')) addressIdx = idx;
        else if (col.includes('cep')) cepIdx = idx;
        else if (col.includes('anivers') || col.includes('nasc')) birthdayIdx = idx;
        else if (col.includes('obs') || col.includes('nota')) obsIdx = idx;
      });
    }

    let maxCode = pessoasCache.reduce((max, p) => {
      const c = Number(p.code);
      return (!isNaN(c) && c > max) ? c : max;
    }, 0);

    const updateExisting = req.body.updateExisting === 'true' || req.body.updateExisting === true;
    let importedCount = 0;
    let updatedCount = 0;

    const newProviders = new Set();

    for (let i = startIdx; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const rawName = (row[nameIdx] || '').trim();
      if (!rawName) continue; // Pular se não tiver nome

      const rawCode = (row[codeIdx] || '').trim();
      const rawCpfCnpj = (row[cpfCnpjIdx] || '').trim();
      const rawType = (row[typeIdx] || '').trim();
      const rawPhone = (row[phoneIdx] || '').trim();
      const rawEmail = (row[emailIdx] || '').trim();
      const rawContact = (row[contactIdx] || '').trim();
      const rawCity = (row[cityIdx] || '').trim();
      const rawUf = (row[ufIdx] || '').trim();
      let rawAddress = (row[addressIdx] || '').trim();
      const rawCep = (row[cepIdx] || '').trim();
      const rawBirthday = (row[birthdayIdx] || '').trim();
      const rawObs = (row[obsIdx] || '').trim();

      // Limpar endereço se for apenas vírgulas ", , "
      if (rawAddress.replace(/[,\s]/g, '') === '') {
        rawAddress = '';
      }

      // Normalizar TipoPessoa
      let personType = 'Cliente';
      if (rawType.toLowerCase().includes('forneced')) {
        personType = 'Fornecedor';
      } else if (rawType.toLowerCase().includes('ambos')) {
        personType = 'Fornecedor';
      } else if (rawType.toLowerCase().includes('client')) {
        personType = 'Cliente';
      } else if (rawType) {
        personType = rawType;
      }

      // Verificar se pessoa já existe por Código, CPF/CNPJ ou Nome
      let existingIndex = -1;
      if (rawCode) {
        existingIndex = pessoasCache.findIndex(p => String(p.code) === String(rawCode));
      }
      if (existingIndex === -1 && rawCpfCnpj) {
        existingIndex = pessoasCache.findIndex(p => p.cpfCnpj && p.cpfCnpj === rawCpfCnpj);
      }
      if (existingIndex === -1 && rawName) {
        existingIndex = pessoasCache.findIndex(p => p.name.toLowerCase() === rawName.toLowerCase());
      }

      if (existingIndex !== -1 && updateExisting) {
        // Atualizar existente
        const oldP = pessoasCache[existingIndex];
        pessoasCache[existingIndex] = {
          ...oldP,
          personType: personType || oldP.personType,
          cpfCnpj: rawCpfCnpj || oldP.cpfCnpj,
          name: rawName,
          birthday: rawBirthday || oldP.birthday,
          phone: rawPhone || oldP.phone,
          email: rawEmail || oldP.email,
          contactName: rawContact || oldP.contactName,
          observation: rawObs || oldP.observation,
          cep: rawCep || oldP.cep,
          city: rawCity || oldP.city,
          uf: rawUf || oldP.uf,
          address: rawAddress || oldP.address,
          updatedAt: new Date().toISOString()
        };
        updatedCount++;
      } else if (existingIndex === -1) {
        // Inserir novo
        maxCode++;
        const parsedCode = (rawCode && !isNaN(Number(rawCode))) ? Number(rawCode) : maxCode;
        if (parsedCode > maxCode) maxCode = parsedCode;

        const newPerson = {
          id: `PES-${Date.now()}-${Math.floor(Math.random()*10000)}`,
          code: parsedCode,
          personType: personType,
          cpfCnpj: rawCpfCnpj,
          name: rawName,
          birthday: rawBirthday,
          phone: rawPhone,
          email: rawEmail,
          contactName: rawContact,
          observation: rawObs,
          cep: rawCep,
          city: rawCity || 'Cambará',
          uf: rawUf || 'PR',
          address: rawAddress,
          bairro: '',
          number: '',
          complement: '',
          createdAt: new Date().toISOString()
        };

        pessoasCache.push(newPerson);
        importedCount++;
      }

      if (rawName) {
        newProviders.add(rawName);
      }
    }

    // Salvar no MySQL
    savePessoas(pessoasCache);

    // Sincronizar nomes na lista de fornecedores
    if (newProviders.size > 0) {
      const settings = loadFinanceSettings();
      let settingsChanged = false;
      newProviders.forEach(pName => {
        if (!settings.providers.includes(pName)) {
          settings.providers.push(pName);
          settingsChanged = true;
        }
      });
      if (settingsChanged) {
        saveFinanceSettings(settings);
        financeSettingsCache = settings;
      }
    }

    const totalProcessed = importedCount + updatedCount;

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.json({
        success: true,
        message: `${importedCount} novos cadastros importados e ${updatedCount} atualizados.`,
        importedCount,
        updatedCount,
        totalProcessed
      });
    }

    return res.redirect(`/admin/financeiro/pessoas?success=imported&count=${totalProcessed}`);
  } catch (error) {
    console.error("Erro na importação de CSV de pessoas:", error);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ error: 'Erro ao processar o arquivo CSV.' });
    }
    return res.redirect('/admin/financeiro/pessoas?error=csv_import_failed');
  }
});

// Painel Financeiro - Dashboard (GET)
router.get('/admin/financeiro/dashboard', requireAdmin, (req, res) => {
  const transactions = loadTransactions();
  const settings = loadFinanceSettings();

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentMonthStr = String(currentMonth).padStart(2, '0');
  const currentYearMonth = `${currentYear}-${currentMonthStr}`;

  // Se o usuário selecionou uma competência específica, usamos ela. Caso contrário, o mês atual.
  const selectedCompetence = req.query.competence !== undefined ? req.query.competence : currentYearMonth;

  // Gerar competências disponíveis para o seletor com base em issueDate ou dueDate
  const competencesSet = new Set([currentYearMonth]);
  transactions.forEach(t => {
    const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
    if (m && m.length === 7) {
      competencesSet.add(m);
    }
  });
  const availableCompetences = Array.from(competencesSet).sort().reverse();

  // Helper de formatação de competência
  const formatCompetence = (comp) => {
    if (!comp || comp === 'all') return 'Todos os Meses';
    const [year, month] = comp.split('-');
    const months = {
      '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
      '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
      '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };
    return `${months[month]} / ${year}`;
  };

  // 1. Calcular cartões superiores
  let contasReceberAtraso = 0;
  let contasReceberAbertoMes = 0;
  let contasPagarAbertoMes = 0;
  let contasPagarAtraso = 0;

  transactions.forEach(t => {
    const amount = parseFloat(t.amount) || 0;
    const isPendente = t.status !== 'pago';
    const isAtrasado = isPendente && t.dueDate < todayStr;
    const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
    const isNoMes = selectedCompetence === 'all' || m === selectedCompetence;

    if (t.type === 'receber') {
      if (isAtrasado) {
        contasReceberAtraso += amount;
      }
      if (isPendente && isNoMes) {
        contasReceberAbertoMes += amount;
      }
    } else if (t.type === 'pagar') {
      if (isAtrasado) {
        contasPagarAtraso += amount;
      }
      if (isPendente && isNoMes) {
        contasPagarAbertoMes += amount;
      }
    }
  });

  // 2. Situação no mês atual (Projeções)
  let projRecebimentosMes = 0;
  let projPagamentosMes = 0;

  transactions.forEach(t => {
    const amount = parseFloat(t.amount) || 0;
    const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
    const isNoMes = selectedCompetence === 'all' || m === selectedCompetence;

    if (isNoMes) {
      if (t.type === 'receber') {
        projRecebimentosMes += amount;
      } else if (t.type === 'pagar') {
        projPagamentosMes += amount;
      }
    }
  });

  const projLucroLiquidoMes = projRecebimentosMes - projPagamentosMes;

  // 3. Projeção para os próximos dias (Time series)
  const projectionDays = parseInt(req.query.days) || 30;
  
  // Saldo inicial atual: Todos os recebidos menos os pagos até agora
  let saldoAtual = 0;
  transactions.forEach(t => {
    const amount = parseFloat(t.amount) || 0;
    if (t.status === 'pago') {
      if (t.type === 'receber') {
        saldoAtual += amount;
      } else if (t.type === 'pagar') {
        saldoAtual -= amount;
      }
    }
  });

  const projDaysData = [];
  let tempSaldo = saldoAtual;

  for (let i = 0; i < projectionDays; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);
    const dStr = d.toISOString().split('T')[0];

    // Formato amigável: "21 Jul" ou "21/07"
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const label = `${d.getDate()} ${months[d.getMonth()]}`;

    let receberDia = 0;
    let pagarDia = 0;

    transactions.forEach(t => {
      if (t.dueDate === dStr && t.status !== 'pago') {
        const amount = parseFloat(t.amount) || 0;
        if (t.type === 'receber') {
          receberDia += amount;
        } else if (t.type === 'pagar') {
          pagarDia += amount;
        }
      }
    });

    tempSaldo = tempSaldo + receberDia - pagarDia;

    projDaysData.push({
      date: label,
      rawDate: dStr,
      saldo: tempSaldo,
      receber: receberDia,
      pagar: pagarDia
    });
  }

  // 4. Inadimplência, Próximos a vencer, Vencidos por Cliente/Fornecedor
  // CLIENTES (receber)
  const clientInadimplenciaMap = {};
  const clientProximos = [];
  const clientVencidos = [];

  transactions.forEach(t => {
    if (t.type === 'receber' && t.status !== 'pago') {
      const amount = parseFloat(t.amount) || 0;
      const clientName = t.provider || 'Não Informado';

      if (t.dueDate < todayStr) {
        clientInadimplenciaMap[clientName] = (clientInadimplenciaMap[clientName] || 0) + amount;
        clientVencidos.push(t);
      } else {
        clientProximos.push(t);
      }
    }
  });

  const clientInadimplenciaList = Object.entries(clientInadimplenciaMap)
    .map(([name, val]) => ({ name, value: val }))
    .sort((a, b) => b.value - a.value);

  clientProximos.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  clientVencidos.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));

  // FORNECEDORES (pagar)
  const supplierInadimplenciaMap = {};
  const supplierProximos = [];
  const supplierVencidos = [];

  transactions.forEach(t => {
    if (t.type === 'pagar' && t.status !== 'pago') {
      const amount = parseFloat(t.amount) || 0;
      const supplierName = t.provider || 'Não Informado';

      if (t.dueDate < todayStr) {
        supplierInadimplenciaMap[supplierName] = (supplierInadimplenciaMap[supplierName] || 0) + amount;
        supplierVencidos.push(t);
      } else {
        supplierProximos.push(t);
      }
    }
  });

  const supplierInadimplenciaList = Object.entries(supplierInadimplenciaMap)
    .map(([name, val]) => ({ name, value: val }))
    .sort((a, b) => b.value - a.value);

  supplierProximos.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  supplierVencidos.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));

  res.render('admin/financeiro/dashboard', {
    page: 'admin-financeiro-dashboard',
    contasReceberAtraso,
    contasReceberAbertoMes,
    contasPagarAbertoMes,
    contasPagarAtraso,
    projRecebimentosMes,
    projPagamentosMes,
    projLucroLiquidoMes,
    projDaysData,
    projectionDays,
    clientInadimplenciaList,
    clientProximos,
    clientVencidos,
    supplierInadimplenciaList,
    supplierProximos,
    supplierVencidos,
    contasReceberPendentes: transactions.filter(t => {
      if (t.type !== 'receber' || t.status === 'pago') return false;
      if (selectedCompetence === 'all') return true;
      const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
      return m === selectedCompetence;
    }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    contasPagarPendentes: transactions.filter(t => {
      if (t.type !== 'pagar' || t.status === 'pago') return false;
      if (selectedCompetence === 'all') return true;
      const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
      return m === selectedCompetence;
    }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    todayStr,
    settings,
    selectedCompetence,
    availableCompetences,
    formatCompetence
  });
});

// Painel Financeiro - Relatório de Faturamento (GET)
router.get('/admin/financeiro/relatorio-faturamento', requireAdmin, (req, res) => {
  res.render('admin/financeiro/relatorio-faturamento', {
    page: 'admin-financeiro-relatorio-faturamento'
  });
});

// Redirect /admin/financeiro para Contas a Pagar
router.get('/admin/financeiro', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/contas-pagar');
});

// Contas a Pagar (GET)
router.get('/admin/financeiro/contas-pagar', requireAdmin, (req, res) => {
  const transactions = loadTransactions();
  const settings = loadFinanceSettings();
  
  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];
  const currentYear = today.getFullYear();
  const currentMonthStr = String(today.getMonth() + 1).padStart(2, '0');
  const currentYearMonth = `${currentYear}-${currentMonthStr}`;

  const selectedCompetence = req.query.competence !== undefined ? req.query.competence : currentYearMonth;

  // Transações do tipo 'pagar'
  const pagarTxs = transactions.filter(t => t.type === 'pagar');

  // Competências disponíveis
  const competencesSet = new Set([currentYearMonth]);
  pagarTxs.forEach(t => {
    const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
    if (m && m.length === 7) {
      competencesSet.add(m);
    }
  });
  const availableCompetences = Array.from(competencesSet).sort().reverse();

  const formatCompetence = (comp) => {
    if (!comp || comp === 'all') return 'Todos os Meses';
    const [year, month] = comp.split('-');
    const months = {
      '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
      '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
      '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };
    return `${months[month]} / ${year}`;
  };

  // Filtragem por competência
  let competenceFiltered = [...pagarTxs];
  if (selectedCompetence && selectedCompetence !== 'all') {
    competenceFiltered = competenceFiltered.filter(t => {
      const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
      return m === selectedCompetence;
    });
  }

  // Estatísticas da competência
  const stats = {
    totalPagarPendente: 0,
    totalPagarPago: 0,
    totalAtrasado: 0,
    countAtrasado: 0,
    totalVenceHoje: 0,
    countVenceHoje: 0
  };

  competenceFiltered.forEach(t => {
    const amount = parseFloat(t.amount) || 0;
    if (t.status === 'pago') {
      stats.totalPagarPago += amount;
    } else {
      stats.totalPagarPendente += amount;
      if (t.dueDate < todayISO) {
        stats.totalAtrasado += amount;
        stats.countAtrasado += 1;
      } else if (t.dueDate === todayISO) {
        stats.totalVenceHoje += amount;
        stats.countVenceHoje += 1;
      }
    }
  });

  // Outros filtros
  let filtered = [...competenceFiltered];
  const { status, provider, chart, start_date, end_date } = req.query;

  if (status && status !== 'all') {
    filtered = filtered.filter(t => t.status === status);
  }
  if (provider && provider !== 'all') {
    filtered = filtered.filter(t => t.provider === provider);
  }
  if (chart && chart !== 'all') {
    filtered = filtered.filter(t => t.chartOfAccounts === chart);
  }
  if (start_date) {
    filtered = filtered.filter(t => t.dueDate >= start_date);
  }
  if (end_date) {
    filtered = filtered.filter(t => t.dueDate <= end_date);
  }

  filtered.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  // Filtrar pessoas de pessoasCache para Contas a Pagar: somente tipo 'Cliente'
  const pagarProvidersPessoas = pessoasCache
    .filter(p => p.name && (p.personType || '').toLowerCase().includes('cliente'))
    .map(p => p.name.trim());
  const sortedPagarProviders = Array.from(new Set(pagarProvidersPessoas)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  
  const customSettingsPagar = {
    ...settings,
    providers: sortedPagarProviders.length > 0 ? sortedPagarProviders : settings.providers
  };

  res.render('admin/financeiro/contas-pagar', {
    transactions: filtered,
    settings: customSettingsPagar,
    stats,
    filters: req.query || {},
    page: 'admin-financeiro-contas-pagar',
    selectedCompetence,
    availableCompetences,
    formatCompetence
  });
});

// Contas a Receber (GET)
router.get('/admin/financeiro/contas-receber', requireAdmin, (req, res) => {
  const transactions = loadTransactions();
  const settings = loadFinanceSettings();
  
  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];
  const currentYear = today.getFullYear();
  const currentMonthStr = String(today.getMonth() + 1).padStart(2, '0');
  const currentYearMonth = `${currentYear}-${currentMonthStr}`;

  const selectedCompetence = req.query.competence !== undefined ? req.query.competence : currentYearMonth;

  // Transações do tipo 'receber'
  const receberTxs = transactions.filter(t => t.type === 'receber');

  // Competências disponíveis
  const competencesSet = new Set([currentYearMonth]);
  receberTxs.forEach(t => {
    const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
    if (m && m.length === 7) {
      competencesSet.add(m);
    }
  });
  const availableCompetences = Array.from(competencesSet).sort().reverse();

  const formatCompetence = (comp) => {
    if (!comp || comp === 'all') return 'Todos os Meses';
    const [year, month] = comp.split('-');
    const months = {
      '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
      '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
      '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };
    return `${months[month]} / ${year}`;
  };

  // Filtragem por competência
  let competenceFiltered = [...receberTxs];
  if (selectedCompetence && selectedCompetence !== 'all') {
    competenceFiltered = competenceFiltered.filter(t => {
      const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
      return m === selectedCompetence;
    });
  }

  // Estatísticas da competência
  const stats = {
    totalReceberPendente: 0,
    totalReceberPago: 0,
    totalAtrasado: 0,
    countAtrasado: 0,
    totalVenceHoje: 0,
    countVenceHoje: 0
  };

  competenceFiltered.forEach(t => {
    const amount = parseFloat(t.amount) || 0;
    if (t.status === 'pago') {
      stats.totalReceberPago += amount;
    } else {
      stats.totalReceberPendente += amount;
      if (t.dueDate < todayISO) {
        stats.totalAtrasado += amount;
        stats.countAtrasado += 1;
      } else if (t.dueDate === todayISO) {
        stats.totalVenceHoje += amount;
        stats.countVenceHoje += 1;
      }
    }
  });

  // Outros filtros
  let filtered = [...competenceFiltered];
  const { status, provider, chart, start_date, end_date } = req.query;

  if (status && status !== 'all') {
    filtered = filtered.filter(t => t.status === status);
  }
  if (provider && provider !== 'all') {
    filtered = filtered.filter(t => t.provider === provider);
  }
  if (chart && chart !== 'all') {
    filtered = filtered.filter(t => t.chartOfAccounts === chart);
  }
  if (start_date) {
    filtered = filtered.filter(t => t.dueDate >= start_date);
  }
  if (end_date) {
    filtered = filtered.filter(t => t.dueDate <= end_date);
  }

  filtered.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  // Filtrar pessoas de pessoasCache para Contas a Receber: somente tipo 'Fornecedor'
  const receberProvidersPessoas = pessoasCache
    .filter(p => p.name && (p.personType || '').toLowerCase().includes('forneced'))
    .map(p => p.name.trim());
  const sortedReceberProviders = Array.from(new Set(receberProvidersPessoas)).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const customSettingsReceber = {
    ...settings,
    providers: sortedReceberProviders.length > 0 ? sortedReceberProviders : settings.providers
  };

  res.render('admin/financeiro/contas-receber', {
    transactions: filtered,
    settings: customSettingsReceber,
    stats,
    filters: req.query || {},
    page: 'admin-financeiro-contas-receber',
    selectedCompetence,
    availableCompetences,
    formatCompetence
  });
});

// Cadastrar Nova Transação (POST)
router.post('/admin/financeiro/add', requireAdmin, (req, res) => {
  const {
    type, number, issueDate, docNumber, provider, docType,
    chartOfAccounts, bank, tags, description, amount,
    installments, dueDate, interval, recurrent, status, paidAt
  } = req.body;

  if (!type || !provider || !chartOfAccounts || !amount || !dueDate) {
    return res.status(400).send("Campos obrigatorios ausentes. Por favor preencha Fornecedor, Plano de Contas, Valor, Tipo e Data de Vencimento.");
  }

  const transactions = loadTransactions();
  
  // Formatar as tags
  let tagsArray = [];
  if (tags) {
    if (typeof tags === 'string') {
      tagsArray = tags.split(',').map(t => t.trim()).filter(Boolean);
    } else if (Array.isArray(tags)) {
      tagsArray = tags.map(t => String(t).trim()).filter(Boolean);
    }
  }

  const createdBy = req.cookies.admin_user_name || 'Administrador';

  const newTx = {
    id: "TX-" + Date.now() + Math.floor(Math.random() * 1000),
    type,
    number: (number || '').trim(),
    issueDate: (issueDate || new Date().toISOString().split('T')[0]).trim(),
    docNumber: (docNumber || '').trim(),
    provider: (provider || '').trim(),
    docType: (docType || '').trim(),
    chartOfAccounts: (chartOfAccounts || '').trim(),
    bank: (bank || '').trim(),
    tags: tagsArray,
    description: (description || '').trim(),
    amount: parseFloat(amount) || 0,
    installments: parseInt(installments) || 1,
    dueDate: (dueDate || '').trim(),
    interval: (interval || 'Mensal').trim(),
    recurrent: recurrent === 'true' || recurrent === 'on' || recurrent === true,
    status: status || 'pendente',
    paidAt: (status === 'pago') ? (paidAt || new Date().toISOString().split('T')[0]) : '',
    createdAt: new Date().toISOString(),
    createdBy
  };

  transactions.unshift(newTx);
  saveTransactions(transactions);

  if (status === 'pago') {
    logFinancialMovement(newTx, newTx.paidAt);
  }

  res.redirect(req.get('referer') || (type === 'pagar' ? '/admin/financeiro/contas-pagar' : '/admin/financeiro/contas-receber'));
});

// Editar Transação Existente (POST)
router.post('/admin/financeiro/edit', requireAdmin, (req, res) => {
  const {
    id, type, number, issueDate, docNumber, provider, docType,
    chartOfAccounts, bank, tags, description, amount,
    installments, dueDate, interval, recurrent, status, paidAt
  } = req.body;

  if (!id) {
    return res.status(400).send("ID da transacao ausente");
  }

  const transactions = loadTransactions();
  const index = transactions.findIndex(t => t.id === id);

  if (index !== -1) {
    let tagsArray = [];
    if (tags) {
      if (typeof tags === 'string') {
        tagsArray = tags.split(',').map(t => t.trim()).filter(Boolean);
      } else if (Array.isArray(tags)) {
        tagsArray = tags.map(t => String(t).trim()).filter(Boolean);
      }
    }

    const oldStatus = transactions[index].status;
    const resolvedPaidAt = (status === 'pago') ? (paidAt || transactions[index].paidAt || new Date().toISOString().split('T')[0]) : '';

    transactions[index] = {
      ...transactions[index],
      type: type || transactions[index].type,
      number: (number !== undefined) ? number.trim() : transactions[index].number,
      issueDate: (issueDate !== undefined) ? issueDate.trim() : transactions[index].issueDate,
      docNumber: (docNumber !== undefined) ? docNumber.trim() : transactions[index].docNumber,
      provider: (provider !== undefined) ? provider.trim() : transactions[index].provider,
      docType: (docType !== undefined) ? docType.trim() : transactions[index].docType,
      chartOfAccounts: (chartOfAccounts !== undefined) ? chartOfAccounts.trim() : transactions[index].chartOfAccounts,
      bank: (bank !== undefined) ? bank.trim() : transactions[index].bank,
      tags: tagsArray,
      description: (description !== undefined) ? description.trim() : transactions[index].description,
      amount: (amount !== undefined) ? (parseFloat(amount) || 0) : transactions[index].amount,
      installments: (installments !== undefined) ? (parseInt(installments) || 1) : transactions[index].installments,
      dueDate: (dueDate !== undefined) ? dueDate.trim() : transactions[index].dueDate,
      interval: (interval !== undefined) ? interval.trim() : transactions[index].interval,
      recurrent: recurrent === 'true' || recurrent === 'on' || recurrent === true,
      status: status || transactions[index].status,
      paidAt: resolvedPaidAt,
      updatedAt: new Date().toISOString(),
      updatedBy: req.cookies.admin_user_name || 'Administrador'
    };

    saveTransactions(transactions);

    if (status === 'pago' && oldStatus !== 'pago') {
      logFinancialMovement(transactions[index], resolvedPaidAt);
    }
  }

  res.redirect(req.get('referer') || '/admin/financeiro/contas-pagar');
});

// Alterar Status de Pagamento (POST)
router.post('/admin/financeiro/status', requireAdmin, (req, res) => {
  const { id, status, paidAt, bank } = req.body;
  if (!id) return res.status(400).send("ID ausente");

  const transactions = loadTransactions();
  const index = transactions.findIndex(t => t.id === id);

  if (index !== -1) {
    const oldStatus = transactions[index].status;
    transactions[index].status = status;
    const resolvedPaidAt = (status === 'pago') ? (paidAt || new Date().toISOString().split('T')[0]) : '';
    transactions[index].paidAt = resolvedPaidAt;
    
    if (bank) {
      transactions[index].bank = bank;
    }
    
    saveTransactions(transactions);

    if (status === 'pago' && oldStatus !== 'pago') {
      logFinancialMovement(transactions[index], resolvedPaidAt);
    }
  }

  res.redirect(req.get('referer') || '/admin/financeiro/contas-pagar');
});

// Deletar Transação (POST)
router.post('/admin/financeiro/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send("ID ausente");

  let transactions = loadTransactions();
  transactions = transactions.filter(t => t.id !== id);
  saveTransactions(transactions);

  res.redirect(req.get('referer') || '/admin/financeiro/contas-pagar');
});

// Fluxo de Caixa Diário (GET)
router.get('/admin/financeiro/fluxo-caixa', requireAdmin, (req, res) => {
  const movements = loadMovements();
  const transactions = loadTransactions();
  const settings = loadFinanceSettings();

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonthStr = String(today.getMonth() + 1).padStart(2, '0');
  const currentYearMonth = `${currentYear}-${currentMonthStr}`;

  // Filtros de busca
  const selectedMonth = req.query.month || currentYearMonth; // Formato YYYY-MM
  const selectedBank = req.query.bank || 'all';
  const selectedFilial = req.query.filial || 'Laboratório Inovalab';
  const considerTransfers = req.query.transfers !== 'no'; // Default true

  // Gerar meses/anos disponíveis de competência
  const monthsSet = new Set([currentYearMonth]);
  movements.forEach(m => {
    if (m.date && m.date.length >= 7) {
      monthsSet.add(m.date.substring(0, 7));
    }
  });
  transactions.forEach(t => {
    const m = t.issueDate ? t.issueDate.substring(0, 7) : (t.dueDate ? t.dueDate.substring(0, 7) : '');
    if (m && m.length === 7) {
      monthsSet.add(m);
    }
  });
  const availableMonths = Array.from(monthsSet).sort().reverse();

  // Obter dias do mês selecionado
  const [year, month] = selectedMonth.split('-').map(Number);
  const totalDays = new Date(year, month, 0).getDate();
  const startOfMonthStr = `${selectedMonth}-01`;

  // Helper de formatação de mês/ano para exibição
  const formatMonthDisplay = (mStr) => {
    if (!mStr) return '';
    const [y, m] = mStr.split('-');
    const months = {
      '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
      '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
      '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };
    return `${months[m]} de ${y}`;
  };

  // 1. Calcular Saldo Inicial Anterior para Realizado (Soma de todos os movimentos anteriores)
  let saldoAnteriorRealizado = 0;
  movements.forEach(m => {
    if (m.date < startOfMonthStr) {
      if (selectedBank === 'all' || m.bank === selectedBank) {
        saldoAnteriorRealizado += parseFloat(m.amount) || 0;
      }
    }
  });

  // 2. Calcular Saldo Inicial Anterior para Projetado
  // O saldo projetado anterior inclui o saldo realizado anterior mais todas as transações previstas anteriores que NÃO foram pagas (ou todas as transações previstas anteriores)
  let saldoAnteriorProjetado = saldoAnteriorRealizado;
  transactions.forEach(t => {
    if (t.dueDate < startOfMonthStr && t.status !== 'pago') {
      if (selectedBank === 'all' || t.bank === selectedBank) {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'receber') {
          saldoAnteriorProjetado += amt;
        } else if (t.type === 'pagar') {
          saldoAnteriorProjetado -= amt;
        }
      }
    }
  });

  // 3. Loops Diários para Preencher Tabelas
  const dailyRealizado = [];
  const dailyProjetado = [];

  let runningRealizado = saldoAnteriorRealizado;
  let runningProjetado = saldoAnteriorProjetado;

  for (let day = 1; day <= totalDays; day++) {
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${selectedMonth}-${dayStr}`;

    // --- REALIZADO ---
    let realizedIn = 0;
    let realizedOut = 0;
    movements.forEach(m => {
      if (m.date === dateStr) {
        if (selectedBank === 'all' || m.bank === selectedBank) {
          const amt = parseFloat(m.amount) || 0;
          if (amt > 0) {
            realizedIn += amt;
          } else {
            realizedOut += Math.abs(amt);
          }
        }
      }
    });

    const dayBalanceRealized = realizedIn - realizedOut;
    runningRealizado += dayBalanceRealized;

    dailyRealizado.push({
      day,
      entradas: realizedIn,
      saidas: realizedOut,
      saldoDia: dayBalanceRealized,
      saldoMes: runningRealizado
    });

    // --- PROJETADO ---
    let projectedIn = 0;
    let projectedOut = 0;
    transactions.forEach(t => {
      if (t.dueDate === dateStr) {
        if (selectedBank === 'all' || t.bank === selectedBank) {
          const amt = parseFloat(t.amount) || 0;
          if (t.type === 'receber') {
            projectedIn += amt;
          } else if (t.type === 'pagar') {
            projectedOut += amt;
          }
        }
      }
    });

    const dayBalanceProjected = projectedIn - projectedOut;
    runningProjetado += dayBalanceProjected;

    dailyProjetado.push({
      day,
      entradas: projectedIn,
      saidas: projectedOut,
      saldoDia: dayBalanceProjected,
      saldoMes: runningProjetado
    });
  }

  res.render('admin/financeiro/fluxo-caixa', {
    settings,
    selectedMonth,
    selectedBank,
    selectedFilial,
    considerTransfers,
    availableMonths,
    formatMonthDisplay,
    saldoAnteriorRealizado,
    saldoAnteriorProjetado,
    dailyRealizado,
    dailyProjetado,
    page: 'admin-financeiro-fluxo-caixa'
  });
});

// Demonstrativo de Resultado (GET)
router.get('/admin/financeiro/dre', requireAdmin, (req, res) => {
  const transactions = loadTransactions();
  const movements = loadMovements();
  const settings = loadFinanceSettings();

  const today = new Date();
  const currentYear = today.getFullYear().toString();
  const selectedYear = req.query.year || '2026';
  const selectedFilial = req.query.filial || 'Laboratório Inovalab';

  // Gerar anos disponíveis para filtro
  const yearsSet = new Set(['2026', currentYear]);
  transactions.forEach(t => {
    const d = t.issueDate || t.dueDate;
    if (d && d.length >= 4) {
      yearsSet.add(d.substring(0, 4));
    }
  });
  movements.forEach(m => {
    if (m.date && m.date.length >= 4) {
      yearsSet.add(m.date.substring(0, 4));
    }
  });
  const availableYears = Array.from(yearsSet).sort().reverse();

  // Obter categorias e plano de contas
  const categoriesList = settings.accountCategories || [];
  const tree = settings.chartOfAccountsTree || [];

  // Mapeamento das 6 seções padrão do DRE
  const DRE_SECTIONS_CONFIG = [
    { id: "receitas", title: "(+) RECEITA BRUTA", range: "Receitas", isCredit: true, code: "1" },
    { id: "deducoes", title: "(-) DEDUÇÕES SOBRE VENDAS", range: "Deduções sobre vendas", isCredit: false, code: "2" },
    { id: "custos_variaveis", title: "(-) CUSTOS VARIÁVEIS", range: "Custos variáveis", isCredit: false, code: "3" },
    { id: "custos_fixos", title: "(-) CUSTOS FIXOS", range: "Custos fixos", isCredit: false, code: "4" },
    { id: "despesas_financeiras", title: "(-) DESPESAS FINANCEIRAS", range: "Despesas financeiras", isCredit: false, code: "5" },
    { id: "investimentos", title: "(-) INVESTIMENTOS", range: "Investimentos", isCredit: false, code: "6" }
  ];

  const dreData = { sections: [] };
  const categoryMap = {};

  DRE_SECTIONS_CONFIG.forEach(secCfg => {
    const secNode = {
      id: secCfg.id,
      title: secCfg.title,
      range: secCfg.range,
      isCredit: secCfg.isCredit,
      code: secCfg.code,
      categories: []
    };
    dreData.sections.push(secNode);

    // Filtrar categorias pertencentes a esta faixa DRE
    const matchedCats = categoriesList.filter(c => (c.dreRange || 'Receitas').trim().toLowerCase() === secCfg.range.toLowerCase());

    matchedCats.forEach((cat, catIdx) => {
      const catCode = cat.code || `${secCfg.code}.${catIdx + 1}`;
      cat.code = catCode;

      const catNode = {
        id: String(cat.id),
        code: catCode,
        description: cat.description,
        total: Array(12).fill(0),
        accountsList: [],
        accountsMap: {}
      };
      secNode.categories.push(catNode);
      categoryMap[String(cat.id)] = catNode;

      // Buscar itens do Plano de Contas (tree) para esta categoria
      const matchedTreeItems = tree.filter(t => String(t.categoryId) === String(cat.id));
      matchedTreeItems.forEach((acc) => {
        const accCode = acc.code;

        const accNode = {
          id: String(acc.id),
          code: accCode,
          description: acc.description,
          label: `${accCode} - ${acc.description}`,
          monthly: Array(12).fill(0)
        };
        catNode.accountsList.push(accNode);
        catNode.accountsMap[String(acc.id)] = accNode;
        catNode.accountsMap[acc.description.toLowerCase().trim()] = accNode;
        catNode.accountsMap[`${accCode} - ${acc.description}`.toLowerCase().trim()] = accNode;
        if (acc.code) {
          catNode.accountsMap[acc.code.toLowerCase().trim()] = accNode;
        }
      });
    });
  });

  // Auxiliares de busca de Plano de Contas e Categoria Fallback
  const findChartNode = (chartName) => {
    if (!chartName) return null;
    const cleanName = chartName.trim().toLowerCase();
    
    // 1. Tenta correspondência por código de prefixo (ex: "1.1.1" de "1.1.1 - Convênio Particular")
    let codePrefix = null;
    const codeMatch = cleanName.match(/^([\d\.]+)/);
    if (codeMatch) {
      codePrefix = codeMatch[1];
      const byCode = tree.find(x => x.code && x.code.toLowerCase() === codePrefix);
      if (byCode) return byCode;
    }

    // 2. Tenta correspondência exata por id, por código ou por "code - description" / "description"
    let matched = tree.find(x => {
      if (String(x.id) === String(chartName)) return true;
      if (x.code && x.code.toLowerCase() === cleanName) return true;
      const full = `${x.code} - ${x.description}`.toLowerCase();
      return full === cleanName || x.description.toLowerCase() === cleanName;
    });
    if (matched) return matched;

    // 3. Busca parcial por descrição
    matched = tree.find(x => {
      const desc = x.description.toLowerCase();
      return cleanName.includes(desc) || desc.includes(cleanName);
    });
    if (matched) return matched;

    return null;
  };

  const findCategoryFallback = (chartName, type) => {
    if (!chartName) return null;
    const cleanName = chartName.trim().toLowerCase();
    
    // Busca categoria diretamente pelo nome
    const matchedCat = categoriesList.find(c => {
      const desc = c.description.toLowerCase();
      return cleanName.includes(desc) || desc.includes(cleanName);
    });
    if (matchedCat) return matchedCat;

    // Regras de inteligência artificial de classificação para contas legadas ou manuais
    if (cleanName.includes('simples') || cleanName.includes('imposto') || cleanName.includes('das') || cleanName.includes('dedução') || cleanName.includes('estorno')) {
      return categoriesList.find(c => String(c.id) === '2') || categoriesList.find(c => c.dreRange === 'Deduções sobre vendas') || categoriesList[0];
    }
    if (cleanName.includes('alvaro') || cleanName.includes('pardini') || cleanName.includes('apoio')) {
      return categoriesList.find(c => String(c.id) === '3') || categoriesList.find(c => c.dreRange === 'Custos variáveis') || categoriesList[0];
    }
    if (cleanName.includes('insumo') || cleanName.includes('reagente')) {
      return categoriesList.find(c => String(c.id) === '4') || categoriesList.find(c => c.dreRange === 'Custos variáveis') || categoriesList[0];
    }
    if (cleanName.includes('aquisi') || cleanName.includes('compra')) {
      return categoriesList.find(c => String(c.id) === '5') || categoriesList.find(c => c.dreRange === 'Custos variáveis') || categoriesList[0];
    }
    if (cleanName.includes('café') || cleanName.includes('cafe') || cleanName.includes('aliment')) {
      return categoriesList.find(c => String(c.id) === '6') || categoriesList.find(c => c.dreRange === 'Custos variáveis') || categoriesList[0];
    }
    if (cleanName.includes('combust') || cleanName.includes('gasolina') || cleanName.includes('veículo')) {
      return categoriesList.find(c => String(c.id) === '7') || categoriesList.find(c => c.dreRange === 'Custos variáveis') || categoriesList[0];
    }
    if (cleanName.includes('aluguel') || cleanName.includes('energia') || cleanName.includes('água') || cleanName.includes('internet') || cleanName.includes('manutenção') || cleanName.includes('administra')) {
      return categoriesList.find(c => String(c.id) === '9') || categoriesList.find(c => c.dreRange === 'Custos fixos') || categoriesList[0];
    }
    if (cleanName.includes('pró-labore') || cleanName.includes('salário') || cleanName.includes('pessoal') || cleanName.includes('rh') || cleanName.includes('fgts') || cleanName.includes('inss')) {
      return categoriesList.find(c => String(c.id) === '8') || categoriesList.find(c => c.dreRange === 'Custos fixos') || categoriesList[0];
    }
    if (cleanName.includes('mkt') || cleanName.includes('marketing') || cleanName.includes('propaganda') || cleanName.includes('divulga')) {
      return categoriesList.find(c => String(c.id) === '10') || categoriesList.find(c => c.dreRange === 'Custos fixos') || categoriesList[0];
    }
    if (cleanName.includes('juro') || cleanName.includes('tarifa') || cleanName.includes('banco') || cleanName.includes('financeir')) {
      return categoriesList.find(c => String(c.id) === '11') || categoriesList.find(c => c.dreRange === 'Despesas financeiras') || categoriesList[0];
    }
    if (cleanName.includes('ativo') || cleanName.includes('investimento') || cleanName.includes('equipamento')) {
      return categoriesList.find(c => String(c.id) === '12') || categoriesList.find(c => c.dreRange === 'Investimentos') || categoriesList[0];
    }

    if (type === 'pagar') {
      return categoriesList.find(c => c.dreRange === 'Custos variáveis') || categoriesList.find(c => c.dreRange === 'Custos fixos') || categoriesList[0];
    } else {
      return categoriesList.find(c => c.dreRange === 'Receitas') || categoriesList[0];
    }
  };

  // Função centralizada para adicionar valor a uma conta do plano de contas
  const addValToAccount = (chartName, type, mIdx, amt) => {
    if (mIdx < 0 || mIdx > 11 || !amt || amt === 0) return;

    const node = findChartNode(chartName);
    let catId = node ? String(node.categoryId) : null;
    let cat = catId ? categoriesList.find(c => String(c.id) === catId) : null;
    if (!cat) {
      cat = findCategoryFallback(chartName, type);
    }
    if (!cat) return;

    let catNode = categoryMap[String(cat.id)];
    if (!catNode) return;

    let accNode = null;
    if (node) {
      accNode = catNode.accountsMap[String(node.id)];
    }
    if (!accNode && chartName) {
      const clean = chartName.trim().toLowerCase();
      accNode = catNode.accountsMap[clean];
    }

    if (!accNode) {
      const desc = (node ? node.description : (chartName || cat.description)).replace(/^[\d\.]+\s*-\s*/, '').trim().toLowerCase();
      accNode = catNode.accountsList.find(a => a.description.toLowerCase().includes(desc) || desc.includes(a.description.toLowerCase()));
      if (!accNode && catNode.accountsList.length > 0) {
        accNode = catNode.accountsList[0];
      }
    }

    if (accNode) {
      accNode.monthly[mIdx] += amt;
    }
    catNode.total[mIdx] += amt;
  };

  const selectedMonth = req.query.month || 'all';

  // Obter mês da data com suporte a múltiplos formatos de data
  const getMonthIndex = (dateStr) => {
    if (!dateStr) return -1;
    let s = String(dateStr).trim();
    if (s.includes('T')) s = s.split('T')[0];

    // Se for YYYY-MM-DD ou YYYY/MM/DD
    let parts = s.split(/[-\/]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) { // YYYY-MM-DD
        if (parts[0] === selectedYear) {
          const m = parseInt(parts[1], 10) - 1;
          if (m >= 0 && m <= 11) return m;
        }
      } else if (parts[2].length === 4) { // DD-MM-YYYY
        if (parts[2] === selectedYear) {
          const m = parseInt(parts[1], 10) - 1;
          if (m >= 0 && m <= 11) return m;
        }
      }
    }
    
    // Fallback de parseamento via Date
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      if (String(dt.getFullYear()) === selectedYear) {
        return dt.getMonth();
      }
    }
    return -1;
  };

  // Agrega dados reais de Movimentações (Movimentações Realizadas)
  movements.forEach(m => {
    if (selectedFilial !== 'Todas' && (m.filial || 'Laboratório Inovalab') !== selectedFilial) return;
    const d = m.date || m.createdAt;
    const mIdx = getMonthIndex(d);
    if (mIdx < 0 || mIdx > 11) return;
    const amt = Math.abs(parseFloat(m.amount) || 0);
    const type = m.type || (parseFloat(m.amount) > 0 ? 'receber' : 'pagar');
    addValToAccount(m.chartOfAccounts, type, mIdx, amt);
  });

  // Definir índices alvo para cálculo dos totais (Anual x Mês Selecionado)
  const targetIndices = (selectedMonth && selectedMonth !== 'all')
    ? [parseInt(selectedMonth, 10) - 1]
    : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  // Calcular subtotais e totais por mês
  const totals = {
    receitas: Array(12).fill(0),
    deducoes: Array(12).fill(0),
    receitaLiquida: Array(12).fill(0),
    custosVariaveis: Array(12).fill(0),
    margemContribuicao: Array(12).fill(0),
    percentMargemContribuicao: Array(12).fill(0),
    custosFixos: Array(12).fill(0),
    resultadoOperacional: Array(12).fill(0),
    despesasFinanceiras: Array(12).fill(0),
    investimentos: Array(12).fill(0),
    resultadoLiquido: Array(12).fill(0)
  };

  for (let i = 0; i < 12; i++) {
    const secReceitas = dreData.sections.find(s => s.id === 'receitas');
    totals.receitas[i] = secReceitas ? secReceitas.categories.reduce((sum, c) => sum + c.total[i], 0) : 0;

    const secDeducoes = dreData.sections.find(s => s.id === 'deducoes');
    totals.deducoes[i] = secDeducoes ? secDeducoes.categories.reduce((sum, c) => sum + c.total[i], 0) : 0;

    totals.receitaLiquida[i] = totals.receitas[i] - totals.deducoes[i];

    const secCustosVar = dreData.sections.find(s => s.id === 'custos_variaveis');
    totals.custosVariaveis[i] = secCustosVar ? secCustosVar.categories.reduce((sum, c) => sum + c.total[i], 0) : 0;

    totals.margemContribuicao[i] = totals.receitaLiquida[i] - totals.custosVariaveis[i];
    totals.percentMargemContribuicao[i] = totals.receitaLiquida[i] > 0 ? (totals.margemContribuicao[i] / totals.receitaLiquida[i]) * 100 : 0;

    const secCustosFix = dreData.sections.find(s => s.id === 'custos_fixos');
    totals.custosFixos[i] = secCustosFix ? secCustosFix.categories.reduce((sum, c) => sum + c.total[i], 0) : 0;

    totals.resultadoOperacional[i] = totals.margemContribuicao[i] - totals.custosFixos[i];

    const secDespesasFin = dreData.sections.find(s => s.id === 'despesas_financeiras');
    totals.despesasFinanceiras[i] = secDespesasFin ? secDespesasFin.categories.reduce((sum, c) => sum + c.total[i], 0) : 0;

    const secInvestimentos = dreData.sections.find(s => s.id === 'investimentos');
    totals.investimentos[i] = secInvestimentos ? secInvestimentos.categories.reduce((sum, c) => sum + c.total[i], 0) : 0;

    totals.resultadoLiquido[i] = totals.resultadoOperacional[i] - totals.despesasFinanceiras[i] - totals.investimentos[i];
  }

  const sumIndices = (arr, indices) => indices.reduce((sum, idx) => sum + (arr[idx] || 0), 0);

  const annualTotals = {
    receitas: sumIndices(totals.receitas, targetIndices),
    deducoes: sumIndices(totals.deducoes, targetIndices),
    receitaLiquida: sumIndices(totals.receitaLiquida, targetIndices),
    custosVariaveis: sumIndices(totals.custosVariaveis, targetIndices),
    margemContribuicao: sumIndices(totals.margemContribuicao, targetIndices),
    percentMargemContribuicao: sumIndices(totals.receitaLiquida, targetIndices) > 0 
      ? (sumIndices(totals.margemContribuicao, targetIndices) / sumIndices(totals.receitaLiquida, targetIndices)) * 100 
      : 0,
    custosFixos: sumIndices(totals.custosFixos, targetIndices),
    resultadoOperacional: sumIndices(totals.resultadoOperacional, targetIndices),
    despesasFinanceiras: sumIndices(totals.despesasFinanceiras, targetIndices),
    investimentos: sumIndices(totals.investimentos, targetIndices),
    resultadoLiquido: sumIndices(totals.resultadoLiquido, targetIndices)
  };

  // Resumo de Contas do Plano de Contas para gráficos do DRE
  const planoContasSummary = [];
  dreData.sections.forEach(sec => {
    sec.categories.forEach(cat => {
      cat.accountsList.forEach(acc => {
        const periodTotal = sumIndices(acc.monthly, targetIndices);
        planoContasSummary.push({
          account: `${acc.code} - ${acc.description}`,
          code: acc.code,
          description: acc.description,
          sectionId: sec.id,
          sectionTitle: sec.title,
          isCredit: sec.isCredit,
          categoryId: cat.id,
          categoryName: `${cat.code} - ${cat.description}`,
          monthly: acc.monthly,
          total: periodTotal
        });
      });
    });
  });

  res.render('admin/financeiro/dre', {
    settings,
    selectedYear,
    selectedMonth,
    selectedFilial,
    availableYears,
    dreData,
    totals,
    annualTotals,
    planoContasSummary,
    page: 'admin-financeiro-dre'
  });
});

// Listagem de Movimentações Financeiras (GET)
router.get('/admin/financeiro/movimentacoes', requireAdmin, (req, res) => {
  const movements = loadMovements();
  const settings = loadFinanceSettings();

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonthStr = String(today.getMonth() + 1).padStart(2, '0');
  const currentYearMonth = `${currentYear}-${currentMonthStr}`;

  // Se o usuário selecionou uma competência específica, usamos ela. Caso contrário, o mês atual.
  const selectedCompetence = req.query.competence !== undefined ? req.query.competence : currentYearMonth;

  // Gerar competências disponíveis para o seletor com base no campo 'date' das movimentações
  const competencesSet = new Set([currentYearMonth]);
  movements.forEach(m => {
    if (m.date && m.date.length >= 7) {
      competencesSet.add(m.date.substring(0, 7));
    }
  });
  const availableCompetences = Array.from(competencesSet).sort().reverse();

  // Helper de formatação de competência
  const formatCompetence = (comp) => {
    if (!comp || comp === 'all') return 'Todos os Meses';
    const [year, month] = comp.split('-');
    const months = {
      '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
      '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
      '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };
    return `${months[month]} / ${year}`;
  };

  const { code, start_date, end_date, chart, bank, complemento } = req.query;

  let filtered = [...movements];

  // Filtrar primeiro por competência, caso não seja 'all'
  if (selectedCompetence && selectedCompetence !== 'all') {
    filtered = filtered.filter(m => m.date && m.date.substring(0, 7) === selectedCompetence);
  }

  // Calcular estatísticas da competência selecionada para a página de Movimentações
  const stats = {
    totalRecebido: 0,
    totalPago: 0,
    saldoNet: 0
  };

  filtered.forEach(m => {
    const amt = parseFloat(m.amount) || 0;
    if (amt > 0) {
      stats.totalRecebido += amt;
    } else {
      stats.totalPago += Math.abs(amt);
    }
  });
  stats.saldoNet = stats.totalRecebido - stats.totalPago;

  if (code && code.trim() !== '') {
    filtered = filtered.filter(m => String(m.code).includes(code.trim()) || String(m.id).toLowerCase().includes(code.trim().toLowerCase()));
  }
  if (start_date) {
    filtered = filtered.filter(m => m.date >= start_date);
  }
  if (end_date) {
    filtered = filtered.filter(m => m.date <= end_date);
  }
  if (chart && chart !== 'all') {
    filtered = filtered.filter(m => m.chartOfAccounts === chart);
  }
  if (bank && bank !== 'all') {
    filtered = filtered.filter(m => m.bank === bank);
  }
  if (complemento && complemento.trim() !== '') {
    filtered = filtered.filter(m => m.complemento && m.complemento.toLowerCase().includes(complemento.trim().toLowerCase()));
  }

  // Ordenação por data decrescente, e código decrescente
  filtered.sort((a, b) => {
    if (b.date !== a.date) {
      return new Date(b.date) - new Date(a.date);
    }
    return (b.code || 0) - (a.code || 0);
  });

  res.render('admin/financeiro/movimentacoes', {
    movements: filtered,
    settings,
    filters: req.query || {},
    page: 'admin-financeiro-movimentacoes',
    selectedCompetence,
    availableCompetences,
    formatCompetence,
    stats
  });
});

// Cadastrar Nova Movimentação Financeira Manualmente (POST)
router.post('/admin/financeiro/movimentacoes/add', requireAdmin, (req, res) => {
  const { code, date, chartOfAccounts, bank, amount, type, complemento } = req.body;
  
  const movements = loadMovements();
  let maxCode = 352;
  movements.forEach(m => {
    if (m.code && typeof m.code === 'number' && m.code > maxCode) {
      maxCode = m.code;
    }
  });
  const newCode = parseInt(code) || (maxCode + 1);

  let cleanAmount = 0;
  if (amount) {
    let str = String(amount).replace('R$', '').replace(/\s/g, '');
    if (str.includes(',') && str.includes('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes(',')) {
      str = str.replace(',', '.');
    }
    cleanAmount = parseFloat(str) || 0;
  }

  const finalAmount = type === 'receber' ? Math.abs(cleanAmount) : -Math.abs(cleanAmount);

  const newMovement = {
    id: `MV-${newCode}`,
    code: newCode,
    type: type || 'pagar',
    date: date || new Date().toISOString().split('T')[0],
    chartOfAccounts: chartOfAccounts || 'Outras',
    complemento: complemento || '',
    bank: bank || 'Sicredi',
    amount: finalAmount,
    createdAt: new Date().toISOString()
  };

  movements.unshift(newMovement);
  saveMovements(movements);

  res.redirect('/admin/financeiro/movimentacoes');
});

// Deletar Movimentação Financeira (POST)
router.post('/admin/financeiro/movimentacoes/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send("ID ausente");

  let movements = loadMovements();
  movements = movements.filter(m => m.id !== id);
  saveMovements(movements);

  res.redirect('/admin/financeiro/movimentacoes');
});

// Cadastrar Fornecedor/Cliente por API AJAX (POST)
router.post('/api/financeiro/add-provider', requireAdmin, (req, res) => {
  const { provider } = req.body;
  if (!provider || !provider.trim()) {
    return res.status(400).json({ error: "Nome de fornecedor invalido" });
  }

  const settings = loadFinanceSettings();
  const cleanProvider = provider.trim();
  
  if (!settings.providers.includes(cleanProvider)) {
    settings.providers.push(cleanProvider);
    saveFinanceSettings(settings);
  }

  res.json({ success: true, providers: settings.providers });
});

// Cadastrar Plano de Contas por API AJAX (POST)
router.post('/api/financeiro/add-chart', requireAdmin, (req, res) => {
  const { chart } = req.body;
  if (!chart || !chart.trim()) {
    return res.status(400).json({ error: "Plano de contas invalido" });
  }

  const settings = loadFinanceSettings();
  const cleanChart = chart.trim();

  if (!settings.chartsOfAccounts.includes(cleanChart)) {
    settings.chartsOfAccounts.push(cleanChart);
    saveFinanceSettings(settings);
  }

  res.json({ success: true, chartsOfAccounts: settings.chartsOfAccounts });
});

// --- SUB-MÓDULO: GERENCIAMENTO DE AVALIAÇÕES DO CLIENTE (NPS) ---

// Página de Listagem de Avaliações
router.get('/admin/avaliacoes', requireAdmin, (req, res) => {
  const evaluations = loadEvaluations();
  const selectedMonth = req.query.month || 'all'; // Formato: 'YYYY-MM' ou 'all'

  // 1. Agrupar TODAS as avaliações por mês para ter o histórico completo de evolução
  const monthlyStats = {};
  evaluations.forEach(e => {
    if (!e.date) return;
    const parts = e.date.split('/');
    if (parts.length === 3) {
      const month = parts[1]; // "07"
      const year = parts[2];  // "2026"
      const key = `${year}-${month}`; // "2026-07"
      if (!monthlyStats[key]) {
        monthlyStats[key] = {
          key,
          year,
          month,
          total: 0,
          promoters: 0,
          critics: 0,
          sumOfRatings: 0,
          average: 0
        };
      }
      monthlyStats[key].total += 1;
      monthlyStats[key].sumOfRatings += e.rating;
      if (e.rating >= 4) {
        monthlyStats[key].promoters += 1;
      } else {
        monthlyStats[key].critics += 1;
      }
    }
  });

  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  const evolution = Object.values(monthlyStats).map(m => {
    m.average = m.total > 0 ? (m.sumOfRatings / m.total) : 5.0;
    const monthIndex = parseInt(m.month, 10) - 1;
    m.label = `${monthNames[monthIndex]} / ${m.year}`;
    return m;
  }).sort((a, b) => b.key.localeCompare(a.key)); // Mês mais recente primeiro

  // 2. Filtrar avaliações com base no mês selecionado
  let filteredEvaluations = [...evaluations];
  if (selectedMonth !== 'all') {
    filteredEvaluations = evaluations.filter(e => {
      if (!e.date) return false;
      const parts = e.date.split('/');
      if (parts.length === 3) {
        const key = `${parts[2]}-${parts[1]}`;
        return key === selectedMonth;
      }
      return false;
    });
  }

  const sortedEvaluations = [...filteredEvaluations].reverse(); // Recentes primeiro

  // 3. Calcular métricas para o subconjunto atualmente selecionado (ou todas)
  const totalCount = filteredEvaluations.length;
  const promoterCount = filteredEvaluations.filter(e => e.rating >= 4).length;
  const criticCount = filteredEvaluations.filter(e => e.rating <= 3).length;
  const averageRating = totalCount > 0 
    ? filteredEvaluations.reduce((acc, curr) => acc + curr.rating, 0) / totalCount 
    : 5.0;

  const googleEligibleCount = filteredEvaluations.filter(e => e.rating === 5).length;
  const googleClickedCount = filteredEvaluations.filter(e => e.rating === 5 && e.googleClicked === true).length;
  const googleNotClickedCount = googleEligibleCount - googleClickedCount;

  const stats = {
    totalCount,
    promoterCount,
    criticCount,
    averageRating,
    selectedMonth,
    googleEligibleCount,
    googleClickedCount,
    googleNotClickedCount
  };

  const accesses = loadEvalAccesses();
  const hashes = loadEvalHashes();
  const requisitions = loadRequisitions();
  
  const enrichedAccesses = requisitions.map(req => {
    const cleanCode = String(req.requisitionCode || '').trim();
    // 1. Verificar se já tem avaliação
    const alreadyEvaluated = evaluations.some(e => e.code && String(e.code).trim().toLowerCase() === cleanCode.toLowerCase());
    
    // 2. Verificar se tem acesso registrado
    const foundAccess = accesses.find(a => String(a.code || a.id).trim().toLowerCase() === cleanCode.toLowerCase());

    let status = 'not_invited';
    let firstAccessDate = '-';
    let firstAccessTime = '';
    let lastAccessDate = '-';
    let lastAccessTime = '';

    if (alreadyEvaluated) {
      status = 'submitted';
    } else if (foundAccess) {
      status = foundAccess.status === 'submitted' ? 'submitted' : 'opened';
    } else if (req.inviteNotified) {
      status = 'created'; // Enviado / Não abriu
    }

    if (foundAccess) {
      firstAccessDate = foundAccess.firstAccessDate || '-';
      firstAccessTime = foundAccess.firstAccessTime || '';
      lastAccessDate = foundAccess.lastAccessDate || '-';
      lastAccessTime = foundAccess.lastAccessTime || '';
    }

    if (alreadyEvaluated && firstAccessDate === '-') {
      const foundEval = evaluations.find(e => e.code && String(e.code).trim().toLowerCase() === cleanCode.toLowerCase());
      if (foundEval) {
        firstAccessDate = foundEval.date || '-';
        firstAccessTime = foundEval.time || '';
        lastAccessDate = foundEval.date || '-';
        lastAccessTime = foundEval.time || '';
      }
    }

    return {
      code: cleanCode,
      patientName: req.patientName,
      patientPhone: req.patientPhone || '',
      firstAccessDate,
      firstAccessTime,
      lastAccessDate,
      lastAccessTime,
      status,
      requisitionId: req.id,
      createdDate: firstAccessDate // Usado no filtro por data no front-end
    };
  });

  const notOpenedCount = enrichedAccesses.filter(a => a.status === 'created').length;
  const openedNotSubmittedCount = enrichedAccesses.filter(a => a.status === 'opened').length;
  const pendingAccessesCount = notOpenedCount + openedNotSubmittedCount;

  res.render('admin/avaliacoes', {
    evaluations: sortedEvaluations,
    stats,
    evolution,
    selectedMonth,
    pendingAccessesCount,
    notOpenedCount,
    openedNotSubmittedCount,
    accesses: enrichedAccesses,
    messageTemplates: loadMessageTemplates(),
    requisitions: loadRequisitions(),
    page: 'admin-avaliacoes'
  });
});

// Deletar Avaliação (POST)
router.post('/admin/avaliacoes/deletar', requireAdmin, (req, res) => {
  const { id } = req.body;
  let evaluations = loadEvaluations();
  evaluations = evaluations.filter(e => String(e.id) !== String(id));
  saveEvaluations(evaluations);
  res.redirect('/admin/avaliacoes');
});


export default router;
