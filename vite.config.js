import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: process.env.DEPLOY_BASE_PATH || '/', plugins: [react()], server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] }, build: { target: 'es2020', chunkSizeWarningLimit: 950 } });
