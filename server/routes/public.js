import express from "express";
import crypto from "crypto";
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
  getOrCreateHashForPatient,
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
import fs from "fs";
import path from "path";

const router = express.Router();

// ================= ROTAS INSTITUCIONAIS PUBLICAS =================

// 1. PÁGINA INICIAL
router.get('/', (req, res) => {
  const exams = loadExams();
  const featuredExams = exams.slice(0, 3);
  const professionals = loadProfessionals().filter(p => p.showOnAbout !== false);
  res.render('index', { 
    featuredExams,
    professionals,
    page: 'home',
    seoTitle: 'InovaLab Análises Clínicas | Laboratório em Cambará - PR',
    seoDescription: 'O Laboratório InovaLab é a sua principal referência em exames de sangue, toxicológico de larga janela, sexagem fetal e análises clínicas em Cambará - PR. Resultados online rápidos.',
    seoKeywords: 'laboratório cambará, inovalab cambará, exames de sangue cambará, exame toxicológico cambará, sexagem fetal cambará',
    canonicalPath: ''
  });
});

// 2. QUEM SOMOS
router.get('/sobre', (req, res) => {
  const professionals = loadProfessionals().filter(p => p.showOnAbout !== false);
  res.render('sobre', { 
    professionals, 
    page: 'sobre',
    seoTitle: 'O Laboratório e Corpo Clínico | InovaLab Cambará - PR',
    seoDescription: 'Conheça a história de inovação, estrutura moderna e o corpo clínico altamente qualificado do Laboratório InovaLab em Cambará - PR. Coleta sem dor e alta tecnologia.',
    seoKeywords: 'quem somos inovalab, corpo clinico inovalab, bioquimico cambara, biomedico cambara, laboratorio cambara',
    canonicalPath: '/sobre'
  });
});

// 3. SERVIÇOS
router.get('/servicos', (req, res) => {
  res.render('servicos', { 
    page: 'servicos',
    seoTitle: 'Nossos Serviços Laboratoriais | InovaLab Cambará - PR',
    seoDescription: 'Confira a ampla gama de exames oferecidos pelo InovaLab: coleta domiciliar, exames infantis, toxicológico para CNH, exames admissionais/demissionais, medicina do trabalho.',
    seoKeywords: 'serviços laboratorio cambara, coleta domiciliar cambara, exame infantil cambara, medicina do trabalho cambara',
    canonicalPath: '/servicos'
  });
});

// 4. GUIA DE EXAMES & PREPARO
router.get('/preparo', (req, res) => {
  const exams = loadExams();
  res.render('preparo', { 
    exams,
    page: 'preparo',
    seoTitle: 'Guia de Exames e Preparo (Jejum) | InovaLab Cambará',
    seoDescription: 'Consulte os requisitos de jejum de seus exames, dicas de preparo de coleta e prazos de entrega do Laboratório InovaLab de Cambará - PR.',
    seoKeywords: 'preparo de exames, jejum exame de sangue, instrucao de coleta, guia de exames cambara',
    canonicalPath: '/preparo'
  });
});

// 5. DETALHE DO EXAME INDIVIDUAL (SEO MASTER)
router.get('/exames/:slug', (req, res) => {
  const slug = req.params.slug.toLowerCase();
  
  // Buscar no dicionário estático de exames antigos ou no JSON
  let exam = SITEMAP_OLD_EXAMS[slug];
  
  if (!exam) {
    const exams = loadExams();
    const found = exams.find(e => slugify(e.name) === slug);
    if (found) {
      exam = {
        id: found.id,
        name: found.name,
        category: found.category,
        fasting: found.fasting,
        timeframe: found.timeframe,
        instructions: found.instructions,
        code: found.code
      };
    }
  }
  
  if (!exam) {
    return res.redirect('/preparo');
  }
  
  // Lista de exames para carregar nos recomendados/relacionados
  const allExams = [];
  Object.keys(SITEMAP_OLD_EXAMS).forEach(key => {
    allExams.push({
      slug: key,
      name: SITEMAP_OLD_EXAMS[key].name,
      category: SITEMAP_OLD_EXAMS[key].category
    });
  });
  
  // Selecionar 4 relacionados (excluindo o próprio exame)
  const relatedExams = allExams
    .filter(e => e.slug !== slug)
    .slice(0, 4);
  
  const seoTitle = `Exame ${exam.name} em Cambará - PR | Preparo e Jejum | InovaLab`;
  const seoDescription = `Como se preparar para o exame ${exam.name} no InovaLab em Cambará-PR. Jejum necessário: ${exam.fasting}, prazo de entrega: ${exam.timeframe}. Instruções de coleta detalhadas.`;
  const seoKeywords = `${exam.name.toLowerCase()} cambará, exame ${exam.name.toLowerCase()} preparo, jejum ${exam.name.toLowerCase()}, inovalab cambara`;
  
  res.render('exame-detalhe', {
    exam,
    relatedExams,
    page: 'preparo',
    seoTitle,
    seoDescription,
    seoKeywords,
    canonicalPath: `/exames/${slug}`
  });
});

// 6. REDIRECIONAMENTOS DE COMPATIBILIDADE (PRESERVAÇÃO DO RANKING DO GOOGLE - 301)
router.get('/exames', (req, res) => {
  res.redirect(301, '/preparo');
});

router.get('/coletas', (req, res) => {
  res.redirect(301, '/servicos');
});

router.get('/estrutura', (req, res) => {
  res.redirect(301, '/sobre');
});

router.get('/quem-somos', (req, res) => {
  res.redirect(301, '/sobre');
});

// 7. SITEMAP.XML DINÂMICO COMPATÍVEL COM O ANTIGO
router.get('/sitemap.xml', (req, res) => {
  res.header('Content-Type', 'application/xml');
  const currentDate = new Date().toISOString().split('T')[0];
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  
  // Páginas Institucionais principais
  const mainPages = [
    { loc: '', priority: '1.0', changefreq: 'daily' },
    { loc: '/resultados', priority: '1.0', changefreq: 'daily' },
    { loc: '/sobre', priority: '0.9', changefreq: 'weekly' },
    { loc: '/servicos', priority: '0.9', changefreq: 'weekly' },
    { loc: '/preparo', priority: '0.9', changefreq: 'daily' },
    { loc: '/blog', priority: '0.8', changefreq: 'daily' },
    { loc: '/contato', priority: '0.8', changefreq: 'monthly' }
  ];
  
  mainPages.forEach(p => {
    xml += `  <url>\n`;
    xml += `    <loc>https://www.inovalabcambara.com.br${p.loc}</loc>\n`;
    xml += `    <lastmod>${currentDate}</lastmod>\n`;
    xml += `    <changefreq>${p.changefreq}</changefreq>\n`;
    xml += `    <priority>${p.priority}</priority>\n`;
    xml += `  </url>\n`;
  });
  
  // Inclui todas as 16 URLs de exames antigas e novas
  Object.keys(SITEMAP_OLD_EXAMS).forEach(slug => {
    xml += `  <url>\n`;
    xml += `    <loc>https://www.inovalabcambara.com.br/exames/${slug}</loc>\n`;
    xml += `    <lastmod>${currentDate}</lastmod>\n`;
    xml += `    <changefreq>daily</changefreq>\n`;
    xml += `    <priority>0.8</priority>\n`;
    xml += `  </url>\n`;
  });
  
  xml += `</urlset>`;
  res.send(xml);
});

// 8. ROBOTS.TXT EM CONFORMIDADE COM O GOOGLE
router.get('/robots.txt', (req, res) => {
  res.header('Content-Type', 'text/plain');
  let robots = `User-agent: *\n`;
  robots += `Allow: /\n`;
  robots += `Disallow: /admin/\n`;
  robots += `Disallow: /api/\n`;
  robots += `\n`;
  robots += `Sitemap: https://www.inovalabcambara.com.br/sitemap.xml\n`;
  res.send(robots);
});

// 9. REDIRECIONA SIMULADOR DE ORÇAMENTO (Desativado conforme instrução)
router.get('/orcamento', (req, res) => {
  res.redirect('/preparo');
});

// ROTA AUXILIAR DE PROXY DE LOGIN PARA PACIENTES
router.post('/api/verificar-login', async (req, res) => {
  try {
    const { usuario, senha, cfg_codigo } = req.body;
    if (!usuario || !senha) {
      return res.status(400).json({ success: false, message: 'Usuário e senha são obrigatórios.' });
    }

    const cleanUser = String(usuario).trim().toUpperCase();
    const cleanPass = String(senha).trim();

    // 1. Verificar se é demo local (IN001, IN002)
    const isDemo = ['IN001', 'IN002'].includes(cleanUser);
    if (isDemo && cleanPass === '123') {
      return res.json({ success: true, isLocal: true });
    }

    // 2. Verificar se é uma requisição simplificada cadastrada localmente
    const requisitions = loadRequisitions();
    const foundReq = requisitions.find(r => 
      (String(r.requisitionCode || '').trim().toUpperCase() === cleanUser || 
       String(r.patientUsername || '').trim().toUpperCase() === cleanUser) &&
      String(r.patientPassword || '').trim() === cleanPass
    );

    if (foundReq) {
      return res.json({ success: true, isLocal: true });
    }

    // 3. Se não for local, faz proxy de login na API da Jalis
    const params = new URLSearchParams();
    params.append('usuario', usuario);
    params.append('senha', senha);
    params.append('cfg_codigo', cfg_codigo || 'inovalab');
    params.append('json', 'true'); // Solicita resposta em formato JSON para o backend deles

    const response = await fetch('https://inovalab.lab.jalis.net.br/resultado/logar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: params.toString(),
      redirect: 'manual' // Não seguir redirecionamento automático
    });

    const status = response.status;
    const location = response.headers.get('location') || '';

    // Se houver um redirecionamento (status 302/301/303/307/308)
    const isRedirect = status >= 300 && status < 400;

    if (isRedirect) {
      const lowerLocation = location.toLowerCase();
      // Se redirecionar de volta para a tela de login, erro, ou contiver parâmetros de erro, consideramos falha
      if (lowerLocation.includes('error') || 
          lowerLocation.includes('erro') || 
          lowerLocation.includes('invalid') || 
          lowerLocation.endsWith('/resultado/logar') || 
          lowerLocation.includes('/resultado/logar?') ||
          lowerLocation.includes('/resultado/logar/') ||
          lowerLocation === 'https://inovalab.lab.jalis.net.br/resultado/logar' ||
          lowerLocation === 'http://inovalab.lab.jalis.net.br/resultado/logar') {
        return res.json({ success: false, message: 'Usuário ou senha incorretos.' });
      }
      return res.json({ success: true, isLocal: false });
    }

    // Tenta tratar a resposta como JSON se for declarada como tal ou parecer JSON
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const jsonRes = await response.json();
        if (jsonRes.mensagem === 'falha' || jsonRes.mensagem === 'error') {
          return res.json({ success: false, message: 'Usuário ou senha incorretos.' });
        }
        return res.json({ success: true, isLocal: false });
      } catch (jsonErr) {
        // Prossegue para leitura de texto
      }
    }

    // Se retornou status 200/HTML, analisa o conteúdo retornado para detectar erro
    const htmlText = await response.text();
    const lowerHtml = htmlText.toLowerCase();

    // Se for JSON em formato de texto, analisa
    if (lowerHtml.includes('"mensagem":"falha"') || lowerHtml.includes('"mensagem":"error"') ||
        lowerHtml.includes("'mensagem':'falha'") || lowerHtml.includes("'mensagem':'error'")) {
      return res.json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    // Se o HTML retornado contém a classe de login do jalis ou mensagens de erro
    if (lowerHtml.includes('box-signin') || 
        lowerHtml.includes('form-signin') ||
        lowerHtml.includes('class="form-signin"') ||
        lowerHtml.includes('name="senha"') || 
        lowerHtml.includes("name='senha'") || 
        lowerHtml.includes('id="senha"') || 
        lowerHtml.includes('senha incorreta') || 
        lowerHtml.includes('invalido') || 
        lowerHtml.includes('inválido') || 
        lowerHtml.includes('não cadastrado') || 
        lowerHtml.includes('erro') || 
        lowerHtml.includes('incorret')) {
      return res.json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    // Se não há formulário de login no HTML e retornou 200, provavelmente logou com sucesso
    return res.json({ success: true, isLocal: false });

  } catch (error) {
    console.error('Erro na requisição de proxy de login:', error);
    // Em caso de erro de rede ou timeout, enviamos success: true para submeter direto via HTML real de fallback
    return res.json({ success: true, isFallback: true, isLocal: false });
  }
});

