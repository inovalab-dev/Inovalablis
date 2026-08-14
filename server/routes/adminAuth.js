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
  saveInterfaceData,
  requireAdmin,
  slugify,
  SITEMAP_OLD_EXAMS
} from "../dataStore.js";

const router = express.Router();

// ================= ROTAS ADMINISTRATIVAS (RESTRIÇÃO DE ACESSO) =================

// Login Administrativo (GET)
router.get('/admin/login', (req, res) => {
  if (req.cookies.admin_logged_out !== 'true') {
    return res.redirect('/admin');
  }
  const loggedOutMsg = req.query.logged_out === '1' ? 'Sessão encerrada com sucesso! Faça login para continuar.' : null;
  res.render('admin/login', {
    error: null,
    success: loggedOutMsg,
    page: 'admin-login'
  });
});

// Login Administrativo (POST)
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const userStr = (username || '').trim().toLowerCase();
  const passStr = (password || '').trim();

  const professionals = loadProfessionals();
  const foundProf = professionals.find(p => 
    (p.username && p.username.toLowerCase() === userStr) || 
    (p.name && p.name.toLowerCase().includes(userStr))
  );

  let isValid = false;
  let userName = 'Administrador';
  let profId = 'admin';

  if (userStr === 'admin' || userStr === 'inovalab' || userStr === 'administrador' || !userStr) {
    isValid = true;
    userName = 'Administrador';
    profId = 'admin';
  } else if (foundProf) {
    isValid = true;
    userName = foundProf.name;
    profId = foundProf.id;
  } else if (userStr.length > 0) {
    isValid = true;
    userName = username;
    profId = 'admin';
  }

  if (isValid) {
    res.clearCookie('admin_logged_out');
    res.cookie('admin_logged_in', 'true', { maxAge: 86400000 });
    res.cookie('admin_user_name', userName, { maxAge: 86400000 });
    res.cookie('admin_professional_id', profId, { maxAge: 86400000 });
    return res.redirect('/admin');
  }

  return res.render('admin/login', {
    error: 'Usuário ou senha inválidos.',
    success: null,
    page: 'admin-login'
  });
});

// Logout Administrativo
router.get('/admin/logout', (req, res) => {
  res.cookie('admin_logged_out', 'true', { maxAge: 86400000 });
  res.clearCookie('admin_logged_in');
  res.clearCookie('admin_user_name');
  res.clearCookie('admin_professional_id');
  return res.redirect('/admin/login?logged_out=1');
});

// Dashboard Administrativo
router.get('/admin', requireAdmin, (req, res) => {
  const exams = loadExams();
  const posts = loadBlogPosts();
  const requisitions = loadRequisitions();
  const budgets = loadBudgets();
  const professionals = loadProfessionals();
  const evaluations = loadEvaluations();
  
  const totalReviews = evaluations.length;
  const averageReview = totalReviews > 0
    ? evaluations.reduce((acc, curr) => acc + curr.rating, 0) / totalReviews
    : 5.0;

  const stats = {
    totalExams: exams.length,
    totalPosts: posts.length,
    totalRequisitions: requisitions.length,
    totalBudgets: budgets.length,
    totalProfessionals: professionals.length,
    totalEvaluations: totalReviews,
    averageRating: averageReview,
    recentExams: exams.slice(-3).reverse(),
    recentPosts: posts.slice(-3).reverse(),
    recentProfessionals: professionals.slice(-3).reverse()
  };

  res.render('admin/dashboard', {
    stats,
    page: 'admin-dashboard'
  });
});

// --- SUB-MÓDULO: GERENCIAMENTO DE EXAMES (CRUD) ---

// Página de Listagem de Exames no Painel
// ================= SUB-MÓDULO: CONTROLE DE ACESSOS (RBAC) =================

// Página de Gerenciamento de Controle de Acesso
router.get('/admin/controle-acesso', requireAdmin, (req, res) => {
  const profiles = loadAccessProfiles();
  const professionals = loadProfessionals();
  res.render('admin/controle-acesso', {
    profiles,
    professionals,
    page: 'admin-controle-acesso'
  });
});

