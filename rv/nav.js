/* rv/nav.js — shared header + footer injection for all rv/ pages */
(function () {
  // Compute base path back to rv/ from the script's own src attribute
  var src = (document.currentScript && document.currentScript.getAttribute('src')) || '';
  var base = src.replace(/nav\.js(\?.*)?$/, '');

  // Detect active nav link from the URL path
  var path = window.location.pathname;
  var active = '';
  if (/\/benchmarks(\/|$)/.test(path)) active = 'benchmarks';
  else if (/\/rv\/?$/.test(path) || /\/rv\/index\.html/.test(path)) active = 'blog';

  function navCls(key) {
    return 'nav-link' + (active === key ? ' active' : '');
  }

  var headerHTML =
    '<header class="site-header">' +
    '<div class="header-inner">' +
    '<a href="' + base + 'index.html" class="logo-link">' +
    '<img src="' + base + 'tri_mark.png" alt="TRI" class="logo-img">' +
    '<span class="logo-text"><span class="logo-tri">Requisite Variety</span></span>' +
    '</a>' +
    '<nav class="site-nav" aria-label="Main navigation">' +
    '<a href="' + base + 'index.html" class="' + navCls('blog') + '">Blog</a>' +
    '<a href="' + base + 'benchmarks/" class="' + navCls('benchmarks') + '">Benchmarks</a>' +
    '<a href="#" class="nav-link">Archive</a>' +
    '<a href="#" class="nav-link">About</a>' +
    '</nav>' +
    '</div>' +
    '</header>';

  var footerHTML =
    '<footer class="site-footer">' +
    '<div class="footer-inner">' +
    '<div class="footer-brand">' +
    '<img src="' + base + 'tri_mark.png" alt="TRI" style="width:24px;height:24px;">' +
    '<span>requisite variety</span>' +
    '<span class="footer-dot">\u00B7</span>' +
    '<span>2026</span>' +
    '</div>' +
    '<div class="footer-links">' +
    '<a href="#">GitHub</a>' +
    '<a href="#">RSS</a>' +
    '</div>' +
    '</div>' +
    '<div class="footer-circuit" aria-hidden="true">' +
    '<svg width="100%" height="2">' +
    '<line x1="0" y1="1" x2="100%" y2="1" stroke="var(--color-border)" stroke-width="1" stroke-dasharray="8 4"/>' +
    '</svg>' +
    '</div>' +
    '</footer>';

  document.addEventListener('DOMContentLoaded', function () {
    // Insert header after the circuit-bg SVG, or at start of body
    var circuit = document.querySelector('.circuit-bg');
    if (circuit) {
      circuit.insertAdjacentHTML('afterend', headerHTML);
    } else {
      document.body.insertAdjacentHTML('afterbegin', headerHTML);
    }

    // Append footer at end of body
    document.body.insertAdjacentHTML('beforeend', footerHTML);
  });
})();
