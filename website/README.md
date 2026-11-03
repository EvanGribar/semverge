# Semverge marketing website

This directory builds the marketing homepage as static assets for Vercel. It is separate from the CLI, GitHub Action and operations runtime. The Stageshow scene uses React in the browser; its completed poster remains available if JavaScript is disabled.

For local development, run `npm ci` and `npm run dev` from this directory. `npm run build` produces `dist/`. A Vercel project should use `website` as its root directory; `vercel.json` specifies the build command, output directory and response headers. No serverless functions, environment variables or external services are needed by this site. The project has not been linked or deployed by this change; connecting a Git project and choosing a production domain are separate Vercel account operations.
