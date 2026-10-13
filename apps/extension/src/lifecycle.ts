export interface PanelResources {
  clearText(): void;
  disposeOperations(): void;
  clearAuthentication(): void;
  notifyClosed(): void;
}

export class PanelLifecycle {
  closed = false;
  private readonly resources: PanelResources;
  constructor(resources: PanelResources) { this.resources = resources; }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.resources.disposeOperations();
    this.resources.clearAuthentication();
    this.resources.clearText();
    this.resources.notifyClosed();
  }
}

type BrowserLifecycle = {
  windows?: { getCurrent(): Promise<{ id?: number }> };
  sidePanel?: { onClosed?: { addListener(listener: (info: { windowId: number }) => void): void; removeListener(listener: (info: { windowId: number }) => void): void } };
};

export async function observePanelClose(close: () => void): Promise<() => void> {
  const browser = globalThis as typeof globalThis & { chrome?: BrowserLifecycle; browser?: BrowserLifecycle };
  const api = browser.browser ?? browser.chrome;
  const event = api?.sidePanel?.onClosed;
  if (!event || !api?.windows) return () => {};
  const window = await api.windows.getCurrent();
  const listener = (info: { windowId: number }) => { if (info.windowId === window.id) close(); };
  event.addListener(listener);
  return () => event.removeListener(listener);
}
