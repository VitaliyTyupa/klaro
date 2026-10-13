// The worker owns activation only. Text, authentication and sockets belong to the panel document.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-klaro' || tab?.windowId === undefined) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});
