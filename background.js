// Service worker. Two jobs:
//   1. Clicking the toolbar icon opens the Doomstack page in a tab.
//   2. Let the three sites load inside that tab's frames. They normally send
//      headers that forbid being framed; we strip those headers, but only for
//      frames inside a Doomstack tab, never for normal browsing.

const FEED_DOMAINS = ['tiktok.com', 'instagram.com', 'youtube.com'];
const PAGE_URL = chrome.runtime.getURL('index.html');

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: PAGE_URL });
});

// One session rule per Doomstack tab, using the tab id as the rule id.
function allowFramingInTab(tabId) {
  return chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [
      {
        id: tabId,
        priority: 1,
        condition: {
          tabIds: [tabId],
          resourceTypes: ['sub_frame'],
          requestDomains: FEED_DOMAINS,
        },
        action: {
          type: 'modifyHeaders',
          // Instagram serves "Reel isn't available" when it sees it is being
          // loaded into a frame, so present the request as a normal page load.
          requestHeaders: [
            { header: 'sec-fetch-dest', operation: 'set', value: 'document' },
            { header: 'sec-fetch-site', operation: 'set', value: 'none' },
          ],
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' },
          ],
        },
      },
    ],
  });
}

// The page asks for this before it loads its frames.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'allow-framing') return;
  if (!sender.tab || !sender.url?.startsWith(PAGE_URL)) return;
  allowFramingInTab(sender.tab.id).then(
    () => sendResponse({ ok: true }),
    (error) => sendResponse({ ok: false, error: String(error) })
  );
  return true; // keep the channel open for the async response
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
});
