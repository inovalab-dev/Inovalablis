import express from "express";
import path from "path";
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
  parsePriceValue,
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
  loadEquipamentos,
  saveEquipamento,
  deleteEquipamento,
  saveEquipamentos,
  requireAdmin,
  slugify,
  SITEMAP_OLD_EXAMS
} from "../dataStore.js";

const router = express.Router();
const INTERFACE_FILE = path.join(process.cwd(), 'data', 'interface_data.json');

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
    liberados: [],
    mensagens: [],
    equipamentos: []
  };
}

function loadInterfaceData() {
  if (!interfaceCache) {
    interfaceCache = getDefaultInterfaceData();
  }
  
  if (!Array.isArray(interfaceCache.naoEnviados)) interfaceCache.naoEnviados = [];
  if (!Array.isArray(interfaceCache.processando)) interfaceCache.processando = [];
  if (!Array.isArray(interfaceCache.prontos)) interfaceCache.prontos = [];
  if (!Array.isArray(interfaceCache.liberados)) interfaceCache.liberados = [];
  if (!Array.isArray(interfaceCache.mensagens)) interfaceCache.mensagens = [];
  interfaceCache.equipamentos = loadEquipamentos();

  // Re-format all barcodes in interface lists to 01-00001001-01 standard
  ['naoEnviados', 'processando', 'prontos', 'liberados'].forEach(listName => {
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

          const isLiberado = 
            statusStr === 'liberado' || 
            statusStr === 'conferido' || 
            statusStr === 'laudado' || 
            statusStr === 'concluido' || 
            statusStr === 'concluído' || 
            situacaoStr === 'liberado' || 
            situacaoStr === 'conferido' || 
            situacaoStr === 'laudado' || 
            situacaoStr === 'concluido' || 
            situacaoStr === 'concluído' || 
            !!ex.liberadoAt || 
            !!ex.liberadoBy;

          const isTriado = 
            statusStr === 'triado' || 
            situacaoStr === 'triado' || 
            ex.triado === true || 
            req.triado === true || 
            req.status === 'Triado' || 
            (ex.triagemAt && String(ex.triagemAt).trim() !== '');

          const isLoteCriado = !!(
            ex.idLote || 
            ex.loteCode || 
            ex.loteId || 
            (ex.loteStatus && String(ex.loteStatus).trim() !== '') ||
            (ex.status && String(ex.status).toLowerCase().includes('lote')) ||
            (ex.status && String(ex.status).toLowerCase().includes('enviado')) ||
            (ex.status && String(ex.status).toLowerCase().includes('process')) ||
            (ex.situacao && String(ex.situacao).toLowerCase().includes('lote'))
          );

          const reqCodeFormatted = formatRequisitionCode(req.requisitionCode || req.id);
          const exCodeUpper = String(ex.code || ex.codigo || 'EXAM').toUpperCase().trim();
          const exBcClean = String(ex.sampleBarcode || req.barcode || '').toLowerCase().replace(/[-_]/g, '');

          // Atualizar o destino de triagem e o flag isTriado em todos os itens existentes no cache do interfaceamento
          ['naoEnviados', 'processando', 'prontos', 'liberados'].forEach(listName => {
            if (Array.isArray(interfaceCache[listName])) {
              interfaceCache[listName].forEach(item => {
                if (!item) return;
                const itemReqFormatted = formatRequisitionCode(item.requisitionCode);
                const itemExCodeUpper = String(item.examCode || item.code || item.codigo || '').toUpperCase().trim();
                const itemBcClean = String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');

                const reqMatch = (itemReqFormatted === reqCodeFormatted) && (itemExCodeUpper === exCodeUpper || !exCodeUpper || !itemExCodeUpper);
                const bcMatch = exBcClean && itemBcClean && (itemBcClean === exBcClean);

                if (reqMatch || bcMatch) {
                  item.triagemDestination = triagemDest;
                  item.isTriado = isTriado;
                }
              });
            }
          });

          // Se o lote foi criado no apoio e o exame estava em naoEnviados, avança para processando
          if (isLoteCriado && Array.isArray(interfaceCache.naoEnviados)) {
            const idxNaoEnv = interfaceCache.naoEnviados.findIndex(item => {
              if (!item) return false;
              const itemReqFormatted = formatRequisitionCode(item.requisitionCode);
              const itemExCodeUpper = String(item.examCode || item.code || item.codigo || '').toUpperCase().trim();
              const itemBcClean = String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');

              const reqMatch = (itemReqFormatted === reqCodeFormatted) && (itemExCodeUpper === exCodeUpper || !exCodeUpper || !itemExCodeUpper);
              const bcMatch = exBcClean && itemBcClean && (itemBcClean === exBcClean);
              return reqMatch || bcMatch;
            });

            if (idxNaoEnv !== -1) {
              const movedItem = interfaceCache.naoEnviados.splice(idxNaoEnv, 1)[0];
              movedItem.status = 'Em Processamento';
              movedItem.loteCode = ex.loteCode || ex.idLote || ex.loteId || movedItem.loteCode || null;
              movedItem.startTime = movedItem.startTime || ex.loteAt || new Date().toLocaleString('pt-BR');
              movedItem.triagemDestination = triagemDest;
              movedItem.isTriado = true;

              if (!Array.isArray(interfaceCache.processando)) {
                interfaceCache.processando = [];
              }
              const existsInProc = interfaceCache.processando.some(item => {
                if (!item) return false;
                const itemReqFormatted = formatRequisitionCode(item.requisitionCode);
                const itemExCodeUpper = String(item.examCode || item.code || item.codigo || '').toUpperCase().trim();
                const itemBcClean = String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');

                const reqMatch = (itemReqFormatted === reqCodeFormatted) && (itemExCodeUpper === exCodeUpper || !exCodeUpper || !itemExCodeUpper);
                const bcMatch = exBcClean && itemBcClean && (itemBcClean === exBcClean);
                return reqMatch || bcMatch;
              });

              if (!existsInProc) {
                interfaceCache.processando.unshift(movedItem);
              }
            }
          }

          if (isLiberado) {
            // Remove de naoEnviados, processando e prontos se o exame foi liberado
            ['naoEnviados', 'processando', 'prontos'].forEach(listName => {
              if (Array.isArray(interfaceCache[listName])) {
                interfaceCache[listName] = interfaceCache[listName].filter(item => {
                  if (!item) return false;
                  const itemReqFormatted = formatRequisitionCode(item.requisitionCode);
                  const itemExCodeUpper = String(item.examCode || item.code || item.codigo || '').toUpperCase().trim();
                  const itemBcClean = String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');

                  const reqMatch = (itemReqFormatted === reqCodeFormatted) && (itemExCodeUpper === exCodeUpper || !exCodeUpper || !itemExCodeUpper);
                  const bcMatch = exBcClean && itemBcClean && (itemBcClean === exBcClean);
                  return !(reqMatch || bcMatch);
                });
              }
            });

            // Verifica se já está em liberados
            const existsInLiberados = (interfaceCache.liberados || []).some(item => {
              if (!item) return false;
              const itemReqFormatted = formatRequisitionCode(item.requisitionCode);
              const itemExCodeUpper = String(item.examCode || item.code || item.codigo || '').toUpperCase().trim();
              const itemBcClean = String(item.sampleBarcode || '').toLowerCase().replace(/[-_]/g, '');

              const reqMatch = (itemReqFormatted === reqCodeFormatted) && (itemExCodeUpper === exCodeUpper || !exCodeUpper || !itemExCodeUpper);
              const bcMatch = exBcClean && itemBcClean && (itemBcClean === exBcClean);
              return reqMatch || bcMatch;
            });

            if (!existsInLiberados) {
              const reqCode = req.requisitionCode || req.id || '000000';
              const patName = req.patientName || req.pacienteName || 'Paciente sem nome';
              const sampleBarcode = formatSampleBarcode(reqCode, ex.sector || ex.equipment, req.barcode || ex.barcode);

              let libBy = ex.liberadoBy || ex.conferidoBy || ex.liberadoPor || ex.conferidoPor || req.liberadoPor || req.conferidoPor || 'Dra. Gabriela Amaral';
              let libAt = ex.liberadoAt || ex.conferidoAt || ex.dataResultado || req.dataResultado || (req.createdAt ? new Date(req.createdAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR'));

              const liberadoItem = {
                id: 'INT-LIB-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
                requisitionCode: reqCode,
                patientName: patName,
                patientAge: req.patientAge || req.idade || 'N/I',
                patientSex: req.patientSex || 'M',
                convenio: req.convenioName || req.convenio || 'Particular',
                examCode: ex.code || ex.codigo || 'EXAM',
                examTitle: ex.name || ex.titulo || ex.descricao || ex.code || 'Exame',
                material: ex.material || ex.materialColetado || 'Soro',
                equipment: ex.equipment || (triagemDest !== 'interno' ? 'Laboratório de Apoio (' + triagemDest.toUpperCase() + ')' : 'Analisador Automático'),
                sampleBarcode: sampleBarcode,
                dateRequested: req.createdAt ? (typeof req.createdAt === 'string' ? req.createdAt : new Date(req.createdAt).toLocaleString('pt-BR')) : new Date().toLocaleString('pt-BR'),
                completedTime: libAt,
                dateLiberated: libAt,
                liberadoBy: libBy,
                status: 'Liberado',
                sector: ex.sector || 'Geral',
                resultValue: ex.valor || ex.resultado || ex.resultValue || (ex.parsedValores ? 'Laudo Completo' : 'Liberado'),
                unit: ex.unidade || ex.unit || '',
                refRange: ex.referencia || ex.refRange || '',
                parsedValores: ex.parsedValores || ex.valores || null,
                triagemDestination: triagemDest,
                isTriado: true
              };
              interfaceCache.liberados.unshift(liberadoItem);
            }
          } else if (isTriado) { // Apenas exames triados entram para processamento no interfaceamento
            const exists = ['naoEnviados', 'processando', 'prontos', 'liberados'].some(listName => 
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
                if (triagemDest !== 'interno') {
                  equipment = 'Apoio - ' + triagemDest.toUpperCase();
                } else if (examCodeUpper === 'HEMO' || (ex.sector && ex.sector.toLowerCase().includes('hema'))) {
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
                startTime: ex.loteAt || new Date().toLocaleString('pt-BR'),
                status: isLoteCriado ? 'Em Processamento' : 'Aguardando Execução',
                sector: ex.sector || 'Geral',
                triagemDestination: triagemDest,
                isTriado: true,
                loteCode: ex.loteCode || ex.idLote || ex.loteId || null,
                astmFrame: `H|\\^&|||LIS_INOVALAB|||||LIS|P|1|${nowIso}\nP|1||${reqCode}||${patNameAstm}|||M\nO|1|${sampleBarcode}||^^^${ex.code || 'EXAM'}|R|${nowIso}\nL|1|N`
              };

              if (isLoteCriado) {
                if (!Array.isArray(interfaceCache.processando)) {
                  interfaceCache.processando = [];
                }
                interfaceCache.processando.unshift(newItem);
              } else {
                if (!Array.isArray(interfaceCache.naoEnviados)) {
                  interfaceCache.naoEnviados = [];
                }
                interfaceCache.naoEnviados.unshift(newItem);
              }
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
    saveCollectionToMysql('interface_data', data).catch(err => console.error("Erro ao salvar interface_data no MySQL:", err));
  } catch (err) {
    console.error("Erro ao salvar interface_data:", err);
  }
}

// Helper para filtrar interfaceData por destino da triagem
function filterInterfaceByDestination(fullData, isInternalTarget) {
  if (!fullData) return fullData;
  const lists = ['naoEnviados', 'processando', 'prontos', 'liberados'];
  const filtered = { ...fullData };

  lists.forEach(listName => {
    if (Array.isArray(fullData[listName])) {
      filtered[listName] = fullData[listName].filter(item => {
        if (!item) return false;
        const dest = String(item.triagemDestination || 'interno').trim().toLowerCase();
        const isTriado = item.isTriado !== false;
        
        if (!isTriado) return false;
        
        if (isInternalTarget) {
          return dest === 'interno';
        } else {
          return dest !== 'interno';
        }
      });
    }
  });

  return filtered;
}

// Rota principal da tela de Interfaceamento (Interna)
router.get(['/admin/interfaceamento', '/admin/interfaceamento-interno'], requireAdmin, (req, res) => {
  const rawInterfaceData = loadInterfaceData();
  const interfaceData = filterInterfaceByDestination(rawInterfaceData, true);
  const requisitions = loadRequisitions();
  res.render('admin/interfaceamento', {
    interfaceData,
    requisitions,
    page: 'admin-interfaceamento'
  });
});

// Rota da tela de Interfaceamento Externa
router.get('/admin/interfaceamento-externo', requireAdmin, (req, res) => {
  const rawInterfaceData = loadInterfaceData();
  const interfaceData = filterInterfaceByDestination(rawInterfaceData, false);
  const requisitions = loadRequisitions();
  const supportLabs = loadSupportLabs();
  res.render('admin/interfaceamento_externo', {
    interfaceData,
    requisitions,
    supportLabs,
    page: 'admin-interfaceamento-externo'
  });
});

// Rota da tela de Cadastro de Equipamentos Interfaceados
router.get(['/admin/interfaceamento/equipamentos', '/admin/equipamentos'], requireAdmin, (req, res) => {
  const equipamentos = loadEquipamentos();
  const setores = loadSetores();
  res.render('admin/equipamentos', {
    equipamentos: equipamentos || [],
    setores: setores || [],
    page: 'admin-interfaceamento-equipamentos'
  });
});

// APIs de Interfaceamento
router.get('/api/interfaceamento/data', requireAdmin, (req, res) => {
  try {
    const rawData = loadInterfaceData();
    let data = rawData;
    if (req.query.type === 'interno') {
      data = filterInterfaceByDestination(rawData, true);
    } else if (req.query.type === 'externo') {
      data = filterInterfaceByDestination(rawData, false);
    }
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao carregar dados do interfaceamento.' });
  }
});

// APIs para Cadastro e Gestão de Equipamentos Interfaceados
router.get('/api/interfaceamento/equipamentos', requireAdmin, (req, res) => {
  try {
    const equipamentos = loadEquipamentos();
    return res.json({ success: true, equipamentos: equipamentos || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao listar equipamentos.' });
  }
});

router.post(['/admin/interfaceamento/equipamentos/salvar', '/admin/equipamentos/salvar', '/api/interfaceamento/equipamentos/salvar'], requireAdmin, async (req, res) => {
  try {
    const { id, chave, descricao, nome, setor, setorId, modelo, fabricante, protocolo, tipoConexao, ip, porta, status, observacao } = req.body;

    const eqChave = (chave || '').trim();
    const eqDesc = (descricao || nome || '').trim();

    if (!eqDesc) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'A descrição (nome do equipamento) é obrigatória.' });
      }
      return res.redirect('/admin/interfaceamento/equipamentos?error=missing_descricao');
    }

    // Tenta resolver a relação do setor com a tabela oficial de setores (tbl_setores)
    const setoresMaster = loadSetores() || [];
    let matchedSetor = null;
    if (setorId) {
      matchedSetor = setoresMaster.find(s => String(s.id) === String(setorId) || String(s.codigo) === String(setorId));
    }
    if (!matchedSetor && setor) {
      matchedSetor = setoresMaster.find(s => 
        (s.descricao && s.descricao.toLowerCase() === String(setor).trim().toLowerCase()) ||
        (s.nome && s.nome.toLowerCase() === String(setor).trim().toLowerCase())
      );
    }

    const finalSetorId = matchedSetor ? matchedSetor.id : (setorId || '');
    const eqId = id && String(id).trim() ? String(id).trim() : 'eq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const eqData = {
      id: eqId,
      chave: eqChave || eqId,
      nome: eqDesc,
      descricao: eqDesc,
      setor_id: finalSetorId,
      setorId: finalSetorId,
      modelo: modelo ? String(modelo).trim() : '',
      fabricante: fabricante ? String(fabricante).trim() : '',
      protocolo: protocolo ? String(protocolo).trim() : 'ASTM E1394',
      tipoConexao: tipoConexao ? String(tipoConexao).trim() : 'TCP/IP',
      ip: ip ? String(ip).trim() : '',
      porta: porta ? String(porta).trim() : '',
      status: status ? String(status).trim() : 'Ativo',
      observacao: observacao ? String(observacao).trim() : ''
    };

    const savedEq = await saveEquipamento(eqData);
    const updatedEquipamentos = loadEquipamentos();

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, message: 'Equipamento salvo com sucesso no MySQL!', equipamento: savedEq, equipamentos: updatedEquipamentos });
    }
    return res.redirect('/admin/interfaceamento/equipamentos?success=saved');
  } catch (err) {
    console.error('Erro ao salvar equipamento no MySQL:', err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, message: 'Erro ao salvar equipamento no MySQL: ' + err.message });
    }
    return res.redirect('/admin/interfaceamento/equipamentos?error=save_failed');
  }
});