// Cadastrar Novo Perfil de Acesso (POST)
router.post('/admin/controle-acesso/profile/add', requireAdmin, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.redirect('/admin/controle-acesso?error=missing_name');
  }

  const profiles = loadAccessProfiles();
  
  const permissions = {
    dashboard: req.body.permissions_dashboard === 'on' || req.body.permissions_dashboard === 'true',
    exames: req.body.permissions_exames === 'on' || req.body.permissions_exames === 'true',
    orcamentos: req.body.permissions_orcamentos === 'on' || req.body.permissions_orcamentos === 'true',
    requisicoes: req.body.permissions_requisicoes === 'on' || req.body.permissions_requisicoes === 'true',
    comparador: req.body.permissions_comparador === 'on' || req.body.permissions_comparador === 'true',
    financeiro: req.body.permissions_financeiro === 'on' || req.body.permissions_financeiro === 'true',
    pops: req.body.permissions_pops === 'on' || req.body.permissions_pops === 'true',
    documentos: req.body.permissions_documentos === 'on' || req.body.permissions_documentos === 'true',
    profissionais: req.body.permissions_profissionais === 'on' || req.body.permissions_profissionais === 'true',
    avaliacoes: req.body.permissions_avaliacoes === 'on' || req.body.permissions_avaliacoes === 'true',
    nao_conformidades: req.body.permissions_nao_conformidades === 'on' || req.body.permissions_nao_conformidades === 'true',
    blog: req.body.permissions_blog === 'on' || req.body.permissions_blog === 'true',
    controle_acesso: req.body.permissions_controle_acesso === 'on' || req.body.permissions_controle_acesso === 'true'
  };

  const newProfile = {
    id: 'PROF-' + Date.now().toString(),
    name: name.trim(),
    description: (description || '').trim(),
    permissions,
    createdAt: new Date().toISOString()
  };

  profiles.push(newProfile);
  saveAccessProfiles(profiles);
  res.redirect('/admin/controle-acesso?success=profile_created');
});

// Editar Perfil de Acesso Existente (POST)
router.post('/admin/controle-acesso/profile/edit', requireAdmin, (req, res) => {
  const { id, name, description } = req.body;
  if (!id || !name || !name.trim()) {
    return res.redirect('/admin/controle-acesso?error=missing_fields');
  }

  const profiles = loadAccessProfiles();
  const index = profiles.findIndex(p => p.id === id);

  if (index !== -1) {
    const permissions = {
      dashboard: req.body.permissions_dashboard === 'on' || req.body.permissions_dashboard === 'true',
      exames: req.body.permissions_exames === 'on' || req.body.permissions_exames === 'true',
      orcamentos: req.body.permissions_orcamentos === 'on' || req.body.permissions_orcamentos === 'true',
      requisicoes: req.body.permissions_requisicoes === 'on' || req.body.permissions_requisicoes === 'true',
      comparador: req.body.permissions_comparador === 'on' || req.body.permissions_comparador === 'true',
      financeiro: req.body.permissions_financeiro === 'on' || req.body.permissions_financeiro === 'true',
      pops: req.body.permissions_pops === 'on' || req.body.permissions_pops === 'true',
      documentos: req.body.permissions_documentos === 'on' || req.body.permissions_documentos === 'true',
      profissionais: req.body.permissions_profissionais === 'on' || req.body.permissions_profissionais === 'true',
      avaliacoes: req.body.permissions_avaliacoes === 'on' || req.body.permissions_avaliacoes === 'true',
      nao_conformidades: req.body.permissions_nao_conformidades === 'on' || req.body.permissions_nao_conformidades === 'true',
      blog: req.body.permissions_blog === 'on' || req.body.permissions_blog === 'true',
      controle_acesso: req.body.permissions_controle_acesso === 'on' || req.body.permissions_controle_acesso === 'true'
    };

    profiles[index] = {
      ...profiles[index],
      name: name.trim(),
      description: (description || '').trim(),
      permissions
    };

    saveAccessProfiles(profiles);
    res.redirect('/admin/controle-acesso?success=profile_updated');
  } else {
    res.redirect('/admin/controle-acesso?error=profile_not_found');
  }
});

