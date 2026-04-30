/* =====================================================================
   Painel admin — gerencia SKUs frágeis e configurações da extensão
   ===================================================================== */

const $ = (id) => document.getElementById(id);

const $authTela = $("auth-tela");
const $conteudo = $("conteudo");
const $authSenha = $("auth-senha");
const $authErro = $("auth-erro");
const $btnAuth = $("btn-auth");

const $lista = $("lista");
const $contador = $("contador");
const $status = $("status");
const $tempo = $("tempo");
const $repetir = $("repetir");
const $msgPadrao = $("msgPadrao");
const $atualizadoEm = $("atualizadoEm");
const $btnSalvar = $("btn-salvar");
const $btnRecarregar = $("btn-recarregar");

let senhaSessao = null;   // se servidor exigir senha, guarda em memória durante a sessão

// ---------------- AUTENTICAÇÃO ----------------
async function checarAuth() {
  try {
    const r = await fetch("/api/check-auth");
    const j = await r.json();
    if (j.exigeSenha) {
      // Tenta usar senha salva no sessionStorage (mantém entre F5 mas não entre fechamento da aba)
      const salva = sessionStorage.getItem("admin_senha");
      if (salva) {
        const ok = await testarSenha(salva);
        if (ok) {
          senhaSessao = salva;
          mostrarConteudo();
          return;
        } else {
          sessionStorage.removeItem("admin_senha");
        }
      }
      $authTela.classList.add("visivel");
      $conteudo.classList.add("escondido");
      $authSenha.focus();
    } else {
      mostrarConteudo();
    }
  } catch (e) {
    alert("Erro ao conectar com servidor: " + e.message);
  }
}

async function testarSenha(senha) {
  try {
    const r = await fetch("/api/check-auth", {
      method: "POST",
      headers: { "X-Admin-Password": senha }
    });
    const j = await r.json();
    return j.ok === true;
  } catch (_) {
    return false;
  }
}

async function autenticar() {
  $authErro.textContent = "";
  const senha = $authSenha.value.trim();
  if (!senha) { $authErro.textContent = "Digite a senha."; return; }
  const ok = await testarSenha(senha);
  if (ok) {
    senhaSessao = senha;
    sessionStorage.setItem("admin_senha", senha);
    $authTela.classList.remove("visivel");
    mostrarConteudo();
  } else {
    $authErro.textContent = "Senha incorreta.";
    $authSenha.select();
  }
}

function mostrarConteudo() {
  $conteudo.classList.remove("escondido");
  carregar();
}

$btnAuth.addEventListener("click", autenticar);
$authSenha.addEventListener("keydown", (e) => { if (e.key === "Enter") autenticar(); });

// ---------------- CONVERSÕES TEXTO <-> MAPA ----------------
function textoParaMapa(texto) {
  const mapa = {};
  const linhas = (texto || "").split(/\r?\n/);
  for (let linha of linhas) {
    linha = linha.trim();
    if (!linha) continue;
    if (linha.startsWith("#")) continue;
    let sku, msg;
    const idx = linha.indexOf("|");
    if (idx >= 0) {
      sku = linha.substring(0, idx).trim();
      msg = linha.substring(idx + 1).trim();
    } else {
      sku = linha;
      msg = "";
    }
    if (sku) mapa[sku] = msg;
  }
  return mapa;
}

function mapaParaTexto(mapa) {
  if (!mapa) return "";
  return Object.keys(mapa)
    .map((sku) => {
      const msg = (mapa[sku] || "").trim();
      return msg ? `${sku} | ${msg}` : sku;
    })
    .join("\n");
}

// ---------------- CONTADOR ----------------
function atualizarContador() {
  const mapa = textoParaMapa($lista.value);
  const n = Object.keys(mapa).length;
  $contador.textContent = n + " SKU" + (n === 1 ? "" : "s");
}
$lista.addEventListener("input", atualizarContador);

// ---------------- STATUS ----------------
function status(txt, ok) {
  $status.textContent = txt;
  $status.className = ok ? "ok" : "erro";
  if (txt) setTimeout(() => { $status.textContent = ""; $status.className = ""; }, 3000);
}

// ---------------- HEADERS ----------------
function headers() {
  const h = { "Content-Type": "application/json" };
  if (senhaSessao) h["X-Admin-Password"] = senhaSessao;
  return h;
}

// ---------------- CARREGAR / SALVAR ----------------
async function carregar() {
  try {
    const r = await fetch("/api/skus");
    const j = await r.json();
    $lista.value = mapaParaTexto(j.skus || {});
    $tempo.value = j.config?.tempoMinimoSegundos ?? 2;
    $msgPadrao.value = j.config?.mensagemPadrao || "";
    $repetir.checked = !!j.config?.repetirVoz;
    if (j.atualizadoEm) {
      $atualizadoEm.textContent = "Última atualização: " + new Date(j.atualizadoEm).toLocaleString("pt-BR");
    } else {
      $atualizadoEm.textContent = "Sem dados ainda — preencha e salve.";
    }
    atualizarContador();
  } catch (e) {
    status("Erro ao carregar: " + e.message, false);
  }
}

async function salvar() {
  $btnSalvar.disabled = true;
  try {
    const corpo = {
      config: {
        tempoMinimoSegundos: parseInt($tempo.value, 10) || 0,
        mensagemPadrao: $msgPadrao.value.trim(),
        repetirVoz: !!$repetir.checked
      },
      skus: textoParaMapa($lista.value)
    };
    const r = await fetch("/api/skus", { method: "POST", headers: headers(), body: JSON.stringify(corpo) });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.erro || "HTTP " + r.status);
    }
    const j = await r.json();
    if (j.atualizadoEm) {
      $atualizadoEm.textContent = "Última atualização: " + new Date(j.atualizadoEm).toLocaleString("pt-BR");
    }
    status("✓ Salvo! " + Object.keys(j.skus).length + " SKUs ativos", true);
  } catch (e) {
    status("Erro ao salvar: " + e.message, false);
  } finally {
    $btnSalvar.disabled = false;
  }
}

$btnSalvar.addEventListener("click", salvar);
$btnRecarregar.addEventListener("click", carregar);

// Atalho Ctrl+S salva
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!$conteudo.classList.contains("escondido")) salvar();
  }
});

// ---------------- INICIALIZAÇÃO ----------------
checarAuth();
