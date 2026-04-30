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

// ---------------- ESTRUTURA PADRÃO ----------------
function dadosPadrao() {
  return {
    config: {
      tempoMinimoSegundos: 2,                                 // tempo mínimo antes do OK liberar
      mensagemPadrao: "Atenção. Produto frágil. Embalar com plástico bolha e reforçar a caixa.",
      repetirVoz: false                                       // se true, repete a voz após terminar (1x)
    },
    skus: {
      // "SKU": "Mensagem custom (opcional)"
    },
    atualizadoEm: null
  };
}

// ---------------- LEITURA / ESCRITA ----------------
function lerDados() {
  try {
    if (!fs.existsSync(DATA_FILE)) return dadosPadrao();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const obj = JSON.parse(raw);
    // Garante que campos novos sempre existam (forward compat)
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
  dados.atual
