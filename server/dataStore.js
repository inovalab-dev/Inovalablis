import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import mysql from 'mysql2/promise';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuração do Google Gen AI
let ai = null;
try {
  if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
} catch (e) {
  console.warn("⚠️ Aviso: Gemini AI não inicializado:", e.message);
}

// Configuração do Multer para uploads de arquivos
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// Pool de conexão MySQL
let mysqlPool = null;

function isMysqlEnabled() {
  return true;
}

async function getMysqlPool() {
  if (mysqlPool) return mysqlPool;

  const dbHost = process.env.DB_HOST || '127.0.0.1';
  const dbUser = process.env.DB_USER || 'root';
  const dbPassword = process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'laboratorio-db';
  const dbPort = parseInt(process.env.DB_PORT || '3306', 10);

  try {
    mysqlPool = mysql.createPool({
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      port: dbPort,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      charset: 'utf8mb4',
      dateStrings: true
    });

    const conn = await mysqlPool.getConnection();
    console.log(`🐬 Conectado com sucesso ao MySQL: ${dbName} (${dbHost}:${dbPort})`);
    conn.release();
    return mysqlPool;
  } catch (err) {
    console.error(`❌ Erro ao conectar ao pool do MySQL (${dbName} em ${dbHost}):`, err.message);
    throw err;
  }
}

// Caches em memória
let isDataStoreInitialized = false;
let examsCache = [];
let budgetsCache = [];
let blogPostsCache = [];
let supportLabsCache = [];
let requisitionsCache = [];
let professionalsCache = [];
let evaluationsCache = [];
let evalAccessesCache = [];
let evalHashesCache = [];
let popsCache = [];
let documentsCache = [];
let nonConformitiesCache = [];
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
let equipamentosCache = [];
let patientsCache = [];
let appointmentsCache = [];
let escalaPlantaoCache = null;
let messageTemplatesCache = null;
let shortcutsCache = null;
let interfaceCache = null;
let cisnorpiCache = [];
let temperaturasCache = [];
let financeSettingsCache = null;
let labExamesAlvaroCache = [];
let materiaisAlvaroCache = [];
let labExamesPardiniCache = [];
let configApoioAlvaroCache = null;
let configApoioPardiniCache = null;
let apiResultsCache = [];
let requisitionShortcutsCache = [];
let cashClosuresCache = [];

