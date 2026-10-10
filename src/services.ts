// Which sidecars this installation runs, written into `/services.js` by the
// container's entrypoint out of the `ENABLE_*` keys in `.env`
// (`docs/architecture.md`). A *service* is deployed or not; a *feature* is
// granted to an account or not (`src/auth/features.ts`). `render` has both,
// and the service has the first word.

export type Service = 'flyfoto' | 'cvat' | 'render' | 'talk';

// What a development server with no `services.js` gets: the whole stack.
const DEFAULT_SERVICES: Record<Service, boolean> = {
  flyfoto: true,
  cvat: true,
  render: true,
  talk: true,
};

declare global {
  interface Window {
    __TUFTESEID_SERVICES__?: Partial<Record<Service, boolean>>;
  }
}

// A property of the deployment, so read once: nothing can change it while the
// page is up.
const SERVICES: Record<Service, boolean> = {
  ...DEFAULT_SERVICES,
  ...(typeof window !== 'undefined'
    ? (window.__TUFTESEID_SERVICES__ ?? {})
    : {}),
};

export const serviceOn = (service: Service): boolean => SERVICES[service];
