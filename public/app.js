/* =====================================================================
   GOOD - Alerta Produto Frágil — Painel admin v3.0
   ===================================================================== */

const VERSAO = "v3.0";
const $ = (id) => document.getElementById(id);

// ----- Storage de sessão -----
const SESSION_KEY = "fragil_admin_session";
function getSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function setSession(s) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

// ----- HTTP helpers -----
async function api(path, options = {}) {
  const sess = getSession();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (sess?.token) headers["X-Session-Token"] = sess.token;
  const r = await fetch(path, { ...options, headers });
  if (r.status === 401) {
    clearSession();
    mostrarLogin();
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  let data = {};
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) throw new Error(data.erro || ("HTTP " + r.status));
  return data;
}

// ============================================================
// LOGIN
// ============================================================
async function inicializar() {
  // Verifica se já tem sessão válida
  const sess = getSession();
  if (sess?.token) {
    try {
      const me = await api("/api/me");
      if (me.ok) {
        setSession({ ...sess, ...me });
        mostrarConteudo();
        return;
      }
    } catch (_) {
      clearSession();
    }
  }
  mostrarLogin();
}

async function mostrarLogin() {
  $("conteudo").classList.add("escondido");
  $("login-tela").classList.add("visivel");
  // Avisa se for chave-mestra
  try {
    const r = await fetch("/health");
    const j = await r.json();
    if (j.chaveMestraAtiva) $("login-aviso-mestra").style.display = "block";
  } catch (_) {}
  setTimeout(() => $("login-usuario").focus(), 100);
}

async function fazerLogin() {
  const usuario = $("login-usuario").value.trim();
  const senha = $("login-senha").value;
  $("login-erro").textContent = "";
  if (!usuario || !senha) {
    $("login-erro").textContent = "Preencha usuário e senha.";
    return;
  }
  $("btn-login").disabled = true;
  $("btn-login").textContent = "Entrando...";
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro || "Falha no login");
    setSession(j);
    $("login-tela").classList.remove("visivel");
    $("login-senha").value = "";
    mostrarConteudo();
  } catch (e) {
    $("login-erro").textContent = e.message;
  } finally {
    $("btn-login").disabled = false;
    $("btn-login").textContent = "Entrar";
  }
}

async function logout() {
  try { await api("/api/logout", { method: "POST" }); } catch (_) {}
  clearSession();
  location.reload();
}

// ============================================================
// CONTEÚDO PRINCIPAL
// ============================================================
function mostrarConteudo() {
  const sess = getSession();
  $("user-nome").textContent = sess?.nome || sess?.usuario || "?";
  if (sess?.chaveMestra) {
    $("user-nome").textContent += " (chave-mestra)";
  }
  $("conteudo").classList.remove("escondido");
  carregarStatus();
  carregar();
  carregarUsuarios();
}