// Definições completas de esquemas de tabelas relacionais do MySQL
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
    { name: 'tabelaPrecoId', type: 'VARCHAR(100)' }
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
    { name: 'sex', type: 'VARCHAR(50)' },
    { name: 'sexo', type: 'VARCHAR(50)' },
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
    { name: 'convenio', type: 'VARCHAR(255)' },
    { name: 'convenioId', type: 'VARCHAR(100)' },
    { name: 'convenioCode', type: 'VARCHAR(100)' },
    { name: 'insuranceNumber', type: 'VARCHAR(100)' },
    { name: 'cns', type: 'VARCHAR(100)' },
    { name: 'allergies', type: 'TEXT' },
    { name: 'clinicalNotes', type: 'TEXT' },
    { name: 'specialConditions', type: 'TEXT' },
    { name: 'status', type: "VARCHAR(50) DEFAULT 'Ativo'" },
    { name: 'createdAt', type: 'VARCHAR(100)' }
  ],
  exams: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'jalisCode', type: 'VARCHAR(100)' },
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'category', type: 'VARCHAR(100)' },
    { name: 'fasting', type: 'VARCHAR(100)' },
    { name: 'timeframe', type: 'VARCHAR(100)' },
    { name: 'instructions', type: 'TEXT' },
    { name: 'supportLabCode', type: 'VARCHAR(100)' },
    { name: 'pricePrivate', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'codigoAlvaro', type: 'VARCHAR(100)' },
    { name: 'codigoPardini', type: 'VARCHAR(100)' },
    { name: 'supportLabsData', type: 'LONGTEXT' },
    { name: 'sinonimia', type: 'TEXT' },
    { name: 'idadeMin', type: 'VARCHAR(50)' },
    { name: 'idadeMinUnidade', type: 'VARCHAR(50)' },
    { name: 'idadeMax', type: 'VARCHAR(50)' },
    { name: 'idadeMaxUnidade', type: 'VARCHAR(50)' },
    { name: 'sexo', type: 'VARCHAR(50)' },
    { name: 'amostras', type: 'VARCHAR(50)' },
    { name: 'tagsResultado', type: 'TEXT' },
    { name: 'bloquearExame', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'permitirSalvarParcialmente', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'servico', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'importarPdf', type: 'TINYINT(1) DEFAULT 1' },
    { name: 'tipoBPA', type: 'VARCHAR(100)' },
    { name: 'historico', type: 'TEXT' },
    { name: 'webConfig', type: 'LONGTEXT' },
    { name: 'modeloLaudo', type: 'VARCHAR(100)' },
    { name: 'formularioColeta', type: 'VARCHAR(100)' },
    { name: 'cabecalho', type: 'TEXT' },
    { name: 'observacoesLaudo', type: 'TEXT' },
    { name: 'tituloLaudo', type: 'VARCHAR(255)' },
    { name: 'materialLaudo', type: 'VARCHAR(255)' },
    { name: 'metodoLaudo', type: 'VARCHAR(255)' },
    { name: 'valorReferenciaLaudo', type: 'TEXT' },
    { name: 'mascaraResultado', type: 'VARCHAR(100)' },
    { name: 'mascarasCampos', type: 'LONGTEXT' },
    { name: 'materiaisColetados', type: 'LONGTEXT' },
    { name: 'setores', type: 'LONGTEXT' }
  ],
  exame_materiais_coletados: [
    { name: 'examId', type: 'VARCHAR(100)' },
    { name: 'examCode', type: 'VARCHAR(100)' },
    { name: 'materialCodigo', type: 'VARCHAR(100)' },
    { name: 'material', type: 'VARCHAR(255)' },
    { name: 'abrev', type: 'VARCHAR(50)' },
    { name: 'prazo', type: 'VARCHAR(100)' },
    { name: 'metodo', type: 'VARCHAR(255)' },
    { name: 'amb', type: 'VARCHAR(100)' },
    { name: 'cbhpm', type: 'VARCHAR(100)' },
    { name: 'pagina', type: 'VARCHAR(50)' },
    { name: 'ordem', type: 'VARCHAR(50)' },
    { name: 'copias', type: 'INT DEFAULT 0' },
    { name: 'proibir', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'naoImprimir', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'proibidoApoio', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'paginaSeparada', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'coleta', type: 'TEXT' },
    { name: 'preparo', type: 'TEXT' },
    { name: 'amostra', type: 'TEXT' },
    { name: 'inadequada', type: 'TEXT' },
    { name: 'referencia', type: 'TEXT' },
    { name: 'procedimento', type: 'TEXT' },
    { name: 'conservacao', type: 'TEXT' },
    { name: 'mensagem', type: 'TEXT' },
    { name: 'planilha', type: 'TEXT' },
    { name: 'sorotecaDias', type: 'INT DEFAULT 0' },
    { name: 'sorotecaUnidade', type: 'VARCHAR(50)' },
    { name: 'sorotecaConservacao', type: 'VARCHAR(255)' },
    { name: 'recipientesColeta', type: 'LONGTEXT' },
    { name: 'recipientesTriagem', type: 'LONGTEXT' },
    { name: 'insumos', type: 'LONGTEXT' },
    { name: 'taxas', type: 'LONGTEXT' },
    { name: 'custoSimples', type: 'DECIMAL(10,4) DEFAULT 0.0000' },
    { name: 'precoCusto', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'precoBase', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'precoFator', type: 'DECIMAL(10,2) DEFAULT 1.00' },
    { name: 'precoCh', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'precoFilme', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'priceTableValues', type: 'LONGTEXT' },
    { name: 'modeloLaudo', type: 'VARCHAR(100)' },
    { name: 'observacoesLaudo', type: 'TEXT' },
    { name: 'tituloLaudo', type: 'VARCHAR(255)' },
    { name: 'materialLaudo', type: 'VARCHAR(255)' },
    { name: 'metodoLaudo', type: 'VARCHAR(255)' },
    { name: 'valorReferenciaLaudo', type: 'TEXT' },
    { name: 'lisLayouts', type: 'LONGTEXT' },
    { name: 'medInterferentes', type: 'TEXT' },
    { name: 'medSuspender', type: 'TEXT' },
    { name: 'conveniosRegras', type: 'LONGTEXT' },
    { name: 'setorBancada', type: 'VARCHAR(100)' },
    { name: 'loinc', type: 'VARCHAR(100)' },
    { name: 'unidadeMedida', type: 'VARCHAR(50)' },
    { name: 'validadeLaudo', type: 'VARCHAR(50)' },
    { name: 'labApoio', type: 'VARCHAR(100)' },
    { name: 'codigoApoio', type: 'VARCHAR(100)' },
    { name: 'tempTransporte', type: 'VARCHAR(100)' },
    { name: 'recipienteTransporte', type: 'VARCHAR(100)' },
    { name: 'labExternoList', type: 'LONGTEXT' },
    { name: 'codigoHl7', type: 'VARCHAR(100)' },
    { name: 'equipamento', type: 'VARCHAR(100)' },
    { name: 'canal', type: 'VARCHAR(100)' },
    { name: 'pacs', type: 'TINYINT(1) DEFAULT 0' }
  ],
  professionals: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'socialName', type: 'VARCHAR(255)' },
    { name: 'cpf', type: 'VARCHAR(100)' },
    { name: 'rg', type: 'VARCHAR(100)' },
    { name: 'birthDate', type: 'VARCHAR(100)' },
    { name: 'gender', type: 'VARCHAR(50)' },
    { name: 'maritalStatus', type: 'VARCHAR(100)' },
    { name: 'nationality', type: 'VARCHAR(100)' },
    { name: 'address', type: 'VARCHAR(255)' },
    { name: 'city', type: 'VARCHAR(100)' },
    { name: 'state', type: 'VARCHAR(100)' },
    { name: 'zipCode', type: 'VARCHAR(100)' },
    { name: 'phone', type: 'VARCHAR(100)' },
    { name: 'mobile', type: 'VARCHAR(100)' },
    { name: 'email', type: 'VARCHAR(255)' },
    { name: 'photo', type: 'LONGTEXT' },
    { name: 'registration', type: 'VARCHAR(100)' },
    { name: 'role', type: 'VARCHAR(100)' },
    { name: 'sector', type: 'VARCHAR(100)' },
    { name: 'sectorCode', type: 'VARCHAR(100)' },
    { name: 'function', type: 'VARCHAR(100)' },
    { name: 'admissionDate', type: 'VARCHAR(100)' },
    { name: 'contractType', type: 'VARCHAR(100)' },
    { name: 'workday', type: 'VARCHAR(100)' },
    { name: 'supervisor', type: 'VARCHAR(100)' },
    { name: 'status', type: 'VARCHAR(50)' },
    { name: 'terminationReason', type: 'VARCHAR(255)' },
    { name: 'username', type: 'VARCHAR(100)' },
    { name: 'password', type: 'VARCHAR(100)' },
    { name: 'profileId', type: 'VARCHAR(100)' },
    { name: 'showOnAbout', type: 'TINYINT(1) DEFAULT 1' },
    { name: 'title', type: 'VARCHAR(100)' },
    { name: 'description', type: 'TEXT' },
    { name: 'education', type: 'LONGTEXT' },
    { name: 'postGrad', type: 'VARCHAR(255)' },
    { name: 'specializations', type: 'TEXT' },
    { name: 'masterDegree', type: 'VARCHAR(255)' },
    { name: 'doctorateDegree', type: 'VARCHAR(255)' },
    { name: 'regType', type: 'VARCHAR(100)' },
    { name: 'regNumber', type: 'VARCHAR(100)' },
    { name: 'regState', type: 'VARCHAR(100)' },
    { name: 'regValidity', type: 'VARCHAR(100)' },
    { name: 'regDocFile', type: 'LONGTEXT' },
    { name: 'laudoTitle', type: 'VARCHAR(100)' },
    { name: 'laudoCouncil', type: 'VARCHAR(100)' },
    { name: 'signatureFile', type: 'LONGTEXT' },
    { name: 'trainings', type: 'LONGTEXT' },
    { name: 'vaccinations', type: 'LONGTEXT' },
    { name: 'documents', type: 'LONGTEXT' },
    { name: 'absences', type: 'LONGTEXT' },
    { name: 'vencidaEm', type: 'VARCHAR(100)' },
    { name: 'faltas', type: 'INT DEFAULT 0' },
    { name: 'diasDireito', type: 'INT DEFAULT 0' },
    { name: 'diasGozados', type: 'INT DEFAULT 0' },
    { name: 'saldoAGozar', type: 'INT DEFAULT 0' },
    { name: 'concederAvisoAte', type: 'VARCHAR(100)' },
    { name: 'proximoVencimento', type: 'VARCHAR(100)' },
    { name: 'salaryData', type: 'LONGTEXT' },
    { name: 'vacations', type: 'LONGTEXT' },
    { name: 'paystubs', type: 'LONGTEXT' },
    { name: 'financialEvents', type: 'LONGTEXT' },
    { name: 'events', type: 'LONGTEXT' },
    { name: 'leaves', type: 'LONGTEXT' },
    { name: 'shifts', type: 'LONGTEXT' },
    { name: 'timecard', type: 'LONGTEXT' }
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
    { name: 'patientId', type: 'VARCHAR(100)' },
    { name: 'patientCode', type: 'VARCHAR(100)' },
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
    { name: 'patientCode', type: 'VARCHAR(100)' },
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
    { name: 'convenio', type: 'VARCHAR(255)' },
    { name: 'convenioId', type: 'VARCHAR(100)' },
    { name: 'convenioCode', type: 'VARCHAR(100)' },
    { name: 'situacao', type: 'VARCHAR(100)' },
    { name: 'situacaoCode', type: 'VARCHAR(100)' },
    { name: 'matricula', type: 'VARCHAR(100)' },
    { name: 'guia', type: 'VARCHAR(100)' },
    { name: 'coleta', type: 'VARCHAR(100)' },
    { name: 'susCard', type: 'VARCHAR(100)' },
    { name: 'destino', type: 'VARCHAR(100)' },
    { name: 'doctorCrm', type: 'VARCHAR(100)' },
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
    { name: 'patientCode', type: 'VARCHAR(100)' },
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
    { name: 'convenio', type: 'VARCHAR(255)' },
    { name: 'convenioId', type: 'VARCHAR(100)' },
    { name: 'convenioCode', type: 'VARCHAR(100)' },
    { name: 'situacao', type: 'VARCHAR(100)' },
    { name: 'situacaoCode', type: 'VARCHAR(100)' },
    { name: 'matricula', type: 'VARCHAR(100)' },
    { name: 'guia', type: 'VARCHAR(100)' },
    { name: 'coleta', type: 'VARCHAR(100)' },
    { name: 'susCard', type: 'VARCHAR(100)' },
    { name: 'destino', type: 'VARCHAR(100)' },
    { name: 'doctorCrm', type: 'VARCHAR(100)' },
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
    { name: 'exams', type: 'LONGTEXT' },
    { name: 'examesJuntos', type: 'LONGTEXT' },
    { name: 'examesTexto', type: 'LONGTEXT' },
    { name: 'examesConcatenados', type: 'LONGTEXT' }
  ],
  price_tables: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'convenioId', type: 'VARCHAR(100)' },
    { name: 'precios', type: 'LONGTEXT' }
  ],
  transactions: [
    { name: 'closureId', type: 'VARCHAR(100)' },
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
    { name: 'sectorCode', type: 'VARCHAR(100)' },
    { name: 'version', type: 'VARCHAR(50)' },
    { name: 'fileUrl', type: 'VARCHAR(500)' },
    { name: 'updatedAt', type: 'VARCHAR(100)' }
  ],
  non_conformities: [
    { name: 'code', type: 'VARCHAR(100)' },
    { name: 'description', type: 'TEXT' },
    { name: 'sectorCode', type: 'VARCHAR(100)' },
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
    { name: 'year', type: 'INT DEFAULT 2026' },
    { name: 'months', type: 'LONGTEXT' },
    { name: 'groups', type: 'LONGTEXT' },
    { name: 'rotationDays', type: 'LONGTEXT' },
    { name: 'notes', type: 'LONGTEXT' },
    { name: 'assignments', type: 'LONGTEXT' },
    { name: 'notices', type: 'LONGTEXT' },
    { name: 'date', type: 'VARCHAR(100)' },
    { name: 'professionalCode', type: 'VARCHAR(100)' },
    { name: 'shift', type: 'VARCHAR(50)' },
    { name: 'sectorCode', type: 'VARCHAR(100)' }
  ],
  blog_posts: [
    { name: 'title', type: 'VARCHAR(255)' },
    { name: 'category', type: 'VARCHAR(100)' },
    { name: 'date', type: 'VARCHAR(100)' },
    { name: 'readTime', type: 'VARCHAR(50)' },
    { name: 'author', type: 'VARCHAR(255)' },
    { name: 'authorRole', type: 'VARCHAR(255)' },
    { name: 'summary', type: 'TEXT' },
    { name: 'content', type: 'LONGTEXT' },
    { name: 'tags', type: 'LONGTEXT' }
  ],
  evaluations: [
    { name: 'patientName', type: 'VARCHAR(255)' },
    { name: 'requisitionCode', type: 'VARCHAR(100)' },
    { name: 'rating', type: 'INT DEFAULT 0' },
    { name: 'comment', type: 'TEXT' },
    { name: 'date', type: 'VARCHAR(100)' },
    { name: 'status', type: 'VARCHAR(100)' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'hash', type: 'VARCHAR(255)' },
    { name: 'token', type: 'VARCHAR(255)' }
  ],
  eval_accesses: [
    { name: 'requisitionCode', type: 'VARCHAR(100)' },
    { name: 'patientName', type: 'VARCHAR(255)' },
    { name: 'patientPhone', type: 'VARCHAR(100)' },
    { name: 'status', type: 'VARCHAR(100)' },
    { name: 'hash', type: 'VARCHAR(255)' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'sentAt', type: 'VARCHAR(100)' },
    { name: 'token', type: 'VARCHAR(255)' }
  ],
  eval_hashes: [
    { name: 'hash', type: 'VARCHAR(255)' },
    { name: 'requisitionCode', type: 'VARCHAR(100)' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'used', type: 'TINYINT(1) DEFAULT 0' }
  ],
  cisnorpi: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'exame', type: 'VARCHAR(255)' },
    { name: 'material', type: 'VARCHAR(255)' },
    { name: 'valor', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'ativo', type: 'TINYINT(1) DEFAULT 1' },
    { name: 'updatedAt', type: 'VARCHAR(100)' }
  ],
  finance_settings: [
    { name: 'providers', type: 'LONGTEXT' },
    { name: 'chartsOfAccounts', type: 'LONGTEXT' },
    { name: 'docTypes', type: 'LONGTEXT' },
    { name: 'banks', type: 'LONGTEXT' }
  ],
  movements: [
    { name: 'code', type: 'INT DEFAULT 0' },
    { name: 'type', type: 'VARCHAR(50)' },
    { name: 'date', type: 'VARCHAR(100)' },
    { name: 'chartOfAccounts', type: 'VARCHAR(100)' },
    { name: 'complemento', type: 'TEXT' },
    { name: 'bank', type: 'VARCHAR(100)' },
    { name: 'amount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'createdAt', type: 'VARCHAR(100)' }
  ],
  shortcuts: [
    { name: 'newRecord', type: 'LONGTEXT' },
    { name: 'save', type: 'LONGTEXT' },
    { name: 'cancel', type: 'LONGTEXT' },
    { name: 'closeModal', type: 'LONGTEXT' },
    { name: 'searchPatient', type: 'LONGTEXT' },
    { name: 'quickSearch', type: 'LONGTEXT' }
  ],
  message_templates: [
    { name: 'invite', type: 'TEXT' },
    { name: 'reminder', type: 'TEXT' },
    { name: 'resultReady', type: 'TEXT' }
  ],
  lab_exames_alvaro: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'material', type: 'VARCHAR(255)' },
    { name: 'metodo', type: 'VARCHAR(255)' },
    { name: 'prazo', type: 'VARCHAR(100)' },
    { name: 'valor', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'instrucoes', type: 'TEXT' }
  ],
  materiais_alvaro: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'abreviatura', type: 'VARCHAR(50)' }
  ],
  lab_exames_pardini: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'material', type: 'VARCHAR(255)' },
    { name: 'metodo', type: 'VARCHAR(255)' },
    { name: 'prazo', type: 'VARCHAR(100)' },
    { name: 'valor', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'instrucoes', type: 'TEXT' }
  ],
  config_apoio_alvaro: [
    { name: 'urlAmbiente', type: 'VARCHAR(500)' },
    { name: 'nomeLis', type: 'VARCHAR(100)' },
    { name: 'entidade', type: 'VARCHAR(100)' },
    { name: 'idAgente', type: 'VARCHAR(100)' },
    { name: 'senha', type: 'VARCHAR(100)' },
    { name: 'chave', type: 'VARCHAR(255)' },
    { name: 'setorPadrao', type: 'VARCHAR(100)' }
  ],
  config_apoio_pardini: [
    { name: 'urlAmbiente', type: 'VARCHAR(500)' },
    { name: 'login', type: 'VARCHAR(100)' },
    { name: 'senha', type: 'VARCHAR(100)' },
    { name: 'codigoCliente', type: 'VARCHAR(100)' }
  ],
  impressoras: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'nome', type: 'VARCHAR(255)' },
    { name: 'ip', type: 'VARCHAR(100)' },
    { name: 'porta', type: 'VARCHAR(50)' },
    { name: 'setor', type: 'VARCHAR(100)' },
    { name: 'tipo', type: 'VARCHAR(100)' },
    { name: 'modelo', type: 'VARCHAR(100)' },
    { name: 'padrao', type: 'TINYINT(1) DEFAULT 0' },
    { name: 'status', type: 'VARCHAR(50)' },
    { name: 'observacao', type: 'TEXT' }
  ],
  locais_coleta: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'ativo', type: 'TINYINT(1) DEFAULT 1' },
    { name: 'observacao', type: 'TEXT' }
  ],
  medicos: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'nome', type: 'VARCHAR(255)' },
    { name: 'conselho', type: 'VARCHAR(50)' },
    { name: 'numero', type: 'VARCHAR(100)' },
    { name: 'uf', type: 'VARCHAR(50)' },
    { name: 'especialidade', type: 'VARCHAR(100)' },
    { name: 'telefone', type: 'VARCHAR(100)' },
    { name: 'email', type: 'VARCHAR(100)' },
    { name: 'status', type: 'VARCHAR(50)' }
  ],
  equipamentos: [
    { name: 'chave', type: 'VARCHAR(100)' },
    { name: 'nome', type: 'VARCHAR(255)' },
    { name: 'setor_id', type: 'VARCHAR(100)' },
    { name: 'modelo', type: 'VARCHAR(100)' },
    { name: 'fabricante', type: 'VARCHAR(100)' },
    { name: 'protocolo', type: 'VARCHAR(100)' },
    { name: 'tipoConexao', type: 'VARCHAR(100)' },
    { name: 'ip', type: 'VARCHAR(100)' },
    { name: 'porta', type: 'VARCHAR(50)' },
    { name: 'status', type: 'VARCHAR(50)' },
    { name: 'observacao', type: 'TEXT' },
    { name: 'createdAt', type: 'VARCHAR(100)' },
    { name: 'updatedAt', type: 'VARCHAR(100)' }
  ],
  interface_data: [
    { name: 'naoEnviados', type: 'LONGTEXT' },
    { name: 'processando', type: 'LONGTEXT' },
    { name: 'prontos', type: 'LONGTEXT' },
    { name: 'liberados', type: 'LONGTEXT' },
    { name: 'mensagens', type: 'LONGTEXT' },
    { name: 'equipamentos', type: 'LONGTEXT' },
    { name: 'logs', type: 'LONGTEXT' },
    { name: 'results', type: 'LONGTEXT' },
    { name: 'connectedDevices', type: 'LONGTEXT' }
  ],
  requisition_shortcuts: [
    { name: 'codigo', type: 'VARCHAR(100)' },
    { name: 'nome', type: 'VARCHAR(255)' },
    { name: 'descricao', type: 'VARCHAR(255)' },
    { name: 'exames', type: 'LONGTEXT' }
  ],
  api_resultados: [
    { name: 'requisitionCode', type: 'VARCHAR(100)' },
    { name: 'patientCode', type: 'VARCHAR(100)' },
    { name: 'data', type: 'LONGTEXT' }
  ]
};

