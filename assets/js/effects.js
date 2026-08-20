/* ==========================================================================
   Text Effects + Eye Roll — 無任何依賴的移植版
   --------------------------------------------------------------------------
   原本 Cargo 站上這些效果需要 jQuery、Underscore、Backbone 和 Cargo 自己的
   事件系統才能跑。這份只用瀏覽器原生 API 重寫，行為與參數維持一致。

   會處理的東西：
   - 所有 h1（或任何 [data-split]）→ 拆成單字再拆成字元，捲到才逐字浮現
   - .stagger-item → 標題播完後接著整段淡入
   - .wiggle-text  → 滑鼠移過／手指點到會逐字跳動
   - [data-eye]    → 跟著滑鼠旋轉（原 eyeroll.js）
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------------
     工具：把字串安全拆成「字元」
     直接用 split('') 會把 emoji 拆壞（你的副標有 🥨），
     所以優先用 Intl.Segmenter，不支援時退回 Array.from。
     ---------------------------------------------------------------------- */
  function toGraphemes(str) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      var seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      var out = [];
      var it = seg.segment(str)[Symbol.iterator]();
      for (var r = it.next(); !r.done; r = it.next()) out.push(r.value.segment);
      return out;
    }
    return Array.from(str); // 至少能正確處理代理對
  }

  /* ------------------------------------------------------------------------
     拆字
     結構是 word → letter 兩層：
       <span class="text-word"><span class="text-letter">G</span>…</span>
     單字之間放真正的空白文字節點，這樣換行才會斷在字與字之間，
     不會像單純逐字 inline-block 那樣從單字中間斷掉。
     ---------------------------------------------------------------------- */
  function splitText(el) {
    if (el.dataset.splitReady === 'true') return;

    // aria-label 優先：那是還沒被拆過的原文
    var source = (el.getAttribute('aria-label') || el.textContent || '')
      .replace(/\s+/g, ' ').trim();
    if (!source) return;

    el.setAttribute('aria-label', source);
    var frag = document.createDocumentFragment();
    var words = source.split(' ');
    var letters = [];

    words.forEach(function (word, wi) {
      var wordEl = document.createElement('span');
      wordEl.className = 'text-word';
      wordEl.setAttribute('aria-hidden', 'true');

      toGraphemes(word).forEach(function (ch) {
        var span = document.createElement('span');
        span.className = 'text-letter';
        span.textContent = ch;
        wordEl.appendChild(span);
        letters.push(span);
      });

      frag.appendChild(wordEl);
      if (wi < words.length - 1) frag.appendChild(document.createTextNode(' '));
    });

    el.textContent = '';
    el.appendChild(frag);
    el.dataset.splitReady = 'true';
    el._letters = letters;
  }

  /* ------------------------------------------------------------------------
     逐字浮現
     ---------------------------------------------------------------------- */
  var TOTAL_MS = 900;   // 整段最多播多久
  var STEP_MS = 28;     // 每個字間隔，字太多時會自動縮短
  var LINE_MS = 600;    // 整行浮現的時間，要跟 effects.css 的 transition 一致

  /* 三種模式：
       letter  逐字浮現（舊站的效果）
       line    整行一起出現，不拆字
       none    不做動畫，直接就在那裡

     全站預設寫在 <html data-reveal-default>（來自 site.json 的 effects.reveal），
     個別元素的 data-reveal 可以蓋掉它（首頁大標是 hero.reveal）。 */
  var defaultMode = document.documentElement.dataset.revealDefault || 'letter';

  function modeOf(el) {
    var m = el.dataset.reveal || defaultMode;
    return (m === 'line' || m === 'none') ? m : 'letter';
  }

  /* 標題出現後，讓同一區塊裡的 .stagger-item 依序接上 */
  function showFollowers(el, base) {
    var scope = el.closest('[data-stagger-scope]') || el.parentElement;
    if (!scope) return;
    var followers = scope.querySelectorAll('.stagger-item');
    Array.prototype.forEach.call(followers, function (item, i) {
      item.style.transitionDelay = Math.round(base + i * 90) + 'ms';
      item.classList.add('is-revealed');
    });
  }

  function reveal(el) {
    if (el.dataset.revealed === 'true') return;
    el.dataset.revealed = 'true';

    // 整行模式：整個元素當一個單位，沒有 letters 可以算延遲。
    // base 只等半個動畫時間就讓下一行接上 —— 等它完全停住才動會顯得拖。
    if (modeOf(el) === 'line') {
      el.classList.add('reveal-in');
      showFollowers(el, LINE_MS * 0.5);
      return;
    }

    var letters = el._letters || [];
    var step = letters.length ? Math.min(STEP_MS, TOTAL_MS / letters.length) : 0;

    letters.forEach(function (letter, i) {
      letter.style.transitionDelay = Math.round(i * step) + 'ms';
      letter.classList.add('reveal-in');
    });

    showFollowers(el, letters.length * step);
  }

  function initReveal() {
    var targets = Array.prototype.slice.call(
      document.querySelectorAll('h1, [data-split], [data-reveal]')
    );
    if (!targets.length) return;

    // none 的完全不參與，但它底下的 .stagger-item 還是得看得到
    targets = targets.filter(function (el) {
      if (modeOf(el) !== 'none') return true;
      showFollowers(el, 0);
      return false;
    });

    // 整行模式不拆字（順便對讀屏軟體更友善，文字保持原樣）
    targets.forEach(function (el) {
      if (modeOf(el) === 'letter') splitText(el);
    });

    if (reduceMotion) {
      // 不播動畫，但 .stagger-item 仍要看得到
      Array.prototype.forEach.call(document.querySelectorAll('.stagger-item'), function (i) {
        i.classList.add('is-revealed');
      });
      return;
    }

    // 先武裝（把字藏起來）。已經在畫面內的（例如 hero）下一格就開始播，
    // 其餘等捲到再播。順序很重要：先加 .text-armed 才不會閃一下完整文字。
    var pending = [];
    targets.forEach(function (el) {
      /* 整行模式要掛一個 class，不能讓 CSS 去對 data-reveal ——
         靠全站預設的標題（作品名、Information）身上根本沒有那個屬性，
         CSS 就選不到，結果是掛了 .text-armed 卻沒有任何動畫。 */
      if (modeOf(el) === 'line') el.classList.add('reveal-line');
      el.classList.add('text-armed');
      var rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.9 && rect.bottom > 0) {
        pending.push(el);
      }
    });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        pending.forEach(reveal);
      });
    });

    if (!('IntersectionObserver' in window)) {
      targets.forEach(reveal);
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

    targets.forEach(function (el) {
      if (el.dataset.revealed !== 'true') io.observe(el);
    });
  }

  /* ------------------------------------------------------------------------
     Wiggle：hover／點擊觸發逐字跳動
     原版只吃 hover，觸控裝置碰不到；這裡改用 pointer 事件，兩者都通。
     ---------------------------------------------------------------------- */
  /* 時間從 CSS 變數讀，不要在這裡再寫一份 —— 兩邊寫死就會不同步：
     動畫還在跑就把 class 移掉會讓字瞬間跳回原位。
     變數是 build 從 site.json 的 effects.wiggle 注入的，
     讀不到（例如舊的頁面）就退回原本的數值。 */
  function cssNumber(name, fallback) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    var n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
  }

  function initWiggle() {
    if (reduceMotion) return;
    var items = document.querySelectorAll('.wiggle-text');
    if (!items.length) return;

    var WIGGLE_MS = cssNumber('--wiggle-ms', 500);     // 對應 CSS 的 animation duration
    var WIGGLE_STEP = cssNumber('--wiggle-step', 35);  // 每個字的延遲

    Array.prototype.forEach.call(items, function (el) {
      splitText(el);
      var timer = null;

      var play = function () {
        if (el.classList.contains('is-wiggling')) return;
        var letters = el._letters || [];
        letters.forEach(function (l, i) {
          l.style.animationDelay = i * WIGGLE_STEP + 'ms';
        });
        el.classList.add('is-wiggling');

        clearTimeout(timer);
        timer = setTimeout(function () {
          el.classList.remove('is-wiggling');
          letters.forEach(function (l) { l.style.animationDelay = ''; });
        }, WIGGLE_MS + letters.length * WIGGLE_STEP + 60);
      };

      el.addEventListener('pointerenter', play);
      el.addEventListener('click', play);
      // 鍵盤使用者聚焦時也給同樣的回饋
      el.addEventListener('focusin', play);
    });
  }

  /* ------------------------------------------------------------------------
     Eye Roll：圖片跟著滑鼠轉
     原本靠 caption 裡寫 #eye 來標記，這裡改成 HTML 屬性，語意清楚一點：
       <img data-eye data-rollspeed="0.5" data-range="1" data-rotation="0">
     數學（atan2 + lerp 阻尼）與原版一致。
     ---------------------------------------------------------------------- */
  function initEyes() {
    if (reduceMotion) return;

    var eyes = Array.prototype.slice.call(document.querySelectorAll('[data-eye]'));
    if (!eyes.length) return;

    var state = eyes.map(function (eye) {
      var speed = parseFloat(eye.dataset.rollspeed);
      if (isNaN(speed)) speed = 0.5;
      // 原版的阻尼換算：先壓到 0.1~1 之間再平方，讓數字小的時候更黏
      var intensity = speed + (1 - speed) * 0.1;
      intensity = intensity * intensity;

      var range = parseFloat(eye.dataset.range);
      if (isNaN(range)) range = 1;

      var start = parseFloat(eye.dataset.rotation);
      if (isNaN(start)) start = 0;

      return {
        el: eye,
        intensity: intensity,
        range: range,
        start: start * (Math.PI / 180),
        rect: eye.getBoundingClientRect(),
        look: { x: 0, y: 0 },
      };
    });

    var mouse = null;

    var measure = function () {
      state.forEach(function (s) { s.rect = s.el.getBoundingClientRect(); });
    };

    var onMove = function (event) {
      if (event.touches && event.touches.length) {
        mouse = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      } else {
        mouse = { x: event.clientX, y: event.clientY };
      }
    };

    var tick = function () {
      requestAnimationFrame(tick);
      if (!mouse) return;

      state.forEach(function (s) {
        // 阻尼：目前視線往滑鼠靠近一點，數值越小越慢跟上
        s.look.x = mouse.x * s.intensity + (1 - s.intensity) * s.look.x;
        s.look.y = mouse.y * s.intensity + (1 - s.intensity) * s.look.y;

        var cx = s.rect.left + s.rect.width * 0.5;
        var cy = s.rect.top + s.rect.height * 0.5;

        var rotation;
        if (s.range < 1) {
          rotation = Math.atan2(s.look.y, cx - s.look.x) - Math.PI * 0.5;
        } else {
          rotation = Math.atan2(s.look.y - cy, s.look.x - cx) + Math.PI * 0.5;
        }
        rotation *= s.range;

        s.el.style.transform = 'rotate(' + (rotation + s.start) + 'rad)';
      });
    };

    measure();
    tick();

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(measure);
      eyes.forEach(function (e) { ro.observe(e); });
    }
  }

  /* ------------------------------------------------------------------------
     啟動
     ---------------------------------------------------------------------- */
  function start() {
    initReveal();
    initWiggle();
    initEyes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
