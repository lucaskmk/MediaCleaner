import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      base: './',
      define: {
        'process.env.APP_VERSION': JSON.stringify(pkg.version),
        'process.env.APP_NAME': JSON.stringify(pkg.build.productName)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});