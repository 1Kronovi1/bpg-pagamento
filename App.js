(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  // Minimal QR Code generator (ISO 18004) — no external dependencies
  // Based on the public-domain qrcode-generator by Kazuhiko Arase
  // ─────────────────────────────────────────────────────────────────
  var QR = (function () {
    var PAD0 = 0xEC, PAD1 = 0x11;

    var RS_BLOCK_TABLE = [
      null,null,[1,26,19],[1,26,16],[1,26,13],[1,26,9],
      [1,44,34],[1,44,28],[1,44,22],[1,44,16],
      [1,60,44],[1,60,36],[1,60,26],[1,60,18],
      [1,72,58],[1,72,46],[1,72,36],[1,72,24],
      [1,90,76],[1,90,60],[1,90,46],[1,90,30],
      [2,98,68],[2,98,52],[2,98,42],[2,98,22],
      [2,109,81],[1,109,84,2,109,66],[2,122,92],[2,122,74]
    ];

    function getRSBlocks(ver, ecl) {
      var i = ver * 4 + ecl;
      if (i < RS_BLOCK_TABLE.length && RS_BLOCK_TABLE[i]) {
        var d = RS_BLOCK_TABLE[i];
        if (d.length === 3) return [{totalCount:d[1],dataCount:d[2],count:d[0]}];
        return [
          {totalCount:d[1],dataCount:d[2],count:d[0]},
          {totalCount:d[4],dataCount:d[5],count:d[3]}
        ];
      }
      return [{totalCount:26,dataCount:16,count:1}];
    }

    function createBytes(buffer, rsBlocks) {
      var offset = 0, maxDcCount = 0, maxEcCount = 0;
      var dcdata = [], ecdata = [];
      for (var r = 0; r < rsBlocks.length; r++) {
        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = [];
        for (var i = 0; i < dcCount; i++) dcdata[r][i] = 0xFF & buffer.getBuffer()[offset++];
        var rsPoly = errorCorrectPolynomial(ecCount);
        var rawPoly = createPolynomial(dcdata[r], rsPoly.getLength() - 1);
        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = [];
        for (var j = 0; j < rsPoly.getLength() - 1; j++) {
          var modIndex = j + modPoly.getLength() - (rsPoly.getLength() - 1);
          ecdata[r][j] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
        }
      }
      var totalCodeCount = 0;
      for (var b = 0; b < rsBlocks.length; b++) totalCodeCount += rsBlocks[b].totalCount;
      var data = new Array(totalCodeCount), index = 0;
      for (var x = 0; x < maxDcCount; x++)
        for (var rb = 0; rb < rsBlocks.length; rb++)
          if (x < dcdata[rb].length) data[index++] = dcdata[rb][x];
      for (var x2 = 0; x2 < maxEcCount; x2++)
        for (var rb2 = 0; rb2 < rsBlocks.length; rb2++)
          if (x2 < ecdata[rb2].length) data[index++] = ecdata[rb2][x2];
      return data;
    }

    var LOG_TABLE = [], EXP_TABLE = [];
    (function () {
      for (var i = 0; i < 256; i++) {
        EXP_TABLE[i] = i < 8 ? (1 << i) : EXP_TABLE[i-4] ^ EXP_TABLE[i-5] ^ EXP_TABLE[i-6] ^ EXP_TABLE[i-8];
      }
      for (var j = 0; j < 255; j++) LOG_TABLE[EXP_TABLE[j]] = j;
    })();

    function gexp(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP_TABLE[n]; }
    function glog(n) { if (n < 1) throw new Error('glog(' + n + ')'); return LOG_TABLE[n]; }

    function createPolynomial(num, shift) {
      var offset = 0;
      while (offset < num.length && num[offset] === 0) offset++;
      var arr = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i++) arr[i] = num[i + offset];
      return {
        getLength: function () { return arr.length; },
        getAt: function (i) { return arr[i]; },
        mod: function (e) {
          if (this.getLength() - e.getLength() < 0) return this;
          var ratio = glog(this.getAt(0)) - glog(e.getAt(0));
          var num2 = arr.slice();
          for (var i2 = 0; i2 < e.getLength(); i2++) num2[i2] ^= gexp(glog(e.getAt(i2)) + ratio);
          return createPolynomial(num2, 0).mod(e);
        }
      };
    }

    function errorCorrectPolynomial(ecl) {
      var a = createPolynomial([1], 0);
      for (var i = 0; i < ecl; i++) a = a.mod(createPolynomial([1, gexp(i)], 0));
      return a;
    }

    function createBitBuffer() {
      var buf = [], len = 0;
      return {
        getBuffer: function () {
          var d = [];
          for (var i = 0; i < Math.floor(len / 8); i++) d.push(buf[i]);
          return d;
        },
        getLengthInBits: function () { return len; },
        put: function (num, l) {
          for (var i = 0; i < l; i++) this.putBit(((num >>> (l - i - 1)) & 1) === 1);
        },
        putBit: function (b) {
          var bi = Math.floor(len / 8);
          if (buf.length <= bi) buf.push(0);
          if (b) buf[bi] |= 0x80 >>> (len % 8);
          len++;
        }
      };
    }

    var MASK_PATTERN = {
      PATTERN000: 0, PATTERN001: 1, PATTERN010: 2, PATTERN011: 3,
      PATTERN100: 4, PATTERN101: 5, PATTERN110: 6, PATTERN111: 7
    };

    function maskFunc(pattern, i, j) {
      switch (pattern) {
        case 0: return (i + j) % 2 === 0;
        case 1: return i % 2 === 0;
        case 2: return j % 3 === 0;
        case 3: return (i + j) % 3 === 0;
        case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case 5: return (i * j) % 2 + (i * j) % 3 === 0;
        case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
        case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
      }
    }

    function QRCode(text) {
      var typeNumber = 0, errorCorrectionLevel = 1; // M
      for (var tn = 1; tn <= 40; tn++) {
        var rsBlock = getRSBlocks(tn, errorCorrectionLevel);
        var buf = createBitBuffer();
        buf.put(4, 4);
        var len8 = tn > 9 ? 16 : 8;
        buf.put(text.length, len8);
        for (var ci = 0; ci < text.length; ci++) buf.put(text.charCodeAt(ci), 8);
        var totalDC = 0;
        for (var ri = 0; ri < rsBlock.length; ri++) totalDC += rsBlock[ri].dataCount * rsBlock[ri].count;
        if (buf.getLengthInBits() <= totalDC * 8) { typeNumber = tn; break; }
      }

      var moduleCount = typeNumber * 4 + 17;
      var modules = [];
      for (var row = 0; row < moduleCount; row++) {
        modules[row] = [];
        for (var col = 0; col < moduleCount; col++) modules[row][col] = null;
      }

      function isDark(row2, col2) {
        if (row2 < 0 || moduleCount <= row2 || col2 < 0 || moduleCount <= col2) throw new Error();
        return modules[row2][col2];
      }

      function setupFinderPattern(row2, col2) {
        for (var r = -1; r <= 7; r++) {
          for (var c = -1; c <= 7; c++) {
            if (row2 + r <= -1 || moduleCount <= row2 + r || col2 + c <= -1 || moduleCount <= col2 + c) continue;
            modules[row2 + r][col2 + c] = (r >= 0 && r <= 6 && (c === 0 || c === 6))
              || (c >= 0 && c <= 6 && (r === 0 || r === 6))
              || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          }
        }
      }

      function setupTimingPattern() {
        for (var r = 8; r < moduleCount - 8; r++) if (modules[r][6] === null) modules[r][6] = r % 2 === 0;
        for (var c = 8; c < moduleCount - 8; c++) if (modules[6][c] === null) modules[6][c] = c % 2 === 0;
      }

      function setupFormatInfo(maskPattern) {
        var data = (errorCorrectionLevel << 3) | maskPattern;
        var d = data;
        for (var i = 0; i < 10; i++) d = (d << 1) ^ ((d >>> 9) * 0x537);
        var bits = ((data << 10) | d) ^ 0x5412;
        for (var i2 = 0; i2 <= 5; i2++) modules[i2][8] = ((bits >> i2) & 1) === 1;
        modules[7][8] = ((bits >> 6) & 1) === 1;
        modules[8][8] = ((bits >> 7) & 1) === 1;
        modules[8][7] = ((bits >> 8) & 1) === 1;
        for (var i3 = 9; i3 <= 14; i3++) modules[8][14 - i3] = ((bits >> i3) & 1) === 1;
        for (var i4 = 0; i4 <= 7; i4++) modules[moduleCount - 1 - i4][8] = ((bits >> i4) & 1) === 1;
        for (var i5 = 8; i5 <= 14; i5++) modules[8][moduleCount - 15 + i5] = ((bits >> i5) & 1) === 1;
        modules[8][moduleCount - 8] = true;
      }

      function mapData(data, maskPattern) {
        var inc = -1, row2 = moduleCount - 1, bitIndex = 7, byteIndex = 0;
        for (var col = moduleCount - 1; col > 0; col -= 2) {
          if (col === 6) col--;
          while (true) {
            for (var c = 0; c < 2; c++) {
              if (modules[row2][col - c] === null) {
                var dark = false;
                if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
                if (maskFunc(maskPattern, row2, col - c)) dark = !dark;
                modules[row2][col - c] = dark;
                bitIndex--;
                if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
              }
            }
            row2 += inc;
            if (row2 < 0 || moduleCount <= row2) { row2 -= inc; inc = -inc; break; }
          }
        }
      }

      // Build
      setupFinderPattern(0, 0);
      setupFinderPattern(moduleCount - 7, 0);
      setupFinderPattern(0, moduleCount - 7);
      setupTimingPattern();
      modules[moduleCount - 8][8] = true;

      var buffer = createBitBuffer();
      buffer.put(4, 4);
      buffer.put(text.length, typeNumber > 9 ? 16 : 8);
      for (var i = 0; i < text.length; i++) buffer.put(text.charCodeAt(i), 8);
      var rsBlocks2 = getRSBlocks(typeNumber, errorCorrectionLevel);
      var totalDC2 = 0;
      for (var ri2 = 0; ri2 < rsBlocks2.length; ri2++) totalDC2 += rsBlocks2[ri2].dataCount * rsBlocks2[ri2].count;
      if (buffer.getLengthInBits() + 4 <= totalDC2 * 8) buffer.put(0, 4);
      while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
      while (buffer.getLengthInBits() / 8 < totalDC2) {
        buffer.put(PAD0, 8);
        if (buffer.getLengthInBits() / 8 < totalDC2) buffer.put(PAD1, 8);
      }

      var bytes = createBytes(buffer, rsBlocks2);
      setupFormatInfo(0);
      mapData(bytes, 0);

      this.getModuleCount = function () { return moduleCount; };
      this.isDark = isDark;
    }

    return { create: function (text) { return new QRCode(text); } };
  })();

  // ─────────────────────────────────────────────────────────────────
  // PIX helpers
  // ─────────────────────────────────────────────────────────────────
  function tlv(id, value) {
    return id + String(value.length).padStart(2, '0') + value;
  }

  function crc16(str) {
    var crc = 0xFFFF;
    for (var i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  }

  function buildPixPayload(cpf, name, amount, city, description) {
    var key      = cpf.replace(/\D/g, '');
    var amtStr   = amount.toFixed(2);
    var desc     = description.substring(0, 20).replace(/[^A-Za-z0-9 ]/g, '');
    var safeName = name.substring(0, 25).replace(/[^A-Za-z0-9 ]/g, '').toUpperCase();
    var safeCity = city.substring(0, 15).replace(/[^A-Za-z0-9 ]/g, '').toUpperCase();
    var merchantAccount = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', key);
    var addData = tlv('50', tlv('05', desc));
    var payload = tlv('00','01') + tlv('26', merchantAccount) + tlv('52','0000') +
                  tlv('53','986') + tlv('54', amtStr) + tlv('58','BR') +
                  tlv('59', safeName) + tlv('60', safeCity) + tlv('62', addData) + '6304';
    return payload + crc16(payload);
  }

  // ─────────────────────────────────────────────────────────────────
  // Draw QR on canvas
  // ─────────────────────────────────────────────────────────────────
  function drawQR(canvas, text) {
    var qr    = QR.create(text);
    var count = qr.getModuleCount();
    var quiet = 4; // quiet zone modules
    var total = count + quiet * 2;
    var cell  = Math.floor(canvas.width / total);
    var size  = cell * total;
    canvas.width  = size;
    canvas.height = size;
    var offset = quiet * cell;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        ctx.fillStyle = qr.isDark(row, col) ? '#000000' : '#ffffff';
        ctx.fillRect(offset + col * cell, offset + row * cell, cell, cell);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // UI logic
  // ─────────────────────────────────────────────────────────────────
  var selectedAmount = 75;
  var selectedLabel  = '1ª parcela';

  var optionBtns  = document.querySelectorAll('.pix-opt');
  var generateBtn = document.getElementById('generateBtn');
  var pixResult   = document.getElementById('pixResult');
  var pixCodeBox  = document.getElementById('pixCodeBox');
  var copyBtn     = document.getElementById('copyBtn');
  var copySuccess = document.getElementById('copySuccess');
  var qrCanvas    = document.getElementById('qrCanvas');

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

  generateBtn.addEventListener('click', function () {
    var payload = buildPixPayload(
      '162.621.654-10',
      'BRUNO GOMES SA OLIVEIRA',
      selectedAmount,
      'RECIFE',
      'Leluma ' + selectedLabel
    );
    pixCodeBox.textContent = payload;
    drawQR(qrCanvas, payload);
    copySuccess.style.display = 'none';
    pixResult.classList.add('show');
    setTimeout(function () {
      pixResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  });

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
      ta.focus(); ta.select();
      try { document.execCommand('copy'); showCopied(); } catch (e) {}
      document.body.removeChild(ta);
    }
  });

  function showCopied() {
    copySuccess.style.display = 'block';
    setTimeout(function () { copySuccess.style.display = 'none'; }, 3000);
  }

})();