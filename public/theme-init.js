// Applies the stored theme before first paint to avoid a flash of the wrong
// one, the same way Astryx's root <Theme> marks <html> once React renders.
// Loaded as a classic script because extension pages disallow inline
// scripts; the theme control itself lives in entrypoints/app/theme.ts.
try {
  const theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  }
} catch {}