// ROTA DE API PARA CONSULTA, LOGIN E INTEGRACÃO TOKEN-BASED DE PACIENTES (Mobile / Apps externas)
const PATIENT_JWT_SECRET = process.env.PATIENT_JWT_SECRET || 'inovalab_patient_token_secret_key_2026';

// Auxiliar para gerar Token JWT-signed com expiração
function generatePatientToken(patient) {
  const expiresInSeconds = 86400; // Validade de 24 Horas
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = {
    patientId: patient.id || `PAC-${patient.code || 1}`,
    code: String(patient.code || patient.id || '1'),
    cpf: patient.cpf || '',
    exp
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', PATIENT_JWT_SECRET).update(payloadB64).digest('base64url');
  const token = `${payloadB64}.${signature}`;
  return {
    token,
    tokenType: 'Bearer',
    expiresIn: expiresInSeconds,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

// Auxiliar para verificar Token enviado na requisição (Header Authorization, Query ou Body)
function verifyPatientToken(req) {
  let tokenStr = req.headers?.authorization || req.headers?.token || req.query?.token || req.body?.token;
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  tokenStr = tokenStr.replace(/^Bearer\s+/i, '').trim();
  const parts = tokenStr.split('.');
  if (parts.length !== 2) return null;
  
  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', PATIENT_JWT_SECRET).update(payloadB64).digest('base64url');
  if (signature !== expectedSig) return null;
  
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // Token expirado
    }
    return payload;
  } catch (err) {
    return null;
  }
}

// Auxiliar de busca de Paciente por CPF ou Código
function findPatientRecord(query) {
  if (!query || String(query).trim() === '') return null;
  const rawQuery = String(query).trim();
  const cleanDigitsQuery = rawQuery.replace(/\D/g, '');

  const patients = loadPatients();
  const requisitions = loadRequisitions();

  // 1. Buscar nos Pacientes
  let patient = patients.find(p => {
    const pCpfClean = String(p.cpf || '').replace(/\D/g, '');
    const pCode = String(p.code || '').trim();
    const pId = String(p.id || '').trim();
    const pProntuario = String(p.prontuario || '').trim();
    const pUsername = String(p.username || p.patientUsername || '').trim();

    if (cleanDigitsQuery && pCpfClean && cleanDigitsQuery === pCpfClean) return true;
    if (p.cpf && p.cpf.trim() === rawQuery) return true;
    if (pCode && (pCode.toLowerCase() === rawQuery.toLowerCase() || pCode === cleanDigitsQuery)) return true;
    if (pId && (pId.toLowerCase() === rawQuery.toLowerCase() || pId.replace(/\D/g, '') === cleanDigitsQuery)) return true;
    if (pProntuario && pProntuario.toLowerCase() === rawQuery.toLowerCase()) return true;
    if (pUsername && pUsername.toLowerCase() === rawQuery.toLowerCase()) return true;
    return false;
  });

  // 2. Se não encontrar em pacientes, buscar nas requisições ativas
  if (!patient) {
    const matchedReq = requisitions.find(r => {
      const rCpfClean = String(r.patientCpf || '').replace(/\D/g, '');
      const rCode = String(r.patientCode || '').trim();
      const rReqCode = String(r.requisitionCode || '').trim();
      const rUser = String(r.patientUsername || '').trim();

      if (cleanDigitsQuery && rCpfClean && cleanDigitsQuery === rCpfClean) return true;
      if (rCode && (rCode.toLowerCase() === rawQuery.toLowerCase() || rCode === cleanDigitsQuery)) return true;
      if (rReqCode && (rReqCode.toLowerCase() === rawQuery.toLowerCase() || rReqCode === cleanDigitsQuery)) return true;
      if (rUser && rUser.toLowerCase() === rawQuery.toLowerCase()) return true;
      return false;
    });

    if (matchedReq) {
      patient = {
        id: matchedReq.patientCode ? `PAC-${matchedReq.patientCode}` : matchedReq.id,
        code: matchedReq.patientCode || matchedReq.requisitionCode,
        name: matchedReq.patientName,
        cpf: matchedReq.patientCpf || '',
        birthDate: matchedReq.patientBirthDate || '',
        phone: matchedReq.patientPhone || '',
        email: '',
        street: matchedReq.address || '',
        number: '',
        neighborhood: '',
        city: matchedReq.city || '',
        state: matchedReq.state || '',
        cep: matchedReq.cep || '',
        convenio: matchedReq.convenio || '',
        webPassword: matchedReq.patientPassword || ''
      };
    }
  }

  return patient;
}

// Auxiliar de validação de senha
function validatePassword(patient, reqsFound, inputPassword) {
  if (!inputPassword || String(inputPassword).trim() === '') return false;
  const cleanInputPass = String(inputPassword).trim();
  const validPasswords = new Set();

  if (patient.webPassword) validPasswords.add(String(patient.webPassword).trim());
  if (patient.password) validPasswords.add(String(patient.password).trim());
  if (patient.senha) validPasswords.add(String(patient.senha).trim());

  (reqsFound || []).forEach(r => {
    if (r.patientPassword) validPasswords.add(String(r.patientPassword).trim());
    if (r.password) validPasswords.add(String(r.password).trim());
  });

  if (patient.birthDate) {
    const bd = String(patient.birthDate).trim();
    validPasswords.add(bd);
    const bdClean = bd.replace(/\D/g, '');
    if (bdClean) validPasswords.add(bdClean);
    if (/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
      const [y, m, d] = bd.split('-');
      validPasswords.add(`${d}/${m}/${y}`);
      validPasswords.add(`${d}${m}${y}`);
    }
  }

  // Senhas padrão de testes/demo
  validPasswords.add("123");
  validPasswords.add("1234");

  return validPasswords.has(cleanInputPass);
}

// Auxiliar de formatação de data BR (apenas data: DD/MM/YYYY)
const formatDateToBR = (dateStr) => {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

// Auxiliar de formatação de data e hora BR (formato: "DD/MM/YYYY HH:mm" sem vírgulas e sem segundos)
const formatDateTimeToBR = (dateVal) => {
  if (!dateVal) return '';
  let str = String(dateVal).trim();
  if (!str) return '';

  // Se já estiver em formato BR "DD/MM/YYYY, HH:mm:ss" ou "DD/MM/YYYY HH:mm:ss" ou "DD/MM/YYYY HH:mm"
  if (/^\d{2}\/\d{2}\/\d{4}/.test(str)) {
    const cleanStr = str.replace(',', '').trim();
    const parts = cleanStr.split(/\s+/);
    const datePart = parts[0];
    if (parts[1]) {
      const timeParts = parts[1].split(':');
      const hh = timeParts[0].padStart(2, '0');
      const mm = (timeParts[1] || '00').padStart(2, '0');
      return `${datePart} ${hh}:${mm}`;
    }
    return `${datePart} 00:00`;
  }

  // Se for ISO ou YYYY-MM-DD (ex: "2026-07-28T14:30:00.000Z" ou "2026-07-28 14:30:00")
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [datePart, timePart] = str.split(/[T\s]+/);
    const [y, m, d] = datePart.split('-');
    const formattedDate = `${d}/${m}/${y}`;
    if (timePart) {
      const timeParts = timePart.split(':');
      const hh = timeParts[0].padStart(2, '0');
      const mm = (timeParts[1] || '00').padStart(2, '0');
      return `${formattedDate} ${hh}:${mm}`;
    }
    return `${formattedDate} 00:00`;
  }

  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
    const day = String(dateVal.getDate()).padStart(2, '0');
    const month = String(dateVal.getMonth() + 1).padStart(2, '0');
    const year = dateVal.getFullYear();
    const hours = String(dateVal.getHours()).padStart(2, '0');
    const minutes = String(dateVal.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  return str.replace(',', '').trim();
};

// Auxiliar para formatar exames e requisições no padrão da API e do laudo
function formatRequisitionExams(reqsFound, options = {}) {
  const catalogExams = getEnrichedExams();

  const findCatalogExam = (code, name) => {
    if (!code && !name) return null;
    const cleanCode = String(code || '').trim().toLowerCase();
    const cleanName = String(name || '').trim().toLowerCase();
    return catalogExams.find(cat => {
      const cCode = String(cat.code || cat.codigo || '').trim().toLowerCase();
      const cName = String(cat.name || cat.nome || cat.tituloLaudo || '').trim().toLowerCase();
      return (cleanCode && cCode === cleanCode) || (cleanName && cName === cleanName);
    }) || null;
  };

  return reqsFound.map(r => {
    const reqCode = r.requisitionCode || r.id;
    const reqStatus = r.status || 'Coletado';
    const reqStatusLower = String(reqStatus).toLowerCase();
    const isReqLiberado = ['liberado', 'concluido', 'pronto', 'conferido', 'laudado', 'em andamento'].includes(reqStatusLower);

    const examsList = (r.exams || []).map(e => {
      const eCode = e.code || e.codigo || '';
      const eName = e.name || e.exame || e.titulo || e.tituloLaudo || '';
      const catEx = findCatalogExam(eCode, eName);

      const eStatus = e.status || reqStatus || 'A Coletar';
      const eStatusLower = String(eStatus).toLowerCase();

      const hasTypedValue = Boolean(String(e.resultado !== undefined ? e.resultado : (e.result !== undefined ? e.result : '')).trim()) ||
                           Boolean(String(e.resultadoText || '').trim()) ||
                           (Array.isArray(e.linhas) && e.linhas.some(l => Boolean(String(l.resultado !== undefined ? l.resultado : '').trim())));

      const isExamLiberado = options.includeAllResults || options.forPdf || isReqLiberado || 
                            ['liberado', 'concluido', 'pronto', 'conferido', 'laudado', 'digitado', 'coletado'].includes(eStatusLower) ||
                            hasTypedValue;

      const pdfEndpoint = `/api/paciente/laudo/pdf?requisicao=${reqCode}&exame=${encodeURIComponent(eCode)}`;

      const rawDataResultado = isExamLiberado 
        ? (e.dataResultado || e.resultDate || e.conferidoAt || e.liberadoAt || r.conferidoAt || r.liberadoAt || r.dataResultado || r.updatedAt || r.createdAt || '')
        : (e.dataResultado || e.resultDate || '');

      const titulo = e.tituloLaudo || e.titulo || (catEx && catEx.tituloLaudo) || e.name || e.exame || (catEx && catEx.name) || eCode || 'EXAME';
      const material = e.material || (catEx && (catEx.materialLaudo || catEx.material)) || 'Soro';
      const metodo = e.metodo || e.method || (catEx && (catEx.metodoLaudo || catEx.metodo)) || 'Colorimétrico';
      const equipamento = e.equipamento || e.equipment || (catEx && (catEx.equipment || catEx.equipamento)) || '';

      const refVal = e.valorReferencia || e.referenceValue || (catEx && (catEx.valorReferenciaLaudo || catEx.valorReferencia || catEx.referencia || catEx.valRef)) || 'Verificar cadastro técnico.';
      const interpVal = e.interpretacao || e.interpretation || (catEx && catEx.interpretacao) || '';
      const obsVal = e.observacoesLaudo || e.observacao || e.observations || (catEx && (catEx.observacoesLaudo || catEx.observacoesNotaReferencias)) || '';
      const modeloLaudo = e.modeloLaudo || (catEx && catEx.modeloLaudo) || 'Padrão LIS InovaLab';

      let rawResult = isExamLiberado ? (e.resultado !== undefined ? e.resultado : (e.result !== undefined ? e.result : '')) : '';
      let unitVal = e.unidade || e.unit || (catEx && (catEx.unidade || catEx.unit)) || '';

      let linhas = [];
      if (Array.isArray(e.linhas) && e.linhas.length > 0) {
        linhas = e.linhas.map(l => ({
          PARAMETRO: l.PARAMETRO || l.part1 || 'Resultado',
          resultado: isExamLiberado ? (l.resultado !== undefined ? l.resultado : '') : '',
          unidade: l.unidade || unitVal || '',
          referencia: l.referencia || refVal || ''
        }));
      } else {
        linhas = [{
          PARAMETRO: 'Resultado',
          resultado: rawResult,
          unidade: unitVal,
          referencia: refVal
        }];
      }

      const resultsFormatted = linhas.map(l => {
        let valStr = String(l.resultado || '').trim();
        let uStr = String(l.unidade || '').trim();
        if (uStr && valStr.toLowerCase().endsWith(uStr.toLowerCase())) {
          uStr = '';
        }
        const combinedVal = `${valStr}${uStr ? ' ' + uStr : ''}`.trim();
        return {
          parameter: l.PARAMETRO || 'Resultado',
          value: combinedVal,
          resultadoRaw: valStr,
          unidade: l.unidade || '',
          reference: l.referencia || refVal,
          status: 'Normal'
        };
      });

      return {
        codigo: eCode,
        nome: eName,
        name: titulo,
        titulo: titulo,
        material: material,
        metodo: metodo,
        equipamento: equipamento,
        status: eStatus,
        laudoDisponivel: isExamLiberado,
        pdfUrl: isExamLiberado ? pdfEndpoint : null,
        dataColeta: formatDateTimeToBR(e.dataColeta || e.coletaDate || r.createdAt || ''),
        dataResultado: isExamLiberado ? formatDateTimeToBR(rawDataResultado) : '',
        resultado: rawResult,
        unidade: unitVal,
        valorReferencia: refVal,
        referenceValue: refVal,
        interpretacao: interpVal,
        interpretation: interpVal,
        observacao: obsVal,
        observations: obsVal,
        observacoesLaudo: obsVal,
        modeloLaudo: modeloLaudo,
        linhas: linhas,
        results: resultsFormatted
      };
    });

    const hasAnyLiberado = isReqLiberado || examsList.some(e => e.laudoDisponivel);
    const pdfReqEndpoint = `/api/paciente/laudo/pdf?requisicao=${reqCode}`;

    return {
      codigoRequisicao: reqCode,
      data: formatDateTimeToBR(r.createdAt || r.fatura || ''),
      status: reqStatus,
      solicitante: r.doctorName || r.responsibleName || 'Dr. Solicitante',
      laudoDisponivel: hasAnyLiberado,
      pdfUrl: hasAnyLiberado ? pdfReqEndpoint : null,
      listaExames: examsList,
      exams: examsList
    };
  });
}

// Auxiliar de formatação do perfil
function formatPatientProfile(patient) {
  const ruaNum = patient.street ? (patient.number ? `${patient.street}, ${patient.number}` : patient.street) : (patient.address || '');
  const bairro = patient.neighborhood ? ` - ${patient.neighborhood}` : '';
  const cidUf = patient.city ? `, ${patient.city}${patient.state ? ' - ' + patient.state : ''}` : '';
  const cepPart = patient.cep ? `, CEP: ${patient.cep}` : '';
  const enderecoCompleto = `${ruaNum}${bairro}${cidUf}${cepPart}`.trim();

  return {
    id: patient.id || `PAC-${patient.code || 1}`,
    codigo: String(patient.code || patient.id || '1'),
    nome: patient.name || '',
    cpf: patient.cpf || '',
    dataNascimento: formatDateToBR(patient.birthDate || ''),
    contato: patient.phone || patient.celular || '',
    email: patient.email || '',
    endereco: {
      rua: patient.street || '',
      numero: patient.number || '',
      bairro: patient.neighborhood || '',
      cidade: patient.city || '',
      estado: patient.state || '',
      cep: patient.cep || '',
      completo: enderecoCompleto
    },
    convenio: patient.convenio || ''
  };
}

// 1. ENDPOINT DE LOGIN DO PACIENTE (Retorna Token com expiração)
router.all(['/api/paciente/login', '/api/pacientes/login'], async (req, res) => {
  try {
    const query = req.body?.cpf || req.body?.codigo || req.body?.code || req.body?.usuario || req.body?.id || req.body?.prontuario || req.body?.login ||
                  req.query?.cpf || req.query?.codigo || req.query?.code || req.query?.usuario || req.query?.id || req.query?.prontuario || req.query?.login;

    const password = req.body?.senha || req.body?.password || req.body?.webPassword || req.body?.pass ||
                     req.query?.senha || req.query?.password || req.query?.webPassword || req.query?.pass;

    if (!query || String(query).trim() === '') {
      return res.status(400).json({
        success: false,
        error: "Identificador obrigatório ausente",
        message: "Informe o 'cpf' ou o 'codigo' do paciente."
      });
    }

    if (!password || String(password).trim() === '') {
      return res.status(400).json({
        success: false,
        error: "Senha obrigatória",
        message: "Informe o campo 'senha' para realizar o login."
      });
    }

    const patient = findPatientRecord(query);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: "Paciente não encontrado",
        message: "Nenhum cadastro encontrado com o CPF ou Código informado."
      });
    }

    // Buscar requisições para checar senhas vinculadas
    const requisitions = loadRequisitions();
    const patientCodeStr = String(patient.code || patient.id || '').toLowerCase();
    const patientCpfClean = String(patient.cpf || '').replace(/\D/g, '');

    const reqsFound = requisitions.filter(r => {
      const rCpfClean = String(r.patientCpf || '').replace(/\D/g, '');
      const rCode = String(r.patientCode || '').toLowerCase();
      if (patientCpfClean && patientCpfClean.length >= 11 && rCpfClean === patientCpfClean) return true;
      if (patientCodeStr && rCode && rCode === patientCodeStr) return true;
      return false;
    });

    const isPassValid = validatePassword(patient, reqsFound, password);
    if (!isPassValid) {
      return res.status(401).json({
        success: false,
        error: "Senha incorreta",
        message: "A senha digitada está incorreta para este paciente."
      });
    }

    // Gerar token de acesso (Bearer Token)
    const tokenData = generatePatientToken(patient);

    return res.json({
      success: true,
      message: "Login realizado com sucesso",
      ...tokenData,
      paciente: {
        id: patient.id || `PAC-${patient.code || 1}`,
        codigo: String(patient.code || patient.id || '1'),
        nome: patient.name || '',
        cpf: patient.cpf || ''
      }
    });

  } catch (error) {
    console.error("Erro no login do paciente:", error);
    return res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      message: error.message
    });
  }
});

