// ============================================================
// scanner.js - camera mobile pra bipar codigo de barras
// ============================================================
// Licoes Girassol: pausa entre leituras, lastCode pra evitar dupla, BarcodeDetector
// v3.14.9: suporta 2 modos:
//   - 'etiqueta': bipa etiqueta da devolucao -> preenche campo busca + buscar()
//   - 'bipagem': bipa EAN do produto -> chama processarBipagem() do bipagem.js

let scannerStream = null;
let scannerDetector = null;
let scannerScanning = false;
let scannerPaused = false;
let scannerLastCode = '';
let scannerLastCodeAt = 0;
let scannerModo = 'etiqueta'; // 'etiqueta' ou 'bipagem'

async function abrirCameraScanner(modo = 'etiqueta') {
  scannerModo = modo;

  // Verifica se navegador suporta BarcodeDetector
  if (!('BarcodeDetector' in window)) {
    toast('Camera scanner nao suportada. Use Chrome ou Edge no celular.', 'err');
    return;
  }
  try {
    scannerDetector = new BarcodeDetector({
      formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'qr_code', 'pdf417']
    });
  } catch (e) {
    toast('Erro ao iniciar scanner: ' + e.message, 'err');
    return;
  }

  // Atualiza titulo do scanner conforme o modo
  const tituloEl = document.querySelector('#scannerOverlay div[style*="font-weight:700"]');
  if (tituloEl) {
    tituloEl.textContent = modo === 'bipagem'
      ? '📷 Bipar EAN do produto'
      : '📷 Bipar etiqueta';
  }

  // Atualiza texto inicial do status conforme modo
  const statusEl = document.getElementById('scannerStatus');
  if (statusEl) {
    statusEl.style.background = 'rgba(0,0,0,0.85)';
    statusEl.textContent = modo === 'bipagem'
      ? 'Aponte para o EAN do produto'
      : 'Aponte para o codigo de barras';
  }

  const overlay = document.getElementById('scannerOverlay');
  overlay.style.display = 'flex';

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    const video = document.getElementById('scannerVideo');
    video.srcObject = scannerStream;
    await video.play();

    scannerScanning = true;
    scannerPaused = false;
    scannerLastCode = '';
    scannerLoop();
  } catch (e) {
    toast('Erro ao abrir camera: ' + e.message, 'err');
    fecharCameraScanner();
  }
}

// Atalho pra abrir em modo bipagem (chamado do botao do modal aprovar)
function abrirCameraBipagem() {
  abrirCameraScanner('bipagem');
}

function scannerLoop() {
  if (!scannerScanning || !scannerDetector) return;
  if (scannerPaused) {
    requestAnimationFrame(scannerLoop);
    return;
  }
  const video = document.getElementById('scannerVideo');
  if (!video || video.videoWidth < 100) {
    requestAnimationFrame(scannerLoop);
    return;
  }
  scannerDetector.detect(video).then(codes => {
    if (codes.length > 0) {
      const raw = String(codes[0].rawValue).trim();
      // Evita ler 2x o mesmo em <4s
      if (raw !== scannerLastCode || Date.now() - scannerLastCodeAt > 4000) {
        scannerLastCode = raw;
        scannerLastCodeAt = Date.now();
        scannerPaused = true;
        if (scannerModo === 'bipagem') {
          processarLeituraBipagem(raw);
        } else {
          processarBipagemEtiqueta(raw);
        }
      }
    }
  }).catch(() => {}).finally(() => {
    if (scannerScanning) requestAnimationFrame(scannerLoop);
  });
}

