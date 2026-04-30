/* =====================================================================
   GOOD - Checkout Alerta FRAGIL SKUs — Painel Online v3
   - Painel admin com USUÁRIO + SENHA (múltiplos usuários, senhas em hash bcrypt)
   - OAuth Bling com renovação automática
   - Cache de produtos (SKU + EAN + nome + imagem)
   - Endpoint /api/buscar pra autocomplete na UI
   ===================================================================== */

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ----- ARQUIVO DE DADOS -----
const DATA_DIR = fs.existsSync("/data") ? "/data" : path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, "skus.json");
const USUARIOS_FILE = path.join(DATA_DIR, "usuarios.json");

// ----- ENV VARS -----
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const BLING_CLIENT_ID = process.env.BLING_CLIENT_ID || "";
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET || "";
const RENDER_API_KEY = process.env.RENDER_API_KEY || "";
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || "";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===================================================================
// PARTE 1 — DADOS DE SKUs FRÁGEIS
// ===================================================================

function dadosPadrao() {
  return {
    config: {
      tempoMinimoSegundos: 2,
      mensagemPadrao: "Atenção. Produto frágil. Embalar com plástico bolha e reforçar a caixa.",
      repetirVoz: false
    },
    skus: {},
    atualizadoEm: null,
    atualizadoPor: null
  };
}

function lerDados() {
  try {
    if (!fs.existsSync(DATA_FILE)) return dadosPadrao();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const obj = JSON.parse(raw);
    const padrao = dadosPadrao();
    return {
      config: { ...padrao.config, ...(obj.config || {}) },
      skus: obj.skus || {},
      atualizadoEm: obj.atualizadoEm || null,
      atualizadoPor: obj.atualizadoPor || null
    };
  } catch (e) {
    console.error("[ERRO] Lendo arquivo skus:", e.message);
    return dadosPadrao();
  }
}

function salvarDados(dados, usuario) {
  dados.atualizadoEm = new Date().toISOString();
  dados.atualizadoPor = usuario || null;
  fs.writeFileSync(DATA_FILE, JSON.stringify(dados, null, 2), "utf8");
  return dados;
}

// ===================================================================
// PARTE 2 — USUÁRIOS (hash + sessões)
// ===================================================================

// Hash de senha com PBKDF2 (parte do Node nativo, sem dependência externa)
// Formato: salt:hash (hex)
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(senha, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verificarSenha(senha, hashArmazenado) {
  try {
    if (!hashArmazenado || !hashArmazenado.includes(":")) return false;
    const [salt, hash] = hashArmazenado.split(":");
    const calc = crypto.pbkdf2Sync(senha, salt, 100000, 64, "sha512").toString("hex");
    // Comparação resistente a timing attacks
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(calc, "hex"));
  } catch (_) { return false; }
}

function lerUsuarios() {
  try {
    if (!fs.existsSync(USUARIOS_FILE)) return [];
    const raw = fs.readFileSync(USUARIOS_FILE, "utf8");
    return JSON.parse(raw) || [];
  } catch (e) {
    console.error("[ERRO] Lendo usuarios:", e.message);
    return [];
  }
}

function salvarUsuarios(lista) {
  fs.writeFileSync(USUARIOS_FILE, JSON.stringify(lista, null, 2), "utf8");
}

// ----- SESSÕES (em memória) -----
const sessoes = new Map(); // token -> { usuario, criadoEm, expiraEm }
const SESSAO_HORAS = 8;

function criarSessao(usuario) {
  const token = crypto.randomBytes(32).toString("hex");
  const agora = Date.now();
  sessoes.set(token, {
    usuario,
    criadoEm: agora,
    expiraEm: agora + SESSAO_HORAS * 60 * 60 * 1000
  });
  return token;
}

function validarSessao(token) {
  if (!token) return null;
  const s = sessoes.get(token);
  if (!s) return null;
  if (s.expiraEm < Date.now()) {
    sessoes.delete(token);
    return null;
  }
  return s.usuario;
}

