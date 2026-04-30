/* =====================================================================
   GOOD - Checkout Alerta FRAGIL SKUs — Painel Online
   Backend simples (Express) que armazena a lista de SKUs frágeis
   e as configurações da extensão num arquivo JSON persistente.
   ===================================================================== */

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Caminho do arquivo de dados — usa /data se existir (Render Disk),
// senão usa pasta local (dev). Mesma estratégia dos seus outros serviços.
const DATA_DIR = fs.existsSync("/data") ? "/data" : path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, "skus.json");

// Senha de admin opcional. Se ADMIN_PASSWORD não estiver definida no Render,
// o painel fica liberado pra qualquer um que tenha o link.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

// ---------------- ESTRUTURA PADRAO ----------------
function dadosPadrao() {
  return {
    config: {
      tempoMinimoSegundos: 2,
      mensagemPadrao: "Atenção. Produto frágil. Embalar com plástico bolha e reforçar a caixa.",
      repetirVoz: false
    },
    skus: {},
    atualizadoEm: null
  };
}

// ---------------- LEITURA / ESCRITA ----------------
function lerDados() {
  try {
    if (!fs.existsSync(DATA_FILE)) return dadosPadrao();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const obj = JSON.parse(raw);
    const padrao = dadosPadrao();
    return {
      config: { ...padrao.config, ...(obj.config || {}) },
      skus: obj.skus || {},
      atualizadoEm: obj.atualizadoEm || null
    };
  } catch (e) {
    console.error("[ERRO] Lendo arquivo:", e.message);
    return dadosPadrao();
  }
}

function salvarDados(dados) {
  dados.atualizadoEm = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(dados, null, 2), "utf8");
  return dados;
}

// ---------------- MIDDLEWARE ----------------
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// ---------------- ROTAS PUBLICAS ----------------
app.get("/api/skus", (req, res) => {
  const dados = lerDados();
  res.json(dados);
});

// ---------------- ROTAS PROTEGIDAS ----------------
function exigirSenha(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const enviada = req.headers["x-admin-password"] || "";
  if (enviada !== ADMIN_PASSWORD) {
    return res.status(401).json({ erro: "Senha invalida ou nao fornecida." });
  }
  next();
}

app.post("/api/skus", exigirSenha, (req, res) => {
  try {
    const body = req.body || {};
    const atual = lerDados();

    const novo = {
      config: {
        tempoMinimoSegundos: clampInt(body && body.config && body.config.tempoMinimoSegundos, 0, 30, atual.config.tempoMinimoSegundos),
        mensagemPadrao: typeof (body && body.config && body.config.mensagemPadrao) === "string"
          ? body.config.mensagemPadrao.slice(0, 500)
          : atual.config.mensagemPadrao,
        repetirVoz: !!(body && body.config && body.config.repetirVoz)
      },
      skus: typeof body.skus === "object" && body.skus !== null ? body.skus : atual.skus
    };

    const salvo = salvarDados(novo);
    console.log("[SAVE] " + Object.keys(salvo.skus).length + " SKUs | tempoMin=" + salvo.config.tempoMinimoSegundos + "s");
    res.json(salvo);
  } catch (e) {
    console.error("[ERRO] POST /api/skus:", e);
    res.status(500).json({ erro: e.message });
  }
});

app.get("/api/check-auth", (req, res) => {
  res.json({ exigeSenha: !!ADMIN_PASSWORD });
});

app.post("/api/check-auth", (req, res) => {
  if (!ADMIN_PASSWORD) return res.json({ ok: true, exigeSenha: false });
  const enviada = req.headers["x-admin-password"] || "";
  res.json({ ok: enviada === ADMIN_PASSWORD, exigeSenha: true });
});

// ---------------- HELPERS ----------------
function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ---------------- HEALTH ----------------
app.get("/health", (req, res) => {
  const dados = lerDados();
  res.json({
    ok: true,
    skus: Object.keys(dados.skus).length,
    atualizadoEm: dados.atualizadoEm,
    senhaConfigurada: !!ADMIN_PASSWORD
  });
});

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log("[SERVER] rodando na porta " + PORT);
  console.log("[DATA]   arquivo: " + DATA_FILE);
  console.log("[AUTH]   senha admin: " + (ADMIN_PASSWORD ? "CONFIGURADA" : "NAO configurada (painel aberto)"));
});