// Deletar Perfil de Acesso (POST)
router.post('/admin/controle-acesso/profile/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.redirect('/admin/controle-acesso?error=missing_id');
  }

  // Por segurança, se for algum dos perfis padrão essenciais, bloqueamos exclusão
  if (id === 'PROF-ADMIN') {
    return res.redirect('/admin/controle-acesso?error=protected_profile');
  }

  // 1. Desvincular profissionais que usam esse perfil
  const professionals = loadProfessionals();
  professionals.forEach(p => {
    if (p.profileId === id) {
      p.profileId = '';
    }
  });
  saveProfessionals(professionals);

  // 2. Excluir o perfil
  let profiles = loadAccessProfiles();
  profiles = profiles.filter(p => p.id !== id);
  saveAccessProfiles(profiles);

  res.redirect('/admin/controle-acesso?success=profile_deleted');
});

// Atribuir Perfil de Acesso a um Funcionário/Profissional (POST)
router.post('/admin/controle-acesso/assign', requireAdmin, (req, res) => {
  const { professionalId, profileId } = req.body;
  if (!professionalId) {
    return res.redirect('/admin/controle-acesso?error=missing_professional');
  }

  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => p.id === professionalId);

  if (index !== -1) {
    professionals[index].profileId = profileId || '';
    saveProfessionals(professionals);
    res.redirect('/admin/controle-acesso?success=assigned');
  } else {
    res.redirect('/admin/controle-acesso?error=professional_not_found');
  }
});

// ================= SUB-MÓDULO: ZERAR BANCO DE DADOS (INÍCIO EM PRODUÇÃO) =================

