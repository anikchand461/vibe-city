import { defineConfig } from 'vite';

// On Vercel, api/*.js run as serverless functions. In `npm run dev` this
// serves the same handlers, so the live newspaper works locally too.
const devApi = {
  name: 'dev-api',
  configureServer(server) {
    server.middlewares.use('/api/news', async (req, res) => {
      const { default: handler } = await server.ssrLoadModule('/api/news.js');
      await handler(req, res);
    });
  },
};

export default defineConfig({
  plugins: [devApi],
});