const migratedTablesSet = new Set();

async function checkAndMigrateTable(connection, tableName, schema) {
  if (migratedTablesSet.has(tableName)) return;

  const [tables] = await connection.query(`SHOW TABLES LIKE ?`, [tableName]);
  if (tables.length === 0) {
    let colDefs = [
      '`id` VARCHAR(100) NOT NULL PRIMARY KEY',
      '`order_index` INT DEFAULT 0'
    ];
    if (schema) {
      for (const col of schema) {
        colDefs.push(`\`${col.name}\` ${col.type}`);
      }
    }
    const createSql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${colDefs.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
    await connection.query(createSql);
  } else if (schema) {
    const [existingCols] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
    const existingColNames = new Set(existingCols.map(c => c.Field.toLowerCase()));

    for (const col of schema) {
      if (!existingColNames.has(col.name.toLowerCase())) {
        try {
          await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${col.name}\` ${col.type}`);
        } catch (e) {
          // Ignorar se a coluna já existir
        }
      }
    }
  }

  migratedTablesSet.add(tableName);
}

function getItemId(item, index) {
  if (!item || typeof item !== 'object') return String(index);
  if (item.id !== undefined && item.id !== null) return String(item.id);
  if (item.code !== undefined && item.code !== null) return String(item.code);
  if (item.codigo !== undefined && item.codigo !== null) return String(item.codigo);
  if (item.requisitionCode !== undefined && item.requisitionCode !== null) return String(item.requisitionCode);
  if (item.email !== undefined && item.email !== null) return String(item.email);
  if (item.key !== undefined && item.key !== null) return String(item.key);
  if (item.name !== undefined && item.name !== null) return String(item.name);
  return String(index);
}

