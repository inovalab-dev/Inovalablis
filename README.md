# InovaLab Cambará - Portal Institucional & Gestão Térmica RDC 302

Este repositório contém o sistema completo do **InovaLab Cambará**, um moderno laboratório de análises clínicas localizado em Cambará-PR. O projeto une um website institucional completo, focado na experiência do paciente, com um robusto painel administrativo voltado ao controle de qualidade, calibração e rastreabilidade térmica rigorosa de equipamentos médicos e biológicos, em conformidade com as diretrizes da **RDC 302 da ANVISA**.

---

## 🎨 Principais Recursos

### 1. Portal do Paciente & Website Institucional
*   **Busca Inteligente de Exames:** Consulta rápida de preparações, prazos de entrega e valores estimativos.
*   **Simulador de Orçamentos:** Montagem de carrinho de exames para estimativa instantânea de valores de convênio ou particulares.
*   **Portal de Resultados:** Integração conceitual para download e visualização de laudos e exames anteriores.
*   **Informações de Contato:** Localização física, horário de funcionamento e suporte ao cliente.

### 2. Controle de Temperatura & Conformidade RDC 302 (Painel Administrativo)
*   **Monitoramento em Tempo Real:** Visualização instantânea do status térmico de freezers, geladeiras, estufas e ambientes de conservação biológica (com alertas visuais `🟢 Dentro`, `🟡 Atenção` e `🔴 Crítico`).
*   **Painel Dinâmico de Gráficos:** Análise visual cronológica da estabilidade de temperatura por períodos selecionáveis (Leituras Recentes, Semanal e Mensal) com linhas indicadoras de limites operacionais máximos e mínimos.
*   **Ficha Técnica Digitalizada:** Registro detalhado do histórico técnico do equipamento, incluindo manutenções preventivas/corretivas, documentos técnicos, calibragem de sensores e checklist diário de operação (portas, vedação, limpeza e alarmes).
*   **Comprovação Visual de Medições (Câmera & Webcam):**
    *   **Captura Mobile:** Possibilidade de utilizar a câmera traseira do celular (`capture="environment"`) para tirar foto direta do termômetro no momento da medição.
    *   **Webcam ao Vivo:** Captura de imagem em tempo real direto da webcam do computador.
    *   **Compressão Inteligente:** Redimensionamento e otimização automatizada das fotos (Base64) mantendo os payloads leves para persistência ágil.
*   **Gestão de Desvios (Ocorrências):** Fluxo para abertura de ocorrências automáticas ou manuais em caso de temperaturas fora do limite operacional, com campos dedicados para ação imediata e resoluções auditadas (tempo fora do limite, resultados e assinatura).

### 3. Persistência Híbrida Inteligente (MySQL & JSON)
*   **Ambiente Local / Testes:** Armazenamento seguro de dados locais na pasta `/data/temperaturas.json` para facilitar o desenvolvimento, testes e prototipagem sem necessidade de um servidor de banco de dados ativo.
*   **Ambiente de Produção (MySQL):** Ativação de um banco de dados relacional robusto (`laboratorio-inovalab-db`) quando o ambiente está definido para produção (`NODE_ENV=production`).
    *   **Auto-Semeamento:** Migração e seeding automático dos dados padrões do arquivo JSON para o MySQL na primeira inicialização caso a tabela esteja vazia.
    *   **Integridade Transacional:** Transações ACID seguras para atualização sincronizada de equipamentos, leituras, manutenções e logs de auditoria.

---

## 🛠️ Stack Tecnológica

*   **Servidor Backend:** Node.js, Express.js.
*   **Visualização & Engine de Templates:** EJS (Embedded JavaScript Templates).
*   **Estilização:** Tailwind CSS (Layouts modernos com design focado em usabilidade e acessibilidade).
*   **Biblioteca de Gráficos:** Chart.js (Gráficos interativos lineares e dinâmicos para análises de tendências).
*   **Drivers de Banco de Dados:** `mysql2/promise` (Conexão assíncrona otimizada para MySQL).
*   **Gerenciamento de Mídias:** Manipulação nativa da API de mídia (`getUserMedia`) e File Readers do navegador para upload.

