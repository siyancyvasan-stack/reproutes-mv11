# Hostinger frontend deployment

This project does not require a Vercel project. Build the portals locally and
upload the generated `dist` contents to Hostinger.

The frontend build requires Node.js 20 or newer. This repository includes a
`.nvmrc` file; use Node 20/22 before running `npm install` or `npm run build`.

```bash
nvm use 20
node --version
```

## Sales portal

From the repository root:

```bash
cd sales
npm install
npm run build
```

Upload everything inside `sales/dist/` to the document root used by the Sales
site. The `.htaccess` file is copied automatically from `sales/public/`.

The production API settings must be present in `sales/.env` before building:

```env
VITE_API_URL=https://api.reproutes.com
VITE_TRACKING_SOCKET_URL=https://api.reproutes.com
```

If the Sales portal is served from the main domain, use:

```text
https://reproutes.com/sales/login
```

If it has its own Hostinger subdomain, use that domain's `/sales/login` path.

## Manager portal

```bash
cd manager
npm install
npm run build
```

Upload everything inside `manager/dist/` to the Manager document root. Use the
same API and Socket.IO values as Sales.

## Important

Do not upload the source folder or `node_modules`; upload only the contents of
the matching `dist` folder. After upload, clear browser cache or use a private
window. A refresh of `/sales/login` must return the React app instead of a 404;
the included `.htaccess` files provide that Apache fallback.
