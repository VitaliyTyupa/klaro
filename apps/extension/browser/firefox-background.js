// This adapter owns activation only; session resources belong to the sidebar document.
browser.action.onClicked.addListener(() => { browser.sidebarAction.open().catch(() => {}); });
browser.commands.onCommand.addListener(command => {
  if (command === 'open-klaro') browser.sidebarAction.open().catch(() => {});
});
