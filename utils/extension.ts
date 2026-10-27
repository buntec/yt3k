/**
 * The host of this extension's own pages, which is what declarativeNetRequest's
 * initiatorDomains matches for its requests. In Chrome that's the extension ID,
 * but Firefox uses a per-install UUID that differs from browser.runtime.id.
 */
export function extensionHost(): string {
  return new URL(browser.runtime.getURL('/')).hostname;
}