---

## 📋 Variáveis de Ambiente (`.env`)

Crie um arquivo `.env` na raiz do seu projeto baseando-se no arquivo `.env.example`:

```env
PORT=3000
NODE_ENV=development # Altere para 'production' para utilizar o banco de dados MySQL

# Configurações do Banco de Dados MySQL
DB_HOST="localhost"
DB_USER="root"
DB_PASSWORD=""
DB_NAME="laboratorio-inovalab-db"
DB_PORT="3306"
```

---

## 💾 Estrutura da Tabela no MySQL (`equipamentos_temperaturas`)

O sistema cria e gerencia automaticamente a tabela de temperaturas no banco MySQL com a seguinte estrutura estruturada:

| Coluna | Tipo | Descrição |
| :--- | :--- | :--- |
| `id` | `VARCHAR(100)` **(PK)** | ID único do equipamento |
| `name` | `VARCHAR(255)` | Nome amigável do equipamento ou sala |
| `code` | `VARCHAR(100)` | Código interno de patrimônio ou registro técnico |
| `type` | `VARCHAR(100)` | Categoria (Geladeira, Freezer, Ultra Freezer, etc.) |
| `brand` | `VARCHAR(100)` | Marca comercial do fabricante |
| `model` | `VARCHAR(100)` | Modelo do equipamento |
| `serialNumber` | `VARCHAR(100)` | Número de série de fábrica |
| `patrimony` | `VARCHAR(100)` | Identificador patrimonial físico |
| `sector` | `VARCHAR(100)` | Setor laboratorial de instalação |
| `location` | `VARCHAR(255)` | Localização física exata |
| `responsible` | `VARCHAR(255)` | Técnico/Operador responsável designado |
| `sensor` | `VARCHAR(255)` | Código ou identificação do sensor calibrado |
| `minTemp` | `DOUBLE` | Limite térmico mínimo de segurança (°C) |
| `maxTemp` | `DOUBLE` | Limite térmico máximo de segurança (°C) |
| `currentTemp`| `DOUBLE` | Última temperatura medida no equipamento |
| `status` | `VARCHAR(255)` | Status atual de estabilidade |
| `nextReading` | `VARCHAR(50)` | Horário programado para a próxima leitura |
| `lastReadingTime`| `VARCHAR(50)` | Horário do último registro inserido |
| `content` | `TEXT` | Observações fixas gerais |
| `readings` | `LONGTEXT` (JSON) | Histórico completo de medições e fotos anexas |
| `occurrences`| `LONGTEXT` (JSON) | Registro de inconformidades térmicas e resoluções |
| `maintenances`| `LONGTEXT` (JSON) | Histórico de calibrações e manutenções preventivas |
| `checklist` | `LONGTEXT` (JSON) | Estado atual da verificação diária de conformidade |
| `documents` | `LONGTEXT` (JSON) | Manuais de instrução e certificados de calibração |

---

## 🚀 Como Executar o Projeto

### 1. Instalação das Dependências
Instale as dependências essenciais do Node.js:
```bash
npm install
```

### 2. Executar em Ambiente de Desenvolvimento (Modo Local JSON)
Com `NODE_ENV=development` definido no seu `.env`, o sistema executará utilizando dados mockados e interativos salvos de forma estática em `/data/temperaturas.json`:
```bash
npm run dev
```
O servidor estará disponível no endereço: `http://localhost:3000`.

### 3. Executar em Ambiente de Produção (Modo MySQL)
Certifique-se de que o seu servidor MySQL está rodando e o banco `laboratorio-inovalab-db` está criado. Defina `NODE_ENV=production` no seu `.env` e execute:
```bash
npm run start
```
*Na primeira inicialização, o servidor irá detectar se a tabela está vazia e migrará de forma automatizada o histórico padrão do JSON local para a tabela de forma íntegra!*
