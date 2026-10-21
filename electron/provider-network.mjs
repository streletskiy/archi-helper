// Desktop requests use Chromium's system proxy support. Keeping the transport
// injectable also lets protocol tests run without an Electron process.
let transport;
export function configureProviderFetch(fetcher) { transport=fetcher; }
export function providerFetch(input,init) { return (transport||globalThis.fetch)(input,init); }