// 2. ENDPOINT DO PERFIL DO PACIENTE (/me /perfil) - Leve e autenticado por Token
router.all(['/api/paciente/me', '/api/paciente/perfil'], async (req, res) => {
  try {
    const tokenPayload = verifyPatientToken(req);

    let patient = null;
    if (tokenPayload) {
      patient = findPatientRecord(tokenPayload.code || tokenPayload.patientId || tokenPayload.cpf);
    } else {
      // Fallback para envio direto de cpf/codigo na query/body se sem token
      const query = req.body?.cpf || req.body?.codigo || req.query?.cpf || req.query?.codigo;
      if (query) patient = findPatientRecord(query);
    }

    if (!patient) {
      return res.status(401).json({
        success: false,
        error: "Não autorizado ou token inválido/expirado",
        message: "Forneça um token válido no header 'Authorization: Bearer <token>' para acessar o perfil."
      });
    }

    return res.json({
      success: true,
      data: formatPatientProfile(patient)
    });

  } catch (error) {
    console.error("Erro ao buscar perfil do paciente:", error);
    return res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      message: error.message
    });
  }
});

// 3. ENDPOINT DE FILTRO DE EXAMES (/exames) - Leve, paginado/filtrável por status, datas e código
router.all(['/api/paciente/exames', '/api/pacientes/exames'], async (req, res) => {
  try {
    const tokenPayload = verifyPatientToken(req);

    let patient = null;
    if (tokenPayload) {
      patient = findPatientRecord(tokenPayload.code || tokenPayload.patientId || tokenPayload.cpf);
    } else {
      // Fallback para envio de cpf/codigo se sem token
      const query = req.body?.cpf || req.body?.codigo || req.query?.cpf || req.query?.codigo;
      if (query) patient = findPatientRecord(query);
    }

    if (!patient) {
      return res.status(401).json({
        success: false,
        error: "Não autorizado ou token inválido/expirado",
        message: "Forneça um token válido no header 'Authorization: Bearer <token>' para consultar os exames."
      });
    }

    const requisitions = loadRequisitions();
    const patientCodeStr = String(patient.code || patient.id || '').toLowerCase();
    const patientCpfClean = String(patient.cpf || '').replace(/\D/g, '');
    const patientNameStr = String(patient.name || '').toLowerCase();

    // Filtros adicionais recebidos na requisição
    const filterStatus = String(req.query?.status || req.body?.status || '').toLowerCase().trim();
    const filterReqCode = String(req.query?.codigoRequisicao || req.query?.requisicao || req.body?.codigoRequisicao || req.body?.requisicao || '').toLowerCase().trim();
    const filterSearch = String(req.query?.busca || req.query?.query || req.body?.busca || req.body?.query || '').toLowerCase().trim();

    let reqsFound = requisitions.filter(r => {
      const rCpfClean = String(r.patientCpf || '').replace(/\D/g, '');
      const rCode = String(r.patientCode || '').toLowerCase();
      const rName = String(r.patientName || '').toLowerCase();

      let matchPatient = false;
      if (patientCpfClean && patientCpfClean.length >= 11 && rCpfClean === patientCpfClean) matchPatient = true;
      if (patientCodeStr && rCode && rCode === patientCodeStr) matchPatient = true;
      if (patientNameStr && rName && rName === patientNameStr) matchPatient = true;

      if (!matchPatient) return false;

      // Aplicar filtros de busca
      if (filterStatus && String(r.status || '').toLowerCase() !== filterStatus) return false;
      if (filterReqCode && !String(r.requisitionCode || r.id || '').toLowerCase().includes(filterReqCode)) return false;

      if (filterSearch) {
        const docMatch = String(r.doctorName || '').toLowerCase().includes(filterSearch);
        const reqMatch = String(r.requisitionCode || '').toLowerCase().includes(filterSearch);
        const examMatch = (r.exams || []).some(e => String(e.name || e.code || '').toLowerCase().includes(filterSearch));
        if (!docMatch && !reqMatch && !examMatch) return false;
      }

      return true;
    });

    const examesFormatados = formatRequisitionExams(reqsFound);

    return res.json({
      success: true,
      totalRequisicoes: examesFormatados.length,
      exames: examesFormatados
    });

  } catch (error) {
    console.error("Erro na consulta de exames do paciente:", error);
    return res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      message: error.message
    });
  }
});

