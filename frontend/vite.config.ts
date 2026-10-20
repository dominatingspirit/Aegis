import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The C++ backend (cpp-httplib) enables CORS, so the browser calls it directly.
// Override the target with VITE_API_URL (see src/api/aegisClient.ts).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
