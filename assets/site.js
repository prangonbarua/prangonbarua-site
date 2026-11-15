/* Theme toggle, mobile menu and org popovers. Loaded with `defer` on every page. */
(function () {
  'use strict';

  var EASE_OUT = 'cubic-bezier(0, 0, 0.58, 1)';
  var EASE_IN = 'cubic-bezier(0.42, 0, 1, 1)';
  var root = document.documentElement;

  function animate(el, frames, opts) {
    if (!el.animate) return null;
    return el.animate(frames, opts);
  }

  // run fn once the animation ends (or right away when there is none)
  function after(anim, fn) {
    if (!anim) fn();
    else anim.onfinish = fn;
  }

  /* ---------------------------------------------------------------- */
  /* theme                                                             */
  /* ---------------------------------------------------------------- */

  function applyTheme(theme) {
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }

  function currentTheme() {
    return root.classList.contains('light') ? 'light' : 'dark';
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!t) return;
    var next = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch (err) {
      /* storage blocked: the choice lasts for this page only */
    }
  });

  // keep other open tabs in step
  window.addEventListener('storage', function (e) {
    if (e.key !== 'theme') return;
    applyTheme(e.newValue === 'light' ? 'light' : 'dark');
  });

  /* ---------------------------------------------------------------- */
  /* mobile pill and menu                                              */
  /* ---------------------------------------------------------------- */

  var DOTS =
    '<svg class="dots" viewBox="0 0 16 16"><circle cx="4" cy="4" r="1.5"></circle>' +
    '<circle cx="12" cy="4" r="1.5"></circle><circle cx="4" cy="12" r="1.5"></circle>' +
    '<circle cx="12" cy="12" r="1.5"></circle></svg>';
  var CROSS = '<svg class="cross" viewBox="0 0 16 16"><path d="M3 3L13 13M13 3L3 13"></path></svg>';

  function setupMenu(pill) {
    var btn = pill.querySelector('button');
    var box = pill.querySelector('[data-pill-icon]');
    var tpl = document.querySelector('template[data-menu]');
    if (!btn || !box || !tpl) return;

    var isOpen = false;
    var menu = null;
    var menuExit = null;
    var icon = box.firstElementChild;
    var iconLeaving = false;

    // icons swap one after the other: the old one leaves, then the new one enters
    function swapIcon() {
      if (iconLeaving) return;
      var leaving = icon;
      var spin = leaving && leaving.getAttribute('data-icon') === 'cross' ? 45 : -45;
      iconLeaving = true;
      var out = leaving
        ? animate(leaving, [{ opacity: 0, transform: 'rotate(' + spin + 'deg)' }], {
            duration: 180,
            easing: EASE_OUT,
            fill: 'forwards',
          })
        : null;
      after(out, function () {
        if (leaving) leaving.remove();
        iconLeaving = false;
        var kind = isOpen ? 'cross' : 'dots';
        var from = kind === 'cross' ? 45 : -45;
        icon = document.createElement('span');
        icon.setAttribute('data-icon', kind);
        icon.innerHTML = kind === 'cross' ? CROSS : DOTS;
        box.appendChild(icon);
        animate(
          icon,
          [
            { opacity: 0, transform: 'rotate(' + from + 'deg)' },
            { opacity: 1, transform: 'rotate(0deg)' },
          ],
          { duration: 180, easing: EASE_OUT }
        );
      });
    }

    function openMenu() {
      if (menu && menuExit) {
        // reopened mid-fade: bring the same overlay back from where it is
        var from = getComputedStyle(menu).opacity;
        menuExit.cancel();
        menuExit = null;
        animate(menu, [{ opacity: from }, { opacity: 1 }], { duration: 200, easing: EASE_OUT });
        return;
      }
      menu = tpl.content.firstElementChild.cloneNode(true);
      menu.addEventListener('click', function (e) {
        var link = e.target.closest('.menu-links a');
        if (!link) return;
        if (link.pathname === location.pathname && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
        }
        setOpen(false);
      });
      pill.after(menu);
      animate(menu, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT });
    }

    function closeMenu() {
      if (!menu) return;
      var leaving = menu;
      menuExit = animate(leaving, [{ opacity: 0 }], { duration: 200, easing: EASE_OUT, fill: 'forwards' });
      var anim = menuExit;
      after(anim, function () {
        if (menuExit !== anim && anim) return;
        leaving.remove();
        if (menu === leaving) menu = null;
        menuExit = null;
      });
    }

    function setOpen(next) {
      if (next === isOpen) return;
      isOpen = next;
      btn.setAttribute('aria-expanded', String(next));
      if (next) openMenu();
      else closeMenu();
      swapIcon();
    }

    btn.addEventListener('click', function () {
      setOpen(!isOpen);
    });
  }

  /* ---------------------------------------------------------------- */
  /* org popovers (desktop hero)                                       */
  /* ---------------------------------------------------------------- */

  function setupCite(wrap) {
    var btn = wrap.querySelector('button');
    var tpl = wrap.querySelector('template');
    if (!btn || !tpl) return;
    var isOpen = false;
    var openTimer = 0;
    var closeTimer = 0;
    var card = null;
    var cardExit = null;

    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }

    function showCard() {
      if (card && cardExit) {
        var from = getComputedStyle(card);
        var frame = { opacity: from.opacity, transform: from.transform };
        cardExit.cancel();
        cardExit = null;
        animate(card, [frame, { opacity: 1, transform: 'translateY(0px) scale(1)' }], {
          duration: 120,
          easing: EASE_OUT,
        });
        return;
      }
      card = document.createElement('span');
      card.className = 'card-pop';
      card.setAttribute('data-koi-ignore', '');
      card.appendChild(tpl.content.cloneNode(true));
      card.addEventListener('click', function () {
        setOpen(false);
      });
      wrap.appendChild(card);
      animate(
        card,
        [
          { opacity: 0, transform: 'translateY(4px) scale(0.98)' },
          { opacity: 1, transform: 'translateY(0px) scale(1)' },
        ],
        { duration: 120, easing: EASE_OUT }
      );
    }

    function hideCard() {
      if (!card) return;
      var leaving = card;
      var anim = animate(leaving, [{ opacity: 0, transform: 'translateY(2px) scale(0.99)' }], {
        duration: 80,
        easing: EASE_IN,
        fill: 'forwards',
      });
      cardExit = anim;
      after(anim, function () {
        if (anim && cardExit !== anim) return;
        leaving.remove();
        if (card === leaving) card = null;
        cardExit = null;
      });
    }

    function setOpen(next) {
      if (next === isOpen) return;
      isOpen = next;
      if (next) {
        wrap.setAttribute('data-cited-open', 'true');
        window.addEventListener('keydown', onKey);
        showCard();
      } else {
        wrap.removeAttribute('data-cited-open');
        window.removeEventListener('keydown', onKey);
        hideCard();
      }
    }

    function soonOpen() {
      clearTimeout(closeTimer);
      openTimer = setTimeout(function () {
        setOpen(true);
      }, 55);
    }

    function soonClose() {
      clearTimeout(openTimer);
      closeTimer = setTimeout(function () {
        setOpen(false);
      }, 30);
    }

    wrap.addEventListener('mouseenter', soonOpen);
    wrap.addEventListener('mouseleave', soonClose);
    btn.addEventListener('focus', soonOpen);
    btn.addEventListener('blur', soonClose);
    // no org has a page or site yet, so a click just closes the card
    btn.addEventListener('click', function () {
      setOpen(false);
    });
  }

  function boot() {
    // the longest entrance animation (hero prose) ends at 500ms
    setTimeout(function () {
      document.body.classList.add('fx-done');
    }, 1000);
    var pills = document.querySelectorAll('[data-pill]');
    for (var i = 0; i < pills.length; i++) setupMenu(pills[i]);
    var cites = document.querySelectorAll('[data-cite]');
    for (var j = 0; j < cites.length; j++) setupCite(cites[j]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
