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

var gFlashGot = {
  _current_url: null,

  onload: function(ev) {
    ev.currentTarget.removeEventListener(ev.type, arguments.callee, false);
    try {
      gFlashGot.init();
      
      if (!gFlashGotService._initialized) window.setTimeout(function() { gFlashGotService.init(); }, 500);
      
    } catch(e) {
      dump("FlashGot init error: " + e.message);
      gFlashGot.log("Unrecoverable init error: " + e.message + " --- " + e.stack);
    }
  },
  
  
  hoverElement: null,
  
  _isContentEvent: function(ev) {
    var d = ev.originalTarget.ownerDocument;
    return d && d.defaultView && d.defaultView.top == window.content;
  },
  
  init: function() {
    if(!gFlashGotService) throw new Error("FlashGotService not registered!");
    
    gFlashGotService.dom._winType = document.documentElement.getAttribute("windowtype");
    
    // install listeners
    gFlashGot.mouseDown = null;
    var target = window.gBrowser || window;
    
    if (target.tabContainer) {
        target.tabContainer.addEventListener("TabSelect", this.updateMediaStatus, false);
    }
    
    window.addEventListener("activate", this.updateMediaStatus, false);
    
    target.addEventListener("load", this.updateMediaStatus, true);
    
    target.addEventListener("mousedown", function(ev) {
      if (gFlashGot.mouseDown) {
        if (gFlashGot.mouseDown.gesture === 1) {
          gFlashGotService.cursor(false);
        }
        gFlashGot.mouseDown = null;
      }
      
      if (ev.button > 1 ||
          ev.button === 1 && !gFlashGotService.getPref("gesture") ||
          !gFlashGot._isContentEvent(ev)
          ) {
        return;
      }
      
      gFlashGot.mouseDown = {
        x: ev.screenX,
        y: ev.screenY,
        gesture: ev.button === 1 ? 0 : -1,
        lastY: ev.screenY
      };
      gFlashGot.hoverElement = ev.originalTarget;
    }, false);
    
    target.addEventListener("mousemove", function(ev) {
      const md = gFlashGot.mouseDown;
      if (!md) return;
      
      switch(md.gesture) {
        case -1: // aborted
          return;
        case 0: // yet to be started
          if (Math.sqrt(Math.pow(ev.screenX - md.x, 2) + Math.pow(ev.screenY - md.y, 2)) < 12)
            break; // too near
          if (gFlashGot.isSelInvalid && !gFlashGot.currentLink) {
            md.gesture = -1;
            break;
          }
        case 1: // ongoing gesture
          var sy = ev.screenY;
          var dy = sy - md.lastY;
          md.lastY = sy;
          if (dy < 0 || Math.abs(ev.screenX - md.x) / (ev.screenY - md.y) > .25 ||
              !gFlashGot._isContentEvent(ev)) {
            // raising back or not south, abort
            if (md.gesture === 1) gFlashGotService.cursor(false);
            md.gesture = -1;
          } else if (md.gesture === 0) {
            md.gesture = 1;
            if (gFlashGotService.getPref("gesture.feedback")) gFlashGotService.cursor(true);
          }
      }
    }, false);
    
    target.addEventListener("mouseover", function(ev) {
      if (!gFlashGot.mouseDown) gFlashGot.hoverElement = ev.originalTarget;
    }, false);
    
    target.addEventListener("submit", function(ev) {
      if (!gFlashGot._isContentEvent(ev)) return;
      var f = ev.originalTarget;
      if(/#FlashGot_form$/.test(f.action) || 
          f.ownerDocument.defaultView.location.hash == "#FlashGot_Form")
        gFlashGotService.interceptor.forceAutoStart = true;
    }, false);

    target.addEventListener("mouseup", function(ev) {
      const md = gFlashGot.mouseDown;
      const button = ev.button;
      gFlashGot.mouseDown = null;
      
      var gesture = md && md.gesture === 1;
      if (gesture) {
        gFlashGotService.cursor(false);
      }
      
      if (!(button <= 1 && gFlashGot._isContentEvent(ev) && gFlashGotService.interceptor)
          || ev.ctrlKey || ev.metaKey)
        return;
      
      gFlashGotService.interceptor.bypassAutoStart = false;
      gFlashGotService.interceptor.forceAutoStart = false;
      
      if (gesture || button === 0 && ev.altKey) {
        function prevent() {
          ev.preventDefault();
          ev.stopPropagation();
          gFlashGot.lastClickCaptureTime = Date.now();
        }
        
        if (button === 0) {
          var invert = gFlashGotService.getPref("invertAltShiftClick", false);
          if((ev.shiftKey && !invert) || (invert && !ev.shiftKey)) {
            gFlashGotService.interceptor.bypassAutoStart =
              gFlashGotService.getPref("bypassCombo", true);
            return;
          }
        }
        
        if(gFlashGotService.getPref(button === 0 ? "altClick" : "gesture")) {
          try {
            if(gFlashGot.download()) {
              prevent();
              return;
            }
            if (button !== 0) return;
          } catch(ex) {}
          gFlashGotService.interceptor.forceAutoStart = true;
        } else {
          return;
        }
        
        ev2 = ev.view.document.createEvent("MouseEvents");
        ev2.initMouseEvent("click", ev.canBubble, ev.cancelable, 
                           ev.view, ev.detail, ev.screenX, ev.screenY, 
                           ev.clientX, ev.clientY, 
                           //ev.ctrlKey, ev.altKey, ev.shiftKey, ev.metaKey,
                           false,false,false,false,
                           ev.button, ev.relatedTarget);
        prevent();
        gFlashGot.hoverElement.dispatchEvent(ev2);
      }
    }, true);
    
    target.addEventListener("click", function(ev) {
      if(ev.altKey && ev.originalTarget.ownerDocument != document &&
        typeof(gFlashGot.lastClickCaptureTime) == "number" && 
        Date.now() - gFlashGot.lastClickCaptureTime < 100
      ) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    }, true);
    
    
    this.contextMenu.addEventListener("popupshowing", function(ev) {
        if(this == ev.explicitOriginalTarget) {
          gFlashGot.prepareContextMenu(ev);
        }
      },false);
    this.contextMenu.addEventListener("popuphidden", function(ev) {
        if(this == ev.explicitOriginalTarget) {
          gFlashGot.disposeContextMenu(ev);
        }
    }, false);
    
    
    window.setTimeout(function() {
      gFlashGotService.checkVersion();
      gFlashGot.toggleMainMenuIcon();
    }, 500);
  }

, 
  log: function(msg) {
    gFlashGotService.log(msg);
  }
,
  get contextMenu() {
    var cm =
        document.getElementById("contentAreaContextMenu") ||
        document.getElementById("mailContext") || // TB3
        document.getElementById("messagePaneContext"); // TB2 
    if (cm) {
      delete this.contextMenu;
      this.contextMenu = cm;
    }
    return cm;
  }
,
  switchOption: function(opt) {
    gFlashGotService.setPref(opt, !gFlashGotService.getPref(opt));
  }
,
  openOptionsDialog: function(tab) {
     window.openDialog(
        "chrome://flashgot/content/flashgotOptions.xul",
        "flashgotOptions",
        "chrome, dialog, centerscreen, alwaysRaised",
        arguments.length ? {tabselIndexes:  [tab || 0]} : null);  
  }
,
  openAboutDialog: function() {
    window.open("chrome://flashgot/content/about.xul", "flashgotAbout",
      "chrome,dialog,centerscreen");
  }
,
  browse: function(url) {
    var browser =  window.getBrowser();
    browser.selectedTab = browser.addTab(url);
  }
,
  browseHomePage: function() {
    this.browse("https://flashgot.net");
  }
,
  get hideIcons() {
    return gFlashGotService.getPref("hide-icons", false);
  }
,
  toggleIcon: function(m, hide) {
    if(!m) return;
    const iconicClass = m.tagName + "-iconic";
    const rx=new RegExp("\\b"+iconicClass+"\\b");
    if(hide) {
      m.className=m.className.replace(rx, "").replace(/\bflashgot-icon-(\w+)\b/,'flashgot-noicon-$1');
    } else {
      const cl=m.className;
      if(!rx.test(cl)) {
        m.className=cl.replace(/\bflashgot-noicon-(\w+)\b/,'flashgot-icon-$1')+" "+iconicClass;
      }
    }
  }
,
  toggleMainMenuIcon: function() {
    this.toggleIcon(document.getElementById("flashgot-menu"), this.hideIcons);
  }
,
  prepareToolsMenu: function(ev) {
    
    function toggleMenu(id,disabled) {
      id = "flashgot-main-menuitem-" + id;
      var m = document.getElementById(id);
      if(!m) return;
      m.setAttribute("disabled", disabled);
      gFlashGot.toggleIcon(m, hideIcons);
    }
    
    
    
    if(gFlashGotService && !(document.getElementById("flashgot-menu").hidden = gFlashGotService.getPref("hide-menu"))) {
      const dis = false; // !gFlashGotService.DMS.found; // can never be since we implemented built-in
      const hideIcons = this.hideIcons;
      this.updateMediaUI();
      
      toggleMenu("tabs", dis || !this.isTabbed); 
      toggleMenu("all", dis);
      toggleMenu("sel", dis || this.isSelInvalid);
      toggleMenu("buildGallery", false);
      const media = this.media;
      toggleMenu("media", dis || !(media && media.length));
      toggleMenu("opts", false);      
    }
  }
,
 
  prepareContextMenu: function(ev) {
    this.toggleMainMenuIcon();
    
    const fg = gFlashGotService;
    var menuCount = 0;
   
    function menuSwitch(name, disabled) {
      
      var menuItem = document.getElementById("flashgot-menuitem-" + name);
      
      if(menuItem && 
        !(menuItem.hidden = 
            (hidden || gFlashGotService.getPref("hide-" + name)))
      ) {
       menuItem.setAttribute("disabled", disabled ? "true" : "false");
       if(! (menuItem.hidden=disabled && hideDisabled) ) {
         menuCount++;
       }
       gFlashGot.toggleIcon(menuItem, hideIcons);
      }
    }
    
    var menuItem = null;
    const defaultDM = fg.defaultDM;  
    const dms = fg.hasDMS ? fg.DMS : null;
    var dm = dms && (dms.found ? dms[defaultDM] : null) || {hideNativeUI: function() {}};
    
    const invalidLink = !this.popupLink;   
    const invalidSel = this.isSelInvalid;
    
    const noLink = this.linksCount == 0;
    const hideDisabled = fg.getPref("hideDisabledCmds");
   
    var hidden = !dm;
    const hideIcons = this.hideIcons;
    
    var hideLink = invalidLink || hidden || dm.disabledLink;
    var hideSel = invalidSel || hidden  || dm.disabledSel;
    
    
    this.updateMediaUI();
    
    menuSwitch("it",  hideLink);
    menuSwitch("sel", hideSel);
    menuSwitch("all", noLink || hidden || dm.disabledAll);
    menuSwitch("tabs", (! (typeof(gBrowser)=="object" 
      && gBrowser.browsers && gBrowser.browsers.length > 1) ) 
                           || hidden || dm.disabledAll);
    
    const media = this.media;
    menuSwitch("media", hidden || !(media && media.length));

    hidden = false;
    menuSwitch("buildGallery", false);
    
    const optsMenu = document.getElementById("flashgot-menu-options");
    this.toggleIcon(optsMenu,hideIcons);
    if(!(optsMenu.hidden = gFlashGotService.getPref("hide-options"))) {
      menuCount++;
    }
    
    const submenu = document.getElementById("flashgot-submenu");
    this.toggleIcon(submenu, hideIcons);
    const subanchor = document.getElementById("flashgot-submenu-anchor");
    const subpop = subanchor.parentNode;
    const sep1 = document.getElementById("flashgot-context-separator");
    const sep2 = document.getElementById("flashgot-context-separator2");
    const menu = sep1.parentNode;
    var next = null;
    
    const nested = fg.getPref("nested-menu") && (menuCount > 1);
    submenu.hidden = !nested;
    if(nested) {
      menuCount=0;
      if(!subanchor.nextSibling) {
        menuItem = document.getElementById("flashgot-menuitem-tabs");
        if (menuItem)
            menuItem.setAttribute("accesskey",
                document.getElementById("flashgot-main-menuitem-tabs").getAttribute("accesskey"));
        for(menuItem = sep1.nextSibling;
            menuItem && (menuItem != sep2); 
            menuItem = next) {
          next = menuItem.nextSibling;
          subpop.appendChild(menuItem);
        }
      }
    } else {
      menuItem = document.getElementById("flashgot-menuitem-tabs");
      if (menuItem) menuItem.removeAttribute("accesskey");
      for(menuItem = subanchor.nextSibling; menuItem; menuItem = next) {
        next = menuItem.nextSibling;
        menu.insertBefore(menuItem, sep2);
      }
    }
    sep1.hidden = menuCount == 0;
    
    if (!fg.hasDMS) {
      ev.target.addEventListener("popupshown", function shown(ev) {
        ev.currentTarget.removeEventListener(ev.type, shown, false);
        if (fg.DMS) gFlashGot.prepareContextMenu(ev);
      }, false);
    } else {
      fg.restoreNativeUIs(document);
      dm.hideNativeUI(document);
      this.prepareCommandsMenu(document.getElementById("flashgot-menuitem-it"), hideLink && hideSel);
    }
    
  }
,
  disposeContextMenu: function(ev) {
    gFlashGotService.restoreNativeUIs(document);
  },
  prepareCommandsMenu: function(anchorNode, hideOnly) {
    var node, parentNode = anchorNode.parentNode;
    
    var cmi = (parentNode.getElementsByClassName && parentNode.getElementsByClassName("flashgot-command-menuitem")
               || parentNode.getElementsByTagName("menuitem"));
    
    var j, len;
    
    for(j = cmi.length; j-- > 0;) 
      if (/^flashgot-command-mi-/.test(cmi[j].id))
        parentNode.removeChild(cmi[j]);
    
    if(hideOnly) return;
    
    var mi, dm, id;
    const dms = gFlashGotService.DMS;
    for(j = 0, len = dms.length; j < len; j++) {
      dm = dms[j];
      if(dm.supported && dm.shownInContextMenu) {
        id =  "flashgot-command-mi-" + dm.codeName;
        if (!document.getElementById(id)) {
          mi = document.createElement("menuitem");
          mi.setAttribute("class", "menuitem-iconic flashgot-command-menuitem");
          mi.setAttribute("label", dm.name);
          mi.setAttribute("id", id);
          mi.setAttribute("oncommand", "gFlashGot.downloadSel(this.label) || gFlashGot.downloadLink(this.label)");
          parentNode.insertBefore(mi, anchorNode);
        }
        dm.hideNativeUI(document);
      }
    }
  },
  
  
  prepareOptsMenu: function(parentNode) {
   
    const opts = parentNode.getElementsByTagName("menuitem");
    
    this.toggleIcon(document.getElementById("flashgot-tbb-menuitem-opts"), this.hideIcons);
    
    var menuItem, id, match, lastMenu=null, isTBB=false;
    var j = opts.length;
    while(j-- > 0) {
      menuItem = opts[j];
      if((id=menuItem.id)) {
        if((match = id.match(/opt-(.*)/))) {
          menuItem.setAttribute("checked",
            gFlashGotService.getPref(match[1]) ? "true" : "false");
        } else if((match = id.match(/^flashgot-(\w+)-menuitem-nodms$/))) {
          lastMenu = menuItem;
          isTBB = match[1]=="tbb";
        }
      }
    }
    
    if(!lastMenu) return;
    
    const defaultDM = gFlashGotService.defaultDM;  
    const dms = gFlashGotService.DMS;
    var menuItemId;
    if(dms.found) {
      var idPrefix="flashgot-menuopt-dm-";
      var eventPostfix;
      if(isTBB) {
        idPrefix += "tbb-";
        eventPostfix = "gFlashGot.downloadSel() || gFlashGot.downloadAll()";
      } else {
        eventPostfix = "gFlashGot.download()";
      }
      lastMenu.setAttribute("hidden", "true");
      parentNode = lastMenu.parentNode;
      var dm;
      const miclass = "flashgot-dms-entry";
      // add menu items
      for(j = dms.length; j-- >0;) {
        dm = dms[j];
        if(dm.supported) {
          menuItemId = idPrefix + dm.codeName;
          menuItem = document.getElementById(menuItemId);
          if(!menuItem) {
            menuItem = document.createElement("menuitem");
            menuItem.setAttribute("class", miclass);
            menuItem.setAttribute("id", menuItemId);
            menuItem.setAttribute("type", "radio");
            menuItem.setAttribute("autocheck", "true");
            menuItem.setAttribute("oncommand", 
                "gFlashGotService.defaultDM = this.label; window.setTimeout(function() { " + 
                  eventPostfix + " }, 0)");
            menuItem.setAttribute("label", dm.name);
            parentNode.insertBefore(menuItem, lastMenu);
          }
          menuItem.setAttribute("checked", (defaultDM == dm.name) ? "true" : "false");
          lastMenu = menuItem;
        }
      }
      // remove menu items
      var nodes=parentNode.getElementsByAttribute("class", miclass);
      for(j=nodes.length; j-->0;) {
        dm=dms[nodes[j].getAttribute("label")];
        if(!(dm && dm.supported)) {
          parentNode.removeChild(nodes[j],true);
        }
      }
    } else {
      lastMenu.removeAttribute("hidden");
    }
  }
,

  get _mediaIDs() {
    var widgetId = "flashgot-media-status";
    var addonBar = document.getElementById("addon-bar");
    var statusBar = document.getElementById("status-bar");
    if (addonBar || !document.getElementById("status-bar")) {
      
      var el = document.getElementById(widgetId);
      
      if (el) el.parentNode.removeChild(el);
      widgetId = "flashgot-media-tbb";
      el = document.getElementById(widgetId);
      
      var addonBarVisible = addonBar && addonBar.boxObject.height;
      if (el && (el.nextSibling && el.nextSibling.id === "search-container" ||
                 addonBarVisible && el.parentNode === addonBar &&
                 !gFlashGotService.getPref("media.iconInstalled", false))) {
        el = null;
      }
  
      if (!el) {
        const fakeID = "flashgot-fake-tbb";
        const splitRx = /\s*,\s*/;
        var bar, set, refId;
        if (addonBar) {
          set = addonBar.currentSet.split(splitRx);
          
          if (set.indexOf(fakeID) === -1) {
            set.push(fakeID);
            
            var navBar = document.getElementById("nav-bar");
            
            if(!addonBarVisible && navBar && !navBar.collapsed) {
              addonBar.setAttribute("currentset", addonBar.currentSet = set.join(","));
              document.persist(addonBar.id, "currentset");
              bar = navBar;
              set = bar.currentSet.split(splitRx);
            } else {
              bar = addonBar;
              refId = "status";
            }
          }
        }
        
        if (!bar) {
          bar = document.getElementById("nav-bar");
          set = bar && bar.currentSet.split(splitRx);
        }
        
        if (bar) {
          for (var p; (p = set.indexOf(widgetId)) > -1;)
            set.splice(p, 1);
          
          var refIdx = refId ? set.indexOf(refId) : -1;
          if (refIdx === -1) {
            set.push(widgetId);
          } else {
            set.splice(refIdx, 0, widgetId);
          }
          bar.setAttribute("currentset", bar.currentSet = set.join(","));
          document.persist(bar.id, "currentset");
          try {
            window.BrowserToolboxCustomizeDone(true);
          } catch (e) {}
          gFlashGotService.setPref("media.iconInstalled", true);
        }
      }
    }
  
    delete this._mediaIDs;
    return this._mediaIDs = [widgetId, "flashgot-menuitem-media", "flashgot-main-menuitem-media"]
  },
  
  _mediaTip: function(media) {
    return media && media.length &&
      typeof(/ /) === "object" // Fx >= 3, multiline tooltips supported 
      ? media.map(function(l) { return l.tip }).join("\n")
      : '';
  },
  
  updateMediaUI: function() {
    var media = this.media;
    var count = (media && media.length) ? " (" + media.length + ")" : "";
    var tip = this._mediaTip(media);
    
    var l, id, ui;
    for (id of this._mediaIDs) {
      ui = document.getElementById(id);
      if (ui) {
        l = ui.getAttribute("label");
        if (l) ui.label = l.replace(/\s*\(\d+\)$/, '') + count;
        
        if (tip) ui.setAttribute("tooltiptext", tip);
        else ui.removeAttribute("tooltiptext");
        
        if (count) ui.hidden = ui.disabled = false;
      }
    }
    this.updateMediaStatus(true);
  },
  
  updateMediaStatus: function(anim) {
    if (this !== gFlashGot) {
      gFlashGot.updateMediaStatus();
      return;
    }
    
    var ms = this.mediaStatusAnim.widget;
    if (ms) {
      if (gFlashGotService.getPref("media.statusIcon", true)) {
          
          var media = this.media;
          ms.hidden = ms.disabled = !(media && media.length);
          
          if (!(anim || ms.hidden)) {
            var tip = this._mediaTip(media);
            if (tip) ms.setAttribute("tooltiptext", tip);
            else ms.removeAttribute("tooltiptext");
          }
          
      } else {
        ms.hidden = true;
      }
      this.mediaStatusAnim.run(!anim);
    }
  },
  
  mediaStatusAnim: {
    interval: 0,
    lastShowing: false,
    cycles: 0,
    get widget() {
      return document.getElementById(gFlashGot._mediaIDs[0]);  
    },
    run: function(once) {
      var w = this.widget;
      if (!w) return;
      var showing = !w.hidden;
      if (showing) {
        var opacity = 0;
        if (!this.lastShowing) {
          this.cycles = 3;
          this.lastShowing = true;
          opacity = 1;
        }
        if (this.cycles <= 0) return;
        var opacity = opacity || parseFloat(w.style.opacity) || 1;
        if (opacity <= .1) {
           opacity = 1;
           this.cycles --;
        } else {
           opacity -= .05;
        }
        w.style.opacity = opacity;
        if (!once)
          window.setTimeout(function() { gFlashGot.mediaStatusAnim.run(); }, 50);
      } else this.lastShowing = false;
    }
  },
  
  prepareMediaMenu: function(menu, evt) {
    const menu_parsed = document.getElementById("flashgot-media-parsed-popup");
    const menu_parsed_dash = document.getElementById("flashgot-media-parsed-dash-popup");
    const mi_refresh_decode_signature_func = document.getElementById("flashgot-media-parsed-refresh_signature_func");
    mi_refresh_decode_signature_func.hidden = true;
    const m = this.media;
    if (!(m && m.length)) {
      menu_parsed.parentNode.hidden = true;
      menu_parsed_dash.parentNode.hidden = true;
      this.clearMediaMenu();
      return false;
    }

    // YouTube parsed streams.
    // Map<string video_id, Group data> groups;
    // struct Group {
    //   string id; // Video ID.
    //   string title; // Video title, goes to the menu label.
    //   string link; // Video page URL, goes to clipboard along with the video title.
    //   Array<menuitem> parsed_items;
    //   Array<menuitem> parsed_dash_items;
    //   menupopup menu_parsed; // |parsed_items| go here.
    //   menupopup menu_parsed_dash; // |parsed_dash_items| go here.
    // }
    const groups = {};
    // Dummy group for the non-grouping case.
    var group = {
      parsed_items: [],
      parsed_dash_items: [],
      menu_parsed: menu_parsed,
      menu_parsed_dash: menu_parsed_dash
    };
    // Actually played (not parsed) streams.
    const played_items = [];
    var do_group = gFlashGotService.getPref("media.YouTube.group.enabled", false);
    if ( ! do_group) { groups[""] = group; }
    for (var j = 0; j < m.length; j++) {
      var mo = m[j];
      // Special menu item, used for refreshing YouTube's signature decoding function.
      if (mo.MediaSniffer && mo.originalURL === mo.MediaSniffer.YOUTUBE_REFRESH_SIGNATURE_FUNC_URL) {
        var mi = mi_refresh_decode_signature_func;
        mi.hidden = false;
        mi["flashgot::Youtube"] = mo.Youtube;
        mi["flashgot::MediaSniffer"] = mo.MediaSniffer;
        mi["flashgot::yt_win"] = mo.yt_win;
        continue;
      }
      var mi = this._createMediaMenuItem(mo);
      if (!mo.parsed) {
        played_items.push(mi);
        continue;
      }
      if (do_group) {
        group = groups[mo.video_id];
        if ( ! group) {
          group = {
            id: mo.video_id,
            title: mo.title != null ? String(mo.title) : "Video " + mo.video_id,
            link: mo.video_link,
            parsed_items: [],
            parsed_dash_items: [],
            menu_parsed: menu_parsed,
            menu_parsed_dash: menu_parsed_dash
          };
          groups[group.id] = group;
        }
      }
      mi["flashgot::sort_key"] = mo.sort_key;
      if (mo.yt_dash) {
        mi["flashgot::yt_dash"] = mo.yt_dash;
        group.parsed_dash_items.push(mi);
      } else {
        group.parsed_items.push(mi);
      }
    }

    // Sort the groups by video title. Ignore empty groups.
    const group_ids = Object.keys(groups)
      .filter(function(id){var o = groups[id]; return o.parsed_items.length || o.parsed_dash_items.length;})
      .sort(function(lhs, rhs){return groups[lhs].title.toLowerCase().localeCompare(groups[rhs].title.toLowerCase());});
    do_group &= group_ids.length > 1;
    if (evt.target !== menu && do_group) { return; }

    menu_parsed.parentNode.hidden = true;
    menu_parsed_dash.parentNode.hidden = true;
    this.clearMediaMenu();
    played_items.forEach(function(mi){menu.appendChild(mi);});

    function mo_cmp(lhs, rhs) { return lhs["flashgot::sort_key"] - rhs["flashgot::sort_key"]; }
    const group_title_max_length = gFlashGotService.getPref("media.YouTube.group.title_max_length", 40);
    const dash_menu_label = menu_parsed_dash.parentNode.label;
    group_ids.forEach(function(gid){
      var group = groups[gid];
      var parsed_items = group.parsed_items;
      var parsed_dash_items = group.parsed_dash_items;
      menu_parsed.parentNode.hidden = false;
      if (do_group) {
        // Non-DASH streams menu.
        var gmenu = document.createElement("menu");
        menu_parsed.appendChild(gmenu);
        gmenu.setAttribute("label", group.title.length > group_title_max_length
          ? group.title.substr(0, group_title_max_length) + "..." : group.title);
        gmenu.setAttribute("tooltiptext", group.title + " (" + group.id + ")");
        gmenu.appendChild(group.menu_parsed = document.createElement("menupopup"));
        // Right-click to copy the video title and link to clipboard.
        gmenu.setAttribute("flashgot_media_clipboard_text", group.title + (group.link ? " (" + group.link + ")" : ""));
        gmenu.addEventListener("click", function(evt){
          if (evt.button !== 2 || evt.target !== this) { return; }
          evt.preventDefault();
          evt.stopPropagation();
          Components.classes["@mozilla.org/widget/clipboardhelper;1"]
            .getService(Components.interfaces.nsIClipboardHelper)
            .copyString(this.getAttribute("flashgot_media_clipboard_text"));
        }, true);
      }
      var gmenu_parsed = group.menu_parsed;
      if (parsed_items.length) {
        parsed_items.sort(mo_cmp);
        parsed_items.forEach(function(mi){delete mi["flashgot::sort_key"]; gmenu_parsed.appendChild(mi);});
        gmenu_parsed.hidden = false;
      }
      if (parsed_dash_items.length) {
        if (do_group) {
          // DASH streams menu - child of the non-DASH streams menu.
          var gmenu = document.createElement("menu");
          gmenu_parsed.insertBefore(gmenu, gmenu_parsed.firstChild);
          gmenu.setAttribute("label", dash_menu_label);
          gmenu.appendChild(group.menu_parsed_dash = document.createElement("menupopup"));
        }
        var gmenu_parsed_dash = group.menu_parsed_dash;
        parsed_dash_items.sort(mo_cmp);
        var show_av_separator = gFlashGotService.getPref("media.YouTube.dash.show_av_separator", true);
        var prev_type = parsed_dash_items[0]["flashgot::yt_dash"];
        parsed_dash_items.forEach(function(mi){
          if (show_av_separator && prev_type !== mi["flashgot::yt_dash"]) {
            show_av_separator = false;
            gmenu_parsed_dash.appendChild(document.createElement("menuseparator"));
          }
          delete mi["flashgot::sort_key"];
          delete mi["flashgot::yt_dash"];
          gmenu_parsed_dash.appendChild(mi);
        });
        gmenu_parsed_dash.parentNode.hidden = false;
      }
    });

    this._cb_mediaMenuItem_key_down = false;
    // https://developer.mozilla.org/en-US/docs/XUL/PopupGuide/PopupKeys:
    // A key listener added to a <menupopup> will not receive any key events.
    // Instead, you must add a capturing key listener to the document or window
    // if you want to listen for keys pressed within a menu.
    window.addEventListener("keydown", this._cb_mediaMenuItem_keydown, true);
    window.addEventListener("keyup", this._cb_mediaMenuItem_keyup, true);

    return true;
  },
  unprepareMediaMenu: function(menu, evt) {
    if (evt.target !== menu) { return; }
    this._cb_mediaMenuItem_key_down = false;
    window.removeEventListener("keydown", this._cb_mediaMenuItem_keydown, true);
    window.removeEventListener("keyup", this._cb_mediaMenuItem_keyup, true);
  },
  clearMediaMenu: function() {
    this._clearMenu(document.getElementById("flashgot-media-parsed-menu").nextSibling);
    this._clearMenu(document.getElementById("flashgot-media-parsed-refresh_signature_func").nextSibling);
    this._clearMenu(document.getElementById("flashgot-media-parsed-dash-popup").firstChild);
  },
  _clearMenu: function(from) {
    if (!from) { return; }
    var pn = from.parentNode;
    while (from.nextSibling !== null) { pn.removeChild(from.nextSibling); }
    pn.removeChild(from);
  },
  _createMediaMenuItem: function(l) {
    var mi = document.createElement("menuitem");

    // Hilight the currently playing stream.
    var is_current = false;
    if (content._flashgotMediaCurrentUrl) {
      is_current = l.Youtube
        ? l.Youtube.stream_url_equals(content._flashgotMediaCurrentUrl, l.originalURL)
        : content._flashgotMediaCurrentUrl === l.originalURL;
    }
    if (is_current) { mi.setAttribute("default", "true"); }

    if (l.fallback_href) { mi.setAttribute("flashgotMediaFallbackHref", l.fallback_href); }
    var label = l.label;
    if (l.seek_pos && gFlashGotService.getPref("media.YouTube.seek_pos.show", true)) {
      label = "@" + this._formatMediaSeekPos(l.seek_pos) + " " + label;
    }
    mi.setAttribute("label", label);
    mi.setAttribute("tooltiptext", l.tip);
    // YouTube: hold Shift to download/copy fallback URL if it exists,
    // otherwise the "main" URL will be used.
    mi.addEventListener("command", function(ev) {
      var o = l;
      if (ev.shiftKey && l.fallback_href) {
        o = Object.create(l);
        o.href = l.fallback_href;
      }
      gFlashGot.downloadMedia([o]);
    }, false);
    mi.addEventListener("click", function(ev) {
      if (ev.button === 2) {
        Components.classes["@mozilla.org/widget/clipboardhelper;1"]
          .getService(Components.interfaces.nsIClipboardHelper)
          .copyString(ev.shiftKey && l.fallback_href || l.href);
        ev.preventDefault();
      }
    }, true);
    return mi;
  },
  _cb_mediaMenuItem_key_down: false,
  _cb_mediaMenuItem_keydown: function(ev) {
    if (ev.keyCode !== 16 /*VK_SHIFT*/) { return; }
    var This = gFlashGot;
    if (This._cb_mediaMenuItem_key_down) { return; }
    This._cb_mediaMenuItem_key_down = true;
    var menu = document.getElementById("flashgot-media-parsed-popup");
    var nl = menu.getElementsByTagName("menuitem");
    for (var i = 0, len = nl.length; i !== len; ++i) {
      var mi = nl[i];
      mi.setAttribute("disabled", "" + !mi.hasAttribute("flashgotMediaFallbackHref"));
    }
  },
  _cb_mediaMenuItem_keyup: function(ev) {
    if (ev.keyCode !== 16 /*VK_SHIFT*/) { return; }
    var This = gFlashGot;
    if (!This._cb_mediaMenuItem_key_down) { return; }
    This._cb_mediaMenuItem_key_down = false;
    var menu = document.getElementById("flashgot-media-parsed-popup");
    var nl = menu.getElementsByTagName("menuitem");
    for (var i = 0, len = nl.length; i !== len; ++i) {
      nl[i].setAttribute("disabled", "false");
    }
  },
  _formatMediaSeekPos: function(ms) {
    var h = Math.floor(ms / 1000 / 60 / 60);
    var m = Math.floor((ms -= h * 60 * 60 * 1000) / 1000 / 60);
    var s = Math.floor((ms -= m * 60 * 1000) / 1000);
    ms -= s * 1000;
    function strpad(str, pad_char, length) {
      str = String(str);
      var addon_len = length - str.length;
      if (addon_len < 1) { return str; }
      return new Array(addon_len + 1).join(pad_char) + str;
    }
    var rc;
    // [h:m]m
    if (gFlashGotService.getPref("media.YouTube.seek_pos.compact", true)) {
      rc = "" + (h !== 0 ? h + ":" + strpad(m, "0", 2) : m);
    }
    // h:mm
    else {
      rc = "" + h + ":" + strpad(m, "0", 2);
    }
    // Seconds: ":ss".
    rc += ":" + strpad(s, "0", 2);
    // Milliseconds: ".SSS".
    if (ms !== 0 && gFlashGotService.getPref("media.YouTube.seek_pos.show_ms", false)) {
      rc += "." + strpad(ms, "0", 3);
    }
    return rc;
  },
  Youtube_refresh_signature: function(evt, elm) {
    var win = elm['flashgot::yt_win'];
    var MediaSniffer = elm['flashgot::MediaSniffer'];

    // Remove the "Refresh signature" entry.
    var media = this.media;
    delete media._map[MediaSniffer.YOUTUBE_REFRESH_SIGNATURE_FUNC_URL];
    var eidx = -1;
    media.some(function(entry, idx){
      if (entry.originalURL === MediaSniffer.YOUTUBE_REFRESH_SIGNATURE_FUNC_URL) {
        eidx = idx;
        return true;
      }
    });
    if (eidx !== -1) { media.splice(eidx, 1); }

    elm['flashgot::Youtube'].refresh_signature_func(win, function(){
      // We're in a frame/iframe, and who knows how many other YouTube
      // frames are also there (e.g. we're on a forum/blog), so, ideally,
      // we should reload the top page for all those frames to get reloaded
      // and rerequested by MediaSniffer.
      // The problem is that I doubt everyone will like this reloading
      // behavior.
      //if (win !== win.top) { return win.top.location.reload(); }
      MediaSniffer.checkYoutube(win, null, true);
      }, true);
    evt.preventDefault();
    evt.stopPropagation();
  },

  get srcWindow() {
    return document.commandDispatcher.focusedWindow;
  }
,
  get srcDocument() {
    return this.srcWindow.document;
  }
,

  get isTabbed() {
    var b = window.gBrowser;
    return b && b.browsers && b.browsers.length > 1;
  }
,
  get isSelInvalid() {
    return this.srcWindow.getSelection().isCollapsed && !this.grabSelectedTextFields(null, true);
  }
,
  get popupLink() { 
    return this.findLinkAsc(document.popupNode);
  }
,
  get currentLink() { 
    const sel = this.srcWindow.getSelection();
    return !sel.isCollapsed && this._wrapAnchor(sel.anchorNode)
      || this.findLinkAsc(this.hoverElement) || this.findLinkAsc(document.commandDispatcher.focusedElement);
  }
,
  get linksCount() {
    const doc = this.srcDocument;
    if(!doc) return 0;
    
    var count = doc.links ? doc.links.length || 0 : this.getXMLLinks(doc).length;
    
    if(gFlashGotService.getPref("includeImages")) 
       count += (doc.images && doc.images.length) || 0;
    count += (doc.embeds && doc.embeds.length) || 0;
    
    return count;
  }
,
  getXMLLinks: function(document) {
    var nodesSnapshot = document.evaluate("//*/@*", document.documentElement, null,
                                          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    var links = [];
    var href;
    for (var j = 0, len = nodesSnapshot.snapshotLength; j < len; j++ ) {
      href = nodesSnapshot.snapshotItem(j).nodeValue;
      if (/^https?:/.test(href)) links.push({tagName: "XML", href: href, description: href });
    }
    return links;
  },
  getLinks: function(filter, includeImages, doc) {
    if(typeof(doc) != "object") {
      doc = this.srcDocument;
    }
    if(doc == null) return [];
    if (!doc.links) return this.getXMLLinks(doc);
    
    const allLinks = [];
    
    function wrapAndFilter(newL, l) {
      const href = l.src;
      if (!href) return null;
      
      if(href.lastIndexOf("://", 9) < 0) {
        try {
          newL.href = 
                (uriResolver || 
                 (uriResolver = 
                  Components.classes['@mozilla.org/network/io-service;1']
                            .getService(Components.interfaces.nsIIOService)
                            .newURI(doc.URL, null, null))).resolve(href);
        } catch(ex) {
          return false;
        }
      } else {
        newL.href =  href 
      }
      

      var des = l.alt || l.title || href.substring(href.lastIndexOf("/") + 1);
      var w, h;
      if ((w = l.width) && (h = l.height))
        des += " (" + w + "," + h + ")";
        
      newL.description = des;

      return filter(newL, l);
    }
    
    function filterLinks(elems, filter, tagName) {
      const wrap = tagName === "A";
      try {
        if(elems) {
          var l, newL;
          for(var j = 0, len = elems.length; j < len; j++) {
            l = elems[j];
            newL = wrap ? gFlashGot._wrapAnchor(l) : { tagName: tagName };
            if(newL && filter(newL, l)) {
              allLinks.push(newL);
            }
          }
        }
      } catch(ex) {}
    }
    

    filterLinks(doc.links, filter, "A"); 
    
    var uriResolver = null;
    
    if(includeImages) {
      filterLinks(doc.images, wrapAndFilter, "IMG");
    }
    
    filterLinks(doc.embeds,wrapAndFilter, "EMBED");

    return allLinks;
  }
,
  get referrer() {
    if(this._referrer) return this._referrer;
    var docURL = this.srcDocument.URL;
    var gb = docURL && docURL.substring(0,5) == "file:" && this.getBuildGalleryData();
    return gb ? gb.referrer : docURL;
  }
,  
  set referrer(r) {
    return this._referrer = r; 
  },
  
  getBuildGalleryData: function(doc) {
    doc = doc || window.content.document;
    const props = ['preview', 'content', 'referrer'];
    var gb = {};
    try {
      for (var p of props) {
        gb[p] = doc.getElementById(p).firstChild.nodeValue;
      }
    } catch(e) {
      gb = null;
    }
    return gb;
  },
  
  grabSelectedTextFields: function(selection, justCheck) {
    const doc = this.srcDocument;
    var ff, f, j;
    const vv = [];
    var selStart, selEnd;
    for (var t of ["textarea", "input"]) {
      var ff = doc.getElementsByTagName(t);
      for(j = 0; (f = ff[j]); j++) {
        try {
          if(selection && selection.containsNode(f, true)) {
            if(justCheck) return true;
            vv.push(f.value);
          }
          else {
            selStart = f.selectionStart, selEnd = f.selectionEnd;
            if(selStart < selEnd) {
              if(justCheck) return true;
              vv.push(f.value.substring(selStart, selEnd));
            }
          }
        } catch(e) {}
      }
    }
    return justCheck ? false : vv;
  }
,
  getSelectionLinks: function(includeImages) {
    const selection = this.srcWindow.getSelection();
    
    // link nodes detection
    var links = this.getLinks(function(link, trueNode) {
      return link && gFlashGot.checkLink(link) && 
        selection.containsNode(trueNode ? trueNode : link, true); 
    }, includeImages); 
    
    var selString = selection.toString();
    
    // add textboxes
    
    selString += this.grabSelectedTextFields(selection).join("\n");
    
    var m;
    
    // password detection
    var pwd = gFlashGotService.getPref("selection.guessPassword", true) &&
        (m = selString.match(/\b(?:password|passw|pass|pwd|pw)\W+(.*)/i)) && m[1];

    // text links detection
    m = selString.match(
      /\b(?:(?:h.{2}p|ftp|mms|ed2k|rtsp|rtmpe?):\/\/|[a-z]+[a-z\d]+\.[a-z\d\-\.]+\/|magnet:\?)[^\s]*/gi);
    selString = "";
    var j, k;
    if(m) {
      var descMap = null;
      var href, desc;
      var d, diff;
      
      linksLoop:
      for(j = 0, len = m.length; j < len; j++) {
        desc = m[j];
        href = desc.replace(/^h.{2}p/i, "http").replace(/^([a-z]+[a-z\d]+\.[a-z\d\.]+\/)/i, "http://$1");
        // TODO: riddles like http://rap*dshare.com
        if(href) {
          if(!descMap) { // we use it to avoid textual "quasi-duplicates", as http://somepart...oftheurl
            descMap = {};
            for(k = links.length; k-- > 0;) {
              descMap[links[k].description] = true;
            }
          }
          if (descMap[href] || descMap[desc]) continue;
          if (!/^https?:/.test(desc)) {
            for (d in descMap) {
              diff = d.length - desc.length;
              if (diff >= 0 && d.indexOf(desc) == diff) continue linksLoop; 
            }
          }
          links[links.length] = { href: href, description: m[j] };
        }
      }
    }
    
    if(pwd) {
      var des;
      var pwdDes = " pw: " + pwd;
      for(j = links.length; j-- > 0;) {
        des = links[j].description || "";
        links[j].pwd = pwd;
        links[j].description = des.substring(0, 4) == "http" ? pwdDes : des.concat(pwdDes);
      }
    }
    return links;
  }
,
  checkLink: function(link) {
    return link.href && /^(?:\w+:\/\/.*|javascript:.*http|magnet:)/i.test(link.href) && !/^(mailto|news|file|data):/i.test(link.href);
  }
,
  _wrapAnchor: function(node) {
    var isAnchor = (node instanceof HTMLAnchorElement);
    if(isAnchor || node instanceof HTMLAreaElement) {
      var href = node.href;
      if(href) {
        var l = { 
        href: href,
        tagName: "A",
        getElementsByTagName: function(n) { return node.getElementsByTagName(n) },
        description: isAnchor 
          ? node.title || node.textContent
          : node.alt || node.title 
        };
        if ("download" in node) l.fname = node.download;
        return l;
      }
    }
    return null;
  }
,
  findLinkAsc: function(node) {
     var anchor;
     while(node) {
      anchor = this._wrapAnchor(node);
      if(anchor) return this.checkLink(anchor) ? anchor : null;
      node = node.parentNode;
    }
    return null;
  }
,
  delayCmd: function(cmd) {
    const pg = this.createProgress();
    pg.update(5);
    window.setTimeout(function() {
      try {
        pg.value = 100;
        gFlashGot["download"+cmd]();
        gFlashGot.showProgress();
      } catch(ex) {
        dump(ex);
      }
    },0);
  }
,
  
  downloadPopupLink: function(dmName) {
    const link = this.popupLink;
    return link && this.download([link], gFlashGotService.OP_ONE, dmName);
  }
,
  downloadPopupNodeText: function(dmName) {
    if (!(document.popupNode && document.popupNode.textContent)) return false;
    return this.download([{
      href: document.popupNode.textContent,
      description: "Thunderbird Link"
    }], gFlashGotService.OP_ONE, dmName);
  }
,
  downloadLink: function(dmName) {
    const link = this.currentLink;
    return link && this.download([link], gFlashGotService.OP_ONE, dmName);
  }
,
  downloadSel: function(dmName) {
    if(this.isSelInvalid) return false;
    const startTime = Date.now();
    const links = this.getSelectionLinks(gFlashGotService.getPref("includeImages"));
    if(!links.length) return false;
    links.startTime = startTime;
    return this.download(links, gFlashGotService.OP_SEL, dmName);
  }
,
  collectAllLinks: function(doc, tagName) {
    var links = [];
    try {
      const includeImages = gFlashGotService.getPref("includeImages");
      if(tagName) {
        var frames = doc.getElementsByTagName(tagName);
        var contentDocument;
        for(var j = frames.length; j-->0;) {
          try {
            if((contentDocument = frames[j].contentDocument)) {
              links = links.concat(
                this.collectAllLinks(contentDocument));
            }
          } catch(e) { dump(e + "\n"); }
        }
      } else {
        links = links.concat(this.getLinks(this.checkLink, includeImages, doc)
          ).concat(this.collectAllLinks(doc, "frame")
          ).concat(this.collectAllLinks(doc, "iframe"));
        this.addMediaLinks(links);
      }
    } catch (e) { dump(e + "\n"); }
    return links;
  }
,
  get media() {
    return gFlashGotService.getMedia(content);
  },
  
  addMediaLinks: function(links, mm) {
    mm = mm || this.media;
    if (!(mm && mm[0])) return false;
    if (!(links.length || links.referrer)) links.referrer = mm[0].referrer;
    Array.prototype.push.apply(links, mm);
    return true;
  },
  
  clearMedia: function() {
    if (this.media) {
       // keep _map in place, so we still prevent duplicates
      this.media.length = 0;
    }
    this.updateMediaUI();
  }
,
  downloadAll: function(dmName) {
    const startTime = Date.now();
    const links = this.collectAllLinks(content.document);
    links.startTime = startTime;
    return this.download(links, gFlashGotService.OP_ALL, dmName);
  }
,
  downloadTabs: function(dmName) {
    if(!this.isTabbed) return this.downloadAll(dmName);
    const bb = getBrowser().browsers;
    var doc;
    var links=[];
    for (var j = 0, len = bb.length; j<len; j++) 
      if ((doc = bb[j].contentDocument))
        links = links.concat(this.collectAllLinks(doc));

    return links.length &&
       this.download(links, gFlashGotService.OP_ALL, dmName);
  }
,
  downloadMedia: function(mediaLinks, dmName) {
    if (gFlashGotService.getPref("media.autoCloseDocument", false)) {
      var w = content;
      w.setTimeout(function() { w.close() }, 500);
    }
    var links = [];
    return this.addMediaLinks(links, mediaLinks) &&
      this.download(links, gFlashGotService.OP_SEL, dmName || gFlashGotService.getUPref("media.dm", ""));
  }
,
  download: function(links, opType, dmName) {
    if (!links) {
      // best guess selection/link
      return this.downloadSel() || this.downloadLink();
    }

    try {
      links.referrer = links.referrer || this.referrer;
      links.browserWindow = window;
      links.document = this.srcDocument;
    } catch(ex) {}
    
    links.progress = this.createProgress();
    const ret = gFlashGotService.download(links, opType, dmName);
    if(!ret) links.progress.update(100);
    return ret;
  }
,
  progressList: [],
  createProgress: function(v) {
    return new this.Progress(v);
  },
  Progress: function(v) {
    this.value = v || 0;
    this.showing = false;
    this.update = function(v) {
      if(!this.showing) {
        this.showing = true;
        gFlashGot.progressList.push(this);
      }
      if(typeof(v) == "number") this.value = v;
      gFlashGot.showProgress();
    }
  },
  
  showProgressValue: function(v) {
    var done = v >= 100; 
    document.getElementById("flashgot-progresspanel").collapsed = done;
    document.getElementById("flashgot-progressmeter").value = v;
    gFlashGotService.yield();
  },
  
  showProgress: function() {
    const pgl = this.progressList; 
    var len = pgl.length;
    var value;
    if(len > 0) {
      value = 0;
      for(var j = len; j-- > 0;) {
        var v = pgl[j].value;
        if(v < 100) {
          value += v;
        } else {
          pgl.splice(j, 1);
          len--;
        }
      }
      value = len > 0 ? Math.round(value / len) : 100;
    } else {
      value = 100;
    }
    this.showProgressValue(value);
  }
,
  buildGallery: function() {
    var previewURL = null, contentURL = null;
    var gb = this.getBuildGalleryData();
    if(gb) {
      dump("FGBG: reusing gallery data\n");
      previewURL = gb.preview;
      contentURL = gb.content;
    } else {
      var links=this.getSelectionLinks(true);
      if(!(links && links.length)) {
        dump("FGBG: no selection links, using "); 
        if(this.popupLink) {
         dump("popup link\n");
         links = [this.popupLink];
        } else {
         dump("all links\n");
         links=this.getLinks(this.checkLink, true);
        }
      }
      var len;
      if(links && (len=links.length)) {
        const previewRX = /\d+.*\.(jpg|jpeg|png|gif|bmp)(\?|$)/i;
        const contentRX = /\d+.*\.[a-z0-9]{2,4}(\?|$)/i;
        var l, tag, url, imgs, i, iLen, imgSrc;
        for(var  j = 0; j < len && !(contentURL && previewURL); j++) {
          l = links[j];
          tag = l.tagName && l.tagName.toUpperCase();
          url = l.href;
          if(tag !== "IMG" && contentRX.test(url)) {
            contentURL = url;
            if (tag === "A" && ("getElementsByTagName" in l)) {
              imgs = l.getElementsByTagName("img");
              for(i = 0, iLen = imgs.length; i < iLen; i++) {
                imgSrc = imgs[i].src;
                if(previewRX.test(imgSrc)) {
                  previewURL = imgSrc;
                  break;
                }
              }
            }
          }
        }
        if( (!previewURL) && (tag === "IMG" || previewRX.test(url)) ) {
          previewURL=url;
        } 
      }
      if(!previewURL) previewURL = "";
      if(previewURL && !contentURL) contentURL = previewURL;
    }
    window.openDialog("chrome://flashgot/content/flashgotGalleryBuilder.xul","_blank",
      "chrome,dialog,centerscreen,resizable",
      { 
        previewURL: previewURL, 
        contentURL: contentURL, 
        referrerURL: this.referrer,
        originalWindow: window,
        tmpDir: gFlashGotService.tmpDir,
        prefs:  gFlashGotService.prefs
      }
    );
  }

}

window.addEventListener("load", gFlashGot.onload, false);