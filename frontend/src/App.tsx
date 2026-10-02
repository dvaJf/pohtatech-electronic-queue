import { lazy, Suspense, MouseEvent, ReactNode, useEffect, useState } from 'react';
import { checkHealth } from './api/health';
import { ClientPage } from './pages/ClientPage';
const OperatorPage = lazy(() => import('./pages/OperatorPage').then(module => ({ default: module.OperatorPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(module => ({ default: module.AdminPage })));
const PochtaDemo = lazy(() => import('./PochtaDemo'));
import { AuthBoundary } from './features/auth/AuthBoundary';
import './product.css';
import { PhysicalQRPage } from './pages/PhysicalQRPage';
import { ProductHeader } from './components/common/ProductHeader';
import { ClientQueueBoard } from './features/client/ClientQueueBoard';
import { TVBoard } from './features/client/TVBoard';
import { AIAssistantWidget } from './features/chat/AIAssistantWidget';
import { FAQPage } from './pages/FAQPage';
import { ProductFooter } from './components/common/ProductFooter';

export function App() {
  const [health, setHealth] = useState<'Checking...' | 'Available' | 'Unavailable'>('Checking...');
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const onLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', onLocationChange);
    return () => window.removeEventListener('popstate', onLocationChange);
  }, []);

  useEffect(() => {
    const kiosk = currentPath.startsWith('/kiosk/') || new URLSearchParams(window.location.search).get('kiosk') === '1';
    document.documentElement.classList.toggle('kiosk-mode', kiosk);
    return () => document.documentElement.classList.remove('kiosk-mode');
  }, [currentPath]);

  const navigate = (to: string, event?: MouseEvent<HTMLAnchorElement>) => {
    if (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
    }
    if (window.location.pathname !== to) {
      window.history.pushState({}, '', to);
      setCurrentPath(to);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    checkHealth(controller.signal)
      .then(() => { if (active) setHealth('Available'); })
      .catch(() => { if (active) setHealth('Unavailable'); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, []);

  const tvMatch = currentPath.match(/^\/tv\/([^/?#]+)/);
  if (currentPath === '/tv' || currentPath === '/tv/' || currentPath.startsWith('/tv/') || currentPath.startsWith('/tv?')) {
    const branchIdFromPath = tvMatch ? decodeURIComponent(tvMatch[1]) : undefined;
    return <TVBoard branchId={branchIdFromPath} />;
  }

  if (currentPath === '/demo' || currentPath.startsWith('/demo/')) {
    return <><p role="note" style={{ padding: '12px', textAlign: 'center' }}>Демонстрационный режим: часть показателей моделируется. <a href="/">Открыть реальный клиент</a></p><Suspense fallback={<p>Загрузка демонстрации…</p>}><PochtaDemo currentPath={currentPath} navigate={navigate} /></Suspense></>;
  }
  const routes: Array<{ path: string; label: string; page: ReactNode }> = [
    { path: '/tv', label: 'TV', page: <TVBoard /> },
    { path: '/tv/', label: 'TV', page: <TVBoard /> },
    ...(tvMatch ? [{ path: currentPath, label: 'TV', page: <TVBoard branchId={decodeURIComponent(tvMatch[1])} /> }] : []),
    ...(currentPath.startsWith('/q/') ? [{ path: currentPath, label: 'QR', page: <PhysicalQRPage key={currentPath} branchId={currentPath.slice(3)} kiosk={new URLSearchParams(window.location.search).get('kiosk') === '1'} /> }] : []),
    ...(currentPath.startsWith('/kiosk/') ? [{ path: currentPath, label: 'Kiosk', page: <PhysicalQRPage key={currentPath} branchId={currentPath.slice(7)} kiosk /> }] : []),
    { path: '/', label: 'Client', page: <ClientPage /> },
    { path: '/faq', label: 'FAQ', page: <FAQPage /> },
    { path: '/board', label: 'Board', page: <ClientQueueBoard onBack={() => navigate('/')} /> },
    { path: '/operator/login', label: 'Operator login', page: <AuthBoundary area="operator" loginPage><OperatorPage /></AuthBoundary> },
    { path: '/operator', label: 'Operator', page: <AuthBoundary area="operator" loginPage={false}><OperatorPage /></AuthBoundary> },
    { path: '/admin/login', label: 'Admin login', page: <AuthBoundary area="admin" loginPage><AdminPage /></AuthBoundary> },
    { path: '/admin', label: 'Admin', page: <AuthBoundary area="admin" loginPage={false}><AdminPage /></AuthBoundary> },
    { path: '/demo', label: 'Demo', page: <section><h2>Демо-режим</h2><p>Выберите рабочее место.</p><a href="/operator" onClick={(e) => navigate('/operator', e)}>Оператор</a>{' · '}<a href="/admin" onClick={(e) => navigate('/admin', e)}>Администратор</a></section> },
  ];
  const isKnownPath = routes.some((route) => route.path === currentPath);

  const activeRoute = routes.find((route) => route.path === currentPath);
  if (!isKnownPath || !activeRoute) return <main><h2>Page not found</h2></main>;

  return (
    <div className="product-shell min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans">
      <ProductHeader currentPath={currentPath} />
      <main id="main" className="flex-1 w-full max-w-7xl mx-auto px-4 pt-4 sm:pt-6 pb-20 sm:pb-32 lg:pb-40">
        <Suspense fallback={<p>Загрузка рабочего места…</p>}>{activeRoute.page}</Suspense>
      </main>
      {!currentPath.startsWith('/kiosk/') && <ProductFooter currentPath={currentPath} onNavigate={(path) => navigate(path)} />}
      <AIAssistantWidget />
    </div>
  );
}