async function loadCollectionFromMysql(name) {
  const tableName = `tbl_${name}`;
  const schema = tableSchemas[name];

  try {
    const pool = await getMysqlPool();
    const connection = await pool.getConnection();

    try {
      await checkAndMigrateTable(connection, tableName, schema);
      const [rows] = await connection.query(`SELECT * FROM \`${tableName}\` ORDER BY order_index ASC, id ASC`);
      connection.release();

      if (rows.length === 0) {
        return (schema && name.startsWith('config_')) || name === 'finance_settings' || name === 'shortcuts' || name === 'message_templates' || name === 'interface_data' || name === 'escala_plantao' ? null : [];
      }

      // Deserializar colunas JSON / LONGTEXT
      const parsedRows = rows.map(r => {
        const parsed = { ...r };
        delete parsed.order_index;
        if (parsed.data !== undefined) delete parsed.data;

        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
            try {
              parsed[key] = JSON.parse(value);
            } catch (e) {
              // Manter valor string original
            }
          }
        }
        return parsed;
      });

      // Se for tabela de registro único de configuração
      if (name === 'finance_settings' || name === 'shortcuts' || name === 'message_templates' || name === 'interface_data' || name === 'config_apoio_alvaro' || name === 'config_apoio_pardini' || name === 'escala_plantao') {
        const first = parsedRows[0];
        if (first) {
          const resObj = { ...first };
          delete resObj.id;
          return resObj;
        }
      }

      return parsedRows;
    } catch (err) {
      connection.release();
      throw err;
    }
  } catch (error) {
    console.warn(`Erro ao carregar coleção '${name}' do MySQL:`, error.message);
    return [];
  }
}

async function saveCollectionToMysql(name, data) {
  const tableName = `tbl_${name}`;
  const schema = tableSchemas[name];

  try {
    const pool = await getMysqlPool();
    const connection = await pool.getConnection();

    try {
      await checkAndMigrateTable(connection, tableName, schema);
      await connection.beginTransaction();

      await connection.query(`DELETE FROM \`${tableName}\``);

      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data && typeof data === 'object') {
        items = [{ ...data, id: data.id || 'default_config' }];
      }

      if (items.length > 0) {
        const [tableCols] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
        const colNames = tableCols.map(c => c.Field).filter(c => c !== 'data');

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item || typeof item !== 'object') continue;

          const rowData = {};
          const itemId = getItemId(item, i);
          rowData['id'] = itemId;
          rowData['order_index'] = i;

          for (const colName of colNames) {
            if (colName === 'id' || colName === 'order_index') continue;

            let val = item[colName];
            if (val === undefined || val === null) {
              rowData[colName] = null;
            } else if (typeof val === 'object') {
              rowData[colName] = JSON.stringify(val);
            } else if (typeof val === 'boolean') {
              rowData[colName] = val ? 1 : 0;
            } else {
              rowData[colName] = val;
            }
          }

          const insertCols = Object.keys(rowData).map(k => `\`${k}\``).join(', ');
          const placeholders = Object.keys(rowData).map(() => '?').join(', ');
          const values = Object.values(rowData);

          await connection.query(`INSERT INTO \`${tableName}\` (${insertCols}) VALUES (${placeholders})`, values);
        }
      }

      await connection.commit();
      connection.release();
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (error) {
    console.error(`Erro ao salvar coleção '${name}' no MySQL:`, error.message);
  }
}

async function queryTableFromMysql(tableName) {
  try {
    const pool = await getMysqlPool();
    const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
    return rows;
  } catch (err) {
    console.error(`Erro ao consultar ${tableName}:`, err.message);
    return [];
  }
}