// Limpa sessões expiradas a cada 1h
setInterval(() => {
  const agora = Date.now();
  for (const [token, s] of sessoes) {
    if (s.expiraEm < agora) sessoes.delete(token);
  }
}, 60 * 60 * 1000);

// ----- AUTENTICAÇÃO -----
function autenticar(usuario, senha) {
  const lista = lerUsuarios();
  // Modo "chave-mestra": se não tem usuários cadastrados,
  // permite login com user "admin" + ADMIN_PASSWORD do env
  if (lista.length === 0) {
    if (usuario === "admin" && ADMIN_PASSWORD && senha === ADMIN_PASSWORD) {
      return { ok: true, usuario: "admin", perfil: "admin", nome: "Admin (chave-mestra)", chaveMestra: true };
    }
    return { ok: false, erro: "Nenhum usuário cadastrado. Use o login admin com a senha mestra." };
  }
  const u = lista.find(x => (x.usuario || "").toLowerCase() === (usuario || "").toLowerCase());
  if (!u) return { ok: false, erro: "Usuário ou senha incorretos." };
  if (!verificarSenha(senha, u.senhaHash)) return { ok: false, erro: "Usuário ou senha incorretos." };
  return { ok: true, usuario: u.usuario, perfil: u.perfil || "admin", nome: u.nome || u.usuario };
}

// Middleware: exige sessão válida
function exigirAuth(req, res, next) {
  const token = req.headers["x-session-token"] || "";
  const usuario = validarSessao(token);
  if (!usuario) return res.status(401).json({ erro: "Sessão expirada ou inválida. Faça login novamente." });
  req.usuario = usuario;
  next();
}

// ===================================================================
// PARTE 3 — BLING OAUTH + CACHE DE PRODUTOS
// ===================================================================

const cacheDetalhes = new Map();
const indiceSku = new Map();
const indiceEan = new Map();
let listagemCarregada = false;
let eansCarregados = false;

function normalize(v) { return String(v || "").trim().toLowerCase(); }
function onlyDigits(v) { return String(v || "").replace(/\D/g, ""); }

function extractImage(produto) {
  const vistos = new Set();
  function proc(obj) {
    if (!obj) return "";
    if (typeof obj === "string") {
      const v = obj.trim();
      if (/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(v)) return v;
      if (/^https?:\/\/lh3\.googleusercontent\.com\//i.test(v)) return v;
      return "";
    }
    if (typeof obj !== "object" || vistos.has(obj)) return "";
    vistos.add(obj);
    if (Array.isArray(obj)) {
      for (const i of obj) { const a = proc(i); if (a) return a; }
      return "";
    }
    for (const k of Object.keys(obj)) { const a = proc(obj[k]); if (a) return a; }
    return "";
  }
  return proc(produto) || "";
}

function getSkus(p) { return [p?.codigo, p?.sku, p?.codigoProduto].filter(Boolean); }
function getEans(p) {
  return [
    p?.gtin, p?.ean, p?.codigoBarras, p?.gtinEan, p?.gtinTributario,
    p?.codigo_barras, p?.codigoDeBarras, p?.codBarras,
    p?.tributavel?.gtin, p?.tributavel?.ean,
    p?.tributacao?.gtin, p?.tributacao?.ean
  ].filter(Boolean);
}

function formatarProduto(p) {
  return {
    id: p.id,
    nome: p.nome || "",
    codigo: p.codigo || p.sku || "",
    imagem: extractImage(p),
    ean: getEans(p).find(Boolean) || ""
  };
}

async function atualizarVariavelRender(chave, valor) {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) {
    console.warn("[RENDER] RENDER_API_KEY/SERVICE_ID não configurados, token não persistido");
    return false;
  }
  try {
    const getResp = await fetch(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
      { headers: { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: "application/json" } }
    );
    if (!getResp.ok) return false;
    const envVars = await getResp.json();
    const atualizadas = envVars.map(item => ({
      key: item.envVar?.key || item.key,
      value: (item.envVar?.key || item.key) === chave ? valor : (item.envVar?.value || item.value || "")
    }));
    const putResp = await fetch(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${RENDER_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(atualizadas)
      }
    );
    return putResp.ok;
  } catch (e) { console.warn("[RENDER]", e.message); return false; }
}