// 4. ENDPOINT LEGADO DE CONSULTA COMPLETA (/consultar)
router.all(['/api/paciente/consultar', '/api/paciente/consulta', '/api/paciente/buscar'], async (req, res) => {
  try {
    const query = req.body?.cpf || req.body?.codigo || req.body?.code || req.body?.usuario || req.body?.id || req.body?.prontuario || req.body?.login ||
                  req.query?.cpf || req.query?.codigo || req.query?.code || req.query?.usuario || req.query?.id || req.query?.prontuario || req.query?.login;

    const password = req.body?.senha || req.body?.password || req.body?.webPassword || req.body?.pass ||
                     req.query?.senha || req.query?.password || req.query?.webPassword || req.query?.pass;

    if (!query || String(query).trim() === '') {
      return res.status(400).json({
        success: false,
        error: "Parâmetro obrigatório ausente",
        message: "Informe o 'cpf' ou o 'codigo' do paciente."
      });
    }

    const patient = findPatientRecord(query);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: "Paciente não encontrado",
        message: `Nenhum paciente ou registro encontrado com os dados informados (${query}).`
      });
    }

    const requisitions = loadRequisitions();
    const patientCodeStr = String(patient.code || patient.id || '').toLowerCase();
    const patientCpfClean = String(patient.cpf || '').replace(/\D/g, '');
    const patientNameStr = String(patient.name || '').toLowerCase();

    const reqsFound = requisitions.filter(r => {
      const rCpfClean = String(r.patientCpf || '').replace(/\D/g, '');
      const rCode = String(r.patientCode || '').toLowerCase();
      const rName = String(r.patientName || '').toLowerCase();

      if (patientCpfClean && patientCpfClean.length >= 11 && rCpfClean === patientCpfClean) return true;
      if (patientCodeStr && rCode && rCode === patientCodeStr) return true;
      if (patientNameStr && rName && rName === patientNameStr) return true;
      return false;
    });

    if (password && String(password).trim() !== '') {
      const isValid = validatePassword(patient, reqsFound, password);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: "Senha incorreta",
          message: "A senha informada não confere com o cadastro do paciente."
        });
      }
    }

    const examesFormatados = formatRequisitionExams(reqsFound);

    const profileData = formatPatientProfile(patient);

    return res.json({
      success: true,
      data: {
        ...profileData,
        exames: examesFormatados,
        totalRequisicoes: examesFormatados.length
      }
    });

  } catch (error) {
    console.error("Erro na consulta de paciente:", error);
    return res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      message: error.message
    });
  }
});

// =====================================================
// Helper para tratamento e limpeza de HTML para PDFKit
function cleanHtmlForPdf(input) {
  if (!input) return '';
  return String(input)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<strong[^>]*>/gi, '<b>')
    .replace(/<\/strong>/gi, '</b>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .trim();
}

// HELPER: FORMATADOR DE TEXTO COM TAGS <b>...</b>
// =====================================================
function renderPdfFormattedText(doc, text, options = {}) {
  if (!text) return;

  const {
    indent = 45,
    width = 515,
    fillColor = '#334155',
    fontSize = 8.5,
    align = 'left'
  } = options;

  const cleanedText = cleanHtmlForPdf(text);
  if (!cleanedText) return;

  const lines = cleanedText.split('\n');

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      doc.moveDown(0.3);
      return;
    }

    doc.x = indent;

    if (!line.includes('<b>')) {
      doc.font('Courier')
         .fontSize(fontSize)
         .fillColor(fillColor);
      doc.text(line, indent, doc.y, {
        width: width,
        align: align,
        continued: false
      });
      return;
    }

    const parts = line.split(/(<b>.*?<\/b>)/g);
    const segments = [];

    parts.forEach(part => {
      if (!part) return;
      if (part.startsWith('<b>') && part.endsWith('</b>')) {
        const content = part.slice(3, -4);
        if (content) segments.push({ text: content, isBold: true });
      } else {
        segments.push({ text: part, isBold: false });
      }
    });

    if (segments.length === 0) return;

    segments.forEach((seg, index) => {
      const isLast = index === segments.length - 1;
      doc.font(seg.isBold ? 'Courier-Bold' : 'Courier')
         .fontSize(fontSize)
         .fillColor(fillColor);

      doc.text(seg.text, {
        width: width,
        align: align,
        continued: !isLast
      });
    });
  });
}

// Helper para leitura segura de imagens em PDFKit
function safeReadImageBuffer(input) {
  if (!input) return null;
  let buf = null;
  try {
    if (Buffer.isBuffer(input)) {
      buf = input;
    } else if (typeof input === 'string') {
      if (input.startsWith('data:image')) {
        const base64Data = input.replace(/^data:image\/\w+;base64,/, '');
        buf = Buffer.from(base64Data, 'base64');
      } else {
        const relPath = input.startsWith('/') ? input.slice(1) : input;
        const filePath = path.isAbsolute(input) ? input : path.join(process.cwd(), 'public', relPath);
        if (fs.existsSync(filePath)) {
          buf = fs.readFileSync(filePath);
        } else if (fs.existsSync(input)) {
          buf = fs.readFileSync(input);
        }
      }
    }
    if (!buf || buf.length < 8) return null;

    // Rejeita buffers corrompidos por conversão UTF-8 (ex: efbfbd)
    if (buf.slice(0, 3).toString('hex') === 'efbfbd') {
      return null;
    }

    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

    if (!isPng && !isJpg) {
      return null;
    }

    if (isPng) {
      if (buf.length < 24 || buf[4] !== 0x0d || buf[5] !== 0x0a || buf[6] !== 0x1a || buf[7] !== 0x0a) {
        return null;
      }
      if (buf.slice(12, 16).toString('ascii') !== 'IHDR') {
        return null;
      }
    }

    return buf;
  } catch (e) {
    console.error("Erro ao ler buffer de imagem para PDF:", e);
    return null;
  }
}

// Helper para desenhar marca d'água vetorial de DNA no PDF sem depender de arquivo de imagem
function drawVectorDnaWatermark(doc, x, y, width, height) {
  try {
    doc.save();
    doc.opacity(0.07);
    doc.strokeColor("#1E3E17").lineWidth(1.2);
    doc.fillColor("#8A7142");

    const steps = 14;
    const stepH = height / steps;
    for (let i = 0; i <= steps; i++) {
      const cy = y + i * stepH;
      const offset1 = Math.sin((i / steps) * Math.PI * 3.5) * (width * 0.35);
      const offset2 = -offset1;

      const x1 = x + width / 2 + offset1;
      const x2 = x + width / 2 + offset2;

      if (i % 2 === 0) {
        doc.moveTo(x1, cy).lineTo(x2, cy).strokeColor("#8A7142").lineWidth(0.8).stroke();
      }
      doc.circle(x1, cy, 2).fill("#1E3E17");
      doc.circle(x2, cy, 2).fill("#8A7142");
    }
    doc.restore();
  } catch (err) {
    console.error("Erro ao desenhar marca d'água vetorial:", err);
  }
}

