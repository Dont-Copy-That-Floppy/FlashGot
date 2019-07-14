/***** BEGIN LICENSE BLOCK *****

    FlashGot - a Firefox extension for external download managers integration
    Copyright (C) 2004-2013 Giorgio Maone - g.maone@informaction.com

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program; if not, write to the Free Software
    Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
                             
***** END LICENSE BLOCK *****/

var DOM = {
  getDocShellFromWindow: function(window) {
    try {
      return window.QueryInterface(CI.nsIInterfaceRequestor)
                   .getInterface(CI.nsIWebNavigation)
                   .QueryInterface(CI.nsIDocShell);
    } catch(e) {
      return null;
    }
  },
  getChromeWindow: function(window) {
    try {
      return this.getDocShellFromWindow(window)
        .QueryInterface(CI.nsIDocShellTreeItem).rootTreeItem
        .QueryInterface(CI.nsIInterfaceRequestor)
        .getInterface(CI.nsIDOMWindow).top;
    } catch(e) {
      return null;
    }
  },
  
  get styleSheetService() {
    delete this.styleSheetService;
    const sssClass = CC["@mozilla.org/content/style-sheet-service;1"];
    return this.styleSheetService = sssClass && sssClass.getService(CI.nsIStyleSheetService);     
  },
  updateStyleSheet: function(sheet, enabled) {
    const sss = this.styleSheetService;
    if (!sss) return;
    
    const uri = IOS.newURI("data:text/css," + sheet, null, null);
    if (sss.sheetRegistered(uri, sss.USER_SHEET)) {
      if (!enabled) sss.unregisterSheet(uri, sss.USER_SHEET);
    } else {
      try {
        if (enabled) sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
      } catch(e) {
        dump("Error registering stylesheet " + uri + ": " + e + "\n"); 
      }
    }
  },
  
  get windowMediator() {
    delete this.windowMediator;
    return this.windowMediator = CC['@mozilla.org/appshell/window-mediator;1']
                  .getService(CI.nsIWindowMediator);
  },
  
  _winType: null,
  perWinType: function(delegate) {
    var wm = this.windowMediator;
    var w = null;
    var aa = Array.prototype.slice.call(arguments);
    for (var type of ['navigator:browser', 'emusic:window', 'Songbird:Main']) {
     aa[0] = type;
      w = delegate.apply(wm, aa);
      if (w) {
        this._winType = type;
        break;
      }
    }
    return w;
  },
  get mostRecentBrowserWindow() {
    var res = this._winType && this.windowMediator.getMostRecentWindow(this._winType, true);
    return res || this.perWinType(this.windowMediator.getMostRecentWindow, true);
  },
  get windowEnumerator() {
    var res = this._winType && this.windowMediator.getZOrderDOMWindowEnumerator(this._winType, true);
    return res || this.perWinType(this.windowMediator.getZOrderDOMWindowEnumerator, true);
  },
  
  findChannelWindow: function(channel) {
    for (var cb of [channel.notificationCallbacks,
                       channel.loadGroup && channel.loadGroup.notificationCallbacks]) {
      if (cb instanceof CI.nsIInterfaceRequestor) {

        if (CI.nsILoadContext) try {
        // For Gecko 1.9.1
          return cb.getInterface(CI.nsILoadContext).associatedWindow;
        } catch(e) {}
        
        try {
          // For Gecko 1.9.0
          return cb.getInterface(CI.nsIDOMWindow);
        } catch(e) {}
      }
    }
    return null;
  }
  
};