/* ==========================================================================
   站台腳本
   ・信箱連結在瀏覽器端組出來（HTML 裡只有 data-user / data-domain，
     完整地址不出現在靜態原始碼裡，爬垃圾信的機器人抓不到）
   ・導覽列的捲動行為
   ・作品內頁的封面高度、敘述收合
   ・跟隨式游標
   ・只播放畫面內的影片
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var links = document.querySelectorAll('a.mailto[data-user][data-domain]');
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var addr = a.dataset.user + '@' + a.dataset.domain;
    a.href = 'mailto:' + addr;
    if (!a.textContent.trim() || a.textContent.indexOf('@') === -1) {
      a.textContent = addr;
    }
  }

  /* ------------------------------------------------------------------------
     導覽列：往下捲收起、往上捲出現，離開頂部後才加背景
     可以在 site.json 設 nav.hideOnScroll: false 關掉收起行為
     （關掉之後就是單純的 sticky，一直留在上面）
     ---------------------------------------------------------------------- */
  var nav = document.querySelector('.nav');
  if (nav) {
    var hideOnScroll = nav.dataset.hideOnScroll !== 'false';
    var lastY = window.scrollY;
    var ticking = false;
    // 小幅晃動不該觸發，不然捲動時導覽列會抖
    var THRESHOLD = 8;
    // 頂部這段距離內一律顯示，避免剛開始捲就閃一下
    var TOP_ZONE = 80;

    var update = function () {
      var y = window.scrollY;
      var delta = y - lastY;

      nav.classList.toggle('is-scrolled', y > 4);

      if (hideOnScroll && Math.abs(delta) > THRESHOLD) {
        if (delta > 0 && y > TOP_ZONE) {
          nav.classList.add('is-hidden');
        } else if (delta < 0) {
          nav.classList.remove('is-hidden');
        }
        lastY = y;
      } else if (Math.abs(delta) > THRESHOLD) {
        lastY = y;
      }

      // 捲到底部時一定要看得到導覽列，否則頁尾附近會沒有出路
      if (y + window.innerHeight >= document.documentElement.scrollHeight - 4) {
        nav.classList.remove('is-hidden');
      }

      /* 導覽列還壓在封面上嗎。作品內頁的導覽列是 fixed、透明浮在封面上，
         封面偏暗時連結要改白字（CSS 用 [data-cover-dark] .nav.is-over-cover）。
         捲過封面之後下面是白底，白字會看不見，所以一定要判斷位置，
         不能只看 data-cover-dark 就一路白到底。 */
      var coverEl = document.querySelector('.case-cover');
      if (coverEl) {
        var coverBottom = coverEl.offsetTop + coverEl.offsetHeight;
        nav.classList.toggle('is-over-cover', y + nav.offsetHeight < coverBottom);
      }

      ticking = false;
    };

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }, { passive: true });

    update();
  }

  /* ------------------------------------------------------------------------
     作品內頁：封面高度 = 視窗高 - 導覽列 - 資訊列
     這樣捲動前剛好看到封面加上作品名與年份，metadata 正好壓在折線上
     （參考 bito.tv 的內頁）。

     只寫一個 px 值進 --cover-h，上下限交給 CSS 的 clamp() ——
     這樣 site.json 的 coverMinHeight / coverMaxHeight 想填什麼單位都行。
     JS 沒跑或關掉 fillFirstScreen 時就是注入的預設高度，版面不會壞。

     用 offsetTop 而不是 getBoundingClientRect().top：從瀏覽器上一頁回來時
     頁面可能已經捲到一半，rect 會量到錯的值，offsetTop 不受捲動影響。
     ---------------------------------------------------------------------- */
  var cover = document.querySelector('.case-cover[data-fill="true"]');
  var caseInfo = document.querySelector('.case-info');
  if (cover && caseInfo) {
    var sizeCover = function () {
      cover.style.setProperty('--cover-h',
        (window.innerHeight - cover.offsetTop - caseInfo.offsetHeight) + 'px');
    };
    sizeCover();
    // 轉向或改變視窗大小要重算。resize 會連續觸發，用 rAF 收斂成一次。
    var resizing = false;
    window.addEventListener('resize', function () {
      if (resizing) return;
      resizing = true;
      requestAnimationFrame(function () {
        resizing = false;
        sizeCover();
      });
    });
    // 字體是後載入的（Typekit / Google Fonts），載完資訊列的高度會變
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(sizeCover).catch(function () {});
    }
  }

  /* ------------------------------------------------------------------------
     作品內頁：敘述收合
     敘述放在資訊列會直接吃掉封面的高度，所以先收到 --blurb-lines 行。
     按鈕只在文字真的溢出時才出現 —— 沒溢出還放一顆 More 是騙人的。
     對應 Bito 的 .more-slide。
     ---------------------------------------------------------------------- */
  var blurb = document.querySelector('.case-blurb[data-clamp]');
  var more = document.querySelector('.case-more');
  if (blurb && more) {
    var syncToggle = function () {
      // 收起狀態下才量得出有沒有溢出
      if (blurb.classList.contains('is-open')) return;
      more.hidden = blurb.scrollHeight <= blurb.clientHeight + 1;
    };
    syncToggle();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncToggle).catch(function () {});
    }
    more.addEventListener('click', function () {
      var open = blurb.classList.toggle('is-open');
      more.textContent = open ? more.dataset.less : more.dataset.more;
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      // 展開後資訊列變高，封面要跟著縮
      if (cover && caseInfo) {
        cover.style.setProperty('--cover-h',
          (window.innerHeight - cover.offsetTop - caseInfo.offsetHeight) + 'px');
      }
    });
    more.setAttribute('aria-expanded', 'false');
  }

  /* ------------------------------------------------------------------------
     跟隨式游標（參考 therocketpanda.com 的做法）

     系統游標藏起來，改用一顆粉紅圓點平滑跟著滑鼠；滑到可點擊的東西會放大，
     元素有 data-cursor="文字" 的話會變成一個帶字的膠囊。

     四個關鍵決定：

     1. **只在確定接手成功後才隱藏系統游標。** cursor: none 是靠 JS 加在
        <html> 上的 .has-cursor 觸發的，寫死在 CSS 裡的話這段程式一出錯
        就變成整站沒有游標。JS 沒跑就沿用原本的 PNG 圖檔游標。
     2. **只在有滑鼠的裝置啟用**（hover: hover 且 pointer: fine）。
     3. **lerp 平滑跟隨**：每一格往目標移動固定比例（預設 0.26，跟參考站相同）。
        比例越小越黏、越有拖曳感。
     4. 減少動態時改成瞬間對位（比例 1），而不是關掉整個游標。
     ---------------------------------------------------------------------- */
  (function () {
    var canHover = window.matchMedia
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!canHover) return;

    var css = getComputedStyle(document.documentElement);
    if (css.getPropertyValue('--cursor-follow-size').trim() === '') return;  // 設定關掉了

    var ease = parseFloat(css.getPropertyValue('--cursor-ease')) || 0.26;
    if (reduceMotion) ease = 1;

    var root = document.createElement('div');
    root.className = 'cursor';
    var ring = document.createElement('span');
    ring.className = 'cursor-ring';
    var label = document.createElement('span');
    label.className = 'cursor-label';
    ring.appendChild(label);
    root.appendChild(ring);
    document.body.appendChild(root);
    document.documentElement.classList.add('has-cursor');

    // 從畫面中央開始，第一次移動才不會從角落飛過來
    var x = window.innerWidth / 2;
    var y = window.innerHeight / 2;
    var tx = x;
    var ty = y;
    var seen = false;

    window.addEventListener('mousemove', function (e) {
      tx = e.clientX;
      ty = e.clientY;
      if (!seen) {
        // 第一次知道滑鼠在哪：直接對位，不要從中央滑過去
        seen = true;
        x = tx;
        y = ty;
        root.style.opacity = '1';
      }
    }, { passive: true });

    root.style.opacity = '0';

    var tick = function () {
      x += (tx - x) * ease;
      y += (ty - y) * ease;
      root.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    /* 放大與標籤。用事件委派而不是逐一綁 —— 內頁的圖片、上下篇、頁尾連結
       都算，逐一綁會漏掉之後才進 DOM 的東西。 */
    var HOT = 'a, button, summary, [role="button"], .thumbnail, [data-cursor]';

    var enter = function (el) {
      var text = el.getAttribute('data-cursor');
      root.classList.add('is-hover');
      if (text) {
        label.textContent = text;
        root.classList.add('has-label');
      }
    };
    var leave = function () {
      root.classList.remove('is-hover', 'has-label');
    };

    document.addEventListener('mouseover', function (e) {
      var el = e.target.closest && e.target.closest(HOT);
      if (el) enter(el);
    }, { passive: true });

    document.addEventListener('mouseout', function (e) {
      var el = e.target.closest && e.target.closest(HOT);
      if (!el) return;
      // 移到同一個熱區裡的子元素不算離開
      var to = e.relatedTarget;
      if (to && to.closest && to.closest(HOT) === el) return;
      leave();
    }, { passive: true });

    // 滑出視窗就把游標藏起來，不然會卡在邊緣
    document.addEventListener('mouseleave', function () { root.style.opacity = '0'; });
    document.addEventListener('mouseenter', function () { root.style.opacity = '1'; });
  })();

  /* ------------------------------------------------------------------------
     只播放畫面內的影片
     首頁網格有 20 支自動循環的影片，全部同時解碼會讓瀏覽器（尤其手機）
     很吃力。捲出畫面就暫停，捲回來再播。暫停時 poster 不會重新出現，
     所以視覺上看不出被停過。
     ---------------------------------------------------------------------- */
  var videos = document.querySelectorAll('video[autoplay]');
  if (videos.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var v = entry.target;
        if (entry.isIntersecting) {
          // play() 回傳 Promise，被瀏覽器政策拒絕時要吞掉避免 console 噴錯
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else if (!v.paused) {
          v.pause();
        }
      });
    }, { rootMargin: '200px 0px' });

    for (var j = 0; j < videos.length; j++) io.observe(videos[j]);
  }
})();
