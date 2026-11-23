import { Router, type Request, type Response } from 'express';
import { buildOpenApiSpec } from '../openapi.js';

export const docsRouter = Router();

const sendSpec = (_req: Request, res: Response) => {
  const spec = buildOpenApiSpec();
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(spec);
};

// JSON endpoints for OpenAPI / Swagger specifications
docsRouter.get('/openapi.json', sendSpec);
docsRouter.get('/swagger.json', sendSpec);

const renderSwaggerHtml = (req: Request, res: Response) => {
  // Relax CSP on the docs page so Swagger UI assets from unpkg load cleanly
  res.removeHeader('Content-Security-Policy');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; script-src 'self' 'unsafe-inline' https://unpkg.com;"
  );

  const expansion = req.query['expand'] === 'full' ? 'full' : 'list';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WallxErpApi — Interactive Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .topbar {
      display: none !important;
    }
    .custom-header {
      background: #111827;
      color: #ffffff;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .custom-header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .custom-header .badge {
      background: #2563eb;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      margin-left: 12px;
    }
    .custom-header .nav-links a {
      color: #93c5fd;
      text-decoration: none;
      font-size: 13px;
      margin-left: 16px;
      font-weight: 500;
    }
    .custom-header .nav-links a:hover {
      text-decoration: underline;
    }
    .swagger-ui .info {
      margin: 24px 0 20px 0;
    }
    .swagger-ui .opblock-tag {
      font-size: 18px;
      margin: 16px 0 8px 0;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 6px;
    }
  </style>
</head>
<body>
  <div class="custom-header">
    <div style="display:flex; align-items:center;">
      <h1>WallxErpApi</h1>
      <span class="badge">v1.0.0</span>
    </div>
    <div class="nav-links">
      <a href="/openapi.json" target="_blank">View Raw OpenAPI 3.1 JSON</a>
      <a href="/swagger.json" target="_blank">View Swagger JSON</a>
      <a href="/health" target="_blank">System Health</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        docExpansion: '${expansion}',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
};

// Mount Swagger interactive UI routes
docsRouter.get('/docs', renderSwaggerHtml);
docsRouter.get('/swagger', renderSwaggerHtml);
docsRouter.get('/api-docs', renderSwaggerHtml);
