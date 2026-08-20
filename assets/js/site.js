/* ==========================================================================
   站台腳本
   目前只做一件事：在瀏覽器端組出信箱連結。
   HTML 裡寫 <a class="mailto" data-user="…" data-domain="…">，
   完整地址不出現在靜態原始碼裡，爬垃圾信的機器人抓不到。
   ========================================================================== */
(function () {
  'use strict';

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
