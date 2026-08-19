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
})();
