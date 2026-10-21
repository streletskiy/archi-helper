// Windows can apply STARTUPINFO's hidden launch flag to the first ShowWindow
// call, even when Electron explicitly requests a visible window. A second
// native show after hiding clears that inherited installer launch state.
export function showAppWindow(win) {
  if(!win||win.isDestroyed())return false;
  if(win.isMinimized())win.restore();
  win.show();
  if(!win.isVisible()) {
    win.hide();
    win.show();
  }
  win.focus();
  return win.isVisible();
}
