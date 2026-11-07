const loopbackHosts = new Set(['localhost', '127.0.0.1', '127.0.0.2', '127.0.0.3']);

const portalHostForPath = (pathname: string) => {
  if (/^\/(sales|agent)(\/|$)/.test(pathname)) {
    return import.meta.env.VITE_SALES_PORTAL_HOST || '127.0.0.2';
  }
  if (/^\/factory(\/|$)/.test(pathname)) {
    return import.meta.env.VITE_FACTORY_PORTAL_HOST || '127.0.0.3';
  }
  if (/^\/(manager|admin)(\/|$)/.test(pathname) || pathname === '/' || pathname === '/login') {
    return import.meta.env.VITE_MANAGER_PORTAL_HOST || '127.0.0.1';
  }
  return null;
};

export const canonicalPortalUrl = (pathname: string) => {
  if (!loopbackHosts.has(window.location.hostname)) return null;
  const hostname = portalHostForPath(pathname);
  if (!hostname || hostname === window.location.hostname) return null;

  const url = new URL(window.location.href);
  url.hostname = hostname;
  url.pathname = pathname;
  return url.toString();
};

