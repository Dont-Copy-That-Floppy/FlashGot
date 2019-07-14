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

var gFlashGotService = Components.classes["@maone.net/flashgot-service;1"].getService().wrappedJSObject;
   
var flashgotUtil = {
  browse: function(url, feature) {
    var w = gFlashGotService.dom.mostRecentBrowserWindow;
    if(w && !w.closed) {
      var browser = w.getBrowser();
      browser.selectedTab = browser.addTab(url);
    } else {
      window.open(url, "_blank", features || null)
    }
  }
};
