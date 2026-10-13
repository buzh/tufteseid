export type Service = 'flyfoto' | 'cvat' | 'render';

const DEFAULT_SERVICES: Record<Service, boolean> = {
  flyfoto: true,
  cvat: true,
  render: true,
};

declare global {
  interface Window {
    __TUFTESEID_SERVICES__?: Partial<Record<Service, boolean>>;
  }
}

const SERVICES: Record<Service, boolean> = {
  ...DEFAULT_SERVICES,
  ...(typeof window !== 'undefined'
    ? (window.__TUFTESEID_SERVICES__ ?? {})
    : {}),
};

export const serviceOn = (service: Service): boolean => SERVICES[service];