async function renovarAccessToken() {
  if (!BLING_CLIENT_ID || !BLING_CLIENT_SECRET) throw new Error("BLING_CLIENT_ID/SECRET ausentes");
  const refreshToken = process.env.BLING_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("BLING_REFRESH_TOKEN ausente — faça login OAuth");
  const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams();
  body.append("grant_type", "refresh_token");
  body.append("refresh_token", String(refreshToken).trim());
  const r = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "1.0" },
    body: body.toString()
  });
  let data = {};
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok || !data?.access_token) {
    throw new Error("Falha ao renovar token: " + (data?.error?.description || r.status));
  }
  process.env.BLING_ACCESS_TOKEN = data.access_token;
  if (data.refresh_token) process.env.BLING_REFRESH_TOKEN = data.refresh_token;
  await atualizarVariavelRender("BLING_ACCESS_TOKEN", data.access_token);
  if (data.refresh_token) await atualizarVariavelRender("BLING_REFRESH_TOKEN", data.refresh_token);
  console.log("[TOKEN] Renovado!");
  return data;
}

async function blingFetch(url, options = {}) {
  const token = process.env.BLING_ACCESS_TOKEN;
  async function doFetch(t) {
    const r = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${t}`, Accept: "application/json", ...(options.headers || {}) }
    });
    let d = {};
    try { d = await r.json(); } catch { d = {}; }
    return { response: r, data: d };
  }
  let result = await doFetch(token);
  if (result.response.status === 401 || /invalid_token/i.test(JSON.stringify(result.data || {}))) {
    const novos = await renovarAccessToken();
    result = await doFetch(novos.access_token);
  }
  return result;
}

async function blingFetchComRetry(url, options = {}) {
  for (let i = 0; i < 4; i++) {
    const result = await blingFetch(url, options);
    if (result.response.status === 429) { await sleep(1500 * (i + 1)); continue; }
    return result;
  }
  return await blingFetch(url, options);
}

async function buscarDetalhe(id) {
  const cached = cacheDetalhes.get(String(id));
  if (cached) return cached;
  const { response, data } = await blingFetchComRetry(`https://api.bling.com.br/Api/v3/produtos/${id}`);
  if (!response.ok || !data?.data) return null;
  const p = data.data;
  cacheDetalhes.set(String(p.id), p);
  getEans(p).forEach(e => {
    const d = onlyDigits(e);
    if (d && d.length >= 8) indiceEan.set(d, String(p.id));
  });
  getSkus(p).forEach(s => { if (s) indiceSku.set(normalize(s), String(p.id)); });
  return p;
}

async function carregarEansBackground() {
  console.log("[EANS] Carregando EANs em background...");
  let total = 0;
  for (const [, id] of indiceSku) {
    if (cacheDetalhes.has(id)) { total++; continue; }
    try {
      await sleep(1000);
      await buscarDetalhe(id);
      total++;
      if (total % 50 === 0) console.log(`[EANS] ${total}/${indiceSku.size} carregados...`);
    } catch (e) { /* ignora */ }
  }
  eansCarregados = true;
  console.log(`[EANS] ✅ Completo! ${indiceEan.size} EANs.`);
}

async function carregarIndiceListagem() {
  if (!process.env.BLING_ACCESS_TOKEN && !process.env.BLING_REFRESH_TOKEN) {
    console.warn("[INDICE] Sem tokens Bling — pulando.");
    return;
  }
  console.log("[INDICE] Carregando produtos...");
  let pagina = 1;
  let total = 0;
  while (true) {
    try {
      const { response, data } = await blingFetchComRetry(
        `https://api.bling.com.br/Api/v3/produtos?pagina=${pagina}&limite=100`
      );
      if (!response.ok) { console.warn(`[INDICE] página ${pagina}:`, response.status); break; }
      const lista = data?.data || [];
      if (!lista.length) break;
      for (const item of lista) {
        if (!item?.id || !item?.codigo) continue;
        const id = String(item.id);
        indiceSku.set(normalize(item.codigo), id);
        if (item.sku) indiceSku.set(normalize(item.sku), id);
        total++;
      }
      if (lista.length < 100) break;
      pagina++;
      await sleep(300);
    } catch (e) { console.error("[INDICE]", e.message); break; }
  }
  listagemCarregada = true;
  console.log(`[INDICE] ✅ ${total} produtos indexados.`);
  carregarEansBackground();
  setInterval(async () => {
    try {
      const { response, data } = await blingFetchComRetry(
        `https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=100`
      );
      if (!response.ok) return;
      const lista = data?.data || [];
      let novos = 0;
      for (const item of lista) {
        if (!item?.id || !item?.codigo) continue;
        const id = String(item.id);
        if (!indiceSku.has(normalize(item.codigo))) novos++;
        indiceSku.set(normalize(item.codigo), id);
        if (item.sku) indiceSku.set(normalize(item.sku), id);
      }
      if (novos > 0) console.log(`[INDICE] Sync: ${novos} novos.`);
    } catch (e) { /* ignora */ }
  }, 5 * 60 * 1000);
}

// ===================================================================
// PARTE 4 — MIDDLEWARE
// ===================================================================

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Session-Token");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, "public")));

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ===================================================================
// PARTE 5 — ROTAS
// ===================================================================

// ----- LOGIN / LOGOUT -----
app.post("/api/login", (req, res) => {
  const { usuario, senha } = req.body || {};
  const r = autenticar(usuario, senha);
  if (!r.ok) return res.status(401).json({ ok: false, erro: r.erro });
  const token = criarSessao(r.usuario);
  console.log(`[LOGIN] ${r.usuario}${r.chaveMestra ? " (CHAVE-MESTRA)" : ""}`);
  res.json({
    ok: true, token,
    usuario: r.usuario, perfil: r.perfil, nome: r.nome,
    chaveMestra: !!r.chaveMestra,
    expiraHoras: SESSAO_HORAS
  });
});

app.post("/api/logout", exigirAuth, (req, res) => {
  const token = req.headers["x-session-token"];
  sessoes.delete(token);
  res.json({ ok: true });
});

app.get("/api/me", exigirAuth, (req, res) => {
  const lista = lerUsuarios();
  const u = lista.find(x => (x.usuario || "").toLowerCase() === req.usuario.toLowerCase());
  res.json({ ok: true, usuario: req.usuario, nome: u?.nome || req.usuario, perfil: u?.perfil || "admin", chaveMestra: lista.length === 0 });
});

// ----- USUÁRIOS (gestão) -----
app.get("/api/usuarios", exigirAuth, (req, res) => {
  const lista = lerUsuarios().map(u => ({ usuario: u.usuario, nome: u.nome, perfil: u.perfil }));
  res.json({ ok: true, usuarios: lista });
});

app.post("/api/usuarios", exigirAuth, (req, res) => {
  const { usuario, senha, nome, perfil } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ erro: "Usuário e senha são obrigatórios." });
  if (senha.length < 6) return res.status(400).json({ erro: "Senha deve ter pelo menos 6 caracteres." });
  const lista = lerUsuarios();
  if (lista.find(u => (u.usuario || "").toLowerCase() === usuario.toLowerCase())) {
    return res.status(400).json({ erro: "Já existe usuário com esse nome." });
  }
  lista.push({
    usuario: usuario.trim(),
    senhaHash: hashSenha(senha),
    nome: (nome || usuario).trim(),
    perfil: perfil === "admin" ? "admin" : "admin",
    criadoEm: new Date().toISOString(),
    criadoPor: req.usuario
  });
  salvarUsuarios(lista);
  console.log(`[USUARIO] ${req.usuario} criou ${usuario}`);
  res.json({ ok: true, total: lista.length });
});

