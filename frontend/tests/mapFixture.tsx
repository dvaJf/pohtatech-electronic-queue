import React from 'react';
import { createRoot } from 'react-dom/client';
import { BranchMapModal, type BranchMapModalProps } from '../src/features/client/map/BranchMapModal';
import '../src/design-system.css';
import '../src/product.css';
import '../src/tailwind.css';
import '../src/features/client/client.css';

type FixtureProps = Omit<BranchMapModalProps, 'onClose'>;
declare global {
  interface Window {
    __locationRequests: number;
    __renderMap: (next?: Partial<FixtureProps>) => void;
  }
}
const root = createRoot(document.getElementById('fixture')!);
let props: FixtureProps = {
  isOpen: false,
  branches: [
    { id: 'A', name: 'Первое отделение', address: 'г. Москва, ул. Мясницкая, д. 26', workHours: '08:00–22:00' },
    { id: 'B', name: 'Второе отделение', address: 'г. Москва, ул. Рождественка, д. 10/2', workHours: '08:00–20:00' },
  ],
  userCoordinates: null,
  locationCenterRequest: 0,
  selectedBranchId: null,
  initialFilter: 'all',
};
const render = (next: Partial<FixtureProps> = {}) => {
  props = { ...props, ...next };
  root.render(<BranchMapModal {...props} onClose={() => render({ isOpen: false })}
    onRequestLocation={() => { window.__locationRequests++; }} />);
};
window.__locationRequests = 0;
window.__renderMap = render;
render();