// =====================================================
// RODAPÉ FIXO (DESENHADO EM TODAS AS PÁGINAS)
// =====================================================
function drawFooter(doc, pageNum, totalPages, sigInfo) {
  try {
    console.log(`[LAUDO PDF LOG] 🎨 Desenhando rodapé da página ${pageNum} de ${totalPages}...`);
    const origBottom = doc.page.margins.bottom;
    const origTop = doc.page.margins.top;
    doc.page.margins.bottom = 0;
    doc.page.margins.top = 0;

    const pageWidth = 595.28;
    const pageHeight = doc.page.height || 841.89;
    const footerY = 785;
    const footerHeight = pageHeight - footerY + 5; // Estende o fundo verde até o fim da página, eliminando a faixa branca

    // Marca d'Água (DNA) no canto inferior direito do laudo
    const wHeight = 350;
    const wWidth = 180;
    const targetRight = 555;
    const wX = targetRight - wWidth;
    const wY = footerY - 10 - wHeight;

    let watermarkDrawn = false;
    const marcaDaguaPath = path.join(process.cwd(), 'public', 'marca-dagua.png');
    const marcaDaguaBuf = safeReadImageBuffer(marcaDaguaPath);
    if (marcaDaguaBuf) {
      try {
        doc.image(marcaDaguaBuf, wX, wY, { width: wWidth, height: wHeight });
        watermarkDrawn = true;
      } catch (e) {
        console.error("[LAUDO PDF LOG] ⚠️ Falha ao desenhar marca-dagua.png:", e.message);
      }
    }

    if (!watermarkDrawn) {
      drawVectorDnaWatermark(doc, wX + 20, wY + 20, wWidth - 40, wHeight - 40);
    }

    // Assinatura Digitalizada do Profissional (Exibida no canto inferior direito, mais à direita da página)
    if (sigInfo) {
      const sigWidth = 165;
      const sigX = pageWidth - 5 - sigWidth; // Alinhado à margem direita
      const sigY = footerY - 44; // Compactado para economizar espaço no laudo

      let imgDrawn = false;
      if (sigInfo.signatureFile) {
        const sigBuf = safeReadImageBuffer(sigInfo.signatureFile);
        if (sigBuf) {
          try {
            doc.image(sigBuf, sigX + (sigWidth - 100) / 2, sigY - 2, { width: 100, height: 25, fit: [100, 25], align: 'center' });
            imgDrawn = true;
          } catch (e) {
            console.error("Erro ao desenhar imagem de assinatura:", e.message || e);
          }
        }
      }

      if (!imgDrawn) {
        const defaultSigPath = path.join(process.cwd(), 'public', 'signatures', 'mgamaral.png');
        const defaultSigBuf = safeReadImageBuffer(defaultSigPath);
        if (defaultSigBuf) {
          try {
            doc.image(defaultSigBuf, sigX + (sigWidth - 100) / 2, sigY - 2, { width: 100, height: 25, fit: [100, 25], align: 'center' });
            imgDrawn = true;
          } catch (e) {}
        }
      }

      // Linhas de Texto da Assinatura (Nome e Cargo + Conselho na mesma linha)
      const textY = imgDrawn ? (sigY + 23) : (sigY + 10);
      doc.fillColor('#0f172a').fontSize(7.0).font('Helvetica-Bold')
         .text(sigInfo.name || 'Maria Gabriela de Oliveira Amaral', sigX, textY, { width: sigWidth, align: 'center', lineBreak: false });

      const titleCouncilStr = [sigInfo.laudoTitle || 'Biomédica', sigInfo.laudoCouncil || 'CRBM-PR: 5929'].filter(Boolean).join(' - ');
      doc.fillColor('#334155').fontSize(6.5).font('Helvetica')
         .text(titleCouncilStr, sigX, textY + 9, { width: sigWidth, align: 'center', lineBreak: false });
    }

    // Página X de Y e Texto de Valor Preditivo na mesma linha (acima da faixa verde)
    if (pageNum && totalPages) {
      doc.fillColor('#334155').fontSize(7.5).font('Helvetica-Bold')
         .text('Página: ' + pageNum + ' de ' + totalPages, 30, footerY - 12, { lineBreak: false });
    }

    // Texto de Aviso Clínico / Valor Preditivo em linha única
    doc.fillColor('#475569').fontSize(6.8).font('Helvetica')
       .text('O valor preditivo dos testes laboratoriais depende da situação clínico epidemiológica do(a) paciente.', 120, footerY - 12, { width: 305, align: 'left', lineBreak: false });

    // Fundo Verde Institucional
    doc.rect(0, footerY, pageWidth, footerHeight).fill('#1E3E17');

    const colY = footerY + 6;

    // Função auxiliar para desenhar ícones em crachá circular bronze/dourado no rodapé
    const drawFooterIcon = (iconType, cx, cy) => {
      doc.save();
      doc.circle(cx, cy, 4).fill('#987F47');

      if (iconType === 'phone') {
        doc.path(`M ${cx - 1.5} ${cy - 2.1} C ${cx - 2.0} ${cy - 2.1} ${cx - 2.3} ${cy - 1.6} ${cx - 2.0} ${cy - 1.1} L ${cx - 1.3} ${cy - 0.2} C ${cx - 1.1} ${cy + 0.1} ${cx - 0.7} ${cy + 0.1} ${cx - 0.5} ${cy - 0.1} L ${cx - 0.1} ${cy - 0.5} C ${cx + 0.5} ${cy - 0.1} ${cx + 0.9} ${cy + 0.3} ${cx + 1.2} ${cy + 0.8} L ${cx + 0.7} ${cy + 1.2} C ${cx + 0.5} ${cy + 1.4} ${cx + 0.5} ${cy + 1.8} ${cx + 0.8} ${cy + 2.0} L ${cx + 1.7} ${cy + 2.6} C ${cx + 2.2} ${cy + 2.9} ${cx + 2.7} ${cy + 2.7} ${cx + 2.7} ${cy + 2.2} C ${cx + 2.6} ${cy + 0.8} ${cx + 1.6} ${cy - 0.8} ${cx + 0.3} ${cy - 1.9} C ${cx - 0.6} ${cy - 2.5} ${cx - 1.0} ${cy - 2.1} ${cx - 1.5} ${cy - 2.1} Z`).fill('#FFFFFF');
      } else if (iconType === 'email') {
        doc.rect(cx - 2.2, cy - 1.6, 4.4, 3.2).lineWidth(0.5).strokeColor('#FFFFFF').stroke();
        doc.moveTo(cx - 2.2, cy - 1.6).lineTo(cx, cy + 0.2).lineTo(cx + 2.2, cy - 1.6).lineWidth(0.5).strokeColor('#FFFFFF').stroke();
      } else if (iconType === 'web') {
        doc.circle(cx, cy, 2.2).lineWidth(0.5).strokeColor('#FFFFFF').stroke();
        doc.moveTo(cx - 2.2, cy).lineTo(cx + 2.2, cy).lineWidth(0.4).strokeColor('#FFFFFF').stroke();
        doc.moveTo(cx, cy - 2.2).lineTo(cx, cy + 2.2).lineWidth(0.4).strokeColor('#FFFFFF').stroke();
        doc.ellipse(cx, cy, 1.0, 2.2).lineWidth(0.4).strokeColor('#FFFFFF').stroke();
      } else if (iconType === 'instagram') {
        doc.roundedRect(cx - 2.1, cy - 2.1, 4.2, 4.2, 1.1).lineWidth(0.5).strokeColor('#FFFFFF').stroke();
        doc.circle(cx, cy, 1.0).lineWidth(0.4).strokeColor('#FFFFFF').stroke();
        doc.circle(cx + 1.2, cy - 1.2, 0.3).fill('#FFFFFF');
      } else if (iconType === 'facebook') {
        doc.fillColor('#FFFFFF').fontSize(5.5).font('Helvetica-Bold')
           .text('f', cx - 1.4, cy - 3.2, { width: 3, align: 'center', lineBreak: false });
      }
      doc.restore();
    };

    // Contato
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold').text('CONTATO:', 30, colY, { lineBreak: false });
    doc.fillColor('#E2E8F0').fontSize(7.5).font('Helvetica');

    drawFooterIcon('phone', 35, colY + 15.5);
    doc.text('(43) 99618-3406', 42, colY + 12, { lineBreak: false });

    drawFooterIcon('email', 35, colY + 25.5);
    doc.text('inovalabcambara@gmail.com', 42, colY + 22, { lineBreak: false });

    drawFooterIcon('web', 35, colY + 35.5);
    doc.text('www.inovalabcambara.com.br', 42, colY + 32, { lineBreak: false });

    // Divisor 1
    doc.strokeColor('#FFFFFF').lineWidth(0.8)
       .moveTo(180, footerY + 6).lineTo(180, footerY + footerHeight - 6).stroke();

    // Redes Sociais
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold').text('REDES SOCIAIS:', 192, colY, { lineBreak: false });
    doc.fillColor('#E2E8F0').fontSize(7.5).font('Helvetica');

    drawFooterIcon('instagram', 197, colY + 15.5);
    doc.text('inovalabcambara', 204, colY + 12, { lineBreak: false });

    drawFooterIcon('facebook', 197, colY + 25.5);
    doc.text('Inovalab-Cambará', 204, colY + 22, { lineBreak: false });

    // Divisor 2
    doc.strokeColor('#FFFFFF').lineWidth(0.8)
       .moveTo(310, footerY + 6).lineTo(310, footerY + footerHeight - 6).stroke();

    // Responsável Técnica
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold').text('RESPONSÁVEL TÉCNICA:', 322, colY, { lineBreak: false });
    doc.fillColor('#E2E8F0').fontSize(7.5).font('Helvetica');
    doc.text('Monara Natana Idem', 322, colY + 12, { lineBreak: false });
    doc.text('CRF/PR 28.129', 322, colY + 22, { lineBreak: false });

    // PNCQ & SBAC Logos ou Selo Acreditação
    const pncqImgPath = path.join(process.cwd(), 'public', 'pncq.png');
    const sbacImgPath = path.join(process.cwd(), 'public', 'sbac.png');
    const pncqLogo = path.join(process.cwd(), 'public', 'pncq-sbac-logo.png');

    const pncqBuf = safeReadImageBuffer(pncqImgPath);
    const sbacBuf = safeReadImageBuffer(sbacImgPath);
    const pncqLogoBuf = safeReadImageBuffer(pncqLogo);

    if (pncqBuf && sbacBuf) {
      try {
        doc.image(pncqBuf, 440, colY + 2, { height: 35 });
        doc.image(sbacBuf, 482, colY + 1, { height: 38 });
      } catch (err) {
        console.error("Erro ao renderizar pncq.png/sbac.png:", err);
      }
    } else if (pncqLogoBuf) {
      try {
        doc.image(pncqLogoBuf, 435, colY + 4, { width: 65 });
      } catch {
        doc.fillColor('#FFFFFF').fontSize(7.5).font('Helvetica-Bold').text('PNCQ | SBAC', 440, colY + 16, { lineBreak: false });
      }
    } else {
      doc.rect(435, colY + 2, 75, 36).lineWidth(1).strokeColor('#A2884E').fill('#2A5222');
      doc.fillColor('#FFFFFF').fontSize(7.5).font('Helvetica-Bold').text('PNCQ | SBAC', 435, colY + 8, { width: 75, align: 'center', lineBreak: false });
      doc.fillColor('#D1FAE5').fontSize(6.5).font('Helvetica').text('QUALIDADE 2026', 435, colY + 21, { width: 75, align: 'center', lineBreak: false });
    }

    // Símbolo do Laboratório / Banner DNA (Restrito estritamente dentro da faixa verde)
    const bannerLabPath = path.join(process.cwd(), 'public', 'banner-laboratorio.png');
    const bannerLabBuf = safeReadImageBuffer(bannerLabPath);
    if (bannerLabBuf) {
      try {
        doc.save();
        doc.rect(0, footerY, pageWidth, footerHeight).clip();
        doc.image(bannerLabBuf, pageWidth - 72, footerY, { height: footerHeight, fit: [72, footerHeight] });
        doc.restore();
      } catch (e) {
        console.error("Erro ao carregar banner-laboratorio.png no rodapé:", e);
      }
    }

    doc.y = 0;
  } catch (errFooter) {
    console.error(`[LAUDO PDF ERROR] ❌ Exceção ao desenhar rodapé (página ${pageNum}):`, errFooter);
  }
}