app.delete("/api/usuarios/:usuario", exigirAuth, (req, res) => {
  const alvo = req.params.usuario;
  const lista = lerUsuarios();
  const novaLista = lista.filter(u => (u.usuario || "").toLowerCase() !== alvo.toLowerCase());
  if (novaLista.length === lista.length) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (novaLista.length === 0) return res.status(400).json({ erro: "Não pode remover o último usuário cadastrado." });
  salvarUsuarios(novaLista);
  console.log(`[USUARIO] ${req.usuario} removeu ${alvo}`);
  res.json({ ok: true });
});

app.post("/api/usuarios/:usuario/senha", exigirAuth, (req, res) => {
  const alvo = req.params.usuario;
  const { novaSenha } = req.body || {};
  if (!novaSenha || novaSenha.length < 6) return res.status(400).json({ erro: "Senha deve ter pelo menos 6 caracteres." });
  const lista = lerUsuarios();
  const u = lista.find(x => (x.usuario || "").toLowerCase() === alvo.toLowerCase());
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });
  u.senhaHash = hashSenha(novaSenha);
  salvarUsuarios(lista);
  console.log(`[USUARIO] ${req.usuario} alterou senha de ${alvo}`);
  res.json({ ok: true });
});

// ----- API: SKUs frágeis -----
app.get("/api/skus", (req, res) => {
  res.json(lerDados());
});

