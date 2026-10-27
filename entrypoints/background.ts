export default defineBackground(() => {
  // The toolbar button opens the yt3k page.
  browser.action.onClicked.addListener(() => {
    browser.tabs.create({ url: browser.runtime.getURL('/app.html') });
  });
});