export async function generatePdfForRequisition(reqFound) {
  const startTime = Date.now();
  const reqCodeForLog = reqFound.requisitionCode || reqFound.id || 'DESCONHECIDO';
  console.log(`[LAUDO PDF LOG] 🚀 Iniciando geração de PDF para requisição: ${reqCodeForLog}`);
  return new Promise((resolve, reject) => {
    try {
      const reqCode = reqFound.requisitionCode || reqFound.id;
      const formattedReqs = formatRequisitionExams([reqFound], { includeAllResults: true, forPdf: true });
      const formattedReq = formattedReqs[0] || {};

      const allPatients = loadPatients();
      let patientName = reqFound.patientName || reqFound.nomePaciente || reqFound.paciente || '';
      let patientCode = reqFound.patientCode || reqFound.idPaciente || reqFound.patientId || '';
      let patientAge = reqFound.patientAge || reqFound.idade || '';
      let doctor = reqFound.doctorName || reqFound.responsibleName || 'Dr. Solicitante';
      let convenio = reqFound.convenio || reqFound.insurance || 'Particular';
      let procedencia = reqFound.procedencia || 'Laboratório Central';

      if (!patientName || !patientAge || patientName === 'Não Informado') {
        const matchedP = allPatients.find(p => 
          String(p.id || '').toLowerCase() === String(patientCode).toLowerCase() ||
          String(p.code || '').toLowerCase() === String(patientCode).toLowerCase() ||
          (patientName && String(p.name || '').toLowerCase() === String(patientName).toLowerCase())
        );
        if (matchedP) {
          if (!patientName || patientName === 'Não Informado') patientName = matchedP.name || matchedP.nome || patientName;
          if (!patientAge) patientAge = matchedP.age || matchedP.idade || 'N/I';
          if (!convenio || convenio === 'Particular') convenio = matchedP.insurance || matchedP.convenio || convenio;
        }
      }
      if (!patientName) patientName = 'Não Informado';
      if (!patientAge) patientAge = 'N/I';

      const dataColeta = formattedReq.data || formatDateTimeToBR(reqFound.createdAt || new Date());
      const dataEmissao = formatDateTimeToBR(new Date());
      const liberadoPor = reqFound.liberadoPor || reqFound.conferidoPor || 'MARIA GABRIELA DE OLIVEIRA AMARAL';
      const hash = getOrCreateHashForPatient(reqCode, patientName);

      const professionals = loadProfessionals();
      const libClean = String(liberadoPor || '').toLowerCase().replace(/dr\(a\)\.|\bdr\b|\bdra\b/gi, '').trim();

      let matchedProf = professionals.find(p => {
        if (!p || !p.name) return false;
        const pName = String(p.name).toLowerCase().replace(/dr\(a\)\.|\bdr\b|\bdra\b/gi, '').trim();
        return libClean.includes(pName) || pName.includes(libClean);
      });

      if (!matchedProf) {
        matchedProf = professionals.find(p => String(p.name || '').toLowerCase().includes('maria gabriela')) || professionals[0];
      }

      const sigInfo = {
        name: matchedProf ? matchedProf.name : 'MARIA GABRIELA DE OLIVEIRA AMARAL',
        laudoTitle: matchedProf ? (matchedProf.laudoTitle || matchedProf.role || matchedProf.title || 'Biomédica') : 'Biomédica',
        laudoCouncil: matchedProf ? (matchedProf.laudoCouncil || (matchedProf.regType && matchedProf.regNumber ? `${matchedProf.regType.split(' ')[0]}-${matchedProf.regState || 'PR'}: ${matchedProf.regNumber}` : 'CRBM-PR: 5929')) : 'CRBM-PR: 5929',
        signatureFile: matchedProf ? (matchedProf.signatureFile || '/signatures/mgamaral.png') : '/signatures/mgamaral.png'
      };

      console.log(`[LAUDO PDF LOG] 📋 Paciente: "${patientName}" | Idade: "${patientAge}" | Exames: ${(formattedReq.exams || []).length} | Signatário: "${sigInfo.name}"`);

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 35, bottom: 75, left: 40, right: 40 },
        bufferPages: true
      });

      const timeoutTimer = setTimeout(() => {
        try { doc.end(); } catch (e) {}
        console.error(`[LAUDO PDF ERROR] ⏱️ Timeout ao gerar PDF do laudo (${reqCode})`);
        reject(new Error("Timeout ao gerar PDF do laudo (limite de 10s excedido)."));
      }, 10000);

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        clearTimeout(timeoutTimer);
        const pdfBuffer = Buffer.concat(chunks);
        const elapsed = Date.now() - startTime;
        console.log(`[LAUDO PDF LOG] ✅ PDF gerado com SUCESSO para ${reqCode} em ${elapsed}ms. Tamanho: ${pdfBuffer.length} bytes.`);
        resolve(pdfBuffer);
      });
      doc.on('error', err => {
        clearTimeout(timeoutTimer);
        console.error(`[LAUDO PDF ERROR] ❌ Erro interno no PDFKit para ${reqCode}:`, err);
        reject(err);
      });

      const headerData = {
        patientName,
        patientAge,
        doctor,
        convenio,
        procedencia,
        reqCode,
        dataColeta,
        dataEmissao
      };

      function renderHeader(docObj) {
        try {
          const startY = 35;

          // Logo
          const logoPath = path.join(process.cwd(), 'public', 'logo-inovalab.png');
          const logoBuf = safeReadImageBuffer(logoPath);
          let drawnLogo = false;
          if (logoBuf) {
            try {
              docObj.image(logoBuf, 40, startY, { width: 180 });
              drawnLogo = true;
            } catch (e) {
              drawnLogo = false;
            }
          }
          if (!drawnLogo) {
            docObj.fillColor('#8A7142').fontSize(16).font('Courier-Bold').text('INOVA', 40, startY);
            docObj.fillColor('#1E3E17').fontSize(16).font('Courier-Bold').text('LAB', 95, startY);
            docObj.fillColor('#A2884E').fontSize(7.5).font('Courier-Bold').text('CUIDANDO DA SUA SAÚDE', 40, startY + 18);
          }

          // Dados da instituição
          docObj.fillColor('#0f172a').fontSize(9.5).font('Courier-Bold').text('LABORATÓRIO INOVALAB', 40, startY, { align: 'right', width: 515 });
          docObj.fillColor('#334155').fontSize(8.5).font('Courier');
          docObj.text('Rua Tiradentes, 999 - Centro - Cambará-PR', 40, startY + 12, { align: 'right', width: 515 });
          docObj.text('CNPJ: 56.428.462/0001-69', 40, startY + 23, { align: 'right', width: 515 });
          docObj.text('(43) 99618-3406 | CNES: 4832884', 40, startY + 34, { align: 'right', width: 515 });

          // Quadro do paciente
          const boxY = startY + 52;
          docObj.rect(40, boxY, 515, 58).fillAndStroke('#ffffff', '#0f2a16');
          docObj.lineWidth(1.2);

          docObj.fillColor('#0f172a').fontSize(9).font('Courier');
          docObj.text('Paciente..: ', 48, boxY + 8);
          docObj.font('Courier-Bold').fontSize(10).text(String(headerData.patientName || 'Não Informado'), 118, boxY + 8);

          docObj.font('Courier').fontSize(8.5).text(`Solicitante: ${headerData.doctor}`, 48, boxY + 21);
          docObj.text(`Convênio...: ${headerData.convenio}`, 48, boxY + 33);
          docObj.text(`Procedência: ${headerData.procedencia}`, 48, boxY + 45);

          docObj.fillColor('#0f172a').fontSize(9.5).font('Courier-Bold').text('Requisição: ' + String(headerData.reqCode), 40, boxY + 8, { align: 'right', width: 505 });
          docObj.font('Courier').fontSize(8.5).text(`Idade......: ${headerData.patientAge}`, 40, boxY + 21, { align: 'right', width: 505 });
          docObj.text(`Data Requis: ${headerData.dataColeta}`, 40, boxY + 33, { align: 'right', width: 505 });
          docObj.text(`Data Emissão: ${headerData.dataEmissao}`, 40, boxY + 45, { align: 'right', width: 505 });

          docObj.y = boxY + 68;
          console.log(`[LAUDO PDF LOG] 🏛️ Cabeçalho desenhado com sucesso. docObj.y = ${docObj.y}`);
        } catch (errHeader) {
          console.error("[LAUDO PDF ERROR] ❌ Erro ao desenhar cabeçalho:", errHeader);
        }
      }

      doc.on('pageAdded', () => {
        console.log("[LAUDO PDF LOG] 📄 Evento pageAdded disparado");
        renderHeader(doc);
      });

      console.log("[LAUDO PDF LOG] 🎨 Desenhando cabeçalho da 1ª página...");
      renderHeader(doc);

      const exams = formattedReq.exams || formattedReq.listaExames || [];
      console.log(`[LAUDO PDF LOG] 🧪 Total de exames para renderizar: ${exams.length}`);

      if (exams.length === 0) {
        doc.fillColor('#475569').fontSize(10).font('Courier').text('Nenhum exame liberado nesta requisição.', 40, doc.y);
      } else {
        exams.forEach((ex, exIndex) => {
          try {
            const examTitle = (ex.titulo || ex.name || ex.nome || ex.codigo || 'EXAME').toUpperCase();
            console.log(`[LAUDO PDF LOG] 🔬 Renderizando exame ${exIndex + 1}/${exams.length}: "${examTitle}"`);
            const matStr = ex.material || '';
            const metStr = ex.metodo || '';
            const linhasToRender = Array.isArray(ex.linhas) && ex.linhas.length > 0 ? ex.linhas : [];
            const refVal = String(ex.valorReferencia || ex.referenceValue || '').trim();
            const obsVal = String(ex.observacoesLaudo || ex.observacao || ex.observations || '').trim();

            const rawColeta = ex.dataColeta || ex.coletaDate || ex.data || headerData.dataColeta || dataColeta;
            let coletaStr = formatDateTimeToBR(rawColeta) || headerData.dataColeta || dataColeta;
            coletaStr = coletaStr.replace(/(\d{2}\/\d{2}\/)20(\d{2})/, '$1$2');

            const rawLib = String(ex.liberadoPor || ex.conferidoPor || ex.responsavel || liberadoPor || 'Maria Gabriela').trim();
            let libDisplay = rawLib;
            if (rawLib === rawLib.toUpperCase()) {
              libDisplay = rawLib.toLowerCase().split(' ').map(w => ['de','da','do','das','dos'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }

            const codSeg = ex.codSeguranca || ex.codigoSeguranca || ex.hash ||
              crypto.createHash('md5').update(`${reqCode}_${ex.codigo || ex.id || ex.nome || exIndex}_${patientName}`).digest('hex');

            const examAuthFooter = `Coleta: ${coletaStr} - Exame liberado eletronicamente por: ${libDisplay} - Cód. Seg.: ${codSeg}`;

            let estimatedExamHeight = 65;
            if (linhasToRender.length > 0) {
              estimatedExamHeight += linhasToRender.length * 16;
            } else {
              estimatedExamHeight += 16;
            }

            if (refVal) {
              const cleanRefLines = refVal.split('\n');
              let refLinesCount = 0;
              cleanRefLines.forEach(l => {
                refLinesCount += Math.ceil(Math.max(1, l.length) / 75);
              });
              estimatedExamHeight += 24 + (refLinesCount * 11);
            }

            if (obsVal) {
              const cleanObsLines = obsVal.split('\n');
              let obsLinesCount = 0;
              cleanObsLines.forEach(l => {
                obsLinesCount += Math.ceil(Math.max(1, l.length) / 75);
              });
              estimatedExamHeight += 20 + (obsLinesCount * 11);
            }

            // Considera a altura do texto de autorização no cálculo do exame (para nunca separar o exame de seu texto de liberação)
            estimatedExamHeight += 25;

            if (doc.y + estimatedExamHeight > 720 && doc.y > 165) {
              console.log(`[LAUDO PDF LOG] 📄 Adicionando nova página para o exame "${examTitle}" (doc.y=${doc.y})`);
              doc.addPage();
            }

            const bannerY = doc.y;
            doc.rect(40, bannerY, 515, 20).fillAndStroke('#DCDCDC', '#DCDCDC');
            doc.fillColor('#0f172a').fontSize(10).font('Courier-Bold').text(examTitle, 45, bannerY + 5, { width: 505, align: 'center' });
            doc.y = bannerY + 26;

            const matDisplay = matStr || 'N/I';
            const metDisplay = metStr || 'N/I';
            doc.fillColor('#334155').fontSize(8.5).font('Courier').text(`Material: ${matDisplay}   Método: ${metDisplay}`, 45, doc.y);
            doc.moveDown(0.3);
            doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
            doc.moveDown(2.3);

            const modeloLaudo = ex.modeloLaudo || 'Padrão LIS InovaLab';
            const isHemogramaModel = modeloLaudo === 'Modelo Hemograma Completo' || modeloLaudo === 'Modelo Hematologia em Colunas' || ((examTitle.includes('HEMOGRAMA') || examTitle.includes('HEMOGRAMA COMPLETO')) && modeloLaudo !== 'Padrão LIS InovaLab');

            if (isHemogramaModel) {
              // RENDERIZAÇÃO DO MODELO ESPECÍFICO DE HEMOGRAMA COMPLETO
              const rawResText = cleanHtmlForPdf(ex.resultado || ex.result || ex.resultadoText || '');
              const resLines = rawResText ? rawResText.split('\n') : [];

              if (linhasToRender.length > 0) {
                linhasToRender.forEach(l => {
                  if (doc.y > 730) doc.addPage();
                  const pName = String(l.PARAMETRO || l.part1 || '').trim();
                  const isSecHeader = pName.startsWith('===') || pName.startsWith('[') || pName.toUpperCase().includes('SÉRIE') || pName.toUpperCase().includes('ERITROGRAMA') || pName.toUpperCase().includes('LEUCOGRAMA') || pName.toUpperCase().includes('PLAQUETAS');

                  if (isSecHeader) {
                    doc.moveDown(0.3);
                    const sY = doc.y;
                    doc.rect(40, sY, 515, 14).fillAndStroke('#e2e8f0', '#cbd5e1');
                    doc.fillColor('#1e293b').fontSize(9).font('Courier-Bold').text(pName.replace(/^[=\[\s]+|[=\]\s]+$/g, ''), 45, sY + 2, { width: 505, align: 'left' });
                    doc.y = sY + 18;
                  } else {
                    const lineY = doc.y;
                    let paramDisp = pName ? (pName.endsWith(':') ? pName : pName + '...:') : 'Parâmetro:';
                    let valStr = String(l.resultado !== undefined && l.resultado !== null ? l.resultado : '').trim();
                    let unitStr = String(l.unidade || '').trim();
                    doc.fillColor('#0f172a').fontSize(11).font('Courier-Bold').text(paramDisp, 45, lineY, { width: 220 });
                    doc.fillColor('#0f172a').fontSize(11).font('Courier-Bold').text(`${valStr} ${unitStr}`.trim(), 260, lineY, { align: 'left', width: 295 });
                    doc.y = lineY + 14;
                  }
                });
              } else if (resLines.length > 0) {
                resLines.forEach(l => {
                  if (doc.y > 730) doc.addPage();
                  const trimmed = l.trim();
                  if (!trimmed) return;

                  const isSecHeader = trimmed.startsWith('===') || trimmed.startsWith('[') || (trimmed.toUpperCase().includes('SÉRIE') && (trimmed.toUpperCase().includes('ERITROGRAMA') || trimmed.toUpperCase().includes('LEUCOGRAMA') || trimmed.toUpperCase().includes('PLAQUETAS')));

                  if (isSecHeader) {
                    doc.moveDown(0.2);
                    const sY = doc.y;
                    doc.rect(40, sY, 515, 14).fillAndStroke('#e2e8f0', '#cbd5e1');
                    doc.fillColor('#1e293b').fontSize(9).font('Courier-Bold').text(trimmed.replace(/^[=\[\s]+|[=\]\s]+$/g, ''), 45, sY + 2, { width: 505, align: 'left' });
                    doc.y = sY + 18;
                  } else if (trimmed.includes(':')) {
                    const parts = trimmed.split(':');
                    const pName = parts[0].trim();
                    const pVal = parts.slice(1).join(':').trim();
                    const lineY = doc.y;
                    doc.fillColor('#0f172a').fontSize(11).font('Courier-Bold').text(pName + '...:', 45, lineY, { width: 220 });
                    doc.fillColor('#0f172a').fontSize(11).font('Courier-Bold').text(pVal, 260, lineY, { align: 'left', width: 295 });
                    doc.y = lineY + 14;
                  } else {
                    const lineY = doc.y;
                    doc.fillColor('#0f172a').fontSize(11).font('Courier').text(trimmed, 45, lineY, { width: 510 });
                    doc.y = lineY + 14;
                  }
                });
              } else {
                const lineY = doc.y;
                doc.fillColor('#0f172a').fontSize(11).font('Courier-Bold').text('Resultado...:', 45, lineY, { width: 180 });
                doc.fillColor('#0f172a').fontSize(11).font('Courier-Bold').text('Sem resultado cadastrado', 170, lineY, { align: 'left', width: 315 });
                doc.y = lineY + 16;
              }
            } else {
              // MODELO PADRÃO LIS INOVALAB (PADRÃO PARA DEMAIS EXAMES)
              if (linhasToRender.length > 0) {
                linhasToRender.forEach(l => {
                  if (doc.y > 730) doc.addPage();

                  const rawParam = String(l.PARAMETRO || l.part1 || 'Resultado').trim();
                  const isGenericParam = rawParam.toUpperCase() === 'RESULTADO' || rawParam.toUpperCase() === 'VALOR OBTIDO';
                  let paramDisplay = isGenericParam
                    ? 'Resultado...:'
                    : (rawParam.endsWith('...') ? rawParam + ':' : (rawParam.endsWith(':') ? rawParam.replace(/:$/, '...:') : rawParam + '...:'));

                  let valStr = String(l.resultado !== undefined && l.resultado !== null ? l.resultado : '').trim();
                  let unitStr = String(l.unidade || ex.unidade || ex.unit || '').trim();
                  if (unitStr && valStr.toLowerCase().endsWith(unitStr.toLowerCase())) {
                    unitStr = '';
                  }

                  const lineY = doc.y;
                  doc.fillColor('#0f172a').fontSize(14.5).font('Courier-Bold').text(paramDisplay, 45, lineY, { width: 180 });
                  doc.fillColor('#0f172a').fontSize(14.5).font('Courier-Bold').text(`${valStr}${unitStr ? '' + unitStr : ''}`, 170, lineY, { align: 'left', width: 315 });
                  doc.y = lineY + 16;
                });
              } else {
                const rawRes = cleanHtmlForPdf(ex.resultado || ex.result || ex.resultadoText || 'Sem resultado');
                const unitStr = String(ex.unidade || ex.unit || '').trim();
                const lineY = doc.y;
                doc.fillColor('#0f172a').fontSize(14.5).font('Courier-Bold').text('Resultado...:', 45, lineY, { width: 180 });
                doc.fillColor('#0f172a').fontSize(14.5).font('Courier-Bold').text(`${rawRes}${unitStr ? '' + unitStr : ''}`, 170, lineY, { align: 'left', width: 315 });
                doc.y = lineY + 16;
              }
            }

            doc.moveDown(1.3);

            if (refVal) {
              if (doc.y > 730 && doc.y > 165) doc.addPage();

              const boxStartY = doc.y;
              const boxPadding = 8;
              const boxX = 40;
              const boxWidth = 515;

              doc.y = boxStartY + boxPadding;
              doc.fillColor('#0f172a').fontSize(8.5).font('Courier-Bold').text('Valores de Referência:', boxX + boxPadding, doc.y);
              doc.moveDown(0.3);
              doc.strokeColor('#cbd5e1').lineWidth(0.6).moveTo(boxX + boxPadding, doc.y).lineTo(boxX + boxWidth - boxPadding, doc.y).stroke();
              doc.moveDown(0.4);

              renderPdfFormattedText(doc, refVal, {
                indent: boxX + boxPadding,
                width: boxWidth - (boxPadding * 2),
                align: 'justify',
                fillColor: '#334155',
                fontSize: 8.0
              });

              const boxEndY = doc.y + boxPadding;
              const boxHeight = boxEndY - boxStartY;

              doc.rect(boxX, boxStartY, boxWidth, boxHeight)
                 .lineWidth(0.8)
                 .strokeColor('#cbd5e1')
                 .stroke();

              doc.y = boxEndY + 8;
            }

            if (obsVal) {
              if (doc.y > 730 && doc.y > 165) doc.addPage();

              const obsBoxStartY = doc.y;
              const boxPadding = 6;
              const boxX = 40;
              const boxWidth = 515;

              doc.y = obsBoxStartY + boxPadding;

              renderPdfFormattedText(doc, obsVal, {
                indent: boxX + boxPadding,
                width: boxWidth - (boxPadding * 2),
                align: 'justify',
                fillColor: '#334155',
                fontSize: 8.0
              });

              const obsBoxEndY = doc.y + boxPadding;
              const obsBoxHeight = obsBoxEndY - obsBoxStartY;

              doc.rect(boxX, obsBoxStartY, boxWidth, obsBoxHeight)
                 .lineWidth(0.8)
                 .strokeColor('#cbd5e1')
                 .stroke();

              doc.y = obsBoxEndY + 10;
            }

            if (doc.y > 730 && doc.y > 165) doc.addPage();
            doc.moveDown(0.2);
            doc.fillColor('#475569').fontSize(6.0).font('Courier-Oblique').text(examAuthFooter, 45, doc.y, { width: 505, align: 'left' });
            doc.moveDown(0.6);
            console.log(`[LAUDO PDF LOG] ✅ Exame "${examTitle}" renderizado com sucesso. doc.y = ${doc.y}`);
          } catch (errEx) {
            console.error(`[LAUDO PDF ERROR] ❌ Erro ao renderizar exame ${exIndex + 1}:`, errEx);
          }
        });
      }

      if (doc.y > 725) {
        doc.addPage();
      }

      doc.removeAllListeners('pageAdded');

      const range = doc.bufferedPageRange();
      console.log(`[LAUDO PDF LOG] 📑 Total de páginas no PDFKit: ${range.count}. Aplicando rodapé em cada página...`);

      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        drawFooter(doc, i + 1, range.count, sigInfo);
      }

      console.log("[LAUDO PDF LOG] 🏁 Chamando doc.end() para finalizar o buffer do PDF...");
      doc.end();
    } catch (e) {
      console.error("[LAUDO PDF ERROR] ❌ Exceção fatal durante a geração de PDF:", e);
      reject(e);
    }
  });
}

