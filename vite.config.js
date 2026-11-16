import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: process.env.GITHUB_ACTIONS === 'true' ? '/yichang-shanshui-between/' : '/', plugins: [react()], server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] }, build: { target: 'es2020', chunkSizeWarningLimit: 950 } });