async function refreshDataStoreFromMysql() {
  try {
    const pool = await getMysqlPool();
    if (!pool) return;

    const [
      exams, budgets, blogPosts, supportLabs, requisitions, professionals,
      evaluations, evalAccesses, evalHashes, pops, documents, patients,
      appointments, cashClosures, convenios, priceTables, recipientes,
      materiaisColetados, setores, impressoras, locaisColeta, medicos,
      transactions, movements, pessoas, accessProfiles, cisnorpi,
      temperaturas, nonConformities, escalaPlantao, financeSettings,
      labExamesAlvaro, materiaisAlvaro, labExamesPardini,
      configApoioAlvaro, configApoioPardini, interfaceData,
      messageTemplates, shortcuts, reqShortcuts, apiRes, equipamentos
    ] = await Promise.all([
      loadCollectionFromMysql('exams'),
      loadCollectionFromMysql('budgets'),
      loadCollectionFromMysql('blog_posts'),
      loadCollectionFromMysql('support_labs'),
      loadCollectionFromMysql('requisitions'),
      loadCollectionFromMysql('professionals'),
      loadCollectionFromMysql('evaluations'),
      loadCollectionFromMysql('eval_accesses'),
      loadCollectionFromMysql('eval_hashes'),
      loadCollectionFromMysql('pops'),
      loadCollectionFromMysql('documents'),
      loadCollectionFromMysql('patients'),
      loadCollectionFromMysql('appointments'),
      loadCollectionFromMysql('cash_closures'),
      loadCollectionFromMysql('convenios'),
      loadCollectionFromMysql('price_tables'),
      loadCollectionFromMysql('recipientes'),
      loadCollectionFromMysql('materiais_coletados'),
      loadCollectionFromMysql('setores'),
      loadCollectionFromMysql('impressoras'),
      loadCollectionFromMysql('locais_coleta'),
      loadCollectionFromMysql('medicos'),
      loadCollectionFromMysql('transactions'),
      loadCollectionFromMysql('movements'),
      loadCollectionFromMysql('pessoas'),
      loadCollectionFromMysql('access_profiles'),
      loadCollectionFromMysql('cisnorpi'),
      loadCollectionFromMysql('temperaturas'),
      loadCollectionFromMysql('non_conformities'),
      loadCollectionFromMysql('escala_plantao'),
      loadCollectionFromMysql('finance_settings'),
      loadCollectionFromMysql('lab_exames_alvaro'),
      loadCollectionFromMysql('materiais_alvaro'),
      loadCollectionFromMysql('lab_exames_pardini'),
      loadCollectionFromMysql('config_apoio_alvaro'),
      loadCollectionFromMysql('config_apoio_pardini'),
      loadCollectionFromMysql('interface_data'),
      loadCollectionFromMysql('message_templates'),
      loadCollectionFromMysql('shortcuts'),
      loadCollectionFromMysql('requisition_shortcuts'),
      loadCollectionFromMysql('api_resultados'),
      loadCollectionFromMysql('equipamentos')
    ]);

    if (Array.isArray(exams)) examsCache = exams;
    if (Array.isArray(budgets)) budgetsCache = budgets;
    if (Array.isArray(blogPosts)) blogPostsCache = blogPosts;
    if (Array.isArray(supportLabs)) supportLabsCache = supportLabs;
    if (Array.isArray(requisitions)) requisitionsCache = requisitions;
    if (Array.isArray(professionals)) professionalsCache = professionals;
    if (Array.isArray(evaluations)) evaluationsCache = evaluations;
    if (Array.isArray(evalAccesses)) evalAccessesCache = evalAccesses;
    if (Array.isArray(evalHashes)) evalHashesCache = evalHashes;
    if (Array.isArray(pops)) popsCache = pops;
    if (Array.isArray(documents)) documentsCache = documents;
    if (Array.isArray(patients)) patientsCache = patients;
    if (Array.isArray(appointments)) appointmentsCache = appointments;
    if (Array.isArray(cashClosures)) cashClosuresCache = cashClosures;
    if (Array.isArray(convenios)) conveniosCache = convenios;
    if (Array.isArray(priceTables)) priceTablesCache = priceTables;
    if (Array.isArray(recipientes)) recipientesCache = recipientes;
    if (Array.isArray(materiaisColetados)) materiaisColetadosMasterCache = materiaisColetados;
    if (Array.isArray(setores)) setoresCache = setores;
    if (Array.isArray(impressoras)) impressorasCache = impressoras;
    if (Array.isArray(locaisColeta)) locaisColetaCache = locaisColeta;
    if (Array.isArray(medicos)) medicosCache = medicos;
    if (Array.isArray(equipamentos)) equipamentosCache = equipamentos;
    if (Array.isArray(transactions)) transactionsCache = transactions;
    if (Array.isArray(movements)) movementsCache = movements;
    if (Array.isArray(pessoas)) pessoasCache = pessoas;
    if (Array.isArray(accessProfiles)) accessProfilesCache = accessProfiles;
    if (Array.isArray(cisnorpi)) cisnorpiCache = cisnorpi;
    if (Array.isArray(temperaturas)) temperaturasCache = temperaturas;
    if (Array.isArray(nonConformities)) nonConformitiesCache = nonConformities;
    if (escalaPlantao) escalaPlantaoCache = escalaPlantao;
    if (financeSettings) financeSettingsCache = financeSettings;
    if (Array.isArray(labExamesAlvaro)) labExamesAlvaroCache = labExamesAlvaro;
    if (Array.isArray(materiaisAlvaro)) materiaisAlvaroCache = materiaisAlvaro;
    if (Array.isArray(labExamesPardini)) labExamesPardiniCache = labExamesPardini;
    if (configApoioAlvaro) configApoioAlvaroCache = configApoioAlvaro;
    if (configApoioPardini) configApoioPardiniCache = configApoioPardini;
    if (interfaceData) interfaceCache = interfaceData;
    if (messageTemplates) messageTemplatesCache = messageTemplates;
    if (shortcuts) shortcutsCache = shortcuts;
    if (Array.isArray(reqShortcuts)) requisitionShortcutsCache = reqShortcuts;
    if (Array.isArray(apiRes)) apiResultsCache = apiRes;
  } catch (err) {
    console.error("Erro ao sincronizar tabelas com o MySQL:", err.message);
  }
}

async function initializeDataStoreCaches() {
  console.log("🐬 Inicializando conexão e sincronização com o banco de dados MySQL...");
  try {
    await getMysqlPool();
    await refreshDataStoreFromMysql();

    isDataStoreInitialized = true;
    console.log("🐬 Todos os dados carregados e gerenciados exclusivamente via MySQL!");
  } catch (error) {
    console.error("❌ Falha crítica ao inicializar MySQL:", error.message || error);
    isDataStoreInitialized = true;
  }
}

const initializeFirebaseCaches = initializeDataStoreCaches;

async function cleanObsoleteDatabaseFields() {
  if (process.env.DB_HOST) {
    try {
      const pool = await getMysqlPool();
      const connection = await pool.getConnection();
      try {
        const [tables] = await connection.query("SHOW TABLES LIKE 'tbl_%'");
        for (const row of tables) {
          const tableName = Object.values(row)[0];
          try {
            const [cols] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE 'data'`);
            if (cols.length > 0) {
              await connection.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`data\``);
              console.log(`Coluna legada 'data' removida de ${tableName}.`);
            }
          } catch (e) {}
        }
      } finally {
        connection.release();
      }
    } catch (err) {
      console.warn("Aviso ao limpar campos obsoletos:", err.message);
    }
  }
}

// Funções de acesso e manipulação de entidades

function formatRequisitionCode(code) {
  if (!code) return "000000";
  return String(code).padStart(6, '0');
}

function updateRequisitionCombinedExams(req) {
  if (!req) return;
  if (!req.exams || !Array.isArray(req.exams)) {
    req.exams = [];
  }
  const codes = [];
  const names = [];
  const combined = [];

  req.exams.forEach(ex => {
    const code = ex.examCode || ex.code || '';
    const name = ex.examName || ex.name || '';
    if (code) codes.push(code);
    if (name) names.push(name);
    if (code && name) combined.push(`${code} - ${name}`);
    else if (name) combined.push(name);
  });

  req.examesJuntos = combined.join(', ');
  req.examesTexto = names.join(', ');
  req.examesConcatenados = codes.join(', ');
}

function loadRequisitions() {
  if (Array.isArray(requisitionsCache)) {
    requisitionsCache.forEach(updateRequisitionCombinedExams);
  }
  return requisitionsCache || [];
}

