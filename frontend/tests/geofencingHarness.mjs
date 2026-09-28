import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export async function mountGeofencing(geolocation, permission = 'prompt') {
  const slots = [];
  let index = 0;
  let pending = [];
  const hooks = {
    useState(initial) {
      const slot = index++;
      slots[slot] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[slot].value, value => { slots[slot].value = typeof value === 'function' ? value(slots[slot].value) : value; }];
    },
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial }; },
    useMemo(fn) { index++; return fn(); },
    useCallback(fn, deps) {
      const slot = index++;
      if (!slots[slot] || deps.some((dep, i) => dep !== slots[slot].deps[i])) slots[slot] = { value: fn, deps };
      return slots[slot].value;
    },
    useEffect(fn, deps) {
      const slot = index++;
      if (!slots[slot] || deps.some((dep, i) => dep !== slots[slot].deps[i])) {
        pending.push(() => { slots[slot]?.cleanup?.(); slots[slot] = { deps, cleanup: fn() }; });
      }
    },
  };
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindow = globalThis.window;
  globalThis.window = {};
  const navigatorValue = { geolocation };
  if (permission !== 'unavailable') {
    navigatorValue.permissions = {
      query: typeof permission === 'function' ? permission : async () => ({ state: permission }),
    };
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorValue });
  globalThis.__geofenceHooks = hooks;
  const moduleUrl = async path => {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
  };
  let source = await readFile(new URL('../src/features/client/arrival/useGeofencing.ts', import.meta.url), 'utf8');
  source = source.replace(/import.*from 'react';/, 'const { useState, useEffect, useMemo, useCallback, useRef } = globalThis.__geofenceHooks;');
  source = source.replace(/import.*from '..\/map\/branchLocations';/, 'const MOSCOW_BRANCHES = [];');
  source = source.replace("'./arrivalPolicy'", JSON.stringify(await moduleUrl('../src/features/client/arrival/arrivalPolicy.ts')));
  source = source.replace("'../map/geolocation'", JSON.stringify(await moduleUrl('../src/features/client/map/geolocation.ts')));
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { useGeofencing } = await import('data:text/javascript;base64,' + Buffer.from(js + '\n// ' + Math.random()).toString('base64'));
  return {
    render() {
      index = 0;
      const result = useGeofencing({ branches: [{ id: 'A', lat: 55.7, lng: 37.6 }], thresholdMeters: 75 });
      const effects = pending; pending = []; effects.forEach(effect => effect());
      return result;
    },
    unmount() {
      slots.forEach(slot => slot?.cleanup?.());
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else delete globalThis.navigator;
      globalThis.window = originalWindow;
      delete globalThis.__geofenceHooks;
    },
  };
}
