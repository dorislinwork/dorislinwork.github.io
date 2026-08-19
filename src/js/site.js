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