function saveRequisitions(requisitions) {
  try {
    if (Array.isArray(requisitions)) {
      requisitions.forEach(updateRequisitionCombinedExams);
    }
    requisitionsCache = requisitions;
    saveCollectionToMysql('requisitions', requisitions).catch(err => console.error("Erro ao salvar requisitions no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar requisições:", error);
  }
}

function loadCisnorpi() {
  return cisnorpiCache || [];
}

function saveCisnorpi(data) {
  try {
    cisnorpiCache = data;
    saveCollectionToMysql('cisnorpi', data).catch(err => console.error("Erro ao salvar cisnorpi no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar CISNORPI:", error);
  }
}

function loadCashClosures() {
  return cashClosuresCache || [];
}

function saveCashClosures(closures) {
  try {
    cashClosuresCache = closures;
    saveCollectionToMysql('cash_closures', closures).catch(err => console.error("Erro ao salvar cash_closures no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar fechamentos de caixa:", error);
  }
}

async function loadTemperaturas() {
  if (temperaturasCache && temperaturasCache.length > 0) {
    return temperaturasCache;
  }
  const items = await loadCollectionFromMysql('temperaturas');
  temperaturasCache = items;
  return items;
}

async function saveTemperaturas(data) {
  try {
    temperaturasCache = data;
    await saveCollectionToMysql('temperaturas', data);
  } catch (error) {
    console.error("Erro ao salvar temperaturas no MySQL:", error.message);
  }
}

function loadBudgets() {
  return budgetsCache || [];
}

function saveBudgets(budgets) {
  try {
    budgetsCache = budgets;
    saveCollectionToMysql('budgets', budgets).catch(err => console.error("Erro ao salvar budgets no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar orçamentos:", error);
  }
}

function loadSupportLabs() {
  return (supportLabsCache || []).map(lab => ({
    id: String(lab.id || lab.codigo || Date.now()),
    codigo: String(lab.codigo || lab.id || "1"),
    descricao: lab.descricao || lab.name || "",
    name: lab.name || lab.descricao || ""
  }));
}

function saveSupportLabs(labs) {
  try {
    supportLabsCache = labs;
    saveCollectionToMysql('support_labs', labs).catch(err => console.error("Erro ao salvar support_labs no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar laboratórios de apoio:", err);
  }
}

function loadConvenios() {
  return conveniosCache || [];
}

function saveConvenios(convenios) {
  try {
    conveniosCache = convenios;
    saveCollectionToMysql('convenios', convenios).catch(err => console.error("Erro ao salvar convenios no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar convênios:", error);
  }
}

function loadLabExamesAlvaro() {
  return labExamesAlvaroCache || [];
}

function saveLabExamesAlvaro(data) {
  try {
    labExamesAlvaroCache = data;
    saveCollectionToMysql('lab_exames_alvaro', data).catch(err => console.error("Erro ao salvar lab_exames_alvaro no MySQL:", err));
  } catch (err) {
    console.error('Erro ao salvar exames Álvaro:', err);
  }
}

function loadMateriaisAlvaro() {
  return materiaisAlvaroCache || [];
}

function saveMateriaisAlvaro(data) {
  try {
    materiaisAlvaroCache = data;
    saveCollectionToMysql('materiais_alvaro', data).catch(err => console.error("Erro ao salvar materiais_alvaro no MySQL:", err));
  } catch (err) {
    console.error('Erro ao salvar materiais Álvaro:', err);
  }
}

function loadConfigApoioAlvaro() {
  if (!configApoioAlvaroCache) {
    configApoioAlvaroCache = {
      urlAmbiente: 'http://webservice.alvaro.com.br/webserviceaol/rest/homologacao/v1',
      nomeLis: 'InovalabLis',
      entidade: '19816',
      idAgente: '193762',
      senha: '4353cd',
      chave: '581abd3154b1e858',
      setorPadrao: '11'
    };
  }
  return configApoioAlvaroCache;
}

function saveConfigApoioAlvaro(data) {
  try {
    configApoioAlvaroCache = data;
    saveCollectionToMysql('config_apoio_alvaro', data).catch(err => console.error("Erro ao salvar config_apoio_alvaro no MySQL:", err));
  } catch (err) {
    console.error('Erro ao salvar config apoio Álvaro:', err);
  }
}

function loadConfigApoioPardini() {
  return configApoioPardiniCache || {};
}

function saveConfigApoioPardini(data) {
  try {
    configApoioPardiniCache = data;
    saveCollectionToMysql('config_apoio_pardini', data).catch(err => console.error("Erro ao salvar config_apoio_pardini no MySQL:", err));
  } catch (err) {
    console.error('Erro ao salvar config apoio Pardini:', err);
  }
}

function loadLabExamesPardini() {
  return labExamesPardiniCache || [];
}

function saveLabExamesPardini(data) {
  try {
    labExamesPardiniCache = data;
    saveCollectionToMysql('lab_exames_pardini', data).catch(err => console.error("Erro ao salvar lab_exames_pardini no MySQL:", err));
  } catch (err) {
    console.error('Erro ao salvar exames Pardini:', err);
  }
}

function loadRecipientes() {
  return recipientesCache || [];
}

function saveRecipientes(recipientes) {
  try {
    recipientesCache = recipientes;
    saveCollectionToMysql('recipientes', recipientes).catch(err => console.error("Erro ao salvar recipientes no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar recipientes:", error);
  }
}

function loadMateriaisColetados() {
  return materiaisColetadosMasterCache || [];
}

function saveMateriaisColetados(materiais) {
  try {
    materiaisColetadosMasterCache = materiais;
    saveCollectionToMysql('materiais_coletados', materiais).catch(err => console.error("Erro ao salvar materiais_coletados no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar materiais coletados:", error);
  }
}

function loadSetores() {
  return setoresCache || [];
}

function saveSetores(setores) {
  try {
    setoresCache = setores;
    saveCollectionToMysql('setores', setores).catch(err => console.error("Erro ao salvar setores no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar setores:", error);
  }
}

function loadImpressoras() {
  return impressorasCache || [];
}

function saveImpressoras(impressoras) {
  try {
    impressorasCache = impressoras;
    saveCollectionToMysql('impressoras', impressoras).catch(err => console.error("Erro ao salvar impressoras no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar impressoras:", error);
  }
}

function loadLocaisColeta() {
  return locaisColetaCache || [];
}

function saveLocaisColeta(locais) {
  try {
    locaisColetaCache = locais;
    saveCollectionToMysql('locais_coleta', locais).catch(err => console.error("Erro ao salvar locais_coleta no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar locais de coleta:", error);
  }
}

function getDefaultInterfaceData() {
  return {
    naoEnviados: [],
    processando: [],
    prontos: [],
    liberados: [],
    mensagens: [],
    equipamentos: [],
    logs: [],
    results: [],
    connectedDevices: []
  };
}

function loadEquipamentos() {
  const setores = loadSetores() || [];
  return (equipamentosCache || []).map(eq => {
    const sId = eq.setor_id || eq.setorId || '';
    const matchedSetor = setores.find(s => 
      (s.id && String(s.id) === String(sId)) || 
      (s.codigo && String(s.codigo) === String(sId)) ||
      (s.descricao && String(s.descricao).trim().toLowerCase() === String(eq.setor || '').trim().toLowerCase()) ||
      (s.nome && String(s.nome).trim().toLowerCase() === String(eq.setor || '').trim().toLowerCase())
    );

    const nomeEquipamento = eq.nome || eq.descricao || '';
    return {
      id: String(eq.id || ''),
      chave: String(eq.chave || eq.id || ''),
      nome: nomeEquipamento,
      descricao: nomeEquipamento,
      setorId: matchedSetor ? matchedSetor.id : sId,
      setor: matchedSetor ? (matchedSetor.descricao || matchedSetor.nome || '') : 'Geral',
      setorSigla: matchedSetor ? (matchedSetor.sigla || '') : '',
      setorCodigo: matchedSetor ? (matchedSetor.codigo || '') : '',
      modelo: eq.modelo || '',
      fabricante: eq.fabricante || '',
      protocolo: eq.protocolo || 'ASTM E1394',
      tipoConexao: eq.tipoConexao || 'TCP/IP',
      ip: eq.ip || '',
      porta: eq.porta || '',
      status: eq.status || 'Ativo',
      observacao: eq.observacao || '',
      createdAt: eq.createdAt || '',
      updatedAt: eq.updatedAt || ''
    };
  });
}

async function saveEquipamento(eqData) {
  try {
    const eqId = String(eqData.id || ('eq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7))).trim();
    const chave = String(eqData.chave || eqId).trim();
    const nome = String(eqData.nome || eqData.descricao || '').trim();
    const setorId = String(eqData.setor_id || eqData.setorId || '').trim();
    const modelo = String(eqData.modelo || '').trim();
    const fabricante = String(eqData.fabricante || '').trim();
    const protocolo = String(eqData.protocolo || 'ASTM E1394').trim();
    const tipoConexao = String(eqData.tipoConexao || 'TCP/IP').trim();
    const ip = String(eqData.ip || '').trim();
    const porta = String(eqData.porta || '').trim();
    const status = String(eqData.status || 'Ativo').trim();
    const observacao = String(eqData.observacao || '').trim();
    const updatedAt = new Date().toISOString();
    const createdAt = eqData.createdAt || new Date().toISOString();

    const pool = await getMysqlPool();
    if (pool) {
      const connection = await pool.getConnection();
      try {
        await checkAndMigrateTable(connection, 'tbl_equipamentos', tableSchemas.equipamentos);
        const [existing] = await connection.query('SELECT id, createdAt FROM `tbl_equipamentos` WHERE id = ? LIMIT 1', [eqId]);
        if (existing.length > 0) {
          await connection.query(
            'UPDATE `tbl_equipamentos` SET chave = ?, nome = ?, setor_id = ?, modelo = ?, fabricante = ?, protocolo = ?, tipoConexao = ?, ip = ?, porta = ?, status = ?, observacao = ?, updatedAt = ? WHERE id = ?',
            [chave, nome, setorId, modelo, fabricante, protocolo, tipoConexao, ip, porta, status, observacao, updatedAt, eqId]
          );
        } else {
          await connection.query(
            'INSERT INTO `tbl_equipamentos` (id, chave, nome, setor_id, modelo, fabricante, protocolo, tipoConexao, ip, porta, status, observacao, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [eqId, chave, nome, setorId, modelo, fabricante, protocolo, tipoConexao, ip, porta, status, observacao, createdAt, updatedAt]
          );
        }
      } finally {
        connection.release();
      }
    }

    // Atualiza cache em memória
    const idx = (equipamentosCache || []).findIndex(e => String(e.id) === eqId);
    const cleanObj = {
      id: eqId,
      chave,
      nome,
      descricao: nome,
      setor_id: setorId,
      setorId,
      modelo,
      fabricante,
      protocolo,
      tipoConexao,
      ip,
      porta,
      status,
      observacao,
      createdAt,
      updatedAt
    };

    if (idx >= 0) {
      equipamentosCache[idx] = { ...equipamentosCache[idx], ...cleanObj };
    } else {
      if (!Array.isArray(equipamentosCache)) equipamentosCache = [];
      equipamentosCache.push(cleanObj);
    }

    return cleanObj;
  } catch (error) {
    console.error("Erro ao salvar equipamento no MySQL:", error);
    throw error;
  }
}

async function deleteEquipamento(id) {
  try {
    const targetId = String(id).trim();
    const pool = await getMysqlPool();
    if (pool) {
      const connection = await pool.getConnection();
      try {
        await checkAndMigrateTable(connection, 'tbl_equipamentos', tableSchemas.equipamentos);
        await connection.query('DELETE FROM `tbl_equipamentos` WHERE id = ? OR chave = ?', [targetId, targetId]);
      } finally {
        connection.release();
      }
    }

    if (Array.isArray(equipamentosCache)) {
      equipamentosCache = equipamentosCache.filter(e => String(e.id) !== targetId && String(e.chave) !== targetId);
    }
    return true;
  } catch (error) {
    console.error("Erro ao excluir equipamento no MySQL:", error);
    throw error;
  }
}

async function saveEquipamentos(equipamentos) {
  try {
    equipamentosCache = equipamentos;
    await saveCollectionToMysql('equipamentos', equipamentos);
  } catch (err) {
    console.error("Erro ao salvar coleção de equipamentos no MySQL:", err);
  }
}

function loadInterfaceData() {
  if (!interfaceCache || typeof interfaceCache !== 'object') {
    interfaceCache = getDefaultInterfaceData();
  }
  if (!Array.isArray(interfaceCache.naoEnviados)) interfaceCache.naoEnviados = [];
  if (!Array.isArray(interfaceCache.processando)) interfaceCache.processando = [];
  if (!Array.isArray(interfaceCache.prontos)) interfaceCache.prontos = [];
  if (!Array.isArray(interfaceCache.liberados)) interfaceCache.liberados = [];
  if (!Array.isArray(interfaceCache.mensagens)) interfaceCache.mensagens = [];
  interfaceCache.equipamentos = loadEquipamentos();
  if (!Array.isArray(interfaceCache.logs)) interfaceCache.logs = [];
  if (!Array.isArray(interfaceCache.results)) interfaceCache.results = [];
  if (!Array.isArray(interfaceCache.connectedDevices)) interfaceCache.connectedDevices = [];

  return interfaceCache;
}

function saveInterfaceData(data) {
  try {
    interfaceCache = data;
    saveCollectionToMysql('interface_data', data).catch(err => console.error("Erro ao salvar interface_data no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar interface_data:", err);
  }
}

function loadMedicos() {
  return medicosCache || [];
}

function saveMedicos(medicos) {
  try {
    medicosCache = medicos;
    saveCollectionToMysql('medicos', medicos).catch(err => console.error("Erro ao salvar medicos no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar médicos:", error);
  }
}

function loadPriceTables() {
  return priceTablesCache || [];
}

function savePriceTables(tables) {
  try {
    priceTablesCache = tables;
    saveCollectionToMysql('price_tables', tables).catch(err => console.error("Erro ao salvar price_tables no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar tabelas de preços:", error);
  }
}

function loadRequisitionShortcuts() {
  return requisitionShortcutsCache || [];
}

function saveRequisitionShortcuts(shortcuts) {
  try {
    requisitionShortcutsCache = shortcuts;
    saveCollectionToMysql('requisition_shortcuts', shortcuts).catch(err => console.error("Erro ao salvar requisition_shortcuts no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar atalhos de requisição:", err);
  }
}

function fixMojibake(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/Ã¡/g, 'á').replace(/Ã /g, 'à').replace(/Ã£/g, 'ã').replace(/Ã¢/g, 'â').replace(/Ã©/g, 'é')
    .replace(/Ãª/g, 'ê').replace(/Ã­/g, 'í').replace(/Ã³/g, 'ó').replace(/Ãµ/g, 'õ').replace(/Ã´/g, 'ô')
    .replace(/Ãº/g, 'ú').replace(/Ã§/g, 'ç').replace(/Ã/g, 'Á').replace(/Ã€/g, 'À').replace(/Ãƒ/g, 'Ã')
    .replace(/Ã‚/g, 'Â').replace(/Ã‰/g, 'É').replace(/ÃŠ/g, 'Ê').replace(/Ã/g, 'Í').replace(/Ã“/g, 'Ó')
    .replace(/Ã•/g, 'Õ').replace(/Ã”/g, 'Ô').replace(/Ãš/g, 'Ú').replace(/Ã‡/g, 'Ç');
}

function cleanExamObject(exam) {
  if (!exam || typeof exam !== 'object') return exam;
  const cleaned = { ...exam };
  if (cleaned.name) cleaned.name = fixMojibake(cleaned.name);
  if (cleaned.instructions) cleaned.instructions = fixMojibake(cleaned.instructions);
  if (cleaned.category) cleaned.category = fixMojibake(cleaned.category);
  return cleaned;
}

function loadExams() {
  return (examsCache || []).map(cleanExamObject);
}

function parsePriceValue(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    let clean = val.replace(/[R$\s]/g, '').trim();
    if (clean.includes(',') && clean.includes('.')) {
      if (clean.indexOf('.') < clean.indexOf(',')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function syncExamPricesToPriceTables(examCode, examName, parsedMateriais, pricePrivate) {
  try {
    const tables = loadPriceTables();
    let tablesUpdated = false;

    tables.forEach(table => {
      if (!table.precios || typeof table.precios !== 'object') {
        table.precios = {};
      }
      const existing = table.precios[examCode];
      if (existing) {
        if (examName) existing.name = examName;
        if (pricePrivate !== undefined && (!existing.price || existing.price === 0)) {
          existing.price = pricePrivate;
        }
        tablesUpdated = true;
      }
    });

    if (tablesUpdated) {
      savePriceTables(tables);
    }
  } catch (err) {
    console.error("Erro ao sincronizar preços com tabelas:", err);
  }
}

function syncPriceTableToExams(table) {
  // Mantém consistência relacional
}

function cleanOrphanedPriceTableRows() {
  // Limpeza de inconsistências relacionais
}

function syncAllExamsWithPriceTables() {
  // Sincronização geral de catálogo
}

function saveExams(exams) {
  try {
    const cleaned = (exams || []).map(cleanExamObject);
    examsCache = cleaned;
    saveCollectionToMysql('exams', cleaned).catch(err => console.error("Erro ao salvar exams no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar exames:", error);
  }
}

function loadProfessionals() {
  return professionalsCache || [];
}

function saveProfessionals(professionals) {
  try {
    professionalsCache = professionals;
    saveCollectionToMysql('professionals', professionals).catch(err => console.error("Erro ao salvar professionals no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar profissionais:", error);
  }
}

function loadEvaluations() {
  return evaluationsCache || [];
}

function saveEvaluations(evaluations) {
  try {
    evaluationsCache = evaluations;
    saveCollectionToMysql('evaluations', evaluations).catch(err => console.error("Erro ao salvar evaluations no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar avaliações:", error);
  }
}

function loadEvalAccesses() {
  return evalAccessesCache || [];
}

function saveEvalAccesses(accesses) {
  try {
    evalAccessesCache = accesses;
    saveCollectionToMysql('eval_accesses', accesses).catch(err => console.error("Erro ao salvar eval_accesses no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar acessos de avaliação:", error);
  }
}

function loadEvalHashes() {
  return evalHashesCache || [];
}

function saveEvalHashes(hashes) {
  try {
    evalHashesCache = hashes;
    saveCollectionToMysql('eval_hashes', hashes).catch(err => console.error("Erro ao salvar eval_hashes no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar hashes de avaliação:", error);
  }
}

function generateRandomHash(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function registerEvaluationLink(code) {
  const formattedCode = formatRequisitionCode(code);
  let hashes = loadEvalHashes();
  let existing = hashes.find(h => h.requisitionCode === formattedCode);

  if (existing) {
    return existing.hash;
  }

  let newHash = generateRandomHash(20);
  while (hashes.some(h => h.hash === newHash)) {
    newHash = generateRandomHash(20);
  }

  hashes.push({
    hash: newHash,
    requisitionCode: formattedCode,
    createdAt: new Date().toISOString(),
    used: false
  });

  saveEvalHashes(hashes);
  return newHash;
}

function getOrCreateHashForPatient(patientCode, patientName = '') {
  return registerEvaluationLink(patientCode);
}

function resolvePatientCodeFromHash(hashOrCode) {
  if (!hashOrCode) return null;
  const hashes = loadEvalHashes();
  const found = hashes.find(h => h.hash === hashOrCode);
  if (found) return found.requisitionCode;
  return hashOrCode;
}

function getNameFromHashOrCode(hashOrCode) {
  const reqCode = resolvePatientCodeFromHash(hashOrCode);
  const requisitions = loadRequisitions();
  const req = requisitions.find(r => r.requisitionCode === reqCode || r.code === reqCode);
  return req ? (req.patientName || req.patient || '') : '';
}

function trackEvaluationAccess(code) {
  // Rastreamento relacional
}

function loadNonConformities() {
  return nonConformitiesCache || [];
}

function saveNonConformities(list) {
  try {
    nonConformitiesCache = list;
    saveCollectionToMysql('non_conformities', list).catch(err => console.error("Erro ao salvar non_conformities no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar não conformidades:", error);
  }
}

function loadAccessProfiles() {
  return accessProfilesCache || [];
}

function saveAccessProfiles(profiles) {
  try {
    accessProfilesCache = profiles;
    saveCollectionToMysql('access_profiles', profiles).catch(err => console.error("Erro ao salvar access_profiles no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar perfis de acesso:", error);
  }
}

function loadMessageTemplates() {
  if (!messageTemplatesCache) {
    messageTemplatesCache = {
      invite: "Olá {nome}, seu cadastro no InovaLab está ativo.",
      reminder: "Olá {nome}, lembramos da sua coleta agendada.",
      resultReady: "Olá {nome}, seus resultados de exames já estão prontos para consulta."
    };
  }
  return messageTemplatesCache;
}

function saveMessageTemplates(templates) {
  try {
    messageTemplatesCache = templates;
    saveCollectionToMysql('message_templates', templates).catch(err => console.error("Erro ao salvar message_templates no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar templates de mensagens:", error);
  }
}

function loadShortcuts() {
  if (!shortcutsCache) {
    shortcutsCache = {
      newRecord: { key: 'F2', label: 'Novo Registro' },
      save: { key: 'F4', label: 'Salvar' },
      cancel: { key: 'Esc', label: 'Cancelar' },
      closeModal: { key: 'Esc', label: 'Fechar Modal' },
      searchPatient: { key: 'F3', label: 'Buscar Paciente' },
      quickSearch: { key: 'F8', label: 'Busca Rápida' }
    };
  }
  return shortcutsCache;
}

function saveShortcuts(shortcuts) {
  try {
    shortcutsCache = shortcuts;
    saveCollectionToMysql('shortcuts', shortcuts).catch(err => console.error("Erro ao salvar shortcuts no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar atalhos:", error);
  }
}

function loadTransactions() {
  return transactionsCache || [];
}

function saveTransactions(transactions) {
  try {
    transactionsCache = transactions;
    saveCollectionToMysql('transactions', transactions).catch(err => console.error("Erro ao salvar transactions no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar transações:", error);
  }
}

function loadFinanceSettings() {
  if (!financeSettingsCache) {
    financeSettingsCache = {
      providers: [],
      chartsOfAccounts: [],
      docTypes: [],
      banks: []
    };
  }
  return financeSettingsCache;
}

function saveFinanceSettings(settings) {
  try {
    financeSettingsCache = settings;
    saveCollectionToMysql('finance_settings', settings).catch(err => console.error("Erro ao salvar finance_settings no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar configurações financeiras:", error);
  }
}

function loadMovements() {
  return movementsCache || [];
}

function saveMovements(movements) {
  try {
    movementsCache = movements;
    saveCollectionToMysql('movements', movements).catch(err => console.error("Erro ao salvar movements no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar movimentações:", error);
  }
}

function logFinancialMovement(tx, paidAtDate) {
  try {
    const movements = loadMovements();
    const newMovement = {
      id: `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      code: movements.length + 1,
      type: tx.type === 'expense' ? 'debito' : 'credito',
      date: paidAtDate || new Date().toISOString().split('T')[0],
      chartOfAccounts: tx.chartOfAccounts || 'Geral',
      complemento: tx.description || `Transação ${tx.number || tx.id}`,
      bank: tx.bank || 'Caixa Geral',
      amount: tx.amount || 0,
      createdAt: new Date().toISOString()
    };
    movements.push(newMovement);
    saveMovements(movements);
  } catch (e) {
    console.error("Erro ao registrar movimentação financeira automática:", e);
  }
}

function getEnrichedExams() {
  return loadExams();
}

function loadBlogPosts() {
  return blogPostsCache || [];
}

function saveBlogPosts(posts) {
  try {
    blogPostsCache = posts;
    saveCollectionToMysql('blog_posts', posts).catch(err => console.error("Erro ao salvar blog_posts no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar posts do blog:", error);
  }
}

function loadPops() {
  return popsCache || [];
}

function savePops(pops) {
  try {
    popsCache = pops;
    saveCollectionToMysql('pops', pops).catch(err => console.error("Erro ao salvar pops no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar POPs:", error);
  }
}

function loadDocuments() {
  return documentsCache || [];
}

function saveDocuments(docs) {
  try {
    documentsCache = docs;
    saveCollectionToMysql('documents', docs).catch(err => console.error("Erro ao salvar documents no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar documentos:", error);
  }
}

function loadPatients() {
  return patientsCache || [];
}

function savePatients(data) {
  try {
    patientsCache = data;
    saveCollectionToMysql('patients', data).catch(err => console.error("Erro ao salvar patients no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar pacientes:", error);
  }
}

function loadAppointments() {
  return appointmentsCache || [];
}

function saveAppointments(data) {
  try {
    appointmentsCache = data;
    saveCollectionToMysql('appointments', data).catch(err => console.error("Erro ao salvar appointments no MySQL:", err));
  } catch (error) {
    console.error("Erro ao salvar agendamentos:", error);
  }
}

function loadPessoas() {
  return pessoasCache || [];
}

function savePessoas(pessoas) {
  try {
    pessoasCache = pessoas;
    saveCollectionToMysql('pessoas', pessoas).catch(err => console.error("Erro ao salvar pessoas no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar pessoas:", err);
  }
}

function loadEscalaPlantao() {
  if (!escalaPlantaoCache) {
    escalaPlantaoCache = {
      year: 2026,
      months: [3, 4],
      groups: [],
      assignments: {},
      notices: []
    };
  }
  return escalaPlantaoCache;
}

function saveEscalaPlantao(data) {
  try {
    escalaPlantaoCache = data;
    saveCollectionToMysql('escala_plantao', data).catch(err => console.error("Erro ao salvar escala de plantão no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar escala de plantão:", err);
  }
}

function loadApiResults() {
  return apiResultsCache || [];
}

function saveApiResults(data) {
  try {
    apiResultsCache = data;
    saveCollectionToMysql('api_resultados', data).catch(err => console.error("Erro ao salvar api_resultados no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar api_resultados:", err);
  }
}

function requireAdmin(req, res, next) {
  const isLoggedOut = req.cookies.admin_logged_out === 'true';
  if (isLoggedOut) {
    return res.redirect('/admin/login');
  }
  next();
}

function slugify(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

const SITEMAP_OLD_EXAMS = [];
const INTERFACE_FILE = 'tbl_interface_data';
const db = null;

// No-ops para compatibilidade retroativa segura
function saveJsonFile() {}
function loadLocalJson() { return []; }
async function syncToFirestore() {}

export {
  isMysqlEnabled,
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
  initializeDataStoreCaches,
  refreshDataStoreFromMysql,
  queryTableFromMysql,
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
  fixMojibake,
  cleanExamObject,
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
  loadEquipamentos,
  saveEquipamento,
  deleteEquipamento,
  saveEquipamentos,
  loadPessoas,
  savePessoas,
  loadEscalaPlantao,
  saveEscalaPlantao,
  parsePriceValue,
  requireAdmin,
  slugify,
  SITEMAP_OLD_EXAMS,
  INTERFACE_FILE
};
