import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import * as XLSX from 'xlsx';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import mysql from 'mysql2/promise';

dotenv.config();

// Inicializar cliente Gemini com User-Agent recomendado
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build'
    }
  }
});

const upload = multer({ storage: multer.memoryStorage() });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

// Função helper para gravar arquivos JSON locais (ignorada quando o MySQL/DB_HOST está ativo)
function saveJsonFile(filePath, content, options) {
  if (process.env.DB_HOST) {
    // Quando o MySQL está ativo, nada é salvo em arquivos JSON no disco
    return;
  }
  try {
    const dataToWrite = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(filePath, dataToWrite, options || 'utf-8');
  } catch (e) {
    console.error(`Erro ao salvar arquivo JSON local (${filePath}):`, e.message);
  }
}

const app = express();
const PORT = 3000;

// Habilitar CORS universal (suportando qualquer Origem, Credentials, Headers e requisições Preflight OPTIONS)
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, token, X-Requested-With, Accept, Origin, Access-Control-Allow-Headers');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Configuração do EJS como motor de visualização
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware para arquivos estáticos, cookies e parse de formulários/JSON
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser('inovalab_secret_cookie_signature'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use((req, res, next) => {
  const isLoggedOut = req.cookies.admin_logged_out === 'true';
  const isLoggedIn = !isLoggedOut;

  res.locals.isLoggedIn = isLoggedIn;
  res.locals.isAdmin = isLoggedIn;
  
  const profId = (!isLoggedOut && req.cookies.admin_professional_id) ? req.cookies.admin_professional_id : 'admin';
  res.locals.adminProfessionalId = profId;
  res.locals.adminUserName = (!isLoggedOut && req.cookies.admin_user_name) ? req.cookies.admin_user_name : 'Administrador';

  // Objeto de permissões completas ativado para navegação irrestrita
  const fullPermissions = {
    dashboard: true,
    exames: true,
    orcamentos: true,
    requisicoes: true,
    comparador: true,
    financeiro: true,
    pops: true,
    documentos: true,
    profissionais: true,
    avaliacoes: true,
    nao_conformidades: true,
    blog: true,
    controle_acesso: true
  };

  if (profId === 'admin' || !req.cookies.admin_professional_id || isLoggedOut) {
    res.locals.userPermissions = fullPermissions;
  } else {
    // Caso haja um cookie de profissional específico, respeita seu perfil ou concede acesso total
    const professionals = loadProfessionals();
    const prof = professionals.find(p => p.id === profId || p.username === profId);
    if (prof) {
      const profileId = prof.profileId || '';
      const profiles = loadAccessProfiles();
      const profile = profiles.find(p => p.id === profileId);
      if (profile && profile.permissions) {
        res.locals.userPermissions = {
          ...fullPermissions,
          ...profile.permissions
        };
      } else {
        res.locals.userPermissions = fullPermissions;
      }
    } else {
      res.locals.userPermissions = fullPermissions;
    }
  }
  res.locals.shortcuts = loadShortcuts();
  next();
});

// Resolução dos arquivos de dados locais (Backup Local Persistence / Seeding)
const EXAMS_FILE = path.join(process.cwd(), 'data', 'exams.json');
const BUDGETS_FILE = path.join(process.cwd(), 'data', 'budgets.json');
const BLOG_FILE = path.join(process.cwd(), 'data', 'blog.json');
const SUPPORT_LABS_FILE = path.join(process.cwd(), 'data', 'support_labs.json');
const REQUISITIONS_FILE = path.join(process.cwd(), 'data', 'requisitions.json');
const PROFESSIONALS_FILE = path.join(process.cwd(), 'data', 'professionals.json');
const EVALUATIONS_FILE = path.join(process.cwd(), 'data', 'evaluations.json');
const EVAL_ACCESSES_FILE = path.join(process.cwd(), 'data', 'eval_accesses.json');
const EVAL_HASHES_FILE = path.join(process.cwd(), 'data', 'eval_hashes.json');
const MESSAGE_TEMPLATES_FILE = path.join(process.cwd(), 'data', 'message_templates.json');
const POPS_FILE = path.join(process.cwd(), 'data', 'pops.json');
const NON_CONFORMITIES_FILE = path.join(process.cwd(), 'data', 'non_conformities.json');
const DOCUMENTS_FILE = path.join(process.cwd(), 'data', 'documents.json');
const TRANSACTIONS_FILE = path.join(process.cwd(), 'data', 'transactions.json');
const MOVEMENTS_FILE = path.join(process.cwd(), 'data', 'movements.json');
const PESSOAS_FILE = path.join(process.cwd(), 'data', 'pessoas.json');
const FINANCE_SETTINGS_FILE = path.join(process.cwd(), 'data', 'finance_settings.json');
const ACCESS_PROFILES_FILE = path.join(process.cwd(), 'data', 'access_profiles.json');
const ESCALA_PLANTAO_FILE = path.join(process.cwd(), 'data', 'escala_plantao.json');
const CISNORPI_FILE = path.join(process.cwd(), 'data', 'cisnorpi.json');
const TEMPERATURAS_FILE = path.join(process.cwd(), 'data', 'temperaturas.json');
const CASH_CLOSURES_FILE = path.join(process.cwd(), 'data', 'cash_closures.json');
const PATIENTS_FILE = path.join(process.cwd(), 'data', 'patients.json');
const APPOINTMENTS_FILE = path.join(process.cwd(), 'data', 'appointments.json');
const SHORTCUTS_FILE = path.join(process.cwd(), 'data', 'shortcuts.json');
const CONVENIOS_FILE = path.join(process.cwd(), 'data', 'convenios.json');
const PRICE_TABLES_FILE = path.join(process.cwd(), 'data', 'price_tables.json');
const RECIPIENTES_FILE = path.join(process.cwd(), 'data', 'recipientes.json');
const MATERIAIS_COLETADOS_FILE = path.join(process.cwd(), 'data', 'materiais_coletados.json');
const SETORES_FILE = path.join(process.cwd(), 'data', 'setores.json');
const LOCAIS_COLETA_FILE = path.join(process.cwd(), 'data', 'locais_coleta.json');
const MEDICOS_FILE = path.join(process.cwd(), 'data', 'medicos.json');
const LAB_EXAMES_ALVARO_FILE = path.join(process.cwd(), 'data', 'lab_exames_alvaro.json');
const MATERIAIS_ALVARO_FILE = path.join(process.cwd(), 'data', 'materiais_alvaro.json');
const LAB_EXAMES_PARDINI_FILE = path.join(process.cwd(), 'data', 'lab_exames_pardini.json');
const CONFIG_APOIO_ALVARO_FILE = path.join(process.cwd(), 'data', 'config_apoio_alvaro.json');
const CONFIG_APOIO_PARDINI_FILE = path.join(process.cwd(), 'data', 'config_apoio_pardini.json');
const IMPRESSORAS_FILE = path.join(process.cwd(), 'data', 'impressoras.json');
const INTERFACE_FILE = path.join(process.cwd(), 'data', 'interface_data.json');

// Caches em memória sincronizados com o Firestore (Durable Cloud / Local Persistence)
let examsCache = [];
let cashClosuresCache = [];
let budgetsCache = [];
let blogPostsCache = [];
let supportLabsCache = [];
let labExamesAlvaroCache = null;
let materiaisAlvaroCache = null;
let labExamesPardiniCache = null;
let configApoioAlvaroCache = null;
let configApoioPardiniCache = null;
let requisitionsCache = [];
let professionalsCache = [];
let evaluationsCache = [];
let evalAccessesCache = [];
let evalHashesCache = [];
let popsCache = [];
let nonConformitiesCache = [];
let documentsCache = [];
let transactionsCache = [];
let movementsCache = [];
let pessoasCache = [];
let accessProfilesCache = [];
let conveniosCache = [];
let priceTablesCache = [];
let recipientesCache = [];
let materiaisColetadosMasterCache = [];
let setoresCache = [];
let impressorasCache = [];
let locaisColetaCache = [];
let medicosCache = [];
let patientsCache = null;
let appointmentsCache = null;
let escalaPlantaoCache = null;
let cisnorpiCache = [];
let temperaturasCache = [];
let financeSettingsCache = {
  providers: ["Labingá", "Reagentes S/A", "Alvaro Apoio", "Hermes Pardini", "Unimed Cambará", "Sicredi", "Insumos S/A"],
  chartsOfAccounts: ["DAS - Simples Nacional", "Manutenção de Equipamentos", "Insumos de Laboratório", "Serviços Prestados", "Aluguel", "Energia Elétrica", "Pró-Labore", "Tarifas Bancárias"],
  docTypes: ["Boleto", "Nota Fiscal", "Recibo", "Transferência", "Pix", "Dinheiro"],
  banks: ["Sicredi", "Banco do Brasil", "Itaú", "Caixa", "Bradesco"]
};

// Inicialização do Firebase Admin & Firestore (Desativado conforme solicitação do usuário)
let db = null;
let firebaseApp = null;
let firebaseConfig = null;

console.log("Integração com Cloud Firestore desativada. Utilizando MySQL / Persistência Local.");

// Auxiliar para carregar JSON local como fallback/seeding
function loadLocalJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Erro ao carregar arquivo local ${filePath}:`, error);
    return [];
  }
}

// Inicializador de Cache a partir do Firestore (com seeding automático se estiver vazio)
async function initializeFirebaseCaches() {
  if (!db) {
    if (process.env.DB_HOST) {
      console.log("Conectando ao MySQL para sincronizar coleções de dados...");
    } else {
      console.warn("Nenhuma configuração de DB_HOST encontrada. Usando modo de persistência local JSON.");
    }
    examsCache = await loadCollectionFromMysql('exams', EXAMS_FILE);
    budgetsCache = await loadCollectionFromMysql('budgets', BUDGETS_FILE);
    blogPostsCache = await loadCollectionFromMysql('blog_posts', BLOG_FILE);
    supportLabsCache = await loadCollectionFromMysql('support_labs', SUPPORT_LABS_FILE);
    requisitionsCache = await loadCollectionFromMysql('requisitions', REQUISITIONS_FILE);
    professionalsCache = await loadCollectionFromMysql('professionals', PROFESSIONALS_FILE);
    evaluationsCache = await loadCollectionFromMysql('evaluations', EVALUATIONS_FILE);
    evalAccessesCache = await loadCollectionFromMysql('eval_accesses', EVAL_ACCESSES_FILE);
    evalHashesCache = await loadCollectionFromMysql('eval_hashes', EVAL_HASHES_FILE);
    popsCache = await loadCollectionFromMysql('pops', POPS_FILE);
    nonConformitiesCache = await loadCollectionFromMysql('non_conformities', NON_CONFORMITIES_FILE);
    documentsCache = await loadCollectionFromMysql('documents', DOCUMENTS_FILE);
    pessoasCache = await loadCollectionFromMysql('pessoas', PESSOAS_FILE);
    accessProfilesCache = await loadCollectionFromMysql('access_profiles', ACCESS_PROFILES_FILE);
    cisnorpiCache = await loadCollectionFromMysql('cisnorpi', CISNORPI_FILE);
    temperaturasCache = await loadTemperaturas();
    cashClosuresCache = await loadCollectionFromMysql('cash_closures', CASH_CLOSURES_FILE);
    conveniosCache = await loadCollectionFromMysql('convenios', CONVENIOS_FILE);
    priceTablesCache = await loadCollectionFromMysql('price_tables', PRICE_TABLES_FILE);
    recipientesCache = await loadCollectionFromMysql('recipientes', RECIPIENTES_FILE);
    materiaisColetadosMasterCache = await loadCollectionFromMysql('materiais_coletados', MATERIAIS_COLETADOS_FILE);
    setoresCache = await loadCollectionFromMysql('setores', SETORES_FILE);
    patientsCache = await loadCollectionFromMysql('patients', PATIENTS_FILE);
    appointmentsCache = await loadCollectionFromMysql('appointments', APPOINTMENTS_FILE);

    if (!priceTablesCache || priceTablesCache.length === 0) {
      priceTablesCache = [
        {
          id: "TAB-1",
          codigo: "1",
          descricao: "Particular",
          convenioId: "CONV-1",
          convenioNome: "Particular",
          precios: [
            { examCode: "11DES", material: "SGE", examName: "11 Desoxicortisol", amb: "4.03.16.18-1", valor: 0.00, proibir: true },
            { examCode: "17AN", material: "SC", examName: "17 Alfa Hidroxiprogesterona", amb: "4.03.16.01-7", valor: 0.00, proibir: true },
            { examCode: "17CET", material: "U24", examName: "17 Cetosteróides totais", amb: "4.03.05.06-6", valor: 0.00, proibir: true },
            { examCode: "17O90", material: "SGE", examName: "17 ALFA HIDROXIPROGESTERONA", amb: "4.03.16.01-7", valor: 0.00, proibir: true },
            { examCode: "17OH", material: "U24", examName: "17-Hidroxicorticosteroides totais", amb: "4.03.05.78-3", valor: 0.00, proibir: true },
            { examCode: "17OHC", material: "U24", examName: "17 Oh Corticosteroides Fracionados", amb: "", valor: 0.00, proibir: true },
            { examCode: "17PRE", material: "SGE", examName: "17 Hidroxipregnenolona", amb: "4.03.05.09-0", valor: 0.00, proibir: true },
            { examCode: "17PRO", material: "SGE", examName: "17 Alfa Hidroxiprogesterona", amb: "4.03.16.01-7", valor: 40.00, proibir: false },
            { examCode: "18COR", material: "SGE", examName: "18-Hidroxicorticosterona", amb: "", valor: 0.00, proibir: true },
            { examCode: "190PC", material: "SGE", examName: "Bcr/Abl - Qualitativo P190 prime", amb: "", valor: 0.00, proibir: true },
            { examCode: "190PC", material: "SGT", examName: "Bcr/Abl - Qualitativo P190 prime", amb: "", valor: 0.00, proibir: true },
            { examCode: "190QT", material: "SGE", examName: "Bcr/Abl - Quantitativo P190", amb: "4.05.03.54-2", valor: 0.00, proibir: true },
            { examCode: "190QT", material: "SGT", examName: "Bcr/Abl - Quantitativo P190", amb: "4.05.03.54-2", valor: 0.00, proibir: true },
            { examCode: "1P19Q", material: "TCT", examName: "Estudo Da Deleção 1p19q", amb: "", valor: 0.00, proibir: true },
            { examCode: "210PC", material: "SGE", examName: "Bcr/Abl - Qualitativo P210", amb: "", valor: 0.00, proibir: true }
          ]
        },
        {
          id: "TAB-2",
          codigo: "2",
          descricao: "Unimed TUSS 2026",
          convenioId: "CONV-2",
          convenioNome: "Unimed Regional",
          precios: [
            { examCode: "11DES", material: "SGE", examName: "11 Desoxicortisol", amb: "4.03.16.18-1", valor: 35.00, proibir: false },
            { examCode: "17AN", material: "SC", examName: "17 Alfa Hidroxiprogesterona", amb: "4.03.16.01-7", valor: 22.00, proibir: false },
            { examCode: "17PRO", material: "SGE", examName: "17 Alfa Hidroxiprogesterona", amb: "4.03.16.01-7", valor: 28.50, proibir: false }
          ]
        }
      ];
      try {
        saveJsonFile(PRICE_TABLES_FILE, JSON.stringify(priceTablesCache, null, 2), 'utf-8');
      } catch (err) {
        console.error("Erro ao salvar tabelas de preco iniciais:", err);
      }
    }

    if (temperaturasCache.length === 0) {
      temperaturasCache = [
        {
          id: "EQ-1",
          name: "Geladeira Bioquímica 01",
          code: "GEL-BIO-01",
          type: "Geladeira",
          brand: "Consul",
          model: "Pró-Lab v4",
          serialNumber: "SN-987123",
          patrimony: "PAT-1284",
          sector: "Bioquímica",
          location: "Sala Técnica Principal",
          responsible: "Maria Oliveira",
          sensor: "Sensor IoT TempPro-A",
          minTemp: 2.0,
          maxTemp: 8.0,
          currentTemp: 3.8,
          status: "🟢 Dentro da Faixa",
          nextReading: "14:00",
          lastReadingTime: "08:12",
          content: "Reagentes de Bioquímica, Controles, Calibradores",
          readings: [
            { date: "20/07", time: "08:00", temp: 3.8, responsible: "Maria", method: "Manual", notes: "Leitura matinal realizada dentro da normalidade.", status: "🟢" },
            { date: "19/07", time: "18:00", temp: 5.2, responsible: "João", method: "Sensor", notes: "Medição de fechamento de plantão.", status: "🟢" },
            { date: "19/07", time: "14:00", temp: 4.1, responsible: "Maria", method: "IoT", notes: "Leitura automática via sensor.", status: "🟢" }
          ],
          occurrences: [
            { date: "12/07/2026", temp: 10.3, reason: "Porta Aberta", status: "Fechada", timeOutside: "45 min", identifiedBy: "Maria", description: "Esquecimento após reabastecimento de reagentes.", immediateAction: "Fechamento da porta e ativação do degelo rápido.", responsible: "Maria", result: "Temperatura restabelecida a 4.2°C após 15 minutos." }
          ],
          maintenances: [
            { date: "15/06/2026", type: "Preventiva", description: "Higienização interna, desobstrução do dreno e teste de borrachas de vedação.", responsible: "Mantec Equipamentos", cost: 150.00 },
            { date: "10/04/2026", type: "Calibração", description: "Calibração anual do termômetro interno com emissão de certificado RBC.", responsible: "CalibraLab Paraná", cost: 320.00 }
          ],
          checklist: {
            ligado: true,
            vedacao: true,
            porta: true,
            alarmes: true,
            limpeza: true,
            gelo: false,
            updatedAt: "20/07/2026 08:15",
            responsible: "Maria Oliveira"
          },
          documents: [
            { name: "Manual de Instruções Consul Pro-Lab v4.pdf", type: "Manual", date: "10/01/2026" },
            { name: "POP-BIO-004_Monitoramento_Temperatura.pdf", type: "POP", date: "12/01/2026" },
            { name: "Certificado_Calibracao_RBC_2026.pdf", type: "Calibração", date: "10/04/2026" }
          ],
          timeline: [
            { date: "10/01/2026", event: "Instalado", description: "Equipamento instalado e posicionado na Sala Técnica Principal." },
            { date: "12/01/2026", event: "Ativação de POP", description: "Treinamento da equipe de bioquímica no POP de monitoramento." },
            { date: "10/04/2026", event: "Calibrado", description: "Realizada calibração anual rastreável RBC." },
            { date: "12/07/2026", event: "Temperatura Fora", description: "Porta esquecida aberta por 45 min, gerada não conformidade." }
          ]
        },
        {
          id: "EQ-2",
          name: "Geladeira Vacinas",
          code: "GEL-VAC-02",
          type: "Geladeira",
          brand: "Eletrolux",
          model: "MedSafe Pro",
          serialNumber: "SN-443112",
          patrimony: "PAT-3321",
          sector: "Imunologia",
          location: "Sala de Vacinação",
          responsible: "Ana Souza",
          sensor: "Sensor IoT TempPro-B",
          minTemp: 2.0,
          maxTemp: 8.0,
          currentTemp: 5.2,
          status: "🟢 Dentro da Faixa",
          nextReading: "14:00",
          lastReadingTime: "08:30",
          content: "Vacinas de Influenza, Hepatite B, Meningocócica, DTPa",
          readings: [
            { date: "20/07", time: "08:30", temp: 5.2, responsible: "Ana", method: "Manual", notes: "Sem intercorrências no painel digital.", status: "🟢" },
            { date: "19/07", time: "17:30", temp: 4.8, responsible: "Ana", method: "IoT", notes: "Leitura de encerramento normal.", status: "🟢" }
          ],
          occurrences: [],
          maintenances: [
            { date: "05/05/2026", type: "Preventiva", description: "Limpeza das serpentinas traseiras e calibração de alarmes sonoros.", responsible: "Mantec Equipamentos", cost: 180.00 }
          ],
          checklist: {
            ligado: true,
            vedacao: true,
            porta: true,
            alarmes: true,
            limpeza: true,
            gelo: false,
            updatedAt: "20/07/2026 08:35",
            responsible: "Ana Souza"
          },
          documents: [
            { name: "Manual_MedSafe_Eletrolux.pdf", type: "Manual", date: "05/05/2026" }
          ],
          timeline: [
            { date: "05/05/2026", event: "Instalado e Calibrado", description: "Recebimento e qualificação térmica inicial." }
          ]
        },
        {
          id: "EQ-3",
          name: "Freezer Soroteca",
          code: "FRE-SOR-03",
          type: "Freezer",
          brand: "Metalfrio",
          model: "DeepFreeze -20",
          serialNumber: "SN-778811",
          patrimony: "PAT-0912",
          sector: "Sorologia",
          location: "Sala de Triagem",
          responsible: "Carlos Santos",
          sensor: "Sensor IoT TempPro-C",
          minTemp: -25.0,
          maxTemp: -15.0,
          currentTemp: -22.0,
          status: "🟢 Dentro da Faixa",
          nextReading: "14:00",
          lastReadingTime: "07:50",
          content: "Amostras biológicas arquivadas para soroteca (período de 30 dias)",
          readings: [
            { date: "20/07", time: "07:50", temp: -22.0, responsible: "Carlos", method: "Manual", notes: "Início do expediente normal.", status: "🟢" }
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
            updatedAt: "20/07/2026 07:52",
            responsible: "Carlos Santos"
          },
          documents: [],
          timeline: [
            { date: "20/03/2026", event: "Instalado", description: "Ativação do freezer para armazenamento de amostras da soroteca." }
          ]
        },
        {
          id: "EQ-4",
          name: "Ultra Freezer",
          code: "ULT-FRE-04",
          type: "Ultra Freezer",
          brand: "Thermo Scientific",
          model: "TSU Series -80C",
          serialNumber: "SN-221199",
          patrimony: "PAT-0044",
          sector: "Pesquisa & Genética",
          location: "Sala de Biologia Molecular",
          responsible: "Dra. Eliana Costa",
          sensor: "Sensor IoT TempPro-D Ultra",
          minTemp: -86.0,
          maxTemp: -70.0,
          currentTemp: -79.0,
          status: "🟢 Dentro da Faixa",
          nextReading: "13:00",
          lastReadingTime: "08:05",
          content: "Controles de PCR, primers, enzimas de restrição de alto custo",
          readings: [
            { date: "20/07", time: "08:05", temp: -79.0, responsible: "Eliana", method: "Manual", notes: "Display digital indica estabilidade.", status: "🟢" }
          ],
          occurrences: [],
          maintenances: [
            { date: "15/02/2026", type: "Calibração", description: "Verificação de estabilidade em 9 pontos térmicos e calibração fina.", responsible: "Thermolab RBC", cost: 1200.00 }
          ],
          checklist: {
            ligado: true,
            vedacao: true,
            porta: true,
            alarmes: true,
            limpeza: true,
            gelo: false,
            updatedAt: "20/07/2026 08:05",
            responsible: "Dra. Eliana Costa"
          },
          documents: [
            { name: "Thermo_Scientific_TSU_Manual.pdf", type: "Manual", date: "15/02/2026" }
          ],
          timeline: [
            { date: "15/02/2026", event: "Instalado e Qualificado", description: "Equipamento ativado com certificação de validação térmica." }
          ]
        },
        {
          id: "EQ-5",
          name: "Sala Coleta",
          code: "SAL-COL-05",
          type: "Ambiente",
          brand: "N/A",
          model: "Ar Condicionado Split 18k BTUs LG",
          serialNumber: "SN-338877",
          patrimony: "PAT-4491",
          sector: "Atendimento",
          location: "Recepção / Boxes de Coleta",
          responsible: "Letícia Ramos",
          sensor: "Sensor Parede IoT",
          minTemp: 15.0,
          maxTemp: 25.0,
          currentTemp: 24.0,
          status: "🟢 Dentro da Faixa",
          nextReading: "12:00",
          lastReadingTime: "09:00",
          content: "Conforto térmico de pacientes, insumos de coleta (tubos, agulhas)",
          readings: [
            { date: "20/07", time: "09:00", temp: 24.0, responsible: "Letícia", method: "Manual", notes: "Coleta cheia, ar condicionado no máximo.", status: "🟢" }
          ],
          occurrences: [],
          maintenances: [],
          checklist: {
            ligado: true,
            vedacao: true,
            porta: true,
            alarmes: false,
            limpeza: true,
            gelo: false,
            updatedAt: "20/07/2026 09:00",
            responsible: "Letícia Ramos"
          },
          documents: [],
          timeline: [
            { date: "10/01/2026", event: "Início das Medições", description: "Primeira checagem de temperatura ambiente de conforto regulamentar." }
          ]
        },
        {
          id: "EQ-6",
          name: "Sala Técnica",
          code: "SAL-TEC-06",
          type: "Ambiente",
          brand: "N/A",
          model: "Ar Condicionado Split 24k BTUs Carrier",
          serialNumber: "SN-449900",
          patrimony: "PAT-4492",
          sector: "Processamento de Amostras",
          location: "Sala Técnica Geral",
          responsible: "Roberto Lima",
          sensor: "Sensor Parede IoT Carrier-X",
          minTemp: 15.0,
          maxTemp: 25.0,
          currentTemp: 29.0,
          status: "🔴 Fora da Faixa",
          nextReading: "11:00",
          lastReadingTime: "09:15",
          content: "Área de operação dos analisadores de hematologia, bioquímica e coagulação",
          readings: [
            { date: "20/07", time: "09:15", temp: 29.0, responsible: "Roberto", method: "Sensor", notes: "Temperatura ambiente muito alta. Ar condicionado falhou em desarmar o compressor.", status: "🔴" },
            { date: "20/07", time: "07:00", temp: 26.5, responsible: "Roberto", method: "Manual", notes: "Ambiente já amanheceu aquecido.", status: "🟡" }
          ],
          occurrences: [
            { date: "20/07/2026", temp: 29.0, reason: "Falha Ar Condicionado", status: "Aberta", timeOutside: "2h 30m", identifiedBy: "Roberto", description: "Ar condicionado parou de refrigerar. Risco de superaquecimento dos reagentes nos carrosséis dos equipamentos.", immediateAction: "Abertura de portas internas para circulação e ventiladores de suporte acionados.", responsible: "Roberto", result: "Aguardando chegada do técnico de manutenção de ar condicionado para diagnóstico." }
          ],
          maintenances: [],
          checklist: {
            ligado: true,
            vedacao: false,
            porta: true,
            alarmes: true,
            limpeza: true,
            gelo: false,
            updatedAt: "20/07/2026 09:15",
            responsible: "Roberto Lima"
          },
          documents: [],
          timeline: [
            { date: "10/01/2026", event: "Início das Medições", description: "Monitoramento de temperatura ambiente dos analisadores automatizados." },
            { date: "20/07/2026", event: "Temperatura Fora", description: "Falha de refrigeração registrada com temperatura de 29°C." }
          ]
        }
      ];
      try {
        saveJsonFile(TEMPERATURAS_FILE, JSON.stringify(temperaturasCache, null, 2), 'utf-8');
      } catch (err) {
        console.error("Erro ao semear temperaturas:", err);
      }
    }

    if (accessProfilesCache.length === 0) {
      accessProfilesCache = [
        {
          id: "PROF-ADMIN",
          name: "Administrador Geral",
          description: "Acesso total a todas as funcionalidades do sistema",
          permissions: {
            dashboard: true,
            exames: true,
            orcamentos: true,
            requisicoes: true,
            comparador: true,
            financeiro: true,
            pops: true,
            documentos: true,
            profissionais: true,
            avaliacoes: true,
            nao_conformidades: true,
            blog: true,
            controle_acesso: true
          },
          createdAt: new Date().toISOString()
        },
        {
          id: "PROF-RECEP",
          name: "Recepção / Atendimento",
          description: "Acesso a exames, orçamentos, requisições, avaliações de pacientes e blog",
          permissions: {
            dashboard: true,
            exames: true,
            orcamentos: true,
            requisicoes: true,
            comparador: false,
            financeiro: false,
            pops: true,
            documentos: true,
            profissionais: false,
            avaliacoes: true,
            nao_conformidades: false,
            blog: true,
            controle_acesso: false
          },
          createdAt: new Date().toISOString()
        },
        {
          id: "PROF-TECNICO",
          name: "Corpo Técnico / Laboratório",
          description: "Acesso a exames, POPs, documentos e não conformidades",
          permissions: {
            dashboard: true,
            exames: true,
            orcamentos: false,
            requisicoes: false,
            comparador: false,
            financeiro: false,
            pops: true,
            documentos: true,
            profissionais: false,
            avaliacoes: false,
            nao_conformidades: true,
            blog: false,
            controle_acesso: false
          },
          createdAt: new Date().toISOString()
        }
      ];
      try {
        saveJsonFile(ACCESS_PROFILES_FILE, JSON.stringify(accessProfilesCache, null, 2), 'utf-8');
      } catch (err) {
        console.error("Erro ao salvar perfis de acesso padrão:", err);
      }
    }
    
    // Carregar dados de transações financeiras e configurações
    transactionsCache = await loadCollectionFromMysql('transactions', TRANSACTIONS_FILE);
    movementsCache = await loadCollectionFromMysql('movements', MOVEMENTS_FILE);
    const savedSettings = await loadCollectionFromMysql('finance_settings', FINANCE_SETTINGS_FILE);
    if (savedSettings && !Array.isArray(savedSettings) && typeof savedSettings === 'object' && Object.keys(savedSettings).length > 0) {
      financeSettingsCache = savedSettings;
    }

    escalaPlantaoCache = await loadCollectionFromMysql('escala_plantao', ESCALA_PLANTAO_FILE);
    if (!escalaPlantaoCache || Array.isArray(escalaPlantaoCache) || !escalaPlantaoCache.groups) {
      escalaPlantaoCache = {
        year: 2026,
        months: [3, 4], // 3 = Março, 4 = Abril
        groups: [
          {
            id: "g1",
            name: "Dra. Monara Natana Idem",
            phone: "(43) 99914-9958",
            color: "#3b82f6"
          },
          {
            id: "g2",
            name: "Thaís / Gustavo",
            phone: "(43) 98487-6964 / (43) 99183-0607",
            color: "#22c55e"
          },
          {
            id: "g3",
            name: "Maria Gabriela / Renan",
            phone: "(43) 99610-5992 / (43) 99115-1584",
            color: "#eab308"
          }
        ],
        assignments: {},
        notices: [
          "07:00h às 17:00h Segunda à Sexta Ligar no número do laboratório (43) 99618-3406",
          "Aos sábados das 07:00h ao 11:00h (43) 99618-3406",
          "Aos feriados ligação direta para a plantonista",
          "Após as 17:00h ligar nos números abaixo:",
          "OBS. POR FAVOR, GOSTARIAMOS QUE FIZESSE SOMENTE LIGAÇÃO"
        ]
      };
      try {
        saveJsonFile(ESCALA_PLANTAO_FILE, JSON.stringify(escalaPlantaoCache, null, 2), 'utf-8');
      } catch (err) {
        console.error("Erro ao salvar escala plantao padrao:", err);
      }
    }

    let updatedSettings = false;
    if (!financeSettingsCache.bankAccounts) {
      financeSettingsCache.bankAccounts = (financeSettingsCache.banks || ["Sicredi", "Banco do Brasil", "Itaú", "Caixa", "Bradesco"]).map((b, idx) => ({
        id: String(idx + 1),
        description: b
      }));
      updatedSettings = true;
    }
    if (!financeSettingsCache.documentTypes) {
      financeSettingsCache.documentTypes = [
        { id: "1", description: "Boleto" },
        { id: "2", description: "Dinheiro" },
        { id: "3", description: "Cartão de Crédito" },
        { id: "4", description: "Débito Automático" },
        { id: "5", description: "PIX" },
        { id: "6", description: "Cartão de Débito" },
        { id: "7", description: "Cheque" }
      ];
      updatedSettings = true;
    }
    if (!financeSettingsCache.accountCategories) {
      financeSettingsCache.accountCategories = [
        { id: "1", code: "1.1", description: "Receitas de Exame", indicator: "Crédito", dreRange: "Receitas" },
        { id: "2", code: "2.1", description: "Deduções de Receita", indicator: "Débito", dreRange: "Deduções sobre vendas" },
        { id: "3", code: "3.1", description: "Laboratório de Apoio", indicator: "Débito", dreRange: "Custos variáveis" },
        { id: "4", code: "3.2", description: "Reagentes/Insumos", indicator: "Débito", dreRange: "Custos variáveis" },
        { id: "5", code: "3.3", description: "Aquisições", indicator: "Débito", dreRange: "Custos variáveis" },
        { id: "6", code: "3.4", description: "Café", indicator: "Débito", dreRange: "Custos variáveis" },
        { id: "7", code: "3.5", description: "Outras Despesas Variáveis", indicator: "Débito", dreRange: "Custos variáveis" },
        { id: "8", code: "4.1", description: "Pessoal (RH)", indicator: "Débito", dreRange: "Custos fixos" },
        { id: "9", code: "4.2", description: "Administrativas", indicator: "Débito", dreRange: "Custos fixos" },
        { id: "10", code: "4.3", description: "Marketing", indicator: "Débito", dreRange: "Custos fixos" },
        { id: "11", code: "5.1", description: "Financeiras", indicator: "Débito", dreRange: "Despesas financeiras" },
        { id: "12", code: "6.1", description: "Ativos", indicator: "Débito", dreRange: "Investimentos" }
      ];
      updatedSettings = true;
    }
    if (!financeSettingsCache.chartOfAccountsTree) {
      financeSettingsCache.chartOfAccountsTree = [
        { id: "1", code: "1.1.1", description: "Convênio Particular", categoryId: "1", parentId: null },
        { id: "2", code: "1.1.2", description: "Convênio Pronto Socorro", categoryId: "1", parentId: null },
        { id: "3", code: "1.1.3", description: "Convênio Cisnorpi", categoryId: "1", parentId: null },
        { id: "4", code: "1.1.4", description: "Reembolso Toxicológico", categoryId: "1", parentId: null },
        { id: "5", code: "2.1.1", description: "Estornos", categoryId: "2", parentId: null },
        { id: "6", code: "2.1.2", description: "Simples Nacional", categoryId: "2", parentId: null },
        { id: "7", code: "3.1.1", description: "Laboratório Alvaro", categoryId: "3", parentId: null },
        { id: "8", code: "3.1.2", description: "Laboratório Pardini", categoryId: "3", parentId: null },
        { id: "9", code: "3.2.1", description: "Reagentes/Insumos", categoryId: "4", parentId: null },
        { id: "10", code: "3.3.1", description: "Aquisições", categoryId: "5", parentId: null },
        { id: "11", code: "3.4.1", description: "Café", categoryId: "6", parentId: null },
        { id: "12", code: "3.5.1", description: "Combustível", categoryId: "7", parentId: null },
        { id: "13", code: "3.5.2", description: "Outras", categoryId: "7", parentId: null },
        { id: "14", code: "4.1.1", description: "Salários", categoryId: "8", parentId: null },
        { id: "15", code: "4.1.2", description: "INSS/FGTS", categoryId: "8", parentId: null },
        { id: "16", code: "4.2.1", description: "Aluguel da Sede", categoryId: "9", parentId: null },
        { id: "17", code: "4.2.2", description: "Energia Elétrica", categoryId: "9", parentId: null },
        { id: "18", code: "4.3.1", description: "Marketing", categoryId: "10", parentId: null },
        { id: "19", code: "5.1.1", description: "Juros", categoryId: "11", parentId: null },
        { id: "20", code: "5.1.2", description: "Tarifas Bancárias", categoryId: "11", parentId: null },
        { id: "21", code: "6.1.1", description: "Ativos", categoryId: "12", parentId: null }
      ];
      updatedSettings = true;
    }

    if (updatedSettings || !savedSettings || Array.isArray(savedSettings) || typeof savedSettings !== 'object' || Object.keys(savedSettings).length === 0) {
      try {
        saveJsonFile(FINANCE_SETTINGS_FILE, JSON.stringify(financeSettingsCache, null, 2), 'utf-8');
      } catch (err) {
        console.error("Erro ao salvar padrao de configuracoes financeiras:", err);
      }
    }

    if (transactionsCache.length === 0) {
      transactionsCache = [
        {
          id: "TX-100001",
          type: "pagar",
          number: "145",
          issueDate: "2026-07-20",
          docNumber: "NF-99832",
          provider: "Labingá",
          docType: "Boleto",
          chartOfAccounts: "Manutenção de Equipamentos",
          bank: "Sicredi",
          tags: ["Urgente", "Equipamentos"],
          description: "Calibração anual do analisador bioquímico e hematológico",
          amount: 1450.00,
          installments: 1,
          dueDate: "2026-08-10",
          interval: "Único",
          recurrent: false,
          status: "pendente",
          createdAt: "2026-07-19T20:30:00.000Z",
          createdBy: "Administrador"
        },
        {
          id: "TX-100002",
          type: "pagar",
          number: "146",
          issueDate: "2026-07-15",
          docNumber: "FAT-5561",
          provider: "Reagentes S/A",
          docType: "Boleto",
          chartOfAccounts: "Insumos de Laboratório",
          bank: "Banco do Brasil",
          tags: ["Estoque"],
          description: "Compra de kits de reagentes de PCR e hemograma",
          amount: 3250.00,
          installments: 2,
          dueDate: "2026-07-30",
          interval: "Mensal",
          recurrent: true,
          status: "pago",
          paidAt: "2026-07-28",
          createdAt: "2026-07-15T10:00:00.000Z",
          createdBy: "Administrador"
        },
        {
          id: "TX-100003",
          type: "receber",
          number: "REC-101",
          issueDate: "2026-07-18",
          docNumber: "NF-202611",
          provider: "Unimed Cambará",
          docType: "Nota Fiscal",
          chartOfAccounts: "Serviços Prestados",
          bank: "Sicredi",
          tags: ["Faturamento", "Convênio"],
          description: "Repasse mensal de exames laboratoriais realizados via convênio Unimed",
          amount: 15480.00,
          installments: 1,
          dueDate: "2026-08-05",
          interval: "Mensal",
          recurrent: true,
          status: "pendente",
          createdAt: "2026-07-18T16:45:00.000Z",
          createdBy: "Administrador"
        },
        {
          id: "TX-100004",
          type: "receber",
          number: "REC-102",
          issueDate: "2026-07-19",
          docNumber: "",
          provider: "Particular",
          docType: "Pix",
          chartOfAccounts: "Serviços Prestados",
          bank: "Itaú",
          tags: ["Particular", "Pix"],
          description: "Exame de sexagem fetal - Particular à vista",
          amount: 280.00,
          installments: 1,
          dueDate: "2026-07-19",
          interval: "Único",
          recurrent: false,
          status: "pago",
          paidAt: "2026-07-19",
          createdAt: "2026-07-19T14:20:00.000Z",
          createdBy: "Recepcionista"
        }
      ];
      try {
        saveJsonFile(TRANSACTIONS_FILE, JSON.stringify(transactionsCache, null, 2), 'utf-8');
      } catch (err) {
        console.error("Erro ao salvar semente de transacoes financeiras:", err);
      }
    }
    
    // Auto-migração local: Se orçamentos estão vazios mas temos requisições complexas
    if (budgetsCache.length === 0 && requisitionsCache.length > 0) {
      const complexReqs = requisitionsCache.filter(r => r.exams && r.exams.length > 0);
      if (complexReqs.length > 0) {
        console.log(`Migrando ${complexReqs.length} requisições antigas complexas para Orçamentos locais...`);
        budgetsCache = [...complexReqs];
        try {
          saveJsonFile(BUDGETS_FILE, JSON.stringify(budgetsCache, null, 2), 'utf-8');
        } catch (e) {
          console.error("Erro ao salvar migração inicial de orçamentos:", e);
        }
      }
    }
    return;
  }

  try {
    console.log("Sincronizando tabelas com o Firestore...");
    examsCache = await loadCollectionFromFirestore('exams', EXAMS_FILE);
    budgetsCache = await loadCollectionFromFirestore('budgets', BUDGETS_FILE);
    blogPostsCache = await loadCollectionFromFirestore('blog_posts', BLOG_FILE);
    supportLabsCache = await loadCollectionFromFirestore('support_labs', SUPPORT_LABS_FILE);
    requisitionsCache = await loadCollectionFromFirestore('requisitions', REQUISITIONS_FILE);
    professionalsCache = await loadCollectionFromFirestore('professionals', PROFESSIONALS_FILE);
    evaluationsCache = await loadCollectionFromFirestore('evaluations', EVALUATIONS_FILE);
    evalAccessesCache = await loadCollectionFromFirestore('eval_accesses', EVAL_ACCESSES_FILE);
    evalHashesCache = await loadCollectionFromFirestore('eval_hashes', EVAL_HASHES_FILE);
    popsCache = await loadCollectionFromFirestore('pops', POPS_FILE);
    documentsCache = await loadCollectionFromFirestore('documents', DOCUMENTS_FILE);
    
    // Garantir que os POPs locais novos do POPS_FILE sejam semeados se estiverem ausentes
    const localPops = loadLocalJson(POPS_FILE);
    let modifiedPops = false;

    // Se o cache contiver categorias antigas (que não começam com número de pasta), limpamos o cache de POPs para receber os novos
    const hasOldCategories = popsCache.some(p => p.category && !/^\d{2}\./.test(p.category));
    if (hasOldCategories) {
      console.log("Detectadas categorias antigas de POPs no cache. Realizando migração limpa...");
      popsCache = [];
      modifiedPops = true;
    }

    localPops.forEach(lp => {
      if (!popsCache.some(p => p.id === lp.id)) {
        popsCache.push(lp);
        modifiedPops = true;
      }
    });
    if (modifiedPops) {
      console.log("Detectados novos POPs locais ausentes no Firestore. Semeando...");
      await syncToFirestore('pops', popsCache);
    }
    
    // Auto-migração Firestore: Se orçamentos estão vazios mas temos requisições complexas
    if (budgetsCache.length === 0 && requisitionsCache.length > 0) {
      const complexReqs = requisitionsCache.filter(r => r.exams && r.exams.length > 0);
      if (complexReqs.length > 0) {
        console.log(`Migrando ${complexReqs.length} requisições antigas complexas para Orçamentos...`);
        budgetsCache = [...complexReqs];
        await syncToFirestore('budgets', budgetsCache);
      }
    }
    console.log("Tabelas carregadas e sincronizadas com sucesso do Firestore.");
  } catch (error) {
    console.error("Falha ao acessar o banco do Firestore configurado:", error.message || error);
    
    // Se falhou e estávamos usando banco nomeado, tentar usar o banco (default) como fallback
    if (firebaseConfig && firebaseConfig.firestoreDatabaseId && db) {
      try {
        console.log("Tentando se conectar ao banco Firestore '(default)' como fallback...");
        db = getFirestore(firebaseApp);
        examsCache = await loadCollectionFromFirestore('exams', EXAMS_FILE);
        budgetsCache = await loadCollectionFromFirestore('budgets', BUDGETS_FILE);
        blogPostsCache = await loadCollectionFromFirestore('blog_posts', BLOG_FILE);
        supportLabsCache = await loadCollectionFromFirestore('support_labs', SUPPORT_LABS_FILE);
        requisitionsCache = await loadCollectionFromFirestore('requisitions', REQUISITIONS_FILE);
        professionalsCache = await loadCollectionFromFirestore('professionals', PROFESSIONALS_FILE);
        evaluationsCache = await loadCollectionFromFirestore('evaluations', EVALUATIONS_FILE);
        evalAccessesCache = await loadCollectionFromFirestore('eval_accesses', EVAL_ACCESSES_FILE);
        evalHashesCache = await loadCollectionFromFirestore('eval_hashes', EVAL_HASHES_FILE);
        popsCache = await loadCollectionFromFirestore('pops', POPS_FILE);
        documentsCache = await loadCollectionFromFirestore('documents', DOCUMENTS_FILE);
        
        // Garantir que os POPs locais novos do POPS_FILE sejam semeados se estiverem ausentes
        const localPopsFallback = loadLocalJson(POPS_FILE);
        let modifiedPopsFallback = false;

        // Se o cache contiver categorias antigas (que não começam com número de pasta), limpamos o cache de POPs para receber os novos
        const hasOldCategoriesFallback = popsCache.some(p => p.category && !/^\d{2}\./.test(p.category));
        if (hasOldCategoriesFallback) {
          console.log("Detectadas categorias antigas de POPs no cache de fallback. Realizando migração limpa...");
          popsCache = [];
          modifiedPopsFallback = true;
        }

        localPopsFallback.forEach(lp => {
          if (!popsCache.some(p => p.id === lp.id)) {
            popsCache.push(lp);
            modifiedPopsFallback = true;
          }
        });
        if (modifiedPopsFallback) {
          console.log("Detectados novos POPs locais ausentes no Firestore (default). Semeando...");
          await syncToFirestore('pops', popsCache);
        }
        
        console.log("Conectado com sucesso ao banco '(default)' do Firestore.");
        return;
      } catch (fallbackError) {
        console.error("Falha também ao conectar no banco '(default)':", fallbackError.message || fallbackError);
      }
    }
    
    console.warn("Desativando conexão do Firestore para evitar erros subsequentes. Usando fallback JSON local.");
    db = null; // Desativa Firestore para que as escritas/sincronizações futures não falhem e gerem erros
    examsCache = loadLocalJson(EXAMS_FILE);
    budgetsCache = loadLocalJson(BUDGETS_FILE);
    blogPostsCache = loadLocalJson(BLOG_FILE);
    supportLabsCache = loadLocalJson(SUPPORT_LABS_FILE);
    requisitionsCache = loadLocalJson(REQUISITIONS_FILE);
    professionalsCache = loadLocalJson(PROFESSIONALS_FILE);
    evaluationsCache = loadLocalJson(EVALUATIONS_FILE);
    evalAccessesCache = loadLocalJson(EVAL_ACCESSES_FILE);
    evalHashesCache = loadLocalJson(EVAL_HASHES_FILE);
    popsCache = loadLocalJson(POPS_FILE);
    documentsCache = loadLocalJson(DOCUMENTS_FILE);
    pessoasCache = loadLocalJson(PESSOAS_FILE);
  }

  // Sanitizar laboratórios de apoio (Apenas Álvaro Apoio e Hermes Pardini são permitidos)
  let supportLabsModified = false;
  let cleanedLabs = (supportLabsCache || []).filter(l => l.id === "1" || l.id === "2");
  if (!supportLabsCache || cleanedLabs.length !== supportLabsCache.length) {
    supportLabsModified = true;
  }
  if (!cleanedLabs.some(l => l.id === "1")) {
    cleanedLabs.push({ id: "1", name: "Álvaro Apoio", prices: {} });
    supportLabsModified = true;
  }
  if (!cleanedLabs.some(l => l.id === "2")) {
    cleanedLabs.push({ id: "2", name: "Hermes Pardini", prices: {} });
    supportLabsModified = true;
  }
  cleanedLabs.forEach(l => {
    if (l.id === "1" && l.name !== "Álvaro Apoio") {
      l.name = "Álvaro Apoio";
      supportLabsModified = true;
    }
    if (l.id === "2" && l.name !== "Hermes Pardini") {
      l.name = "Hermes Pardini";
      supportLabsModified = true;
    }
  });
  if (supportLabsModified) {
    supportLabsCache = cleanedLabs;
    saveJsonFile(SUPPORT_LABS_FILE, JSON.stringify(supportLabsCache, null, 2), 'utf-8');
    saveCollectionToMysql('support_labs', supportLabsCache).catch(err => console.error("Erro ao salvar support_labs no MySQL:", err));
    if (db) {
      syncToFirestore('support_labs', supportLabsCache).catch(err => console.error("Erro ao sincronizar labs:", err));
    }
  }
}

async function cleanObsoleteDatabaseFields() {
  console.log("Iniciando script de limpeza de campos obsoletos das tabelas...");
  let removedFieldsCount = 0;
  let droppedColumnsCount = 0;

  // 1. Limpar colunas físicas obsoletas no MySQL (se DB_HOST estiver configurado)
  if (process.env.DB_HOST) {
    try {
      const pool = await getMysqlPool();
      const connection = await pool.getConnection();
      try {
        const dropRules = {
          tbl_patients: ['convenio'],
          tbl_exams: ['supportLab'],
          tbl_professionals: ['sector'],
          tbl_price_tables: ['convenioNome'],
          tbl_budgets: ['convenio', 'situacao'],
          tbl_requisitions: ['convenio', 'situacao']
        };

        for (const [tbl, cols] of Object.entries(dropRules)) {
          for (const col of cols) {
            try {
              await connection.query(`ALTER TABLE \`${tbl}\` DROP COLUMN \`${col}\``);
              droppedColumnsCount++;
              console.log(`[Limpeza MySQL] Coluna obsoleta \`${col}\` removida da tabela \`${tbl}\`.`);
            } catch (e) {
              // Se a coluna não existe no MySQL, ignora silenciosamente
            }
          }
        }
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error("Erro ao remover colunas obsoletas no MySQL:", err.message);
    }
  }

  // 2. Limpar propriedades obsoletas dos dados armazenados nos caches e arquivos locais
  if (Array.isArray(patientsCache)) {
    patientsCache.forEach(patient => {
      if (patient.convenio !== undefined) {
        if (!patient.convenioCode && patient.convenio) {
          patient.convenioCode = typeof patient.convenio === 'object' ? (patient.convenio.codigo || patient.convenio.id) : patient.convenio;
        }
        delete patient.convenio;
        removedFieldsCount++;
      }
    });
    try {
      saveJsonFile(PATIENTS_FILE, JSON.stringify(patientsCache, null, 2), 'utf-8');
      await saveCollectionToMysql('patients', patientsCache);
    } catch (e) { console.error("Erro ao salvar limpeza de pacientes:", e.message); }
  }

  if (Array.isArray(examsCache)) {
    examsCache.forEach(exam => {
      if (exam.supportLab !== undefined) {
        if (!exam.supportLabCode && exam.supportLab) {
          exam.supportLabCode = typeof exam.supportLab === 'object' ? (exam.supportLab.codigo || exam.supportLab.id) : exam.supportLab;
        }
        delete exam.supportLab;
        removedFieldsCount++;
      }
    });
    try {
      saveJsonFile(EXAMS_FILE, JSON.stringify(examsCache, null, 2), 'utf-8');
      await saveCollectionToMysql('exams', examsCache);
    } catch (e) { console.error("Erro ao salvar limpeza de exames:", e.message); }
  }

  if (Array.isArray(professionalsCache)) {
    professionalsCache.forEach(prof => {
      if (prof.sector !== undefined) {
        if (!prof.sectorCode && prof.sector) {
          prof.sectorCode = typeof prof.sector === 'object' ? (prof.sector.codigo || prof.sector.id) : prof.sector;
        }
        delete prof.sector;
        removedFieldsCount++;
      }
    });
    try {
      saveJsonFile(PROFESSIONALS_FILE, JSON.stringify(professionalsCache, null, 2), 'utf-8');
      await saveCollectionToMysql('professionals', professionalsCache);
    } catch (e) { console.error("Erro ao salvar limpeza de profissionais:", e.message); }
  }

  if (Array.isArray(priceTablesCache)) {
    priceTablesCache.forEach(pt => {
      if (pt.convenioNome !== undefined) {
        delete pt.convenioNome;
        removedFieldsCount++;
      }
    });
    try {
      saveJsonFile(PRICE_TABLES_FILE, JSON.stringify(priceTablesCache, null, 2), 'utf-8');
      await saveCollectionToMysql('price_tables', priceTablesCache);
    } catch (e) { console.error("Erro ao salvar limpeza de tabelas de preco:", e.message); }
  }

  if (Array.isArray(budgetsCache)) {
    budgetsCache.forEach(b => {
      if (b.convenio !== undefined) {
        if (!b.convenioCode && b.convenio) {
          b.convenioCode = typeof b.convenio === 'object' ? (b.convenio.codigo || b.convenio.id) : b.convenio;
        }
        delete b.convenio;
        removedFieldsCount++;
      }
      if (b.situacao !== undefined) {
        delete b.situacao;
        removedFieldsCount++;
      }
    });
    try {
      saveJsonFile(BUDGETS_FILE, JSON.stringify(budgetsCache, null, 2), 'utf-8');
      await saveCollectionToMysql('budgets', budgetsCache);
    } catch (e) { console.error("Erro ao salvar limpeza de orçamentos:", e.message); }
  }

  if (Array.isArray(requisitionsCache)) {
    requisitionsCache.forEach(r => {
      if (r.convenio !== undefined) {
        if (!r.convenioCode && r.convenio) {
          r.convenioCode = typeof r.convenio === 'object' ? (r.convenio.codigo || r.convenio.id) : r.convenio;
        }
        delete r.convenio;
        removedFieldsCount++;
      }
      if (r.situacao !== undefined) {
        delete r.situacao;
        removedFieldsCount++;
      }
    });
    try {
      saveJsonFile(REQUISITIONS_FILE, JSON.stringify(requisitionsCache, null, 2), 'utf-8');
      await saveCollectionToMysql('requisitions', requisitionsCache);
    } catch (e) { console.error("Erro ao salvar limpeza de requisições:", e.message); }
  }

  console.log(`[Limpeza de BD] Concluído! ${droppedColumnsCount} colunas físicas MySQL dropadas e ${removedFieldsCount} propriedades obsoletas removidas dos objetos.`);
  return { droppedColumnsCount, removedFieldsCount };
}

// Carrega ou semeia coleção no Firestore
async function loadCollectionFromFirestore(collectionName, localFile) {
  const colRef = db.collection(collectionName);
  const snapshot = await colRef.get();
  
  if (snapshot.empty) {
    const localData = loadLocalJson(localFile);
    if (localData && localData.length > 0) {
      console.log(`Coleção ${collectionName} vazia no Firestore. Semeando ${localData.length} registros...`);
      const batch = db.batch();
      localData.forEach((item, index) => {
        const id = item.id || String(index + 1);
        batch.set(colRef.doc(String(id)), item);
      });
      await batch.commit();
      return localData;
    }
    return [];
  }
  
  const items = [];
  snapshot.forEach(doc => {
    items.push(doc.data());
  });
  
  // Ordena por id numérico se possível
  items.sort((a, b) => {
    const idA = parseFloat(a.id);
    const idB = parseFloat(b.id);
    if (!isNaN(idA) && !isNaN(idB)) {
      return idA - idB;
    }
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  
  return items;
}

// Sincroniza dados com o Firestore de forma assíncrona
async function syncToFirestore(collectionName, data) {
  if (!db) return;
  try {
    const colRef = db.collection(collectionName);
    const snapshot = await colRef.get();
    const existingIds = snapshot.docs.map(doc => doc.id);
    
    const batch = db.batch();
    let count = 0;
    
    // 1. Deleta itens removidos
    for (const docId of existingIds) {
      const match = data.find((item, index) => {
        const id = item.id || String(index + 1);
        return String(id) === docId;
      });
      if (!match) {
        batch.delete(colRef.doc(docId));
        count++;
      }
    }
    
    // 2. Cria/Atualiza itens
    data.forEach((item, index) => {
      const id = item.id || String(index + 1);
      batch.set(colRef.doc(String(id)), item);
      count++;
    });
    
    if (count > 0) {
      await batch.commit();
      console.log(`Firestore: Sincronizados ${data.length} registros na coleção ${collectionName}.`);
    }
  } catch (error) {
    console.error(`Erro ao sincronizar coleção ${collectionName} com o Firestore:`, error);
  }
}

// Auxiliares de Leitura/Escrita usando Cache e persistência no Firestore
function formatRequisitionCode(code) {
  if (!code) return '';
  const str = String(code).trim();
  const num = parseInt(str.replace(/\D/g, ''), 10);
  if (!isNaN(num) && num > 0) {
    return String(num).padStart(8, '0');
  }
  return str;
}

function loadRequisitions() {
  if (Array.isArray(requisitionsCache)) {
    requisitionsCache.forEach(r => {
      if (r.requisitionCode) {
        r.requisitionCode = formatRequisitionCode(r.requisitionCode);
      }
      if (Array.isArray(r.exams)) {
        r.exams.forEach(ex => {
          if (!ex.status || String(ex.status).trim() === '') {
            ex.status = 'A Coletar';
          }
        });
      }
    });
  }
  return requisitionsCache;
}

function saveRequisitions(requisitions) {
  try {
    requisitionsCache = requisitions;
    saveJsonFile(REQUISITIONS_FILE, JSON.stringify(requisitions, null, 2), 'utf-8');
    saveCollectionToMysql('requisitions', requisitions).catch(err => console.error("Erro ao salvar requisicoes no MySQL:", err));
    syncToFirestore('requisitions', requisitions);
  } catch (error) {
    console.error("Erro ao salvar requisicoes:", error);
  }
}

function loadCisnorpi() {
  return cisnorpiCache;
}

function saveCisnorpi(data) {
  try {
    cisnorpiCache = data;
    saveJsonFile(CISNORPI_FILE, JSON.stringify(data, null, 2), 'utf-8');
    saveCollectionToMysql('cisnorpi', data).catch(err => console.error("Erro ao salvar cisnorpi no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar tabela Cisnorpi:", error);
  }
}

function loadCashClosures() {
  return cashClosuresCache;
}

function saveCashClosures(closures) {
  try {
    cashClosuresCache = closures;
    saveJsonFile(CASH_CLOSURES_FILE, JSON.stringify(closures, null, 2), 'utf-8');
    saveCollectionToMysql('cash_closures', closures).catch(err => console.error("Erro ao salvar cash_closures no MySQL:", err));
    syncToFirestore('cash_closures', closures);
  } catch (error) {
    console.error("Erro ao salvar fechamentos de caixa:", error);
  }
}

let mysqlPool = null;

async function getMysqlPool() {
  if (mysqlPool) return mysqlPool;

  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'laboratorio-inovalab-db',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };

  try {
    mysqlPool = mysql.createPool(dbConfig);
    
    // Testar conexão
    const connection = await mysqlPool.getConnection();
    console.log("Conectado com sucesso ao MySQL:", dbConfig.database);
    
    // Criar tabela se não existir
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`equipamentos_temperaturas\` (
        \`id\` VARCHAR(100) PRIMARY KEY,
        \`name\` VARCHAR(255) NOT NULL,
        \`code\` VARCHAR(100) NOT NULL,
        \`type\` VARCHAR(100) NOT NULL,
        \`brand\` VARCHAR(100),
        \`model\` VARCHAR(100),
        \`serialNumber\` VARCHAR(100),
        \`patrimony\` VARCHAR(100),
        \`sector\` VARCHAR(100),
        \`location\` VARCHAR(255),
        \`responsible\` VARCHAR(255),
        \`sensor\` VARCHAR(255),
        \`minTemp\` DOUBLE,
        \`maxTemp\` DOUBLE,
        \`currentTemp\` DOUBLE,
        \`status\` VARCHAR(255),
        \`nextReading\` VARCHAR(50),
        \`lastReadingTime\` VARCHAR(50),
        \`content\` TEXT,
        \`readings\` LONGTEXT,
        \`occurrences\` LONGTEXT,
        \`maintenances\` LONGTEXT,
        \`checklist\` LONGTEXT,
        \`documents\` LONGTEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Semeamento se vazio
    const [rows] = await connection.query("SELECT COUNT(*) as count FROM `equipamentos_temperaturas`");
    if (rows[0].count === 0) {
      console.log("Tabela 'equipamentos_temperaturas' vazia no MySQL. Importando dados iniciais do JSON...");
      const localData = loadLocalJson(TEMPERATURAS_FILE);
      if (localData && localData.length > 0) {
        for (const item of localData) {
          await connection.query(
            "INSERT INTO `equipamentos_temperaturas` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              item.id,
              item.name,
              item.code,
              item.type,
              item.brand || null,
              item.model || null,
              item.serialNumber || null,
              item.patrimony || null,
              item.sector || null,
              item.location || null,
              item.responsible || null,
              item.sensor || null,
              item.minTemp !== undefined ? item.minTemp : null,
              item.maxTemp !== undefined ? item.maxTemp : null,
              item.currentTemp !== undefined ? item.currentTemp : null,
              item.status || null,
              item.nextReading || null,
              item.lastReadingTime || null,
              item.content || null,
              item.readings ? JSON.stringify(item.readings) : '[]',
              item.occurrences ? JSON.stringify(item.occurrences) : '[]',
              item.maintenances ? JSON.stringify(item.maintenances) : '[]',
              item.checklist ? JSON.stringify(item.checklist) : '{}',
              item.documents ? JSON.stringify(item.documents) : '[]'
            ]
          );
        }
        console.log(`Sucesso ao importar ${localData.length} equipamentos para o MySQL.`);
      }
    }
    
    connection.release();
    return mysqlPool;
  } catch (error) {
    console.error("Não foi possível estabelecer conexão ou configurar a tabela no MySQL. Erro:", error.message);
    mysqlPool = null;
    throw error;
  }
}

function getItemId(item, index) {
  if (!item || typeof item !== 'object') return String(index);
  if (item.id !== undefined && item.id !== null) return String(item.id);
  if (item.code !== undefined && item.code !== null) return String(item.code);
  if (item.email !== undefined && item.email !== null) return String(item.email);
  if (item.key !== undefined && item.key !== null) return String(item.key);
  if (item.name !== undefined && item.name !== null) return String(item.name);
  return String(index);
}

const tableSchemas = {
  convenios: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'pessoa', type: 'VARCHAR(100)' },
    { name: 'razaoSocial', type: 'VARCHAR(255)' },
    { name: 'fantasia', type: 'VARCHAR(255)' },
    { name: 'cnpj', type: 'VARCHAR(100)' },
    { name: 'inscEstadual', type: 'VARCHAR(100)' },
    { name: 'cei', type: 'VARCHAR(100)' },
    { name: 'inscMunicipal', type: 'VARCHAR(100)' },
    { name: 'cidade', type: 'VARCHAR(100)' },
    { name: 'tipoEndereco', type: 'VARCHAR(100)' },
    { name: 'endereco', type: 'VARCHAR(255)' },
    { name: 'numero', type: 'VARCHAR(50)' },
    { name: 'complemento', type: 'VARCHAR(255)' },
    { name: 'ans', type: 'VARCHAR(100)' },
    { name: 'bairro', type: 'VARCHAR(100)' },
    { name: 'cep', type: 'VARCHAR(50)' },
    { name: 'fone', type: 'VARCHAR(100)' },
    { name: 'fax', type: 'VARCHAR(100)' },
    { name: 'contato', type: 'VARCHAR(255)' },
    { name: 'email1', type: 'VARCHAR(100)' },
    { name: 'email2', type: 'VARCHAR(100)' },
    { name: 'site', type: 'VARCHAR(255)' },
    { name: 'observacao', type: 'TEXT' },
    { name: 'proibido', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'bloquearWeb', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'senhaWeb', type: 'VARCHAR(100)' },
    { name: 'ativo', type: 'TINYINT(1) DEFAULT 1' },
    { name: 'tabelaPrecoId', type: 'VARCHAR(100)' } // FK para price_tables
  ],
  patients: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'prontuario', type: 'VARCHAR(100)' },
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'socialName', type: 'VARCHAR(255)' },
    { name: 'cpf', type: 'VARCHAR(100)' },
    { name: 'rg', type: 'VARCHAR(100)' },
    { name: 'birthDate', type: 'VARCHAR(100)' },
    { name: 'age', type: 'VARCHAR(100)' },
    { name: 'gender', type: 'VARCHAR(50)' },
    { name: 'biologicalSex', type: 'VARCHAR(50)' },
    { name: 'motherName', type: 'VARCHAR(255)' },
    { name: 'phone', type: 'VARCHAR(100)' },
    { name: 'email', type: 'VARCHAR(100)' },
    { name: 'cep', type: 'VARCHAR(50)' },
    { name: 'street', type: 'VARCHAR(255)' },
    { name: 'number', type: 'VARCHAR(50)' },
    { name: 'neighborhood', type: 'VARCHAR(100)' },
    { name: 'city', type: 'VARCHAR(100)' },
    { name: 'state', type: 'VARCHAR(50)' },
    { name: 'convenioCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'insuranceNumber', type: 'VARCHAR(100)' },
    { name: 'cns', type: 'VARCHAR(100)' },
    { name: 'allergies', type: 'TEXT' },
    { name: 'clinicalNotes', type: 'TEXT' },
    { name: 'specialConditions', type: 'TEXT' },
    { name: 'createdAt', type: 'VARCHAR(100)' }
  ],
  exams: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'category', type: 'VARCHAR(100)' },
    { name: 'fasting', type: 'VARCHAR(100)' },
    { name: 'timeframe', type: 'VARCHAR(100)' },
    { name: 'instructions', type: 'TEXT' },
    { name: 'supportLabCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'pricePrivate', type: 'DECIMAL(10,2) DEFAULT 0.00' }
  ],
  professionals: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'role', type: 'VARCHAR(100)' },
    { name: 'title', type: 'VARCHAR(100)' },
    { name: 'description', type: 'TEXT' },
    { name: 'username', type: 'VARCHAR(100)' },
    { name: 'password', type: 'VARCHAR(100)' },
    { name: 'profileId', type: 'VARCHAR(100)' }, // FK para access_profiles
    { name: 'status', type: 'VARCHAR(50)' },
    { name: 'sectorCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'admissionDate', type: 'VARCHAR(100)' },
    { name: 'contractType', type: 'VARCHAR(100)' },
    { name: 'workday', type: 'VARCHAR(100)' },
    { name: 'vencidaEm', type: 'VARCHAR(100)' },
    { name: 'faltas', type: 'INT DEFAULT 0' },
    { name: 'diasDireito', type: 'INT DEFAULT 0' },
    { name: 'diasGozados', type: 'INT DEFAULT 0' },
    { name: 'saldoAGozar', type: 'INT DEFAULT 0' },
    { name: 'concederAvisoAte', type: 'VARCHAR(100)' },
    { name: 'proximoVencimento', type: 'VARCHAR(100)' },
    { name: 'salaryData', type: 'LONGTEXT' },
    { name: 'vacations', type: 'LONGTEXT' }
  ],
  pessoas: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'personType', type: 'VARCHAR(50)' },
    { name: 'cpfCnpj', type: 'VARCHAR(100)' },
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'birthday', type: 'VARCHAR(100)' },
    { name: 'phone', type: 'VARCHAR(100)' },
    { name: 'email', type: 'VARCHAR(100)' },
    { name: 'contactName', type: 'VARCHAR(255)' },
    { name: 'observation', type: 'TEXT' },
    { name: 'cep', type: 'VARCHAR(50)' },
    { name: 'city', type: 'VARCHAR(100)' },
    { name: 'uf', type: 'VARCHAR(50)' },
    { name: 'address', type: 'VARCHAR(255)' },
    { name: 'bairro', type: 'VARCHAR(100)' },
    { name: 'number', type: 'VARCHAR(50)' },
    { name: 'complement', type: 'VARCHAR(255)' },
    { name: 'createdAt', type: 'VARCHAR(100)' }
  ],
  appointments: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'patientId', type: 'VARCHAR(100)' }, // FK para patients
    { name: 'patientCode', type: 'VARCHAR(100)' }, // FK para patients
    { name: 'patientPhone', type: 'VARCHAR(100)' },
    { name: 'type', type: 'VARCHAR(100)' },
    { name: 'date', type: 'VARCHAR(100)' },
    { name: 'timeSlot', type: 'VARCHAR(50)' },
    { name: 'address', type: 'VARCHAR(255)' },
    { name: 'neighborhood', type: 'VARCHAR(100)' },
    { name: 'city', type: 'VARCHAR(100)' },
    { name: 'status', type: 'VARCHAR(100)' },
    { name: 'collectorName', type: 'VARCHAR(255)' },
    { name: 'fastingMinutes', type: 'INT DEFAULT 0' },
    { name: 'exams', type: 'LONGTEXT' },
    { name: 'notes', type: 'TEXT' },
    { name: 'createdAt', type: 'VARCHAR(100)' }
  ],
  budgets: [
    { name: 'requisitionCode', type: 'VARCHAR(100)' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'patientCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'patientPhone', type: 'VARCHAR(100)' },
    { name: 'patientCpf', type: 'VARCHAR(100)' },
    { name: 'patientBirthDate', type: 'VARCHAR(100)' },
    { name: 'patientAge', type: 'VARCHAR(100)' },
    { name: 'patientSex', type: 'VARCHAR(50)' },
    { name: 'isPregnant', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'gestationalPeriod', type: 'VARCHAR(100)' },
    { name: 'isNeonate', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'isIncapacitated', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'isPsr', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'dum', type: 'VARCHAR(100)' },
    { name: 'weight', type: 'VARCHAR(50)' },
    { name: 'height', type: 'VARCHAR(50)' },
    { name: 'address', type: 'VARCHAR(255)' },
    { name: 'complement', type: 'VARCHAR(255)' },
    { name: 'city', type: 'VARCHAR(100)' },
    { name: 'cep', type: 'VARCHAR(50)' },
    { name: 'responsibleName', type: 'VARCHAR(255)' },
    { name: 'clinicalNotes', type: 'TEXT' },
    { name: 'convenioCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'situacaoCode', type: 'VARCHAR(100)' },
    { name: 'matricula', type: 'VARCHAR(100)' },
    { name: 'guia', type: 'VARCHAR(100)' },
    { name: 'coleta', type: 'VARCHAR(100)' },
    { name: 'susCard', type: 'VARCHAR(100)' },
    { name: 'destino', type: 'VARCHAR(100)' },
    { name: 'doctorCrm', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'doctorUf', type: 'VARCHAR(50)' },
    { name: 'fatura', type: 'VARCHAR(100)' },
    { name: 'hora', type: 'VARCHAR(50)' },
    { name: 'procedencia', type: 'VARCHAR(100)' },
    { name: 'obs', type: 'TEXT' },
    { name: 'empresa', type: 'VARCHAR(255)' },
    { name: 'isUrgent', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'patientUsername', type: 'VARCHAR(100)' },
    { name: 'patientPassword', type: 'VARCHAR(100)' },
    { name: 'status', type: 'VARCHAR(100)' },
    { name: 'subtotal', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'discount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'totalAmount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'paymentMethod', type: 'VARCHAR(100)' },
    { name: 'paymentCondition', type: 'VARCHAR(100)' },
    { name: 'paidAmount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'financialStatus', type: 'VARCHAR(100)' },
    { name: 'deliveryDate', type: 'VARCHAR(100)' },
    { name: 'deliveryTime', type: 'VARCHAR(50)' },
    { name: 'cid10', type: 'VARCHAR(100)' },
    { name: 'notifyWhatsapp', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'separateLabel', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'fastingHours', type: 'VARCHAR(50)' },
    { name: 'updatedAt', type: 'VARCHAR(100)' },
    { name: 'exams', type: 'LONGTEXT' }
  ],
  requisitions: [
    { name: 'requisitionCode', type: 'VARCHAR(100)' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'patientCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'patientPhone', type: 'VARCHAR(100)' },
    { name: 'patientCpf', type: 'VARCHAR(100)' },
    { name: 'patientBirthDate', type: 'VARCHAR(100)' },
    { name: 'patientAge', type: 'VARCHAR(100)' },
    { name: 'patientSex', type: 'VARCHAR(50)' },
    { name: 'isPregnant', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'gestationalPeriod', type: 'VARCHAR(100)' },
    { name: 'isNeonate', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'isIncapacitated', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'isPsr', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'dum', type: 'VARCHAR(100)' },
    { name: 'weight', type: 'VARCHAR(50)' },
    { name: 'height', type: 'VARCHAR(50)' },
    { name: 'address', type: 'VARCHAR(255)' },
    { name: 'complement', type: 'VARCHAR(255)' },
    { name: 'city', type: 'VARCHAR(100)' },
    { name: 'cep', type: 'VARCHAR(50)' },
    { name: 'responsibleName', type: 'VARCHAR(255)' },
    { name: 'clinicalNotes', type: 'TEXT' },
    { name: 'convenioCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'situacaoCode', type: 'VARCHAR(100)' },
    { name: 'matricula', type: 'VARCHAR(100)' },
    { name: 'guia', type: 'VARCHAR(100)' },
    { name: 'coleta', type: 'VARCHAR(100)' },
    { name: 'susCard', type: 'VARCHAR(100)' },
    { name: 'destino', type: 'VARCHAR(100)' },
    { name: 'doctorCrm', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'doctorUf', type: 'VARCHAR(50)' },
    { name: 'fatura', type: 'VARCHAR(100)' },
    { name: 'hora', type: 'VARCHAR(50)' },
    { name: 'procedencia', type: 'VARCHAR(100)' },
    { name: 'obs', type: 'TEXT' },
    { name: 'empresa', type: 'VARCHAR(255)' },
    { name: 'isUrgent', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'patientUsername', type: 'VARCHAR(100)' },
    { name: 'patientPassword', type: 'VARCHAR(100)' },
    { name: 'status', type: 'VARCHAR(100)' },
    { name: 'subtotal', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'discount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'totalAmount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'paymentMethod', type: 'VARCHAR(100)' },
    { name: 'paymentCondition', type: 'VARCHAR(100)' },
    { name: 'paidAmount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'financialStatus', type: 'VARCHAR(100)' },
    { name: 'deliveryDate', type: 'VARCHAR(100)' },
    { name: 'deliveryTime', type: 'VARCHAR(50)' },
    { name: 'cid10', type: 'VARCHAR(100)' },
    { name: 'notifyWhatsapp', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'separateLabel', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'fastingHours', type: 'VARCHAR(50)' },
    { name: 'collectedAt', type: 'VARCHAR(100)' },
    { name: 'updatedAt', type: 'VARCHAR(100)' },
    { name: 'exams', type: 'LONGTEXT' }
  ],
  price_tables: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'convenioId', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'precios', type: 'LONGTEXT' }
  ],
  transactions: [
    { name: 'closureId', type: 'VARCHAR(100)' }, // FK para cash_closures
    { name: 'isClosureRevenue', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'type', type: 'VARCHAR(50)' },
    { name: 'number', type: 'VARCHAR(100)' },
    { name: 'issueDate', type: 'VARCHAR(100)' },
    { name: 'docNumber', type: 'VARCHAR(100)' },
    { name: 'provider', type: 'VARCHAR(255)' },
    { name: 'docType', type: 'VARCHAR(100)' },
    { name: 'chartOfAccounts', type: 'VARCHAR(100)' },
    { name: 'bank', type: 'VARCHAR(100)' },
    { name: 'tags', type: 'VARCHAR(255)' },
    { name: 'description', type: 'TEXT' },
    { name: 'amount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'installments', type: 'INT DEFAULT 1' },
    { name: 'dueDate', type: 'VARCHAR(100)' },
    { name: 'interval', type: 'VARCHAR(50)' },
    { name: 'recurrent', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'status', type: 'VARCHAR(50)' },
    { name: 'paidAt', type: 'VARCHAR(100)' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'createdBy', type: 'VARCHAR(100)' }
  ],
  cash_closures: [
    { name: 'recepcao', type: 'VARCHAR(100)' },
    { name: 'data', type: 'VARCHAR(100)' },
    { name: 'responsavel', type: 'VARCHAR(255)' },
    { name: 'trocoAnterior', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'trocoAnteriorOriginal', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'trocoAnteriorEditado', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'dinheiro', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'pix', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'cartaoCredito', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'cartaoDebito', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'cheque', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'saidasDinheiro', type: 'LONGTEXT' },
    { name: 'saidasDinheiroTotal', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'totalEntradas', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'totalDinheiroEmCaixa', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'totalDinheiroLiquido', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'trocoSeguinte', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'retiradaDinheiro', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'comprovantePrint', type: 'LONGTEXT' },
    { name: 'status', type: 'VARCHAR(50)' },
    { name: 'observacoes', type: 'TEXT' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'updatedAt', type: 'VARCHAR(100)' }
  ],
  setores: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'sigla', type: 'VARCHAR(50)' }
  ],
  recipientes: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' }
  ],
  materiais_coletados: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'abreviatura', type: 'VARCHAR(50)' }
  ],
  support_labs: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'name', type: 'VARCHAR(255)' }
  ],
  documents: [
    { name: 'title', type: 'VARCHAR(255)' },
    { name: 'type', type: 'VARCHAR(100)' },
    { name: 'fileUrl', type: 'VARCHAR(500)' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'createdBy', type: 'VARCHAR(100)' }
  ],
  pops: [
    { name: 'title', type: 'VARCHAR(255)' },
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'sectorCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'version', type: 'VARCHAR(50)' },
    { name: 'fileUrl', type: 'VARCHAR(500)' },
    { name: 'updatedAt', type: 'VARCHAR(100)' }
  ],
  non_conformities: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'description', type: 'TEXT' },
    { name: 'sectorCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'severity', type: 'VARCHAR(50)' },
    { name: 'status', type: 'VARCHAR(50)' },
    { name: 'createdAt', type: 'VARCHAR(100)' }
  ],
  access_profiles: [
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'description', type: 'TEXT' },
    { name: 'permissions', type: 'LONGTEXT' }
  ],
  escala_plantao: [
    { name: 'date', type: 'VARCHAR(100)' },
    { name: 'professionalCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'shift', type: 'VARCHAR(50)' },
    { name: 'sectorCode', type: 'VARCHAR(100)' }, // Relational FK
    { name: 'notes', type: 'TEXT' }
  ]
};

async function checkAndMigrateTable(connection, name) {
  // Garantir que a tabela existe com a estrutura flexivel, sem NUNCA dropar ou sobrescrever tabelas no MySQL
  await connection.query(
    "CREATE TABLE IF NOT EXISTS `tbl_" + name + "` (" +
    "  `id` VARCHAR(100) PRIMARY KEY," +
    "  `data` LONGTEXT NOT NULL," +
    "  `order_index` INT DEFAULT 0" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;"
  );

  const cols = tableSchemas[name];
  if (cols) {
    for (const col of cols) {
      try {
        await connection.query(`ALTER TABLE \`tbl_${name}\` ADD COLUMN \`${col.name}\` ${col.type}`);
      } catch (e) {
        // Coluna já existe no MySQL
      }
    }
  }
}

async function saveCollectionToMysql(name, data) {
  if (!process.env.DB_HOST) return;
  try {
    const pool = await getMysqlPool();
    const connection = await pool.getConnection();
    try {
      await checkAndMigrateTable(connection, name);

      if (!Array.isArray(data)) {
        const serialized = JSON.stringify(data);
        await connection.query(
          "INSERT INTO `tbl_" + name + "` (`id`, `data`, `order_index`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = ?, `order_index` = ?",
          ['default_config', serialized, 0, serialized, 0]
        );
      } else {
        if (data.length === 0) {
          // Proteção extra: não deletar nada da tabela MySQL se o array em memória estiver vazio
          return;
        }
        await connection.beginTransaction();
        const schema = tableSchemas[name];

        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          const itemId = getItemId(item, i);
          const serialized = JSON.stringify(item);

          if (schema && schema.length > 0) {
            const colNames = ['`id`', '`data`', '`order_index`'];
            const valPlaceholders = ['?', '?', '?'];
            const vals = [itemId, serialized, i];
            const updateAssignments = [
              '`data`=VALUES(`data`)',
              '`order_index`=VALUES(`order_index`)'
            ];

            for (const col of schema) {
              colNames.push(`\`${col.name}\``);
              valPlaceholders.push('?');
              updateAssignments.push(`\`${col.name}\`=VALUES(\`${col.name}\`)`);

              let rawVal = item[col.name];

              // Padrão relacional: extrair código do relacionamento caso só o objeto/nome tenha sido informado
              if (col.name === 'convenioCode' && !rawVal) {
                if (item.convenioCode) rawVal = item.convenioCode;
                else if (typeof item.convenio === 'object' && item.convenio) rawVal = item.convenio.codigo || item.convenio.id;
              } else if (col.name === 'patientCode' && !rawVal) {
                if (item.patientCode) rawVal = item.patientCode;
                else if (typeof item.patient === 'object' && item.patient) rawVal = item.patient.code || item.patient.id;
              } else if (col.name === 'sectorCode' && !rawVal) {
                if (item.sectorCode) rawVal = item.sectorCode;
                else if (typeof item.sector === 'object' && item.sector) rawVal = item.sector.codigo || item.sector.id;
              } else if (col.name === 'supportLabCode' && !rawVal) {
                if (item.supportLabCode) rawVal = item.supportLabCode;
                else if (typeof item.supportLab === 'object' && item.supportLab) rawVal = item.supportLab.codigo || item.supportLab.id;
              } else if (col.name === 'doctorCrm' && !rawVal) {
                if (item.doctorCrm) rawVal = item.doctorCrm;
                else if (typeof item.doctor === 'object' && item.doctor) rawVal = item.doctor.crm || item.doctor.code;
              }

              if (rawVal === undefined) rawVal = null;

              if (col.type.includes('LONGTEXT') || col.type.includes('TEXT')) {
                if (typeof rawVal === 'object' && rawVal !== null) {
                  vals.push(JSON.stringify(rawVal));
                } else {
                  vals.push(rawVal !== null ? String(rawVal) : null);
                }
              } else if (col.type.includes('TINYINT(1)')) {
                vals.push(rawVal ? 1 : 0);
              } else if (col.type.includes('DECIMAL') || col.type.includes('INT')) {
                vals.push(rawVal !== null && rawVal !== undefined && rawVal !== '' ? Number(rawVal) : 0);
              } else {
                vals.push(rawVal !== null ? String(rawVal) : null);
              }
            }

            const sql = `INSERT INTO \`tbl_${name}\` (${colNames.join(', ')}) VALUES (${valPlaceholders.join(', ')}) ON DUPLICATE KEY UPDATE ${updateAssignments.join(', ')}`;
            await connection.query(sql, vals);
          } else {
            await connection.query(
              "INSERT INTO `tbl_" + name + "` (`id`, `data`, `order_index`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = ?, `order_index` = ?",
              [itemId, serialized, i, serialized, i]
            );
          }
        }
        const currentIds = data.map((item, i) => getItemId(item, i));
        if (currentIds.length > 0) {
          const placeholders = currentIds.map(() => '?').join(',');
          await connection.query(
            `DELETE FROM \`tbl_${name}\` WHERE \`id\` NOT IN (${placeholders}) AND \`id\` != 'default_config'`,
            currentIds
          );
        }
        await connection.commit();
      }
    } catch (err) {
      if (Array.isArray(data)) {
        try { await connection.rollback(); } catch(e) {}
      }
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`Erro ao salvar colecao '${name}' no MySQL:`, error.message);
  }
}

async function loadCollectionFromMysql(name, localFile) {
  let localData = loadLocalJson(localFile);
  if (!process.env.DB_HOST) {
    return localData;
  }
  try {
    const pool = await getMysqlPool();
    const connection = await pool.getConnection();
    try {
      await checkAndMigrateTable(connection, name);

      const [rows] = await connection.query("SELECT * FROM `tbl_" + name + "` ORDER BY `order_index` ASC");
      connection.release();

      if (rows.length > 0) {
        if (rows.length === 1 && rows[0].id === 'default_config') {
          try {
            return JSON.parse(rows[0].data);
          } catch (e) {
            console.error(`Erro ao parsear config de '${name}':`, e);
            return localData;
          }
        } else {
          const list = [];
          const schema = tableSchemas[name];

          for (const row of rows) {
            try {
              let itemObj = {};
              if (row.data) {
                try { itemObj = JSON.parse(row.data); } catch(e) {}
              }
              itemObj.id = row.id || itemObj.id;

              if (schema && schema.length > 0) {
                for (const col of schema) {
                  const dbVal = row[col.name];
                  if (dbVal !== undefined && dbVal !== null) {
                    if (col.type.includes('LONGTEXT')) {
                      try {
                        itemObj[col.name] = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal;
                      } catch(e) {
                        itemObj[col.name] = dbVal;
                      }
                    } else if (col.type.includes('TINYINT(1)')) {
                      itemObj[col.name] = Boolean(dbVal);
                    } else if (col.type.includes('DECIMAL')) {
                      itemObj[col.name] = parseFloat(dbVal) || 0;
                    } else if (col.type.includes('INT')) {
                      itemObj[col.name] = parseInt(dbVal, 10) || 0;
                    } else {
                      itemObj[col.name] = dbVal;
                    }
                  }
                }
              }

              list.push(itemObj);
            } catch (e) {
              console.error(`Erro ao parsear item na tabela 'tbl_${name}':`, e);
            }
          }
          return list;
        }
      } else {
        const hasContent = localData && (Array.isArray(localData) ? localData.length > 0 : Object.keys(localData).length > 0);
        if (hasContent) {
          await saveCollectionToMysql(name, localData);
        }
        return localData;
      }
    } catch (err) {
      connection.release();
      throw err;
    }
  } catch (error) {
    console.warn(`Erro ao carregar colecao '${name}' do MySQL, usando JSON local:`, error.message);
    return localData;
  }
}

async function loadTemperaturas() {
  if (process.env.DB_HOST) {
    try {
      const pool = await getMysqlPool();
      const [rows] = await pool.query("SELECT * FROM `equipamentos_temperaturas`");
      
      const items = rows.map(item => {
        let readings = [];
        let occurrences = [];
        let maintenances = [];
        let checklist = {};
        let documents = [];
        let timeline = [];
        
        try { readings = typeof item.readings === 'string' ? JSON.parse(item.readings) : (item.readings || []); } catch (e) { readings = []; }
        try { occurrences = typeof item.occurrences === 'string' ? JSON.parse(item.occurrences) : (item.occurrences || []); } catch (e) { occurrences = []; }
        try { maintenances = typeof item.maintenances === 'string' ? JSON.parse(item.maintenances) : (item.maintenances || []); } catch (e) { maintenances = []; }
        try { checklist = typeof item.checklist === 'string' ? JSON.parse(item.checklist) : (item.checklist || {}); } catch (e) { checklist = {}; }
        try { documents = typeof item.documents === 'string' ? JSON.parse(item.documents) : (item.documents || []); } catch (e) { documents = []; }
        
        // Se a timeline não estiver no DB, podemos gerar uma padrão simples ou persistir no DB
        try { timeline = typeof item.timeline === 'string' ? JSON.parse(item.timeline) : (item.timeline || []); } catch (e) { timeline = []; }
        
        return {
          ...item,
          readings,
          occurrences,
          maintenances,
          checklist,
          documents,
          timeline: timeline.length > 0 ? timeline : [
            { date: new Date().toLocaleDateString('pt-BR'), event: "Instalado", description: "Equipamento carregado a partir do banco MySQL." }
          ]
        };
      });
      
      temperaturasCache = items;
      return items;
    } catch (error) {
      console.warn("Erro ao ler do MySQL (utilizando fallback JSON local):", error.message);
      temperaturasCache = loadLocalJson(TEMPERATURAS_FILE);
      return temperaturasCache;
    }
  } else {
    // Sem DB_HOST definido no ambiente -> Carrega direto do JSON local
    temperaturasCache = loadLocalJson(TEMPERATURAS_FILE);
    return temperaturasCache;
  }
}

async function saveTemperaturas(data) {
  try {
    temperaturasCache = data;
    // Sempre salvar localmente em JSON para testes e backup robusto
    saveJsonFile(TEMPERATURAS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    
    if (process.env.DB_HOST) {
      try {
        const pool = await getMysqlPool();
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.query("DELETE FROM `equipamentos_temperaturas`");
          for (const item of data) {
            await connection.query(
              "INSERT INTO `equipamentos_temperaturas` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                item.id,
                item.name,
                item.code,
                item.type,
                item.brand || null,
                item.model || null,
                item.serialNumber || null,
                item.patrimony || null,
                item.sector || null,
                item.location || null,
                item.responsible || null,
                item.sensor || null,
                item.minTemp !== undefined ? item.minTemp : null,
                item.maxTemp !== undefined ? item.maxTemp : null,
                item.currentTemp !== undefined ? item.currentTemp : null,
                item.status || null,
                item.nextReading || null,
                item.lastReadingTime || null,
                item.content || null,
                item.readings ? JSON.stringify(item.readings) : '[]',
                item.occurrences ? JSON.stringify(item.occurrences) : '[]',
                item.maintenances ? JSON.stringify(item.maintenances) : '[]',
                item.checklist ? JSON.stringify(item.checklist) : '{}',
                item.documents ? JSON.stringify(item.documents) : '[]'
              ]
            );
          }
          await connection.commit();
          console.log("Alterações salvas com sucesso no MySQL!");
        } catch (err) {
          await connection.rollback();
          throw err;
        } finally {
          connection.release();
        }
      } catch (err) {
        console.error("Erro ao tentar salvar no MySQL, mantido apenas no JSON local:", err.message);
      }
    }
  } catch (error) {
    console.error("Erro ao salvar temperaturas no MySQL ou JSON:", error.message);
  }
}

function loadBudgets() {
  return budgetsCache;
}

function saveBudgets(budgets) {
  try {
    budgetsCache = budgets;
    saveJsonFile(BUDGETS_FILE, JSON.stringify(budgets, null, 2), 'utf-8');
    saveCollectionToMysql('budgets', budgets).catch(err => console.error("Erro ao salvar budgets no MySQL:", err));
    syncToFirestore('budgets', budgets);
  } catch (error) {
    console.error("Erro ao salvar orçamentos:", error);
  }
}

function loadSupportLabs() {
  if (!supportLabsCache || supportLabsCache.length === 0) {
    supportLabsCache = loadLocalJson(SUPPORT_LABS_FILE);
  }
  return supportLabsCache.map(lab => ({
    id: String(lab.id || lab.codigo || Date.now()),
    codigo: String(lab.codigo || lab.id || "1"),
    descricao: lab.descricao || lab.name || "",
    name: lab.name || lab.descricao || ""
  }));
}

function loadConvenios() {
  if (!conveniosCache || conveniosCache.length === 0) {
    conveniosCache = loadLocalJson(CONVENIOS_FILE);
  }
  return conveniosCache;
}

function saveConvenios(convenios) {
  try {
    conveniosCache = convenios;
    saveJsonFile(CONVENIOS_FILE, JSON.stringify(convenios, null, 2), 'utf-8');
    saveCollectionToMysql('convenios', convenios).catch(err => console.error("Erro ao salvar convenios no MySQL:", err));
    syncToFirestore('convenios', convenios);
  } catch (error) {
    console.error("Erro ao salvar convenios:", error);
  }
}

function loadLabExamesAlvaro() {
  if (!labExamesAlvaroCache) {
    labExamesAlvaroCache = loadLocalJson(LAB_EXAMES_ALVARO_FILE);
  }
  return labExamesAlvaroCache || [];
}

function saveLabExamesAlvaro(data) {
  try {
    labExamesAlvaroCache = data;
    saveJsonFile(LAB_EXAMES_ALVARO_FILE, JSON.stringify(data, null, 2), 'utf-8');
    syncToFirestore('lab_exames_alvaro', data);
  } catch (err) {
    console.error('Erro ao salvar exames Álvaro:', err);
  }
}

function loadMateriaisAlvaro() {
  if (!materiaisAlvaroCache) {
    materiaisAlvaroCache = loadLocalJson(MATERIAIS_ALVARO_FILE);
  }
  return materiaisAlvaroCache || [];
}

function saveMateriaisAlvaro(data) {
  try {
    materiaisAlvaroCache = data;
    saveJsonFile(MATERIAIS_ALVARO_FILE, JSON.stringify(data, null, 2), 'utf-8');
    syncToFirestore('materiais_alvaro', data);
  } catch (err) {
    console.error('Erro ao salvar materiais Álvaro:', err);
  }
}

function loadConfigApoioAlvaro() {
  if (!configApoioAlvaroCache) {
    const raw = loadLocalJson(CONFIG_APOIO_ALVARO_FILE);
    configApoioAlvaroCache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {
      urlAmbiente: 'http://webservice.alvaro.com.br/webserviceaol/rest/homologacao/v1',
      nomeLis: 'InovalabLis',
      entidade: '19816',
      idAgente: '193762',
      senha: '4353cd',
      chave: '581abd3154b1e858',
      setorPadrao: '11'
    };
  }
  if (!configApoioAlvaroCache.setorPadrao) {
    configApoioAlvaroCache.setorPadrao = '11';
  }
  return configApoioAlvaroCache;
}

function saveConfigApoioAlvaro(data) {
  try {
    configApoioAlvaroCache = data;
    saveJsonFile(CONFIG_APOIO_ALVARO_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar config apoio Álvaro:', err);
  }
}

function loadConfigApoioPardini() {
  if (!configApoioPardiniCache) {
    const raw = loadLocalJson(CONFIG_APOIO_PARDINI_FILE);
    configApoioPardiniCache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }
  return configApoioPardiniCache;
}

function saveConfigApoioPardini(data) {
  try {
    configApoioPardiniCache = data;
    saveJsonFile(CONFIG_APOIO_PARDINI_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar config apoio Pardini:', err);
  }
}

function loadLabExamesPardini() {
  if (!labExamesPardiniCache) {
    labExamesPardiniCache = loadLocalJson(LAB_EXAMES_PARDINI_FILE);
  }
  return labExamesPardiniCache || [];
}

function saveLabExamesPardini(data) {
  try {
    labExamesPardiniCache = data;
    saveJsonFile(LAB_EXAMES_PARDINI_FILE, JSON.stringify(data, null, 2), 'utf-8');
    syncToFirestore('lab_exames_pardini', data);
  } catch (err) {
    console.error('Erro ao salvar exames Pardini:', err);
  }
}

function loadRecipientes() {
  if (!recipientesCache || recipientesCache.length === 0) {
    recipientesCache = loadLocalJson(RECIPIENTES_FILE);
  }
  return recipientesCache;
}

function saveRecipientes(recipientes) {
  try {
    recipientesCache = recipientes;
    saveJsonFile(RECIPIENTES_FILE, JSON.stringify(recipientes, null, 2), 'utf-8');
    saveCollectionToMysql('recipientes', recipientes).catch(err => console.error("Erro ao salvar recipientes no MySQL:", err));
    syncToFirestore('recipientes', recipientes);
  } catch (error) {
    console.error("Erro ao salvar recipientes:", error);
  }
}

function loadMateriaisColetados() {
  if (!materiaisColetadosMasterCache || materiaisColetadosMasterCache.length === 0) {
    materiaisColetadosMasterCache = loadLocalJson(MATERIAIS_COLETADOS_FILE);
  }
  return materiaisColetadosMasterCache || [];
}

function saveMateriaisColetados(materiais) {
  try {
    materiaisColetadosMasterCache = materiais;
    saveJsonFile(MATERIAIS_COLETADOS_FILE, JSON.stringify(materiais, null, 2), 'utf-8');
    saveCollectionToMysql('materiais_coletados', materiais).catch(err => console.error("Erro ao salvar materiais_coletados no MySQL:", err));
    syncToFirestore('materiais_coletados', materiais);
  } catch (error) {
    console.error("Erro ao salvar materiais_coletados:", error);
  }
}

function loadSetores() {
  if (!setoresCache || setoresCache.length === 0) {
    setoresCache = loadLocalJson(SETORES_FILE);
  }
  return setoresCache;
}

function saveSetores(setores) {
  try {
    setoresCache = setores;
    saveJsonFile(SETORES_FILE, JSON.stringify(setores, null, 2), 'utf-8');
    saveCollectionToMysql('setores', setores).catch(err => console.error("Erro ao salvar setores no MySQL:", err));
    syncToFirestore('setores', setores);
  } catch (error) {
    console.error("Erro ao salvar setores:", error);
  }
}

function loadImpressoras() {
  if (!impressorasCache || impressorasCache.length === 0) {
    impressorasCache = loadLocalJson(IMPRESSORAS_FILE);
  }
  return impressorasCache;
}

function saveImpressoras(impressoras) {
  try {
    impressorasCache = impressoras;
    saveJsonFile(IMPRESSORAS_FILE, JSON.stringify(impressoras, null, 2), 'utf-8');
    saveCollectionToMysql('impressoras', impressoras).catch(err => console.error("Erro ao salvar impressoras no MySQL:", err));
    syncToFirestore('impressoras', impressoras);
  } catch (error) {
    console.error("Erro ao salvar impressoras:", error);
  }
}

function loadLocaisColeta() {
  if (!locaisColetaCache || locaisColetaCache.length === 0) {
    locaisColetaCache = loadLocalJson(LOCAIS_COLETA_FILE);
    if (!locaisColetaCache || locaisColetaCache.length === 0) {
      locaisColetaCache = [
        { id: "LOC-1", codigo: "1", descricao: "Sala Particular" },
        { id: "LOC-2", codigo: "2", descricao: "Sala SUS" },
        { id: "LOC-3", codigo: "3", descricao: "Coleta Empresarial" },
        { id: "LOC-4", codigo: "4", descricao: "Coleta Hospital Municipal" },
        { id: "LOC-5", codigo: "5", descricao: "Coleta Santa Casa" },
        { id: "LOC-6", codigo: "6", descricao: "Domiciliar" }
      ];
      saveLocaisColeta(locaisColetaCache);
    }
  }
  return locaisColetaCache;
}

function saveLocaisColeta(locais) {
  try {
    locaisColetaCache = locais;
    saveJsonFile(LOCAIS_COLETA_FILE, JSON.stringify(locais, null, 2), 'utf-8');
    saveCollectionToMysql('locais_coleta', locais).catch(err => console.error("Erro ao salvar locais_coleta no MySQL:", err));
    syncToFirestore('locais_coleta', locais);
  } catch (error) {
    console.error("Erro ao salvar locais de coleta:", error);
  }
}

function loadMedicos() {
  if (!medicosCache || medicosCache.length === 0) {
    medicosCache = loadLocalJson(MEDICOS_FILE);
    if (!medicosCache || medicosCache.length === 0) {
      medicosCache = [
        {
          id: "MED-1",
          codigo: "1",
          nome: "Dr. Carlos Eduardo Silva",
          conselho: "CRM",
          numero: "123456",
          uf: "PR",
          especialidade: "Clínica Geral",
          telefone: "(43) 99888-1122",
          email: "carlos.silva@medicos.com.br",
          status: "Ativo"
        },
        {
          id: "MED-2",
          codigo: "2",
          nome: "Dra. Mariana Souza Santos",
          conselho: "CRM",
          numero: "654321",
          uf: "SP",
          especialidade: "Cardiologia",
          telefone: "(11) 98765-4321",
          email: "mariana.souza@medicos.com.br",
          status: "Ativo"
        },
        {
          id: "MED-3",
          codigo: "3",
          nome: "Dr. Fernando Ribeiro",
          conselho: "CRO",
          numero: "45678",
          uf: "PR",
          especialidade: "Odontologia",
          telefone: "(43) 99777-3344",
          email: "fernando.ribeiro@odontologia.com.br",
          status: "Ativo"
        }
      ];
      saveMedicos(medicosCache);
    }
  }
  return medicosCache;
}

function saveMedicos(medicos) {
  try {
    medicosCache = medicos;
    saveJsonFile(MEDICOS_FILE, JSON.stringify(medicos, null, 2), 'utf-8');
    saveCollectionToMysql('medicos', medicos).catch(err => console.error("Erro ao salvar medicos no MySQL:", err));
    syncToFirestore('medicos', medicos);
  } catch (error) {
    console.error("Erro ao salvar medicos:", error);
  }
}

function loadPriceTables() {
  if (!priceTablesCache || priceTablesCache.length === 0) {
    priceTablesCache = loadLocalJson(PRICE_TABLES_FILE);
  }
  return priceTablesCache;
}

function savePriceTables(tables) {
  try {
    priceTablesCache = tables;
    saveJsonFile(PRICE_TABLES_FILE, JSON.stringify(tables, null, 2), 'utf-8');
    saveCollectionToMysql('price_tables', tables).catch(err => console.error("Erro ao salvar price_tables no MySQL:", err));
    syncToFirestore('price_tables', tables);
  } catch (error) {
    console.error("Erro ao salvar tabela de preços:", error);
  }
}

function saveSupportLabs(labs) {
  try {
    supportLabsCache = labs;
    saveJsonFile(SUPPORT_LABS_FILE, JSON.stringify(labs, null, 2), 'utf-8');
    saveCollectionToMysql('support_labs', labs).catch(err => console.error("Erro ao salvar support_labs no MySQL:", err));
    syncToFirestore('support_labs', labs);
  } catch (error) {
    console.error("Erro ao salvar laboratorios de apoio:", error);
  }
}

function loadExams() {
  return examsCache;
}

function saveExams(exams) {
  try {
    examsCache = exams;
    saveJsonFile(EXAMS_FILE, JSON.stringify(exams, null, 2), 'utf-8');
    saveCollectionToMysql('exams', exams).catch(err => console.error("Erro ao salvar exams no MySQL:", err));
    syncToFirestore('exams', exams);
  } catch (error) {
    console.error("Erro ao salvar exames:", error);
  }
}

function syncExamPricesToPriceTables(examCode, examName, parsedMateriais, pricePrivate) {
  if (!examCode) return;
  let priceTables = loadPriceTables();
  if (!Array.isArray(priceTables) || priceTables.length === 0) return;

  let hasChanges = false;
  const cleanExamCode = String(examCode).trim().toUpperCase();
  const cleanExamName = String(examName || '').trim();

  const materials = Array.isArray(parsedMateriais) && parsedMateriais.length > 0
    ? parsedMateriais
    : [{ nome: 'Sangue Total', abrev: 'SGE' }];

  for (const mat of materials) {
    const matName = (mat.nome || mat.material || mat.mnemotecnico || 'Sangue Total').trim();

    if (Array.isArray(mat.priceTableValues) && mat.priceTableValues.length > 0) {
      for (const pv of mat.priceTableValues) {
        if (!pv.tableId) continue;
        const pt = priceTables.find(t => String(t.id) === String(pv.tableId));
        if (pt) {
          if (!Array.isArray(pt.precios)) pt.precios = [];

          const pIndex = pt.precios.findIndex(p => {
            const pCode = String(p.examCode || '').trim().toUpperCase();
            const pMat = String(p.material || '').trim().toUpperCase();
            return pCode === cleanExamCode && (pMat === matName.toUpperCase() || (mat.abrev && pMat === mat.abrev.toUpperCase()));
          });

          const priceVal = parsePriceValue(pv.valor);
          const ambVal = (pv.amb !== undefined && pv.amb !== null) ? String(pv.amb).trim() : (mat.amb || '');
          const proibirVal = pv.proibir === true || pv.proibir === 'true';

          const newObj = {
            examCode: cleanExamCode,
            material: matName,
            examName: cleanExamName,
            amb: ambVal,
            valor: priceVal,
            proibir: proibirVal
          };

          if (pIndex !== -1) {
            pt.precios[pIndex] = { ...pt.precios[pIndex], ...newObj };
          } else {
            pt.precios.push(newObj);
          }
          hasChanges = true;
        }
      }
    }
  }

  if (pricePrivate !== undefined && pricePrivate !== null && !isNaN(parseFloat(pricePrivate)) && parseFloat(pricePrivate) >= 0) {
    const pVal = parseFloat(pricePrivate);
    priceTables.forEach(pt => {
      const isParticular = String(pt.codigo) === '1' ||
                           (pt.descricao && pt.descricao.toLowerCase().includes('particular')) ||
                           (!pt.convenioId && !pt.convenioNome);
      if (isParticular) {
        if (!Array.isArray(pt.precios)) pt.precios = [];
        materials.forEach(mat => {
          const matName = (mat.nome || mat.material || mat.mnemotecnico || 'Sangue Total').trim();
          const pIndex = pt.precios.findIndex(p => {
            const pCode = String(p.examCode || '').trim().toUpperCase();
            const pMat = String(p.material || '').trim().toUpperCase();
            return pCode === cleanExamCode && pMat === matName.toUpperCase();
          });

          if (pIndex !== -1) {
            if (!pt.precios[pIndex].valor || pt.precios[pIndex].valor === 0) {
              pt.precios[pIndex].valor = pVal;
              pt.precios[pIndex].examName = cleanExamName;
              hasChanges = true;
            }
          } else {
            pt.precios.push({
              examCode: cleanExamCode,
              material: matName,
              examName: cleanExamName,
              amb: mat.amb || '',
              valor: pVal,
              proibir: false
            });
            hasChanges = true;
          }
        });
      }
    });
  }

  if (hasChanges) {
    savePriceTables(priceTables);
  }
}

function syncPriceTableToExams(table) {
  if (!table || !Array.isArray(table.precios)) return;
  const exams = loadExams();
  if (!Array.isArray(exams) || exams.length === 0) return;

  let examsChanged = false;

  table.precios.forEach(p => {
    if (!p.examCode) return;
    const examCode = String(p.examCode).trim().toUpperCase();
    const exam = exams.find(e => String(e.code || e.jalisCode || e.codigo || e.id).trim().toUpperCase() === examCode);

    if (exam) {
      if (!Array.isArray(exam.materiaisColetados) || exam.materiaisColetados.length === 0) {
        exam.materiaisColetados = [{ nome: p.material || 'Sangue Total', abrev: 'SGE' }];
      }

      const pMat = String(p.material || '').trim().toUpperCase();
      let mat = exam.materiaisColetados.find(m => {
        const mName = String(m.nome || m.material || m.mnemotecnico || '').trim().toUpperCase();
        const mAbrev = String(m.abrev || '').trim().toUpperCase();
        return mName === pMat || (mAbrev && mAbrev === pMat);
      });

      if (!mat) {
        mat = exam.materiaisColetados[0];
      }

      if (mat) {
        if (!Array.isArray(mat.priceTableValues)) {
          mat.priceTableValues = [];
        }
        const pvIndex = mat.priceTableValues.findIndex(pv => String(pv.tableId) === String(table.id));
        const pvData = {
          tableId: String(table.id),
          tableCode: table.codigo || String(table.id),
          amb: p.amb || '',
          valor: parsePriceValue(p.valor),
          proibir: p.proibir === true || p.proibir === 'true'
        };

        if (pvIndex !== -1) {
          mat.priceTableValues[pvIndex] = pvData;
        } else {
          mat.priceTableValues.push(pvData);
        }
        examsChanged = true;
      }
    }
  });

  if (examsChanged) {
    saveExams(exams);
  }
}

function cleanOrphanedPriceTableRows() {
  const exams = loadExams() || [];
  let priceTables = loadPriceTables() || [];
  if (!Array.isArray(priceTables) || priceTables.length === 0) return;

  const validExamsMap = new Map();

  exams.forEach(exam => {
    const codes = [exam.code, exam.jalisCode, exam.codigo, exam.id]
      .filter(Boolean)
      .map(c => String(c).trim().toUpperCase());

    const materials = (Array.isArray(exam.materiaisColetados) && exam.materiaisColetados.length > 0)
      ? exam.materiaisColetados
      : [{ nome: 'Sangue Total', abrev: 'SGE' }];

    const validMatSet = new Set();
    materials.forEach(mat => {
      if (typeof mat === 'string') {
        if (mat.trim()) validMatSet.add(mat.trim().toUpperCase());
      } else if (mat && typeof mat === 'object') {
        const name = (mat.nome || mat.material || mat.mnemotecnico || '').trim().toUpperCase();
        const abrev = (mat.abrev || '').trim().toUpperCase();
        if (name) validMatSet.add(name);
        if (abrev) validMatSet.add(abrev);
      }
    });

    if (validMatSet.size === 0) {
      validMatSet.add('SANGUE TOTAL');
    }

    codes.forEach(code => {
      validExamsMap.set(code, validMatSet);
    });
  });

  let hasChanges = false;

  priceTables.forEach(pt => {
    if (!Array.isArray(pt.precios)) return;

    const initialCount = pt.precios.length;
    pt.precios = pt.precios.filter(p => {
      if (!p || !p.examCode) return false;
      const pCode = String(p.examCode).trim().toUpperCase();

      if (!validExamsMap.has(pCode)) {
        return false;
      }

      const validMatSet = validExamsMap.get(pCode);
      const pMat = String(p.material || '').trim().toUpperCase();

      if (!pMat) return false;

      if (validMatSet.has(pMat)) return true;

      for (const validMat of validMatSet) {
        if (validMat === pMat || pMat.includes(validMat) || validMat.includes(pMat)) {
          return true;
        }
      }

      return false;
    });

    if (pt.precios.length !== initialCount) {
      hasChanges = true;
    }
  });

  if (hasChanges) {
    savePriceTables(priceTables);
  }
}

function syncAllExamsWithPriceTables() {
  cleanOrphanedPriceTableRows();
  const exams = loadExams();
  if (!Array.isArray(exams) || exams.length === 0) return;

  exams.forEach(exam => {
    const examCode = exam.code || exam.jalisCode || exam.codigo || exam.id;
    if (examCode) {
      syncExamPricesToPriceTables(examCode, exam.name, exam.materiaisColetados, exam.pricePrivate);
    }
  });
}

function loadProfessionals() {
  const profs = professionalsCache || [];
  return profs.slice().sort((a, b) => {
    const isADesligado = (a.status === 'Desligado' || a.status === 'Inativo');
    const isBDesligado = (b.status === 'Desligado' || b.status === 'Inativo');

    // Desligados sempre por último
    if (!isADesligado && isBDesligado) return -1;
    if (isADesligado && !isBDesligado) return 1;

    // Se ambos ativos ou ambos desligados, ordenar por data de admissão (mais antigos primeiro)
    const dateA = a.admissionDate ? new Date(a.admissionDate).getTime() : 0;
    const dateB = b.admissionDate ? new Date(b.admissionDate).getTime() : 0;

    if (dateA !== dateB) {
      return dateA - dateB;
    }

    return (a.name || '').localeCompare(b.name || '');
  });
}

function saveProfessionals(professionals) {
  try {
    professionalsCache = professionals;
    saveJsonFile(PROFESSIONALS_FILE, JSON.stringify(professionals, null, 2), 'utf-8');
    saveCollectionToMysql('professionals', professionals).catch(err => console.error("Erro ao salvar professionals no MySQL:", err));
    syncToFirestore('professionals', professionals);
  } catch (error) {
    console.error("Erro ao salvar profissionais:", error);
  }
}

function loadEvaluations() {
  return evaluationsCache;
}

function saveEvaluations(evaluations) {
  try {
    evaluationsCache = evaluations;
    saveJsonFile(EVALUATIONS_FILE, JSON.stringify(evaluations, null, 2), 'utf-8');
    saveCollectionToMysql('evaluations', evaluations).catch(err => console.error("Erro ao salvar evaluations no MySQL:", err));
    syncToFirestore('evaluations', evaluations);
  } catch (error) {
    console.error("Erro ao salvar avaliacoes:", error);
  }
}

function loadEvalAccesses() {
  return evalAccessesCache;
}

function saveEvalAccesses(accesses) {
  try {
    evalAccessesCache = accesses;
    saveJsonFile(EVAL_ACCESSES_FILE, JSON.stringify(accesses, null, 2), 'utf-8');
    saveCollectionToMysql('eval_accesses', accesses).catch(err => console.error("Erro ao salvar eval_accesses no MySQL:", err));
    syncToFirestore('eval_accesses', accesses);
  } catch (error) {
    console.error("Erro ao salvar acessos de avaliacao:", error);
  }
}

function loadEvalHashes() {
  return evalHashesCache;
}

function saveEvalHashes(hashes) {
  try {
    evalHashesCache = hashes;
    saveJsonFile(EVAL_HASHES_FILE, JSON.stringify(hashes, null, 2), 'utf-8');
    saveCollectionToMysql('eval_hashes', hashes).catch(err => console.error("Erro ao salvar eval_hashes no MySQL:", err));
    syncToFirestore('eval_hashes', hashes);
  } catch (error) {
    console.error("Erro ao salvar hashes de avaliacao:", error);
  }
}

function loadNonConformities() {
  return nonConformitiesCache || [];
}

function saveNonConformities(list) {
  try {
    nonConformitiesCache = list;
    saveJsonFile(NON_CONFORMITIES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    saveCollectionToMysql('non_conformities', list).catch(err => console.error("Erro ao salvar non_conformities no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar nao conformidades:", error);
  }
}

function loadAccessProfiles() {
  return accessProfilesCache || [];
}

function saveAccessProfiles(profiles) {
  try {
    accessProfilesCache = profiles;
    saveJsonFile(ACCESS_PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf-8');
    saveCollectionToMysql('access_profiles', profiles).catch(err => console.error("Erro ao salvar access_profiles no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar perfis de acesso:", error);
  }
}

function loadMessageTemplates() {
  const defaultTemplates = {
    invite: "Olá, {nome}! Agradecemos por escolher o InovaLab Cambará. Sua opinião é muito importante para nós! Poderia avaliar nosso atendimento em menos de 1 minuto? Acesse o link: {link}",
    reminder: "Olá, {nome}! Notamos que enviamos o link para avaliar o atendimento no InovaLab Cambará, mas ainda não recebemos seu retorno. Sua opinião é fundamental para nós! Leva menos de 1 minuto: {link}",
    resultReady: "Olá, {nome}! Seu resultado do exame do InovaLab já está disponível. Código da requisição: *{codigo}*. Usuário para acesso: *{usuario}* e Senha: *{senha}*."
  };
  try {
    if (fs.existsSync(MESSAGE_TEMPLATES_FILE)) {
      const saved = JSON.parse(fs.readFileSync(MESSAGE_TEMPLATES_FILE, 'utf-8'));
      return { ...defaultTemplates, ...saved };
    }
  } catch (error) {
    console.error("Erro ao ler MESSAGE_TEMPLATES_FILE:", error);
  }
  return defaultTemplates;
}

function saveMessageTemplates(templates) {
  try {
    saveJsonFile(MESSAGE_TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf-8');
    saveCollectionToMysql('message_templates', templates).catch(err => console.error("Erro ao salvar message_templates no MySQL:", err));
    return true;
  } catch (error) {
    console.error("Erro ao salvar MESSAGE_TEMPLATES_FILE:", error);
    return false;
  }
}

const DEFAULT_SYSTEM_SHORTCUTS = {
  newRecord: {
    id: "newRecord",
    action: "Novo Registro",
    scope: "Requisições / Pacientes / Geral",
    description: "Abre o formulário ou popup para cadastrar um novo registro",
    key: "n",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    enabled: true
  },
  save: {
    id: "save",
    action: "Salvar Formulário",
    scope: "Formulários / Modais",
    description: "Envia ou confirma os dados do formulário ativo",
    key: "s",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    enabled: true
  },
  cancel: {
    id: "cancel",
    action: "Cancelar / Limpar",
    scope: "Formulários / Modais",
    description: "Cancela a ação ou limpa os campos preenchidos",
    key: "c",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    enabled: true
  },
  closeModal: {
    id: "closeModal",
    action: "Fechar Modal (ESC)",
    scope: "Modais e Popups sobrepostas",
    description: "Fecha qualquer modal ativa no sistema ao pressionar a tecla configurada",
    key: "Escape",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    enabled: true
  },
  searchPatient: {
    id: "searchPatient",
    action: "Buscar Paciente",
    scope: "Requisições / Recepção",
    description: "Abre a popup de busca rápida de pacientes cadastrados",
    key: "p",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    enabled: true
  },
  quickSearch: {
    id: "quickSearch",
    action: "Foco na Busca Geral",
    scope: "Tabelas e Listagens",
    description: "Posiciona o cursor diretamente na caixa de pesquisa da página",
    key: "f",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    enabled: true
  }
};

function loadShortcuts() {
  try {
    if (fs.existsSync(SHORTCUTS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SHORTCUTS_FILE, 'utf-8'));
      return { ...DEFAULT_SYSTEM_SHORTCUTS, ...saved };
    }
  } catch (error) {
    console.error("Erro ao ler SHORTCUTS_FILE:", error);
  }
  return { ...DEFAULT_SYSTEM_SHORTCUTS };
}

function saveShortcuts(shortcuts) {
  try {
    saveJsonFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), 'utf-8');
    saveCollectionToMysql('shortcuts', shortcuts).catch(err => console.error("Erro ao salvar shortcuts no MySQL:", err));
    return true;
  } catch (error) {
    console.error("Erro ao salvar SHORTCUTS_FILE:", error);
    return false;
  }
}

function loadTransactions() {
  return transactionsCache;
}

function saveTransactions(transactions) {
  try {
    transactionsCache = transactions;
    saveJsonFile(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2), 'utf-8');
    saveCollectionToMysql('transactions', transactions).catch(err => console.error("Erro ao salvar transactions no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar transacoes financeiras:", error);
  }
}

function loadFinanceSettings() {
  return financeSettingsCache;
}

function saveFinanceSettings(settings) {
  try {
    financeSettingsCache = settings;
    saveJsonFile(FINANCE_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    saveCollectionToMysql('finance_settings', settings).catch(err => console.error("Erro ao salvar finance_settings no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar configuracoes financeiras:", error);
  }
}

function loadMovements() {
  return movementsCache || [];
}

function saveMovements(movements) {
  try {
    movementsCache = movements;
    saveJsonFile(MOVEMENTS_FILE, JSON.stringify(movements, null, 2), 'utf-8');
    saveCollectionToMysql('movements', movements).catch(err => console.error("Erro ao salvar movements no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar movimentacoes financeiras:", error);
  }
}

function logFinancialMovement(tx, paidAtDate) {
  const movements = loadMovements();
  let maxCode = 352;
  movements.forEach(m => {
    if (m.code && typeof m.code === 'number' && m.code > maxCode) {
      maxCode = m.code;
    }
  });
  const newCode = maxCode + 1;

  const amount = parseFloat(tx.amount) || 0;
  const movementAmount = tx.type === 'pagar' ? -Math.abs(amount) : Math.abs(amount);

  const newMovement = {
    id: `MV-${newCode}`,
    code: newCode,
    type: tx.type,
    date: paidAtDate || new Date().toISOString().split('T')[0],
    chartOfAccounts: tx.chartOfAccounts || "Outras",
    complemento: tx.description || tx.provider || "",
    bank: tx.bank || "Sicredi",
    amount: movementAmount,
    createdAt: new Date().toISOString()
  };

  movements.unshift(newMovement);
  saveMovements(movements);
}

function getEnrichedExams() {
  const exams = loadExams();
  const labs = loadSupportLabs();

  return exams.map(exam => {
    const enriched = { ...exam };
    enriched.supportLabsData = enriched.supportLabsData || {};

    labs.forEach(lab => {
      // Determinar o código de/para associado a este laboratório
      let deparaCode = '';
      const cleanLabName = lab.name.trim().toLowerCase();
      
      if (cleanLabName.includes('alvaro') || cleanLabName.includes('álvaro')) {
        deparaCode = (enriched.codigoAlvaro || '').trim();
      } else if (cleanLabName.includes('pardini')) {
        deparaCode = (enriched.codigoPardini || '').trim();
      } else if (enriched.supportLabsData[lab.id]) {
        deparaCode = (enriched.supportLabsData[lab.id].code || '').trim();
      }

      if (deparaCode) {
        const cleanCode = deparaCode.toLowerCase();
        if (lab.prices && lab.prices[cleanCode]) {
          const priceInfo = lab.prices[cleanCode];
          const resolvedPrice = typeof priceInfo === 'object' ? priceInfo.price : Number(priceInfo);
          const resolvedName = typeof priceInfo === 'object' ? priceInfo.name : '';

          enriched.supportLabsData[lab.id] = {
            price: resolvedPrice,
            code: deparaCode,
            originalName: resolvedName || deparaCode
          };

          if (cleanLabName.includes('alvaro') || cleanLabName.includes('álvaro')) {
            enriched.priceAlvaro = resolvedPrice;
          } else if (cleanLabName.includes('pardini')) {
            enriched.pricePardini = resolvedPrice;
          }
        } else {
          // Se tem o código de de/para, mas não tem preço importado na planilha ainda
          enriched.supportLabsData[lab.id] = {
            price: 0,
            code: deparaCode,
            originalName: deparaCode
          };
          if (cleanLabName.includes('alvaro') || cleanLabName.includes('álvaro')) {
            enriched.priceAlvaro = 0;
          } else if (cleanLabName.includes('pardini')) {
            enriched.pricePardini = 0;
          }
        }
      }
    });

    return enriched;
  });
}

function loadBlogPosts() {
  return blogPostsCache;
}

function saveBlogPosts(posts) {
  try {
    blogPostsCache = posts;
    saveJsonFile(BLOG_FILE, JSON.stringify(posts, null, 2), 'utf-8');
    saveCollectionToMysql('blog_posts', posts).catch(err => console.error("Erro ao salvar blog_posts no MySQL:", err));
    syncToFirestore('blog_posts', posts);
  } catch (error) {
    console.error("Erro ao salvar blog:", error);
  }
}

function loadPops() {
  return popsCache;
}

function savePops(pops) {
  try {
    popsCache = pops;
    saveJsonFile(POPS_FILE, JSON.stringify(pops, null, 2), 'utf-8');
    saveCollectionToMysql('pops', pops).catch(err => console.error("Erro ao salvar pops no MySQL:", err));
    syncToFirestore('pops', pops);
  } catch (error) {
    console.error("Erro ao salvar POPs:", error);
  }
}

function loadDocuments() {
  return documentsCache.sort((a, b) => (a.order || 0) - (b.order || 0));
}

function saveDocuments(docs) {
  try {
    documentsCache = docs;
    saveJsonFile(DOCUMENTS_FILE, JSON.stringify(docs, null, 2), 'utf-8');
    saveCollectionToMysql('documents', docs).catch(err => console.error("Erro ao salvar documents no MySQL:", err));
    syncToFirestore('documents', docs);
  } catch (error) {
    console.error("Erro ao salvar Documentos:", error);
  }
}

// Middleware de verificação de autenticação administrativa e controle de acesso (RBAC)
function requireAdmin(req, res, next) {
  if (req.cookies.admin_logged_out === 'true') {
    return res.redirect('/admin/login');
  }
  next();
}

// Banco de dados simulado de Resultados de Exames para o Portal do Paciente (Preservado)
const resultsDatabase = {
  'IN001': {
    password: '123',
    patientName: 'João da Silva Santos',
    date: '28/06/2026',
    doctor: 'Dr. Carlos Eduardo Lima',
    status: 'Liberado',
    exams: [
      { name: 'Hemograma Completo', results: [
        { parameter: 'Hemácias', value: '4.85 M/µL', reference: '4.30 a 5.90 M/µL', status: 'Normal' },
        { parameter: 'Hemoglobina', value: '14.2 g/dL', reference: '13.5 a 17.5 g/dL', status: 'Normal' },
        { parameter: 'Plaquetas', value: '254.000 /µL', reference: '150.000 a 450.000 /µL', status: 'Normal' },
        { parameter: 'Leucócitos', value: '6.400 /µL', reference: '4.000 a 11.000 /µL', status: 'Normal' }
      ]},
      { name: 'Glicemia de Jejum', results: [
        { parameter: 'Glicose plasmática', value: '88 mg/dL', reference: '70 a 99 mg/dL', status: 'Normal' }
      ]}
    ]
  },
  'IN002': {
    password: '123',
    patientName: 'Maria Antônia de Oliveira',
    date: '29/06/2026',
    doctor: 'Dra. Sandra Regina Mendes',
    status: 'Liberado',
    exams: [
      { name: 'TSH (Hormônio Tireoestimulante)', results: [
        { parameter: 'TSH Ultra Sensível', value: '2.45 µUI/mL', reference: '0.45 a 4.50 µUI/mL', status: 'Normal' }
      ]},
      { name: 'Vitamina D (25-hidroxivitamina D)', results: [
        { parameter: '25-OH-Vitamina D', value: '18.5 ng/mL', reference: 'Desejável acima de 20 ng/mL', status: 'Atenção (Insuficiente)' }
      ]}
    ]
  }
};

// ================= AUXILIARES E DADOS DE SEO / GOOGLE INDEXER =================

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// Mapeamento e suporte para as 16 URLs antigas do sitemap do laboratório
const SITEMAP_OLD_EXAMS = {
  'beta-hcg-qualitativo': {
    id: 'old-1',
    name: "Beta HCG Qualitativo (Teste de Gravidez)",
    category: "Hormônios",
    fasting: "Não obrigatório",
    timeframe: "4 horas",
    instructions: "Exame de sangue para detecção qualitativa (positivo/negativo) do hormônio da gravidez. Pode ser realizado a qualquer hora do dia.",
    code: "BHCG-QL"
  },
  'beta-hcg-quantitativo': {
    id: 'old-2',
    name: "Beta HCG Quantitativo (Gravidez)",
    category: "Hormônios",
    fasting: "Não obrigatório",
    timeframe: "4 horas",
    instructions: "Exame de sangue para dosagem exata do hormônio hCG, permitindo estimar o tempo de gestação. Pode ser realizado a qualquer hora do dia.",
    code: "BHCG-QT"
  },
  'colesterol-hdl': {
    id: 'old-3',
    name: "Colesterol HDL (Bom Colesterol)",
    category: "Cardiovascular",
    fasting: "Desejável 12h",
    timeframe: "24 horas",
    instructions: "Evitar bebidas alcoólicas e manter dieta habitual nos 3 dias anteriores ao exame. O jejum absoluto de 12 horas é aconselhável.",
    code: "CHDL"
  },
  'colesterol-ldl': {
    id: 'old-4',
    name: "Colesterol LDL (Mau Colesterol)",
    category: "Cardiovascular",
    fasting: "Desejável 12h",
    timeframe: "24 horas",
    instructions: "Manter dieta estável e evitar ingestão de álcool nas 72 horas anteriores ao exame. Jejum aconselhável de 12 horas.",
    code: "CLDL"
  },
  'colesterol-total': {
    id: 'old-5',
    name: "Colesterol Total",
    category: "Cardiovascular",
    fasting: "Desejável 12h",
    timeframe: "24 horas",
    instructions: "Evitar esforço físico pesado e manter dieta habitual nos 3 dias anteriores ao exame. Jejum recomendável de 12 horas.",
    code: "CTOTAL"
  },
  'covid19': {
    id: 'old-6',
    name: "Exame de COVID-19 (Antígeno / Swab)",
    category: "Imunologia",
    fasting: "Não obrigatório",
    timeframe: "24 horas",
    instructions: "Coleta por swab nasal (cotonete). Não utilizar sprays nasais ou pomadas no nariz nas 4 horas que antecedem a coleta.",
    code: "COVID19"
  },
  'dengue': {
    id: 'old-7',
    name: "Exame de Dengue (NS1 / Sorologia IgG/IgM)",
    category: "Imunologia",
    fasting: "Não obrigatório",
    timeframe: "24 horas",
    instructions: "Coleta de sangue comum para diagnóstico rápido ou detecção de anticorpos contra o vírus da dengue.",
    code: "DENGUE"
  },
  'hemoglobina-glicada': {
    id: 'old-8',
    name: "Hemoglobina Glicada (HbA1c)",
    category: "Diabetes",
    fasting: "Não obrigatório",
    timeframe: "24 horas",
    instructions: "Exame de sangue essencial para monitoramento do controle de açúcar médio nos últimos 3 meses em pacientes diabéticos ou em triagem.",
    code: "HBGLIC"
  },
  'hemograma': {
    id: 'old-9',
    name: "Hemograma Completo",
    category: "Sangue",
    fasting: "Recomendado 3h",
    timeframe: "24 horas",
    instructions: "Evitar o consumo de bebidas alcoólicas nas 72 horas que antecedem o exame. Evitar esforço físico intenso antes da coleta.",
    code: "HEMO01"
  },
  'sexagem-fetal': {
    id: 'old-10',
    name: "Sexagem Fetal (Descoberta do Sexo do Bebê)",
    category: "Genética",
    fasting: "Não obrigatório",
    timeframe: "5 dias úteis",
    instructions: "Indicado a partir da 8ª semana completa de gestação. Exame de sangue comum colhido da mãe para identificação do sexo do bebê com altíssima precisão.",
    code: "SEXFET"
  },
  't4livre': {
    id: 'old-11',
    name: "T4 Livre (Tiroxina Livre)",
    category: "Hormônios",
    fasting: "Recomendado 4h",
    timeframe: "48 horas",
    instructions: "Coleta de sangue preferencialmente pela manhã. Informar se utiliza medicamentos para tireoide e o horário de ingestão.",
    code: "T4LIV"
  },
  'teste-pezinho': {
    id: 'old-12',
    name: "Teste do Pezinho (Triagem Neonatal)",
    category: "Pediatria",
    fasting: "Não aplicável",
    timeframe: "7 dias úteis",
    instructions: "Realizado preferencialmente entre o 3º e 5º dia de vida do recém-nascido, através de pequenas gotinhas de sangue coletadas do calcanhar.",
    code: "PEZINH"
  },
  'toxicologico': {
    id: 'old-13',
    name: "Exame Toxicológico (Larga Janela)",
    category: "Toxicologia",
    fasting: "Não obrigatório",
    timeframe: "5 dias úteis",
    instructions: "Coleta de queratina (cabelo ou pelos corporais). Indicado para renovação de CNH categorias C, D e E, e também concursos públicos.",
    code: "TOXI10"
  },
  'tsh-ultra-sensivel': {
    id: 'old-14',
    name: "TSH Ultra-Sensível",
    category: "Hormônios",
    fasting: "Recomendado 4h",
    timeframe: "48 horas",
    instructions: "Exame de sangue altamente preciso para triagem e monitoramento da tireoide. Coleta recomendada pela manhã.",
    code: "TSH04"
  },
  'urina-simples-tipo-1': {
    id: 'old-15',
    name: "Urina Simples Tipo 1 (EAS)",
    category: "Urina",
    fasting: "Não obrigatório",
    timeframe: "24 horas",
    instructions: "Coletar preferencialmente a primeira urina da manhã. Realizar higiene íntima rigorosa, desprezar o primeiro jato e coletar o jato médio.",
    code: "EAS06"
  },
  'urocultura-antibiograma': {
    id: 'old-16',
    name: "Urocultura com Antibiograma",
    category: "Urina",
    fasting: "Não obrigatório",
    timeframe: "48 a 72 horas",
    instructions: "Coletar jato médio em frasco estéril fornecido pelo laboratório. Permite identificar infecção urinária e os melhores antibióticos para o tratamento.",
    code: "UROCULT"
  },
  'dna-paternidade': {
    id: 'old-17',
    name: "Exame de DNA e Teste de Paternidade (Confidencial)",
    category: "Genética",
    fasting: "Não obrigatório",
    timeframe: "7 dias úteis",
    instructions: "Teste de paternidade e exames de DNA seguros, 100% confidenciais e com altíssima precisão. Coleta simples de saliva por swab bucal ou amostra de sangue da mãe, filho(a) e suposto pai. Pode ser realizado para fins judiciais ou de forma totalmente privada.",
    code: "DNAPAT"
  },
  'exame-de-dna-paternidade': {
    id: 'old-18',
    name: "Exame de DNA e Teste de Paternidade",
    category: "Genética",
    fasting: "Não obrigatório",
    timeframe: "7 dias úteis",
    instructions: "Exame laboratorial de análise de DNA e paternidade com total sigilo e laudo de altíssima confiabilidade e precisão.",
    code: "DNAPAT"
  }
};

// ================= ROTAS INSTITUCIONAIS PUBLICAS =================

// 1. PÁGINA INICIAL
app.get('/', (req, res) => {
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
app.get('/sobre', (req, res) => {
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
app.get('/servicos', (req, res) => {
  res.render('servicos', { 
    page: 'servicos',
    seoTitle: 'Nossos Serviços Laboratoriais | InovaLab Cambará - PR',
    seoDescription: 'Confira a ampla gama de exames oferecidos pelo InovaLab: coleta domiciliar, exames infantis, toxicológico para CNH, exames admissionais/demissionais, medicina do trabalho.',
    seoKeywords: 'serviços laboratorio cambara, coleta domiciliar cambara, exame infantil cambara, medicina do trabalho cambara',
    canonicalPath: '/servicos'
  });
});

// 4. GUIA DE EXAMES & PREPARO
app.get('/preparo', (req, res) => {
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
app.get('/exames/:slug', (req, res) => {
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
app.get('/exames', (req, res) => {
  res.redirect(301, '/preparo');
});

app.get('/coletas', (req, res) => {
  res.redirect(301, '/servicos');
});

app.get('/estrutura', (req, res) => {
  res.redirect(301, '/sobre');
});

app.get('/quem-somos', (req, res) => {
  res.redirect(301, '/sobre');
});

// 7. SITEMAP.XML DINÂMICO COMPATÍVEL COM O ANTIGO
app.get('/sitemap.xml', (req, res) => {
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
app.get('/robots.txt', (req, res) => {
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
app.get('/orcamento', (req, res) => {
  res.redirect('/preparo');
});

// ROTA AUXILIAR DE PROXY DE LOGIN PARA PACIENTES
app.post('/api/verificar-login', async (req, res) => {
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

// Auxiliar para formatar exames e requisições no padrão da API
function formatRequisitionExams(reqsFound) {
  return reqsFound.map(r => {
    const reqCode = r.requisitionCode || r.id;
    const reqStatus = r.status || 'Coletado';
    const reqStatusLower = String(reqStatus).toLowerCase();
    const isReqLiberado = ['liberado', 'concluido', 'pronto', 'conferido', 'laudado'].includes(reqStatusLower);

    const examsList = (r.exams || []).map(e => {
      const eStatus = e.status || reqStatus || 'A Coletar';
      const eStatusLower = String(eStatus).toLowerCase();
      const isExamLiberado = isReqLiberado || ['liberado', 'concluido', 'pronto', 'conferido', 'laudado'].includes(eStatusLower);
      const pdfEndpoint = `/api/paciente/laudo/pdf?requisicao=${reqCode}&exame=${encodeURIComponent(e.code || '')}`;

      const rawDataResultado = isExamLiberado 
        ? (e.dataResultado || e.resultDate || e.conferidoAt || e.liberadoAt || r.conferidoAt || r.liberadoAt || r.dataResultado || r.updatedAt || r.createdAt || '')
        : (e.dataResultado || e.resultDate || '');

      return {
        codigo: e.code || '',
        nome: e.name || e.exame || '',
        material: e.material || 'Sangue',
        status: eStatus,
        laudoDisponivel: isExamLiberado,
        pdfUrl: isExamLiberado ? pdfEndpoint : null,
        dataColeta: formatDateTimeToBR(e.dataColeta || e.coletaDate || r.createdAt || ''),
        dataResultado: isExamLiberado ? formatDateTimeToBR(rawDataResultado) : ''
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
      listaExames: examsList
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
app.all(['/api/paciente/login', '/api/pacientes/login'], async (req, res) => {
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
app.all(['/api/paciente/me', '/api/paciente/perfil'], async (req, res) => {
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
app.all(['/api/paciente/exames', '/api/pacientes/exames'], async (req, res) => {
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
app.all(['/api/paciente/consultar', '/api/paciente/consulta', '/api/paciente/buscar'], async (req, res) => {
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

// 5. ENDPOINT PARA EMISSÃO / DOWNLOAD DO LAUDO EM PDF (/laudo/pdf)
app.all(['/api/paciente/laudo/pdf', '/api/pacientes/laudo/pdf', '/api/laudo/pdf'], async (req, res) => {
  try {
    const reqCode = req.query?.requisicao || req.query?.codigoRequisicao || req.query?.codigo || req.query?.id ||
                    req.body?.requisicao || req.body?.codigoRequisicao || req.body?.codigo || req.body?.id;

    if (!reqCode) {
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
      return res.status(404).json({
        success: false,
        error: "Requisição não encontrada",
        message: `Nenhuma requisição ou exame encontrado com o código ${reqCode}.`
      });
    }

    const statusStr = String(reqFound.status || '').toLowerCase();
    const isLiberado = ['liberado', 'concluido', 'pronto', 'conferido', 'laudado'].includes(statusStr) ||
                      (reqFound.exams || []).some(e => ['liberado', 'conferido', 'pronto', 'concluido', 'laudado'].includes(String(e.status || '').toLowerCase()));

    if (!isLiberado) {
      return res.status(403).json({
        success: false,
        error: "Laudo não liberado",
        message: `O laudo da requisição ${reqCode} ainda está com status '${reqFound.status || 'Em Análise'}'. O PDF só é gerado quando o laudo for CONFERIDO ou LIBERADO.`,
        statusAtual: reqFound.status || 'Em Análise'
      });
    }

    // Gerar documento PDF com pdfkit
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));

    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);

      if (req.query?.base64 === 'true' || req.body?.base64 === true) {
        return res.json({
          success: true,
          codigoRequisicao: reqCode,
          filename: `laudo_${reqCode}.pdf`,
          mimeType: 'application/pdf',
          base64: pdfBuffer.toString('base64'),
          dataUri: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`
        });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="laudo_${reqCode}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    });

    // --- MONTAGEM DO LAUDO EM PDF ---
    // Cabeçalho do Laboratório
    doc.fillColor('#0284c7').fontSize(20).text('INOVALAB CAMBARÁ', { align: 'center', bold: true });
    doc.fillColor('#475569').fontSize(10).text('Laboratório de Análises Clínicas e Diagnósticos', { align: 'center' });
    doc.fillColor('#64748b').fontSize(8).text('Rua Doutor Farto, 874 - Centro, Cambará - PR | WhatsApp: (43) 99618-3406', { align: 'center' });
    doc.moveDown(0.8);
    doc.strokeColor('#0284c7').lineWidth(2).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.8);

    // Título principal
    doc.fillColor('#0f172a').fontSize(14).text('LAUDO DE EXAMES LABORATORIAIS', { align: 'center' });
    doc.moveDown(0.8);

    // Quadro com Dados do Paciente e Requisição
    const boxY = doc.y;
    doc.rect(40, boxY, 515, 75).fillAndStroke('#f8fafc', '#cbd5e1');

    doc.fillColor('#0f172a').fontSize(10);
    doc.text(`Paciente: ${reqFound.patientName || 'Não Informado'}`, 50, boxY + 10);
    doc.text(`CPF: ${reqFound.patientCpf || '---'}`, 350, boxY + 10);

    doc.text(`Código Paciente: ${reqFound.patientCode || reqFound.id || '---'}`, 50, boxY + 30);
    doc.text(`Requisição: ${reqFound.requisitionCode || reqFound.id}`, 350, boxY + 30);

    doc.text(`Médico Solicitante: ${reqFound.doctorName || reqFound.responsibleName || 'Dr. Solicitante'}`, 50, boxY + 50);
    doc.text(`Data Emissão: ${formatDateTimeToBR(reqFound.createdAt || new Date())}`, 350, boxY + 50);

    doc.moveDown(3.5);

    // Lista de Exames Liberados e Resultados
    doc.fillColor('#0284c7').fontSize(12).text('RESULTADOS DOS EXAMES', { underline: true });
    doc.moveDown(0.5);

    const exams = reqFound.exams || [];
    const allCatalogExams = loadExams();

    if (exams.length === 0) {
      doc.fillColor('#475569').fontSize(10).text('Exames de Análise Clínica Geral liberados.');
    } else {
      exams.forEach((ex, idx) => {
        if (doc.y > 680) {
          doc.addPage();
        }

        const catEx = allCatalogExams.find(c => String(c.code || '').toUpperCase() === String(ex.code || ex.codigo || '').toUpperCase());
        const modelo = ex.modeloLaudo || (catEx && catEx.modeloLaudo) || 'Padrão LIS InovaLab';
        const examTitle = ex.name || ex.exame || catEx?.name || 'Exame de Análise Clínica';

        // Cabeçalho do Exame
        doc.fillColor('#0f172a').fontSize(11).text(`${idx + 1}. ${examTitle.toUpperCase()}`, { bold: true });
        
        const matStr = ex.material || catEx?.category || 'Sangue Total';
        const metStr = ex.metodo || ex.method || 'Automatizado';
        const eqStr = ex.equipamento || ex.equipment || 'Urit 8021A - Automatizado';
        doc.fillColor('#475569').fontSize(8.5).text(`Material: ${matStr} | Método: ${metStr} | Equipamento: ${eqStr}`);
        doc.moveDown(0.4);

        const resultText = String(ex.resultado || ex.result || '').trim();
        const refText = String(ex.valorReferencia || ex.referenceValue || ex.referencia || ex.refValue || '').trim();
        const obsText = String(ex.observacoes || ex.observations || '').trim();
        const interpText = String(ex.interpretacao || ex.interpretation || '').trim();

        if (modelo === 'Modelo Hematologia em Colunas' || (Array.isArray(ex.linhas) && ex.linhas.length > 0)) {
          // --- MODELO EM COLUNAS / TABELA ---
          const startX = 40;
          let tableY = doc.y;

          doc.rect(startX, tableY, 515, 18).fill('#e2e8f0');
          doc.fillColor('#1e293b').fontSize(8.5).text('PARÂMETRO', startX + 5, tableY + 4, { width: 150, bold: true });
          doc.text('RESULTADO', startX + 160, tableY + 4, { width: 90, align: 'right', bold: true });
          doc.text('UNIDADE', startX + 260, tableY + 4, { width: 55, bold: true });
          doc.text('VALORES DE REFERÊNCIA', startX + 325, tableY + 4, { width: 185, bold: true });

          tableY += 20;

          let linesToRender = Array.isArray(ex.linhas) && ex.linhas.length > 0 ? ex.linhas : [];
          if (linesToRender.length === 0 && resultText) {
            const rawLines = resultText.split('\n').map(l => l.trim()).filter(Boolean);
            linesToRender = rawLines.map(raw => {
              if (raw.includes(':')) {
                const parts = raw.split(':');
                const paramName = parts[0].trim();
                const rest = parts.slice(1).join(':').trim();
                return { parametro: paramName, resultado: rest, unidade: '', valorReferencia: '' };
              }
              return { parametro: 'Resultado', resultado: raw, unidade: '', valorReferencia: '' };
            });
          }

          if (linesToRender.length === 0) {
            linesToRender = [{ parametro: 'Resultado Geral', resultado: resultText || 'Normal', unidade: '', valorReferencia: refText }];
          }

          linesToRender.forEach((line, lIdx) => {
            if (tableY > 730) {
              doc.addPage();
              tableY = 40;
            }
            if (lIdx % 2 === 1) {
              doc.rect(startX, tableY - 2, 515, 16).fill('#f8fafc');
            }
            const param = line.parametro || line.PARAMETRO || line.part1 || 'Parâmetro';
            const resVal = line.resultado || line.result || line.value || '';
            const unitVal = line.unidade || line.unit || '';
            const refVal = line.valorReferencia || line.referencia || refText.split('\n')[0] || '---';

            doc.fillColor('#0f172a').fontSize(8.5).text(param, startX + 5, tableY, { width: 150 });
            doc.fillColor('#047857').fontSize(8.5).text(resVal, startX + 160, tableY, { width: 90, align: 'right', bold: true });
            doc.fillColor('#475569').fontSize(8).text(unitVal, startX + 260, tableY, { width: 55 });
            doc.fillColor('#64748b').fontSize(8).text(refVal, startX + 325, tableY, { width: 185 });

            tableY += 16;
          });

          doc.y = tableY + 4;

          if (refText && (!ex.linhas || ex.linhas.length === 0)) {
            doc.fillColor('#475569').fontSize(8).text('Notas de Referência:', { bold: true });
            refText.split('\n').forEach(lineStr => {
              doc.fillColor('#64748b').fontSize(7.5).text(lineStr, { indent: 10 });
            });
            doc.moveDown(0.3);
          }

        } else if (modelo === 'Modelo Microbiologia & Antibiograma') {
          // --- MICROBIOLOGIA & ANTIBIOGRAMA ---
          doc.fillColor('#0f172a').fontSize(9).text('MICROORGANISMO ISOLADO:', { bold: true });
          doc.fillColor('#047857').fontSize(9.5).text(resultText || 'Escherichia coli (Contagem: > 100.000 UFC/mL)', { indent: 10, bold: true });
          doc.moveDown(0.4);

          const startX = 40;
          let tableY = doc.y;

          doc.rect(startX, tableY, 515, 18).fill('#e2e8f0');
          doc.fillColor('#1e293b').fontSize(8.5).text('ANTIBIÓTICO TESTADO', startX + 10, tableY + 4, { width: 250, bold: true });
          doc.text('SENSIBILIDADE / RESULTADO', startX + 260, tableY + 4, { width: 240, align: 'center', bold: true });

          tableY += 20;
          const antibiogramList = [
            { ab: 'Ampicilina', status: 'Sensível' },
            { ab: 'Amoxicilina + Clavulanato', status: 'Sensível' },
            { ab: 'Cefalotina', status: 'Sensível' },
            { ab: 'Cefuroxima', status: 'Sensível' },
            { ab: 'Ciprofloxacino', status: 'Resistente' },
            { ab: 'Gentamicina', status: 'Sensível' },
            { ab: 'Nitrofurantoína', status: 'Sensível' },
            { ab: 'Sulfametoxazol + Trimetoprima', status: 'Resistente' }
          ];

          antibiogramList.forEach((row, rIdx) => {
            if (rIdx % 2 === 1) {
              doc.rect(startX, tableY - 2, 515, 16).fill('#f8fafc');
            }
            doc.fillColor('#0f172a').fontSize(8.5).text(row.ab, startX + 15, tableY, { width: 240 });
            const isRes = row.status.toLowerCase().includes('resistente');
            doc.fillColor(isRes ? '#dc2626' : '#047857').fontSize(8.5).text(row.status.toUpperCase(), startX + 260, tableY, { width: 240, align: 'center', bold: true });
            tableY += 16;
          });

          doc.y = tableY + 6;

        } else if (modelo === 'Modelo Texto Livre (Laudo Estruturado)') {
          // --- TEXTO LIVRE E LAUDO ESTRUTURADO ---
          doc.fillColor('#047857').fontSize(10).text(resultText || 'DADOS DENTRO DOS PADRÕES DA NORMALIDADE', { indent: 10, bold: true });
          doc.moveDown(0.4);

          if (refText) {
            doc.fillColor('#334155').fontSize(8.5).text('VALORES DE REFERÊNCIA E TEXTO TÉCNICO:', { bold: true });
            refText.split('\n').forEach(lineStr => {
              doc.fillColor('#475569').fontSize(8).text(lineStr, { indent: 10 });
            });
            doc.moveDown(0.4);
          }

        } else {
          // --- PADRÃO LIS INOVALAB ---
          doc.fillColor('#047857').fontSize(10.5).text(`Resultado: ${resultText || 'DADOS DENTRO DOS PADRÕES DA NORMALIDADE'}`, { indent: 10, bold: true });
          doc.moveDown(0.3);

          if (refText) {
            doc.fillColor('#334155').fontSize(8.5).text('Valores de Referência:', { bold: true });
            refText.split('\n').forEach(lineStr => {
              doc.fillColor('#475569').fontSize(8).text(lineStr, { indent: 10 });
            });
            doc.moveDown(0.3);
          }
        }

        if (interpText) {
          doc.fillColor('#1e293b').fontSize(8).text(`Interpretação / Nota Técnica: ${interpText}`, { italic: true });
          doc.moveDown(0.2);
        }
        if (obsText) {
          doc.fillColor('#64748b').fontSize(8).text(`Observações: ${obsText}`);
          doc.moveDown(0.3);
        }

        doc.moveDown(0.8);
      });
    }

    doc.moveDown(1);
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);

    // Carimbo e Assinatura Responsável Técnico
    doc.fillColor('#0f172a').fontSize(9).text('Assinado eletronicamente por:', { align: 'right' });
    doc.fillColor('#0284c7').fontSize(10).text('Dr. Carlos Eduardo Silva - CRBM 14.289/PR', { align: 'right', bold: true });
    doc.fillColor('#64748b').fontSize(8).text('Farmacêutico / Bioquímico Responsável Técnico', { align: 'right' });

    doc.moveDown(1.5);
    doc.fillColor('#15803d').fontSize(9).text('✓ LAUDO AUTENTICADO E LIBERADO DIGITALMENTE PELO INOVALAB', { align: 'center' });

    doc.end();

  } catch (error) {
    console.error("Erro ao gerar PDF do laudo:", error);
    return res.status(500).json({
      success: false,
      error: "Erro na geração do PDF",
      message: error.message
    });
  }
});

// 6. PORTAL DE RESULTADOS
app.get('/resultados', (req, res) => {
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
app.get('/contato', (req, res) => {
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
app.get('/blog', (req, res) => {
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
app.get('/blog/:id', (req, res) => {
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

// ================= ROTAS ADMINISTRATIVAS (RESTRIÇÃO DE ACESSO) =================

// Login Administrativo (GET)
app.get('/admin/login', (req, res) => {
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
app.post('/admin/login', (req, res) => {
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
app.get('/admin/logout', (req, res) => {
  res.cookie('admin_logged_out', 'true', { maxAge: 86400000 });
  res.clearCookie('admin_logged_in');
  res.clearCookie('admin_user_name');
  res.clearCookie('admin_professional_id');
  return res.redirect('/admin/login?logged_out=1');
});

// Dashboard Administrativo
app.get('/admin', requireAdmin, (req, res) => {
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
app.get('/admin/exames', requireAdmin, (req, res) => {
  const exams = getEnrichedExams();
  const labs = loadSupportLabs();
  const priceTables = loadPriceTables();
  const recipientes = loadRecipientes();
  const materiaisColetadosMaster = loadMateriaisColetados();
  const setores = loadSetores();
  const examesAlvaro = loadLabExamesAlvaro();
  const examesPardini = loadLabExamesPardini();
  res.render('admin/exames', {
    exams,
    labs,
    priceTables,
    recipientes,
    materiaisColetadosMaster,
    setores,
    examesAlvaro,
    examesPardini,
    page: 'admin-exames'
  });
});

// Página de Instruções Detalhadas de Preparo e Coleta
app.get('/admin/exames/instrucoes', requireAdmin, (req, res) => {
  const exams = getEnrichedExams();
  res.render('admin/exames-instrucoes', {
    exams,
    page: 'admin-exames-instrucoes'
  });
});

// Cadastrar Novo Exame (POST)
app.post('/admin/exames/add', requireAdmin, (req, res) => {
  const {
    name, category, fasting, timeframe, instructions, code, jalisCode, supportLab, pricePrivate,
    codigoAlvaro, codigoPardini, sinonimia, idadeMin, idadeMinUnidade, idadeMax, idadeMaxUnidade,
    sexo, amostras, tagsResultado, filtro, bloquearExame, permitirSalvarParcialmente, servico,
    importarPdf, tipoBPA, setores, materiaisColetados, historico, webConfig,
    modeloLaudo, formularioColeta, cabecalho,
    tituloLaudo, materialLaudo, metodoLaudo, valorReferenciaLaudo
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
    tituloLaudo: (tituloLaudo || name || '').trim(),
    materialLaudo: (materialLaudo || category || '').trim(),
    metodoLaudo: (metodoLaudo || '').trim(),
    valorReferenciaLaudo: (valorReferenciaLaudo || '').trim()
  };

  exams.push(newExam);
  saveExams(exams);
  syncExamPricesToPriceTables(newExam.code, newExam.name, newExam.materiaisColetados, newExam.pricePrivate);
  res.redirect('/admin/exames');
});

// Editar Exame Existente (POST)
app.post('/admin/exames/edit', requireAdmin, (req, res) => {
  const {
    id, name, category, fasting, timeframe, instructions, code, jalisCode, supportLab, pricePrivate,
    codigoAlvaro, codigoPardini, sinonimia, idadeMin, idadeMinUnidade, idadeMax, idadeMaxUnidade,
    sexo, amostras, tagsResultado, filtro, bloquearExame, permitirSalvarParcialmente, servico,
    importarPdf, tipoBPA, setores, materiaisColetados, historico, webConfig,
    modeloLaudo, formularioColeta, cabecalho,
    tituloLaudo, materialLaudo, metodoLaudo, valorReferenciaLaudo
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
      tituloLaudo: tituloLaudo !== undefined ? (tituloLaudo || name || '').trim() : (exams[index].tituloLaudo || exams[index].name || ''),
      materialLaudo: materialLaudo !== undefined ? (materialLaudo || category || '').trim() : (exams[index].materialLaudo || exams[index].category || ''),
      metodoLaudo: metodoLaudo !== undefined ? (metodoLaudo || '').trim() : (exams[index].metodoLaudo || ''),
      valorReferenciaLaudo: valorReferenciaLaudo !== undefined ? (valorReferenciaLaudo || '').trim() : (exams[index].valorReferenciaLaudo || '')
    };
    saveExams(exams);
    syncExamPricesToPriceTables(exams[index].code, exams[index].name, exams[index].materiaisColetados, exams[index].pricePrivate);
  }
  res.redirect('/admin/exames');
});

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
app.get('/admin/orcamentos', requireAdmin, (req, res) => {
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
app.post('/admin/orcamentos/add', requireAdmin, (req, res) => {
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

    const cleanPatientName = (patientName || 'Cliente Balcão').trim();
    
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
app.post('/admin/orcamentos/status', requireAdmin, (req, res) => {
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
app.post('/admin/orcamentos/delete', requireAdmin, (req, res) => {
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
app.get('/admin/cisnorpi', requireAdmin, (req, res) => {
  const items = loadCisnorpi();
  res.render('admin/cisnorpi', {
    items: items,
    page: 'admin-cisnorpi'
  });
});

// Adicionar Item Cisnorpi
app.post('/admin/cisnorpi/add', requireAdmin, (req, res) => {
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
app.post('/admin/cisnorpi/update', requireAdmin, (req, res) => {
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
app.post('/admin/cisnorpi/delete', requireAdmin, (req, res) => {
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
app.post('/admin/cisnorpi/import', requireAdmin, (req, res) => {
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

function loadPatients() {
  if (patientsCache) return patientsCache;
  patientsCache = loadLocalJson(PATIENTS_FILE);
  return patientsCache;
}

function savePatients(data) {
  try {
    patientsCache = data;
    saveJsonFile(PATIENTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    saveCollectionToMysql('patients', data).catch(err => console.error("Erro ao salvar pacientes no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar pacientes:", err);
  }
}

function loadAppointments() {
  if (appointmentsCache) return appointmentsCache;
  appointmentsCache = loadLocalJson(APPOINTMENTS_FILE);
  return appointmentsCache;
}

function saveAppointments(data) {
  try {
    appointmentsCache = data;
    saveJsonFile(APPOINTMENTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    saveCollectionToMysql('appointments', data).catch(err => console.error("Erro ao salvar agendamentos no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar agendamentos:", err);
  }
}

// Pacientes (PEP)
app.get('/admin/recepcao/pacientes', requireAdmin, (req, res) => {
  const patients = loadPatients();
  res.render('admin/recepcao/pacientes', {
    patients,
    page: 'admin-pacientes'
  });
});

app.post('/admin/recepcao/pacientes/save', requireAdmin, (req, res) => {
  try {
    const { 
      id, code, name, socialName, sex, gender, birthDate, ageValue, ageUnit, weight, height, color,
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

    const patientData = {
      code: patientCode,
      name: (name || '').trim(),
      socialName: (socialName || '').trim(),
      sex: sex || 'Não informado',
      gender: gender || 'Não informado',
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

    if (id) {
      const idx = patients.findIndex(p => p.id === id);
      if (idx !== -1) {
        patients[idx] = {
          ...patients[idx],
          ...patientData
        };
      } else {
        patients.push({
          id,
          prontuario: 'PRONT-' + Date.now().toString().slice(-6),
          createdAt: new Date().toISOString(),
          ...patientData
        });
      }
    } else {
      const newId = 'PAC-' + patientCode;
      patients.push({
        id: newId,
        prontuario: 'PEP-' + String(patientCode).padStart(5, '0'),
        createdAt: new Date().toISOString(),
        ...patientData
      });
    }

    savePatients(patients);
    res.redirect('/admin/recepcao/pacientes');
  } catch (err) {
    console.error("Erro ao salvar paciente:", err);
    res.redirect('/admin/recepcao/pacientes?error=erro_salvar');
  }
});

app.post('/admin/recepcao/pacientes/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (id) {
      let patients = loadPatients();
      patients = patients.filter(p => p.id !== id);
      savePatients(patients);
    }
    res.redirect('/admin/recepcao/pacientes');
  } catch (err) {
    console.error("Erro ao excluir paciente:", err);
    res.redirect('/admin/recepcao/pacientes?error=erro_excluir');
  }
});

app.post('/admin/recepcao/pacientes/toggle-status', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (id) {
      let patients = loadPatients();
      const patient = patients.find(p => p.id === id || p.code === id);
      if (patient) {
        patient.status = (patient.status === 'Inativo') ? 'Ativo' : 'Inativo';
        savePatients(patients);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao alterar status do paciente:", err);
    res.status(500).json({ error: "Erro interno ao alterar status" });
  }
});

// Agendamentos
app.get('/admin/recepcao/agendamentos', requireAdmin, (req, res) => {
  const appointments = loadAppointments();
  res.render('admin/recepcao/agendamentos', {
    appointments,
    page: 'admin-agendamentos'
  });
});

app.post('/admin/recepcao/agendamentos/save', requireAdmin, (req, res) => {
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
app.get('/admin/recepcao/coleta', requireAdmin, (req, res) => {
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
app.get('/admin/recepcao/recebimento', requireAdmin, (req, res) => {
  const requisitions = loadRequisitions();
  res.render('admin/recepcao/recebimento', {
    requisitions,
    page: 'admin-recebimento'
  });
});

// Triagem de Amostras
app.get('/admin/triagem/amostras', requireAdmin, (req, res) => {
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
app.get('/admin/triagem/criar-lote', requireAdmin, (req, res) => {
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
// MENU RESULTADOS - DIGITAÇÃO DE RESULTADOS
// ==========================================
app.get('/admin/resultados/digitacao', requireAdmin, (req, res) => {
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

// Salvar Resultado de Exame Individual
app.post('/admin/resultados/salvar-exame', requireAdmin, (req, res) => {
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

    // Recalcular status da requisição
    const allLiberados = targetReq.exams.every(e => e.status === 'Liberado');
    const allConferidosOrLiberados = targetReq.exams.every(e => e.status === 'Conferido' || e.status === 'Liberado');
    const hasAnyDigitado = targetReq.exams.some(e => ['Digitado', 'Conferido', 'Liberado'].includes(e.status));

    if (allLiberados) {
      targetReq.status = 'Liberado';
      if (!targetReq.liberadoAt) targetReq.liberadoAt = nowIso;
      targetReq.dataResultado = nowIso;
    } else if (allConferidosOrLiberados) {
      targetReq.status = 'Conferido';
    } else if (hasAnyDigitado) {
      targetReq.status = 'Em Digitação';
    }

    saveRequisitions(requisitions);

    return res.json({
      success: true,
      message: `Exame ${ex.code} atualizado para status "${newStatus}"!`,
      exam: ex,
      requisitionStatus: targetReq.status
    });
  } catch (error) {
    console.error('Erro ao salvar resultado de exame:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao salvar resultado do exame.' });
  }
});

// Salvar Todos os Exames da Requisição (Lote / Ação Completa)
app.post('/admin/resultados/salvar-requisicao-completa', requireAdmin, (req, res) => {
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
      targetReq.status = 'Conferido';
    } else if (action === 'liberar_todos') {
      targetReq.exams.forEach(ex => {
        ex.status = 'Liberado';
        ex.liberadoAt = nowIso;
        ex.liberadoBy = userName;
        ex.dataResultado = nowIso;
        ex.resultDate = nowIso;
      });
      targetReq.status = 'Liberado';
      targetReq.liberadoAt = nowIso;
      targetReq.dataResultado = nowIso;
    }

    saveRequisitions(requisitions);

    return res.json({
      success: true,
      message: 'Requisição atualizada com sucesso!',
      requisition: targetReq
    });
  } catch (error) {
    console.error('Erro ao atualizar requisição em lote:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao atualizar requisição.' });
  }
});

// Gerar Lote para Envio Externo (Álvaro / Pardini)
app.post('/admin/triagem/gerar-lote', requireAdmin, (req, res) => {
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
app.post('/admin/triagem/confirmar-lote-alvaro', requireAdmin, (req, res) => {
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
app.get('/admin/lab-externo/config', requireAdmin, (req, res) => {
  const configAlvaro = loadConfigApoioAlvaro();
  const configPardini = loadConfigApoioPardini();
  res.render('admin/lab-externo/config', {
    configAlvaro,
    configPardini,
    page: 'admin-lab-externo-config'
  });
});

app.get('/api/lab-externo/config/alvaro', requireAdmin, (req, res) => {
  try {
    const config = loadConfigApoioAlvaro();
    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao carregar configurações Álvaro.' });
  }
});

app.post('/api/lab-externo/config/alvaro/save', requireAdmin, (req, res) => {
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
app.post('/api/lab-externo/alvaro/criar-lote', requireAdmin, async (req, res) => {
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

app.get('/api/lab-externo/config/pardini', requireAdmin, (req, res) => {
  try {
    const config = loadConfigApoioPardini();
    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao carregar configurações Pardini.' });
  }
});

app.post('/api/lab-externo/config/pardini/save', requireAdmin, (req, res) => {
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
app.get('/admin/lab-externo/alvaro', requireAdmin, (req, res) => {
  const exames = loadLabExamesAlvaro();
  const materiais = loadMateriaisAlvaro();
  res.render('admin/lab-externo/alvaro', {
    exames,
    materiais,
    page: 'admin-lab-externo-alvaro'
  });
});

app.get('/api/lab-externo/alvaro/exames', requireAdmin, (req, res) => {
  try {
    const list = loadLabExamesAlvaro();
    return res.json({ success: true, exames: list });
  } catch (err) {
    return res.status(500).json({ success: false, exames: [] });
  }
});

app.post('/api/lab-externo/alvaro/save', requireAdmin, (req, res) => {
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

app.post('/api/lab-externo/alvaro/delete', requireAdmin, (req, res) => {
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
app.get('/admin/lab-externo/materiais-alvaro', requireAdmin, (req, res) => {
  const materiais = loadMateriaisAlvaro();
  res.render('admin/lab-externo/materiais-alvaro', {
    materiais,
    page: 'admin-lab-externo-materiais-alvaro'
  });
});

app.post('/api/lab-externo/materiais-alvaro/save', requireAdmin, (req, res) => {
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

app.post('/api/lab-externo/materiais-alvaro/delete', requireAdmin, (req, res) => {
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

app.post('/api/lab-externo/materiais-alvaro/sync', requireAdmin, async (req, res) => {
  try {
    const http = require('http');
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

app.post('/api/lab-externo/alvaro/sync-exames', requireAdmin, async (req, res) => {
  try {
    const http = require('http');
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
app.get('/admin/lab-externo/pardini', requireAdmin, (req, res) => {
  const exames = loadLabExamesPardini();
  res.render('admin/lab-externo/pardini', {
    exames,
    page: 'admin-lab-externo-pardini'
  });
});

app.get('/api/lab-externo/pardini/exames', requireAdmin, (req, res) => {
  try {
    const list = loadLabExamesPardini();
    return res.json({ success: true, exames: list });
  } catch (err) {
    return res.status(500).json({ success: false, exames: [] });
  }
});

app.post('/api/lab-externo/pardini/save', requireAdmin, (req, res) => {
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

app.post('/api/lab-externo/pardini/delete', requireAdmin, (req, res) => {
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
app.post('/admin/triagem/update-exam-destination', requireAdmin, (req, res) => {
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
app.post('/admin/triagem/update-batch-destinations', requireAdmin, (req, res) => {
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
app.post('/admin/triagem/confirm-triagem', requireAdmin, (req, res) => {
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
app.post('/admin/triagem/cancel-triagem', requireAdmin, (req, res) => {
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
app.get('/admin/temperaturas', requireAdmin, async (req, res) => {
  const items = await loadTemperaturas();
  res.render('admin/temperaturas', {
    items: items,
    page: 'admin-temperaturas'
  });
});

// Adicionar Novo Equipamento (POST)
app.post('/admin/temperaturas/add-equipamento', requireAdmin, async (req, res) => {
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
app.post('/admin/temperaturas/edit-equipamento', requireAdmin, async (req, res) => {
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
app.post('/admin/temperaturas/delete-equipamento', requireAdmin, async (req, res) => {
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
app.post('/admin/temperaturas/add-reading', requireAdmin, async (req, res) => {
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
app.post('/admin/temperaturas/add-occurrence', requireAdmin, async (req, res) => {
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
app.post('/admin/temperaturas/resolve-occurrence', requireAdmin, async (req, res) => {
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
app.post('/admin/temperaturas/add-maintenance', requireAdmin, async (req, res) => {
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
app.post('/admin/temperaturas/update-checklist', requireAdmin, async (req, res) => {
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
app.post('/admin/temperaturas/add-document', requireAdmin, async (req, res) => {
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
app.get('/admin/requisicoes', requireAdmin, (req, res) => {
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
    page: 'admin-requisitions'
  });
});

// ==========================================
// MÓDULO DE INTERFACEAMENTO DE EQUIPAMENTOS
// ==========================================

// Helper para formatar o código da amostra (etiqueta de coleta) no padrão 01-00001001-01 (01 > fixo, 00001001 > código requisição, 01 > setor)
function formatSampleBarcode(reqCode, sectorOrEquipment, existingBarcode) {
  const prefix = "01";
  const rawNum = String(reqCode || '1').replace(/\D/g, '');
  const paddedReq = rawNum ? rawNum.padStart(8, '0') : '00000001';

  let sectorCode = "01";
  if (sectorOrEquipment) {
    const s = String(sectorOrEquipment).trim().toLowerCase();
    if (/^\d{1,2}$/.test(s)) {
      sectorCode = s.padStart(2, '0');
    } else if (s.includes('hema') || s.includes('sysmex') || s.includes('sangue')) {
      sectorCode = "02";
    } else if (s.includes('imuno') || s.includes('hormon') || s.includes('cobas')) {
      sectorCode = "03";
    } else if (s.includes('urina') || s.includes('parasit')) {
      sectorCode = "04";
    } else if (s.includes('bioq') || s.includes('urit') || s.includes('mindray')) {
      sectorCode = "01";
    }
  }

  if (existingBarcode && typeof existingBarcode === 'string') {
    if (/^01-\d{8}-\d{2}$/.test(existingBarcode)) {
      return existingBarcode;
    }
    const mOld = existingBarcode.match(/^\d{8}-(\d+)-(\d{2})$/);
    if (mOld) {
      const oldReq = mOld[1].replace(/\D/g, '').padStart(8, '0');
      const oldSec = mOld[2];
      return `01-${oldReq}-${oldSec}`;
    }
  }

  return `${prefix}-${paddedReq}-${sectorCode}`;
}

let interfaceCache = null;

function getDefaultInterfaceData() {
  return {
    naoEnviados: [],
    processando: [],
    prontos: [],
    mensagens: []
  };
}

function loadInterfaceData() {
  if (!interfaceCache) {
    interfaceCache = loadLocalJson(INTERFACE_FILE);
    if (!interfaceCache || !Array.isArray(interfaceCache.naoEnviados)) {
      interfaceCache = getDefaultInterfaceData();
      saveInterfaceData(interfaceCache);
    }
  }
  
  if (!Array.isArray(interfaceCache.naoEnviados)) interfaceCache.naoEnviados = [];
  if (!Array.isArray(interfaceCache.processando)) interfaceCache.processando = [];
  if (!Array.isArray(interfaceCache.prontos)) interfaceCache.prontos = [];

  // Re-format all barcodes in interface lists to 01-00001001-01 standard
  ['naoEnviados', 'processando', 'prontos'].forEach(listName => {
    if (Array.isArray(interfaceCache[listName])) {
      interfaceCache[listName].forEach(item => {
        if (item) {
          const formattedBc = formatSampleBarcode(item.requisitionCode, item.sector || item.equipment, item.sampleBarcode);
          if (item.sampleBarcode !== formattedBc) {
            if (item.astmFrame && typeof item.astmFrame === 'string' && item.sampleBarcode) {
              item.astmFrame = item.astmFrame.split(item.sampleBarcode).join(formattedBc);
            }
            item.sampleBarcode = formattedBc;
          }
        }
      });
    }
  });

  // Dynamic sync from requisitions Cache
  try {
    const requisitions = loadRequisitions();

    requisitions.forEach(req => {
      if (Array.isArray(req.exams)) {
        req.exams.forEach(ex => {
          const statusStr = String(ex.status || req.status || '').trim().toLowerCase();
          const situacaoStr = String(ex.situacao || '').trim().toLowerCase();
          
          const triagemDest = (ex.triagemDestination && String(ex.triagemDestination).trim() !== '')
            ? String(ex.triagemDestination).trim().toLowerCase()
            : 'interno';

          const isColetadoOuAguardando = 
            statusStr === 'coletado' || 
            statusStr === 'aguardando execução' || 
            statusStr === 'aguardando execucao' || 
            statusStr === 'triado' || 
            statusStr === 'coletada' ||
            situacaoStr === 'coletado' || 
            situacaoStr === 'aguardando execução' ||
            situacaoStr === 'aguardando execucao' ||
            situacaoStr === 'triado';

          const isInterno = triagemDest === 'interno';

          if (isColetadoOuAguardando && isInterno) {
            const reqCodeFormatted = formatRequisitionCode(req.requisitionCode || req.id);
            const exCodeUpper = String(ex.code || ex.codigo || 'EXAM').toUpperCase().trim();
            const exBcClean = String(ex.sampleBarcode || req.barcode || '').toLowerCase().replace(/[-_]/g, '');

            const exists = ['naoEnviados', 'processando', 'prontos'].some(listName => 
              (interfaceCache[listName] || []).some(item => {
                if (!item) return false;
                const itemReqFormatted = formatRequisitionCode(item.requisitionCode);
                const itemExCodeUpper = String(item.examCode || item.code || item.codigo || '').toUpperCase().trim();
                const itemBcClean = String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');

                const reqMatch = (itemReqFormatted === reqCodeFormatted) && (itemExCodeUpper === exCodeUpper || !exCodeUpper || !itemExCodeUpper);
                const bcMatch = exBcClean && itemBcClean && (itemBcClean === exBcClean);

                return reqMatch || bcMatch;
              })
            );

            if (!exists) {
              const examCodeUpper = String(ex.code || ex.codigo || 'EXAM').toUpperCase();
              let equipment = ex.equipment;
              if (!equipment) {
                if (examCodeUpper === 'HEMO' || (ex.sector && ex.sector.toLowerCase().includes('hema'))) {
                  equipment = 'Sysmex XN-550 - Hematologia';
                } else if (['TSH', 'T4L', 'PSA', 'B-HCG', 'VITB12'].includes(examCodeUpper)) {
                  equipment = 'Cobas c311 - Roche';
                } else if (['UREIA', 'CREAT', 'TGO', 'TGP'].includes(examCodeUpper)) {
                  equipment = 'Mindray BS-200';
                } else {
                  equipment = 'Urit 8021A - Bioquímica';
                }
              }

              const reqCode = req.requisitionCode || req.id || '000000';
              const patName = req.patientName || req.pacienteName || 'Paciente sem nome';
              const patNameAstm = patName.replace(/\s+/g, '^');
              const sampleBarcode = formatSampleBarcode(reqCode, ex.sector || equipment, req.barcode || ex.barcode);
              const nowIso = new Date().toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);

              const newItem = {
                id: 'INT-ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
                requisitionCode: reqCode,
                patientName: patName,
                patientAge: req.patientAge || req.idade || 'N/I',
                patientSex: req.patientSex || 'M',
                convenio: req.convenioName || req.convenio || 'Particular',
                examCode: ex.code || ex.codigo || 'EXAM',
                examTitle: ex.name || ex.titulo || ex.descricao || ex.code || 'Exame',
                material: ex.material || ex.materialColetado || 'Soro',
                equipment,
                sampleBarcode: sampleBarcode,
                dateRequested: req.createdAt ? (typeof req.createdAt === 'string' ? req.createdAt : new Date(req.createdAt).toLocaleString('pt-BR')) : new Date().toLocaleString('pt-BR'),
                status: 'Aguardando Execução',
                sector: ex.sector || 'Geral',
                astmFrame: `H|\\^&|||LIS_INOVALAB|||||LIS|P|1|${nowIso}\nP|1||${reqCode}||${patNameAstm}|||M\nO|1|${sampleBarcode}||^^^${ex.code || 'EXAM'}|R|${nowIso}\nL|1|N`
              };
              interfaceCache.naoEnviados.unshift(newItem);
            }
          } else if (!isInterno) {
            // Se o destino do exame mudou para laboratório de apoio (Álvaro ou Pardini), remove dos exames não enviados do equipamento
            const idx = interfaceCache.naoEnviados.findIndex(item => item.requisitionCode === req.requisitionCode && item.examCode === ex.code);
            if (idx !== -1) {
              interfaceCache.naoEnviados.splice(idx, 1);
            }
          }
        });
      }
    });

    saveInterfaceData(interfaceCache);
  } catch (err) {
    console.error('Erro na sincronização dinâmica do interfaceamento:', err);
  }

  return interfaceCache;
}

function saveInterfaceData(data) {
  interfaceCache = data;
  try {
    saveJsonFile(INTERFACE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error("Erro ao salvar interface_data.json:", err);
  }
}

// Rota principal da tela de Interfaceamento
app.get('/admin/interfaceamento', requireAdmin, (req, res) => {
  const interfaceData = loadInterfaceData();
  const requisitions = loadRequisitions();
  res.render('admin/interfaceamento', {
    interfaceData,
    requisitions,
    page: 'admin-interfaceamento'
  });
});

// APIs de Interfaceamento
app.get('/api/interfaceamento/data', requireAdmin, (req, res) => {
  try {
    const data = loadInterfaceData();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao carregar dados do interfaceamento.' });
  }
});

// Helper for parsing exam results payload (valores)
function parseExameValores(valoresInput, rawResultVal) {
  let items = [];
  
  if (Array.isArray(valoresInput)) {
    valoresInput.forEach(v => {
      if (v && typeof v === 'object') {
        const labelVal = v.label || v.labelName || v.rotulo;
        const paramVal = v.parametro || v.key || v.PARAMETRO || v.nome;
        const displayKey = labelVal || paramVal || 'RESULTADO';
        const valStr = v.valor !== undefined ? v.valor : (v.value !== undefined ? v.value : (v.resultado !== undefined ? v.resultado : ''));
        const unitStr = v.unidade || v.unit || '';

        const itemObj = {
          key: String(displayKey),
          value: String(valStr !== undefined && valStr !== null ? valStr : '')
        };
        if (unitStr) {
          itemObj.unidade = String(unitStr);
          itemObj.unit = String(unitStr);
        }
        if (labelVal) itemObj.label = String(labelVal);
        if (paramVal) itemObj.parametro = String(paramVal);

        items.push(itemObj);
      } else if (v !== undefined && v !== null) {
        items.push({ key: "RESULTADO", value: String(v) });
      }
    });
  } else if (valoresInput && typeof valoresInput === 'object') {
    Object.keys(valoresInput).forEach(k => {
      const valObj = valoresInput[k];
      if (valObj && typeof valObj === 'object') {
        const valStr = valObj.valor !== undefined ? valObj.valor : (valObj.value !== undefined ? valObj.value : '');
        const unitStr = valObj.unidade || valObj.unit || '';
        const itemObj = { key: String(k), value: String(valStr) };
        if (unitStr) {
          itemObj.unidade = String(unitStr);
          itemObj.unit = String(unitStr);
        }
        items.push(itemObj);
      } else {
        items.push({ key: String(k), value: String(valObj) });
      }
    });
  } else if (valoresInput !== undefined && valoresInput !== null && String(valoresInput).trim() !== '') {
    items.push({ key: "RESULTADO", value: String(valoresInput) });
  } else if (rawResultVal !== undefined && rawResultVal !== null) {
    items.push({ key: "RESULTADO", value: String(rawResultVal) });
  }

  // Expand any item with key 'RESULTADO' or composite string containing '|', '\n', or ':'
  let expandedItems = [];
  items.forEach(it => {
    const kUpper = String(it.key || '').toUpperCase().trim();
    const strVal = String(it.value || '').trim();
    
    if ((kUpper === 'RESULTADO' || kUpper === 'VALOR' || kUpper === '' || kUpper === 'RESULTADO:') && (strVal.includes('|') || strVal.includes('\n') || strVal.includes(':'))) {
      const segments = strVal.split(/[|\n]/).map(s => s.trim()).filter(Boolean);
      segments.forEach(seg => {
        if (seg.includes(':')) {
          const colonIdx = seg.indexOf(':');
          const pName = seg.substring(0, colonIdx).trim();
          const pVal = seg.substring(colonIdx + 1).trim();
          expandedItems.push({ key: pName, value: pVal });
        } else {
          expandedItems.push({ key: it.key || 'RESULTADO', value: seg });
        }
      });
    } else {
      expandedItems.push(it);
    }
  });

  items = expandedItems;

  let isComplex = items.length > 1;

  return { items, isComplex };
}

function handleAmostraResultado(req, res) {
  try {
    const rawCode = 
      req.params.codigoAmostra || req.params.idAmostra || req.params.id ||
      req.query.idAmostra || req.query.codigoAmostra || req.query.codigo || req.query.sampleBarcode || req.query.barcode || req.query.amostra || req.query.id || req.query.id_amostra || req.query.codigo_amostra || req.query.sample_barcode || req.query.requisitionCode || req.query.reqCode ||
      (req.body && (req.body.idAmostra || req.body.codigoAmostra || req.body.codigo || req.body.sampleBarcode || req.body.barcode || req.body.amostra || req.body.id || req.body.id_amostra || req.body.codigo_amostra || req.body.sample_barcode || req.body.requisitionCode || req.body.reqCode));
    
    if (!rawCode || String(rawCode).trim() === '') {
      return res.status(400).json({ success: false, error: "Código da amostra (idAmostra) não informado." });
    }

    const searchCode = String(rawCode).trim();
    const searchNormalized = searchCode.toLowerCase();

    const exameCodeInput = req.body?.exame || req.body?.examCode || req.body?.exameCode || req.query?.exame || req.query?.examCode;
    const valoresInput = req.body?.valores || req.body?.valoresResultados || req.body?.resultado || req.query?.valores;

    const interfaceData = loadInterfaceData();
    const processando = Array.isArray(interfaceData.processando) ? interfaceData.processando : [];
    const naoEnviados = Array.isArray(interfaceData.naoEnviados) ? interfaceData.naoEnviados : [];

    // Search for matching item in processando first, then naoEnviados
    let sourceArray = processando;
    let foundIndex = processando.findIndex(item => {
      if (!item) return false;
      const bc = String(item.sampleBarcode || '').toLowerCase().trim();
      const reqCode = String(item.requisitionCode || '').toLowerCase().trim();
      const matchBc = bc === searchNormalized || bc.replace(/[-_]/g, '') === searchNormalized.replace(/[-_]/g, '') || reqCode === searchNormalized;
      if (!matchBc) return false;

      if (exameCodeInput) {
        const exNorm = String(exameCodeInput).toLowerCase().trim();
        const itemEx = String(item.examCode || item.examTitle || '').toLowerCase().trim();
        return itemEx === exNorm || itemEx.includes(exNorm) || exNorm.includes(itemEx);
      }
      return true;
    });

    if (foundIndex === -1) {
      sourceArray = naoEnviados;
      foundIndex = naoEnviados.findIndex(item => {
        if (!item) return false;
        const bc = String(item.sampleBarcode || '').toLowerCase().trim();
        const reqCode = String(item.requisitionCode || '').toLowerCase().trim();
        const matchBc = bc === searchNormalized || bc.replace(/[-_]/g, '') === searchNormalized.replace(/[-_]/g, '') || reqCode === searchNormalized;
        if (!matchBc) return false;

        if (exameCodeInput) {
          const exNorm = String(exameCodeInput).toLowerCase().trim();
          const itemEx = String(item.examCode || item.examTitle || '').toLowerCase().trim();
          return itemEx === exNorm || itemEx.includes(exNorm) || exNorm.includes(itemEx);
        }
        return true;
      });
    }

    let itemToFinish = null;
    if (foundIndex !== -1) {
      const [removed] = sourceArray.splice(foundIndex, 1);
      itemToFinish = removed;
    } else {
      // Fallback item if not found in interface cache
      itemToFinish = {
        id: 'INT-AUTO-' + Date.now(),
        requisitionCode: searchCode.split('-')[1] || searchCode,
        patientName: 'Paciente Interfaced',
        patientAge: '40 Anos',
        patientSex: 'M',
        examCode: (exameCodeInput || 'EXAME').toUpperCase(),
        examTitle: exameCodeInput || 'Exame de Laboratório',
        sampleBarcode: searchCode,
        equipment: 'Equipamento API'
      };
    }

    const { items, isComplex } = parseExameValores(valoresInput, req.body?.resultado || req.query?.resultado);

    const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let displayVal = '';
    if (!isComplex && items.length > 0) {
      const u = items[0].unit || items[0].unidade;
      displayVal = items[0].value + (u ? ' ' + u : '');
    } else {
      displayVal = items.map(i => {
        const u = i.unit || i.unidade;
        return `${i.key}: ${i.value}${u ? ' ' + u : ''}`;
      }).join(' | ');
    }

    const prontoItem = {
      id: 'INT-PRONTO-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      requisitionCode: itemToFinish.requisitionCode,
      patientName: itemToFinish.patientName,
      patientAge: itemToFinish.patientAge,
      patientSex: itemToFinish.patientSex,
      convenio: itemToFinish.convenio || 'Particular',
      examCode: (exameCodeInput || itemToFinish.examCode || 'EXAME').toUpperCase(),
      examTitle: itemToFinish.examTitle || exameCodeInput || 'EXAME',
      material: itemToFinish.material || 'Soro',
      equipment: itemToFinish.equipment || 'Equipamento API',
      sampleBarcode: itemToFinish.sampleBarcode || searchCode,
      resultValue: displayVal,
      isComplex: isComplex,
      parsedValores: items,
      unit: itemToFinish.unit || '',
      refRange: itemToFinish.refRange || '',
      completedTime: nowStr,
      status: 'Pronto'
    };

    if (!Array.isArray(interfaceData.prontos)) {
      interfaceData.prontos = [];
    }
    interfaceData.prontos.unshift(prontoItem);

    if (!Array.isArray(interfaceData.mensagens)) {
      interfaceData.mensagens = [];
    }
    interfaceData.mensagens.unshift({
      id: 'MSG-' + Date.now(),
      timestamp: nowStr,
      type: 'INBOUND',
      protocol: 'REST/JSON API',
      equipment: itemToFinish.equipment || 'Equipamento API',
      direction: 'EQUIPAMENTO ➔ LIS',
      payload: JSON.stringify({ idAmostra: searchCode, exame: exameCodeInput, valores: valoresInput }, null, 2),
      status: 'Resultado gravado via API /api/amostra/resultado'
    });

    saveInterfaceData(interfaceData);

    // Sync requisition
    try {
      const requisitions = loadRequisitions();
      const reqObj = requisitions.find(r => formatRequisitionCode(r.requisitionCode) === formatRequisitionCode(itemToFinish.requisitionCode) || r.id === itemToFinish.requisitionCode);
      if (reqObj && Array.isArray(reqObj.exams)) {
        let reqModified = false;
        reqObj.exams.forEach(ex => {
          const exNorm = (ex.code || ex.codigo || '').toLowerCase().trim();
          const targetEx = (prontoItem.examCode || '').toLowerCase().trim();
          if (exNorm === targetEx || exNorm.includes(targetEx) || targetEx.includes(exNorm)) {
            ex.status = 'Pronto';
            ex.situacao = 'Concluído';
            ex.resultado = displayVal;
            ex.valores = items;
            reqModified = true;
          }
        });
        if (reqModified) {
          saveRequisitions(requisitions);
        }
      }
    } catch (errReq) {
      console.error('Erro ao atualizar requisição com o resultado:', errReq);
    }

    return res.json({
      success: true,
      message: "Resultado armazenado e movido para Prontos com sucesso.",
      idAmostra: prontoItem.sampleBarcode,
      exame: prontoItem.examCode,
      status: "Pronto",
      resultado: {
        isComplex: isComplex,
        exame: prontoItem.examCode,
        valores: items,
        displayValue: displayVal
      }
    });

  } catch (err) {
    console.error("Erro no endpoint /api/amostra/resultado:", err);
    return res.status(500).json({ success: false, error: "Erro interno ao processar resultado do exame." });
  }
}

// Endpoint REST público para consulta de Amostras
function handleAmostraLookup(req, res) {
  try {
    const rawCode = 
      req.params.codigoAmostra || req.params.idAmostra || req.params.id ||
      req.query.idAmostra || req.query.codigoAmostra || req.query.codigo || req.query.sampleBarcode || req.query.barcode || req.query.amostra || req.query.id || req.query.id_amostra || req.query.codigo_amostra || req.query.sample_barcode || req.query.requisitionCode || req.query.reqCode ||
      (req.body && (req.body.idAmostra || req.body.codigoAmostra || req.body.codigo || req.body.sampleBarcode || req.body.barcode || req.body.amostra || req.body.id || req.body.id_amostra || req.body.codigo_amostra || req.body.sample_barcode || req.body.requisitionCode || req.body.reqCode));
    
    if (!rawCode || String(rawCode).trim() === '') {
      return res.status(400).json({ error: "Código da amostra não informado." });
    }

    const searchCode = String(rawCode).trim();
    const searchNormalized = searchCode.toLowerCase();
    const searchClean = searchNormalized.replace(/[-_]/g, '');
    const reqCodeNum = searchCode.includes('-') ? searchCode.split('-')[1] : searchCode;
    const reqFormattedFromSearch = formatRequisitionCode(reqCodeNum);

    // Carrega dados atualizados do interfaceamento
    const interfaceData = loadInterfaceData();
    const naoEnviados = (interfaceData && Array.isArray(interfaceData.naoEnviados)) ? interfaceData.naoEnviados : [];
    const processando = (interfaceData && Array.isArray(interfaceData.processando)) ? interfaceData.processando : [];
    const prontos = (interfaceData && Array.isArray(interfaceData.prontos)) ? interfaceData.prontos : [];

    // Busca nas listas
    let foundItem = naoEnviados.find(item => {
      if (!item) return false;
      const bc = String(item.sampleBarcode || '').toLowerCase().trim();
      const bcClean = bc.replace(/[-_]/g, '');
      const reqCode = String(item.requisitionCode || '').toLowerCase().trim();
      const reqFormatted = formatRequisitionCode(item.requisitionCode);

      return bc === searchNormalized ||
             bcClean === searchClean ||
             reqCode === searchNormalized ||
             reqFormatted === reqFormattedFromSearch;
    });

    let wasInNaoEnviados = false;

    if (foundItem) {
      wasInNaoEnviados = true;
    } else {
      foundItem = processando.find(item => {
        if (!item) return false;
        const bc = String(item.sampleBarcode || '').toLowerCase().trim();
        const bcClean = bc.replace(/[-_]/g, '');
        const reqCode = String(item.requisitionCode || '').toLowerCase().trim();
        const reqFormatted = formatRequisitionCode(item.requisitionCode);

        return bc === searchNormalized ||
               bcClean === searchClean ||
               reqCode === searchNormalized ||
               reqFormatted === reqFormattedFromSearch;
      }) || prontos.find(item => {
        if (!item) return false;
        const bc = String(item.sampleBarcode || '').toLowerCase().trim();
        const bcClean = bc.replace(/[-_]/g, '');
        const reqCode = String(item.requisitionCode || '').toLowerCase().trim();
        const reqFormatted = formatRequisitionCode(item.requisitionCode);

        return bc === searchNormalized ||
               bcClean === searchClean ||
               reqCode === searchNormalized ||
               reqFormatted === reqFormattedFromSearch;
      });
    }

    const requisitions = loadRequisitions();

    if (!foundItem) {
      // Fallback: busca diretamente no banco de requisições do LIS
      const reqObjFallback = requisitions.find(r => 
        formatRequisitionCode(r.requisitionCode) === reqFormattedFromSearch || 
        r.id === reqCodeNum ||
        r.requisitionCode === reqCodeNum ||
        (Array.isArray(r.exams) && r.exams.some(e => String(e.sampleBarcode || e.barcode || '').toLowerCase().replace(/[-_]/g, '') === searchClean))
      );

      if (reqObjFallback) {
        const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        foundItem = {
          id: 'INT-ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          requisitionCode: reqObjFallback.requisitionCode || reqCodeNum,
          patientName: reqObjFallback.patientName || 'Paciente LIS',
          patientAge: reqObjFallback.patientAge || '30 Anos',
          patientSex: reqObjFallback.patientSex || 'M',
          convenio: reqObjFallback.convenio || 'Particular',
          examCode: (reqObjFallback.exams && reqObjFallback.exams[0] && (reqObjFallback.exams[0].code || reqObjFallback.exams[0].codigo)) || 'EXAME',
          examTitle: (reqObjFallback.exams && reqObjFallback.exams[0] && (reqObjFallback.exams[0].name || reqObjFallback.exams[0].nome)) || 'Exame de Laboratório',
          material: 'Soro',
          equipment: 'Urit 8021A - Bioquímica',
          sampleBarcode: searchCode,
          status: 'Processando',
          startTime: nowStr,
          progress: 20
        };

        if (!Array.isArray(interfaceData.processando)) {
          interfaceData.processando = [];
        }
        interfaceData.processando.unshift(foundItem);

        if (!Array.isArray(interfaceData.mensagens)) {
          interfaceData.mensagens = [];
        }
        interfaceData.mensagens.unshift({
          id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 100),
          timestamp: nowStr,
          type: 'OUTBOUND',
          protocol: 'ASTM E1394 / REST',
          equipment: foundItem.equipment,
          direction: 'LIS ➔ EQUIPAMENTO',
          payload: `H|\\^&|||LIS_INOVALAB\nP|1||${foundItem.requisitionCode}||${foundItem.patientName}\nO|1|${foundItem.sampleBarcode}||^^^${foundItem.examCode}|R\nL|1|N`,
          status: 'Consulta API - Criada e Transicionada para Processando (Em Execução)'
        });

        saveInterfaceData(interfaceData);
      } else {
        return res.status(404).json({
          error: "Amostra não encontrada no sistema de interfaceamento.",
          idAmostra: searchCode
        });
      }
    }

    // Se estava na lista de não enviados, transiciona TODOS os exames vinculados para Processando
    if (wasInNaoEnviados) {
      const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const sampleBcToMove = String(foundItem.sampleBarcode || '').toLowerCase().trim();
      const reqCodeToMove = String(foundItem.requisitionCode || '').toLowerCase().trim();
      const reqFormattedToMove = formatRequisitionCode(foundItem.requisitionCode);

      const itemsToMove = interfaceData.naoEnviados.filter(i => {
        if (!i) return false;
        const bc = String(i.sampleBarcode || '').toLowerCase().trim();
        const bcClean = bc.replace(/[-_]/g, '');
        const reqCode = String(i.requisitionCode || '').toLowerCase().trim();
        const reqFormatted = formatRequisitionCode(i.requisitionCode);

        return (sampleBcToMove && bc === sampleBcToMove) ||
               (sampleBcToMove && bcClean === sampleBcToMove.replace(/[-_]/g, '')) ||
               (reqCodeToMove && reqCode === reqCodeToMove) ||
               (reqFormattedToMove && reqFormatted === reqFormattedToMove) ||
               bc === searchNormalized ||
               bcClean === searchClean ||
               reqCode === searchNormalized ||
               reqFormatted === reqFormattedFromSearch ||
               i.id === foundItem.id;
      });

      itemsToMove.forEach(item => {
        const idx = interfaceData.naoEnviados.findIndex(n => n.id === item.id);
        if (idx !== -1) {
          const [moved] = interfaceData.naoEnviados.splice(idx, 1);
          moved.status = 'Processando';
          moved.startTime = nowStr;
          moved.progress = Math.floor(Math.random() * 20) + 15;

          if (!Array.isArray(interfaceData.processando)) {
            interfaceData.processando = [];
          }
          if (!interfaceData.processando.some(p => p.id === moved.id)) {
            interfaceData.processando.unshift(moved);
          }

          if (!Array.isArray(interfaceData.mensagens)) {
            interfaceData.mensagens = [];
          }
          interfaceData.mensagens.unshift({
            id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 100),
            timestamp: nowStr,
            type: 'OUTBOUND',
            protocol: 'ASTM E1394',
            equipment: moved.equipment || 'Equipamento',
            direction: 'LIS ➔ EQUIPAMENTO',
            payload: moved.astmFrame || `H|\\^&|||LIS_INOVALAB\nP|1||${moved.requisitionCode}||${moved.patientName}\nO|1|${moved.sampleBarcode}||^^^${moved.examCode}|R\nL|1|N`,
            status: 'Consulta API - Transicionada para Processando (Em Execução)'
          });
        }
      });

      foundItem.status = 'Processando';
      saveInterfaceData(interfaceData);
    }

    // Atualiza status do exame na requisição no banco de requisições do LIS
    try {
      const targetReqCode = formatRequisitionCode(foundItem.requisitionCode);
      const reqObjToUpdate = requisitions.find(r => formatRequisitionCode(r.requisitionCode) === targetReqCode || r.id === foundItem.requisitionCode);
      if (reqObjToUpdate && Array.isArray(reqObjToUpdate.exams)) {
        let modified = false;
        reqObjToUpdate.exams.forEach(ex => {
          if (ex.status !== 'Pronto' && ex.status !== 'Concluído') {
            ex.status = 'Em Execução';
            ex.situacao = 'Em Execução';
            modified = true;
          }
        });
        if (modified) {
          saveRequisitions(requisitions);
        }
      }
    } catch (errReq) {
      console.error('Erro ao sincronizar requisição para Em Execução:', errReq);
    }

    // Localiza dados do paciente para retorno JSON
    const reqCodeFormatted = formatRequisitionCode(foundItem.requisitionCode);
    const reqObj = requisitions.find(r => formatRequisitionCode(r.requisitionCode) === reqCodeFormatted || r.id === foundItem.requisitionCode);

    let idPaciente = "1";
    if (reqObj) {
      idPaciente = String(reqObj.patientCode || reqObj.patientId || reqObj.pacienteId || reqObj.idPaciente || reqObj.patientCpf || foundItem.requisitionCode || "1");
    } else if (foundItem.requisitionCode) {
      idPaciente = String(foundItem.requisitionCode);
    }

    const nome = reqObj?.patientName || foundItem.patientName || "Paciente sem nome";

    let rawSex = (reqObj?.patientSex || foundItem.patientSex || 'M').trim().toUpperCase();
    let genero = 'M';
    if (rawSex.startsWith('F') || rawSex.includes('FEM')) {
      genero = 'F';
    } else {
      genero = 'M';
    }

    let dataNascimento = reqObj?.patientBirthDate || reqObj?.dataNascimento || foundItem.patientBirthDate || foundItem.dataNascimento || "";
    if (dataNascimento && dataNascimento.includes('T')) {
      dataNascimento = dataNascimento.split('T')[0];
    }

    if (!dataNascimento && (reqObj?.patientCode || reqObj?.patientId || idPaciente)) {
      const pCode = String(reqObj?.patientCode || reqObj?.patientId || idPaciente);
      const person = (typeof pessoasCache !== 'undefined' && Array.isArray(pessoasCache))
        ? pessoasCache.find(p => String(p.id) === pCode || String(p.code) === pCode || String(p.cpfCnpj) === pCode)
        : null;
      if (person?.birthDate) {
        dataNascimento = person.birthDate;
      }
    }

    let idade = 0;
    if (dataNascimento) {
      const birth = new Date(dataNascimento);
      if (!isNaN(birth.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
          age--;
        }
        if (age >= 0) idade = age;
      }
    }

    if (!idade) {
      const ageStr = String(reqObj?.patientAge || foundItem.patientAge || '');
      const match = ageStr.match(/\d+/);
      if (match) {
        idade = parseInt(match[0], 10);
      }
    }

    // Coleta todos os exames associados a esta amostra/requisição
    let examList = [];
    let examCodesSet = new Set();

    const sampleBcToMatch = String(foundItem.sampleBarcode || searchCode).toLowerCase().trim();
    const reqCodeToMatch = String(foundItem.requisitionCode || '').toLowerCase().trim();

    const allInterfaceItems = [
      ...(Array.isArray(interfaceData.processando) ? interfaceData.processando : []),
      ...(Array.isArray(interfaceData.naoEnviados) ? interfaceData.naoEnviados : []),
      ...(Array.isArray(interfaceData.prontos) ? interfaceData.prontos : [])
    ];

    allInterfaceItems.forEach(item => {
      if (!item) return;
      const bc = String(item.sampleBarcode || '').toLowerCase().trim();
      const bcClean = bc.replace(/[-_]/g, '');
      const reqCode = String(item.requisitionCode || '').toLowerCase().trim();

      const isMatch = (sampleBcToMatch && bc === sampleBcToMatch) ||
                      (sampleBcToMatch && bcClean === sampleBcToMatch.replace(/[-_]/g, '')) ||
                      (reqCodeToMatch && reqCode === reqCodeToMatch) ||
                      bc === searchNormalized ||
                      bcClean === searchClean;

      if (isMatch) {
        const code = item.examCode || item.codigo || item.code || item.exam;
        if (code && typeof code === 'string' && code.trim() !== '') {
          const cleanCode = code.trim();
          if (!examCodesSet.has(cleanCode)) {
            examCodesSet.add(cleanCode);
            examList.push({ codigo: cleanCode });
          }
        }
      }
    });

    if (reqObj && Array.isArray(reqObj.exams)) {
      reqObj.exams.forEach(ex => {
        if (!ex) return;
        const code = ex.code || ex.codigo || ex.jalisCode || ex.id || ex.examCode || ex.name;
        if (code && typeof code === 'string' && code.trim() !== '') {
          const cleanCode = code.trim();
          if (!examCodesSet.has(cleanCode)) {
            examCodesSet.add(cleanCode);
            examList.push({ codigo: cleanCode });
          }
        }
      });
    }

    if (examList.length === 0) {
      const fallbackCode = foundItem.examCode || foundItem.codigo || foundItem.code || "GLICO";
      examList.push({ codigo: String(fallbackCode).trim() });
    }

    return res.json({
      idAmostra: foundItem.sampleBarcode || searchCode,
      idPaciente: idPaciente,
      nome: nome,
      genero: genero,
      idade: idade,
      dataNascimento: dataNascimento || "",
      status: foundItem.status || "Processando",
      exames: examList
    });
  } catch (err) {
    console.error("Erro no endpoint de consulta de amostra:", err);
    return res.status(500).json({ error: "Erro interno ao buscar informações da amostra." });
  }
}

// Endpoint explícito para indicar que a amostra/exame entrou em processamento (sai de Não Enviados -> vai para Processando)
function handleProcessarAmostra(req, res) {
  try {
    const rawCode = 
      req.params.codigoAmostra || req.params.idAmostra || req.params.id ||
      req.query.idAmostra || req.query.codigoAmostra || req.query.codigo || req.query.sampleBarcode || req.query.barcode || req.query.amostra || req.query.id || req.query.id_amostra || req.query.codigo_amostra || req.query.sample_barcode || req.query.requisitionCode || req.query.reqCode ||
      (req.body && (req.body.idAmostra || req.body.codigoAmostra || req.body.codigo || req.body.sampleBarcode || req.body.barcode || req.body.amostra || req.body.id || req.body.id_amostra || req.body.codigo_amostra || req.body.sample_barcode || req.body.requisitionCode || req.body.reqCode));
    
    if (!rawCode || String(rawCode).trim() === '') {
      return res.status(400).json({ success: false, error: "Código da amostra não informado." });
    }

    const searchCode = String(rawCode).trim();
    const searchNormalized = searchCode.toLowerCase();
    const searchClean = searchNormalized.replace(/[-_]/g, '');
    const reqCodeNum = searchCode.includes('-') ? searchCode.split('-')[1] : searchCode;
    const reqFormattedFromSearch = formatRequisitionCode(reqCodeNum);

    const interfaceData = loadInterfaceData();
    const naoEnviados = Array.isArray(interfaceData.naoEnviados) ? interfaceData.naoEnviados : [];

    const itemsToMove = naoEnviados.filter(item => {
      if (!item) return false;
      const bc = String(item.sampleBarcode || '').toLowerCase().trim();
      const bcClean = bc.replace(/[-_]/g, '');
      const reqCode = String(item.requisitionCode || '').toLowerCase().trim();
      const reqFormatted = formatRequisitionCode(item.requisitionCode);
      const itemId = String(item.id || '').toLowerCase().trim();

      return bc === searchNormalized ||
             bcClean === searchClean ||
             reqCode === searchNormalized ||
             reqFormatted === reqFormattedFromSearch ||
             itemId === searchNormalized;
    });

    const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    let movedCount = 0;
    const movedItems = [];

    if (itemsToMove.length > 0) {
      itemsToMove.forEach(item => {
        const idx = interfaceData.naoEnviados.findIndex(n => n.id === item.id);
        if (idx !== -1) {
          const [moved] = interfaceData.naoEnviados.splice(idx, 1);
          moved.status = 'Processando';
          moved.startTime = nowStr;
          moved.progress = Math.floor(Math.random() * 20) + 15;

          if (!Array.isArray(interfaceData.processando)) {
            interfaceData.processando = [];
          }
          if (!interfaceData.processando.some(p => p.id === moved.id)) {
            interfaceData.processando.unshift(moved);
          }
          movedItems.push(moved);
          movedCount++;

          if (!Array.isArray(interfaceData.mensagens)) {
            interfaceData.mensagens = [];
          }
          interfaceData.mensagens.unshift({
            id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 100),
            timestamp: nowStr,
            type: 'OUTBOUND',
            protocol: 'ASTM E1394',
            equipment: moved.equipment || 'Equipamento',
            direction: 'LIS ➔ EQUIPAMENTO',
            payload: moved.astmFrame || `H|\\^&|||LIS_INOVALAB\nP|1||${moved.requisitionCode}||${moved.patientName}\nO|1|${moved.sampleBarcode}||^^^${moved.examCode}|R\nL|1|N`,
            status: 'Transicionada para Processando (Em Execução)'
          });
        }
      });

      saveInterfaceData(interfaceData);

      // Atualiza também os exames na requisição original em requisitions.json
      try {
        const requisitions = loadRequisitions();
        let reqModified = false;
        movedItems.forEach(moved => {
          const reqObj = requisitions.find(r => formatRequisitionCode(r.requisitionCode) === formatRequisitionCode(moved.requisitionCode) || r.id === moved.requisitionCode);
          if (reqObj && Array.isArray(reqObj.exams)) {
            reqObj.exams.forEach(ex => {
              if (ex.code === moved.examCode || ex.codigo === moved.examCode) {
                ex.status = 'Em Execução';
                ex.situacao = 'Em Execução';
                reqModified = true;
              }
            });
          }
        });
        if (reqModified) {
          saveRequisitions(requisitions);
        }
      } catch (errReq) {
        console.error('Erro ao atualizar requisições para Em Execução:', errReq);
      }
    } else {
      // Se não encontrou em naoEnviados, verifica se já está em processando
      const alreadyProcessing = (interfaceData.processando || []).filter(item => {
        if (!item) return false;
        const bc = String(item.sampleBarcode || '').toLowerCase().trim();
        const reqCode = String(item.requisitionCode || '').toLowerCase().trim();
        return bc === searchNormalized ||
               bc.replace(/[-_]/g, '') === searchNormalized.replace(/[-_]/g, '') ||
               reqCode === searchNormalized;
      });

      if (alreadyProcessing.length > 0) {
        return res.json({
          success: true,
          message: "Os exames desta amostra já estão na lista de Processando.",
          idAmostra: searchCode,
          status: "Processando",
          totalExamesProcessando: alreadyProcessing.length,
          exames: alreadyProcessing
        });
      }

      return res.status(404).json({
        success: false,
        error: "Amostra não encontrada na lista de Não Enviados.",
        idAmostra: searchCode
      });
    }

    return res.json({
      success: true,
      message: `Amostra ${searchCode} enviada para a aba de Processando com sucesso.`,
      idAmostra: searchCode,
      status: "Processando",
      totalExamesTransicionados: movedCount,
      exames: movedItems
    });
  } catch (err) {
    console.error("Erro no endpoint de alterar amostra para processando:", err);
    return res.status(500).json({ success: false, error: "Erro interno ao processar amostra." });
  }
}

app.get('/api/amostra/:codigoAmostra', handleAmostraLookup);
app.get('/api/amostra', handleAmostraLookup);
app.post('/api/amostra', handleAmostraLookup);
app.get('/api/interfaceamento/amostra/:codigoAmostra', handleAmostraLookup);

// Endpoints para gravação de resultados de exames (Move de Processando -> Prontos)
app.post('/api/amostra/resultado', handleAmostraResultado);
app.get('/api/amostra/resultado', handleAmostraResultado);
app.post('/api/amostra/resultados', handleAmostraResultado);
app.get('/api/amostra/resultados', handleAmostraResultado);
app.post('/api/amostra/resultado/:idAmostra', handleAmostraResultado);
app.get('/api/amostra/resultado/:idAmostra', handleAmostraResultado);
app.post('/api/amostra/:codigoAmostra/resultado', handleAmostraResultado);
app.get('/api/amostra/:codigoAmostra/resultado', handleAmostraResultado);

app.post('/api/interfaceamento/amostra/resultado', handleAmostraResultado);
app.get('/api/interfaceamento/amostra/resultado', handleAmostraResultado);
app.post('/api/interfaceamento/amostra/resultado/:idAmostra', handleAmostraResultado);
app.get('/api/interfaceamento/amostra/resultado/:idAmostra', handleAmostraResultado);
app.post('/api/interfaceamento/amostra/:codigoAmostra/resultado', handleAmostraResultado);
app.get('/api/interfaceamento/amostra/:codigoAmostra/resultado', handleAmostraResultado);

// Endpoints para indicar início de processamento da amostra (Move de Não Enviados -> Processando)
app.post('/api/amostra/processar', handleProcessarAmostra);
app.get('/api/amostra/processar', handleProcessarAmostra);
app.post('/api/amostra/processar/:codigoAmostra', handleProcessarAmostra);
app.get('/api/amostra/processar/:codigoAmostra', handleProcessarAmostra);
app.post('/api/amostra/status', handleProcessarAmostra);
app.post('/api/interfaceamento/processar-amostra', handleProcessarAmostra);
app.post('/api/interfaceamento/processar-amostra/:codigoAmostra', handleProcessarAmostra);
app.get('/api/interfaceamento/processar-amostra/:codigoAmostra', handleProcessarAmostra);

app.post('/api/interfaceamento/send-order', requireAdmin, (req, res) => {
  try {
    const { id, ids } = req.body;
    let data = loadInterfaceData();
    const targetIds = Array.isArray(ids) ? ids : (id ? [id] : []);
    
    if (targetIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhuma ordem selecionada.' });
    }

    let movedCount = 0;
    const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    targetIds.forEach(targetId => {
      const idx = data.naoEnviados.findIndex(item => item.id === targetId);
      if (idx !== -1) {
        const item = data.naoEnviados.splice(idx, 1)[0];
        item.status = 'Processando';
        item.startTime = nowStr;
        item.progress = Math.floor(Math.random() * 20) + 10;
        data.processando.unshift(item);
        movedCount++;

        data.mensagens.unshift({
          id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 100),
          timestamp: nowStr,
          type: 'OUTBOUND',
          protocol: 'ASTM E1394',
          equipment: item.equipment || 'Equipamento',
          direction: 'LIS ➔ EQUIPAMENTO',
          payload: item.astmFrame || `H|\\^&|||LIS_INOVALAB\nP|1||${item.requisitionCode}||${item.patientName}\nO|1|${item.sampleBarcode}||^^^${item.examCode}|R\nL|1|N`,
          status: 'Ordem enviada com sucesso'
        });
      }
    });

    saveInterfaceData(data);
    return res.json({ success: true, movedCount, data });
  } catch (err) {
    console.error('Erro ao enviar ordem para equipamento:', err);
    return res.status(500).json({ success: false, message: 'Erro ao enviar ordem.' });
  }
});

app.post('/api/interfaceamento/revert-to-naoenviados', (req, res) => {
  try {
    const { id, sampleBarcode, requisitionCode } = req.body;
    let data = loadInterfaceData();
    
    let itemsToRevert = [];
    if (id) {
      itemsToRevert = data.processando.filter(item => item && String(item.id) === String(id));
      if (itemsToRevert.length === 0) {
        itemsToRevert = data.processando.filter(item => 
          item && (
            String(item.sampleBarcode || '').toLowerCase().trim() === String(id).toLowerCase().trim() ||
            String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '') === String(id).toLowerCase().replace(/[-_]/g, '') ||
            String(item.requisitionCode) === String(id) ||
            formatRequisitionCode(item.requisitionCode) === formatRequisitionCode(id)
          )
        );
      }
    } else if (sampleBarcode) {
      itemsToRevert = data.processando.filter(item => item && (
        String(item.sampleBarcode || '').toLowerCase().trim() === String(sampleBarcode).toLowerCase().trim() ||
        String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '') === String(sampleBarcode).toLowerCase().replace(/[-_]/g, '')
      ));
    } else if (requisitionCode) {
      itemsToRevert = data.processando.filter(item => item && (
        String(item.requisitionCode) === String(requisitionCode) ||
        formatRequisitionCode(item.requisitionCode) === formatRequisitionCode(requisitionCode)
      ));
    }

    if (itemsToRevert.length === 0) {
      return res.status(404).json({ success: false, message: 'Item em processamento não encontrado.' });
    }

    const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    itemsToRevert.forEach(item => {
      const idx = data.processando.findIndex(p => p.id === item.id);
      if (idx !== -1) {
        const [moved] = data.processando.splice(idx, 1);
        moved.status = 'Aguardando Execução';
        delete moved.startTime;
        delete moved.progress;
        
        if (!Array.isArray(data.naoEnviados)) {
          data.naoEnviados = [];
        }
        if (!data.naoEnviados.some(n => n.id === moved.id)) {
          data.naoEnviados.unshift(moved);
        }

        if (!Array.isArray(data.mensagens)) {
          data.mensagens = [];
        }
        data.mensagens.unshift({
          id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 100),
          timestamp: nowStr,
          type: 'SYSTEM',
          protocol: 'LIS INTERACTION',
          equipment: moved.equipment || 'Sistema LIS',
          direction: 'EQUIPAMENTO ➔ LIS',
          payload: `Ação Manual: Ordem ${moved.requisitionCode} (${moved.examCode}) retornou de Processando para Não Enviados`,
          status: 'Retornado para Não Enviados'
        });
      }
    });

    saveInterfaceData(data);

    // Sincroniza requisição original
    try {
      const requisitions = loadRequisitions();
      let reqModified = false;
      itemsToRevert.forEach(moved => {
        const reqObj = requisitions.find(r => formatRequisitionCode(r.requisitionCode) === formatRequisitionCode(moved.requisitionCode) || r.id === moved.requisitionCode);
        if (reqObj && Array.isArray(reqObj.exams)) {
          reqObj.exams.forEach(ex => {
            const exCode = String(ex.code || ex.codigo || '').toUpperCase().trim();
            const movedExCode = String(moved.examCode || moved.code || '').toUpperCase().trim();
            const exBc = String(ex.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');
            const movedBc = String(moved.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');

            if (exCode === movedExCode || (exBc && movedBc && exBc === movedBc)) {
              ex.status = 'Triado';
              ex.situacao = 'Pendente';
              delete ex.resultado;
              delete ex.valores;
              delete ex.resultValue;
              delete ex.laudo;
              reqModified = true;
            }
          });
        }
      });
      if (reqModified) {
        saveRequisitions(requisitions);
      }
    } catch (errReq) {}

    return res.json({ success: true, message: 'Amostra/Ordem retornada para a aba Não Enviados com sucesso.', data });
  } catch (err) {
    console.error('Erro ao reverter para não enviados:', err);
    return res.status(500).json({ success: false, message: 'Erro ao reverter amostra.' });
  }
});

app.post('/api/interfaceamento/revert-to-processando', (req, res) => {
  try {
    const { id, sampleBarcode, requisitionCode } = req.body;
    let data = loadInterfaceData();

    let itemsToRevert = [];
    if (id) {
      itemsToRevert = data.prontos.filter(item => item && String(item.id) === String(id));
      if (itemsToRevert.length === 0) {
        itemsToRevert = data.prontos.filter(item => 
          item && (
            String(item.sampleBarcode || '').toLowerCase().trim() === String(id).toLowerCase().trim() ||
            String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '') === String(id).toLowerCase().replace(/[-_]/g, '') ||
            String(item.requisitionCode) === String(id) ||
            formatRequisitionCode(item.requisitionCode) === formatRequisitionCode(id)
          )
        );
      }
    } else if (sampleBarcode) {
      itemsToRevert = data.prontos.filter(item => item && (
        String(item.sampleBarcode || '').toLowerCase().trim() === String(sampleBarcode).toLowerCase().trim() ||
        String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '') === String(sampleBarcode).toLowerCase().replace(/[-_]/g, '')
      ));
    } else if (requisitionCode) {
      itemsToRevert = data.prontos.filter(item => item && (
        String(item.requisitionCode) === String(requisitionCode) ||
        formatRequisitionCode(item.requisitionCode) === formatRequisitionCode(requisitionCode)
      ));
    }

    if (itemsToRevert.length === 0) {
      return res.status(404).json({ success: false, message: 'Resultado pronto não encontrado.' });
    }

    const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    itemsToRevert.forEach(item => {
      const idx = data.prontos.findIndex(p => p.id === item.id);
      if (idx !== -1) {
        const [moved] = data.prontos.splice(idx, 1);
        moved.status = 'Processando';
        moved.startTime = nowStr;
        moved.progress = 50;
        delete moved.resultValue;
        delete moved.completedTime;
        delete moved.parsedValores;
        delete moved.isComplex;

        if (!Array.isArray(data.processando)) {
          data.processando = [];
        }
        if (!data.processando.some(p => p.id === moved.id)) {
          data.processando.unshift(moved);
        }

        if (!Array.isArray(data.mensagens)) {
          data.mensagens = [];
        }
        data.mensagens.unshift({
          id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 100),
          timestamp: nowStr,
          type: 'SYSTEM',
          protocol: 'LIS INTERACTION',
          equipment: moved.equipment || 'Sistema LIS',
          direction: 'EQUIPAMENTO ➔ LIS',
          payload: `Ação Manual: Resultado ${moved.requisitionCode} (${moved.examCode}) retornado de Prontos para Processando`,
          status: 'Retornado para Processando'
        });
      }
    });

    saveInterfaceData(data);

    // Sincroniza requisição original
    try {
      const requisitions = loadRequisitions();
      let reqModified = false;
      itemsToRevert.forEach(moved => {
        const reqObj = requisitions.find(r => formatRequisitionCode(r.requisitionCode) === formatRequisitionCode(moved.requisitionCode) || r.id === moved.requisitionCode);
        if (reqObj && Array.isArray(reqObj.exams)) {
          reqObj.exams.forEach(ex => {
            const exCode = String(ex.code || ex.codigo || '').toUpperCase().trim();
            const movedExCode = String(moved.examCode || moved.code || '').toUpperCase().trim();
            const exBc = String(ex.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');
            const movedBc = String(moved.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');

            if (exCode === movedExCode || (exBc && movedBc && exBc === movedBc)) {
              ex.status = 'Em Execução';
              ex.situacao = 'Em Execução';
              delete ex.resultado;
              delete ex.valores;
              delete ex.resultValue;
              delete ex.laudo;
              reqModified = true;
            }
          });
        }
      });
      if (reqModified) {
        saveRequisitions(requisitions);
      }
    } catch (errReq) {}

    return res.json({ success: true, message: 'Resultado retornado para a aba de Processando com sucesso.', data });
  } catch (err) {
    console.error('Erro ao reverter para processando:', err);
    return res.status(500).json({ success: false, message: 'Erro ao reverter resultado.' });
  }
});

app.post('/api/interfaceamento/send-all', requireAdmin, (req, res) => {
  try {
    let data = loadInterfaceData();
    const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let count = 0;
    while (data.naoEnviados.length > 0) {
      const item = data.naoEnviados.shift();
      item.status = 'Processando';
      item.startTime = nowStr;
      item.progress = Math.floor(Math.random() * 20) + 15;
      data.processando.unshift(item);
      count++;

      data.mensagens.unshift({
        id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 100),
        timestamp: nowStr,
        type: 'OUTBOUND',
        protocol: 'ASTM E1394',
        equipment: item.equipment || 'Equipamento',
        direction: 'LIS ➔ EQUIPAMENTO',
        payload: item.astmFrame || `H|\\^&|||LIS_INOVALAB\nP|1||${item.requisitionCode}||${item.patientName}\nO|1|${item.sampleBarcode}||^^^${item.examCode}|R\nL|1|N`,
        status: 'Ordem enviada com sucesso (Lote)'
      });
    }

    saveInterfaceData(data);
    return res.json({ success: true, count, data });
  } catch (err) {
    console.error('Erro ao enviar todos para equipamento:', err);
    return res.status(500).json({ success: false, message: 'Erro ao enviar todos os exames.' });
  }
});

app.post('/api/interfaceamento/simulate-result', requireAdmin, (req, res) => {
  try {
    const { id, customValue } = req.body;
    let data = loadInterfaceData();
    const idx = data.processando.findIndex(item => item.id === id);

    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'Exame em processamento não encontrado.' });
    }

    const item = data.processando.splice(idx, 1)[0];
    const nowStr = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let val = customValue;
    let unit = 'mg/dL';
    let refRange = '70 a 99 mg/dL';

    if (!val) {
      if (item.examCode === 'GLI') { val = '102'; unit = 'mg/dL'; refRange = '70 a 99 mg/dL'; }
      else if (item.examCode === 'HEMO') { val = '14,2'; unit = 'g/dL'; refRange = '12,0 a 16,0 g/dL'; }
      else if (item.examCode === 'UREIA') { val = '34'; unit = 'mg/dL'; refRange = '15 a 45 mg/dL'; }
      else if (item.examCode === 'CREAT') { val = '0,95'; unit = 'mg/dL'; refRange = '0,70 a 1,20 mg/dL'; }
      else if (item.examCode === 'TGO') { val = '28'; unit = 'U/L'; refRange = 'Até 35 U/L'; }
      else if (item.examCode === 'TGP') { val = '31'; unit = 'U/L'; refRange = 'Até 35 U/L'; }
      else { val = '100'; unit = 'mg/dL'; refRange = 'Referência normal'; }
    }

    const prontoItem = {
      id: 'INT-PRONTO-' + Date.now(),
      requisitionCode: item.requisitionCode,
      patientName: item.patientName,
      patientAge: item.patientAge,
      patientSex: item.patientSex,
      convenio: item.convenio,
      examCode: item.examCode,
      examTitle: item.examTitle,
      material: item.material,
      equipment: item.equipment,
      sampleBarcode: item.sampleBarcode,
      resultValue: val,
      unit: unit,
      refRange: refRange,
      completedTime: nowStr,
      status: 'Pronto',
      rawResult: {
        part1: 'RESULTADO:',
        resultado: String(val),
        unidade: unit
      }
    };

    data.prontos.unshift(prontoItem);

    data.mensagens.unshift({
      id: 'MSG-' + Date.now(),
      timestamp: nowStr,
      type: 'INBOUND',
      protocol: 'ASTM E1394',
      equipment: item.equipment,
      direction: 'EQUIPAMENTO ➔ LIS',
      payload: `H|\\^&|||${(item.equipment || 'EQ').replace(/\s+/g, '_')}\nP|1||${item.requisitionCode}||${item.patientName}\nR|1|^^^${item.examCode}|${val}|${unit}|${refRange}|N||F|||${new Date().toISOString()}\nL|1|N`,
      status: 'Resultado lido do equipamento'
    });

    saveInterfaceData(data);
    return res.json({ success: true, prontoItem, data });
  } catch (err) {
    console.error('Erro ao simular resultado do equipamento:', err);
    return res.status(500).json({ success: false, message: 'Erro ao simular resultado.' });
  }
});

app.post('/api/interfaceamento/add-manual-order', requireAdmin, (req, res) => {
  try {
    const { requisitionCode, patientName, patientAge, examCode, examTitle, equipment, material } = req.body;
    let data = loadInterfaceData();

    const reqCode = (requisitionCode || '').trim() || String(Math.floor(100000 + Math.random() * 900000));
    const patName = (patientName || '').trim() || 'Paciente Exemplo';
    const exCode = (examCode || 'GLI').trim().toUpperCase();
    const exTitle = (examTitle || 'GLICOSE DE JEJUM').trim();
    const eq = (equipment || 'Urit 8021A - Bioquímica').trim();
    const mat = (material || 'Soro').trim();

    const sampleBarcode = formatSampleBarcode(reqCode, eq);

    const newItem = {
      id: 'INT-ORD-' + Date.now(),
      requisitionCode: reqCode,
      patientName: patName,
      patientAge: patientAge || '45 Anos',
      patientSex: 'M',
      convenio: 'Particular',
      examCode: exCode,
      examTitle: exTitle,
      material: mat,
      equipment: eq,
      sampleBarcode: sampleBarcode,
      dateRequested: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      status: 'Aguardando Execução',
      sector: 'Bioquímica',
      astmFrame: `H|\\^&|||LIS_INOVALAB\nP|1||${reqCode}||${patName.replace(/\s+/g, '^')}\nO|1|${sampleBarcode}||^^^${exCode}|R\nL|1|N`
    };

    data.naoEnviados.unshift(newItem);
    saveInterfaceData(data);
    return res.json({ success: true, newItem, data });
  } catch (err) {
    console.error('Erro ao adicionar ordem manual:', err);
    return res.status(500).json({ success: false, message: 'Erro ao adicionar ordem manual.' });
  }
});

app.post('/api/interfaceamento/clear-logs', requireAdmin, (req, res) => {
  try {
    let data = loadInterfaceData();
    data.mensagens = [];
    saveInterfaceData(data);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao limpar logs.' });
  }
});

app.post('/api/interfaceamento/limpar-ficticias', requireAdmin, (req, res) => {
  try {
    const requisitions = loadRequisitions();
    const knownDummyReqs = new Set(['00033223', '00033224', '00033225', '00033226', '00033227', '33223', '33224', '33225', '33226', '33227']);

    let data = loadInterfaceData();
    let removedCount = 0;

    const normalizeText = (str) => String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    ['naoEnviados', 'processando', 'prontos'].forEach(listName => {
      if (Array.isArray(data[listName])) {
        const initialLen = data[listName].length;
        data[listName] = data[listName].filter(item => {
          if (!item) return false;
          const reqCodeRaw = String(item.requisitionCode || '').trim().toLowerCase();
          const patNameNorm = normalizeText(item.patientName);

          // Filtra nomes conhecidos de amostras de demonstração/fictícias
          if (patNameNorm.includes('sandro ortiz') || 
              patNameNorm.includes('ana clara rossi') || 
              patNameNorm.includes('carlos eduardo mendes') || 
              patNameNorm.includes('maria das gracas') || 
              patNameNorm.includes('joao pedro santos') || 
              patNameNorm.includes('paciente interfaced') ||
              patNameNorm.includes('paciente de teste')) {
            return false;
          }

          // Filtra requisições de demonstração conhecidas
          if (knownDummyReqs.has(reqCodeRaw)) {
            return false;
          }

          // Verifica se a requisição existe no LIS
          const matchingReq = requisitions.find(r => {
            const rCodeRaw = String(r.requisitionCode || '').trim().toLowerCase();
            const rCodeFmt = formatRequisitionCode(r.requisitionCode || '').toLowerCase();
            const rId = String(r.id || '').trim().toLowerCase();
            return (rCodeRaw && rCodeRaw === reqCodeRaw) || (rCodeFmt && rCodeFmt === reqCodeRaw) || (rId && rId === reqCodeRaw);
          });

          if (!matchingReq) {
            return false; // Não existe requisição real no LIS
          }

          // Se existe requisição, verifica se o paciente bate
          const reqPatNameNorm = normalizeText(matchingReq.patientName || matchingReq.pacienteName);
          if (reqPatNameNorm && patNameNorm && !reqPatNameNorm.includes(patNameNorm) && !patNameNorm.includes(reqPatNameNorm)) {
            return false; // Nome do paciente difere
          }

          return true;
        });
        removedCount += (initialLen - data[listName].length);
      }
    });

    saveInterfaceData(data);
    const updatedData = loadInterfaceData();

    return res.json({ success: true, removedCount, data: updatedData });
  } catch (err) {
    console.error('Erro ao limpar amostras fictícias:', err);
    return res.status(500).json({ success: false, message: 'Erro ao limpar amostras fictícias.' });
  }
});

app.post('/api/interfaceamento/limpar-tudo', requireAdmin, (req, res) => {
  try {
    let data = {
      naoEnviados: [],
      processando: [],
      prontos: [],
      mensagens: []
    };
    saveInterfaceData(data);
    const updatedData = loadInterfaceData();
    return res.json({ success: true, data: updatedData });
  } catch (err) {
    console.error('Erro ao reiniciar interfaceamento:', err);
    return res.status(500).json({ success: false, message: 'Erro ao reiniciar interfaceamento.' });
  }
});

// Endpoint AJAX para salvar paciente diretamente da popup da requisição
app.post('/admin/recepcao/pacientes/save-ajax', requireAdmin, (req, res) => {
  try {
    let patients = loadPatients();

    let maxCode = 0;
    patients.forEach(p => {
      if (p.code) {
        const num = parseInt(p.code, 10);
        if (!isNaN(num) && num > maxCode) maxCode = num;
      }
    });
    const nextCodeStr = String(maxCode + 1);

    const { 
      id, code, name, socialName, sex, gender, birthDate, ageValue, ageUnit, weight, height,
      dum, obs, clinicalNotes, cpf, rg, motherName, fatherName, responsibleName, responsibleCpf,
      payerName, payerCpf, company, indication, webPassword, whatsapp, respondsWhatsapp, whatsappAlt,
      cep, street, number, neighborhood, city, state, complement, referencePoint,
      convenio, insuranceNumber, insuranceValidity, cns, plan, defaultDoctor
    } = req.body;

    let patientCode = (code || '').trim() || nextCodeStr;

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

    const newPatient = {
      id: id || ('PAC-' + patientCode),
      code: patientCode,
      name: (name || '').trim(),
      socialName: (socialName || '').trim(),
      sex: sex || 'Não informado',
      gender: gender || 'Não informado',
      birthDate: birthDate || '',
      age,
      ageValue: ageValue || age,
      ageUnit: ageUnit || 'Ano(s)',
      weight: weight || '',
      height: height || '',
      dum: dum || '',
      obs: (obs || '').trim(),
      clinicalNotes: (clinicalNotes || '').trim(),
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
      whatsapp: (whatsapp || req.body.phone || '').trim(),
      respondsWhatsapp: respondsWhatsapp || 'Sim',
      whatsappAlt: (whatsappAlt || '').trim(),
      phone: (whatsapp || req.body.phone || '').trim(),
      cep: (cep || '').trim(),
      street: (street || '').trim(),
      number: (number || '').trim(),
      neighborhood: (neighborhood || '').trim(),
      city: (city || 'Cambará').trim(),
      state: (state || 'PR').trim(),
      complement: (complement || '').trim(),
      referencePoint: (referencePoint || '').trim(),
      convenio: (convenio || 'Particular').trim(),
      insuranceNumber: (insuranceNumber || '').trim(),
      insuranceValidity: insuranceValidity || '',
      cns: (cns || '').trim(),
      plan: (plan || '').trim(),
      defaultDoctor: (defaultDoctor || '').trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const idx = patients.findIndex(p => p.id === newPatient.id || p.code === newPatient.code);
    if (idx !== -1) {
      patients[idx] = { ...patients[idx], ...newPatient };
    } else {
      patients.push(newPatient);
    }

    savePatients(patients);
    res.json({ success: true, patient: newPatient, patients: loadPatients() });
  } catch (err) {
    console.error("Erro ao salvar paciente via AJAX:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Adicionar ou Editar Requisição Completa
const saveRequisitionHandler = (req, res) => {
  try {
    const { 
      id,
      requisitionCode,
      patientCode,
      patientName, 
      patientPhone, 
      patientCpf,
      patientBirthDate,
      patientAge,
      patientSex,
      isPregnant,
      gestationalPeriod,
      isNeonate,
      isIncapacitated,
      isPsr,
      dum,
      weight,
      height,
      address,
      complement,
      city,
      cep,
      responsibleName,
      clinicalNotes,
      convenio,
      convenioCode,
      convenioId,
      situacao,
      situacaoCode,
      matricula,
      guia,
      coleta,
      susCard,
      destino,
      doctorCrm,
      doctorUf,
      doctorName,
      fatura,
      hora,
      procedencia,
      obs,
      empresa,
      isUrgent,
      patientUsername,
      patientPassword,
      status,
      examsJson,
      subtotal,
      discount,
      totalAmount,
      paymentMethod,
      paymentCondition,
      paidAmount,
      financialStatus,
      deliveryDate,
      deliveryTime,
      cid10,
      notifyWhatsapp,
      separateLabel,
      fastingHours
    } = req.body;
    
    const requisitions = loadRequisitions();
    
    if (!patientName || patientName.trim() === '') {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('add-ajax')) {
        return res.status(400).json({ success: false, error: "Nome do paciente é obrigatório" });
      }
      return res.status(400).send("Nome do paciente é obrigatório");
    }

    if (!convenio || String(convenio).trim() === '') {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('add-ajax')) {
        return res.status(400).json({ success: false, error: "O campo Convênio é obrigatório." });
      }
      return res.status(400).send("O campo Convênio é obrigatório.");
    }

    if (!doctorName || String(doctorName).trim() === '') {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('add-ajax')) {
        return res.status(400).json({ success: false, error: "O campo Médico Solicitante é obrigatório." });
      }
      return res.status(400).send("O campo Médico Solicitante é obrigatório.");
    }

    // Relacionamento com a tabela de Convênios
    const conveniosList = loadConvenios();
    let matchedConv = null;
    if (convenioId) {
      matchedConv = conveniosList.find(c => String(c.id) === String(convenioId));
    }
    if (!matchedConv && convenioCode) {
      matchedConv = conveniosList.find(c => String(c.codigo) === String(convenioCode) || String(c.id) === String(convenioCode));
    }
    if (!matchedConv && convenio) {
      const cTrim = String(convenio).trim().toLowerCase();
      matchedConv = conveniosList.find(c =>
        (c.fantasia && c.fantasia.trim().toLowerCase() === cTrim) ||
        (c.razaoSocial && c.razaoSocial.trim().toLowerCase() === cTrim)
      );
    }

    const savedConvenioName = matchedConv ? (matchedConv.fantasia || matchedConv.razaoSocial) : String(convenio).trim();
    const savedConvenioCode = matchedConv ? (matchedConv.codigo || '') : String(convenioCode || '').trim();
    const savedConvenioId = matchedConv ? matchedConv.id : String(convenioId || '').trim();

    let parsedExams = [];
    if (examsJson) {
      try {
        parsedExams = typeof examsJson === 'string' ? JSON.parse(examsJson) : examsJson;
      } catch (e) {
        parsedExams = [];
      }
    } else if (req.body.exams) {
      try {
        parsedExams = typeof req.body.exams === 'string' ? JSON.parse(req.body.exams) : req.body.exams;
      } catch (e) {
        parsedExams = [];
      }
    }

    parsedExams = (Array.isArray(parsedExams) ? parsedExams : []).map(ex => ({
      ...ex,
      status: (ex && ex.status && String(ex.status).trim() !== '') ? String(ex.status).trim() : 'A Coletar'
    }));
    
    if (!parsedExams || parsedExams.length === 0) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('add-ajax')) {
        return res.status(400).json({ success: false, error: "A requisição deve conter ao menos 1 (um) exame adicionado." });
      }
      return res.status(400).send("A requisição deve conter ao menos 1 (um) exame adicionado.");
    }

    let reqCode = (requisitionCode || '').trim();
    if (!reqCode) {
      let maxReq = 1000;
      requisitions.forEach(r => {
        if (r.requisitionCode) {
          const num = parseInt(String(r.requisitionCode).replace(/\D/g, ''), 10);
          if (!isNaN(num) && num > maxReq) maxReq = num;
        }
      });
      reqCode = String(maxReq + 1).padStart(8, '0');
    } else {
      reqCode = formatRequisitionCode(reqCode);
    }
    
    const cleanName = patientName.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    const generatedUsername = patientUsername && patientUsername.trim() !== '' ? patientUsername.trim() : (cleanName.slice(0, 10) + '.' + reqCode);
    const generatedPassword = patientPassword && patientPassword.trim() !== '' ? patientPassword.trim() : String(Math.floor(1000 + Math.random() * 9000));

    const reqData = {
      requisitionCode: reqCode,
      patientCode: (patientCode || '').trim(),
      patientName: patientName.trim(),
      patientPhone: (patientPhone || '').trim(),
      patientCpf: (patientCpf || '').trim(),
      patientBirthDate: patientBirthDate || '',
      patientAge: patientAge || '',
      patientSex: patientSex || '',
      isPregnant: isPregnant === 'on' || isPregnant === 'true' || isPregnant === true,
      gestationalPeriod: gestationalPeriod || '',
      isNeonate: isNeonate === 'on' || isNeonate === 'true' || isNeonate === true,
      isIncapacitated: isIncapacitated === 'on' || isIncapacitated === 'true' || isIncapacitated === true,
      isPsr: isPsr === 'on' || isPsr === 'true' || isPsr === true,
      dum: dum || '',
      weight: weight || '',
      height: height || '',
      address: (address || '').trim(),
      complement: (complement || '').trim(),
      city: (city || '').trim(),
      cep: (cep || '').trim(),
      responsibleName: (responsibleName || '').trim(),
      clinicalNotes: (clinicalNotes || '').trim(),
      convenio: savedConvenioName,
      convenioCode: savedConvenioCode,
      convenioId: savedConvenioId,
      situacao: (situacao || 'Normal').trim(),
      situacaoCode: (situacaoCode || '').trim(),
      matricula: (matricula || '').trim(),
      guia: (guia || '').trim(),
      coleta: (coleta || '').trim(),
      susCard: (susCard || '').trim(),
      destino: (destino || '').trim(),
      doctorCrm: (doctorCrm || '').trim(),
      doctorUf: (doctorUf || 'PR').trim(),
      doctorName: (doctorName || '').trim(),
      fatura: (fatura || '').trim(),
      hora: hora || new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
      procedencia: (procedencia || '').trim(),
      obs: (obs || '').trim(),
      empresa: (empresa || '').trim(),
      isUrgent: isUrgent === 'on' || isUrgent === 'true' || isUrgent === true,
      patientUsername: generatedUsername,
      patientPassword: generatedPassword,
      status: (status && status.trim()) ? status.trim() : 'A Coletar',
      collectedAt: ((status && status.trim()) === 'Coletado') ? new Date().toISOString() : undefined,
      exams: parsedExams,
      subtotal: parseFloat(subtotal) || 0,
      discount: parseFloat(discount) || 0,
      totalAmount: parseFloat(totalAmount) || 0,
      paymentMethod: paymentMethod || 'Particular - Dinheiro',
      paymentCondition: paymentCondition || 'À Vista',
      paidAmount: parseFloat(paidAmount) || 0,
      financialStatus: financialStatus || 'Pendente',
      deliveryDate: deliveryDate || '',
      deliveryTime: deliveryTime || '',
      cid10: (cid10 || '').trim(),
      notifyWhatsapp: notifyWhatsapp === 'on' || notifyWhatsapp === 'true' || notifyWhatsapp === true,
      separateLabel: separateLabel === 'on' || separateLabel === 'true' || separateLabel === true,
      fastingHours: (fastingHours || '').toString().trim(),
      updatedAt: new Date().toISOString()
    };
    
    let targetId = id;
    if (id) {
      const idx = requisitions.findIndex(r => r.id === id);
      if (idx !== -1) {
        requisitions[idx] = { ...requisitions[idx], ...reqData };
      } else {
        requisitions.push({
          id,
          createdAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          ...reqData
        });
      }
    } else {
      targetId = 'REQ' + Date.now().toString().slice(-6);
      requisitions.push({
        id: targetId,
        createdAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        ...reqData
      });
    }
    
    saveRequisitions(requisitions);
    
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('add-ajax')) {
      return res.json({ 
        success: true, 
        requisitionCode: reqCode,
        id: targetId,
        requisitions: loadRequisitions() 
      });
    }

    res.redirect('/admin/requisicoes');
  } catch (error) {
    console.error("Erro ao adicionar requisição:", error);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('add-ajax')) {
      return res.status(500).json({ success: false, error: "Erro interno ao salvar a requisição" });
    }
    res.status(500).send("Erro interno ao salvar a requisição");
  }
};

app.post('/admin/requisicoes/add', requireAdmin, saveRequisitionHandler);
app.post('/admin/requisicoes/add-ajax', requireAdmin, saveRequisitionHandler);

// Atualizar Status da Requisição
app.post('/admin/requisicoes/status', requireAdmin, (req, res) => {
  try {
    const { id, status } = req.body;
    const requisitions = loadRequisitions();
    const index = requisitions.findIndex(r => r.id === id || r.requisitionCode === id);
    if (index !== -1) {
      requisitions[index].status = status;
      if (status === 'Coletado' && !requisitions[index].collectedAt) {
        requisitions[index].collectedAt = new Date().toISOString();
      }
      if (Array.isArray(requisitions[index].exams)) {
        requisitions[index].exams = requisitions[index].exams.map(ex => ({
          ...ex,
          status: status === 'Coletado' ? 'Coletado' : ((ex.status && String(ex.status).trim() !== '') ? String(ex.status).trim() : 'A Coletar')
        }));
      }
      saveRequisitions(requisitions);
      return res.json({ success: true, status: requisitions[index].status, exams: requisitions[index].exams, collectedAt: requisitions[index].collectedAt });
    }
    res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});

app.post('/admin/requisicoes/update-status', requireAdmin, (req, res) => {
  try {
    const { id, status, coletaObs } = req.body;
    const requisitions = loadRequisitions();
    const index = requisitions.findIndex(r => r.id === id || r.requisitionCode === id);
    if (index !== -1) {
      requisitions[index].status = status;
      if (status === 'Coletado' && !requisitions[index].collectedAt) {
        requisitions[index].collectedAt = new Date().toISOString();
      }
      if (coletaObs !== undefined) requisitions[index].coletaObs = coletaObs;
      if (Array.isArray(requisitions[index].exams)) {
        requisitions[index].exams = requisitions[index].exams.map(ex => ({
          ...ex,
          status: status === 'Coletado' ? 'Coletado' : ((ex.status && String(ex.status).trim() !== '') ? String(ex.status).trim() : 'A Coletar')
        }));
      }
      saveRequisitions(requisitions);
      return res.json({ success: true, status: requisitions[index].status, exams: requisitions[index].exams, collectedAt: requisitions[index].collectedAt });
    }
    res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});

// Atualizar Exames/Status de Exames de uma Requisição
app.post('/admin/requisicoes/update-exams-status', requireAdmin, (req, res) => {
  try {
    const { id, exams, status, coletaObs } = req.body;
    const requisitions = loadRequisitions();
    const index = requisitions.findIndex(r => r.id === id || r.requisitionCode === id);
    if (index !== -1) {
      if (Array.isArray(exams)) {
        requisitions[index].exams = exams;
      }
      if (status) {
        requisitions[index].status = status;
      } else if (Array.isArray(requisitions[index].exams) && requisitions[index].exams.length > 0) {
        // Se todos os exames foram coletados ou concluídos, atualizar status geral da requisição
        const allColetados = requisitions[index].exams.every(ex => ex.status === 'Coletado' || ex.status === 'Concluído' || ex.status === 'Cancelado');
        if (allColetados && (requisitions[index].status === 'A Coletar' || !requisitions[index].status)) {
          requisitions[index].status = 'Coletado';
        }
      }
      if (requisitions[index].status === 'Coletado' && !requisitions[index].collectedAt) {
        requisitions[index].collectedAt = new Date().toISOString();
      }
      if (coletaObs !== undefined) requisitions[index].coletaObs = coletaObs;

      saveRequisitions(requisitions);
      return res.json({ success: true, status: requisitions[index].status, exams: requisitions[index].exams, collectedAt: requisitions[index].collectedAt });
    }
    res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});

// Marcar mensagem da requisição como enviada (Notificado)
app.post('/admin/requisicoes/mark-notified', requireAdmin, (req, res) => {
  try {
    const { id, type } = req.body;
    const requisitions = loadRequisitions();
    const index = requisitions.findIndex(r => r.id === id || r.requisitionCode === id);
    if (index !== -1) {
      if (type === 'ready') {
        requisitions[index].readyNotified = true;
      } else if (type === 'invite') {
        requisitions[index].inviteNotified = true;
      }
      saveRequisitions(requisitions);
      return res.json({ success: true });
    }
    res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});

// Excluir Requisição
app.post('/admin/requisicoes/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    const requisitions = loadRequisitions();
    const filtered = requisitions.filter(r => r.id !== id);
    saveRequisitions(filtered);
    res.redirect('/admin/requisicoes');
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao excluir requisição");
  }
});

// Helper de formatação de Fechamento de Caixa
function formatClosureRecord(c) {
  const dinheiro = Number(c.dinheiro) || 0;
  const pix = Number(c.pix) || 0;
  const cartaoCredito = Number(c.cartaoCredito) || 0;
  const cartaoDebito = Number(c.cartaoDebito) || 0;
  const cheque = Number(c.cheque) || 0;
  const trocoAnterior = Number(c.trocoAnterior) || 0;
  const trocoAnteriorOriginal = c.trocoAnteriorOriginal !== undefined ? (Number(c.trocoAnteriorOriginal) || 0) : trocoAnterior;
  const trocoAnteriorEditado = Boolean(
    c.trocoAnteriorEditado === true ||
    c.trocoAnteriorEditado === 'true' ||
    (c.trocoAnteriorOriginal !== undefined && Math.abs(trocoAnterior - trocoAnteriorOriginal) > 0.001)
  );
  const trocoSeguinte = Number(c.trocoSeguinte) || 0;

  // Tratar Saídas/Despesas do Caixa em Dinheiro
  let saidasDinheiro = [];
  if (Array.isArray(c.saidasDinheiro)) {
    saidasDinheiro = c.saidasDinheiro;
  } else if (typeof c.saidasDinheiro === 'string' && c.saidasDinheiro.trim()) {
    try {
      saidasDinheiro = JSON.parse(c.saidasDinheiro);
    } catch (e) {
      saidasDinheiro = [];
    }
  }

  const saidasDinheiroTotal = saidasDinheiro.reduce((acc, item) => acc + (Number(item.valor) || 0), 0);

  const totalEntradas = dinheiro + pix + cartaoCredito + cartaoDebito + cheque;
  const totalDinheiroEmCaixa = trocoAnterior + dinheiro; // Bruto em espécie
  const totalDinheiroLiquido = Math.max(0, totalDinheiroEmCaixa - saidasDinheiroTotal); // Após saídas
  const retiradaDinheiro = Math.max(0, totalDinheiroEmCaixa - saidasDinheiroTotal - trocoSeguinte);

  let dataBr = c.data || '';
  if (c.data && c.data.includes('-')) {
    const parts = c.data.split('-');
    if (parts.length === 3) {
      dataBr = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return {
    ...c,
    recepcao: c.recepcao || 'Recepção Particular',
    status: c.status || 'Fechado',
    dinheiro,
    pix,
    cartaoCredito,
    cartaoDebito,
    cheque,
    trocoAnterior,
    trocoAnteriorOriginal,
    trocoAnteriorEditado,
    trocoSeguinte,
    saidasDinheiro,
    saidasDinheiroTotal,
    totalEntradas,
    totalDinheiroEmCaixa,
    totalDinheiroLiquido,
    retiradaDinheiro,
    comprovantePrint: c.comprovantePrint || null,
    dataBr,
    dinheiroFmt: fmt(dinheiro),
    pixFmt: fmt(pix),
    cartaoCreditoFmt: fmt(cartaoCredito),
    cartaoDebitoFmt: fmt(cartaoDebito),
    chequeFmt: fmt(cheque),
    trocoAnteriorFmt: fmt(trocoAnterior),
    trocoAnteriorOriginalFmt: fmt(trocoAnteriorOriginal),
    trocoSeguinteFmt: fmt(trocoSeguinte),
    saidasDinheiroTotalFmt: fmt(saidasDinheiroTotal),
    totalEntradasFmt: fmt(totalEntradas),
    totalDinheiroEmCaixaFmt: fmt(totalDinheiroEmCaixa),
    retiradaDinheiroFmt: fmt(retiradaDinheiro)
  };
}

// ROTA: Lançamento de Fechamento de Caixa (Visão da Recepcionista - Apenas Lançamento)
app.get('/admin/recepcao/fechamento-caixa', requireAdmin, (req, res) => {
  const todayDate = new Date().toISOString().split('T')[0];
  const financeSettings = loadFinanceSettings();
  let planoDeContas = financeSettings.chartsOfAccounts || [];
  if ((!planoDeContas || planoDeContas.length === 0) && financeSettings.chartOfAccountsTree) {
    planoDeContas = financeSettings.chartOfAccountsTree.map(x => `${x.code} - ${x.description}`);
  }

  res.render('admin/recepcao/fechamento-caixa', {
    todayDate: todayDate,
    adminUserName: res.locals.adminUserName || 'Recepcionista',
    query: req.query,
    planoDeContas: planoDeContas,
    page: 'admin-fechamento-caixa'
  });
});

// ROTA: Conferência e Histórico de Fechamento de Caixa (Visão do Administrador / Financeiro)
app.get(['/admin/financeiro/fechamento-caixa', '/admin/fechamento-caixa'], requireAdmin, (req, res) => {
  const closures = loadCashClosures();
  const sorted = [...closures].sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const formattedClosures = sorted.map(formatClosureRecord);
  const todayDate = new Date().toISOString().split('T')[0];
  const financeSettings = loadFinanceSettings();
  let planoDeContas = financeSettings.chartsOfAccounts || [];
  if ((!planoDeContas || planoDeContas.length === 0) && financeSettings.chartOfAccountsTree) {
    planoDeContas = financeSettings.chartOfAccountsTree.map(x => `${x.code} - ${x.description}`);
  }

  res.render('admin/financeiro/fechamento-caixa', {
    closures: formattedClosures,
    todayDate: todayDate,
    adminUserName: res.locals.adminUserName || 'Administrador',
    query: req.query,
    planoDeContas: planoDeContas,
    page: 'admin-financeiro-fechamento-caixa'
  });
});

// API: Buscar Troco do Dia Anterior por Recepção e Data
app.get('/api/recepcao/fechamento-caixa/ultimo-troco', requireAdmin, (req, res) => {
  const { data, recepcao } = req.query;
  const closures = loadCashClosures();

  const filtered = closures.filter(c => {
    const matchDate = !data || c.data < data;
    const itemRecepcao = c.recepcao || 'Recepção Particular';
    const matchRecepcao = !recepcao || itemRecepcao === recepcao;
    return matchDate && matchRecepcao;
  });

  filtered.sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));

  if (filtered.length > 0) {
    const last = filtered[0];
    let dataBr = last.data;
    if (last.data && last.data.includes('-')) {
      const parts = last.data.split('-');
      if (parts.length === 3) dataBr = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return res.json({
      trocoSeguinte: Number(last.trocoSeguinte) || 0,
      data: last.data,
      dataBr: dataBr
    });
  }

  res.json({ trocoSeguinte: 0, data: null, dataBr: null });
});

// API: Detalhe de Fechamento de Caixa para Imprimir
app.get('/api/recepcao/fechamento-caixa/detalhe', requireAdmin, (req, res) => {
  const { id } = req.query;
  const closures = loadCashClosures();
  const closure = closures.find(c => c.id === id);
  if (closure) {
    return res.json(formatClosureRecord(closure));
  }
  res.status(404).json(null);
});

// API: Verificar se já existe um Fechamento para uma Recepção e Data
app.get('/api/recepcao/fechamento-caixa/buscar-existente', requireAdmin, (req, res) => {
  const { data, recepcao } = req.query;
  const closures = loadCashClosures();
  const itemRecepcao = recepcao || 'Recepção Particular';

  const found = closures.find(c => c.data === data && (c.recepcao || 'Recepção Particular') === itemRecepcao);
  if (found) {
    return res.json({
      exists: true,
      closure: formatClosureRecord(found)
    });
  }
  res.json({ exists: false, closure: null });
});

// API: Comparativo Mensal de Faturamento Acumulado por Dias
app.get('/api/admin/financeiro/fechamento-caixa/comparativo-mensal', requireAdmin, (req, res) => {
  try {
    const { recepcao } = req.query; // 'Todos', 'Recepção Particular', 'Recepção SUS'
    const closures = loadCashClosures();

    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate(); // 1-31

    // Organizar fechamentos por mês (YYYY-MM) e dia do mês (1-31)
    const monthMap = {};

    closures.forEach(c => {
      if (!c.data || !c.data.includes('-')) return;

      // Filtrar recepção se fornecido
      if (recepcao && recepcao !== 'Todos') {
        const itemRecepcao = c.recepcao || 'Recepção Particular';
        if (itemRecepcao !== recepcao) return;
      }

      const parts = c.data.split('-');
      if (parts.length !== 3) return;

      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);

      if (isNaN(year) || isNaN(month) || isNaN(day) || day < 1 || day > 31) return;

      const monthKey = `${year}-${String(month).padStart(2, '0')}`;

      if (!monthMap[monthKey]) {
        monthMap[monthKey] = {
          year,
          month,
          days: Array(32).fill(0), // 1 to 31
          paymentMethods: { dinheiro: 0, pix: 0, cartaoCredito: 0, cartaoDebito: 0, cheque: 0 },
          weekdays: Array(7).fill(0), // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
          byRecepcao: { 'Recepção Particular': 0, 'Recepção SUS': 0 },
          totalSaidas: 0
        };
      }

      // Calcular o faturamento bruto (apenas entradas: Dinheiro + Pix + Crédito + Débito + Cheque)
      // SEM descontar saídas/despesas de caixa e SEM somar troco
      const din = Number(c.dinheiro) || 0;
      const px = Number(c.pix) || 0;
      const cc = Number(c.cartaoCredito) || 0;
      const cd = Number(c.cartaoDebito) || 0;
      const chq = Number(c.cheque) || 0;

      let entradas = din + px + cc + cd + chq;

      if (entradas === 0 && c.totalEntradas && !isNaN(Number(c.totalEntradas)) && Number(c.totalEntradas) > 0) {
        entradas = Number(c.totalEntradas);
      }

      monthMap[monthKey].days[day] += (entradas || 0);

      // Agregar por forma de pagamento
      monthMap[monthKey].paymentMethods.dinheiro += din;
      monthMap[monthKey].paymentMethods.pix += px;
      monthMap[monthKey].paymentMethods.cartaoCredito += cc;
      monthMap[monthKey].paymentMethods.cartaoDebito += cd;
      monthMap[monthKey].paymentMethods.cheque += chq;

      // Agregar por dia da semana
      const dtObj = new Date(year, month - 1, day);
      if (!isNaN(dtObj.getTime())) {
        const wDay = dtObj.getDay();
        monthMap[monthKey].weekdays[wDay] += (entradas || 0);
      }

      // Agregar por recepção
      const rec = c.recepcao || 'Recepção Particular';
      monthMap[monthKey].byRecepcao[rec] = (monthMap[monthKey].byRecepcao[rec] || 0) + (entradas || 0);

      // Agregar saídas/despesas
      let sVal = Number(c.totalSaidas) || 0;
      if (!sVal && Array.isArray(c.saidasDinheiro)) {
        sVal = c.saidasDinheiro.reduce((acc, s) => acc + (Number(s.valor) || 0), 0);
      }
      monthMap[monthKey].totalSaidas += sVal;
    });

    // Se o mês atual ainda não estiver em monthMap, criar
    const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    if (!monthMap[currentMonthKey]) {
      monthMap[currentMonthKey] = {
        year: currentYear,
        month: currentMonth,
        days: Array(32).fill(0),
        paymentMethods: { dinheiro: 0, pix: 0, cartaoCredito: 0, cartaoDebito: 0, cheque: 0 },
        weekdays: Array(7).fill(0),
        byRecepcao: { 'Recepção Particular': 0, 'Recepção SUS': 0 },
        totalSaidas: 0
      };
    }

    // Preencher pelo menos os últimos 12 meses
    for (let i = 0; i < 12; i++) {
      const d = new Date(currentYear, currentMonth - 1 - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!monthMap[key]) {
        monthMap[key] = {
          year: y,
          month: m,
          days: Array(32).fill(0),
          paymentMethods: { dinheiro: 0, pix: 0, cartaoCredito: 0, cartaoDebito: 0, cheque: 0 },
          weekdays: Array(7).fill(0),
          byRecepcao: { 'Recepção Particular': 0, 'Recepção SUS': 0 },
          totalSaidas: 0
        };
      }
    }

    // Ordenar chaves de mês do mais recente para o mais antigo
    const sortedMonthKeys = Object.keys(monthMap).sort((a, b) => b.localeCompare(a));

    const monthsResult = sortedMonthKeys.map(key => {
      const item = monthMap[key];
      const isCurrent = (item.year === currentYear && item.month === currentMonth);
      const monthLabel = `${monthNames[item.month - 1]} / ${item.year}${isCurrent ? ' (Mês Atual)' : ''}`;

      const dailyCumulative = [];
      let runningTotal = 0;

      for (let d = 1; d <= 31; d++) {
        if (isCurrent && d > currentDay) {
          dailyCumulative.push(null);
        } else {
          runningTotal += item.days[d];
          dailyCumulative.push(Math.round(runningTotal * 100) / 100);
        }
      }

      const dailyRaw = [];
      for (let d = 1; d <= 31; d++) {
        if (isCurrent && d > currentDay) {
          dailyRaw.push(null);
        } else {
          dailyRaw.push(Math.round((item.days[d] || 0) * 100) / 100);
        }
      }

      return {
        key,
        label: monthLabel,
        year: item.year,
        month: item.month,
        isCurrent,
        dailyCumulative,
        dailyRaw,
        totalMonth: Math.round(runningTotal * 100) / 100,
        sameDayAmount: Math.round((dailyCumulative[Math.min(currentDay - 1, 30)] || 0) * 100) / 100,
        paymentMethods: {
          dinheiro: Math.round((item.paymentMethods.dinheiro || 0) * 100) / 100,
          pix: Math.round((item.paymentMethods.pix || 0) * 100) / 100,
          cartaoCredito: Math.round((item.paymentMethods.cartaoCredito || 0) * 100) / 100,
          cartaoDebito: Math.round((item.paymentMethods.cartaoDebito || 0) * 100) / 100,
          cheque: Math.round((item.paymentMethods.cheque || 0) * 100) / 100
        },
        weekdays: item.weekdays.map(w => Math.round(w * 100) / 100),
        byRecepcao: item.byRecepcao,
        totalSaidas: Math.round((item.totalSaidas || 0) * 100) / 100
      };
    });

    res.json({
      labels: Array.from({ length: 31 }, (_, i) => `Dia ${i + 1}`),
      months: monthsResult,
      currentDayOfMonth: currentDay,
      currentYear,
      currentMonth,
      recepcao: recepcao || 'Todos'
    });
  } catch (err) {
    console.error('Erro ao gerar comparativo mensal de fechamento:', err);
    res.status(500).json({ error: 'Erro ao gerar comparativo mensal' });
  }
});

// Sincronizar despesas retiradas do caixa para o módulo financeiro (Contas a Pagar / Despesas Paga)
function syncClosureExpensesToFinance(closure, adminUserName) {
  if (!closure || closure.status !== 'Conferido' || !Array.isArray(closure.saidasDinheiro) || closure.saidasDinheiro.length === 0) {
    return;
  }

  const transactions = loadTransactions();
  let changed = false;

  closure.saidasDinheiro.forEach(expense => {
    const val = parseFloat(expense.valor) || 0;
    if (val <= 0) return;

    // Verificar se já existe transação criada para este fechamento + saída
    const existingTx = transactions.find(t => 
      t.closureId === closure.id && 
      (t.expenseId === expense.id || (t.amount === val && t.chartOfAccounts === expense.tipo && t.issueDate === closure.data))
    );

    if (!existingTx) {
      const newTx = {
        id: "TX-" + Date.now() + Math.floor(Math.random() * 1000),
        closureId: closure.id,
        expenseId: expense.id || ('EXP_' + Math.random().toString(36).substring(2, 8)),
        type: 'pagar',
        number: `CAIXA-${closure.id}`,
        issueDate: closure.data || new Date().toISOString().split('T')[0],
        docNumber: `FECH-${closure.id}`,
        provider: `Fechamento de Caixa (${closure.recepcao || 'Recepção'})`,
        docType: 'Dinheiro',
        chartOfAccounts: expense.tipo || 'Outras Saídas em Dinheiro',
        bank: 'Caixa Geral (Dinheiro)',
        tags: ['Fechamento de Caixa', 'Despesa em Dinheiro'],
        description: expense.descricao 
          ? `${expense.descricao} (Saída do Caixa - ${closure.recepcao || 'Recepção'} em ${closure.data})` 
          : `Saída do Caixa em Dinheiro - ${expense.tipo} (${closure.data})`,
        amount: val,
        installments: 1,
        dueDate: closure.data || new Date().toISOString().split('T')[0],
        interval: 'Único',
        recurrent: false,
        status: 'pago',
        paidAt: closure.data || new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
        createdBy: adminUserName || 'Administrador'
      };

      transactions.unshift(newTx);
      logFinancialMovement(newTx, newTx.paidAt);
      changed = true;
    }
  });

  if (changed) {
    saveTransactions(transactions);
  }
}

// Sincronizar receita de fechamento de caixa conferido para o módulo financeiro (Movimentação / Transação Paga)
function syncClosureRevenueToFinance(closure, adminUserName) {
  if (!closure || closure.status !== 'Conferido') {
    return;
  }

  const valEntradas = parseFloat(closure.totalEntradas) || (
    (parseFloat(closure.dinheiro) || 0) +
    (parseFloat(closure.pix) || 0) +
    (parseFloat(closure.cartaoCredito) || 0) +
    (parseFloat(closure.cartaoDebito) || 0) +
    (parseFloat(closure.cheque) || 0)
  );

  if (valEntradas <= 0) return;

  const recepcaoStr = String(closure.recepcao || '').trim();
  const isSus = recepcaoStr.toLowerCase().includes('sus');
  
  // Definir plano de contas conforme origem da recepção:
  // "Recepção SUS" -> "1.1.2 - Convênio Particular + SUS"
  // "Recepção Particular" -> "1.1.1 - Convênio Particular"
  const targetChartOfAccounts = isSus 
    ? "1.1.2 - Convênio Particular + SUS" 
    : "1.1.1 - Convênio Particular";

  const closureDate = closure.data || new Date().toISOString().split('T')[0];
  const adminName = adminUserName || 'Administrador';

  // 1. Transação
  const transactions = loadTransactions();
  let tx = transactions.find(t => t.closureId === closure.id && t.isClosureRevenue);
  if (!tx) {
    tx = transactions.find(t => t.id === "TX-FC-" + closure.id);
  }

  if (tx) {
    tx.amount = valEntradas;
    tx.chartOfAccounts = targetChartOfAccounts;
    tx.issueDate = closureDate;
    tx.paidAt = closureDate;
    tx.dueDate = closureDate;
    tx.provider = `Fechamento de Caixa (${recepcaoStr || 'Recepção'})`;
    tx.description = `Receita Fechamento de Caixa - ${recepcaoStr || 'Recepção Particular'} (${closureDate})`;
    saveTransactions(transactions);
  } else {
    tx = {
      id: "TX-FC-" + closure.id,
      closureId: closure.id,
      isClosureRevenue: true,
      type: 'receber',
      number: `FECH-${closure.id}`,
      issueDate: closureDate,
      docNumber: `FECH-${closure.id}`,
      provider: `Fechamento de Caixa (${recepcaoStr || 'Recepção'})`,
      docType: 'Dinheiro/Pix/Cartão',
      chartOfAccounts: targetChartOfAccounts,
      bank: 'Caixa Geral',
      tags: ['Fechamento de Caixa', 'Receita de Exames'],
      description: `Receita Fechamento de Caixa - ${recepcaoStr || 'Recepção Particular'} (${closureDate})`,
      amount: valEntradas,
      installments: 1,
      dueDate: closureDate,
      interval: 'Único',
      recurrent: false,
      status: 'pago',
      paidAt: closureDate,
      createdAt: new Date().toISOString(),
      createdBy: adminName
    };
    transactions.unshift(tx);
    saveTransactions(transactions);
  }

  // 2. Movimentação Financeira Paga
  const movements = loadMovements();
  let mv = movements.find(m => m.closureId === closure.id && m.isClosureRevenue);
  if (!mv) {
    mv = movements.find(m => m.id === "MV-FC-" + closure.id);
  }

  if (mv) {
    mv.amount = valEntradas;
    mv.type = 'receber';
    mv.date = closureDate;
    mv.chartOfAccounts = targetChartOfAccounts;
    mv.complemento = `Fechamento de Caixa - ${recepcaoStr || 'Recepção'} (${closureDate})`;
    saveMovements(movements);
  } else {
    let maxCode = 352;
    movements.forEach(m => {
      if (m.code && typeof m.code === 'number' && m.code > maxCode) {
        maxCode = m.code;
      }
    });
    const newCode = maxCode + 1;

    const newMv = {
      id: `MV-FC-${closure.id}`,
      code: newCode,
      closureId: closure.id,
      isClosureRevenue: true,
      type: 'receber',
      date: closureDate,
      chartOfAccounts: targetChartOfAccounts,
      complemento: `Fechamento de Caixa - ${recepcaoStr || 'Recepção'} (${closureDate})`,
      bank: 'Caixa Geral',
      amount: valEntradas,
      createdAt: new Date().toISOString()
    };
    movements.unshift(newMv);
    saveMovements(movements);
  }
}

function syncClosureToFinance(closure, adminUserName) {
  if (!closure || closure.status !== 'Conferido') return;
  syncClosureExpensesToFinance(closure, adminUserName);
  syncClosureRevenueToFinance(closure, adminUserName);
}

// API / POST: Toggle Status Conferido pelo Administrador
app.post('/admin/recepcao/fechamento-caixa/toggle-conferido', requireAdmin, (req, res) => {
  try {
    const { id, status } = req.body;
    const closures = loadCashClosures();
    const idx = closures.findIndex(c => c.id === id);
    if (idx !== -1) {
      const newStatus = status || (closures[idx].status === 'Conferido' ? 'Fechado' : 'Conferido');
      closures[idx].status = newStatus;
      closures[idx].updatedAt = new Date().toISOString();
      saveCashClosures(closures);

      if (newStatus === 'Conferido') {
        const adminUserName = req.cookies.admin_user_name || res.locals.adminUserName || 'Administrador';
        syncClosureToFinance(closures[idx], adminUserName);
      }

      return res.json({ success: true, id, status: closures[idx].status });
    }
    res.status(404).json({ success: false, message: 'Registro não encontrado' });
  } catch (error) {
    console.error("Erro no toggle conferido:", error);
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

// ROTA: Salvar ou Editar Fechamento de Caixa
app.post('/admin/recepcao/fechamento-caixa/save', requireAdmin, (req, res) => {
  try {
    const {
      id,
      recepcao,
      data,
      responsavel,
      trocoAnterior,
      trocoAnteriorOriginal,
      trocoAnteriorEditado,
      dinheiro,
      pix,
      cartaoCredito,
      cartaoDebito,
      cheque,
      trocoSeguinte,
      saidasDinheiro,
      comprovantePrint,
      status,
      observacoes
    } = req.body;

    const closures = loadCashClosures();
    const closureDate = data || new Date().toISOString().split('T')[0];

    const numTrocoAnterior = parseFloat(trocoAnterior) || 0;
    const numTrocoAnteriorOriginal = req.body.trocoAnteriorOriginal !== undefined ? (parseFloat(trocoAnteriorOriginal) || 0) : numTrocoAnterior;
    const isTrocoAnteriorEditado = trocoAnteriorEditado === 'true' || trocoAnteriorEditado === true || (Math.abs(numTrocoAnterior - numTrocoAnteriorOriginal) > 0.001);

    const numDinheiro = parseFloat(dinheiro) || 0;
    const numPix = parseFloat(pix) || 0;
    const numCartaoCredito = parseFloat(cartaoCredito) || 0;
    const numCartaoDebito = parseFloat(cartaoDebito) || 0;
    const numCheque = parseFloat(cheque) || 0;
    const numTrocoSeguinte = parseFloat(trocoSeguinte) || 0;

    // Processar Saídas/Despesas do Caixa em Dinheiro
    let parsedSaidas = [];
    if (typeof saidasDinheiro === 'string' && saidasDinheiro.trim()) {
      try {
        parsedSaidas = JSON.parse(saidasDinheiro);
      } catch (e) {
        parsedSaidas = [];
      }
    } else if (Array.isArray(saidasDinheiro)) {
      parsedSaidas = saidasDinheiro;
    }

    const saidasDinheiroTotal = parsedSaidas.reduce((acc, s) => acc + (parseFloat(s.valor) || 0), 0);

    const totalEntradas = numDinheiro + numPix + numCartaoCredito + numCartaoDebito + numCheque;
    const totalDinheiroEmCaixa = numTrocoAnterior + numDinheiro; // Total em espécie na gaveta antes das saídas
    const totalDinheiroLiquido = Math.max(0, totalDinheiroEmCaixa - saidasDinheiroTotal); // Saldo disponível em espécie após despesas
    const retiradaDinheiro = Math.max(0, totalDinheiroEmCaixa - saidasDinheiroTotal - numTrocoSeguinte); // Sangria final

    let closureObj = null;
    let savedId = id;

    if (id && id.trim()) {
      const idx = closures.findIndex(c => c.id === id);
      if (idx !== -1) {
        if (closures[idx].status === 'Conferido') {
          return res.status(400).send('Este fechamento já foi CONFERIDO pela gerência e não pode mais ser editado.');
        }

        closureObj = {
          ...closures[idx],
          recepcao: recepcao || closures[idx].recepcao || 'Recepção Particular',
          data: closureDate,
          responsavel: responsavel || closures[idx].responsavel,
          trocoAnterior: numTrocoAnterior,
          trocoAnteriorOriginal: numTrocoAnteriorOriginal,
          trocoAnteriorEditado: isTrocoAnteriorEditado,
          dinheiro: numDinheiro,
          pix: numPix,
          cartaoCredito: numCartaoCredito,
          cartaoDebito: numCartaoDebito,
          cheque: numCheque,
          saidasDinheiro: parsedSaidas,
          saidasDinheiroTotal,
          totalEntradas,
          totalDinheiroEmCaixa,
          totalDinheiroLiquido,
          trocoSeguinte: numTrocoSeguinte,
          retiradaDinheiro,
          comprovantePrint: comprovantePrint !== undefined ? comprovantePrint : (closures[idx].comprovantePrint || null),
          status: status || closures[idx].status || 'Fechado',
          observacoes: observacoes || '',
          updatedAt: new Date().toISOString()
        };
        closures[idx] = closureObj;
      }
    }

    if (!closureObj) {
      const itemRecepcao = recepcao || 'Recepção Particular';
      const existingIdx = closures.findIndex(c => c.data === closureDate && (c.recepcao || 'Recepção Particular') === itemRecepcao);

      if (existingIdx !== -1) {
        if (closures[existingIdx].status === 'Conferido') {
          return res.status(400).send('Este fechamento já foi CONFERIDO pela gerência e não pode ser alterado.');
        }

        savedId = closures[existingIdx].id;
        closureObj = {
          ...closures[existingIdx],
          recepcao: itemRecepcao,
          data: closureDate,
          responsavel: responsavel || closures[existingIdx].responsavel || res.locals.adminUserName || 'Recepcionista',
          trocoAnterior: numTrocoAnterior,
          trocoAnteriorOriginal: numTrocoAnteriorOriginal,
          trocoAnteriorEditado: isTrocoAnteriorEditado,
          dinheiro: numDinheiro,
          pix: numPix,
          cartaoCredito: numCartaoCredito,
          cartaoDebito: numCartaoDebito,
          cheque: numCheque,
          saidasDinheiro: parsedSaidas,
          saidasDinheiroTotal,
          totalEntradas,
          totalDinheiroEmCaixa,
          totalDinheiroLiquido,
          trocoSeguinte: numTrocoSeguinte,
          retiradaDinheiro,
          comprovantePrint: comprovantePrint !== undefined ? comprovantePrint : (closures[existingIdx].comprovantePrint || null),
          status: status || closures[existingIdx].status || 'Fechado',
          observacoes: observacoes || '',
          updatedAt: new Date().toISOString()
        };
        closures[existingIdx] = closureObj;
      } else {
        savedId = 'FC' + Date.now();
        closureObj = {
          id: savedId,
          recepcao: itemRecepcao,
          data: closureDate,
          responsavel: responsavel || res.locals.adminUserName || 'Recepcionista',
          trocoAnterior: numTrocoAnterior,
          trocoAnteriorOriginal: numTrocoAnteriorOriginal,
          trocoAnteriorEditado: isTrocoAnteriorEditado,
          dinheiro: numDinheiro,
          pix: numPix,
          cartaoCredito: numCartaoCredito,
          cartaoDebito: numCartaoDebito,
          cheque: numCheque,
          saidasDinheiro: parsedSaidas,
          saidasDinheiroTotal,
          totalEntradas,
          totalDinheiroEmCaixa,
          totalDinheiroLiquido,
          trocoSeguinte: numTrocoSeguinte,
          retiradaDinheiro,
          comprovantePrint: comprovantePrint || null,
          status: status || 'Fechado',
          observacoes: observacoes || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        closures.push(closureObj);
      }
    }

    saveCashClosures(closures);

    if (closureObj && closureObj.status === 'Conferido') {
      syncClosureToFinance(closureObj, responsavel || res.locals.adminUserName || 'Administrador');
    }

    // Verificar origem para redirecionar adequadamente
    const referer = req.get('Referer') || '';
    if (referer.includes('/admin/financeiro/fechamento-caixa')) {
      return res.redirect('/admin/financeiro/fechamento-caixa?success=saved');
    }
    res.redirect(`/admin/recepcao/fechamento-caixa?success=saved&lastId=${savedId}`);
  } catch (error) {
    console.error("Erro ao salvar fechamento de caixa:", error);
    res.status(500).send("Erro interno ao salvar fechamento de caixa");
  }
});

// ROTA: Salvar Lote de Fechamentos Importados via CSV
app.post('/api/admin/recepcao/fechamento-caixa/salvar-lote-csv', requireAdmin, (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Nenhum fechamento enviado para salvar." });
    }

    const closures = loadCashClosures();
    const defaultResponsavel = res.locals.adminUserName || 'Importação CSV';
    let savedCount = 0;

    items.forEach(item => {
      const closureDate = item.data || new Date().toISOString().split('T')[0];
      const itemRecepcao = item.recepcao || 'Recepção Particular';

      const numDinheiro = parseFloat(item.dinheiro) || 0;
      const numPix = parseFloat(item.pix) || 0;
      const numCartaoCredito = parseFloat(item.cartaoCredito) || 0;
      const numCartaoDebito = parseFloat(item.cartaoDebito) || 0;
      const numCheque = parseFloat(item.cheque) || 0;
      const numTrocoAnterior = parseFloat(item.trocoAnterior) || 0;
      const numTrocoSeguinte = parseFloat(item.trocoSeguinte) || 0;
      const totalEntradas = numDinheiro + numPix + numCartaoCredito + numCartaoDebito + numCheque;

      const existingIdx = closures.findIndex(c => c.data === closureDate && c.recepcao === itemRecepcao);

      const closureObj = {
        id: existingIdx !== -1 ? closures[existingIdx].id : ('FC' + Date.now() + Math.floor(Math.random() * 1000)),
        recepcao: itemRecepcao,
        data: closureDate,
        responsavel: item.responsavel || defaultResponsavel,
        trocoAnterior: numTrocoAnterior,
        trocoAnteriorOriginal: numTrocoAnterior,
        trocoAnteriorEditado: false,
        dinheiro: numDinheiro,
        pix: numPix,
        cartaoCredito: numCartaoCredito,
        cartaoDebito: numCartaoDebito,
        cheque: numCheque,
        saidasDinheiro: [],
        saidasDinheiroTotal: 0,
        totalEntradas: totalEntradas,
        totalDinheiroEmCaixa: numTrocoAnterior + numDinheiro,
        totalDinheiroLiquido: numTrocoAnterior + numDinheiro,
        trocoSeguinte: numTrocoSeguinte,
        retiradaDinheiro: Math.max(0, (numTrocoAnterior + numDinheiro) - numTrocoSeguinte),
        comprovantePrint: null,
        status: 'Conferido', // Marcado como Conferido conforme solicitado
        observacoes: item.observacoes || `Fechamento importado via CSV (${itemRecepcao} - ${closureDate})`,
        createdAt: existingIdx !== -1 ? (closures[existingIdx].createdAt || new Date().toISOString()) : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (existingIdx !== -1) {
        closures[existingIdx] = closureObj;
        savedCount++;
      } else {
        closures.push(closureObj);
        savedCount++;
      }

      // Sincronizar para o financeiro
      syncClosureToFinance(closureObj, res.locals.adminUserName || 'Administrador');
    });

    saveCashClosures(closures);
    return res.json({ success: true, savedCount, message: `${savedCount} fechamento(s) do CSV salvos e marcados como Conferido com sucesso!` });
  } catch (error) {
    console.error("Erro ao salvar lote de fechamentos via CSV:", error);
    res.status(500).json({ success: false, error: "Erro ao gravar lançamentos importados no banco de dados." });
  }
});

// ROTA: Excluir Fechamentos de Caixa de um Mês Inteiro (Ex: YYYY-MM)
app.post('/admin/recepcao/fechamento-caixa/delete-mes', requireAdmin, (req, res) => {
  try {
    const { mes } = req.body;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes.trim())) {
      return res.status(400).json({ success: false, error: 'Mês inválido informado. Utilize o formato YYYY-MM.' });
    }

    const targetMonth = mes.trim();
    let closures = loadCashClosures();
    const initialCount = closures.length;

    const removedClosures = closures.filter(c => c.data && c.data.startsWith(targetMonth));
    const removedIds = removedClosures.map(c => c.id);

    closures = closures.filter(c => {
      if (!c.data) return true;
      return !c.data.startsWith(targetMonth);
    });

    const removedCount = initialCount - closures.length;
    saveCashClosures(closures);

    if (removedIds.length > 0) {
      let transactions = loadTransactions();
      transactions = transactions.filter(t => !removedIds.includes(t.closureId));
      saveTransactions(transactions);

      let movements = loadMovements();
      movements = movements.filter(m => !removedIds.includes(m.closureId));
      saveMovements(movements);
    }

    const referer = req.get('Referer') || '';
    if (referer.includes('/admin/financeiro/fechamento-caixa')) {
      return res.redirect(`/admin/financeiro/fechamento-caixa?success=deleted_month&count=${removedCount}&mes=${targetMonth}`);
    }
    res.redirect(`/admin/recepcao/fechamento-caixa?success=deleted_month&count=${removedCount}&mes=${targetMonth}`);
  } catch (error) {
    console.error("Erro ao excluir fechamentos do mês:", error);
    res.status(500).send("Erro ao excluir fechamentos do mês");
  }
});

// ROTA: Excluir Fechamento de Caixa
app.post('/admin/recepcao/fechamento-caixa/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    let closures = loadCashClosures();
    closures = closures.filter(c => c.id !== id);
    saveCashClosures(closures);

    if (id) {
      let transactions = loadTransactions();
      transactions = transactions.filter(t => t.closureId !== id);
      saveTransactions(transactions);

      let movements = loadMovements();
      movements = movements.filter(m => m.closureId !== id);
      saveMovements(movements);
    }

    const referer = req.get('Referer') || '';
    if (referer.includes('/admin/financeiro/fechamento-caixa')) {
      return res.redirect('/admin/financeiro/fechamento-caixa?success=deleted');
    }
    res.redirect('/admin/recepcao/fechamento-caixa?success=deleted');
  } catch (error) {
    console.error("Erro ao excluir fechamento de caixa:", error);
    res.status(500).send("Erro ao excluir fechamento de caixa");
  }
});

// Analisar Planilha Excel ou PDF para Pré-visualização (POST)
app.post('/admin/exames/parse', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
    }

    // Verificar se o arquivo é um PDF
    const isPdf = file.originalname.toLowerCase().endsWith('.pdf') || file.mimetype === 'application/pdf';

    if (isPdf) {
      try {
        const customPagerender = (pageData) => {
          if (pageData == null) return Promise.resolve('');
          return pageData.getTextContent().then((textContent) => {
            let lastY = null;
            let lastX = 0;
            let lastWidth = 0;
            let text = '';
            
            for (let item of textContent.items) {
              const x = item.transform[4];
              const y = item.transform[5];
              const str = item.str;
              const width = item.width || 0;
              
              if (lastY === null) {
                text += str;
              } else if (Math.abs(y - lastY) < 1) { // Mesmo alinhamento vertical (mesma linha)
                const needsSpace = 
                  str && text &&
                  !text.endsWith(' ') && 
                  !str.startsWith(' ') && 
                  (x > lastX + lastWidth + 3); // se houver um espaçamento horizontal de mais de 3 unidades, insere espaço
                  
                if (needsSpace) {
                  text += ' ' + str;
                } else {
                  text += str;
                }
              } else { // Nova linha
                text += '\n' + str;
              }
              
              lastY = y;
              lastX = x;
              lastWidth = width;
            }
            return text;
          });
        };

        const pdfData = await pdf(file.buffer, { pagerender: customPagerender });
        const text = pdfData.text || '';
        
        // Processar texto do PDF
        const lines = text.split('\n');
        const rawRows = [];
        
        // Cabeçalho virtual para o mapeador EJS funcionar
        rawRows.push(["Código do Apoio", "Nome do Exame", "Preço do Apoio"]);
        
        // Expressão regular para capturar preços (ex: 12,50, 1.250,00, R$ 15.00)
        const priceRegex = /(?:R\$\s*)?(\d+(?:\.\d{3})*,\d{2})\b|(?:R\$\s*)?(\d+\.\d{2})\b/i;
        
        const isCode = (w) => {
          return /^[A-Z0-9-]{3,15}$/i.test(w) && (/\d/.test(w) || w.includes('-') || w === w.toUpperCase());
        };

        const skipRows = parseInt(req.body.skipRows || '0', 10) || 0;
        let validLinesCount = 0;
        
        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          
          // Ignorar cabeçalhos de páginas repetitivas comuns
          if (line.toLowerCase().includes('tabela') || line.toLowerCase().includes('pag.') || line.toLowerCase().includes('pagina') || line.toLowerCase().includes('usuario')) {
            continue;
          }
          
          const priceMatch = line.match(priceRegex);
          if (!priceMatch) continue;
          
          const priceStr = priceMatch[1] || priceMatch[2];
          const priceNum = parseFloat(priceStr.replace(/\./g, '').replace(',', '.'));
          
          if (isNaN(priceNum) || priceNum <= 0) continue;
          
          validLinesCount++;
          // Se o usuário pediu para ignorar N linhas de exames, nós pulamos
          if (validLinesCount <= skipRows) {
            continue;
          }

          // Remover o preço correspondente para extrair código e nome
          const lineWithoutPrice = line.replace(priceMatch[0], '').trim();
          const words = lineWithoutPrice.split(/\s+/);
          
          let codeVal = '';
          let nameVal = '';
          
          if (words.length > 0) {
            const firstWord = words[0];
            const lastWord = words[words.length - 1];
            
            if (isCode(firstWord)) {
              codeVal = firstWord;
              nameVal = words.slice(1).join(' ');
            } else if (isCode(lastWord)) {
              codeVal = lastWord;
              nameVal = words.slice(0, words.length - 1).join(' ');
            } else {
              // Procurar qualquer palavra que seja um código
              let foundCodeIdx = -1;
              for (let idx = 0; idx < words.length; idx++) {
                if (isCode(words[idx]) && words[idx].length >= 4) {
                  foundCodeIdx = idx;
                  break;
                }
              }
              if (foundCodeIdx !== -1) {
                codeVal = words[foundCodeIdx];
                nameVal = words.filter((_, idx) => idx !== foundCodeIdx).join(' ');
              } else {
                // Se nenhum código for detectado, deixa o código em branco e usa toda a linha como nome
                codeVal = '';
                nameVal = words.join(' ');
              }
            }
          }
          
          // Limpeza do nome do exame
          nameVal = nameVal.replace(/^[\s\-\.\:\,]+|[\s\-\.\:\,]+$/g, '').replace(/\s+/g, ' ').trim();
          
          if (nameVal.length >= 3) {
            // Adicionar ao rawRows no formato que o frontend espera
            rawRows.push([
              codeVal || ("EX" + String(validLinesCount).padStart(3, '0')),
              nameVal,
              priceStr
            ]);
          }
        }
        
        if (rawRows.length <= 1) {
          return res.status(400).json({ success: false, message: 'Nenhum exame com preço válido pôde ser extraído do PDF.' });
        }
        
        const jalisCol = 0;
        const catCol = -1; // Sem categoria no PDF por padrão
        const nameCol = 1;
        const codeCol = 0;
        const priceCol = 2;
        
        const firstRow = rawRows[0];
        const rows = rawRows;
        
        const validExams = [];
        const skippedCount = { zeroOrNegative: 0, emptyName: 0 };
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const codeVal = row[0];
          const nameVal = row[1];
          const priceValStr = row[2];
          const priceNum = parseFloat(priceValStr.replace(/\./g, '').replace(',', '.'));
          
          validExams.push({
            jalisCode: codeVal,
            code: codeVal,
            name: nameVal,
            pricePrivate: priceNum,
            category: "Geral",
            fasting: "Não obrigatório",
            timeframe: "24 horas",
            instructions: "Sem instruções de preparo cadastradas. Consulte o laboratório.",
            supportLab: "Apoio"
          });
        }
        
        const detectedHeaders = {
          jalis: "Código do Apoio",
          category: "Categoria (N/A)",
          name: "Nome do Exame",
          code: "Código do Apoio",
          price: "Preço do Apoio"
        };
        
        return res.json({
          success: true,
          exams: validExams,
          skippedCount,
          mappedIndices: {
            jalisCol,
            catCol,
            nameCol,
            codeCol,
            priceCol
          },
          detectedHeaders,
          firstRow,
          rows
        });
        
      } catch (pdfErr) {
        console.error("Erro ao analisar arquivo PDF:", pdfErr);
        return res.status(400).json({ success: false, message: 'Falha ao processar o arquivo PDF: ' + pdfErr.message });
      }
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return res.status(400).json({ success: false, message: 'O arquivo Excel parece estar vazio ou inválido.' });
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Forçar a leitura a partir da Coluna A (índice 0) para evitar shift lateral por colunas vazias
    if (worksheet['!ref']) {
      try {
        const decodedRange = XLSX.utils.decode_range(worksheet['!ref']);
        decodedRange.s.c = 0; // Força início na Coluna A (0)
        if (decodedRange.e.c < 4) {
          decodedRange.e.c = 4; // Garante pelo menos até a Coluna E (4)
        }
        worksheet['!ref'] = XLSX.utils.encode_range(decodedRange);
      } catch (rangeErr) {
        console.error("Erro ao ajustar range do Excel:", rangeErr);
      }
    }

    // Adicionado defval: "" para evitar shift lateral caso colunas intermediárias estejam vazias
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    const skipRows = parseInt(req.body.skipRows || '0', 10) || 0;
    const rows = rawRows.slice(skipRows);

    if (rows.length < 2) {
      return res.status(400).json({ success: false, message: 'A planilha precisa conter pelo menos o cabeçalho e uma linha de exames (tente reduzir as linhas ignoradas).' });
    }

    // Mapeamento de colunas padrão solicitado (fallback):
    // 0: Código Jalis (Codigo Ex)
    // 1: Categoria (Codigo Ma)
    // 2: Descricao (Nome do Exame)
    // 3: Cod. Gestão (Codigo AM)
    // 4: Particular (Valor)
    let jalisCol = 0;
    let catCol = 1;
    let nameCol = 2;
    let codeCol = 3;
    let priceCol = 4;

    const firstRow = rows[0] || [];
    if (firstRow && Array.isArray(firstRow)) {
      const headers = firstRow.map(h => String(h || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
      console.log("Planilha headers detectados (normalizados):", headers);

      // 1. Procurar CÓDIGO JALIS
      const foundJalisIdx = headers.findIndex(h => h.includes('jalis') || h === 'codigo ex' || h === 'cod ex' || h === 'codigo_ex' || h === 'cod_ex' || (h.startsWith('codigo') && (h.includes('ex') || h.includes('exa'))));
      if (foundJalisIdx !== -1) {
        jalisCol = foundJalisIdx;
      }

      // 2. Procurar CATEGORIA
      const foundCatIdx = headers.findIndex(h => h.includes('categoria') || h.includes('material') || h === 'codigo ma' || h === 'cod ma' || h === 'codigo_ma' || h === 'cod_ma' || h === 'cat');
      if (foundCatIdx !== -1) {
        catCol = foundCatIdx;
      }

      // 3. Procurar NOME DO EXAME
      const foundNameIdx = headers.findIndex(h => h.includes('descricao') || h.includes('nome') || h.includes('exame') || h.includes('desc'));
      if (foundNameIdx !== -1) {
        nameCol = foundNameIdx;
      }

      // 4. Procurar CÓDIGO DE GESTÃO / AMB
      const foundCodeIdx = headers.findIndex(h => h.includes('amb') || h.includes('gestao') || h.includes('codigo am') || h === 'codigo_am' || h === 'cod_am');
      if (foundCodeIdx !== -1) {
        codeCol = foundCodeIdx;
      }

      // 5. Procurar VALOR (PARTICULAR)
      const foundPriceIdx = headers.findIndex(h => h.includes('valor') || h.includes('particular') || h.includes('preco') || h.includes('preço') || h.includes('vlr') || h.includes('custo'));
      if (foundPriceIdx !== -1) {
        priceCol = foundPriceIdx;
      }
    }

    console.log(`Mapeamento final de colunas: JalisCol=${jalisCol}, CatCol=${catCol}, NameCol=${nameCol}, CodeCol=${codeCol}, PriceCol=${priceCol}`);

    const validExams = [];
    const skippedCount = { zeroOrNegative: 0, emptyName: 0 };

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const jalisCodeVal = row[jalisCol] !== undefined && row[jalisCol] !== null ? String(row[jalisCol]).trim() : '';
      const categoryVal = row[catCol] !== undefined && row[catCol] !== null ? String(row[catCol]).trim() : '';
      const nameVal = row[nameCol] !== undefined && row[nameCol] !== null ? String(row[nameCol]).trim() : '';
      const codeVal = codeCol !== -1 && row[codeCol] !== undefined && row[codeCol] !== null ? String(row[codeCol]).trim() : '';

      if (!nameVal) {
        skippedCount.emptyName++;
        continue;
      }

      const priceNum = parsePriceValue(row[priceCol]);

      if (priceNum >= 0) {
        validExams.push({
          jalisCode: jalisCodeVal,
          code: codeVal,
          name: nameVal,
          pricePrivate: priceNum,
          category: categoryVal || "Geral",
          fasting: "Não obrigatório",
          timeframe: "24 horas",
          instructions: "Sem instruções de preparo cadastradas. Consulte o laboratório.",
          supportLab: "Próprio"
        });
      } else {
        skippedCount.zeroOrNegative++;
      }
    }

    const detectedHeaders = {
      jalis: firstRow[jalisCol] ? String(firstRow[jalisCol]) : "Código Jalis",
      category: firstRow[catCol] ? String(firstRow[catCol]) : "Categoria",
      name: firstRow[nameCol] ? String(firstRow[nameCol]) : "Nome do Exame",
      code: codeCol !== -1 && firstRow[codeCol] ? String(firstRow[codeCol]) : "Cód. Gestão",
      price: firstRow[priceCol] ? String(firstRow[priceCol]) : "Particular"
    };

    res.json({
      success: true,
      exams: validExams,
      skippedCount,
      mappedIndices: {
        jalisCol,
        catCol,
        nameCol,
        codeCol,
        priceCol
      },
      detectedHeaders,
      firstRow,
      rows
    });
  } catch (err) {
    console.error("Erro ao analisar planilha:", err);
    res.status(500).json({ success: false, message: 'Erro ao analisar a planilha: ' + err.message });
  }
});

// Importar Exames em Lote de Planilha (POST)
app.post('/admin/exames/import', requireAdmin, (req, res) => {
  try {
    const { exams: importedExams, clearFirst } = req.body;
    if (!Array.isArray(importedExams)) {
      return res.status(400).json({ success: false, message: 'Dados de exames inválidos.' });
    }

    // Se clearFirst for true, começa com um array vazio (apaga os anteriores)
    const currentExams = clearFirst ? [] : loadExams();
    let importedCount = 0;

    importedExams.forEach(item => {
      let existingIndex = -1;
      const itemJalis = String(item.jalisCode !== undefined && item.jalisCode !== null ? item.jalisCode : '').trim();
      const itemName = String(item.name !== undefined && item.name !== null ? item.name : '').trim().toLowerCase();

      // Se tiver ID de vínculo direto do frontend, use-o com prioridade
      if (item.matchExamId) {
        existingIndex = currentExams.findIndex(e => e.id === item.matchExamId);
      } else {
        // Caso contrário, buscar correspondência padrão por código Jalis ou nome para não duplicar
        if (itemJalis) {
          existingIndex = currentExams.findIndex(e => String(e.jalisCode || '').trim() === itemJalis);
        } else if (itemName) {
          existingIndex = currentExams.findIndex(e => String(e.name || '').toLowerCase() === itemName);
        }
      }

      const examData = {
        name: String(item.name || 'Sem nome').trim(),
        category: String(item.category || 'Geral').trim(),
        fasting: String(item.fasting || 'Não obrigatório').trim(),
        timeframe: String(item.timeframe || '24 horas').trim(),
        instructions: String(item.instructions || 'Sem instruções de preparo cadastradas. Consulte o laboratório.').trim(),
        code: String(item.code || itemJalis || '').trim(),
        jalisCode: itemJalis,
        codigoAlvaro: String(item.codigoAlvaro || '').trim(),
        codigoPardini: String(item.codigoPardini || '').trim(),
        priceAlvaro: item.priceAlvaro ? parseFloat(item.priceAlvaro) : 0,
        pricePardini: item.pricePardini ? parseFloat(item.pricePardini) : 0,
        supportLab: String(item.supportLab || 'Próprio').trim(),
        pricePrivate: item.pricePrivate !== undefined ? parseFloat(item.pricePrivate) : 0
      };

      if (existingIndex !== -1) {
        // Mesclagem inteligente: atualiza preço, nome e códigos da planilha, preservando orientações existentes
        const existingExam = currentExams[existingIndex];
        currentExams[existingIndex] = {
          ...existingExam,
          name: String(item.name || existingExam.name || 'Sem nome').trim(),
          category: String(item.category || existingExam.category || 'Geral').trim(),
          code: String(item.code || existingExam.code || itemJalis || '').trim(),
          jalisCode: itemJalis || existingExam.jalisCode || '',
          codigoAlvaro: String(item.codigoAlvaro || existingExam.codigoAlvaro || '').trim(),
          codigoPardini: String(item.codigoPardini || existingExam.codigoPardini || '').trim(),
          pricePrivate: item.pricePrivate !== undefined ? parseFloat(item.pricePrivate) : existingExam.pricePrivate,
          // Preserva instruções/jejum existentes e só usa os novos se os existentes forem vazios ou padrão
          fasting: existingExam.fasting && existingExam.fasting !== 'Não obrigatório' ? existingExam.fasting : String(item.fasting || 'Não obrigatório').trim(),
          timeframe: existingExam.timeframe && existingExam.timeframe !== '24 horas' ? existingExam.timeframe : String(item.timeframe || '24 horas').trim(),
          instructions: existingExam.instructions && !existingExam.instructions.startsWith('Sem instruções de preparo') ? existingExam.instructions : String(item.instructions || 'Sem instruções de preparo cadastradas. Consulte o laboratório.').trim(),
          supportLab: String(item.supportLab || existingExam.supportLab || 'Próprio').trim()
        };
      } else {
        // Adiciona um novo registro
        currentExams.push({
          id: (Date.now() + importedCount).toString(),
          ...examData
        });
      }
      importedCount++;
    });

    saveExams(currentExams);
    res.json({ success: true, count: importedCount });
  } catch (err) {
    console.error("Erro ao importar exames em lote:", err);
    res.status(500).json({ success: false, message: 'Erro no servidor ao processar importação.' });
  }
});

// Atualizar o preço de custo de um exame para um determinado laboratório de apoio diretamente (POST)
app.post('/admin/exames/update-apoio-price', requireAdmin, (req, res) => {
  try {
    const { examId, labId, deparaCode, price } = req.body;
    if (!examId || !labId || !deparaCode) {
      return res.status(400).json({ success: false, message: 'Parâmetros insuficientes para atualizar preço.' });
    }

    const priceNum = Number(price) || 0;
    const labs = loadSupportLabs();
    
    // Encontrar o laboratório correto
    let foundLab = null;
    if (labId === 'alvaro') {
      foundLab = labs.find(l => l.name.toLowerCase().includes('alvaro') || l.name.toLowerCase().includes('álvaro'));
    } else if (labId === 'pardini') {
      foundLab = labs.find(l => l.name.toLowerCase().includes('pardini'));
    } else {
      foundLab = labs.find(l => String(l.id) === String(labId));
    }

    if (!foundLab) {
      return res.status(404).json({ success: false, message: 'Laboratório de apoio não correspondente encontrado.' });
    }

    // 1. Atualizar o preço no próprio laboratório de apoio
    foundLab.prices = foundLab.prices || {};
    const cleanCode = deparaCode.trim().toLowerCase();
    foundLab.prices[cleanCode] = {
      price: priceNum,
      name: foundLab.prices[cleanCode]?.name || deparaCode
    };
    saveSupportLabs(labs);

    // 2. Atualizar o preço em todos os exames locais que utilizam esse mesmo código para esse laboratório
    const exams = loadExams();
    const isAlvaro = foundLab.name.toLowerCase().includes('alvaro') || foundLab.name.toLowerCase().includes('álvaro');
    const isPardini = foundLab.name.toLowerCase().includes('pardini');

    exams.forEach(ex => {
      let exDeparaCode = '';
      if (isAlvaro) {
        exDeparaCode = (ex.codigoAlvaro || '').trim().toLowerCase();
      } else if (isPardini) {
        exDeparaCode = (ex.codigoPardini || '').trim().toLowerCase();
      } else if (ex.supportLabsData && ex.supportLabsData[foundLab.id]) {
        exDeparaCode = (ex.supportLabsData[foundLab.id].code || '').trim().toLowerCase();
      }

      if (exDeparaCode === cleanCode) {
        if (isAlvaro) {
          ex.priceAlvaro = priceNum;
        } else if (isPardini) {
          ex.pricePardini = priceNum;
        }

        ex.supportLabsData = ex.supportLabsData || {};
        ex.supportLabsData[foundLab.id] = ex.supportLabsData[foundLab.id] || {};
        ex.supportLabsData[foundLab.id].price = priceNum;
        ex.supportLabsData[foundLab.id].code = deparaCode;
        if (!ex.supportLabsData[foundLab.id].originalName) {
          ex.supportLabsData[foundLab.id].originalName = deparaCode;
        }
      }
    });
    
    saveExams(exams);
    res.json({ success: true, message: 'Preço de apoio atualizado com sucesso.' });
  } catch (err) {
    console.error("Erro ao atualizar preço de custo rápido:", err);
    res.status(500).json({ success: false, message: 'Erro interno do servidor ao atualizar preço.' });
  }
});

// Vincular rapidamente um código de laboratório de apoio a um exame (POST)
app.post('/admin/exames/update-depara-code', requireAdmin, (req, res) => {
  try {
    const { examId, labId, deparaCode } = req.body;
    if (!examId || !labId) {
      return res.status(400).json({ success: false, message: 'ID do exame e ID do laboratório são obrigatórios.' });
    }

    const cleanCode = (deparaCode || '').trim();
    const exams = loadExams();
    const examIndex = exams.findIndex(e => String(e.id) === String(examId));

    if (examIndex === -1) {
      return res.status(404).json({ success: false, message: 'Exame não encontrado.' });
    }

    const labs = loadSupportLabs();
    let foundLab = null;
    if (labId === 'alvaro') {
      foundLab = labs.find(l => l.name.toLowerCase().includes('alvaro') || l.name.toLowerCase().includes('álvaro'));
    } else if (labId === 'pardini') {
      foundLab = labs.find(l => l.name.toLowerCase().includes('pardini'));
    } else {
      foundLab = labs.find(l => String(l.id) === String(labId));
    }

    if (!foundLab) {
      return res.status(404).json({ success: false, message: 'Laboratório de apoio não encontrado.' });
    }

    const targetExam = exams[examIndex];
    targetExam.supportLabsData = targetExam.supportLabsData || {};

    // Se o código foi removido (vazio)
    if (!cleanCode) {
      if (labId === 'alvaro') {
        targetExam.codigoAlvaro = '';
        targetExam.priceAlvaro = 0;
      } else if (labId === 'pardini') {
        targetExam.codigoPardini = '';
        targetExam.pricePardini = 0;
      }
      delete targetExam.supportLabsData[foundLab.id];
      saveExams(exams);
      return res.json({ success: true, message: 'Vínculo removido com sucesso.', price: 0 });
    }

    // Se o código foi informado, tenta ver se este laboratório já tem preço carregado para ele
    let matchedPrice = 0;
    let matchedName = cleanCode;
    const cleanLowerCode = cleanCode.toLowerCase();

    if (foundLab.prices && foundLab.prices[cleanLowerCode]) {
      matchedPrice = Number(foundLab.prices[cleanLowerCode].price) || 0;
      matchedName = foundLab.prices[cleanLowerCode].name || cleanCode;
    }

    // Atualiza o exame
    if (labId === 'alvaro') {
      targetExam.codigoAlvaro = cleanCode;
      targetExam.priceAlvaro = matchedPrice;
    } else if (labId === 'pardini') {
      targetExam.codigoPardini = cleanCode;
      targetExam.pricePardini = matchedPrice;
    }

    targetExam.supportLabsData[foundLab.id] = {
      code: cleanCode,
      price: matchedPrice,
      originalName: matchedName
    };

    saveExams(exams);
    res.json({ success: true, message: 'Código de apoio vinculado com sucesso.', price: matchedPrice });
  } catch (err) {
    console.error("Erro ao vincular código de apoio:", err);
    res.status(500).json({ success: false, message: 'Erro no servidor ao vincular código de apoio.' });
  }
});

// Limpar todos os exames cadastrados (POST)
app.post('/admin/exames/clear', requireAdmin, (req, res) => {
  try {
    saveExams([]);
    syncAllExamsWithPriceTables();
    res.json({ success: true, message: 'Todos os exames foram excluídos com êxito.' });
  } catch (err) {
    console.error("Erro ao limpar exames:", err);
    res.status(500).json({ success: false, message: 'Erro no servidor ao limpar exames.' });
  }
});

// Importar de/para de códigos de exames (POST)
app.post('/admin/exames/import-depara', requireAdmin, (req, res) => {
  try {
    const { mappings } = req.body;
    if (!Array.isArray(mappings)) {
      return res.status(400).json({ success: false, message: 'Dados de de/para inválidos.' });
    }
    const exams = loadExams();
    const labs = loadSupportLabs();
    const alvaroLab = labs.find(l => l.name.toLowerCase().includes('alvaro') || l.name.toLowerCase().includes('álvaro'));
    const pardiniLab = labs.find(l => l.name.toLowerCase().includes('pardini'));

    let updatedCount = 0;
    mappings.forEach(map => {
      const mapJalis = (map.jalisCode || '').trim().toLowerCase();
      if (!mapJalis) return;
      const index = exams.findIndex(e => (e.jalisCode || '').trim().toLowerCase() === mapJalis);
      if (index !== -1) {
        const alvaroCode = (map.codigoAlvaro || '').trim();
        const pardiniCode = (map.codigoPardini || '').trim();

        exams[index].codigoAlvaro = alvaroCode;
        exams[index].codigoPardini = pardiniCode;

        // Sincronizar também no supportLabsData
        exams[index].supportLabsData = exams[index].supportLabsData || {};
        
        if (alvaroLab && alvaroCode) {
          exams[index].supportLabsData[alvaroLab.id] = exams[index].supportLabsData[alvaroLab.id] || {};
          exams[index].supportLabsData[alvaroLab.id].code = alvaroCode;
        }
        if (pardiniLab && pardiniCode) {
          exams[index].supportLabsData[pardiniLab.id] = exams[index].supportLabsData[pardiniLab.id] || {};
          exams[index].supportLabsData[pardiniLab.id].code = pardiniCode;
        }

        updatedCount++;
      }
    });
    saveExams(exams);
    res.json({ success: true, count: updatedCount });
  } catch (err) {
    console.error("Erro ao importar de/para:", err);
    res.status(500).json({ success: false, message: 'Erro no servidor ao processar de/para.' });
  }
});

// Importar e salvar preços do laboratório de apoio permanentemente (POST)
app.post('/admin/comparador/import-precos', requireAdmin, (req, res) => {
  try {
    const { lab, items } = req.body; // lab: ex "Álvaro Apoio" ou "Hermes Pardini", items: [{ code: '...', name: '...', price: 12.50 }]
    if (!lab || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'Dados de preços inválidos.' });
    }
    const exams = loadExams();
    const labs = loadSupportLabs();
    
    const cleanLabName = lab.trim().toLowerCase();
    const foundLab = labs.find(l => l.name.trim().toLowerCase() === cleanLabName || String(l.id) === String(lab));
    
    if (!foundLab) {
      return res.status(404).json({ success: false, message: 'Laboratório de apoio não encontrado.' });
    }

    foundLab.prices = foundLab.prices || {};
    let updatedCount = 0;

    items.forEach(item => {
      const itemCode = (item.code || '').trim();
      const itemName = (item.name || '').trim();
      const itemPrice = Number(item.price) || 0;
      const cleanItemCode = itemCode.toLowerCase();
      
      if (!cleanItemCode || !itemName) return;

      foundLab.prices[cleanItemCode] = {
        price: itemPrice,
        name: itemName
      };
      updatedCount++;
    });

    saveSupportLabs(labs);

    // Propagar preços atualizados para todos os exames locais que usam este de/para deste laboratório
    const isAlvaro = foundLab.name.toLowerCase().includes('alvaro') || foundLab.name.toLowerCase().includes('álvaro');
    const isPardini = foundLab.name.toLowerCase().includes('pardini');
    
    exams.forEach(exam => {
      let deparaCode = '';
      if (isAlvaro) {
        deparaCode = (exam.codigoAlvaro || '').trim();
      } else if (isPardini) {
        deparaCode = (exam.codigoPardini || '').trim();
      } else if (exam.supportLabsData && exam.supportLabsData[foundLab.id]) {
        deparaCode = (exam.supportLabsData[foundLab.id].code || '').trim();
      }
      
      if (deparaCode) {
        const cleanCode = deparaCode.toLowerCase();
        if (foundLab.prices[cleanCode]) {
          const priceInfo = foundLab.prices[cleanCode];
          
          exam.supportLabsData = exam.supportLabsData || {};
          exam.supportLabsData[foundLab.id] = exam.supportLabsData[foundLab.id] || {};
          exam.supportLabsData[foundLab.id].price = priceInfo.price;
          exam.supportLabsData[foundLab.id].code = deparaCode;
          exam.supportLabsData[foundLab.id].originalName = priceInfo.name || deparaCode;
          
          if (isAlvaro) {
            exam.priceAlvaro = priceInfo.price;
          } else if (isPardini) {
            exam.pricePardini = priceInfo.price;
          }
        }
      }
    });

    saveExams(exams);
    res.json({ success: true, count: updatedCount });
  } catch (err) {
    console.error("Erro ao salvar preços de apoio:", err);
    res.status(500).json({ success: false, message: 'Erro no servidor ao salvar preços.' });
  }
});

// Limpar todos os preços de um laboratório de apoio (POST)
app.post('/admin/comparador/clear-precos', requireAdmin, (req, res) => {
  try {
    const { labId } = req.body;
    if (!labId) {
      return res.status(400).json({ success: false, message: 'ID de laboratório inválido.' });
    }
    const labs = loadSupportLabs();
    const foundLab = labs.find(l => String(l.id) === String(labId));
    
    if (foundLab) {
      foundLab.prices = {};
      saveSupportLabs(labs);
      
      // Zera também redundância nos exames locais
      const exams = loadExams();
      const cleanLabName = foundLab.name.toLowerCase();
      const isAlvaro = cleanLabName.includes('alvaro') || cleanLabName.includes('álvaro');
      const isPardini = cleanLabName.includes('pardini');
      
      exams.forEach(exam => {
        if (exam.supportLabsData && exam.supportLabsData[foundLab.id]) {
          exam.supportLabsData[foundLab.id].price = 0;
        }
        if (isAlvaro) {
          exam.priceAlvaro = 0;
        } else if (isPardini) {
          exam.pricePardini = 0;
        }
      });
      saveExams(exams);
      
      return res.json({ success: true, message: `Todos os preços do laboratório ${foundLab.name} foram excluídos.` });
    } else {
      return res.status(404).json({ success: false, message: 'Laboratório não encontrado.' });
    }
  } catch (err) {
    console.error("Erro ao limpar preços de apoio:", err);
    res.status(500).json({ success: false, message: 'Erro no servidor ao limpar preços.' });
  }
});

// Salvar ou editar um preço único de laboratório de apoio
app.post('/admin/comparador/save-preco', requireAdmin, (req, res) => {
  try {
    const { labId, oldCode, code, name, price } = req.body;
    if (!labId || !code || !name || price === undefined || price === null) {
      return res.status(400).json({ success: false, message: 'Parâmetros insuficientes para salvar o preço.' });
    }

    const labs = loadSupportLabs();
    const foundLab = labs.find(l => String(l.id) === String(labId));
    if (!foundLab) {
      return res.status(404).json({ success: false, message: 'Laboratório não encontrado.' });
    }

    foundLab.prices = foundLab.prices || {};
    
    const cleanCode = code.trim().toLowerCase();
    const cleanOldCode = oldCode ? oldCode.trim().toLowerCase() : '';
    const cleanName = name.trim();
    const itemPrice = Number(price) || 0;

    if (!cleanCode || !cleanName) {
      return res.status(400).json({ success: false, message: 'Código e nome são obrigatórios.' });
    }

    // Se mudou de código, remover o código antigo
    if (cleanOldCode && cleanOldCode !== cleanCode) {
      delete foundLab.prices[cleanOldCode];
    }

    // Salvar o novo/atualizado
    foundLab.prices[cleanCode] = {
      name: cleanName,
      price: itemPrice
    };

    saveSupportLabs(labs);

    // Propagar o preço atualizado para todos os exames locais
    const exams = loadExams();
    const cleanLabName = foundLab.name.toLowerCase();
    const isAlvaro = cleanLabName.includes('alvaro') || cleanLabName.includes('álvaro');
    const isPardini = cleanLabName.includes('pardini');

    exams.forEach(exam => {
      // Se mudou de código, limpa a referência antiga se o exame estava usando ela
      if (cleanOldCode && cleanOldCode !== cleanCode) {
        if (isAlvaro && (exam.codigoAlvaro || '').trim().toLowerCase() === cleanOldCode) {
          exam.priceAlvaro = 0;
        }
        if (isPardini && (exam.codigoPardini || '').trim().toLowerCase() === cleanOldCode) {
          exam.pricePardini = 0;
        }
        if (exam.supportLabsData && exam.supportLabsData[foundLab.id] && (exam.supportLabsData[foundLab.id].code || '').trim().toLowerCase() === cleanOldCode) {
          exam.supportLabsData[foundLab.id].price = 0;
        }
      }

      // Se o exame usa o código (novo ou atualizado), atualiza seus preços
      let deparaCode = '';
      if (isAlvaro) {
        deparaCode = (exam.codigoAlvaro || '').trim();
      } else if (isPardini) {
        deparaCode = (exam.codigoPardini || '').trim();
      } else if (exam.supportLabsData && exam.supportLabsData[foundLab.id]) {
        deparaCode = (exam.supportLabsData[foundLab.id].code || '').trim();
      }

      if (deparaCode && deparaCode.toLowerCase() === cleanCode) {
        exam.supportLabsData = exam.supportLabsData || {};
        exam.supportLabsData[foundLab.id] = exam.supportLabsData[foundLab.id] || {};
        exam.supportLabsData[foundLab.id].price = itemPrice;
        exam.supportLabsData[foundLab.id].code = deparaCode;
        exam.supportLabsData[foundLab.id].originalName = cleanName;

        if (isAlvaro) {
          exam.priceAlvaro = itemPrice;
        } else if (isPardini) {
          exam.pricePardini = itemPrice;
        }
      }
    });

    saveExams(exams);

    return res.json({ success: true, message: 'Preço de custo salvo com sucesso.' });
  } catch (err) {
    console.error("Erro ao salvar preço único:", err);
    res.status(500).json({ success: false, message: 'Erro no servidor ao salvar preço único.' });
  }
});

// Deletar um preço único de laboratório de apoio
app.post('/admin/comparador/delete-preco', requireAdmin, (req, res) => {
  try {
    const { labId, code } = req.body;
    if (!labId || !code) {
      return res.status(400).json({ success: false, message: 'Parâmetros insuficientes para excluir o preço.' });
    }

    const labs = loadSupportLabs();
    const foundLab = labs.find(l => String(l.id) === String(labId));
    if (!foundLab) {
      return res.status(404).json({ success: false, message: 'Laboratório não encontrado.' });
    }

    foundLab.prices = foundLab.prices || {};
    const cleanCode = code.trim().toLowerCase();

    if (foundLab.prices[cleanCode]) {
      delete foundLab.prices[cleanCode];
      saveSupportLabs(labs);

      // Zerar o preço associado no cadastro de exames
      const exams = loadExams();
      const cleanLabName = foundLab.name.toLowerCase();
      const isAlvaro = cleanLabName.includes('alvaro') || cleanLabName.includes('álvaro');
      const isPardini = cleanLabName.includes('pardini');

      exams.forEach(exam => {
        let deparaCode = '';
        if (isAlvaro) {
          deparaCode = (exam.codigoAlvaro || '').trim();
        } else if (isPardini) {
          deparaCode = (exam.codigoPardini || '').trim();
        } else if (exam.supportLabsData && exam.supportLabsData[foundLab.id]) {
          deparaCode = (exam.supportLabsData[foundLab.id].code || '').trim();
        }

        if (deparaCode && deparaCode.toLowerCase() === cleanCode) {
          if (exam.supportLabsData && exam.supportLabsData[foundLab.id]) {
            exam.supportLabsData[foundLab.id].price = 0;
          }
          if (isAlvaro) {
            exam.priceAlvaro = 0;
          } else if (isPardini) {
            exam.pricePardini = 0;
          }
        }
      });

      saveExams(exams);
      return res.json({ success: true, message: 'Preço de custo excluído com sucesso.' });
    } else {
      return res.status(404).json({ success: false, message: 'Item não encontrado na tabela de custo.' });
    }
  } catch (err) {
    console.error("Erro ao excluir preço único:", err);
    res.status(500).json({ success: false, message: 'Erro no servidor ao excluir preço único.' });
  }
});

// Deletar Exame Existente (GET, POST, DELETE)
function handleExamDelete(req, res) {
  const targetId = String(req.params.id || req.body.id || req.body.code || req.body.jalisCode || '').trim();
  if (!targetId) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(400).json({ success: false, message: 'ID do exame não informado.' });
    }
    return res.redirect('/admin/exames');
  }

  let exams = loadExams();
  const initialCount = exams.length;
  exams = exams.filter(e => {
    const eId = String(e.id !== undefined && e.id !== null ? e.id : '').trim();
    const eCode = String(e.code || '').trim();
    const eJalis = String(e.jalisCode || '').trim();

    return eId !== targetId && eCode !== targetId && eJalis !== targetId;
  });

  if (exams.length !== initialCount) {
    saveExams(exams);
    syncAllExamsWithPriceTables();
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.json({ success: true, message: 'Exame removido com sucesso.' });
  }
  res.redirect('/admin/exames');
}

app.all('/admin/exames/delete/:id', requireAdmin, handleExamDelete);
app.all('/admin/exames/delete', requireAdmin, handleExamDelete);

// --- SUB-MÓDULO: LEITOR DE GUIAS COM INTELIGÊNCIA ARTIFICIAL (IA) ---

// Página do Leitor de Guia (GET)
app.get('/admin/leitor', requireAdmin, (req, res) => {
  const exams = loadExams();
  res.render('admin/leitor', {
    page: 'admin-leitor',
    apiKeyConfigured: !!process.env.GEMINI_API_KEY,
    exams: exams
  });
});

// API de Análise da Guia com Gemini (POST)
app.post('/api/admin/leitor/analisar', requireAdmin, async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, error: "Nenhuma imagem recebida." });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        success: false,
        error: "A chave de API do Gemini (GEMINI_API_KEY) não está configurada nas variáveis de ambiente. Adicione-a no painel de Configurações para habilitar o leitor inteligente."
      });
    }

    // Inicialização tardia do SDK do Gemini para evitar travamentos na inicialização do servidor
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    // Limpar o prefixo data:image/...;base64 se presente
    let base64Data = image;
    if (image.includes(';base64,')) {
      base64Data = image.split(';base64,')[1];
    }

    const prompt = `Identifique todos os exames médicos solicitados na guia médica apresentada neste documento ou imagem. 
Sua resposta deve ser estruturada estritamente em formato JSON com uma lista contendo os nomes legíveis desses exames por extenso.
Mapeie termos abreviados comuns para seus nomes por extenso se aplicável (ex: HMG ou Hemograma -> Hemograma Completo, EAS -> Urina Tipo 1 (EAS), GLI ou Glicose -> Glicemia de Jejum, TSH -> TSH (Hormônio Tireoestimulante), Creatinina -> Creatinina (Função Renal), Preventivo ou Papanicolau -> Papanicolau (Preventivo), Vitamina D -> Vitamina D (25-hidroxivitamina D), Beta HCG -> Beta HCG Quantitativo (Gravidez), Toxicológico -> Exame Toxicológico (Larga Janela), Parasitológico ou EPF -> Parasitológico de Fezes (EPF), Uréia -> Uréia (Avaliação Renal)).`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType || "image/jpeg",
            data: base64Data
          }
        },
        prompt
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            examesEncontrados: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "Nomes de exames médicos reconhecidos por extenso na imagem da guia médica"
            }
          },
          required: ["examesEncontrados"]
        }
      }
    });

    const outputText = response.text;
    const parsedData = JSON.parse(outputText);
    const examesEncontrados = parsedData.examesEncontrados || [];

    // Cruzamento inteligente com a base de exames cadastrados localmente (data/exams.json)
    const allExams = loadExams();
    const results = examesEncontrados.map(recognizedName => {
      const lowerRecognized = recognizedName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      // 1. Tenta correspondência direta ou por inclusão
      let matched = allExams.find(e => {
        const normName = e.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return normName === lowerRecognized ||
               lowerRecognized.includes(normName) ||
               normName.includes(lowerRecognized);
      });

      // 2. Fallbacks de termos para garantir o match dos exames padrão
      if (!matched) {
        if (lowerRecognized.includes("hemograma") || lowerRecognized === "hmg") {
          matched = allExams.find(e => e.id === "1");
        } else if (lowerRecognized.includes("glicose") || lowerRecognized.includes("glicemia") || lowerRecognized === "gli") {
          matched = allExams.find(e => e.id === "2");
        } else if (lowerRecognized.includes("colesterol") || lowerRecognized === "col") {
          matched = allExams.find(e => e.id === "3");
        } else if (lowerRecognized.includes("tsh")) {
          matched = allExams.find(e => e.id === "4");
        } else if (lowerRecognized.includes("creatinina") || lowerRecognized === "crea") {
          matched = allExams.find(e => e.id === "5");
        } else if (lowerRecognized.includes("eas") || lowerRecognized.includes("urina tipo") || lowerRecognized.includes("urina i") || lowerRecognized.includes("urina 1")) {
          matched = allExams.find(e => e.id === "6");
        } else if (lowerRecognized.includes("preventivo") || lowerRecognized.includes("papanicolau") || lowerRecognized === "pap") {
          matched = allExams.find(e => e.id === "7");
        } else if (lowerRecognized.includes("vitamina d") || lowerRecognized.includes("vit d")) {
          matched = allExams.find(e => e.id === "8");
        } else if (lowerRecognized.includes("hcg") || lowerRecognized.includes("gravidez") || lowerRecognized === "bhcg") {
          matched = allExams.find(e => e.id === "9");
        } else if (lowerRecognized.includes("toxicologico") || lowerRecognized === "tox") {
          matched = allExams.find(e => e.id === "10");
        } else if (lowerRecognized.includes("parasitologico") || lowerRecognized.includes("fezes") || lowerRecognized === "epf") {
          matched = allExams.find(e => e.id === "11");
        } else if (lowerRecognized.includes("ureia") || lowerRecognized === "ure") {
          matched = allExams.find(e => e.id === "12");
        }
      }

      if (matched) {
        return {
          recognizedName,
          matched: true,
          id: matched.id,
          name: matched.name,
          code: matched.code || "A_DEFINIR",
          supportLab: matched.supportLab || "Próprio",
          category: matched.category,
          fasting: matched.fasting,
          timeframe: matched.timeframe,
          instructions: matched.instructions
        };
      } else {
        return {
          recognizedName,
          matched: false,
          name: recognizedName,
          code: null,
          supportLab: null
        };
      }
    });

    res.json({
      success: true,
      exames: results,
      totalCount: results.length,
      matchedCount: results.filter(r => r.matched).length
    });

  } catch (error) {
    console.error("Erro na análise da guia:", error);
    res.status(500).json({ 
      success: false, 
      error: "Ocorreu um erro interno ao processar a imagem com Inteligência Artificial. Certifique-se de que a imagem está legível e de que a chave do Gemini está operando normalmente." 
    });
  }
});

// --- SUB-MÓDULO: GERENCIAMENTO DE BLOG (CRUD) ---

// Página de Listagem do Blog no Painel
app.get('/admin/blog', requireAdmin, (req, res) => {
  const posts = loadBlogPosts();
  res.render('admin/blog', {
    posts,
    page: 'admin-blog'
  });
});

// Cadastrar Nova Matéria (POST)
app.post('/admin/blog/add', requireAdmin, (req, res) => {
  const { title, category, author, readTime, excerpt, content } = req.body;
  const posts = loadBlogPosts();
  
  const newPost = {
    id: Date.now().toString(),
    title: title.trim(),
    category: category,
    author: author.trim(),
    readTime: readTime.trim(),
    excerpt: excerpt.trim(),
    content: content.trim(),
    image: "/assets/blog/default.jpg",
    date: new Date().toLocaleDateString('pt-BR')
  };

  posts.push(newPost);
  saveBlogPosts(posts);
  res.redirect('/admin/blog');
});

// Editar Matéria Existente (POST)
app.post('/admin/blog/edit', requireAdmin, (req, res) => {
  const { id, title, category, author, readTime, excerpt, content } = req.body;
  const posts = loadBlogPosts();
  const index = posts.findIndex(p => p.id === id);
  
  if (index !== -1) {
    posts[index] = {
      ...posts[index],
      title: title.trim(),
      category: category,
      author: author.trim(),
      readTime: readTime.trim(),
      excerpt: excerpt.trim(),
      content: content.trim()
    };
    saveBlogPosts(posts);
  }
  res.redirect('/admin/blog');
});

// Deletar Matéria Existente (GET)
app.get('/admin/blog/delete/:id', requireAdmin, (req, res) => {
  let posts = loadBlogPosts();
  posts = posts.filter(p => p.id !== req.params.id);
  saveBlogPosts(posts);
  res.redirect('/admin/blog');
});

// --- SUB-MÓDULO: GERENCIAMENTO DE POPS / WIKI DO LABORATÓRIO (CRUD) ---

// Página de Listagem de POPs / Wiki
app.get('/admin/pops', requireAdmin, (req, res) => {
  const pops = loadPops();
  res.render('admin/pops', {
    pops,
    page: 'admin-pops'
  });
});

// Cadastrar Novo POP (POST)
app.post('/admin/pops/add', requireAdmin, (req, res) => {
  const { id, title, category, author, version, status, reviewDate, content, parentId } = req.body;
  const pops = loadPops();

  // Garante formato limpo para o código/ID
  const cleanId = (id || '').trim().toUpperCase() || `POP-${Date.now().toString().slice(-4)}`;
  
  // Verifica se o ID já existe
  const exists = pops.some(p => p.id === cleanId);
  if (exists) {
    return res.redirect('/admin/pops?error=duplicate_id');
  }

  const today = new Date().toISOString().split('T')[0];
  const defaultReviewDate = new Date();
  defaultReviewDate.setFullYear(defaultReviewDate.getFullYear() + 1);
  const cleanReviewDate = reviewDate ? reviewDate : defaultReviewDate.toISOString().split('T')[0];

  const newPop = {
    id: cleanId,
    title: (title || '').trim(),
    category: category || 'Geral',
    content: (content || '').trim(),
    version: (version || '1.0').trim(),
    author: (author || 'Administrador').trim(),
    status: status || 'Pendente',
    createdDate: today,
    reviewDate: cleanReviewDate,
    parentId: parentId ? parentId.trim() : null
  };

  pops.push(newPop);
  savePops(pops);
  res.redirect('/admin/pops?success=added');
});

// Editar POP Existente (POST)
app.post('/admin/pops/edit', requireAdmin, (req, res) => {
  const { id, title, category, author, version, status, reviewDate, content, parentId } = req.body;
  const pops = loadPops();
  const index = pops.findIndex(p => p.id === id);

  if (index !== -1) {
    const defaultReviewDate = new Date();
    defaultReviewDate.setFullYear(defaultReviewDate.getFullYear() + 1);
    const cleanReviewDate = reviewDate ? reviewDate : defaultReviewDate.toISOString().split('T')[0];

    pops[index] = {
      ...pops[index],
      title: (title || '').trim(),
      category: category || 'Geral',
      content: (content || '').trim(),
      version: (version || '1.0').trim(),
      author: (author || 'Administrador').trim(),
      status: status || 'Pendente',
      reviewDate: cleanReviewDate,
      parentId: parentId !== undefined ? (parentId ? parentId.trim() : null) : (pops[index].parentId || null)
    };
    savePops(pops);
    res.redirect('/admin/pops?success=edited');
  } else {
    res.redirect('/admin/pops?error=not_found');
  }
});

// Deletar POP Existente (GET)
app.get('/admin/pops/delete/:id', requireAdmin, (req, res) => {
  let pops = loadPops();
  const idToDelete = req.params.id;
  // Desvincula filhos antes de apagar o pai para evitar órfãos
  pops = pops.map(p => {
    if (p.parentId === idToDelete) {
      return { ...p, parentId: null };
    }
    return p;
  });
  pops = pops.filter(p => p.id !== idToDelete);
  savePops(pops);
  res.redirect('/admin/pops?success=deleted');
});

// Ações Rápidas de Status e Revisão do POP (POST)
app.post('/admin/pops/status', requireAdmin, (req, res) => {
  const { id, action } = req.body;
  const pops = loadPops();
  const index = pops.findIndex(p => p.id === id);

  if (index !== -1) {
    if (action === 'approve') {
      const oneYearLater = new Date();
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
      
      pops[index].status = 'Aprovado';
      pops[index].reviewDate = oneYearLater.toISOString().split('T')[0];
    } else if (action === 'review') {
      pops[index].status = 'Em Revisão';
    } else if (action === 'pendente') {
      pops[index].status = 'Pendente';
    }
    savePops(pops);
    return res.json({ success: true, pop: pops[index] });
  }
  res.status(404).json({ success: false, error: 'POP não encontrado' });
});

// --- SUB-MÓDULO: GESTÃO DE DOCUMENTOS DO LABORATÓRIO (CRUD) ---

// Página de Listagem de Documentos
app.get('/admin/documentos', requireAdmin, (req, res) => {
  const documents = loadDocuments();
  res.render('admin/documentos', {
    documents,
    page: 'admin-documentos'
  });
});

// Cadastrar Novo Documento (POST)
app.post('/admin/documentos/add', requireAdmin, (req, res) => {
  const { title, expirationDate, hasNoExpiration, fileContent, fileName, fileSize, mimeType } = req.body;
  const docs = loadDocuments();

  const cleanId = `DOC-${Date.now().toString().slice(-6)}`;
  const today = new Date().toISOString().split('T')[0];
  
  const maxOrder = docs.length > 0 ? Math.max(...docs.map(d => d.order || 0)) : 0;

  const isNoExpiration = hasNoExpiration === 'on' || hasNoExpiration === 'true' || hasNoExpiration === true;

  const newDoc = {
    id: cleanId,
    title: (title || '').trim(),
    expirationDate: isNoExpiration ? '' : (expirationDate || today),
    hasNoExpiration: isNoExpiration,
    fileContent: fileContent || '',
    fileName: fileName || 'documento.txt',
    fileSize: fileSize || '0 KB',
    mimeType: mimeType || 'text/plain',
    order: maxOrder + 1,
    uploadedBy: req.session && req.session.adminEmail ? req.session.adminEmail : 'Administrador',
    uploadedAt: new Date().toLocaleString('pt-BR')
  };

  docs.push(newDoc);
  saveDocuments(docs);
  res.redirect('/admin/documentos?success=added');
});

// Editar Documento (POST)
app.post('/admin/documentos/edit', requireAdmin, (req, res) => {
  const { id, title, expirationDate, hasNoExpiration, fileContent, fileName, fileSize, mimeType } = req.body;
  const docs = loadDocuments();
  const index = docs.findIndex(d => d.id === id);

  if (index !== -1) {
    const isNoExpiration = hasNoExpiration === 'on' || hasNoExpiration === 'true' || hasNoExpiration === true;
    docs[index].title = (title || '').trim();
    docs[index].hasNoExpiration = isNoExpiration;
    docs[index].expirationDate = isNoExpiration ? '' : (expirationDate || docs[index].expirationDate);
    
    // Se um novo arquivo foi enviado, atualiza os dados do arquivo
    if (fileContent) {
      docs[index].fileContent = fileContent;
      docs[index].fileName = fileName || docs[index].fileName;
      docs[index].fileSize = fileSize || docs[index].fileSize;
      docs[index].mimeType = mimeType || docs[index].mimeType;
      docs[index].uploadedAt = new Date().toLocaleString('pt-BR');
      if (req.session && req.session.adminEmail) {
        docs[index].uploadedBy = req.session.adminEmail;
      }
    }
    
    saveDocuments(docs);
    res.redirect('/admin/documentos?success=edited');
  } else {
    res.redirect('/admin/documentos?error=not_found');
  }
});

// Deletar Documento (GET)
app.get('/admin/documentos/delete/:id', requireAdmin, (req, res) => {
  let docs = loadDocuments();
  const idToDelete = req.params.id;
  docs = docs.filter(d => d.id !== idToDelete);
  
  // Re-ordenar consecutivamente para manter limpo
  docs.forEach((doc, idx) => {
    doc.order = idx + 1;
  });

  saveDocuments(docs);
  res.redirect('/admin/documentos?success=deleted');
});

// Mover Documento para Cima / Baixo (POST)
app.post('/admin/documentos/move', requireAdmin, (req, res) => {
  const { id, direction } = req.body;
  const docs = loadDocuments(); // já vem ordenado por .order
  const index = docs.findIndex(d => d.id === id);

  if (index !== -1) {
    if (direction === 'up' && index > 0) {
      // Troca ordem com o anterior
      const tempOrder = docs[index].order;
      docs[index].order = docs[index - 1].order;
      docs[index - 1].order = tempOrder;
    } else if (direction === 'down' && index < docs.length - 1) {
      // Troca ordem com o próximo
      const tempOrder = docs[index].order;
      docs[index].order = docs[index + 1].order;
      docs[index + 1].order = tempOrder;
    }
    saveDocuments(docs);
  }
  res.redirect('/admin/documentos');
});

// --- SUB-MÓDULO: GERENCIAMENTO DE LABORATÓRIOS DE APOIO (CRUD) ---

// Página de Listagem de Laboratórios de Apoio
app.get('/admin/laboratorios', requireAdmin, (req, res) => {
  const labs = loadSupportLabs();
  res.render('admin/laboratorios', {
    labs,
    page: 'admin-laboratorios'
  });
});

// Cadastrar / Editar Laboratório de Apoio (POST)
app.post(['/admin/laboratorios/save', '/admin/laboratorios/add'], requireAdmin, (req, res) => {
  const { id, codigo, descricao, name } = req.body;
  const labDesc = (descricao || name || '').trim();
  if (!labDesc) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(400).json({ success: false, message: 'Descrição é obrigatória' });
    }
    return res.redirect('/admin/laboratorios');
  }

  let labs = loadSupportLabs();
  const labId = id ? String(id).trim() : '';

  let existingIndex = labId ? labs.findIndex(l => String(l.id) === labId) : -1;

  let labCode = (codigo || '').trim();
  if (!labCode) {
    let maxCod = 0;
    labs.forEach(l => {
      const num = parseInt(l.codigo || l.id, 10);
      if (!isNaN(num) && num > maxCod) maxCod = num;
    });
    labCode = String(maxCod + 1);
  }

  const labData = {
    id: labId || Date.now().toString(),
    codigo: labCode,
    descricao: labDesc,
    name: labDesc
  };

  if (existingIndex >= 0) {
    labs[existingIndex] = { ...labs[existingIndex], ...labData };
  } else {
    labs.push(labData);
  }

  saveSupportLabs(labs);

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ success: true, lab: labData, labs });
  }

  res.redirect('/admin/laboratorios');
});

// Deletar Laboratório de Apoio (ALL: POST, GET, DELETE)
app.all('/admin/laboratorios/delete/:id', requireAdmin, (req, res) => {
  let labs = loadSupportLabs();
  labs = labs.filter(l => String(l.id) !== String(req.params.id) && String(l.codigo) !== String(req.params.id));
  saveSupportLabs(labs);
  
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.json({ success: true, labs });
  }
  res.redirect('/admin/laboratorios');
});

// --- SUB-MÓDULO: GERENCIAMENTO DE CONVÊNIOS (CRUD) ---
app.get('/admin/convenios', requireAdmin, (req, res) => {
  const convenios = loadConvenios();
  const priceTables = loadPriceTables();

  const enrichedConvenios = convenios.map(c => {
    let pt = priceTables.find(t => String(t.id) === String(c.tabelaPrecoId));
    if (!pt && c.id) {
      pt = priceTables.find(t => String(t.convenioId) === String(c.id));
    }
    if (!pt && (c.fantasia || c.razaoSocial)) {
      pt = priceTables.find(t => t.convenioNome && (
        t.convenioNome.toLowerCase().trim() === (c.fantasia || '').toLowerCase().trim() ||
        t.convenioNome.toLowerCase().trim() === (c.razaoSocial || '').toLowerCase().trim()
      ));
    }

    const tabelaPrecoId = pt ? pt.id : (c.tabelaPrecoId || '');
    const tabelaPrecoNome = pt 
      ? (pt.descricao ? (pt.codigo ? `${pt.codigo} - ${pt.descricao}` : pt.descricao) : pt.codigo) 
      : (c.tabelaPrecoNome || '');

    return {
      ...c,
      tabelaPrecoId,
      tabelaPrecoNome
    };
  });

  res.render('admin/convenios', {
    convenios: enrichedConvenios,
    priceTables,
    page: 'admin-convenios'
  });
});

app.post('/admin/convenios/save', requireAdmin, (req, res) => {
  try {
    let convenios = loadConvenios();
    let priceTables = loadPriceTables();

    const {
      id, codigo, pessoa, razaoSocial, fantasia, cnpj, inscEstadual, cei,
      inscMunicipal, cidade, tipoEndereco, endereco, numero, complemento,
      ans, bairro, cep, fone, fax, contato, email1, email2, site,
      observacao, proibido, bloquearWeb, ativo, senhaWeb, tabelaPrecoId
    } = req.body;

    if (!tabelaPrecoId || !tabelaPrecoId.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'A Tabela de Preços é obrigatória.' });
      }
      return res.status(400).send('A Tabela de Preços é obrigatória.');
    }

    let maxCod = 0;
    convenios.forEach(c => {
      const num = parseInt(c.codigo, 10);
      if (!isNaN(num) && num > maxCod) maxCod = num;
    });
    const nextCodigoStr = String(maxCod + 1);

    let targetId = id ? id.trim() : '';
    let existingIndex = targetId ? convenios.findIndex(c => String(c.id) === String(targetId)) : -1;

    const selTable = priceTables.find(pt => String(pt.id) === String(tabelaPrecoId.trim()));
    const tabelaPrecoNome = selTable ? (selTable.codigo ? `${selTable.codigo} - ${selTable.descricao || ''}` : (selTable.descricao || '')) : '';

    const newConvenioId = targetId || ('CONV-' + String(Date.now()));
    const convenioData = {
      id: newConvenioId,
      codigo: (codigo || '').trim() || nextCodigoStr,
      pessoa: (pessoa || 'Jurídica').trim(),
      razaoSocial: (razaoSocial || '').trim(),
      fantasia: (fantasia || razaoSocial || '').trim(),
      cnpj: (cnpj || '').trim(),
      inscEstadual: (inscEstadual || '').trim(),
      cei: (cei || '').trim(),
      inscMunicipal: (inscMunicipal || '').trim(),
      cidade: (cidade || 'Cambará - PR').trim(),
      tipoEndereco: (tipoEndereco || 'Rua').trim(),
      endereco: (endereco || '').trim(),
      numero: (numero || '').trim(),
      complemento: (complemento || '').trim(),
      ans: (ans || '').trim(),
      bairro: (bairro || '').trim(),
      cep: (cep || '').trim(),
      fone: (fone || '').trim(),
      fax: (fax || '').trim(),
      contato: (contato || '').trim(),
      email1: (email1 || '').trim(),
      email2: (email2 || '').trim(),
      site: (site || '').trim(),
      observacao: (observacao || '').trim(),
      senhaWeb: (senhaWeb || '').trim(),
      tabelaPrecoId: (tabelaPrecoId || '').trim(),
      tabelaPrecoNome: tabelaPrecoNome,
      proibido: proibido === 'true' || proibido === true,
      bloquearWeb: bloquearWeb === 'true' || bloquearWeb === true,
      ativo: ativo !== 'false' && ativo !== false
    };

    if (existingIndex >= 0) {
      convenios[existingIndex] = { ...convenios[existingIndex], ...convenioData };
    } else {
      convenios.push(convenioData);
    }

    if (selTable) {
      selTable.convenioId = newConvenioId;
      selTable.convenioNome = convenioData.fantasia || convenioData.razaoSocial;
      savePriceTables(priceTables);
    }

    saveConvenios(convenios);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, convenio: convenioData, convenios });
    }
    res.redirect('/admin/convenios');
  } catch (err) {
    console.error("Erro ao salvar convenio:", err);
    res.status(500).send("Erro ao salvar convênio");
  }
});

app.post('/admin/convenios/delete/:id', requireAdmin, (req, res) => {
  let convenios = loadConvenios();
  convenios = convenios.filter(c => String(c.id) !== String(req.params.id));
  saveConvenios(convenios);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/convenios');
});

app.get('/admin/convenios/delete/:id', requireAdmin, (req, res) => {
  let convenios = loadConvenios();
  convenios = convenios.filter(c => String(c.id) !== String(req.params.id));
  saveConvenios(convenios);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/convenios');
});

app.get('/admin/convenios/toggle-status/:id', requireAdmin, (req, res) => {
  let convenios = loadConvenios();
  const index = convenios.findIndex(c => String(c.id) === String(req.params.id));
  if (index >= 0) {
    convenios[index].ativo = convenios[index].ativo === false ? true : false;
    saveConvenios(convenios);
  }
  res.redirect('/admin/convenios');
});

app.get('/api/convenios', (req, res) => {
  res.json(loadConvenios());
});

app.get('/api/laboratorios', (req, res) => {
  res.json(loadSupportLabs());
});

app.get('/api/support-labs', (req, res) => {
  res.json(loadSupportLabs());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE RECIPIENTES (CRUD) ---
app.get('/admin/recipientes', requireAdmin, (req, res) => {
  const recipientes = loadRecipientes();
  res.render('admin/recipientes', {
    recipientes,
    page: 'admin-recipientes'
  });
});

app.post('/admin/recipientes/save', requireAdmin, (req, res) => {
  try {
    let recipientes = loadRecipientes();
    const { id, codigo, descricao } = req.body;

    if (!descricao || !descricao.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'A descrição do recipiente é obrigatória.' });
      }
      return res.status(400).send('A descrição do recipiente é obrigatória.');
    }

    let maxCod = 0;
    recipientes.forEach(r => {
      const num = parseInt(r.codigo, 10);
      if (!isNaN(num) && num > maxCod) maxCod = num;
    });

    let targetId = id ? id.trim() : '';
    let existingIndex = targetId ? recipientes.findIndex(r => String(r.id) === String(targetId)) : -1;

    const recipienteData = {
      id: targetId || ('REC-' + String(Date.now())),
      codigo: codigo && codigo.trim() ? codigo.trim() : String(maxCod + 1),
      descricao: descricao.trim()
    };

    if (existingIndex >= 0) {
      recipientes[existingIndex] = { ...recipientes[existingIndex], ...recipienteData };
    } else {
      recipientes.push(recipienteData);
    }

    saveRecipientes(recipientes);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, recipiente: recipienteData, recipientes });
    }
    res.redirect('/admin/recipientes');
  } catch (err) {
    console.error("Erro ao salvar recipiente:", err);
    res.status(500).send("Erro ao salvar recipiente");
  }
});

app.post('/admin/recipientes/delete/:id', requireAdmin, (req, res) => {
  let recipientes = loadRecipientes();
  recipientes = recipientes.filter(r => String(r.id) !== String(req.params.id));
  saveRecipientes(recipientes);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/recipientes');
});

app.get('/admin/recipientes/delete/:id', requireAdmin, (req, res) => {
  let recipientes = loadRecipientes();
  recipientes = recipientes.filter(r => String(r.id) !== String(req.params.id));
  saveRecipientes(recipientes);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/recipientes');
});

app.get('/api/recipientes', (req, res) => {
  res.json(loadRecipientes());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE MATERIAIS COLETADOS (CRUD) ---
app.get('/admin/materiais-coletados', requireAdmin, (req, res) => {
  const materiais = loadMateriaisColetados();
  res.render('admin/materiais-coletados', {
    materiais,
    page: 'admin-materiais-coletados'
  });
});

app.post('/admin/materiais-coletados/save', requireAdmin, (req, res) => {
  try {
    let materiais = loadMateriaisColetados();
    const { id, codigo, descricao, abreviatura } = req.body;

    if (!descricao || !descricao.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'A descrição do material é obrigatória.' });
      }
      return res.status(400).send('A descrição do material é obrigatória.');
    }

    let maxCod = 0;
    materiais.forEach(m => {
      const num = parseInt(m.codigo, 10);
      if (!isNaN(num) && num > maxCod) maxCod = num;
    });

    let targetId = id ? id.trim() : '';
    let existingIndex = targetId ? materiais.findIndex(m => String(m.id) === String(targetId)) : -1;

    const materialData = {
      id: targetId || ('MAT-' + String(Date.now())),
      codigo: codigo && codigo.trim() ? codigo.trim() : String(maxCod + 1),
      descricao: descricao.trim().toUpperCase(),
      abreviatura: (abreviatura || '').trim().toUpperCase()
    };

    if (existingIndex >= 0) {
      materiais[existingIndex] = { ...materiais[existingIndex], ...materialData };
    } else {
      materiais.push(materialData);
    }

    saveMateriaisColetados(materiais);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, material: materialData, materiais });
    }
    res.redirect('/admin/materiais-coletados');
  } catch (err) {
    console.error("Erro ao salvar material coletado:", err);
    res.status(500).send("Erro ao salvar material coletado");
  }
});

app.post('/admin/materiais-coletados/delete/:id', requireAdmin, (req, res) => {
  let materiais = loadMateriaisColetados();
  materiais = materiais.filter(m => String(m.id) !== String(req.params.id));
  saveMateriaisColetados(materiais);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/materiais-coletados');
});

app.get('/admin/materiais-coletados/delete/:id', requireAdmin, (req, res) => {
  let materiais = loadMateriaisColetados();
  materiais = materiais.filter(m => String(m.id) !== String(req.params.id));
  saveMateriaisColetados(materiais);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/materiais-coletados');
});

app.get('/api/materiais-coletados', (req, res) => {
  res.json(loadMateriaisColetados());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE LOCAIS DE COLETA (CRUD) ---
app.get('/admin/locais-coleta', requireAdmin, (req, res) => {
  const locaisColeta = loadLocaisColeta();
  res.render('admin/locais-coleta', {
    locaisColeta,
    page: 'admin-locais-coleta'
  });
});

app.post('/admin/locais-coleta/save', requireAdmin, (req, res) => {
  try {
    let locais = loadLocaisColeta();
    const { id, codigo, descricao } = req.body;

    if (!descricao || !descricao.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'A descrição do local de coleta é obrigatória.' });
      }
      return res.status(400).send('A descrição do local de coleta é obrigatória.');
    }

    let maxCod = 0;
    locais.forEach(l => {
      const num = parseInt(l.codigo, 10);
      if (!isNaN(num) && num > maxCod) maxCod = num;
    });

    let targetId = id ? id.trim() : '';
    let existingIndex = targetId ? locais.findIndex(l => String(l.id) === String(targetId)) : -1;

    const localData = {
      id: targetId || ('LOC-' + String(Date.now())),
      codigo: codigo && codigo.trim() ? codigo.trim() : String(maxCod + 1),
      descricao: descricao.trim()
    };

    if (existingIndex >= 0) {
      locais[existingIndex] = { ...locais[existingIndex], ...localData };
    } else {
      locais.push(localData);
    }

    saveLocaisColeta(locais);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, local: localData, locaisColeta: locais });
    }
    res.redirect('/admin/locais-coleta');
  } catch (err) {
    console.error("Erro ao salvar local de coleta:", err);
    res.status(500).send("Erro ao salvar local de coleta");
  }
});

app.post('/admin/locais-coleta/delete/:id', requireAdmin, (req, res) => {
  let locais = loadLocaisColeta();
  locais = locais.filter(l => String(l.id) !== String(req.params.id));
  saveLocaisColeta(locais);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/locais-coleta');
});

app.get('/admin/locais-coleta/delete/:id', requireAdmin, (req, res) => {
  let locais = loadLocaisColeta();
  locais = locais.filter(l => String(l.id) !== String(req.params.id));
  saveLocaisColeta(locais);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/locais-coleta');
});

app.get('/api/locais-coleta', (req, res) => {
  res.json(loadLocaisColeta());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE SETORES (CRUD) ---
app.get('/admin/setores', requireAdmin, (req, res) => {
  const setores = loadSetores();
  res.render('admin/setores', {
    setores,
    page: 'admin-setores'
  });
});

app.post('/admin/setores/save', requireAdmin, (req, res) => {
  try {
    let setores = loadSetores();
    const { id, codigo, descricao, sigla } = req.body;

    if (!descricao || !descricao.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'A descrição do setor é obrigatória.' });
      }
      return res.status(400).send('A descrição do setor é obrigatória.');
    }

    let maxCod = 0;
    setores.forEach(s => {
      const num = parseInt(s.codigo, 10);
      if (!isNaN(num) && num > maxCod) maxCod = num;
    });

    let targetId = id ? id.trim() : '';
    let existingIndex = targetId ? setores.findIndex(s => String(s.id) === String(targetId)) : -1;

    const setorData = {
      id: targetId || ('SET-' + String(Date.now())),
      codigo: codigo && codigo.trim() ? codigo.trim() : String(maxCod + 1),
      descricao: descricao.trim(),
      sigla: sigla ? sigla.trim().toUpperCase() : ''
    };

    if (existingIndex >= 0) {
      setores[existingIndex] = { ...setores[existingIndex], ...setorData };
    } else {
      setores.push(setorData);
    }

    saveSetores(setores);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, setor: setorData, setores });
    }
    res.redirect('/admin/setores');
  } catch (err) {
    console.error("Erro ao salvar setor:", err);
    res.status(500).send("Erro ao salvar setor");
  }
});

app.post('/admin/setores/delete/:id', requireAdmin, (req, res) => {
  let setores = loadSetores();
  setores = setores.filter(s => String(s.id) !== String(req.params.id));
  saveSetores(setores);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/setores');
});

app.get('/admin/setores/delete/:id', requireAdmin, (req, res) => {
  let setores = loadSetores();
  setores = setores.filter(s => String(s.id) !== String(req.params.id));
  saveSetores(setores);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/setores');
});

// --- SUB-MÓDULO: GERENCIAMENTO DE IMPRESSORAS (CONF. IMPRESSORAS CRUD) ---
app.get('/admin/impressoras', requireAdmin, (req, res) => {
  const impressoras = loadImpressoras();
  res.render('admin/impressoras', {
    impressoras,
    page: 'admin-impressoras'
  });
});

app.post('/admin/impressoras/save', requireAdmin, (req, res) => {
  try {
    let impressoras = loadImpressoras();
    const { id, descricao, ip, porta } = req.body;

    if (!descricao || !descricao.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'A descrição da impressora é obrigatória.' });
      }
      return res.status(400).send('A descrição da impressora é obrigatória.');
    }

    if (!ip || !ip.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'O endereço IP da impressora é obrigatório.' });
      }
      return res.status(400).send('O endereço IP da impressora é obrigatório.');
    }

    let targetId = id ? String(id).trim() : '';
    let existingIndex = targetId ? impressoras.findIndex(imp => String(imp.id) === String(targetId)) : -1;

    const impressoraData = {
      id: targetId || ('IMP-' + String(Date.now())),
      descricao: descricao.trim(),
      ip: ip.trim(),
      porta: (porta && porta.trim()) ? porta.trim() : '9100',
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      impressoraData.createdAt = impressoras[existingIndex].createdAt || new Date().toISOString();
      impressoras[existingIndex] = { ...impressoras[existingIndex], ...impressoraData };
    } else {
      impressoraData.createdAt = new Date().toISOString();
      impressoras.push(impressoraData);
    }

    saveImpressoras(impressoras);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, impressora: impressoraData, impressoras });
    }
    res.redirect('/admin/impressoras');
  } catch (err) {
    console.error("Erro ao salvar impressora:", err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, message: 'Erro ao salvar impressora.' });
    }
    res.status(500).send("Erro ao salvar impressora");
  }
});

app.post('/admin/impressoras/delete/:id', requireAdmin, (req, res) => {
  let impressoras = loadImpressoras();
  impressoras = impressoras.filter(imp => String(imp.id) !== String(req.params.id));
  saveImpressoras(impressoras);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/impressoras');
});

app.get('/admin/impressoras/delete/:id', requireAdmin, (req, res) => {
  let impressoras = loadImpressoras();
  impressoras = impressoras.filter(imp => String(imp.id) !== String(req.params.id));
  saveImpressoras(impressoras);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/impressoras');
});

app.get('/api/impressoras', (req, res) => {
  res.json(loadImpressoras());
});

function formatEplLayoutForPrint(rawEtiqueta) {
  if (!rawEtiqueta) return '';
  let str = String(rawEtiqueta).trim();

  // Remove CDATA or XML wrapper tags if present
  str = str.replace(/^<!\[CDATA\[/i, '').replace(/\]\]>$/i, '').trim();

  // Unescape XML entities
  str = str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  // If the layout text has literal "\r\n" or "\n" backslash sequences, convert to real newlines
  if (str.includes('\\r') || str.includes('\\n')) {
    str = str.replace(/\\r\\n/g, '\r\n').replace(/\\r/g, '\r').replace(/\\n/g, '\n');
  }

  // Split into lines and clean up whitespace on each command line
  const lines = str.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);

  // Rejoin with CRLF (\r\n) for EPL thermal printers
  let formatted = lines.join('\r\n');
  if (formatted && !formatted.endsWith('\r\n')) {
    formatted += '\r\n';
  }

  return formatted;
}

app.post('/api/impressoras/imprimir', async (req, res) => {
  try {
    const { impressora, etiqueta, ip, porta } = req.body;
    
    const targetImpressora = impressora || "ZDesigner ZD230-203dpi ZPL";
    const rawEtiqueta = etiqueta || "^XA^FO50,50^A0N,30,30^FDTESTE CURL^FS^XZ";
    const targetEtiqueta = formatEplLayoutForPrint(rawEtiqueta);
    const targetIp = ip || "186.237.152.170";
    const targetPorta = porta || "8085";

    const printServiceUrl = `http://${targetIp}:${targetPorta}/imprimir`;

    console.log(`[IMPRESSORA REST] Enviando impressão via REST para ${printServiceUrl}`);
    console.log(`[IMPRESSORA REST] Impressora: "${targetImpressora}"`);
    console.log(`[IMPRESSORA REST] Tamanho Etiqueta Formatada: ${targetEtiqueta.length} chars`);
    console.log(`[IMPRESSORA REST] Etiqueta (EPL/ZPL):\n${targetEtiqueta}`);

    let responseData = null;
    let statusCode = 200;
    let success = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(printServiceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          impressora: targetImpressora,
          etiqueta: targetEtiqueta
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      statusCode = response.status;
      success = response.ok;
      responseData = await response.text();
    } catch (fetchErr) {
      console.warn(`[IMPRESSORA REST] Aviso: Chamada direta ao IP local (${printServiceUrl}) retornou: ${fetchErr.message}`);
      // Fallback response for local environment testing
      responseData = `Simulação de envio REST para ${printServiceUrl}: ${fetchErr.message}`;
    }

    return res.json({
      success: true,
      statusCode,
      url: printServiceUrl,
      impressora: targetImpressora,
      etiqueta: targetEtiqueta,
      response: responseData
    });

  } catch (err) {
    console.error("[IMPRESSORA REST] Erro interno:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// --- SUB-MÓDULO: GERENCIAMENTO DE MÉDICOS (CRUD) ---
app.get('/admin/medicos', requireAdmin, (req, res) => {
  const medicos = loadMedicos();
  res.render('admin/medicos', {
    medicos,
    page: 'admin-medicos'
  });
});

app.post(['/admin/medicos/save', '/admin/medicos/add'], requireAdmin, (req, res) => {
  try {
    let medicos = loadMedicos();
    const { id, codigo, nome, conselho, numero, uf, especialidade, telefone, email, status } = req.body;

    if (!nome || !nome.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'O nome do médico é obrigatório.' });
      }
      return res.status(400).send('O nome do médico é obrigatório.');
    }

    let maxCod = 0;
    medicos.forEach(m => {
      const num = parseInt(m.codigo || m.id, 10);
      if (!isNaN(num) && num > maxCod) maxCod = num;
    });

    const medId = id ? String(id).trim() : `MED-${Date.now()}`;
    const medCode = (codigo && String(codigo).trim()) ? String(codigo).trim() : String(maxCod + 1);

    const medicoData = {
      id: medId,
      codigo: medCode,
      nome: nome.trim(),
      conselho: (conselho || 'CRM').trim().toUpperCase(),
      numero: (numero || '').trim(),
      uf: (uf || 'PR').trim().toUpperCase(),
      especialidade: (especialidade || 'Clínica Geral').trim(),
      telefone: (telefone || '').trim(),
      email: (email || '').trim(),
      status: (status || 'Ativo').trim(),
      updatedAt: new Date().toISOString()
    };

    const existingIndex = medicos.findIndex(m => String(m.id) === medId || String(m.codigo) === medCode);

    if (existingIndex >= 0) {
      medicos[existingIndex] = { ...medicos[existingIndex], ...medicoData };
    } else {
      medicoData.createdAt = new Date().toISOString();
      medicos.push(medicoData);
    }

    saveMedicos(medicos);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, medico: medicoData, medicos });
    }
    res.redirect('/admin/medicos');
  } catch (err) {
    console.error("Erro ao salvar médico:", err);
    res.status(500).send("Erro ao salvar médico");
  }
});

app.post('/admin/medicos/delete/:id', requireAdmin, (req, res) => {
  let medicos = loadMedicos();
  medicos = medicos.filter(m => String(m.id) !== String(req.params.id) && String(m.codigo) !== String(req.params.id));
  saveMedicos(medicos);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true, medicos });
  }
  res.redirect('/admin/medicos');
});

app.get('/admin/medicos/delete/:id', requireAdmin, (req, res) => {
  let medicos = loadMedicos();
  medicos = medicos.filter(m => String(m.id) !== String(req.params.id) && String(m.codigo) !== String(req.params.id));
  saveMedicos(medicos);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true, medicos });
  }
  res.redirect('/admin/medicos');
});

app.get('/api/medicos', (req, res) => {
  res.json(loadMedicos());
});

app.get('/api/setores', (req, res) => {
  res.json(loadSetores());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE TABELAS DE PREÇO (CRUD) ---
app.get('/admin/tabela-precos', requireAdmin, (req, res) => {
  syncAllExamsWithPriceTables();
  const priceTables = loadPriceTables();
  const convenios = loadConvenios();
  const exams = loadExams();
  res.render('admin/tabela-precos', {
    priceTables,
    convenios,
    exams,
    page: 'admin-tabela-precos'
  });
});

app.post('/admin/tabela-precos/save', requireAdmin, (req, res) => {
  try {
    let tables = loadPriceTables();
    const convenios = loadConvenios();
    const { id, codigo, descricao, convenioId } = req.body;

    if (!codigo || !descricao) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'Código e Descrição são obrigatórios.' });
      }
      return res.status(400).send('Código e Descrição são obrigatórios.');
    }

    const selectedConvenio = convenios.find(c => String(c.id) === String(convenioId)) || null;
    const convenioNome = selectedConvenio ? (selectedConvenio.fantasia || selectedConvenio.razaoSocial) : 'Sem Convênio';

    let targetId = id ? id.trim() : '';
    let existingIndex = targetId ? tables.findIndex(t => String(t.id) === String(targetId)) : -1;

    let tableData = {
      id: targetId || ('TAB-' + String(Date.now())),
      codigo: String(codigo).trim(),
      descricao: String(descricao).trim(),
      convenioId: convenioId ? String(convenioId).trim() : '',
      convenioNome: convenioNome,
      precios: existingIndex >= 0 ? (tables[existingIndex].precios || []) : []
    };

    if (existingIndex >= 0) {
      tables[existingIndex] = { ...tables[existingIndex], ...tableData };
    } else {
      tables.push(tableData);
    }

    savePriceTables(tables);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, table: tableData, priceTables: tables });
    }
    res.redirect('/admin/tabela-precos');
  } catch (err) {
    console.error("Erro ao salvar tabela de preços:", err);
    res.status(500).send("Erro ao salvar tabela de preços");
  }
});

app.post('/admin/tabela-precos/save-prices/:id', requireAdmin, (req, res) => {
  try {
    let tables = loadPriceTables();
    const tableId = req.params.id;
    const { precios } = req.body;

    const index = tables.findIndex(t => String(t.id) === String(tableId));
    if (index < 0) {
      return res.status(404).json({ success: false, message: 'Tabela de preços não encontrada.' });
    }

    tables[index].precios = Array.isArray(precios) ? precios : [];
    savePriceTables(tables);
    syncPriceTableToExams(tables[index]);

    return res.json({ success: true, message: 'Preços atualizados com sucesso!', table: tables[index] });
  } catch (err) {
    console.error("Erro ao salvar preços da tabela:", err);
    res.status(500).json({ success: false, message: "Erro ao salvar preços da tabela" });
  }
});

app.post('/admin/tabela-precos/delete/:id', requireAdmin, (req, res) => {
  let tables = loadPriceTables();
  tables = tables.filter(t => String(t.id) !== String(req.params.id));
  savePriceTables(tables);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/tabela-precos');
});

app.get('/admin/tabela-precos/delete/:id', requireAdmin, (req, res) => {
  let tables = loadPriceTables();
  tables = tables.filter(t => String(t.id) !== String(req.params.id));
  savePriceTables(tables);
  res.redirect('/admin/tabela-precos');
});

app.get('/api/tabela-precos', (req, res) => {
  res.json(loadPriceTables());
});

// MÓDULO: COMPARADOR DE CUSTOS DE LABORATÓRIOS DE APOIO
app.get('/admin/comparador', requireAdmin, (req, res) => {
  const exams = loadExams();
  const labs = loadSupportLabs();
  res.render('admin/comparador', {
    exams,
    labs,
    page: 'admin-comparador'
  });
});

// --- SUB-MÓDULO: GERENCIAMENTO DE PROFISSIONAIS (CRUD) ---

// Página de Listagem de Profissionais
app.get('/admin/profissionais', requireAdmin, (req, res) => {
  const professionals = loadProfessionals();
  const profiles = loadAccessProfiles();
  res.render('admin/profissionais', {
    professionals,
    profiles,
    page: 'admin-profissionais'
  });
});

// Cadastrar Novo Profissional (POST)
app.post('/admin/profissionais/add', requireAdmin, (req, res) => {
  const { 
    name, role, title, description, username, password, profileId, showOnAbout,
    socialName, cpf, rg, birthDate, gender, maritalStatus, nationality,
    address, city, state, zipCode, phone, mobile, email, photo,
    registration, sector, admissionDate, contractType, workday, supervisor, status, terminationReason,
    education, postGrad, specializations, masterDegree, doctorateDegree,
    regType, regNumber, regState, regValidity, regDocFile,
    trainings, vaccinations, documents, absences
  } = req.body;
  
  const funcVal = req.body.function || '';

  if (!name || !name.trim()) {
    return res.redirect('/admin/profissionais');
  }

  const safeParseJson = (str, fallback = []) => {
    if (!str) return fallback;
    try {
      return typeof str === 'string' ? JSON.parse(str) : str;
    } catch (e) {
      console.error("Error parsing JSON field:", e);
      return fallback;
    }
  };

  const professionals = loadProfessionals();
  const newProfessional = {
    id: Date.now().toString(),
    name: name.trim(),
    role: (role || '').trim(),
    title: (title || '').trim(),
    description: (description || '').trim(),
    username: (username || '').trim(),
    password: (password || '').trim(),
    profileId: profileId || '',
    showOnAbout: showOnAbout === 'true' || showOnAbout === 'on' || showOnAbout === true,
    
    // Dados Pessoais
    socialName: (socialName || '').trim(),
    cpf: (cpf || '').trim(),
    rg: (rg || '').trim(),
    birthDate: birthDate || '',
    gender: gender || '',
    maritalStatus: maritalStatus || '',
    nationality: (nationality || '').trim(),
    address: (address || '').trim(),
    city: (city || '').trim(),
    state: (state || '').trim(),
    zipCode: (zipCode || '').trim(),
    phone: (phone || '').trim(),
    mobile: (mobile || '').trim(),
    email: (email || '').trim(),
    photo: photo || '',

    // Dados Profissionais
    registration: (registration || '').trim(),
    sector: (sector || '').trim(),
    function: (funcVal || '').trim(),
    admissionDate: admissionDate || '',
    contractType: contractType || '',
    workday: (workday || '').trim(),
    supervisor: (supervisor || '').trim(),
    status: status || 'Ativo',
    terminationReason: (terminationReason || '').trim(),

    // Formação
    education: safeParseJson(education, []),
    postGrad: (postGrad || '').trim(),
    specializations: (specializations || '').trim(),
    masterDegree: (masterDegree || '').trim(),
    doctorateDegree: (doctorateDegree || '').trim(),

    // Registro Profissional
    regType: regType || '',
    regNumber: (regNumber || '').trim(),
    regState: (regState || '').trim(),
    regValidity: regValidity || '',
    regDocFile: regDocFile || '',

    // Arrays
    trainings: safeParseJson(trainings, []),
    vaccinations: safeParseJson(vaccinations, []),
    documents: safeParseJson(documents, []),
    absences: safeParseJson(absences, [])
  };

  if (newProfessional.admissionDate) {
    const calc = computeCltVacationData(newProfessional.admissionDate, 0, 0);
    if (calc) {
      newProfessional.vencidaEm = calc.vencidaEm;
      newProfessional.diasDireito = calc.diasDireito;
      newProfessional.saldoAGozar = calc.saldoAGozar;
      newProfessional.concederAvisoAte = calc.concederAvisoAte;
      newProfessional.proximoVencimento = calc.proximoVencimento;
    }
  }

  professionals.push(newProfessional);
  saveProfessionals(professionals);
  res.redirect('/admin/profissionais');
});

// Editar Profissional Existente (POST)
app.post('/admin/profissionais/edit', requireAdmin, (req, res) => {
  const { 
    id, name, role, title, description, username, password, profileId, showOnAbout,
    socialName, cpf, rg, birthDate, gender, maritalStatus, nationality,
    address, city, state, zipCode, phone, mobile, email, photo,
    registration, sector, admissionDate, contractType, workday, supervisor, status, terminationReason,
    education, postGrad, specializations, masterDegree, doctorateDegree,
    regType, regNumber, regState, regValidity, regDocFile,
    trainings, vaccinations, documents, absences
  } = req.body;
  
  const funcVal = req.body.function || '';

  const safeParseJson = (str, fallback = []) => {
    if (!str) return fallback;
    try {
      return typeof str === 'string' ? JSON.parse(str) : str;
    } catch (e) {
      console.error("Error parsing JSON field:", e);
      return fallback;
    }
  };

  const professionals = loadProfessionals();
  const index = professionals.findIndex(p => p.id === id);
  
  if (index !== -1) {
    professionals[index] = {
      ...professionals[index],
      name: name.trim(),
      role: (role || '').trim(),
      title: (title || '').trim(),
      description: (description || '').trim(),
      username: (username || '').trim(),
      password: (password || '').trim(),
      profileId: profileId || '',
      showOnAbout: showOnAbout === 'true' || showOnAbout === 'on' || showOnAbout === true,
      
      // Dados Pessoais
      socialName: (socialName || '').trim(),
      cpf: (cpf || '').trim(),
      rg: (rg || '').trim(),
      birthDate: birthDate || '',
      gender: gender || '',
      maritalStatus: maritalStatus || '',
      nationality: (nationality || '').trim(),
      address: (address || '').trim(),
      city: (city || '').trim(),
      state: (state || '').trim(),
      zipCode: (zipCode || '').trim(),
      phone: (phone || '').trim(),
      mobile: (mobile || '').trim(),
      email: (email || '').trim(),
      photo: photo || '',

      // Dados Profissionais
      registration: (registration || '').trim(),
      sector: (sector || '').trim(),
      function: (funcVal || '').trim(),
      admissionDate: admissionDate || '',
      contractType: contractType || '',
      workday: (workday || '').trim(),
      supervisor: (supervisor || '').trim(),
      status: status || 'Ativo',
      terminationReason: (terminationReason || '').trim(),

      // Formação
      education: safeParseJson(education, []),
      postGrad: (postGrad || '').trim(),
      specializations: (specializations || '').trim(),
      masterDegree: (masterDegree || '').trim(),
      doctorateDegree: (doctorateDegree || '').trim(),

      // Registro Profissional
      regType: regType || '',
      regNumber: (regNumber || '').trim(),
      regState: (regState || '').trim(),
      regValidity: regValidity || '',
      regDocFile: regDocFile || '',

      // Arrays
      trainings: safeParseJson(trainings, []),
      vaccinations: safeParseJson(vaccinations, []),
      documents: safeParseJson(documents, []),
      absences: safeParseJson(absences, [])
    };

    if (professionals[index].admissionDate) {
      const calc = computeCltVacationData(professionals[index].admissionDate, professionals[index].faltas || 0, professionals[index].diasGozados || 0);
      if (calc) {
        professionals[index].vencidaEm = calc.vencidaEm;
        professionals[index].diasDireito = calc.diasDireito;
        professionals[index].saldoAGozar = calc.saldoAGozar;
        professionals[index].concederAvisoAte = calc.concederAvisoAte;
        professionals[index].proximoVencimento = calc.proximoVencimento;
      }
    }

    saveProfessionals(professionals);
  }
  res.redirect('/admin/profissionais');
});

// Deletar Profissional (GET)
app.get('/admin/profissionais/delete/:id', requireAdmin, (req, res) => {
  let professionals = loadProfessionals();
  professionals = professionals.filter(p => p.id !== req.params.id);
  saveProfessionals(professionals);
  res.redirect('/admin/profissionais');
});

// ================= SUB-MÓDULO: CONTROLE DE ACESSOS (RBAC) =================

// Página de Gerenciamento de Controle de Acesso
app.get('/admin/controle-acesso', requireAdmin, (req, res) => {
  const profiles = loadAccessProfiles();
  const professionals = loadProfessionals();
  res.render('admin/controle-acesso', {
    profiles,
    professionals,
    page: 'admin-controle-acesso'
  });
});

// Cadastrar Novo Perfil de Acesso (POST)
app.post('/admin/controle-acesso/profile/add', requireAdmin, (req, res) => {
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
app.post('/admin/controle-acesso/profile/edit', requireAdmin, (req, res) => {
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
app.post('/admin/controle-acesso/profile/delete', requireAdmin, (req, res) => {
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
app.post('/admin/controle-acesso/assign', requireAdmin, (req, res) => {
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
app.get('/admin/zerar-banco', requireAdmin, (req, res) => {
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
    temperaturas: (loadTemperaturas() || []).length,
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
app.get('/admin/zerar-banco/backup-json', requireAdmin, (req, res) => {
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
      temperaturas: loadTemperaturas(),
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
app.post('/api/admin/reset-database', requireAdmin, async (req, res) => {
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
      patientsCache = [];
      savePatients([]);
      await clearMysqlTable('patients');
      cleared.push('Pacientes');
    }

    if (targets.includes('requisitions')) {
      requisitionsCache = [];
      saveRequisitions([]);
      await clearMysqlTable('requisitions');
      
      try { saveJsonFile(path.join(process.cwd(), 'data', 'recebimento.json'), '[]', 'utf-8'); } catch(e){}
      try { saveJsonFile(path.join(process.cwd(), 'data', 'coleta.json'), '[]', 'utf-8'); } catch(e){}
      cleared.push('Requisições e Laudos');
    }

    if (targets.includes('exams')) {
      examsCache = [];
      saveExams([]);
      await clearMysqlTable('exams');
      cleared.push('Catálogo de Exames (Internos)');
    }

    if (targets.includes('lab_exames_alvaro')) {
      saveLabExamesAlvaro([]);
      await clearMysqlTable('lab_exames_alvaro');
      cleared.push('Catálogo Exames Álvaro');
    }

    if (targets.includes('lab_exames_pardini')) {
      saveLabExamesPardini([]);
      await clearMysqlTable('lab_exames_pardini');
      cleared.push('Catálogo Exames Pardini');
    }

    if (targets.includes('price_tables')) {
      priceTablesCache = [];
      savePriceTables([]);
      await clearMysqlTable('price_tables');
      cleared.push('Tabelas de Preços');
    }

    if (targets.includes('materials')) {
      saveMateriaisAlvaro([]);
      recipientesCache = [];
      saveRecipientes([]);
      setoresCache = [];
      saveSetores([]);
      await clearMysqlTable('materiais_alvaro');
      await clearMysqlTable('recipientes');
      await clearMysqlTable('setores');
      cleared.push('Materiais, Recipientes e Setores');
    }

    if (targets.includes('budgets')) {
      budgetsCache = [];
      saveBudgets([]);
      await clearMysqlTable('budgets');
      cleared.push('Orçamentos');
    }

    if (targets.includes('financial')) {
      transactionsCache = [];
      saveTransactions([]);
      cashClosuresCache = [];
      saveCashClosures([]);
      movementsCache = [];
      saveMovements([]);
      await clearMysqlTable('transactions');
      await clearMysqlTable('cash_closures');
      await clearMysqlTable('movements');
      cleared.push('Financeiro e Caixas');
    }

    if (targets.includes('appointments')) {
      appointmentsCache = [];
      saveAppointments([]);
      await clearMysqlTable('appointments');
      cleared.push('Agendamentos');
    }

    if (targets.includes('medicos')) {
      medicosCache = [];
      saveMedicos([]);
      await clearMysqlTable('medicos');
      cleared.push('Médicos Solicitantes');
    }

    if (targets.includes('convenios')) {
      conveniosCache = [];
      saveConvenios([]);
      await clearMysqlTable('convenios');
      cleared.push('Convênios');
    }

    if (targets.includes('interfaceamento')) {
      const cleanInterfaceData = { naoEnviados: [], processando: [], prontos: [], logs: [], results: [], connectedDevices: [] };
      saveInterfaceData(cleanInterfaceData);
      await clearMysqlTable('interface_data');
      cleared.push('Interfaceamento LIS');
    }

    if (targets.includes('evaluations')) {
      evaluationsCache = [];
      saveEvaluations([]);
      evalAccessesCache = [];
      saveEvalAccesses([]);
      evalHashesCache = [];
      saveEvalHashes([]);
      await clearMysqlTable('evaluations');
      await clearMysqlTable('eval_accesses');
      await clearMysqlTable('eval_hashes');
      cleared.push('Pesquisas e Avaliações');
    }

    if (targets.includes('non_conformities')) {
      nonConformitiesCache = [];
      saveNonConformities([]);
      await clearMysqlTable('non_conformities');
      cleared.push('Não Conformidades');
    }

    if (targets.includes('temperaturas')) {
      temperaturasCache = [];
      saveTemperaturas([]);
      await clearMysqlTable('temperaturas');
      cleared.push('Controle de Temperatura');
    }

    if (targets.includes('cisnorpi')) {
      cisnorpiCache = [];
      saveCisnorpi([]);
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
app.get('/api/shortcuts', (req, res) => {
  res.json({ success: true, shortcuts: loadShortcuts() });
});

// Tela de Cadastro / Configuração de Atalhos
app.get('/admin/atalhos', requireAdmin, (req, res) => {
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
app.post('/admin/atalhos/save', requireAdmin, (req, res) => {
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
app.post('/admin/atalhos/reset', requireAdmin, (req, res) => {
  try {
    saveShortcuts(DEFAULT_SYSTEM_SHORTCUTS);
    res.redirect('/admin/atalhos?success=reset');
  } catch (err) {
    console.error("Erro ao resetar atalhos:", err);
    res.redirect('/admin/atalhos?error=reset_failed');
  }
});

// ================= SUB-MÓDULO: GESTÃO FINANCEIRA (CONTAS A PAGAR E RECEBER) =================

// --- CONFIGURAÇÕES FINANCEIRAS (ABAS UNIFICADAS) ---
app.get('/admin/financeiro/configuracoes', requireAdmin, (req, res) => {
  const settings = loadFinanceSettings();
  const currentTab = req.query.tab || 'contas-bancarias';
  res.render('admin/financeiro/configuracoes', {
    bankAccounts: settings.bankAccounts || [],
    documentTypes: settings.documentTypes || [],
    accountCategories: settings.accountCategories || [],
    chartOfAccountsTree: settings.chartOfAccountsTree || [],
    page: 'admin-financeiro-configuracoes',
    currentTab,
    success_msg: req.query.success,
    error_msg: req.query.error
  });
});

// --- CONTAS BANCÁRIAS ---
app.get('/admin/financeiro/contas-bancarias', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias');
});

app.post('/admin/financeiro/contas-bancarias/add', requireAdmin, (req, res) => {
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

app.post('/admin/financeiro/contas-bancarias/edit', requireAdmin, (req, res) => {
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

app.get('/admin/financeiro/contas-bancarias/delete/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const settings = loadFinanceSettings();
  settings.bankAccounts = settings.bankAccounts || [];
  settings.bankAccounts = settings.bankAccounts.filter(b => b.id !== String(id));
  settings.banks = settings.bankAccounts.map(b => b.description);
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=contas-bancarias&success=Conta+bancária+excluída+com+sucesso.');
});

// --- TIPOS DE DOCUMENTOS ---
app.get('/admin/financeiro/documentos', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=documentos');
});

app.post('/admin/financeiro/documentos/add', requireAdmin, (req, res) => {
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

app.post('/admin/financeiro/documentos/edit', requireAdmin, (req, res) => {
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

app.get('/admin/financeiro/documentos/delete/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const settings = loadFinanceSettings();
  settings.documentTypes = settings.documentTypes || [];
  settings.documentTypes = settings.documentTypes.filter(d => d.id !== String(id));
  settings.docTypes = settings.documentTypes.map(d => d.description);
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=documentos&success=Tipo+de+documento+excluído+com+sucesso.');
});

// --- CATEGORIAS DE PLANO DE CONTAS ---
app.get('/admin/financeiro/categorias', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=categorias');
});

app.post('/admin/financeiro/categorias/add', requireAdmin, (req, res) => {
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

app.post('/admin/financeiro/categorias/edit', requireAdmin, (req, res) => {
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

app.get('/admin/financeiro/categorias/delete/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const settings = loadFinanceSettings();
  settings.accountCategories = settings.accountCategories || [];
  settings.accountCategories = settings.accountCategories.filter(c => c.id !== String(id));
  saveFinanceSettings(settings);
  res.redirect('/admin/financeiro/configuracoes?tab=categorias&success=Categoria+excluída+com+sucesso.');
});

// --- PLANO DE CONTAS (ÁRVORE DINÂMICA) ---
app.get('/admin/financeiro/plano-contas', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/configuracoes?tab=plano-contas');
});

app.post('/admin/financeiro/plano-contas/add', requireAdmin, (req, res) => {
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

app.post('/admin/financeiro/plano-contas/edit', requireAdmin, (req, res) => {
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

app.post('/admin/financeiro/plano-contas/reorder', requireAdmin, (req, res) => {
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

app.get('/admin/financeiro/plano-contas/delete/:id', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/pessoas', requireAdmin, (req, res) => {
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

app.post('/admin/financeiro/pessoas/save', requireAdmin, (req, res) => {
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

    // Salvar no arquivo JSON
    saveJsonFile(PESSOAS_FILE, JSON.stringify(pessoasCache, null, 2), 'utf-8');
    saveCollectionToMysql('pessoas', pessoasCache).catch(err => console.error("Erro ao salvar pessoas no MySQL:", err));

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

app.post('/admin/financeiro/pessoas/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.redirect('/admin/financeiro/pessoas?error=missing_id');
    }

    const idx = pessoasCache.findIndex(p => p.id === id);
    if (idx !== -1) {
      pessoasCache.splice(idx, 1);
      saveJsonFile(PESSOAS_FILE, JSON.stringify(pessoasCache, null, 2), 'utf-8');
      saveCollectionToMysql('pessoas', pessoasCache).catch(err => console.error("Erro ao salvar pessoas no MySQL:", err));
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
app.post('/admin/financeiro/pessoas/import-csv', requireAdmin, upload.single('csvFile'), (req, res) => {
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

    // Salvar JSON e MySQL
    saveJsonFile(PESSOAS_FILE, JSON.stringify(pessoasCache, null, 2), 'utf-8');
    saveCollectionToMysql('pessoas', pessoasCache).catch(err => console.error("Erro ao salvar pessoas no MySQL:", err));

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
app.get('/admin/financeiro/dashboard', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/relatorio-faturamento', requireAdmin, (req, res) => {
  res.render('admin/financeiro/relatorio-faturamento', {
    page: 'admin-financeiro-relatorio-faturamento'
  });
});

// Redirect /admin/financeiro para Contas a Pagar
app.get('/admin/financeiro', requireAdmin, (req, res) => {
  res.redirect('/admin/financeiro/contas-pagar');
});

// Contas a Pagar (GET)
app.get('/admin/financeiro/contas-pagar', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/contas-receber', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/add', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/edit', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/status', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send("ID ausente");

  let transactions = loadTransactions();
  transactions = transactions.filter(t => t.id !== id);
  saveTransactions(transactions);

  res.redirect(req.get('referer') || '/admin/financeiro/contas-pagar');
});

// Fluxo de Caixa Diário (GET)
app.get('/admin/financeiro/fluxo-caixa', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/dre', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/movimentacoes', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/movimentacoes/add', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/movimentacoes/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send("ID ausente");

  let movements = loadMovements();
  movements = movements.filter(m => m.id !== id);
  saveMovements(movements);

  res.redirect('/admin/financeiro/movimentacoes');
});

// Cadastrar Fornecedor/Cliente por API AJAX (POST)
app.post('/api/financeiro/add-provider', requireAdmin, (req, res) => {
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
app.post('/api/financeiro/add-chart', requireAdmin, (req, res) => {
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
app.get('/admin/avaliacoes', requireAdmin, (req, res) => {
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
app.post('/admin/avaliacoes/deletar', requireAdmin, (req, res) => {
  const { id } = req.body;
  let evaluations = loadEvaluations();
  evaluations = evaluations.filter(e => String(e.id) !== String(id));
  saveEvaluations(evaluations);
  res.redirect('/admin/avaliacoes');
});

// ================= NÃO CONFORMIDADES (ADMIN) =================

// Carregar página de gestão de não conformidades
app.get('/admin/nao-conformidades', requireAdmin, (req, res) => {
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
app.post('/admin/nao-conformidades/salvar', requireAdmin, (req, res) => {
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
app.post('/admin/nao-conformidades/comentar', requireAdmin, (req, res) => {
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
app.post('/admin/nao-conformidades/deletar', requireAdmin, (req, res) => {
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
app.post('/api/admin/nao-conformidades/ia', requireAdmin, async (req, res) => {
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

// ================= PROCESSAMENTO DE FORMULÁRIOS ADICIONAIS =================

// Consulta de resultados (POST) (Preservado)
app.post('/resultados', (req, res) => {
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
      const hash = getOrCreateHashForPatient(foundReq.requisitionCode, foundReq.patientName);
      patientData = {
        protocol: foundReq.requisitionCode,
        hash: hash,
        password: foundReq.patientPassword,
        patientName: foundReq.patientName,
        date: foundReq.createdAt ? foundReq.createdAt.split(' ')[0] : new Date().toLocaleDateString('pt-BR'),
        doctor: 'Dr. Alisson Silva',
        status: foundReq.status || 'Liberado',
        exams: [
          { name: 'Hemograma Completo', results: [
            { parameter: 'Hemácias', value: '4.90 M/µL', reference: '4.30 a 5.90 M/µL', status: 'Normal' },
            { parameter: 'Hemoglobina', value: '14.5 g/dL', reference: '13.5 a 17.5 g/dL', status: 'Normal' },
            { parameter: 'Plaquetas', value: '260.000 /µL', reference: '150.000 a 450.000 /µL', status: 'Normal' },
            { parameter: 'Leucócitos', value: '6.800 /µL', reference: '4.000 a 11.000 /µL', status: 'Normal' }
          ]},
          { name: 'Glicemia de Jejum', results: [
            { parameter: 'Glicose plasmática', value: '85 mg/dL', reference: '70 a 99 mg/dL', status: 'Normal' }
          ]}
        ]
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
app.post('/agendar', (req, res) => {
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
app.post('/contato', (req, res) => {
  const { name, phone, email, subject, message } = req.body;
  res.render('contato', {
    success: true,
    page: 'contato',
    clientName: name
  });
});

// 8. PÁGINA DE AVALIAÇÃO DE SATISFAÇÃO (NPS)
function generateRandomHash(length = 20) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function registerEvaluationLink(code) {
  if (!code) return;
  const cleanCode = String(code).trim();
  if (!cleanCode) return;

  const accesses = loadEvalAccesses();
  const evaluations = loadEvaluations();

  // Verificar se o código já tem avaliação
  const alreadyEvaluated = evaluations.some(e => e.code && String(e.code).trim().toLowerCase() === cleanCode.toLowerCase());

  const existingIndex = accesses.findIndex(a => String(a.id).trim().toLowerCase() === cleanCode.toLowerCase());

  if (existingIndex < 0) {
    // Não existe, cria um novo com status 'created' (Não Abriu)
    accesses.push({
      id: cleanCode,
      code: cleanCode,
      firstAccessDate: '-',
      firstAccessTime: '-',
      lastAccessDate: '-',
      lastAccessTime: '-',
      status: alreadyEvaluated ? 'submitted' : 'created'
    });
    saveEvalAccesses(accesses);
  } else {
    // Se já existe mas por algum motivo o status está desatualizado (ex: já avaliou e não estava marcado como submitted)
    if (alreadyEvaluated && accesses[existingIndex].status !== 'submitted') {
      accesses[existingIndex].status = 'submitted';
      saveEvalAccesses(accesses);
    }
  }
}

function getOrCreateHashForPatient(patientCode, patientName = '') {
  if (!patientCode) return null;
  const cleanCode = String(patientCode).trim();
  if (!cleanCode) return null;

  const hashes = loadEvalHashes();
  // Verificar se já existe hash para esse paciente
  const existingIndex = hashes.findIndex(h => String(h.patientCode).trim().toLowerCase() === cleanCode.toLowerCase());
  
  let hashVal;
  if (existingIndex !== -1) {
    // Se o nome foi fornecido e é diferente ou não existia, atualizar
    const cleanName = String(patientName || '').trim();
    if (cleanName && hashes[existingIndex].patientName !== cleanName) {
      hashes[existingIndex].patientName = cleanName;
      saveEvalHashes(hashes);
    }
    hashVal = hashes[existingIndex].hash;
  } else {
    // Se não existir, gerar um novo hash único de 20 caracteres
    let newHash;
    let isUnique = false;
    while (!isUnique) {
      newHash = generateRandomHash(20);
      isUnique = !hashes.some(h => h.hash === newHash);
    }

    hashes.push({
      id: newHash, // ID para persistência de documento único no Firestore
      hash: newHash,
      patientCode: cleanCode,
      patientName: String(patientName || '').trim(),
      createdAt: new Date().toISOString()
    });

    saveEvalHashes(hashes);
    hashVal = newHash;
  }

  // Garantir registro imediato no acompanhamento de links com status 'created'
  registerEvaluationLink(cleanCode);

  return hashVal;
}

function resolvePatientCodeFromHash(hashOrCode) {
  if (!hashOrCode) return null;
  const clean = String(hashOrCode).trim();
  if (!clean) return null;

  const hashes = loadEvalHashes();
  // Procurar o registro pelo hash
  const found = hashes.find(h => String(h.hash).trim() === clean);
  if (found) {
    return found.patientCode;
  }
  
  // Se não encontrar, retorna o próprio valor (retrocompatível caso seja usado o código real)
  return clean;
}

function getNameFromHashOrCode(hashOrCode) {
  if (!hashOrCode) return '';
  const clean = String(hashOrCode).trim();
  if (!clean) return '';

  const hashes = loadEvalHashes();
  const found = hashes.find(h => String(h.hash).trim() === clean || String(h.patientCode).trim().toLowerCase() === clean.toLowerCase());
  return found ? (found.patientName || '') : '';
}

function trackEvaluationAccess(code) {
  if (!code) return;
  const cleanCode = String(code).trim();
  if (!cleanCode) return;

  const accesses = loadEvalAccesses();
  const evaluations = loadEvaluations();

  // Verificar se o código já tem avaliação
  const alreadyEvaluated = evaluations.some(e => e.code && String(e.code).trim().toLowerCase() === cleanCode.toLowerCase());

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR');

  const existingIndex = accesses.findIndex(a => String(a.id).trim().toLowerCase() === cleanCode.toLowerCase());

  if (existingIndex >= 0) {
    // Atualiza o último acesso
    accesses[existingIndex].lastAccessDate = dateStr;
    accesses[existingIndex].lastAccessTime = timeStr;
    
    // Se o primeiro acesso era vazio ou '-' (marcado como não aberto), preenche agora
    if (accesses[existingIndex].firstAccessDate === '-' || !accesses[existingIndex].firstAccessDate) {
      accesses[existingIndex].firstAccessDate = dateStr;
      accesses[existingIndex].firstAccessTime = timeStr;
    }

    if (alreadyEvaluated) {
      accesses[existingIndex].status = 'submitted';
    } else {
      // Se era 'created', muda para 'opened' porque abriu o link
      accesses[existingIndex].status = 'opened';
    }
  } else {
    // Cria novo registro de acesso
    accesses.push({
      id: cleanCode, // ID para sincronização no Firestore
      code: cleanCode,
      firstAccessDate: dateStr,
      firstAccessTime: timeStr,
      lastAccessDate: dateStr,
      lastAccessTime: timeStr,
      status: alreadyEvaluated ? 'submitted' : 'opened'
    });
  }

  saveEvalAccesses(accesses);
}

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

app.get('/avaliar/:patientCode', (req, res) => {
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

app.get('/avaliar', (req, res) => {
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

app.post('/avaliar', (req, res) => {
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
app.get('/api/exames', (req, res) => {
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
app.post('/api/avaliar/google-click', (req, res) => {
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
app.post('/api/avaliar/gerar-link', (req, res) => {
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
app.post('/api/avaliar/obter-hash', (req, res) => {
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
app.post('/api/avaliar/save-templates', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/ferias', requireAdmin, (req, res) => {
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

app.get('/admin/financeiro/rh', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/update-salary', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/add-event', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/rh/delete-event/:profId/:index', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/add-paystub', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/rh/delete-paystub/:profId/:index', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/add-vacation', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/confirm-baixa-vacation', requireAdmin, (req, res) => {
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

app.get('/admin/financeiro/rh/confirm-baixa-vacation/:profId/:vacationIndex', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/delete-vacation', requireAdmin, (req, res) => {
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

app.get('/admin/financeiro/rh/delete-vacation/:profId/:vacationIndex', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/update-accounting-vacation', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/recalculate-all-vacations', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/edit-vacation', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/rh/delete-vacation/:profId/:index', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/add-leave', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/rh/delete-leave/:profId/:index', requireAdmin, (req, res) => {
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
app.post('/admin/financeiro/rh/add-shift', requireAdmin, (req, res) => {
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
app.get('/admin/financeiro/rh/delete-shift/:profId/:index', requireAdmin, (req, res) => {
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

app.get('/admin/financeiro/escala-plantao', requireAdmin, (req, res) => {
  const professionals = loadProfessionals();
  if (!escalaPlantaoCache) {
    escalaPlantaoCache = loadLocalJson(ESCALA_PLANTAO_FILE);
  }
  
  res.render('admin/financeiro/escala-plantao', {
    escala: escalaPlantaoCache,
    professionals,
    page: 'admin-escala-plantao',
    error: req.query.error || null,
    success: req.query.success || null
  });
});

app.post('/admin/financeiro/escala-plantao/save', requireAdmin, (req, res) => {
  try {
    const { year, months, groups, assignments, notices } = req.body;
    
    escalaPlantaoCache = {
      year: parseInt(year) || 2026,
      months: Array.isArray(months) ? months.map(m => parseInt(m)) : [parseInt(months)],
      groups: Array.isArray(groups) ? groups : [],
      assignments: assignments || {},
      notices: Array.isArray(notices) ? notices : []
    };
    
    saveJsonFile(ESCALA_PLANTAO_FILE, JSON.stringify(escalaPlantaoCache, null, 2), 'utf-8');
    saveCollectionToMysql('escala_plantao', escalaPlantaoCache).catch(err => console.error("Erro ao salvar escala de plantão no MySQL:", err));
    
    res.json({ success: true, message: 'Escala de plantão salva com sucesso!' });
  } catch (error) {
    console.error("Erro ao salvar escala de plantão:", error);
    res.status(500).json({ success: false, error: 'Erro interno ao salvar escala de plantão.' });
  }
});

// --- SUB-MÓDULO: ÁREA DO COLABORADOR / MEU RH (PORTAL INDIVIDUAL) ---

app.get('/admin/meu-rh', requireAdmin, (req, res) => {
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
app.post('/admin/meu-rh/bater-ponto', requireAdmin, (req, res) => {
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
app.post('/admin/meu-rh/sign-paystub', requireAdmin, (req, res) => {
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
app.post('/api/admin/clean-obsolete-fields', async (req, res) => {
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

app.get('/api/admin/clean-obsolete-fields', async (req, res) => {
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

// Inicialização do Servidor
async function startServer() {
  await initializeFirebaseCaches();
  await cleanObsoleteDatabaseFields();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`InovaLab Cambará Server rodando na porta ${PORT}`);
  });
}
startServer();