router.all(['/admin/interfaceamento/equipamentos/excluir/:id', '/admin/equipamentos/excluir/:id', '/api/interfaceamento/equipamentos/excluir', '/api/interfaceamento/equipamentos/excluir/:id'], requireAdmin, async (req, res) => {
  try {
    const targetId = String(req.params.id || req.body?.id || req.query?.id || '').trim();
    if (!targetId) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'ID do equipamento não informado.' });
      }
      return res.redirect('/admin/interfaceamento/equipamentos?error=missing_id');
    }

    await deleteEquipamento(targetId);
    const updatedEquipamentos = loadEquipamentos();

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, message: 'Equipamento removido com sucesso do MySQL!', equipamentos: updatedEquipamentos });
    }
    return res.redirect('/admin/interfaceamento/equipamentos?success=deleted');
  } catch (err) {
    console.error('Erro ao excluir equipamento no MySQL:', err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, message: 'Erro ao excluir equipamento no MySQL: ' + err.message });
    }
    return res.redirect('/admin/interfaceamento/equipamentos?error=delete_failed');
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

    const requestedEquipment = 
      req.params.equipamento ||
      req.query.equipamento || req.query.equipamentoId || req.query.codigoEquipamento || req.query.codEquipamento || req.query.codigo_equipamento ||
      req.query.equipment || req.query.equipmentId || req.query.instrument || req.query.instrumentId || req.query.equip || req.query.device ||
      req.headers['x-equipment-id'] || req.headers['x-equipamento'] || req.headers['x-codigo-equipamento'] || req.headers['equipment'] || req.headers['x-instrument'] ||
      (req.body && (req.body.equipamento || req.body.equipamentoId || req.body.codigoEquipamento || req.body.codEquipamento || req.body.codigo_equipamento || req.body.equipment || req.body.equipmentId || req.body.instrument || req.body.equip));
    
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
    const equipamentosCadastrados = (interfaceData && Array.isArray(interfaceData.equipamentos)) ? interfaceData.equipamentos : getDefaultEquipments();
    const catalogExams = loadExams() || [];

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

    // =========================================================================
    // IDENTIFICAÇÃO DO EQUIPAMENTO SOLICITADO E FILTRAGEM ESPECÍFICA DE EXAMES
    // =========================================================================
    const reqEqNormalized = requestedEquipment ? String(requestedEquipment).trim().toLowerCase() : '';
    const reqEqClean = reqEqNormalized.replace(/[^a-z0-9]/gi, '');

    // Busca o equipamento correspondente na lista de integrações cadastradas
    let matchedEqObj = null;
    if (reqEqNormalized) {
      matchedEqObj = equipamentosCadastrados.find(eq => {
        if (!eq) return false;
        const eqId = String(eq.id || '').toLowerCase().trim();
        const eqChave = String(eq.chave || '').toLowerCase().trim();
        const eqCod = String(eq.codigo || '').toLowerCase().trim();
        const eqDesc = String(eq.descricao || eq.nome || '').toLowerCase().trim();
        const eqMod = String(eq.modelo || '').toLowerCase().trim();

        return eqId === reqEqNormalized ||
               eqChave === reqEqNormalized ||
               eqCod === reqEqNormalized ||
               eqDesc === reqEqNormalized ||
               eqMod === reqEqNormalized ||
               (eqId && eqId.replace(/[^a-z0-9]/gi, '') === reqEqClean) ||
               (eqChave && eqChave.replace(/[^a-z0-9]/gi, '') === reqEqClean) ||
               (eqCod && eqCod.replace(/[^a-z0-9]/gi, '') === reqEqClean) ||
               (eqMod && eqMod.replace(/[^a-z0-9]/gi, '') === reqEqClean) ||
               (eqDesc && (eqDesc.includes(reqEqNormalized) || reqEqNormalized.includes(eqDesc))) ||
               (eqChave && (eqChave.includes(reqEqNormalized) || reqEqNormalized.includes(eqChave)));
      });
    }

    // Cria conjunto de identificadores do equipamento alvo para cruzar com o cadastro do exame
    const eqIdentifiers = new Set();
    if (reqEqNormalized) {
      eqIdentifiers.add(reqEqNormalized);
      if (reqEqClean) eqIdentifiers.add(reqEqClean);
    }
    if (matchedEqObj) {
      if (matchedEqObj.id) {
        eqIdentifiers.add(String(matchedEqObj.id).toLowerCase().trim());
        eqIdentifiers.add(String(matchedEqObj.id).toLowerCase().replace(/[^a-z0-9]/gi, ''));
      }
      if (matchedEqObj.chave) {
        eqIdentifiers.add(String(matchedEqObj.chave).toLowerCase().trim());
        eqIdentifiers.add(String(matchedEqObj.chave).toLowerCase().replace(/[^a-z0-9]/gi, ''));
      }
      if (matchedEqObj.codigo) {
        eqIdentifiers.add(String(matchedEqObj.codigo).toLowerCase().trim());
        eqIdentifiers.add(String(matchedEqObj.codigo).toLowerCase().replace(/[^a-z0-9]/gi, ''));
      }
      if (matchedEqObj.modelo) {
        eqIdentifiers.add(String(matchedEqObj.modelo).toLowerCase().trim());
        eqIdentifiers.add(String(matchedEqObj.modelo).toLowerCase().replace(/[^a-z0-9]/gi, ''));
      }
      if (matchedEqObj.descricao || matchedEqObj.nome) {
        const desc = String(matchedEqObj.descricao || matchedEqObj.nome).toLowerCase().trim();
        eqIdentifiers.add(desc);
        eqIdentifiers.add(desc.replace(/[^a-z0-9]/gi, ''));
      }
    }

    const displayEquipmentName = (matchedEqObj 
      ? (matchedEqObj.chave ? `${matchedEqObj.chave} - ${matchedEqObj.descricao || matchedEqObj.nome}` : (matchedEqObj.descricao || matchedEqObj.nome))
      : requestedEquipment) || foundItem.equipment || "Equipamento API";

    // Função de verificação se um exame é específico deste equipamento
    function checkExamMatchesEquipment(candidateCode, candidateTitle, candidateItemEquipment) {
      // Se não foi passado equipamento, retorna todos os exames da amostra
      if (!reqEqNormalized) {
        return {
          matches: true,
          hl7Code: null,
          equipmentName: candidateItemEquipment || displayEquipmentName,
          material: null,
          catalogExam: null
        };
      }

      const cleanCode = String(candidateCode || '').toLowerCase().trim();
      const cleanTitle = String(candidateTitle || '').toLowerCase().trim();

      // Busca o exame no catálogo oficial de exames (loadExams)
      const catExam = catalogExams.find(e => {
        if (!e) return false;
        const cCode = String(e.code || e.codigo || e.jalisCode || '').toLowerCase().trim();
        const cId = String(e.id || '').toLowerCase().trim();
        const cName = String(e.name || e.nome || '').toLowerCase().trim();
        return (cleanCode && (cCode === cleanCode || cId === cleanCode)) ||
               (cleanTitle && (cName === cleanTitle || cCode === cleanTitle));
      });

      if (catExam) {
        // Verifica nos materiais coletados (na aba Integrações onde foi associado o equipamento)
        const matList = Array.isArray(catExam.materiaisColetados) ? catExam.materiaisColetados : [];
        for (const mat of matList) {
          if (!mat) continue;
          const matEq = String(mat.equipamento || '').trim().toLowerCase();
          const matEqClean = matEq.replace(/[^a-z0-9]/gi, '');

          if (matEq) {
            for (const idf of eqIdentifiers) {
              if (idf && (matEq === idf || matEqClean === idf || matEq.includes(idf) || idf.includes(matEq))) {
                return {
                  matches: true,
                  hl7Code: mat.codigoHl7 || catExam.codigoHl7 || catExam.code,
                  equipmentName: mat.equipamento || displayEquipmentName,
                  material: mat.nome || mat.material || catExam.category || "Soro",
                  catalogExam: catExam
                };
              }
            }

            // Testa subdivisões (como "eq_urit_8021a - Urit 8021A")
            if (matEq.includes('-')) {
              const parts = matEq.split('-').map(p => p.trim().toLowerCase());
              for (const p of parts) {
                const pClean = p.replace(/[^a-z0-9]/gi, '');
                for (const idf of eqIdentifiers) {
                  if (idf && (p === idf || pClean === idf || p.includes(idf) || idf.includes(p))) {
                    return {
                      matches: true,
                      hl7Code: mat.codigoHl7 || catExam.codigoHl7 || catExam.code,
                      equipmentName: mat.equipamento || displayEquipmentName,
                      material: mat.nome || mat.material || catExam.category || "Soro",
                      catalogExam: catExam
                    };
                  }
                }
              }
            }
          }
        }

        // Verifica equipamento direto no nível do exame
        const examEq = String(catExam.equipamento || catExam.equipment || catExam.codigoEquipamento || '').trim().toLowerCase();
        if (examEq) {
          const examEqClean = examEq.replace(/[^a-z0-9]/gi, '');
          for (const idf of eqIdentifiers) {
            if (idf && (examEq === idf || examEqClean === idf || examEq.includes(idf) || idf.includes(examEq))) {
              return {
                matches: true,
                hl7Code: catExam.codigoHl7 || catExam.code,
                equipmentName: catExam.equipamento || displayEquipmentName,
                material: catExam.category || "Soro",
                catalogExam: catExam
              };
            }
          }
        }
      }

      // Verifica equipamento vindo diretamente no item de interfaceamento da ordem
      if (candidateItemEquipment) {
        const itemEq = String(candidateItemEquipment).trim().toLowerCase();
        const itemEqClean = itemEq.replace(/[^a-z0-9]/gi, '');
        for (const idf of eqIdentifiers) {
          if (idf && (itemEq === idf || itemEqClean === idf || itemEq.includes(idf) || idf.includes(itemEq))) {
            return {
              matches: true,
              hl7Code: null,
              equipmentName: candidateItemEquipment,
              material: "Soro",
              catalogExam: catExam || null
            };
          }
        }
      }

      return { matches: false, hl7Code: null, equipmentName: null, material: null, catalogExam: null };
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
        const exTitle = item.examTitle || item.nome || item.name || code;
        
        const matchResult = checkExamMatchesEquipment(code, exTitle, item.equipment);
        if (matchResult.matches) {
          const finalCode = (matchResult.hl7Code || code || 'EXAME').trim();
          const cleanKey = finalCode.toLowerCase();
          if (!examCodesSet.has(cleanKey)) {
            examCodesSet.add(cleanKey);

            let params = [];
            if (matchResult.catalogExam && Array.isArray(matchResult.catalogExam.mascarasCampos) && matchResult.catalogExam.mascarasCampos.length > 0) {
              params = matchResult.catalogExam.mascarasCampos.map(c => c.nome || c.campo || c.descricao || c.tag).filter(Boolean);
            }
            if (params.length === 0 && (finalCode.toUpperCase().includes('HEMO') || exTitle.toUpperCase().includes('HEMOGRAMA'))) {
              params = ["HEMACIAS", "HEMOGLOBINA", "HEMATOCRITO", "VCM", "HCM", "CHCM", "RDW", "LEUCOCITOS", "BASTONETES", "SEGMENTADOS", "EOSINOFILOS", "BASOFILOS", "LINFOCITOS", "MONOCITOS", "PLAQUETAS", "VMP"];
            }

            examList.push({
              codigo: finalCode,
              ...(matchResult.hl7Code ? { codigoHl7: matchResult.hl7Code } : {}),
              codigoLis: code || finalCode,
              nome: exTitle,
              material: matchResult.material || item.material || "Soro",
              equipamento: matchResult.equipmentName || displayEquipmentName,
              ...(params.length > 0 ? { parametros: params } : {})
            });
          }
        }
      }
    });

    if (reqObj && Array.isArray(reqObj.exams)) {
      reqObj.exams.forEach(ex => {
        if (!ex) return;
        const code = ex.code || ex.codigo || ex.jalisCode || ex.id || ex.examCode || ex.name;
        const exTitle = ex.name || ex.nome || ex.title || ex.examTitle || code;

        const matchResult = checkExamMatchesEquipment(code, exTitle, ex.equipment);
        if (matchResult.matches) {
          const finalCode = (matchResult.hl7Code || code || 'EXAME').trim();
          const cleanKey = finalCode.toLowerCase();
          if (!examCodesSet.has(cleanKey)) {
            examCodesSet.add(cleanKey);

            let params = [];
            if (matchResult.catalogExam && Array.isArray(matchResult.catalogExam.mascarasCampos) && matchResult.catalogExam.mascarasCampos.length > 0) {
              params = matchResult.catalogExam.mascarasCampos.map(c => c.nome || c.campo || c.descricao || c.tag).filter(Boolean);
            }
            if (params.length === 0 && (finalCode.toUpperCase().includes('HEMO') || exTitle.toUpperCase().includes('HEMOGRAMA'))) {
              params = ["HEMACIAS", "HEMOGLOBINA", "HEMATOCRITO", "VCM", "HCM", "CHCM", "RDW", "LEUCOCITOS", "BASTONETES", "SEGMENTADOS", "EOSINOFILOS", "BASOFILOS", "LINFOCITOS", "MONOCITOS", "PLAQUETAS", "VMP"];
            }

            examList.push({
              codigo: finalCode,
              ...(matchResult.hl7Code ? { codigoHl7: matchResult.hl7Code } : {}),
              codigoLis: code || finalCode,
              nome: exTitle,
              material: matchResult.material || ex.material || "Soro",
              equipamento: matchResult.equipmentName || displayEquipmentName,
              ...(params.length > 0 ? { parametros: params } : {})
            });
          }
        }
      });
    }

    // Se NÃO foi filtrado por equipamento e não achou nada, aplica fallback geral
    if (examList.length === 0 && !reqEqNormalized) {
      const fallbackCode = String(foundItem.examCode || foundItem.codigo || foundItem.code || "GLICO").trim();
      let params = [];
      if (fallbackCode.toUpperCase().includes('HEMO') || (foundItem.examTitle || '').toUpperCase().includes('HEMOGRAMA')) {
        params = ["HEMACIAS", "HEMOGLOBINA", "HEMATOCRITO", "VCM", "HCM", "CHCM", "RDW", "LEUCOCITOS", "BASTONETES", "SEGMENTADOS", "EOSINOFILOS", "BASOFILOS", "LINFOCITOS", "MONOCITOS", "PLAQUETAS", "VMP"];
      }

      examList.push({
        codigo: fallbackCode,
        codigoLis: fallbackCode,
        nome: foundItem.examTitle || fallbackCode,
        material: foundItem.material || "Soro",
        equipamento: displayEquipmentName,
        ...(params.length > 0 ? { parametros: params } : {})
      });
    }

    return res.json({
      idAmostra: foundItem.sampleBarcode || searchCode,
      idPaciente: idPaciente,
      nome: nome,
      genero: genero,
      idade: idade,
      dataNascimento: dataNascimento || "",
      equipamento: displayEquipmentName,
      status: foundItem.status || "Processando",
      totalExames: examList.length,
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

router.get('/api/amostra/:codigoAmostra/:equipamento', handleAmostraLookup);
router.get('/api/amostra/:codigoAmostra', handleAmostraLookup);
router.get('/api/amostra', handleAmostraLookup);
router.post('/api/amostra', handleAmostraLookup);
router.get('/api/interfaceamento/amostra/:codigoAmostra/:equipamento', handleAmostraLookup);
router.get('/api/interfaceamento/amostra/:codigoAmostra', handleAmostraLookup);

// Endpoints para gravação de resultados de exames (Move de Processando -> Prontos)
router.post('/api/amostra/resultado', handleAmostraResultado);
router.get('/api/amostra/resultado', handleAmostraResultado);
router.post('/api/amostra/resultados', handleAmostraResultado);
router.get('/api/amostra/resultados', handleAmostraResultado);
router.post('/api/amostra/resultado/:idAmostra', handleAmostraResultado);
router.get('/api/amostra/resultado/:idAmostra', handleAmostraResultado);
router.post('/api/amostra/:codigoAmostra/resultado', handleAmostraResultado);
router.get('/api/amostra/:codigoAmostra/resultado', handleAmostraResultado);

router.post('/api/interfaceamento/amostra/resultado', handleAmostraResultado);
router.get('/api/interfaceamento/amostra/resultado', handleAmostraResultado);
router.post('/api/interfaceamento/amostra/resultado/:idAmostra', handleAmostraResultado);
router.get('/api/interfaceamento/amostra/resultado/:idAmostra', handleAmostraResultado);
router.post('/api/interfaceamento/amostra/:codigoAmostra/resultado', handleAmostraResultado);
router.get('/api/interfaceamento/amostra/:codigoAmostra/resultado', handleAmostraResultado);

// Endpoints para indicar início de processamento da amostra (Move de Não Enviados -> Processando)
router.post('/api/amostra/processar', handleProcessarAmostra);
router.get('/api/amostra/processar', handleProcessarAmostra);
router.post('/api/amostra/processar/:codigoAmostra', handleProcessarAmostra);
router.get('/api/amostra/processar/:codigoAmostra', handleProcessarAmostra);
router.post('/api/amostra/status', handleProcessarAmostra);
router.post('/api/interfaceamento/processar-amostra', handleProcessarAmostra);
router.post('/api/interfaceamento/processar-amostra/:codigoAmostra', handleProcessarAmostra);
router.get('/api/interfaceamento/processar-amostra/:codigoAmostra', handleProcessarAmostra);

router.post('/api/interfaceamento/send-order', requireAdmin, (req, res) => {
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

router.post('/api/interfaceamento/revert-to-naoenviados', (req, res) => {
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

router.post('/api/interfaceamento/revert-to-processando', (req, res) => {
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

router.post('/api/interfaceamento/send-all', requireAdmin, (req, res) => {
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

router.post('/api/interfaceamento/simulate-result', requireAdmin, (req, res) => {
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

router.post('/api/interfaceamento/add-manual-order', requireAdmin, (req, res) => {
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

router.post('/api/interfaceamento/clear-logs', requireAdmin, (req, res) => {
  try {
    let data = loadInterfaceData();
    data.mensagens = [];
    saveInterfaceData(data);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro ao limpar logs.' });
  }
});

router.post('/api/interfaceamento/limpar-ficticias', requireAdmin, (req, res) => {
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

router.post('/api/interfaceamento/limpar-tudo', requireAdmin, (req, res) => {
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
router.post('/admin/recepcao/pacientes/save-ajax', requireAdmin, (req, res) => {
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
      patientId,
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
      doctorId,
      doctorCode,
      doctorCrm,
      doctorUf,
      doctorCrmType,
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
      discountPercent,
      totalAmount,
      paymentMethod,
      paymentCondition,
      paidAmount,
      financialStatus,
      deliveryDate,
      deliveryDays,
      deliveryTime,
      cid10,
      notifyWhatsapp,
      separateLabel,
      fastingHours,
      payments,
      faturadoAmount
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

    // Relacionamento com a tabela de Pacientes
    const patientsList = loadPatients();
    let matchedPatient = null;
    if (patientCode) {
      matchedPatient = patientsList.find(p => String(p.code || p.id).trim().toLowerCase() === String(patientCode).trim().toLowerCase());
    }
    if (!matchedPatient && patientCpf) {
      const cleanCpf = String(patientCpf).replace(/\D/g, '');
      if (cleanCpf) matchedPatient = patientsList.find(p => String(p.cpf || '').replace(/\D/g, '') === cleanCpf);
    }
    if (!matchedPatient && patientName) {
      const pTrim = String(patientName).trim().toLowerCase();
      matchedPatient = patientsList.find(p => (p.name && p.name.trim().toLowerCase() === pTrim) || (p.patientName && p.patientName.trim().toLowerCase() === pTrim));
    }

    let savedPatientName = matchedPatient ? (matchedPatient.name || matchedPatient.patientName) : String(patientName).trim();
    let savedPatientCode = matchedPatient ? (matchedPatient.code || matchedPatient.id) : String(patientCode || '').trim();

    if (!matchedPatient && savedPatientName) {
      const newCode = savedPatientCode || String(patientsList.length + 1);
      const newPat = {
        id: 'PAC-' + Date.now().toString().slice(-6),
        code: newCode,
        prontuario: 'PEP-' + Math.floor(10000 + Math.random() * 90000),
        name: savedPatientName,
        cpf: patientCpf || '',
        birthDate: patientBirthDate || '',
        gender: patientSex || 'Outro',
        phone: patientPhone || '',
        address: address || '',
        city: city || 'Cambará',
        state: 'PR',
        createdAt: new Date().toISOString()
      };
      patientsList.push(newPat);
      savePatients(patientsList);
      savedPatientCode = newPat.code;
    }

    // Relacionamento com a tabela de Médicos
    const medicosList = loadMedicos();
    let matchedDoctor = null;
    if (doctorId) {
      matchedDoctor = medicosList.find(m => String(m.id).trim().toLowerCase() === String(doctorId).trim().toLowerCase());
    }
    if (!matchedDoctor && doctorCode) {
      matchedDoctor = medicosList.find(m => String(m.codigo || m.id).trim().toLowerCase() === String(doctorCode).trim().toLowerCase());
    }
    if (!matchedDoctor && doctorCrm) {
      const cleanCrm = String(doctorCrm).replace(/\D/g, '');
      const ufMatch = doctorUf ? String(doctorUf).trim().toLowerCase() : null;
      if (cleanCrm) {
        matchedDoctor = medicosList.find(m => {
          const mCrm = String(m.numero || m.crm || '').replace(/\D/g, '');
          if (mCrm !== cleanCrm) return false;
          if (ufMatch && m.uf) return String(m.uf).trim().toLowerCase() === ufMatch;
          return true;
        });
      }
    }
    if (!matchedDoctor && doctorName) {
      const docTrim = String(doctorName).trim().toLowerCase().replace(/^dr\.?\s*/i, '').replace(/^dra\.?\s*/i, '');
      if (docTrim) {
        matchedDoctor = medicosList.find(m => {
          const mName = String(m.nome || m.name || '').trim().toLowerCase().replace(/^dr\.?\s*/i, '').replace(/^dra\.?\s*/i, '');
          return mName && mName === docTrim;
        });
      }
    }

    let savedDoctorName = matchedDoctor ? (matchedDoctor.nome || matchedDoctor.name) : String(doctorName || '').trim();
    let savedDoctorCrm = matchedDoctor ? (matchedDoctor.numero || matchedDoctor.crm) : String(doctorCrm || '').trim();
    let savedDoctorUf = matchedDoctor ? (matchedDoctor.uf || 'PR') : String(doctorUf || 'PR').trim();
    let savedDoctorCrmType = matchedDoctor ? (matchedDoctor.conselho || 'CRM') : String(doctorCrmType || 'CRM').trim();

    if (!matchedDoctor && savedDoctorName) {
      const newMed = {
        id: 'MED-' + Date.now().toString().slice(-6),
        codigo: String(medicosList.length + 1),
        nome: savedDoctorName,
        conselho: savedDoctorCrmType,
        numero: savedDoctorCrm || String(Math.floor(100000 + Math.random() * 900000)),
        uf: savedDoctorUf,
        especialidade: 'Clínica Geral',
        telefone: '',
        email: '',
        status: 'Ativo',
        createdAt: new Date().toISOString()
      };
      medicosList.push(newMed);
      saveMedicos(medicosList);
      savedDoctorCrm = newMed.numero;
      savedDoctorUf = newMed.uf;
      savedDoctorCrmType = newMed.conselho;
    }

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

    parsedExams = (Array.isArray(parsedExams) ? parsedExams : [])
      .filter(ex => ex && (ex.code || ex.examCode || ex.name || ex.examName || ex.id))
      .map(ex => ({
        ...ex,
        status: (ex && ex.status && String(ex.status).trim() !== '') ? String(ex.status).trim() : 'A Coletar'
      }));
    
    if (!parsedExams || parsedExams.length === 0) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('add-ajax')) {
        return res.status(400).json({ success: false, error: "A requisição não pode ser salva sem exames. Por favor, adicione ao menos 1 (um) exame." });
      }
      return res.status(400).send("A requisição não pode ser salva sem exames. Por favor, adicione ao menos 1 (um) exame.");
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
      patientId: matchedPatient ? matchedPatient.id : (patientId || '').trim(),
      patientCode: (savedPatientCode || patientCode || '').trim(),
      patientName: (savedPatientName || patientName || '').trim(),
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
      doctorId: matchedDoctor ? matchedDoctor.id : (doctorId || '').trim(),
      doctorCode: matchedDoctor ? (matchedDoctor.codigo || matchedDoctor.id) : (doctorCode || '').trim(),
      doctorCrm: (savedDoctorCrm || doctorCrm || '').trim(),
      doctorUf: (savedDoctorUf || doctorUf || 'PR').trim(),
      doctorCrmType: (savedDoctorCrmType || doctorCrmType || 'CRM').trim(),
      doctorName: (savedDoctorName || doctorName || '').trim(),
      fatura: (fatura || '').trim(),
      hora: hora || new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
      procedencia: (procedencia || '').trim(),
      obs: (obs || '').trim(),
      empresa: (empresa || '').trim(),
      isUrgent: isUrgent === 'on' || isUrgent === 'true' || isUrgent === true,
      patientUsername: generatedUsername,
      patientPassword: generatedPassword,
      status: (() => {
        const inputSt = (status && status.trim()) ? status.trim() : '';
        if (inputSt && inputSt.toLowerCase().includes('cancel')) return 'Cancelado';
        if (inputSt && inputSt === 'Coletado') return 'Coletado';
        if (Array.isArray(parsedExams) && parsedExams.length > 0) {
          if (parsedExams.every(e => ['Conferido', 'Liberado', 'Pronto', 'Concluído'].includes(String(e.status || '').trim()))) {
            return 'Pronto';
          }
          if (parsedExams.every(e => String(e.status || '').trim() === 'Coletado')) {
            return 'Coletado';
          }
          if (parsedExams.some(e => !e.status || String(e.status).trim() === 'A Coletar')) {
            return 'A Coletar';
          }
        }
        return inputSt || 'A Coletar';
      })(),
      collectedAt: ((status && status.trim()) === 'Coletado') ? new Date().toISOString() : undefined,
      exams: parsedExams,
      subtotal: parseFloat(subtotal) || 0,
      discount: parseFloat(discount) || 0,
      discountPercent: parseFloat(discountPercent) || 0,
      totalAmount: parseFloat(totalAmount) || 0,
      paymentMethod: paymentMethod || 'Particular - Dinheiro',
      paymentCondition: paymentCondition || 'À Vista',
      paidAmount: parseFloat(paidAmount) || 0,
      faturadoAmount: faturadoAmount !== undefined ? parseFloat(faturadoAmount) : (matchedConv && matchedConv.tipoCobranca === 'faturamento' ? (parseFloat(totalAmount) || 0) : 0),
      financialStatus: financialStatus || 'Pendente',
      payments: payments ? (typeof payments === 'string' ? JSON.parse(payments) : payments) : [],
      deliveryDate: deliveryDate || '',
      deliveryDays: deliveryDays ? parseInt(deliveryDays) : 0,
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
        requisitions[idx] = { 
          ...requisitions[idx], 
          ...reqData,
          pdfBase64: null,
          laudoPdfBase64: null,
          pdfDataUri: null,
          pdfGeneratedAt: null
        };
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

router.post('/admin/requisicoes/add', requireAdmin, saveRequisitionHandler);
router.post('/admin/requisicoes/add-ajax', requireAdmin, saveRequisitionHandler);

// Atualizar Status da Requisição
router.post('/admin/requisicoes/status', requireAdmin, (req, res) => {
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

router.post('/admin/requisicoes/update-status', requireAdmin, (req, res) => {
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
router.post('/admin/requisicoes/update-exams-status', requireAdmin, (req, res) => {
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
        const hasPendingExams = requisitions[index].exams.some(ex => {
          const st = String(ex.status || 'A Coletar').trim();
          return st === 'A Coletar' || st.toLowerCase().includes('falta') || st === 'Pendente';
        });

        if (allColetados && (requisitions[index].status === 'A Coletar' || !requisitions[index].status || requisitions[index].status === 'Falta de material')) {
          requisitions[index].status = 'Coletado';
        } else if (hasPendingExams && requisitions[index].status === 'Coletado') {
          requisitions[index].status = 'A Coletar';
        }
      }
      if (requisitions[index].status === 'Coletado' && !requisitions[index].collectedAt) {
        requisitions[index].collectedAt = new Date().toISOString();
      }
      if (coletaObs !== undefined) requisitions[index].coletaObs = coletaObs;

      requisitions[index].pdfBase64 = null;
      requisitions[index].laudoPdfBase64 = null;
      requisitions[index].pdfDataUri = null;
      requisitions[index].pdfGeneratedAt = null;

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
router.post('/admin/requisicoes/mark-notified', requireAdmin, (req, res) => {
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

// Cancelar / Excluir Requisição (Muda status da requisição e de todos os exames para Cancelado)
const handleCancelRequisition = (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('ajax')) {
        return res.status(400).json({ success: false, message: 'ID da requisição não fornecido.' });
      }
      return res.status(400).send("ID não fornecido");
    }

    const requisitions = loadRequisitions();
    const cleanSearchId = String(id).replace(/^#/, '').trim().toLowerCase();
    const targetReq = requisitions.find(r => 
      String(r.id || '').replace(/^#/, '').trim().toLowerCase() === cleanSearchId ||
      String(r.requisitionCode || '').replace(/^#/, '').trim().toLowerCase() === cleanSearchId
    );

    if (targetReq) {
      targetReq.status = 'Cancelado';
      if (Array.isArray(targetReq.exams)) {
        targetReq.exams.forEach(ex => {
          ex.status = 'Cancelado';
        });
      }
      saveRequisitions(requisitions);
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('ajax')) {
        return res.json({ success: true, message: 'Requisição e exames cancelados com sucesso.' });
      }
      return res.redirect('/admin/requisicoes');
    }

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('ajax')) {
      return res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
    }
    res.status(404).send("Requisição não encontrada.");
  } catch (error) {
    console.error('Erro ao cancelar requisição:', error);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.includes('ajax')) {
      return res.status(500).json({ success: false, message: 'Erro interno ao cancelar requisição.' });
    }
    res.status(500).send("Erro ao cancelar requisição");
  }
};

router.post('/admin/requisicoes/cancel', requireAdmin, handleCancelRequisition);
router.post('/admin/requisicoes/cancel-ajax', requireAdmin, handleCancelRequisition);
router.post('/admin/requisicoes/delete', requireAdmin, handleCancelRequisition);
router.post('/admin/requisicoes/delete-ajax', requireAdmin, handleCancelRequisition);

// Atualizar Pagamento / Baixa no Caixa
router.post('/admin/requisicoes/update-payment', requireAdmin, (req, res) => {
  try {
    const { id, payments, paidAmount, paymentMethod, paymentCondition, financialStatus, paymentObs } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID da requisição não fornecido.' });
    }

    const requisitions = loadRequisitions();
    const cleanSearchId = String(id).replace(/^#/, '').trim().toLowerCase();
    const targetReq = requisitions.find(r => 
      String(r.id || '').replace(/^#/, '').trim().toLowerCase() === cleanSearchId ||
      String(r.requisitionCode || '').replace(/^#/, '').trim().toLowerCase() === cleanSearchId
    );

    if (targetReq) {
      if (Array.isArray(payments)) {
        targetReq.payments = payments;
      } else if (typeof payments === 'string') {
        try { targetReq.payments = JSON.parse(payments); } catch(e){}
      }

      if (paidAmount !== undefined) {
        targetReq.paidAmount = String(paidAmount);
      } else if (Array.isArray(targetReq.payments)) {
        const sum = targetReq.payments.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
        targetReq.paidAmount = String(sum);
      }

      if (paymentMethod !== undefined) targetReq.paymentMethod = paymentMethod;
      if (paymentCondition !== undefined) targetReq.paymentCondition = paymentCondition;
      if (financialStatus !== undefined) {
        targetReq.financialStatus = financialStatus;
      } else {
        const total = parseFloat(targetReq.totalAmount || 0);
        const paid = parseFloat(targetReq.paidAmount || 0);
        if (total > 0 && paid >= total - 0.01) {
          targetReq.financialStatus = 'Pago';
        } else if (paid > 0) {
          targetReq.financialStatus = 'Parcial';
        } else {
          targetReq.financialStatus = 'Pendente';
        }
      }
      if (paymentObs !== undefined) targetReq.paymentObs = paymentObs;

      saveRequisitions(requisitions);
      return res.json({
        success: true,
        message: 'Baixa de pagamento registrada com sucesso!',
        requisition: targetReq
      });
    }

    return res.status(404).json({ success: false, message: 'Requisição não encontrada.' });
  } catch (error) {
    console.error('Erro ao atualizar pagamento:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao atualizar pagamento.' });
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
router.get('/admin/recepcao/fechamento-caixa', requireAdmin, (req, res) => {
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
router.get(['/admin/financeiro/fechamento-caixa', '/admin/fechamento-caixa'], requireAdmin, (req, res) => {
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
router.get('/api/recepcao/fechamento-caixa/ultimo-troco', requireAdmin, (req, res) => {
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
router.get('/api/recepcao/fechamento-caixa/detalhe', requireAdmin, (req, res) => {
  const { id } = req.query;
  const closures = loadCashClosures();
  const closure = closures.find(c => c.id === id);
  if (closure) {
    return res.json(formatClosureRecord(closure));
  }
  res.status(404).json(null);
});

// API: Verificar se já existe um Fechamento para uma Recepção e Data
router.get('/api/recepcao/fechamento-caixa/buscar-existente', requireAdmin, (req, res) => {
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
router.get('/api/admin/financeiro/fechamento-caixa/comparativo-mensal', requireAdmin, (req, res) => {
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
router.post('/admin/recepcao/fechamento-caixa/toggle-conferido', requireAdmin, (req, res) => {
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
router.post('/admin/recepcao/fechamento-caixa/save', requireAdmin, (req, res) => {
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
router.post('/api/admin/recepcao/fechamento-caixa/salvar-lote-csv', requireAdmin, (req, res) => {
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
router.post('/admin/recepcao/fechamento-caixa/delete-mes', requireAdmin, (req, res) => {
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
router.post('/admin/recepcao/fechamento-caixa/delete', requireAdmin, (req, res) => {
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
router.post('/admin/exames/parse', requireAdmin, upload.single('file'), async (req, res) => {
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

      const jalisCodeVal = row[jalisCol] !== undefined && row[jalisCol] !== null ? fixMojibake(row[jalisCol]).trim() : '';
      const categoryVal = row[catCol] !== undefined && row[catCol] !== null ? fixMojibake(row[catCol]).trim() : '';
      const nameVal = row[nameCol] !== undefined && row[nameCol] !== null ? fixMojibake(row[nameCol]).trim() : '';
      const codeVal = codeCol !== -1 && row[codeCol] !== undefined && row[codeCol] !== null ? fixMojibake(row[codeCol]).trim() : '';

      if (!nameVal) {
        skippedCount.emptyName++;
        continue;
      }

      const priceNum = parsePriceValue(row[priceCol]);

      if (priceNum >= 0) {
        validExams.push({
          jalisCode: jalisCodeVal,
          code: codeVal,
          name: fixMojibake(nameVal),
          pricePrivate: priceNum,
          category: fixMojibake(categoryVal || "Geral"),
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
router.post('/admin/exames/import', requireAdmin, (req, res) => {
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
      const itemCode = String(item.code || item.jalisCode || item.codigo || '').trim().toLowerCase();
      const itemJalis = String(item.jalisCode !== undefined && item.jalisCode !== null ? item.jalisCode : '').trim();
      const itemName = String(item.name !== undefined && item.name !== null ? item.name : '').trim().toLowerCase();

      // Se tiver ID de vínculo direto do frontend, use-o com prioridade
      if (item.matchExamId) {
        existingIndex = currentExams.findIndex(e => String(e.id) === String(item.matchExamId));
      }
      // Buscar por código principal ou código Jalis (chave da tabela)
      if (existingIndex === -1 && itemCode) {
        existingIndex = currentExams.findIndex(e => 
          String(e.code || '').trim().toLowerCase() === itemCode ||
          String(e.jalisCode || '').trim().toLowerCase() === itemCode
        );
      }
      if (existingIndex === -1 && itemJalis) {
        existingIndex = currentExams.findIndex(e => String(e.jalisCode || '').trim().toLowerCase() === itemJalis.toLowerCase());
      }
      if (existingIndex === -1 && itemName) {
        existingIndex = currentExams.findIndex(e => String(e.name || '').trim().toLowerCase() === itemName);
      }

      const examData = {
        name: fixMojibake(item.name || 'Sem nome').trim(),
        category: fixMojibake(item.category || 'Geral').trim(),
        fasting: fixMojibake(item.fasting || 'Não obrigatório').trim(),
        timeframe: fixMojibake(item.timeframe || '24 horas').trim(),
        instructions: fixMojibake(item.instructions || 'Sem instruções de preparo cadastradas. Consulte o laboratório.').trim(),
        code: String(item.code || itemJalis || '').trim(),
        jalisCode: itemJalis,
        codigoAlvaro: String(item.codigoAlvaro || '').trim(),
        codigoPardini: String(item.codigoPardini || '').trim(),
        priceAlvaro: item.priceAlvaro ? parseFloat(item.priceAlvaro) : 0,
        pricePardini: item.pricePardini ? parseFloat(item.pricePardini) : 0,
        supportLab: fixMojibake(item.supportLab || 'Próprio').trim(),
        pricePrivate: item.pricePrivate !== undefined ? parseFloat(item.pricePrivate) : 0
      };

      if (existingIndex !== -1) {
        // Atualiza a descrição/nome e dados do exame existente com o mesmo código sem duplicar
        const existingExam = currentExams[existingIndex];
        currentExams[existingIndex] = {
          ...existingExam,
          name: fixMojibake(item.name || existingExam.name || 'Sem nome').trim(),
          category: fixMojibake(item.category || existingExam.category || 'Geral').trim(),
          code: String(existingExam.code || item.code || itemJalis || '').trim(),
          jalisCode: existingExam.jalisCode || itemJalis || '',
          codigoAlvaro: String(item.codigoAlvaro || existingExam.codigoAlvaro || '').trim(),
          codigoPardini: String(item.codigoPardini || existingExam.codigoPardini || '').trim(),
          pricePrivate: item.pricePrivate !== undefined ? parseFloat(item.pricePrivate) : existingExam.pricePrivate,
          fasting: fixMojibake(item.fasting || existingExam.fasting || 'Não obrigatório').trim(),
          timeframe: fixMojibake(item.timeframe || existingExam.timeframe || '24 horas').trim(),
          instructions: fixMojibake(item.instructions || existingExam.instructions || '').trim(),
          supportLab: fixMojibake(item.supportLab || existingExam.supportLab || 'Próprio').trim()
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
router.post('/admin/exames/update-apoio-price', requireAdmin, (req, res) => {
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
router.post('/admin/exames/update-depara-code', requireAdmin, (req, res) => {
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
router.post('/admin/exames/clear', requireAdmin, (req, res) => {
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
router.post('/admin/exames/import-depara', requireAdmin, (req, res) => {
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
router.post('/admin/comparador/import-precos', requireAdmin, (req, res) => {
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
router.post('/admin/comparador/clear-precos', requireAdmin, (req, res) => {
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
router.post('/admin/comparador/save-preco', requireAdmin, (req, res) => {
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
router.post('/admin/comparador/delete-preco', requireAdmin, (req, res) => {
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
  const targetExam = exams.find(e => {
    const eId = String(e.id !== undefined && e.id !== null ? e.id : '').trim();
    const eCode = String(e.code || '').trim();
    const eJalis = String(e.jalisCode || '').trim();
    return eId === targetId || eCode === targetId || eJalis === targetId;
  });

  if (targetExam) {
    const requisitions = loadRequisitions() || [];
    const targetIdentifiers = [
      String(targetExam.id || '').trim().toLowerCase(),
      String(targetExam.code || '').trim().toLowerCase(),
      String(targetExam.jalisCode || '').trim().toLowerCase(),
      String(targetExam.name || '').trim().toLowerCase()
    ].filter(Boolean);

    const hasRequisition = requisitions.some(r => {
      if (!Array.isArray(r.exams)) return false;
      return r.exams.some(ex => {
        const exCode = String(ex.code || ex.codigo || ex.id || ex.examId || '').trim().toLowerCase();
        const exName = String(ex.name || ex.nome || '').trim().toLowerCase();
        return (exCode && targetIdentifiers.includes(exCode)) || (exName && targetIdentifiers.includes(exName));
      });
    });

    if (hasRequisition) {
      const message = 'Não é possível excluir este exame pois existem requisições vinculadas a ele.';
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(400).json({ success: false, message });
      }
      return res.redirect('/admin/exames?error=' + encodeURIComponent(message));
    }
  }

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

router.all('/admin/exames/delete/:id', requireAdmin, handleExamDelete);
router.all('/admin/exames/delete', requireAdmin, handleExamDelete);

// --- SUB-MÓDULO: LEITOR DE GUIAS COM INTELIGÊNCIA ARTIFICIAL (IA) ---

// Página do Leitor de Guia (GET)
router.get('/admin/leitor', requireAdmin, (req, res) => {
  const exams = loadExams();
  res.render('admin/leitor', {
    page: 'admin-leitor',
    apiKeyConfigured: !!process.env.GEMINI_API_KEY,
    exams: exams
  });
});

// API de Análise da Guia com Gemini (POST)
router.post('/api/admin/leitor/analisar', requireAdmin, async (req, res) => {
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
router.get('/admin/blog', requireAdmin, (req, res) => {
  const posts = loadBlogPosts();
  res.render('admin/blog', {
    posts,
    page: 'admin-blog'
  });
});

// Cadastrar Nova Matéria (POST)
router.post('/admin/blog/add', requireAdmin, (req, res) => {
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
router.post('/admin/blog/edit', requireAdmin, (req, res) => {
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
router.get('/admin/blog/delete/:id', requireAdmin, (req, res) => {
  let posts = loadBlogPosts();
  posts = posts.filter(p => p.id !== req.params.id);
  saveBlogPosts(posts);
  res.redirect('/admin/blog');
});

// --- SUB-MÓDULO: GERENCIAMENTO DE POPS / WIKI DO LABORATÓRIO (CRUD) ---

// Página de Listagem de POPs / Wiki
router.get('/admin/pops', requireAdmin, (req, res) => {
  const pops = loadPops();
  res.render('admin/pops', {
    pops,
    page: 'admin-pops'
  });
});

// Cadastrar Novo POP (POST)
router.post('/admin/pops/add', requireAdmin, (req, res) => {
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
router.post('/admin/pops/edit', requireAdmin, (req, res) => {
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
router.get('/admin/pops/delete/:id', requireAdmin, (req, res) => {
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
router.post('/admin/pops/status', requireAdmin, (req, res) => {
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
router.get('/admin/documentos', requireAdmin, (req, res) => {
  const documents = loadDocuments();
  res.render('admin/documentos', {
    documents,
    page: 'admin-documentos'
  });
});

// Cadastrar Novo Documento (POST)
router.post('/admin/documentos/add', requireAdmin, (req, res) => {
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
router.post('/admin/documentos/edit', requireAdmin, (req, res) => {
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
router.get('/admin/documentos/delete/:id', requireAdmin, (req, res) => {
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
router.post('/admin/documentos/move', requireAdmin, (req, res) => {
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
router.get('/admin/laboratorios', requireAdmin, (req, res) => {
  const labs = loadSupportLabs();
  res.render('admin/laboratorios', {
    labs,
    page: 'admin-laboratorios'
  });
});

// Cadastrar / Editar Laboratório de Apoio (POST)
router.post(['/admin/laboratorios/save', '/admin/laboratorios/add'], requireAdmin, (req, res) => {
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
router.all('/admin/laboratorios/delete/:id', requireAdmin, (req, res) => {
  let labs = loadSupportLabs();
  labs = labs.filter(l => String(l.id) !== String(req.params.id) && String(l.codigo) !== String(req.params.id));
  saveSupportLabs(labs);
  
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.json({ success: true, labs });
  }
  res.redirect('/admin/laboratorios');
});

// --- SUB-MÓDULO: GERENCIAMENTO DE CONVÊNIOS (CRUD) ---
router.get('/admin/convenios', requireAdmin, (req, res) => {
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

router.post('/admin/convenios/save', requireAdmin, (req, res) => {
  try {
    let convenios = loadConvenios();
    let priceTables = loadPriceTables();

    const {
      id, codigo, pessoa, razaoSocial, fantasia, cnpj, inscEstadual, cei,
      inscMunicipal, cidade, tipoEndereco, endereco, numero, complemento,
      ans, bairro, cep, fone, fax, contato, email1, email2, site,
      observacao, proibido, bloquearWeb, ativo, senhaWeb, tabelaPrecoId,
      tipoCobranca, diaVencimento, prazoEnvio
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
      tipoCobranca: (tipoCobranca || 'faturamento').trim(),
      diaVencimento: (diaVencimento || '').trim(),
      prazoEnvio: (prazoEnvio || '').trim(),
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

router.post('/admin/convenios/delete/:id', requireAdmin, (req, res) => {
  let convenios = loadConvenios();
  convenios = convenios.filter(c => String(c.id) !== String(req.params.id));
  saveConvenios(convenios);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/convenios');
});

router.get('/admin/convenios/delete/:id', requireAdmin, (req, res) => {
  let convenios = loadConvenios();
  convenios = convenios.filter(c => String(c.id) !== String(req.params.id));
  saveConvenios(convenios);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/convenios');
});

router.get('/admin/convenios/toggle-status/:id', requireAdmin, (req, res) => {
  let convenios = loadConvenios();
  const index = convenios.findIndex(c => String(c.id) === String(req.params.id));
  if (index >= 0) {
    convenios[index].ativo = convenios[index].ativo === false ? true : false;
    saveConvenios(convenios);
  }
  res.redirect('/admin/convenios');
});

router.get('/api/convenios', (req, res) => {
  res.json(loadConvenios());
});

router.get('/api/laboratorios', (req, res) => {
  res.json(loadSupportLabs());
});

router.get('/api/support-labs', (req, res) => {
  res.json(loadSupportLabs());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE RECIPIENTES (CRUD) ---
router.get('/admin/recipientes', requireAdmin, (req, res) => {
  const recipientes = loadRecipientes();
  res.render('admin/recipientes', {
    recipientes,
    page: 'admin-recipientes'
  });
});

router.post('/admin/recipientes/save', requireAdmin, (req, res) => {
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

router.post('/admin/recipientes/delete/:id', requireAdmin, (req, res) => {
  let recipientes = loadRecipientes();
  recipientes = recipientes.filter(r => String(r.id) !== String(req.params.id));
  saveRecipientes(recipientes);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/recipientes');
});

router.get('/admin/recipientes/delete/:id', requireAdmin, (req, res) => {
  let recipientes = loadRecipientes();
  recipientes = recipientes.filter(r => String(r.id) !== String(req.params.id));
  saveRecipientes(recipientes);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/recipientes');
});

router.get('/api/recipientes', (req, res) => {
  res.json(loadRecipientes());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE MATERIAIS COLETADOS (CRUD) ---
router.get('/admin/materiais-coletados', requireAdmin, (req, res) => {
  const materiais = loadMateriaisColetados();
  res.render('admin/materiais-coletados', {
    materiais,
    page: 'admin-materiais-coletados'
  });
});

router.post('/admin/materiais-coletados/save', requireAdmin, (req, res) => {
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

router.post('/admin/materiais-coletados/delete/:id', requireAdmin, (req, res) => {
  let materiais = loadMateriaisColetados();
  materiais = materiais.filter(m => String(m.id) !== String(req.params.id));
  saveMateriaisColetados(materiais);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/materiais-coletados');
});

router.get('/admin/materiais-coletados/delete/:id', requireAdmin, (req, res) => {
  let materiais = loadMateriaisColetados();
  materiais = materiais.filter(m => String(m.id) !== String(req.params.id));
  saveMateriaisColetados(materiais);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/materiais-coletados');
});

router.get('/api/materiais-coletados', (req, res) => {
  res.json(loadMateriaisColetados());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE LOCAIS DE COLETA (CRUD) ---
router.get('/admin/locais-coleta', requireAdmin, (req, res) => {
  const locaisColeta = loadLocaisColeta();
  res.render('admin/locais-coleta', {
    locaisColeta,
    page: 'admin-locais-coleta'
  });
});

router.post('/admin/locais-coleta/save', requireAdmin, (req, res) => {
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

router.post('/admin/locais-coleta/delete/:id', requireAdmin, (req, res) => {
  let locais = loadLocaisColeta();
  locais = locais.filter(l => String(l.id) !== String(req.params.id));
  saveLocaisColeta(locais);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/locais-coleta');
});

router.get('/admin/locais-coleta/delete/:id', requireAdmin, (req, res) => {
  let locais = loadLocaisColeta();
  locais = locais.filter(l => String(l.id) !== String(req.params.id));
  saveLocaisColeta(locais);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/locais-coleta');
});

router.get('/api/locais-coleta', (req, res) => {
  res.json(loadLocaisColeta());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE SETORES (CRUD) ---
router.get('/admin/setores', requireAdmin, (req, res) => {
  const setores = loadSetores();
  res.render('admin/setores', {
    setores,
    page: 'admin-setores'
  });
});

router.post('/admin/setores/save', requireAdmin, (req, res) => {
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

// Helper de parsing CSV para Setores
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

// Importar Setores via CSV (POST)
router.post('/admin/setores/import-csv', requireAdmin, upload.single('csvFile'), (req, res) => {
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
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'Nenhum dado CSV fornecido.' });
      }
      return res.redirect('/admin/setores?error=empty_csv');
    }

    const rows = parseCsvRows(rawCsvText);
    if (rows.length === 0) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, message: 'Arquivo CSV sem linhas válidas.' });
      }
      return res.redirect('/admin/setores?error=empty_csv');
    }

    let startIdx = 0;
    const headerRow = rows[0].map(h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

    let codeIdx = -1;
    let descIdx = -1;
    let siglaIdx = -1;

    headerRow.forEach((col, i) => {
      if (col.includes('cod') || col.includes('codigo') || col.includes('id')) {
        if (codeIdx === -1) codeIdx = i;
      } else if (col.includes('desc') || col.includes('nome') || col.includes('setor') || col.includes('departamento')) {
        if (descIdx === -1) descIdx = i;
      } else if (col.includes('sigla') || col.includes('abrev')) {
        if (siglaIdx === -1) siglaIdx = i;
      }
    });

    const hasHeaderKeywords = headerRow.some(h => 
      h.includes('codigo') || h.includes('cod') || h.includes('descricao') || h.includes('nome') || h.includes('setor') || h.includes('sigla')
    );

    if (hasHeaderKeywords) {
      startIdx = 1;
    }

    if (codeIdx === -1) codeIdx = 0;
    if (descIdx === -1) descIdx = (rows[0].length > 1) ? 1 : 0;
    if (siglaIdx === -1) siglaIdx = (rows[0].length > 2) ? 2 : -1;

    let setores = loadSetores();
    let maxCod = 0;
    setores.forEach(s => {
      const num = parseInt(s.codigo, 10);
      if (!isNaN(num) && num > maxCod) maxCod = num;
    });

    let importedCount = 0;
    let updatedCount = 0;

    for (let i = startIdx; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;

      let codigoVal = (codeIdx >= 0 && r[codeIdx]) ? r[codeIdx].trim() : '';
      let descVal = (descIdx >= 0 && r[descIdx]) ? r[descIdx].trim() : '';
      let siglaVal = (siglaIdx >= 0 && r[siglaIdx]) ? r[siglaIdx].trim().toUpperCase() : '';

      if (!descVal && codigoVal && isNaN(parseInt(codigoVal, 10))) {
        descVal = codigoVal;
        codigoVal = '';
      }

      if (!descVal) continue;

      let existing = setores.find(s => 
        (codigoVal && String(s.codigo) === String(codigoVal)) ||
        (s.descricao && s.descricao.toLowerCase() === descVal.toLowerCase())
      );

      if (existing) {
        if (codigoVal) existing.codigo = codigoVal;
        existing.descricao = descVal;
        if (siglaVal) existing.sigla = siglaVal;
        updatedCount++;
      } else {
        maxCod++;
        const newSetor = {
          id: 'SET-' + Date.now() + '-' + i,
          codigo: codigoVal || String(maxCod),
          descricao: descVal,
          sigla: siglaVal
        };
        setores.push(newSetor);
        importedCount++;
      }
    }

    saveSetores(setores);

    const message = `Importação concluída com sucesso! ${importedCount} novos setores cadastrados, ${updatedCount} atualizados.`;

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, message, importedCount, updatedCount, setores });
    }
    return res.redirect('/admin/setores?success=imported');
  } catch (err) {
    console.error("Erro na importação CSV de setores:", err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, message: 'Erro ao processar arquivo CSV: ' + err.message });
    }
    return res.redirect('/admin/setores?error=import_failed');
  }
});

router.post('/admin/setores/delete/:id', requireAdmin, (req, res) => {
  let setores = loadSetores();
  setores = setores.filter(s => String(s.id) !== String(req.params.id));
  saveSetores(setores);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/setores');
});

router.get('/admin/setores/delete/:id', requireAdmin, (req, res) => {
  let setores = loadSetores();
  setores = setores.filter(s => String(s.id) !== String(req.params.id));
  saveSetores(setores);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/setores');
});

// --- SUB-MÓDULO: GERENCIAMENTO DE IMPRESSORAS (CONF. IMPRESSORAS CRUD) ---
router.get('/admin/impressoras', requireAdmin, (req, res) => {
  const impressoras = loadImpressoras();
  res.render('admin/impressoras', {
    impressoras,
    page: 'admin-impressoras'
  });
});

router.post('/admin/impressoras/save', requireAdmin, (req, res) => {
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

router.post('/admin/impressoras/delete/:id', requireAdmin, (req, res) => {
  let impressoras = loadImpressoras();
  impressoras = impressoras.filter(imp => String(imp.id) !== String(req.params.id));
  saveImpressoras(impressoras);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/impressoras');
});

router.get('/admin/impressoras/delete/:id', requireAdmin, (req, res) => {
  let impressoras = loadImpressoras();
  impressoras = impressoras.filter(imp => String(imp.id) !== String(req.params.id));
  saveImpressoras(impressoras);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/impressoras');
});

router.get('/api/impressoras', (req, res) => {
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

router.post('/api/impressoras/imprimir', async (req, res) => {
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
router.get('/admin/medicos', requireAdmin, (req, res) => {
  const medicos = loadMedicos();
  res.render('admin/medicos', {
    medicos,
    page: 'admin-medicos'
  });
});

router.post(['/admin/medicos/save', '/admin/medicos/add'], requireAdmin, (req, res) => {
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

router.post('/admin/medicos/delete/:id', requireAdmin, (req, res) => {
  let medicos = loadMedicos();
  medicos = medicos.filter(m => String(m.id) !== String(req.params.id) && String(m.codigo) !== String(req.params.id));
  saveMedicos(medicos);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true, medicos });
  }
  res.redirect('/admin/medicos');
});

router.get('/admin/medicos/delete/:id', requireAdmin, (req, res) => {
  let medicos = loadMedicos();
  medicos = medicos.filter(m => String(m.id) !== String(req.params.id) && String(m.codigo) !== String(req.params.id));
  saveMedicos(medicos);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true, medicos });
  }
  res.redirect('/admin/medicos');
});

router.get('/api/medicos', (req, res) => {
  res.json(loadMedicos());
});

router.get('/api/setores', (req, res) => {
  res.json(loadSetores());
});

// --- SUB-MÓDULO: GERENCIAMENTO DE TABELAS DE PREÇO (CRUD) ---
router.get('/admin/tabela-precos', requireAdmin, (req, res) => {
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

router.post('/admin/tabela-precos/save', requireAdmin, (req, res) => {
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

router.post('/admin/tabela-precos/save-prices/:id', requireAdmin, (req, res) => {
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

router.post('/admin/tabela-precos/delete/:id', requireAdmin, (req, res) => {
  let tables = loadPriceTables();
  tables = tables.filter(t => String(t.id) !== String(req.params.id));
  savePriceTables(tables);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }
  res.redirect('/admin/tabela-precos');
});

router.get('/admin/tabela-precos/delete/:id', requireAdmin, (req, res) => {
  let tables = loadPriceTables();
  tables = tables.filter(t => String(t.id) !== String(req.params.id));
  savePriceTables(tables);
  res.redirect('/admin/tabela-precos');
});

router.get('/api/tabela-precos', (req, res) => {
  res.json(loadPriceTables());
});

// MÓDULO: COMPARADOR DE CUSTOS DE LABORATÓRIOS DE APOIO
router.get('/admin/comparador', requireAdmin, (req, res) => {
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
router.get('/admin/profissionais', requireAdmin, (req, res) => {
  const professionals = loadProfessionals();
  const profiles = loadAccessProfiles();
  res.render('admin/profissionais', {
    professionals,
    profiles,
    page: 'admin-profissionais'
  });
});

// Cadastrar Novo Profissional (POST)
router.post('/admin/profissionais/add', requireAdmin, (req, res) => {
  const { 
    name, role, title, description, username, password, profileId, showOnAbout,
    socialName, cpf, rg, birthDate, gender, maritalStatus, nationality,
    address, city, state, zipCode, phone, mobile, email, photo,
    registration, sector, admissionDate, contractType, workday, supervisor, status, terminationReason,
    education, postGrad, specializations, masterDegree, doctorateDegree,
    regType, regNumber, regState, regValidity, regDocFile,
    laudoTitle, laudoCouncil, signatureFile,
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
    code: (registration || Date.now().toString()).trim(),
    name: name.trim(),
    role: (role || '').trim(),
    title: (title || '').trim(),
    description: (description || '').trim(),
    username: (username || '').trim(),
    password: (password || '').trim(),
    profileId: profileId || '',
    showOnAbout: showOnAbout === 'true' || showOnAbout === 'on' || showOnAbout === true || showOnAbout === '1' || showOnAbout === 1,
    
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
    sectorCode: (sector || '').trim(),
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

    // Assinatura e Laudo
    laudoTitle: (laudoTitle || '').trim(),
    laudoCouncil: (laudoCouncil || '').trim(),
    signatureFile: signatureFile || '',

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
router.post('/admin/profissionais/edit', requireAdmin, (req, res) => {
  const { 
    id, name, role, title, description, username, password, profileId, showOnAbout,
    socialName, cpf, rg, birthDate, gender, maritalStatus, nationality,
    address, city, state, zipCode, phone, mobile, email, photo,
    registration, sector, admissionDate, contractType, workday, supervisor, status, terminationReason,
    education, postGrad, specializations, masterDegree, doctorateDegree,
    regType, regNumber, regState, regValidity, regDocFile,
    laudoTitle, laudoCouncil, signatureFile,
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
      code: (registration || professionals[index].code || Date.now().toString()).trim(),
      name: name.trim(),
      role: (role || '').trim(),
      title: (title || '').trim(),
      description: (description || '').trim(),
      username: (username || '').trim(),
      password: (password || '').trim(),
      profileId: profileId || '',
      showOnAbout: showOnAbout === 'true' || showOnAbout === 'on' || showOnAbout === true || showOnAbout === '1' || showOnAbout === 1,
      
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
      sectorCode: (sector || '').trim(),
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

      // Assinatura e Laudo
      laudoTitle: (laudoTitle || '').trim(),
      laudoCouncil: (laudoCouncil || '').trim(),
      signatureFile: signatureFile || '',

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
router.get('/admin/profissionais/delete/:id', requireAdmin, (req, res) => {
  let professionals = loadProfessionals();
  professionals = professionals.filter(p => p.id !== req.params.id);
  saveProfessionals(professionals);
  res.redirect('/admin/profissionais');
});


export default router;