// =====================================================
// ENDPOINT COMPLETO (VERSÃO CORRIGIDA E ESTÁVEL)
// =====================================================
router.all(['/api/paciente/laudo/pdf', '/api/pacientes/laudo/pdf', '/api/laudo/pdf'], async (req, res) => {
  try {
    const reqCode = req.query?.requisicao || req.query?.codigoRequisicao || req.query?.codigo || req.query?.id ||
                    req.body?.requisicao || req.body?.codigoRequisicao || req.body?.codigo || req.body?.id;

    console.log(`[LAUDO PDF API] 📥 Recebida solicitação HTTP de PDF para o código: "${reqCode || 'NULO'}" (Query: ${JSON.stringify(req.query)})`);

    if (!reqCode) {
      console.warn(`[LAUDO PDF API] ⚠️ Parâmetro de requisição ausente.`);
      return res.status(400).json({
        success: false,
        error: "Parâmetro 'requisicao' ausente",
        message: "Informe o código da requisição no parâmetro 'requisicao'."
      });
    }

    const requisitions = loadRequisitions();
    const reqFound = requisitions.find(r => 
      String(r.requisitionCode || '').toLowerCase() === String(reqCode).toLowerCase() ||
      String(r.id || '').toLowerCase() === String(reqCode).toLowerCase()
    );

    if (!reqFound) {
      console.warn(`[LAUDO PDF API] ⚠️ Requisição "${reqCode}" não foi encontrada no banco de dados.`);
      return res.status(404).json({
        success: false,
        error: "Requisição não encontrada",
        message: `Nenhuma requisição ou exame encontrado com o código ${reqCode}.`
      });
    }

    const statusStr = String(reqFound.status || '').toLowerCase();
    const hasTypedResults = (reqFound.exams || []).some(e => 
      Boolean(String(e.resultado !== undefined ? e.resultado : (e.result !== undefined ? e.result : '')).trim()) || 
      Boolean(String(e.resultadoText || '').trim()) ||
      (Array.isArray(e.linhas) && e.linhas.some(l => Boolean(String(l.resultado !== undefined ? l.resultado : '').trim()))) ||
      ['liberado', 'conferido', 'pronto', 'concluido', 'laudado', 'digitado'].includes(String(e.status || e.situacao || '').toLowerCase())
    );
    const isLiberado = ['liberado', 'concluido', 'pronto', 'conferido', 'laudado', 'digitado', 'coletado', 'em andamento'].includes(statusStr) ||
                      hasTypedResults || (reqFound.exams || []).length > 0;

    if (!isLiberado) {
      return res.status(403).json({
        success: false,
        error: "Laudo não liberado",
        message: `O laudo da requisição ${reqCode} ainda está com status '${reqFound.status || 'Em Análise'}'.`,
        statusAtual: reqFound.status || 'Em Análise'
      });
    }

    const forceRegenerate = (req.query?.force === 'true' || req.query?.force === '1') || !(reqFound.pdfBase64 || reqFound.laudoPdfBase64);

    let pdfBase64 = null;
    if (!forceRegenerate && (reqFound.pdfBase64 || reqFound.laudoPdfBase64)) {
      console.log(`[LAUDO PDF API] ⚡ Retornando PDF salvo em cache para requisição "${reqCode}".`);
      pdfBase64 = reqFound.pdfBase64 || reqFound.laudoPdfBase64;
      if (reqFound.isPdfGenerating) {
        reqFound.isPdfGenerating = false;
        saveRequisitions(requisitions);
      }
    } else {
      console.log(`[LAUDO PDF API] 🔄 Gerando novo PDF para requisição "${reqCode}" (forceRegenerate: ${forceRegenerate})...`);
      const pdfBuffer = await generatePdfForRequisition(reqFound);
      pdfBase64 = pdfBuffer.toString('base64');

      reqFound.pdfBase64 = pdfBase64;
      reqFound.laudoPdfBase64 = pdfBase64;
      reqFound.pdfDataUri = `data:application/pdf;base64,${pdfBase64}`;
      reqFound.isPdfGenerating = false;
      reqFound.pdfGeneratedAt = new Date().toISOString();
      saveRequisitions(requisitions);
    }

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    if (req.query?.base64 === 'true' || req.body?.base64 === true) {
      return res.json({
        success: true,
        codigoRequisicao: reqCode,
        filename: `laudo_${reqCode}.pdf`,
        mimeType: 'application/pdf',
        base64: pdfBase64,
        dataUri: `data:application/pdf;base64,${pdfBase64}`
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="laudo_${reqCode}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);

  } catch (error) {
    console.error("Erro ao gerar/recuperar PDF do laudo:", error);
    return res.status(500).json({
      success: false,
      error: "Erro na geração do PDF",
      message: error.message
    });
  }
});

// 6. PORTAL DE RESULTADOS
router.get('/resultados', (req, res) => {
  res.render('resultados', { 
    error: null,
    patient: null,
    page: 'resultados',
    seoTitle: 'Portal de Resultados Online | InovaLab Cambará',
    seoDescription: 'Acesse seus laudos e resultados de exames laboratoriais de forma rápida, segura e online. Digite seus dados de acesso fornecidos no atendimento.',
    seoKeywords: 'resultado de exames cambará, portal do paciente inovalab, laudo online cambará',
    canonicalPath: '/resultados'
  });
});

// 7. CONTATO
router.get('/contato', (req, res) => {
  res.render('contato', { 
    success: false,
    page: 'contato',
    seoTitle: 'Contato, Telefone e Endereço | InovaLab Cambará',
    seoDescription: 'Entre em contato com o InovaLab pelo WhatsApp (43) 99618-3406 ou visite nossa unidade em Cambará - PR para realizar seus exames laboratoriais.',
    seoKeywords: 'telefone inovalab, whatsapp inovalab, endereço laboratório cambará, contato inovalab',
    canonicalPath: '/contato'
  });
});

// ================= ROTAS DO BLOG PUBLICO =================

// Lista de postagens do blog
router.get('/blog', (req, res) => {
  const posts = loadBlogPosts();
  res.render('blog', {
    posts: posts.reverse(), // Mais recentes primeiro
    page: 'blog',
    seoTitle: 'Dicas de Saúde e Bem-Estar | Blog InovaLab Cambará',
    seoDescription: 'Fique por dentro das últimas novidades, dicas de prevenção, saúde e bem-estar preparadas pelos especialistas do Laboratório InovaLab.',
    seoKeywords: 'blog de saude cambará, dicas de saude laboratório, novidades inovalab',
    canonicalPath: '/blog'
  });
});

// Detalhes de um post do blog
router.get('/blog/:id', (req, res) => {
  const posts = loadBlogPosts();
  const post = posts.find(p => p.id === req.params.id);
  if (!post) {
    return res.redirect('/blog');
  }
  const currentUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  res.render('blog-post', {
    post,
    currentUrl,
    page: 'blog',
    seoTitle: `${post.title} | Blog InovaLab Cambará`,
    seoDescription: `${post.summary || post.content.substring(0, 150)}... Saiba mais no blog do Laboratório InovaLab de Cambará - PR.`,
    seoKeywords: `${post.title.toLowerCase()}, dicas de saude, inovalab`,
    canonicalPath: `/blog/${post.id}`
  });
});


export default router;