// ============================================================
// STATUS DO SISTEMA
// ============================================================
async function carregarStatus() {
  try {
    const r = await fetch("/health");
    const h = await r.json();
    let cache = null;
    try {
      const r2 = await fetch("/api/cache-status");
      cache = await r2.json();
    } catch (_) {}

    const itens = [];
    itens.push(badge(h.blingConfigurado ? "ok" : "erro", "Bling configurado", h.blingConfigurado ? "✅ Sim" : "❌ Não"));
    itens.push(badge(h.blingLogado ? "ok" : "erro", "Bling logado", h.blingLogado ? "✅ Sim" : "❌ Não"));
    if (cache) {
      const skuStatus = cache.skusIndexados > 0 ? "ok" : "aviso";
      itens.push(badge(skuStatus, "SKUs no cache", cache.skusIndexados));
      const detStatus = cache.eansCarregados ? "ok" : "aviso";
      const det = `${cache.detalhesEmCache}/${cache.skusIndexados}` + (cache.eansCarregados ? " ✅" : " ⏳");
      itens.push(badge(detStatus, "Detalhes (nome+EAN+imagem)", det));
    }
    itens.push(badge("ok", "Usuários cadastrados", h.usuariosCadastrados));
    itens.push(badge("ok", "SKUs frágeis", h.skusFrageis));

    $("status-painel").innerHTML = itens.join("");
    $("versao-info").textContent = `${VERSAO} · ${h.atualizadoEm ? "atualizado " + new Date(h.atualizadoEm).toLocaleString("pt-BR") : "sem dados ainda"}`;

    // Alerta se Bling não está logado
    const $alerta = $("alerta-bling");
    if (!h.blingLogado) {
      $alerta.innerHTML = `⚠️ <b>Bling não está logado.</b> Sem isso, a busca de produtos não funciona. <a href="/auth/bling" target="_blank">Clique aqui pra fazer login no Bling</a> (uma vez só).`;
      $alerta.style.display = "block";
    } else if (cache && cache.skusIndexados === 0) {
      $alerta.innerHTML = `⏳ Bling logado, carregando produtos do cache... aguarde ~30 segundos e atualize a página.`;
      $alerta.style.display = "block";
    } else if (cache && !cache.eansCarregados) {
      $alerta.innerHTML = `⏳ Carregando detalhes (nomes, imagens, EANs) em segundo plano: ${cache.detalhesEmCache}/${cache.skusIndexados}. Busca por SKU já funciona; busca por nome/EAN fica completa em ~${Math.ceil((cache.skusIndexados - cache.detalhesEmCache) / 60)} min.`;
      $alerta.style.display = "block";
    } else {
      $alerta.style.display = "none";
    }
  } catch (e) {
    $("status-painel").innerHTML = `<span class="erro">Erro ao carregar status: ${e.message}</span>`;
  }
}

function badge(cls, label, valor) {
  return `<div><b>${label}:</b> <span class="badge-status badge-${cls}">${valor}</span></div>`;
}

// Atualiza o status a cada 30s
setInterval(() => {
  if (!$("conteudo").classList.contains("escondido")) carregarStatus();
}, 30000);

// ============================================================
// TABELA DE SKUs FRÁGEIS
// ============================================================
const $tbody = () => $("tbody-skus");
const $contador = () => $("contador");
const $filtro = () => $("filtro");

// Mapa local: SKU → { nome, imagem, ean, mensagem }
let skusEnriquecidos = {};

function adicionarLinha(sku = "", msg = "", info = {}, focar = false) {
  if (!sku && !msg) {
    const linhas = $tbody().querySelectorAll("tr");
    for (const tr of linhas) {
      const skuInput = tr.querySelector(".input-sku");
      if (skuInput && !skuInput.value.trim()) {
        skuInput.focus();
        atualizarContador();
        return;
      }
    }
  }
  const tr = document.createElement("tr");
  const imgHtml = info.imagem
    ? `<img src="${escapeHtml(info.imagem)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" /><span class="sem-img" style="display:none;">📦</span>`
    : `<span class="sem-img">📦</span>`;
  tr.innerHTML = `
    <td class="col-img">${imgHtml}</td>
    <td class="col-sku"><input type="text" class="input-sku" placeholder="Ex: KJDD-E-187" /></td>
    <td class="col-nome"><span class="span-nome">${escapeHtml(info.nome || "")}</span></td>
    <td class="col-msg"><input type="text" class="input-msg" placeholder="Deixe em branco pra usar a mensagem padrão" maxlength="500" /></td>
    <td class="col-acao"><button type="button" class="btn-remover" title="Remover">✕</button></td>
  `;
  const skuInput = tr.querySelector(".input-sku");
  const msgInput = tr.querySelector(".input-msg");
  const btnRemover = tr.querySelector(".btn-remover");
  skuInput.value = sku;
  msgInput.value = msg;
  // Guarda info original no dataset
  if (info.imagem) tr.dataset.imagem = info.imagem;
  if (info.nome) tr.dataset.nome = info.nome;

  skuInput.addEventListener("input", atualizarContador);
  skuInput.addEventListener("input", aplicarFiltro);
  msgInput.addEventListener("input", aplicarFiltro);
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); adicionarLinha("", "", {}, true); }
  });
  skuInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); msgInput.focus(); }
  });
  btnRemover.addEventListener("click", () => {
    if (skuInput.value.trim() || msgInput.value.trim()) {
      if (!confirm(`Remover o SKU "${skuInput.value}"?`)) return;
    }
    tr.remove();
    atualizarContador();
    if ($tbody().children.length === 0) adicionarLinha();
  });
  $tbody().appendChild(tr);
  if (focar) skuInput.focus();
  atualizarContador();
}

