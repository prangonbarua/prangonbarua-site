/* Desktop projects strip: vertical wheel, drag and arrow keys scroll it sideways. */
(function () {
  'use strict';

  var STEPS = {
    ArrowRight: 0.1,
    ArrowDown: 0.1,
    ArrowLeft: -0.1,
    ArrowUp: -0.1,
    PageDown: 0.8,
    PageUp: -0.8,
    ' ': 0.8,
    End: Infinity,
    Home: -Infinity,
  };

  function boot() {
    var strip = document.querySelector('[data-strip]');
    if (!strip) return;
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var wide = window.matchMedia('(min-width: 1024px)');

    var target = strip.scrollLeft;
    var raf = 0;

    function ease() {
      var at = strip.scrollLeft;
      strip.scrollLeft += (target - at) * 0.18;
      if (strip.scrollLeft === at) {
        strip.scrollLeft = target;
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(ease);
    }

    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    }

    function scrollByDelta(delta) {
      var max = strip.scrollWidth - strip.clientWidth;
      target = Math.max(0, Math.min(max, (raf ? target : strip.scrollLeft) + delta));
      if (still) strip.scrollLeft = target;
      else if (!raf) raf = requestAnimationFrame(ease);
    }

    window.addEventListener(
      'wheel',
      function (e) {
        if (!wide.matches) return;
        var sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        if (sideways && strip.contains(e.target)) {
          // a trackpad swipe over the strip scrolls it natively
          stop();
          return;
        }
        e.preventDefault();
        var d = sideways ? e.deltaX : e.deltaY;
        scrollByDelta(e.deltaMode === 1 ? 16 * d : d);
      },
      { passive: false }
    );

    // one-finger vertical drags scroll the strip sideways
    var touch = null;
    var vertical;
    window.addEventListener(
      'touchstart',
      function (e) {
        stop();
        touch = null;
        vertical = undefined;
        if (!wide.matches || e.touches.length !== 1) return;
        var t = e.touches[0];
        touch = { x: t.clientX, y: t.clientY, left: strip.scrollLeft, lastY: t.clientY, time: e.timeStamp, speed: 0 };
      },
      { passive: true }
    );

    window.addEventListener(
      'touchmove',
      function (e) {
        if (!touch) return;
        var t = e.touches[0];
        if (vertical === undefined) {
          if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) < 6) return;
          vertical = Math.abs(t.clientY - touch.y) > Math.abs(t.clientX - touch.x);
        }
        if (!vertical) return;
        e.preventDefault();
        strip.scrollLeft = touch.left + touch.y - t.clientY;
        var dt = e.timeStamp - touch.time;
        if (dt > 0) touch.speed = (touch.lastY - t.clientY) / dt;
        touch.lastY = t.clientY;
        touch.time = e.timeStamp;
      },
      { passive: false }
    );

    function endTouch(e) {
      if (touch && vertical && !still && e.timeStamp - touch.time < 100) {
        scrollByDelta(touch.speed * (1000 / 60 / 0.18));
      }
      touch = null;
    }
    window.addEventListener('touchend', endTouch);
    window.addEventListener('touchcancel', endTouch);

    window.addEventListener('keydown', function (e) {
      var step = STEPS[e.key];
      if (!wide.matches || step === undefined || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === ' ' && e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      scrollByDelta((e.key === ' ' && e.shiftKey ? -step : step) * strip.clientWidth);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