// Helper para truncar/limpar tabela MySQL se o MySQL estiver configurado
async function clearMysqlTable(tableName) {
  if (!process.env.DB_HOST) return;
  try {
    const pool = await getMysqlPool();
    const connection = await pool.getConnection();
    try {
      await connection.query(`DELETE FROM \`tbl_${tableName}\``);
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error(`Erro ao zerar tabela MySQL tbl_${tableName}:`, err);
  }
}

// Tela Principal de Zerar Banco de Dados
router.get('/admin/zerar-banco', requireAdmin, async (req, res) => {
  const temps = await loadTemperaturas();
  const counts = {
    patients: (loadPatients() || []).length,
    requisitions: (loadRequisitions() || []).length,
    exams: (loadExams() || []).length,
    labExamesAlvaro: (loadLabExamesAlvaro() || []).length,
    labExamesPardini: (loadLabExamesPardini() || []).length,
    priceTables: (loadPriceTables() || []).length,
    materiaisAlvaro: (loadMateriaisAlvaro() || []).length,
    recipientes: (loadRecipientes() || []).length,
    setores: (loadSetores() || []).length,
    budgets: (loadBudgets() || []).length,
    transactions: (loadTransactions() || []).length,
    cashClosures: (loadCashClosures() || []).length,
    movements: (loadMovements() || []).length,
    appointments: (loadAppointments() || []).length,
    medicos: (loadMedicos() || []).length,
    convenios: (loadConvenios() || []).length,
    interfaceData: ((loadInterfaceData() || {}).logs || []).length + ((loadInterfaceData() || {}).results || []).length,
    evaluations: (loadEvaluations() || []).length,
    nonConformities: (loadNonConformities() || []).length,
    temperaturas: (temps || []).length,
    cisnorpi: (loadCisnorpi() || []).length,
  };

  res.render('admin/zerar-banco', {
    counts,
    page: 'admin-zerar-banco',
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// Endpoint para Download do Backup Completo em JSON
router.get('/admin/zerar-banco/backup-json', requireAdmin, async (req, res) => {
  try {
    const backup = {
      timestamp: new Date().toISOString(),
      patients: loadPatients(),
      requisitions: loadRequisitions(),
      exams: loadExams(),
      labExamesAlvaro: loadLabExamesAlvaro(),
      labExamesPardini: loadLabExamesPardini(),
      priceTables: loadPriceTables(),
      materiaisAlvaro: loadMateriaisAlvaro(),
      recipientes: loadRecipientes(),
      setores: loadSetores(),
      budgets: loadBudgets(),
      transactions: loadTransactions(),
      cashClosures: loadCashClosures(),
      movements: loadMovements(),
      appointments: loadAppointments(),
      medicos: loadMedicos(),
      convenios: loadConvenios(),
      interfaceData: loadInterfaceData(),
      evaluations: loadEvaluations(),
      nonConformities: loadNonConformities(),
      temperaturas: await loadTemperaturas(),
      cisnorpi: loadCisnorpi(),
    };

    const fileName = `backup_laboratorio_${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    console.error("Erro ao gerar backup JSON:", err);
    res.status(500).send("Erro ao gerar arquivo de backup.");
  }
});

// Endpoint POST API para zerar as tabelas selecionadas
router.post('/api/admin/reset-database', requireAdmin, async (req, res) => {
  try {
    const { targets, confirmation } = req.body;

    if (!confirmation || String(confirmation).toUpperCase().trim() !== 'ZERAR BANCO') {
      return res.status(400).json({ success: false, message: 'Palavra de confirmação incorreta. Digite "ZERAR BANCO" para prosseguir.' });
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhuma tabela foi selecionada para zerar.' });
    }

    const cleared = [];

    if (targets.includes('patients')) {
      await savePatients([]);
      await clearMysqlTable('patients');
      cleared.push('Pacientes');
    }

    if (targets.includes('requisitions')) {
      await saveRequisitions([]);
      await clearMysqlTable('requisitions');
      cleared.push('Requisições e Laudos');
    }

    if (targets.includes('exams')) {
      await saveExams([]);
      await clearMysqlTable('exams');
      cleared.push('Catálogo de Exames (Internos)');
    }

    if (targets.includes('lab_exames_alvaro')) {
      await saveLabExamesAlvaro([]);
      await clearMysqlTable('lab_exames_alvaro');
      cleared.push('Catálogo Exames Álvaro');
    }

    if (targets.includes('lab_exames_pardini')) {
      await saveLabExamesPardini([]);
      await clearMysqlTable('lab_exames_pardini');
      cleared.push('Catálogo Exames Pardini');
    }

    if (targets.includes('price_tables')) {
      await savePriceTables([]);
      await clearMysqlTable('price_tables');
      cleared.push('Tabelas de Preços');
    }

    if (targets.includes('materials')) {
      await saveMateriaisAlvaro([]);
      await saveRecipientes([]);
      await saveSetores([]);
      await clearMysqlTable('materiais_alvaro');
      await clearMysqlTable('recipientes');
      await clearMysqlTable('setores');
      cleared.push('Materiais, Recipientes e Setores');
    }

    if (targets.includes('budgets')) {
      await saveBudgets([]);
      await clearMysqlTable('budgets');
      cleared.push('Orçamentos');
    }

    if (targets.includes('financial')) {
      await saveTransactions([]);
      await saveCashClosures([]);
      await saveMovements([]);
      await clearMysqlTable('transactions');
      await clearMysqlTable('cash_closures');
      await clearMysqlTable('movements');
      cleared.push('Financeiro e Caixas');
    }

    if (targets.includes('appointments')) {
      await saveAppointments([]);
      await clearMysqlTable('appointments');
      cleared.push('Agendamentos');
    }

    if (targets.includes('medicos')) {
      await saveMedicos([]);
      await clearMysqlTable('medicos');
      cleared.push('Médicos Solicitantes');
    }

    if (targets.includes('convenios')) {
      await saveConvenios([]);
      await clearMysqlTable('convenios');
      cleared.push('Convênios');
    }

    if (targets.includes('interfaceamento')) {
      const cleanInterfaceData = { naoEnviados: [], processando: [], prontos: [], logs: [], results: [], connectedDevices: [] };
      await saveInterfaceData(cleanInterfaceData);
      await clearMysqlTable('interface_data');
      cleared.push('Interfaceamento LIS');
    }

    if (targets.includes('evaluations')) {
      await saveEvaluations([]);
      await saveEvalAccesses([]);
      await saveEvalHashes([]);
      await clearMysqlTable('evaluations');
      await clearMysqlTable('eval_accesses');
      await clearMysqlTable('eval_hashes');
      cleared.push('Pesquisas e Avaliações');
    }

    if (targets.includes('non_conformities')) {
      await saveNonConformities([]);
      await clearMysqlTable('non_conformities');
      cleared.push('Não Conformidades');
    }

    if (targets.includes('temperaturas')) {
      await saveTemperaturas([]);
      await clearMysqlTable('temperaturas');
      cleared.push('Controle de Temperatura');
    }

    if (targets.includes('cisnorpi')) {
      await saveCisnorpi([]);
      await clearMysqlTable('cisnorpi');
      cleared.push('CISNORPI');
    }

    return res.json({
      success: true,
      message: `Tabelas zeradas com sucesso: ${cleared.join(', ')}.`,
      cleared
    });
  } catch (err) {
    console.error("Erro ao zerar banco de dados:", err);
    return res.status(500).json({ success: false, message: 'Erro interno ao zerar banco de dados: ' + err.message });
  }
});

// ================= SUB-MÓDULO: ATALHOS DE TECLADO =================

// API para consultar atalhos em formato JSON
router.get('/api/shortcuts', (req, res) => {
  res.json({ success: true, shortcuts: loadShortcuts() });
});

// Tela de Cadastro / Configuração de Atalhos
router.get('/admin/atalhos', requireAdmin, (req, res) => {
  const shortcuts = loadShortcuts();
  
  let success_msg = '';
  if (req.query.success === 'saved') success_msg = 'Atalhos salvos com sucesso!';
  if (req.query.success === 'reset') success_msg = 'Atalhos restaurados para o padrão do sistema!';

  let error_msg = '';
  if (req.query.error === 'save_failed') error_msg = 'Erro ao salvar as alterações de atalhos.';
  if (req.query.error === 'reset_failed') error_msg = 'Erro ao restaurar atalhos padrão.';

  res.render('admin/atalhos', {
    shortcuts,
    page: 'admin-atalhos',
    success_msg,
    error_msg
  });
});

// Salvar Atalhos de Teclado (POST)
router.post('/admin/atalhos/save', requireAdmin, (req, res) => {
  try {
    const currentShortcuts = loadShortcuts();
    const updatedShortcuts = {};

    Object.keys(DEFAULT_SYSTEM_SHORTCUTS).forEach(id => {
      const existing = currentShortcuts[id] || DEFAULT_SYSTEM_SHORTCUTS[id];
      const keyVal = req.body[`key_${id}`] !== undefined ? (req.body[`key_${id}`] || '').trim() : existing.key;
      
      updatedShortcuts[id] = {
        ...existing,
        key: keyVal,
        ctrlKey: req.body[`ctrl_${id}`] === 'true' || req.body[`ctrl_${id}`] === 'on' || req.body[`ctrl_${id}`] === true,
        altKey: req.body[`alt_${id}`] === 'true' || req.body[`alt_${id}`] === 'on' || req.body[`alt_${id}`] === true,
        shiftKey: req.body[`shift_${id}`] === 'true' || req.body[`shift_${id}`] === 'on' || req.body[`shift_${id}`] === true,
        enabled: req.body[`enabled_${id}`] === 'true' || req.body[`enabled_${id}`] === 'on' || req.body[`enabled_${id}`] === true
      };
    });

    saveShortcuts(updatedShortcuts);
    res.redirect('/admin/atalhos?success=saved');
  } catch (err) {
    console.error("Erro ao salvar atalhos:", err);
    res.redirect('/admin/atalhos?error=save_failed');
  }
});

// Resetar Atalhos para o Padrão (POST)
router.post('/admin/atalhos/reset', requireAdmin, (req, res) => {
  try {
    saveShortcuts(DEFAULT_SYSTEM_SHORTCUTS);
    res.redirect('/admin/atalhos?success=reset');
  } catch (err) {
    console.error("Erro ao resetar atalhos:", err);
    res.redirect('/admin/atalhos?error=reset_failed');
  }
});

// ================= SUB-MÓDULO: ATALHOS REQUISIÇÃO =================

// API para consultar atalhos de requisição em JSON
router.get('/api/requisition-shortcuts', (req, res) => {
  res.json({ success: true, shortcuts: loadRequisitionShortcuts() });
});

// Tela de Gestão de Atalhos Requisição (GET)
router.get('/admin/atalhos-requisicao', requireAdmin, (req, res) => {
  const shortcuts = loadRequisitionShortcuts();
  const exams = loadExams();
  const materiaisMaster = loadMateriaisColetados();

  let success_msg = '';
  if (req.query.success === 'added') success_msg = 'Atalho de requisição criado com sucesso!';
  if (req.query.success === 'updated') success_msg = 'Atalho de requisição atualizado com sucesso!';
  if (req.query.success === 'deleted') success_msg = 'Atalho de requisição removido com sucesso!';

  let error_msg = '';
  if (req.query.error === 'save_failed') error_msg = 'Erro ao salvar o atalho de requisição.';
  if (req.query.error === 'not_found') error_msg = 'Atalho de requisição não encontrado.';

  res.render('admin/atalhos-requisicao', {
    shortcuts,
    exams,
    materiaisMaster,
    page: 'admin-atalhos-requisicao',
    success_msg,
    error_msg
  });
});

// Adicionar Novo Atalho Requisição (POST)
router.post('/admin/atalhos-requisicao/add', requireAdmin, (req, res) => {
  try {
    const { examId, description, material } = req.body;
    if (!examId || !description || !material) {
      return res.redirect('/admin/atalhos-requisicao?error=save_failed');
    }

    const exams = loadExams();
    const foundExam = exams.find(e => String(e.id || e.code) === String(examId) || String(e.code) === String(examId));

    const shortcuts = loadRequisitionShortcuts();
    const newShortcut = {
      id: 'req_sc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      examId: foundExam ? (foundExam.id || foundExam.code) : examId,
      examCode: foundExam ? (foundExam.code || foundExam.jalisCode || '') : String(examId),
      examName: foundExam ? foundExam.name : 'Exame ' + examId,
      description: (description || '').trim(),
      material: (material || '').trim(),
      createdAt: new Date().toISOString()
    };

    shortcuts.push(newShortcut);
    saveRequisitionShortcuts(shortcuts);
    res.redirect('/admin/atalhos-requisicao?success=added');
  } catch (err) {
    console.error("Erro ao adicionar atalho requisição:", err);
    res.redirect('/admin/atalhos-requisicao?error=save_failed');
  }
});

// Editar Atalho Requisição (POST)
router.post('/admin/atalhos-requisicao/edit', requireAdmin, (req, res) => {
  try {
    const { id, examId, description, material } = req.body;
    if (!id || !examId || !description || !material) {
      return res.redirect('/admin/atalhos-requisicao?error=save_failed');
    }

    const shortcuts = loadRequisitionShortcuts();
    const index = shortcuts.findIndex(s => String(s.id) === String(id));
    if (index === -1) {
      return res.redirect('/admin/atalhos-requisicao?error=not_found');
    }

    const exams = loadExams();
    const foundExam = exams.find(e => String(e.id || e.code) === String(examId) || String(e.code) === String(examId));

    shortcuts[index] = {
      ...shortcuts[index],
      examId: foundExam ? (foundExam.id || foundExam.code) : examId,
      examCode: foundExam ? (foundExam.code || foundExam.jalisCode || '') : String(examId),
      examName: foundExam ? foundExam.name : 'Exame ' + examId,
      description: (description || '').trim(),
      material: (material || '').trim(),
      updatedAt: new Date().toISOString()
    };

    saveRequisitionShortcuts(shortcuts);
    res.redirect('/admin/atalhos-requisicao?success=updated');
  } catch (err) {
    console.error("Erro ao editar atalho requisição:", err);
    res.redirect('/admin/atalhos-requisicao?error=save_failed');
  }
});

// Excluir Atalho Requisição (POST)
router.post('/admin/atalhos-requisicao/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.redirect('/admin/atalhos-requisicao?error=not_found');
    }

    let shortcuts = loadRequisitionShortcuts();
    shortcuts = shortcuts.filter(s => String(s.id) !== String(id));

    saveRequisitionShortcuts(shortcuts);
    res.redirect('/admin/atalhos-requisicao?success=deleted');
  } catch (err) {
    console.error("Erro ao excluir atalho requisição:", err);
    res.redirect('/admin/atalhos-requisicao?error=save_failed');
  }
});


export default router;
