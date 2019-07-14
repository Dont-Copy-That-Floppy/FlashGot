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

const CI = Components.interfaces;
const CC = Components.classes;

var Chooser = {
  linkChooser: null,
  
  init: function() {
    
    this.dialog = document.documentElement;
   
    this.params = window.arguments[0];
    this.params.choosenDir = this.params.initialDir;
    
    this.dialog.setAttribute("title", this.params.title);
    document.getElementById("destLabel").setAttribute("value",
      this.destFolderLabel = gFlashGotService.getString("ph.FOLDER")
    );
    
    this._initLinks(this.params.links);
    
    this.loadRecent();
    
    if (this.params.choosenDir) {
      this.sync();
    } else {
      this.browse();
    }
    
   
  },
  
  get separator() {
    delete this.separator;
    return this.separator = gFlashGotService.isWindows ? ";" : ":";
  },
  
  loadRecent: function() {
    if (gFlashGotService.inPrivate) return;
    try {
      Components.utils.import("chrome://flashgot/content/Autocomplete.jsm");
    } catch (e) {
      dump(e + "\n" + e.stack)
      return;
    }
    
    var t = document.getElementById("dest");

    t.setAttribute("autocompletesearchparam",
        gFlashGotService.getUPref("recentDirs") || "");
    
    setTimeout(function() {
      t.addEventListener("focus", function() {
        t.open = true;
        t.select();
      }, false);
      
      t.popup.addEventListener("select", function() {
        var i = t.popup.selectedIndex;
        if (i > -1) t._lastSelectedIndex = i;
      }, false);
      t.popup.addEventListener("click", function() {
        var i = t._lastSelectedIndex;
        if (i > -1) {
          var v =  t.controller.getValueAt(i);
          if (v && v !== t.value) t.value = v;
        }
      }, false);
    }, 100);
    
    var sel = null;
    
    t.addEventListener("dblclick", function() {
      t.select();
      sel = [t.selectionStart, t.selectionEnd];
    }, false);
    
    t.addEventListener("click", function(ev) {
      if (ev.originalTarget.tagName === "div"
          && (!sel || t.selectionStart === t.selectionEnd || sel[0] === t.selectionStart && sel[1] === t.selectionEnd)
        ) t.open = ev.button === 0;
    }, false);
    t.addEventListener("mousedown", function(ev) {
      if (ev.originalTarget.tagName === "div") {
        sel = [t.selectionStart, t.selectionEnd];
      }
    }, false);
    
  },
  updateRecent: function(path) {
    if (gFlashGotService.inPrivate) return;
    var recentString = gFlashGotService.getUPref("recentDirs");
    var recent;
    try {
      recent = recentString && JSON.parse(recentString) || [];
    } catch (e) {
      recent = [];
    }
    var i;
    for (;;) {
      i = recent.indexOf(path);
      if (i === -1) break;
      recent.splice(i, 1);
    }
    if (recent.length > 9) recent.splice(9, recent.length - 9);
    recent.unshift(path);
    gFlashGotService.setUPref("recentDirs", JSON.stringify(recent));
  },
  
  sync: function() {
    var t = document.getElementById("dest");
    var d = this.params.choosenDir;
    if (d && t.value != d.path) {
      t.value = d.path;
    } 
    this.dialog.getButton("accept").setAttribute("disabled", !d);
  },
  
  folderChanged: function(t) {
    var path = t.value;
    this.params.choosenDir = null;      
    try {
      var d = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
      d.initWithPath(t.value);
      if (!d.exists() || d.isDirectory())
        this.params.choosenDir = d;      
    } catch(e) {
    }
    this.sync();
  },

  browse: function() {
    const fp = CC["@mozilla.org/filepicker;1"].createInstance(CI.nsIFilePicker);
   
    fp.init(window, this.params.title + " - " + this.destFolderLabel, CI.nsIFilePicker.modeGetFolder);
    var d = this.params.choosenDir || this.params.initialDir;
    try {
      if (d && (d.exists() || (d = d.parent).exists()) && d.isDirectory()) {
        fp.displayDirectory = d;
      }
    } catch (ex) { gFlashGotService.log(ex); }
    
    fp.appendFilters(CI.nsIFilePicker.filterAll);
    
    if (fp.show() == CI.nsIFilePicker.returnOK) {
      this.params.choosenDir = fp.file;
      this.sync();
    }
  },
  
  accept: function() {
    // create directory if it does not exist
    var d = this.params.choosenDir;
    if (d) {
      if (!d.exists()) {
        var permissions = d.parent && d.parent.exists() ? d.parent.permissions : parseInt("0600", 8);
        try {
          d.create(CI.nsIFile.DIRECTORY_TYPE, permissions);
        } catch (e) {
          gFlashGotService.showFileWriteError(d, e);
          throw e;
        }
      }
      try {
        this.updateRecent(d.path);
      } catch (e) {
        dump(e + "\n" + e.stack);
      }
    }
    if (this.linkChooser) this.linkChooser.save();
  },
  cancel: function() {
    this.params.choosenDir = null;
  },
  
  _initLinks: function(links) {
    if (links.length < 2) return;
    
    var tree = document.getElementById("links");
    try {
      Components.utils.import("chrome://flashgot/content/LinkChooser.jsm");
      this.linkChooser = new LinkChooser(tree, links,
                                         document.getElementById("filter").value,
                                         document.getElementById("all-choosen").checked
                                        );
      tree.parentNode.removeAttribute("collapsed");
      window.sizeToContent();
    } catch (e) {
      dump(e + "\n" + e.stack + "\n");
    }
  }
}

