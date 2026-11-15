(() => {
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const btn = document.querySelector('.theme');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = root.dataset.theme || (dark.matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
  });
})();