// MODO ETIQUETA: bipou etiqueta -> preenche campo busca + buscar()
function processarBipagemEtiqueta(codigo) {
  const status = document.getElementById('scannerStatus');

  // Etiquetas ML são so digitos (ex: 46912301194). Pack IDs são 16 digitos (ex: 2000012153272513).
  // Se vier QR Code com JSON, tenta extrair id
  let codigoLimpo = codigo;
  try {
    const j = JSON.parse(codigo);
    if (j.id) codigoLimpo = String(j.id);
  } catch(e) {}

  // Tira espaços, hifens e caracteres não numéricos
  codigoLimpo = codigoLimpo.replace(/[^0-9]/g, '');

  // Etiquetas válidas: 9-20 dígitos
  if (codigoLimpo.length < 9 || codigoLimpo.length > 20) {
    beepErro();
    status.style.background = 'rgba(198,40,40,0.95)';
    status.textContent = `❌ Codigo invalido: ${codigo.slice(0, 30)}`;
    // Volta a procurar depois de 2s
    setTimeout(() => {
      status.style.background = 'rgba(0,0,0,0.85)';
      status.textContent = 'Aponte para o codigo de barras';
      scannerPaused = false;
    }, 2000);
    return;
  }

  // OK!
  beepOk();
  status.style.background = 'rgba(46,125,50,0.95)';
  status.textContent = `✅ Lido: ${codigoLimpo}`;

  // Preenche o campo de busca
  const inp = document.getElementById('codigo');
  if (inp) {
    inp.value = codigoLimpo;
    // v3.14.8: tira foco do campo pra nao abrir teclado virtual no celular
    inp.blur();
  }

  setTimeout(() => {
    fecharCameraScanner();
    // v3.14.8: garante que o foco NAO volta pro campo (que abriria teclado)
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    // Dispara busca automatica
    if (typeof buscar === 'function') buscar();
  }, 800);
}

// MODO BIPAGEM: bipou EAN -> chama processarBipagem() do bipagem.js
// v3.14.9: scanner fica ABERTO entre leituras (pra bipar varias unidades em sequencia)
function processarLeituraBipagem(codigo) {
  const status = document.getElementById('scannerStatus');

  // EAN-13 ou EAN-8 - aceita qualquer string de digitos
  let codigoLimpo = codigo.replace(/[^0-9]/g, '');

  if (codigoLimpo.length < 8 || codigoLimpo.length > 14) {
    beepErro();
    status.style.background = 'rgba(198,40,40,0.95)';
    status.textContent = `❌ EAN invalido: ${codigo.slice(0, 20)}`;
    setTimeout(() => {
      status.style.background = 'rgba(0,0,0,0.85)';
      status.textContent = 'Aponte para o EAN do produto';
      scannerPaused = false;
    }, 1500);
    return;
  }

  // Salva contador antes da bipagem pra detectar se aumentou (= acerto)
  const bipadoAntes = (typeof bipagemEstado !== 'undefined') ? bipagemEstado.totalBipado : 0;

  // Chama o processador de bipagem (que valida o EAN, atualiza contadores, etc)
  if (typeof processarBipagem === 'function') {
    processarBipagem(codigoLimpo);
  }

  // Verifica resultado
  const bipadoDepois = (typeof bipagemEstado !== 'undefined') ? bipagemEstado.totalBipado : 0;
  const acertou = bipadoDepois > bipadoAntes;
  const completou = (typeof bipagemEstado !== 'undefined') &&
                    (bipagemEstado.totalBipado >= bipagemEstado.totalEsperado);

  if (completou) {
    // Completou! Fecha scanner
    status.style.background = 'rgba(46,125,50,0.95)';
    status.textContent = `✅ Completo! ${bipagemEstado.totalEsperado}/${bipagemEstado.totalEsperado}`;
    setTimeout(() => {
      fecharCameraScanner();
    }, 1000);
  } else if (acertou) {
    // Acertou mas ainda falta - libera scanner pra proxima leitura
    status.style.background = 'rgba(46,125,50,0.95)';
    status.textContent = `✅ ${bipagemEstado.totalBipado}/${bipagemEstado.totalEsperado} - bipe o proximo`;
    setTimeout(() => {
      status.style.background = 'rgba(0,0,0,0.85)';
      status.textContent = 'Aponte para o EAN do produto';
      scannerPaused = false;
    }, 1500);
  } else {
    // EAN errado - libera scanner pra tentar de novo
    status.style.background = 'rgba(245,124,0,0.95)';
    status.textContent = `⚠️ EAN nao confere com o esperado`;
    setTimeout(() => {
      status.style.background = 'rgba(0,0,0,0.85)';
      status.textContent = 'Aponte para o EAN do produto';
      scannerPaused = false;
    }, 1500);
  }
}

function fecharCameraScanner() {
  scannerScanning = false;
  scannerPaused = false;
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  const video = document.getElementById('scannerVideo');
  if (video) video.srcObject = null;
  document.getElementById('scannerOverlay').style.display = 'none';
  // v3.14.9: reset modo pro padrao (etiqueta)
  scannerModo = 'etiqueta';
}
