import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

function githubPagesBase() {
  const [owner = '', repository = ''] = (process.env.GITHUB_REPOSITORY || '').split('/');
  if (!repository || repository.toLowerCase() === `${owner.toLowerCase()}.github.io`) return '/';
  return `/${repository}/`;
}

export default defineConfig(({ command }) => {
  if (command === 'build' && process.env.GITHUB_ACTIONS === 'true' && !process.env.VITE_API_BASE_URL?.trim()) {
    throw new Error('The API Worker deployment did not provide its URL.');
  }

  return {
    root: fileURLToPath(new URL('./github-pages', import.meta.url)),
    base: githubPagesBase(),
    publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    plugins: [react()],
    css: { postcss: { plugins: [tailwindcss()] } },
    resolve: {
      alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    build: {
      outDir: fileURLToPath(new URL('./dist-pages', import.meta.url)),
      emptyOutDir: true,
    },
  };
});
