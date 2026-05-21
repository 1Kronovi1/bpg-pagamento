(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────
  let selectedAmount = 75;
  let selectedLabel  = '1ª parcela';

  // ── DOM refs ───────────────────────────────────────────
  const optionBtns  = document.querySelectorAll('.pix-opt');
  const generateBtn = document.getElementById('generateBtn');
  const pixResult   = document.getElementById('pixResult');
  const pixCodeBox  = document.getElementById('pixCodeBox');
  const copyBtn     = document.getElementById('copyBtn');
  const copySuccess = document.getElementById('copySuccess');
  const qrCanvas    = document.getElementById('qrCanvas');

  // ── Option selection ───────────────────────────────────
  optionBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      optionBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      selectedAmount = parseFloat(btn.dataset.amount);
      selectedLabel  = btn.dataset.label;
      pixResult.classList.remove('show');
      copySuccess.style.display = 'none';
    });
  });

  // ── PIX payload builder ────────────────────────────────
  function tlv(id, value) {
    var len = String(value.length).padStart(2, '0');
    return id + len + value;
  }

  function crc16(str) {
    var crc = 0xFFFF;
    for (var i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      }
    }
    crc &= 0xFFFF;
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function buildPixPayload(cpf, name, amount, city, description) {
    var key         = cpf.replace(/\D/g, '');
    var amtStr      = amount.toFixed(2);
    var desc        = description.substring(0, 20).replace(/[^A-Za-z0-9 ]/g, '');
    var safeName    = name.substring(0, 25).replace(/[^A-Za-z0-9 ]/g, '').toUpperCase();
    var safeCity    = city.substring(0, 15).replace(/[^A-Za-z0-9 ]/g, '').toUpperCase();

    var merchantAccount = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', key);
    var addInfo         = tlv('05', desc);
    var addData         = tlv('50', addInfo);

    var payload =
      tlv('00', '01') +
      tlv('26', merchantAccount) +
      tlv('52', '0000') +
      tlv('53', '986') +
      tlv('54', amtStr) +
      tlv('58', 'BR') +
      tlv('59', safeName) +
      tlv('60', safeCity) +
      tlv('62', addData) +
      '6304';

    return payload + crc16(payload);
  }

  // ── QR Code renderer ───────────────────────────────────
  function renderQRCode(text) {
    var ctx = qrCanvas.getContext('2d');
    ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);

    if (typeof QRCode === 'undefined') {
      ctx.fillStyle = '#888';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('QR indisponível', 90, 90);
      return;
    }

    var tempDiv = document.createElement('div');
    tempDiv.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
    document.body.appendChild(tempDiv);

    new QRCode(tempDiv, {
      text: text,
      width: 180,
      height: 180,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    setTimeout(function () {
      var inner = tempDiv.querySelector('canvas') || tempDiv.querySelector('img');
      if (inner) {
        if (inner.tagName === 'CANVAS') {
          ctx.drawImage(inner, 0, 0, 180, 180);
        } else {
          var img = new Image();
          img.onload = function () { ctx.drawImage(img, 0, 0, 180, 180); };
          img.src = inner.src;
        }
      }
      document.body.removeChild(tempDiv);
    }, 150);
  }

  // ── Generate ───────────────────────────────────────────
  generateBtn.addEventListener('click', function () {
    var payload = buildPixPayload(
      '162.621.654-10',
      'BRUNO GOMES SA OLIVEIRA',
      selectedAmount,
      'RECIFE',
      'Leluma ' + selectedLabel
    );

    pixCodeBox.textContent = payload;
    renderQRCode(payload);
    copySuccess.style.display = 'none';
    pixResult.classList.add('show');
    setTimeout(function () {
      pixResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  });

  // ── Copy ───────────────────────────────────────────────
  copyBtn.addEventListener('click', function () {
    var code = pixCodeBox.textContent;
    if (!code) return;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code).then(showCopied);
    } else {
      var ta = document.createElement('textarea');
      ta.value = code;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); showCopied(); } catch (e) {}
      document.body.removeChild(ta);
    }
  });

  function showCopied() {
    copySuccess.style.display = 'block';
    setTimeout(function () {
      copySuccess.style.display = 'none';
    }, 3000);
  }

})();