function lerTabelaParaMapa() {
  const mapa = {};
  const linhas = $tbody().querySelectorAll("tr");
  for (const tr of linhas) {
    const sku = tr.querySelector(".input-sku")?.value.trim() || "";
    const msg = tr.querySelector(".input-msg")?.value.trim() || "";
    if (sku) mapa[sku] = msg;
  }
  return mapa;
}

function preencherTabelaDoMapa(mapa) {
  $tbody().innerHTML = "";
  const skus = Object.keys(mapa || {});
  if (skus.length === 0) { adicionarLinha(); return; }
  skus.sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  for (const sku of skus) {
    const enriq = skusEnriquecidos[sku] || {};
    adicionarLinha(sku, mapa[sku] || "", enriq);
  }
}

function atualizarContador() {
  const mapa = lerTabelaParaMapa();
  const n = Object.keys(mapa).length;
  $contador().textContent = n + " SKU" + (n === 1 ? "" : "s");
}

function aplicarFiltro() {
  const termo = ($filtro().value || "").trim().toLowerCase();
  const linhas = $tbody().querySelectorAll("tr");
  for (const tr of linhas) {
    const sku = tr.querySelector(".input-sku")?.value.toLowerCase() || "";
    const msg = tr.querySelector(".input-msg")?.value.toLowerCase() || "";
    const nome = (tr.dataset.nome || "").toLowerCase();
    const visivel = !termo || sku.includes(termo) || msg.includes(termo) || nome.includes(termo);
    tr.style.display = visivel ? "" : "none";
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ============================================================
// BUSCA NO BLING (modal)
// ============================================================
let resultadosBusca = [];
let selecionados = new Map(); // SKU → { sku, nome, imagem, ean }

async function abrirModalBusca() {
  $("modal-busca").classList.add("visivel");
  $("busca-input").value = "";
  $("busca-resultados").innerHTML = `<div class="busca-vazio">Digite algo acima e clique em <b>Buscar</b>.</div>`;
  $("busca-info-total").textContent = "";
  $("status-busca").textContent = "";
  selecionados.clear();
  atualizarBotaoAdicionar();
  setTimeout(() => $("busca-input").focus(), 100);
}
function fecharModalBusca() { $("modal-busca").classList.remove("visivel"); }

async function executarBusca() {
  const q = $("busca-input").value.trim();
  if (!q) { $("status-busca").textContent = "Digite algo pra buscar"; $("status-busca").className = "aviso"; return; }
  if (q.length < 2) { $("status-busca").textContent = "Digite pelo menos 2 caracteres"; $("status-busca").className = "aviso"; return; }
  $("busca-btn").disabled = true;
  $("busca-btn").textContent = "Buscando...";
  $("status-busca").textContent = "";
  try {
    const data = await api("/api/buscar?q=" + encodeURIComponent(q) + "&limite=100");
    resultadosBusca = data.resultados || [];
    renderResultadosBusca();
    const cs = data.cacheStatus || {};
    $("busca-info-total").textContent =
      `${data.total} resultado(s) · cache: ${cs.detalhesEmCache}/${cs.skusIndexados}` +
      (cs.eansCarregados ? " (completo)" : " (carregando...)");
  } catch (e) {
    $("status-busca").textContent = "Erro: " + e.message;
    $("status-busca").className = "erro";
  } finally {
    $("busca-btn").disabled = false;
    $("busca-btn").textContent = "Buscar";
  }
}

function renderResultadosBusca() {
  if (resultadosBusca.length === 0) {
    $("busca-resultados").innerHTML = `<div class="busca-vazio">Nenhum produto encontrado.</div>`;
    return;
  }
  // Marca quais SKUs já estão na lista de Frágeis pra avisar
  const ja = new Set(Object.keys(lerTabelaParaMapa()));
  const html = resultadosBusca.map((p, i) => {
    const sku = p.codigo || "";
    const jaTem = ja.has(sku);
    const checked = selecionados.has(sku) ? "checked" : "";
    const imgHtml = p.imagem
      ? `<img src="${escapeHtml(p.imagem)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" /><span class="sem-img" style="display:none;">📦</span>`
      : `<span class="sem-img">📦</span>`;
    return `
      <label class="busca-item" ${jaTem ? 'style="opacity:0.55;background:#f8f9fa;"' : ""}>
        <input type="checkbox" data-i="${i}" ${checked} ${jaTem ? 'disabled' : ''} />
        ${imgHtml}
        <div class="busca-item-info">
          <div class="sku">${escapeHtml(sku)}${jaTem ? ' <small style="color:#dc3545;font-weight:bold;">(já cadastrado)</small>' : ""}</div>
          <div class="nome">${escapeHtml(p.nome || "(sem nome)")}</div>
          ${p.ean ? `<div class="ean">EAN: ${escapeHtml(p.ean)}</div>` : ""}
        </div>
      </label>
    `;
  }).join("");
  $("busca-resultados").innerHTML = html;
  $("busca-resultados").querySelectorAll('input[type=checkbox]:not([disabled])').forEach(cb => {
    cb.addEventListener("change", () => {
      const idx = parseInt(cb.dataset.i, 10);
      const p = resultadosBusca[idx];
      if (cb.checked) selecionados.set(p.codigo, p);
      else selecionados.delete(p.codigo);
      atualizarBotaoAdicionar();
    });
  });
}

function atualizarBotaoAdicionar() {
  const n = selecionados.size;
  $("busca-adicionar").textContent = `Adicionar selecionados (${n})`;
  $("busca-adicionar").disabled = n === 0;
}

function adicionarSelecionados() {
  let novos = 0;
  for (const [sku, p] of selecionados) {
    skusEnriquecidos[sku] = { nome: p.nome, imagem: p.imagem, ean: p.ean };
    adicionarLinha(sku, "", { nome: p.nome, imagem: p.imagem });
    novos++;
  }
  fecharModalBusca();
  status(`✓ ${novos} SKU(s) adicionado(s) à lista. Não esqueça de clicar em SALVAR TUDO.`, true);
}

// ============================================================
// USUÁRIOS
// ============================================================
async function carregarUsuarios() {
  try {
    const data = await api("/api/usuarios");
    const lista = data.usuarios || [];
    if (lista.length === 0) {
      $("lista-usuarios-area").innerHTML = `
        <div class="alerta">⚠️ Nenhum usuário cadastrado ainda. Clique em "Novo usuário" pra criar o primeiro. A chave-mestra ficará desativada após criar o primeiro usuário.</div>
      `;
      return;
    }
    const sess = getSession();
    const eh_eu = (u) => sess && sess.usuario && u.usuario.toLowerCase() === sess.usuario.toLowerCase();
    const html = `
      <table class="lista-usuarios">
        <thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th style="text-align:center;">Ações</th></tr></thead>
        <tbody>
          ${lista.map(u => `
            <tr>
              <td><b>${escapeHtml(u.usuario)}</b>${eh_eu(u) ? ' <small style="color:#28a745;">(você)</small>' : ""}</td>
              <td>${escapeHtml(u.nome || "")}</td>
              <td><span class="badge-perfil">${escapeHtml(u.perfil || "admin")}</span></td>
              <td style="text-align:center;">
                <button class="btn-secundario" data-acao="senha" data-user="${escapeHtml(u.usuario)}">Trocar senha</button>
                ${!eh_eu(u) ? `<button class="btn-perigo" data-acao="remover" data-user="${escapeHtml(u.usuario)}">Remover</button>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    $("lista-usuarios-area").innerHTML = html;
    $("lista-usuarios-area").querySelectorAll("button[data-acao]").forEach(btn => {
      btn.addEventListener("click", () => {
        const acao = btn.dataset.acao;
        const user = btn.dataset.user;
        if (acao === "senha") trocarSenhaUsuario(user);
        if (acao === "remover") removerUsuario(user);
      });
    });
  } catch (e) {
    $("lista-usuarios-area").innerHTML = `<span class="erro">Erro: ${e.message}</span>`;
  }
}

function abrirModalNovoUsuario() {
  $("novo-usuario").value = "";
  $("novo-nome").value = "";
  $("novo-senha").value = "";
  $("status-usuario").textContent = "";
  $("modal-usuario").classList.add("visivel");
  setTimeout(() => $("novo-usuario").focus(), 100);
}
function fecharModalNovoUsuario() { $("modal-usuario").classList.remove("visivel"); }

async function criarUsuario() {
  const usuario = $("novo-usuario").value.trim();
  const nome = $("novo-nome").value.trim();
  const senha = $("novo-senha").value;
  if (!usuario || !senha) {
    $("status-usuario").textContent = "Preencha usuário e senha.";
    $("status-usuario").className = "erro";
    return;
  }
  if (senha.length < 6) {
    $("status-usuario").textContent = "Senha deve ter pelo menos 6 caracteres.";
    $("status-usuario").className = "erro";
    return;
  }
  $("usuario-criar").disabled = true;
  try {
    await api("/api/usuarios", {
      method: "POST",
      body: JSON.stringify({ usuario, senha, nome, perfil: "admin" })
    });
    fecharModalNovoUsuario();
    status(`✓ Usuário "${usuario}" criado`, true);
    carregarUsuarios();
    carregarStatus();
  } catch (e) {
    $("status-usuario").textContent = e.message;
    $("status-usuario").className = "erro";
  } finally {
    $("usuario-criar").disabled = false;
  }
}

async function trocarSenhaUsuario(usuario) {
  const novaSenha = prompt(`Nova senha para "${usuario}" (mín. 6 caracteres):`);
  if (!novaSenha) return;
  if (novaSenha.length < 6) { alert("Senha muito curta"); return; }
  try {
    await api(`/api/usuarios/${encodeURIComponent(usuario)}/senha`, {
      method: "POST",
      body: JSON.stringify({ novaSenha })
    });
    status(`✓ Senha de "${usuario}" alterada`, true);
  } catch (e) {
    status("Erro: " + e.message, false);
  }
}

async function removerUsuario(usuario) {
  if (!confirm(`Remover usuário "${usuario}"? Essa ação não pode ser desfeita.`)) return;
  try {
    await api(`/api/usuarios/${encodeURIComponent(usuario)}`, { method: "DELETE" });
    status(`✓ Usuário "${usuario}" removido`, true);
    carregarUsuarios();
    carregarStatus();
  } catch (e) {
    status("Erro: " + e.message, false);
  }
}

// ============================================================
// SALVAR / CARREGAR
// ============================================================
function status(txt, ok) {
  $("status").textContent = txt;
  $("status").className = ok ? "ok" : "erro";
  if (txt) setTimeout(() => { $("status").textContent = ""; $("status").className = ""; }, 4000);
}

async function carregar() {
  try {
    const r = await fetch("/api/skus");
    const j = await r.json();
    preencherTabelaDoMapa(j.skus || {});
    $("tempo").value = j.config?.tempoMinimoSegundos ?? 2;
    $("msgPadrao").value = j.config?.mensagemPadrao || "";
    $("repetir").checked = !!j.config?.repetirVoz;
    if (j.atualizadoEm) {
      const por = j.atualizadoPor ? ` por ${j.atualizadoPor}` : "";
      $("atualizadoEm").textContent = "Última atualização: " + new Date(j.atualizadoEm).toLocaleString("pt-BR") + por;
    } else {
      $("atualizadoEm").textContent = "Sem dados ainda — preencha e salve.";
    }
  } catch (e) {
    status("Erro ao carregar: " + e.message, false);
  }
}

async function salvar() {
  $("btn-salvar").disabled = true;
  try {
    const linhas = $tbody().querySelectorAll("tr");
    const vistos = new Set();
    const duplicados = [];
    for (const tr of linhas) {
      const sku = tr.querySelector(".input-sku")?.value.trim() || "";
      if (!sku) continue;
      if (vistos.has(sku)) duplicados.push(sku);
      vistos.add(sku);
    }
    if (duplicados.length > 0) {
      const ok = confirm("⚠️ SKUs duplicados: " + duplicados.join(", ") + "\n\nVai manter apenas a última de cada. Continuar?");
      if (!ok) { $("btn-salvar").disabled = false; return; }
    }
    const corpo = {
      config: {
        tempoMinimoSegundos: parseInt($("tempo").value, 10) || 0,
        mensagemPadrao: $("msgPadrao").value.trim(),
        repetirVoz: !!$("repetir").checked
      },
      skus: lerTabelaParaMapa()
    };
    const j = await api("/api/skus", { method: "POST", body: JSON.stringify(corpo) });
    if (j.atualizadoEm) {
      const por = j.atualizadoPor ? ` por ${j.atualizadoPor}` : "";
      $("atualizadoEm").textContent = "Última atualização: " + new Date(j.atualizadoEm).toLocaleString("pt-BR") + por;
    }
    status("✓ Salvo! " + Object.keys(j.skus).length + " SKUs ativos", true);
  } catch (e) {
    status("Erro ao salvar: " + e.message, false);
  } finally {
    $("btn-salvar").disabled = false;
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================
$("btn-login").addEventListener("click", fazerLogin);
$("login-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") fazerLogin(); });
$("login-usuario").addEventListener("keydown", (e) => { if (e.key === "Enter") $("login-senha").focus(); });
$("btn-logout").addEventListener("click", logout);

$("btn-salvar").addEventListener("click", salvar);
$("btn-recarregar").addEventListener("click", () => { carregar(); carregarStatus(); });
$("btn-add-manual").addEventListener("click", () => adicionarLinha("", "", {}, true));
$("filtro").addEventListener("input", aplicarFiltro);

$("btn-abrir-busca").addEventListener("click", abrirModalBusca);
$("busca-fechar").addEventListener("click", fecharModalBusca);
$("busca-cancelar").addEventListener("click", fecharModalBusca);
$("busca-btn").addEventListener("click", executarBusca);
$("busca-input").addEventListener("keydown", (e) => { if (e.key === "Enter") executarBusca(); });
$("busca-adicionar").addEventListener("click", adicionarSelecionados);

$("btn-novo-usuario").addEventListener("click", abrirModalNovoUsuario);
$("usuario-fechar").addEventListener("click", fecharModalNovoUsuario);
$("usuario-cancelar").addEventListener("click", fecharModalNovoUsuario);
$("usuario-criar").addEventListener("click", criarUsuario);
$("novo-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") criarUsuario(); });

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!$("conteudo").classList.contains("escondido")) salvar();
  }
  if (e.key === "Escape") {
    if ($("modal-busca").classList.contains("visivel")) fecharModalBusca();
    if ($("modal-usuario").classList.contains("visivel")) fecharModalNovoUsuario();
  }
});

// Cards colapsáveis (Configurações, Usuários)
document.querySelectorAll(".card-collapse h2").forEach(h => {
  h.addEventListener("click", (e) => {
    // Não colapsa se clicou em algo interativo dentro do header
    if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
    h.parentElement.classList.toggle("collapsed");
  });
});

// ============================================================
// INIT
// ============================================================
inicializar();