app.post("/api/skus", exigirAuth, (req, res) => {
  try {
    const body = req.body || {};
    const atual = lerDados();
    const novo = {
      config: {
        tempoMinimoSegundos: clampInt(body?.config?.tempoMinimoSegundos, 0, 30, atual.config.tempoMinimoSegundos),
        mensagemPadrao: typeof body?.config?.mensagemPadrao === "string"
          ? body.config.mensagemPadrao.slice(0, 500)
          : atual.config.mensagemPadrao,
        repetirVoz: !!(body?.config?.repetirVoz)
      },
      skus: typeof body.skus === "object" && body.skus !== null ? body.skus : atual.skus
    };
    const salvo = salvarDados(novo, req.usuario);
    console.log(`[SAVE] ${req.usuario} salvou ${Object.keys(salvo.skus).length} SKUs`);
    res.json(salvo);
  } catch (e) {
    console.error("[ERRO] POST /api/skus:", e);
    res.status(500).json({ erro: e.message });
  }
});

// ----- API: buscar produtos no Bling -----
app.get("/api/buscar", exigirAuth, (req, res) => {
  try {
    const termo = String(req.query.q || "").trim();
    const cacheStatus = {
      listagemCarregada, eansCarregados,
      skusIndexados: indiceSku.size,
      detalhesEmCache: cacheDetalhes.size
    };
    if (!termo) return res.json({ ok: true, total: 0, resultados: [], cacheStatus });
    const limiteResp = Math.min(parseInt(req.query.limite, 10) || 50, 200);
    const termoNorm = normalize(termo);
    const termoDigits = onlyDigits(termo);
    const idsVistos = new Set();
    const resultados = [];
    function adicionar(item) {
      const id = String(item.id);
      if (idsVistos.has(id)) return;
      idsVistos.add(id);
      resultados.push(item);
    }
    for (const [skuNorm, id] of indiceSku) {
      if (resultados.length >= limiteResp) break;
      if (skuNorm.includes(termoNorm)) {
        const p = cacheDetalhes.get(String(id));
        if (p) adicionar(formatarProduto(p));
        else adicionar({ id, codigo: skuNorm.toUpperCase(), nome: "(carregando...)", imagem: "", ean: "" });
      }
    }
    if (termoDigits.length >= 8 && resultados.length < limiteResp) {
      for (const [ean, id] of indiceEan) {
        if (resultados.length >= limiteResp) break;
        if (ean.includes(termoDigits)) {
          const p = cacheDetalhes.get(String(id));
          if (p) adicionar(formatarProduto(p));
        }
      }
    }
    if (resultados.length < limiteResp) {
      for (const [, p] of cacheDetalhes) {
        if (resultados.length >= limiteResp) break;
        if (normalize(p.nome).includes(termoNorm)) adicionar(formatarProduto(p));
      }
    }
    resultados.sort((a, b) => {
      const aExact = normalize(a.codigo) === termoNorm ? 0 : 1;
      const bExact = normalize(b.codigo) === termoNorm ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return (a.codigo || "").localeCompare(b.codigo || "", "pt-BR", { numeric: true });
    });
    res.json({ ok: true, total: resultados.length, resultados, cacheStatus });
  } catch (e) {
    console.error("[/api/buscar]", e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ----- OAUTH BLING -----
app.get("/auth/bling", (req, res) => {
  if (!BLING_CLIENT_ID) return res.status(500).send("BLING_CLIENT_ID não configurado");
  const url = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(BLING_CLIENT_ID)}&state=${Date.now()}`;
  res.redirect(url);
});

app.get("/bling/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Faltou ?code=");
    if (!BLING_CLIENT_ID || !BLING_CLIENT_SECRET) return res.status(500).send("BLING_CLIENT_ID/SECRET ausentes");
    const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString("base64");
    const body = new URLSearchParams();
    body.append("grant_type", "authorization_code");
    body.append("code", String(code).trim());
    const r = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "1.0" },
      body: body.toString()
    });
    let data = {};
    try { data = await r.json(); } catch { data = {}; }
    if (!r.ok || !data?.access_token) return res.status(500).send("Erro OAuth: " + (data?.error?.description || r.status));
    process.env.BLING_ACCESS_TOKEN = data.access_token;
    process.env.BLING_REFRESH_TOKEN = data.refresh_token;
    await atualizarVariavelRender("BLING_ACCESS_TOKEN", data.access_token);
    await atualizarVariavelRender("BLING_REFRESH_TOKEN", data.refresh_token);
    console.log("[OAUTH] Login concluído.");
    setTimeout(carregarIndiceListagem, 1000);
    res.send(`
      <html><body style="font-family:Arial;padding:40px;text-align:center;">
        <h1 style="color:#28a745;">✅ Login Bling concluído!</h1>
        <p>Tokens capturados e salvos. Carregamento dos produtos iniciado.</p>
        <p><a href="/">Voltar ao painel</a></p>
      </body></html>
    `);
  } catch (e) {
    console.error("[OAUTH]", e);
    res.status(500).send("Erro: " + e.message);
  }
});

// ----- HEALTH + STATUS -----
app.get("/health", (req, res) => {
  const dados = lerDados();
  const usuarios = lerUsuarios();
  res.json({
    ok: true,
    skusFrageis: Object.keys(dados.skus).length,
    atualizadoEm: dados.atualizadoEm,
    atualizadoPor: dados.atualizadoPor,
    usuariosCadastrados: usuarios.length,
    chaveMestraAtiva: usuarios.length === 0 && !!ADMIN_PASSWORD,
    blingConfigurado: !!BLING_CLIENT_ID && !!BLING_CLIENT_SECRET,
    blingLogado: !!process.env.BLING_ACCESS_TOKEN || !!process.env.BLING_REFRESH_TOKEN
  });
});

app.get("/api/cache-status", (req, res) => {
  res.json({
    listagemCarregada, eansCarregados,
    skusIndexados: indiceSku.size,
    eansIndexados: indiceEan.size,
    detalhesEmCache: cacheDetalhes.size
  });
});

// ----- START -----
app.listen(PORT, () => {
  console.log("[SERVER] rodando na porta " + PORT);
  console.log("[DATA]   skus: " + DATA_FILE);
  console.log("[DATA]   usuarios: " + USUARIOS_FILE);
  const usuarios = lerUsuarios();
  console.log(`[AUTH]   usuários cadastrados: ${usuarios.length}`);
  if (usuarios.length === 0) {
    console.log(`[AUTH]   modo CHAVE-MESTRA ativo (login: admin + ADMIN_PASSWORD)`);
  }
  console.log("[BLING]  client: " + (BLING_CLIENT_ID ? "OK" : "FALTANDO"));
  console.log("[BLING]  tokens: " + (process.env.BLING_ACCESS_TOKEN ? "OK" : "FALTANDO (acesse /auth/bling)"));
  if (process.env.BLING_ACCESS_TOKEN || process.env.BLING_REFRESH_TOKEN) {
    setTimeout(carregarIndiceListagem, 3000);
  }
});
