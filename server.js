import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import {
  loadProfessionals,
  loadAccessProfiles,
  loadShortcuts,
  initializeDataStoreCaches,
  refreshDataStoreFromMysql,
  cleanObsoleteDatabaseFields
} from './server/dataStore.js';

import publicRoutes from './server/routes/public.js';
import adminAuthRoutes from './server/routes/adminAuth.js';
import adminExamesRoutes from './server/routes/adminExames.js';
import adminRecepcaoRoutes from './server/routes/adminRecepcao.js';
import adminResultadosRoutes from './server/routes/adminResultados.js';
import adminInterfaceamentoRoutes from './server/routes/adminInterfaceamento.js';
import adminFinanceiroRoutes from './server/routes/adminFinanceiro.js';
import adminQualidadeRoutes from './server/routes/adminQualidade.js';
import apiRoutes from './server/routes/api.js';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Rota de Healthcheck para Cloud Run / Probes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware para sincronização direta em tempo real com o MySQL a cada carregamento de página/API
let lastRefreshTime = 0;
const REFRESH_THROTTLE_MS = 2500; // Evita sobrecarga de dezenas de queries a cada clique rápido simultâneo

app.use(async (req, res, next) => {
  if (req.path.startsWith('/assets') || req.path.match(/\.(png|jpg|jpeg|gif|css|js|ico|svg|woff2?|ttf|eot)$/)) {
    return next();
  }
  const now = Date.now();
  if (now - lastRefreshTime > REFRESH_THROTTLE_MS) {
    lastRefreshTime = now;
    refreshDataStoreFromMysql().catch(err => {
      console.error("Erro ao sincronizar dados do MySQL para a requisição:", err.message || err);
    });
  }
  next();
});

// Middleware global de autenticação e permissões
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

// Registro dos Módulos de Rotas
app.use('/', publicRoutes);
app.use('/', adminAuthRoutes);
app.use('/', adminExamesRoutes);
app.use('/', adminRecepcaoRoutes);
app.use('/', adminResultadosRoutes);
app.use('/', adminInterfaceamentoRoutes);
app.use('/', adminFinanceiroRoutes);
app.use('/', adminQualidadeRoutes);
app.use('/', apiRoutes);

// Inicialização do Servidor
function startServer() {
  let attempts = 0;
  function tryListen() {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`InovaLab Cambará Server rodando na porta ${PORT}`);

      // Inicializar caches do MySQL e limpeza em background após abertura imediata da porta (essencial para probes do Cloud Run)
      (async () => {
        try {
          console.log("Iniciando carregamento dos caches do MySQL em background...");
          await initializeDataStoreCaches();
          console.log("Caches do MySQL carregados com sucesso.");
        } catch (err) {
          console.error("Erro ao inicializar caches do MySQL:", err);
        }

        try {
          await cleanObsoleteDatabaseFields();
        } catch (err) {
          console.error("Erro ao limpar campos obsoletos:", err);
        }
      })();
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        attempts++;
        if (attempts <= 5) {
          console.warn(`Porta ${PORT} ocupada, aguardando liberação (tentativa ${attempts}/5)...`);
          setTimeout(() => {
            try { server.close(); } catch (e) {}
            tryListen();
          }, 1000);
        } else {
          console.error(`Porta ${PORT} em uso após ${attempts} tentativas.`);
          process.exit(1);
        }
      } else {
        console.error('Erro no servidor HTTP:', err);
      }
    });
  }
  tryListen();
}

startServer();
