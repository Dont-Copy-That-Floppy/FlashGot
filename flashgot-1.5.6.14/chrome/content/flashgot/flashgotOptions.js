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
const fg = gFlashGotService;
const uiUtils = new UIUtils(fg);


const g_rxOpt=/^(inv|)opt-(.*)/;
var g_downloadManagers = null;
var g_opts = null;
var g_extList = null;
var g_extText = null;
var g_extDirty = false;
var g_referrerRadio = null;
var g_referrerText = null;
var g_tmpDir = null;
var g_wellGetPath = null;
var g_pyLoadUrl = null;

var g_cust = fg && {
  dummy: fg.createCustomDM(""),
  map: {},
  createEntry: function(obj, isNew) {
    if(!obj.custom) return null;
    const name = obj.name;
    const map = this.map;
    return map[name] ? map[name]
      : map[name]={
          _dirty: false,
          _deleted: false, 
          _new: isNew,
          supported: true,
          name: name,
          codeName: name.replace(/\W/g, '_'),
          argsTemplate: obj.argsTemplate,
          exeFile: isNew?obj.locateExeFile(name):obj.exeFile
        };
  },
  get current() {
    if(!g_downloadManagers.selectedItem) return null;
    const dmName=g_downloadManagers.selectedItem.getAttribute("label");
    
    if( (!dmName) || dmName=="---") return null;
    var dm = fg.DMS[dmName];
    if(dm) {
      return this.createEntry(dm,false);
    }
    this.dummy.name=dmName;
    return this.createEntry(this.dummy,true);
  },
  add: function() {
    const ps = CC["@mozilla.org/embedcomp/prompt-service;1"
      ].getService(CI.nsIPromptService);
    const ret={ value: "" };
    const title=fg.getString("custom.new.title");
    var name;
    if(ps.prompt(window,
          title,
          fg.getString("custom.new.text"),
          ret, null, {}) && 
       (name = ret.value) ) {
      if(/,|^(?:\d+|\s+|---)$/.test(name) ||
          (name in this.map) ? !this.map[name]._deleted : (name in fg.DMS)) {
        ps.alert(window,title,fg.getString("custom.new.error"));
        return;
      }
      if (name in this.map) delete this.map[name]
      const dummy = this.dummy;
      dummy.name = name;
      this.createEntry(dummy, true);
      fgo_populateDMS(name);
    }
  },
  remove: function() {
    var dm=this.current;
    if(dm) {
      dm._deleted = true;
      fgo_populateDMS();
    }
  },
  locateExe: function() {
    const cur=this.current;
    if(cur) {
      var f=this.dummy.locateExeFile(this.current.name);
      if(f) {
        cur.exeFile=f;
        cur._dirty=true;
      }
      this.syncUI();
    }
  }
,
  argsChanged: function(txtArgs) {
    const cur=this.current;
    var val=txtArgs.value.replace(/['"`]/g,'');
    if(val!=txtArgs.value) {
      $("quoteWarn").showPopup(txtArgs,-1, -1, "tooltip", "topleft", "bottomleft");
      selEnd=txtArgs.selectionEnd;
      txtArgs.value=val;
      try {
        txtArgs.selectionEnd=selEnd-1;
      } catch(ex) {}
    }
    if(cur && cur.argsTemplate!=val) {
      cur.argsTemplate=val;
      cur._dirty=true;
    }
  }
,
  syncUI: function() {
    var dm = this.current;
    $("dmsdeck").setAttribute(
      "selectedIndex", dm ? "0" : "1");
    if(dm) {
      $("customDM-exeFile").value = 
        dm.exeFile ? dm.exeFile.path : "";
      $("customDM-args").value = dm.argsTemplate;
      var ph=$("ph-");
      var popup=ph.parentNode;
      while(ph.nextSibling) {
        popup.removeChild(ph.nextSibling);
      }
      const PHS=this.dummy.PLACEHOLDERS;
      if(PHS) {
        var phName;
        for(var j=0, len=PHS.length; j<len; j++) {
          phName=PHS[j];
          ph=ph.cloneNode(true);
          ph.removeAttribute("hidden");
          ph.setAttribute("id","ph-"+phName);
          ph.setAttribute("label",fg.getString("ph."+phName));
          popup.appendChild(ph);
        }
      }
    }
  }
,
 insertPH: function(id) {
   const phName="["+id.substring(3)+"]";
   const txtArgs=$("customDM-args")
   var selStart=txtArgs.selectionStart;
   var selEnd=txtArgs.selectionEnd;
   txtArgs.value=txtArgs.value.substring(0,selStart)+phName+txtArgs.value.substring(selEnd);
   txtArgs.selectionStart=txtArgs.selectionEnd=selStart+phName.length;
 }
,
 save: function() {
   const map = this.map;
   var dm, target;
   for (var name in map) {
     dm = map[name];
     target = null;
     if(dm._deleted) {
       fg.removeCustomDM(name);
     } else if(dm._new) {
       target = fg.createCustomDM(name);
     } else if(dm._dirty) {
       target = fg.DMS[name];
     }
     if(target) {
       target.argsTemplate=dm.argsTemplate;
       target.exeFile=dm.exeFile;
     }
   }
 }
};
function fgo_onload() {
  if(!fg) {
    $("mainTabbox").setAttribute("hidden","true");
    $("badInstall").removeAttribute("hidden");
    document.getAnonymousElementByAttribute(document
            .getElementById("flashgotOptions"),"dlgtype","cancel")
            .setAttribute("hidden","true");
    return;
  }
  
  
  uiUtils.resumeTabSelections();
  
  if (!fg.smUninstaller) {
    document.documentElement.getButton("extra2").hidden = true;
  }
  
  try {
      g_wellGetPath = fg.prefs.getComplexValue("WellGet.path", CI.nsILocalFile);
      $("wellget-text").value = g_wellGetPath.path;
  } catch(ex) {}
   
  
  if(fg.mailer) { 
    // Thunderbird will handle "simple" clicks through Firefox
    $("tab-downloads").setAttribute("collapsed","true");
  }
  
  g_downloadManagers = $("downloadManagers");
  g_opts = $$("checkbox");
  
  fgo_populateDMS();

  g_extList = $("ext-list");
  g_extText = $("ext-text");
  g_extList.removeItemAt(0);

  for (var e of fg.extensions) {
    if (e) g_extList.appendItem(e, e);
  }
  g_extDirty = false;
  
  uiUtils.visitCheckboxes(
    function(prefName, inverse, checkbox) {
      var val = fg.getPref(prefName);
      checkbox.checked = inverse ? !val : val;
    }
  );

  g_pyLoadUrl = $("pyLoad-url");
  g_pyLoadUrl.value = fg.getPref("dmsopts.pyLoad.url");
  
  g_referrerRadio=$("referrer-radio");
  g_referrerText=$("referrer-text");
  g_referrerRadio.selectedIndex=fg.getPref("autoReferrer") ? 0 : 1;
  g_referrerText.value=fg.getPref("fakeReferrer","");
  fgo_syncReferrer();
  g_referrerRadio.addEventListener("select", fgo_syncReferrer, true);
  
  
  g_downloadManagers.addEventListener("popuphidden", fgo_syncDMOptions, true);
  try {
    g_tmpDir = fg.prefs.getComplexValue("tmpDir", CI.nsILocalFile);
  } catch(ex) {
     g_tmpDir = fg.tmpDir.parent;
  }
  if(g_tmpDir) {
    $("tmpdir-text").value =g_tmpDir.path;
  }
  
  $("interception-rg").selectedItem=
    $("intercept"+
      (fg.getPref("interceptAll")?"All":"Ext")+"-radio");
}

function fgo_populateDMS(name) {
 
  const dms = fg.DMS;
  const dmArray = [].concat(dms);
  const dmList = g_downloadManagers;
  const mediaList = $("media-dmList");
  
  var menuItem = mediaList.selectedItem; 
  var mediaDM = menuItem ? menuItem.value && menuItem.label : fg.getUPref("media.dm", ""); 
  
  const map = g_cust.map;
  var dm;
  for(var p in map) {
    dm = map[p];
    if (dm._deleted) {
      if (dm.name === mediaDM) mediaDM = "";
      continue;
    }
    if (!(dm._deleted || p in dms) ) {
      dmArray.push(map[p]);
    }
  }
  
  var defaultDM = fg.defaultDM;
  if(!name) name = defaultDM;

  [dmList, mediaList].forEach(function(l) { l.removeAllItems(); l.selectedItem = null });
  
  const mediaDMS = [];
  
  for(var j = 0, len = dmArray.length, found = false, custom; j < len; j++) {
    dm = dmArray[j];
    if((custom = g_cust.createEntry(dm, false)) && custom._deleted) {
      continue;
    }
    
    menuItem = dmList.appendItem(dm.name, dm.codeName);
    
    if (dm.supported) {
      if(!found) {
        found = (name === dm.name);
        if (found || !g_downloadManagers.selectedItem) {
          dmList.selectedItem = menuItem;
          defaultDM = dm.name;
        }
      }
      mediaDMS.push(dm);
    } else {
      if (dm.name === mediaDM) mediaDM = "";
      if (!dm.shouldList()) menuItem.setAttribute("disabled", "true");
    }
  }
  
  menuItem = mediaList.appendItem(fgo_mediaDefaultLabel(defaultDM), '');
  if (!mediaDM)  mediaList.selectedItem = menuItem;
  
  for (dm of mediaDMS) {
    menuItem = mediaList.appendItem(dm.name, dm.codeName);
    if (dm.name === mediaDM || !(mediaDM || dm.codeName)) {
      mediaList.selectedItem = menuItem;
    }
  }
  
  if(g_downloadManagers.selectedItem) {
    $("nodms").setAttribute("collapsed", "true");
  } else {
    g_downloadManagers.selectedItem=g_downloadManagers.appendItem("---", null);
    $("nodms").removeAttribute("collapsed");
  }
  
  fgo_syncDMOptions();
}

function fgo_interceptionSelected(rg) {
  $('extensions-box').style.visibility=
    rg.selectedItem && rg.selectedItem.id=='interceptAll-radio' ? "hidden":"visible";
}

function fgo_syncDMOptions() {
  const dmrx = g_downloadManagers.value ?
    new RegExp("\\b" + g_downloadManagers.value + "\\b")
    :null;
  const dmopts = document.getElementsByAttribute("class", "dm-opt");
  var dmid, dmopt;
  for(var j = dmopts.length; j-->0;) {
    dmopt = dmopts[j];
    if(dmrx) {
      dmid = dmopt.id;
      if(dmid) {
        dmopt.setAttribute("hidden", dmid.match(dmrx) ? "false" : "true" );
      }
    } else {
      dmopt.setAttribute("hidden", "true" );
    }
  }
  var dmName = fgo_currentDmName();
  $("shownInContextMenu").checked = dmName && ((dmName in shownInContextMenu) 
    ? shownInContextMenu[dmName] : fg.DMS[dmName].shownInContextMenu);

  g_cust.syncUI();
}

function fgo_syncReferrer() {
  if(g_referrerRadio.selectedIndex == 1) {
    g_referrerText.removeAttribute("disabled");
  } else {
    g_referrerText.setAttribute("disabled","true");
  }
}
function fgo_enable(id,enabled) {
  var b=$(id);
  if(enabled) {
    b.removeAttribute("disabled");
  } else {
     b.setAttribute("disabled","true");
  }
}

function fgo_extText_changed() {
  var enable;
  var value = g_extText.value;
  try {
    if((!g_extText.disabled) &&
      /^[\w\-]+$/.test(value)) {
        enable = true;
        for(var j = g_extList.getRowCount();
            j-- >0 && (enable = g_extList.getItemAtIndex(j).value != value)
            ;);
    } else {
      enable = false;
    }
  } catch(e) {
    dump(e + "\n" + j + "\n");
  }
  fgo_enable("ext-add-button", enable);
}

function fgo_extList_changed() {
  fgo_enable("ext-remove-button", g_extList.selectedCount > 0);
  fgo_extText_changed();
}

function fgo_ext_add() {
  if (g_extList.getRowCount()) {
    g_extList.insertItemAt(0, g_extText.value, g_extText.value);
  } else {
    g_extList.appendItem(g_extText.value, g_extText.value);
  }
  fgo_extText_changed();
  g_extDirty = true;
}

function fgo_ext_remove() {
  const selectedItems = g_extList.selectedItems;
  for(var j = selectedItems.length; j--> 0;) {
    g_extList.removeItemAt(g_extList.getIndexOfItem(selectedItems[j]));
  }
  g_extDirty = true;
}

function fgo_currentDmName() {
  var dmName;
  return g_downloadManagers.selectedItem && (dmName = g_downloadManagers.selectedItem.getAttribute("label"))
    && fg.DMS[dmName] && fg.DMS[dmName].supported && dmName || null;
}

function fgo_mediaDefaultLabel(defaultDM) {
  return fg.getString("media.defaultDM", [(defaultDM || '---').replace(/[\(\)]/g, '')]);
}

function fgo_dmSelected() {
  var menuItem = $("media-dmList").getItemAtIndex(0);
  if (menuItem) menuItem.label = fgo_mediaDefaultLabel(fgo_currentDmName());
}

function fgo_save() {
  if(!fg) return true;
  
  uiUtils.visitCheckboxes(
    function(prefName, inverse, checkbox) {
      fg.setPref(prefName, inverse ? !checkbox.checked : checkbox.checked);
    }
  );
  
  g_cust.save();
  
  
  var dmName;
  for(dmName in shownInContextMenu) {
    fg.DMS[dmName].shownInContextMenu = shownInContextMenu[dmName];
  }
  
  dmName = fgo_currentDmName();
  if(dmName) {
    fg.defaultDM = dmName;
  }
  
  var mediaList = $("media-dmList");
  var menuItem = mediaList.selectedItem;
  fg.setUPref("media.dm", menuItem && menuItem.value ? menuItem.label : "");
  
  if (g_extDirty) {
    const extensions = [];
    for(var j = g_extList.getRowCount(); j-- > 0;) {
      try {
        extensions.push(g_extList.getItemAtIndex(j).value);
      } catch(e) {
        dump(e + "\n" + j + "\n");  
      }
    }
    fg.extensions = extensions;
  }

  fg.setPref("dmsopts.pyLoad.url",g_pyLoadUrl.value);
  
  fg.setPref("autoReferrer",g_referrerRadio.value=="true");
  fg.setPref("fakeReferrer",g_referrerText.value);
  if(g_tmpDir) {
    try {
      if (g_tmpDir.equals(fg.directoryService.get("TmpD", CI.nsILocalFile))) {
        fg.prefs.clearUserPref("tmpDir");
      } else {
        fg.prefs.setComplexValue("tmpDir", CI.nsILocalFile, g_tmpDir);
      }
    } catch(e) {
      
    }
  }
  fg.setPref("interceptAll",$("interceptAll-radio").selected);
  try {
    if(g_wellGetPath) {
      fg.prefs.setComplexValue("WellGet.path", CI.nsILocalFile, g_wellGetPath); 
    } else {
      if(fg.prefs.prefHasUserValue("WellGet.path")) fg.prefs.clearUserPref("WellGet.path");
    }
  } catch(ex) {
    dump(ex);
  }
  fg.savePrefs();
  return true;
  
}

function fgo_showLog() {
  try {
    fg.logWatch();
    open(fg.logURI.spec, "_FlashGot_LOG_");
  } catch(ex) { dump(ex.message); }
}


function fgo_clearLog() {
  fg.clearLog();
}

function fgo_browseTmpDir() {
  const fp = CC["@mozilla.org/filepicker;1"].createInstance(CI.nsIFilePicker);
  const title="FlashGot - "+$("tmpdir-label").value;
  fp.init(window, title, CI.nsIFilePicker.modeGetFolder);
  try {
    fp.displayDirectory = g_tmpDir == null ? fg.tmpDir.parent : g_tmpDir;
  } catch (ex) { fg.log(ex); }
  fp.appendFilters(CI.nsIFilePicker.filterAll);
  if (fp.show()==CI.nsIFilePicker.returnOK) {
    g_tmpDir = fp.file.QueryInterface(CI.nsILocalFile);
    $("tmpdir-text").value = g_tmpDir.path;
    $("tmpdir-warning").style.visibility="visible";
  }
}

function fgo_browseWellGet(reset) {
  if(reset) {
    g_wellGetPath = null;
    $("wellget-text").value = "";
    return;
  }
  
  const fp = CC["@mozilla.org/filepicker;1"].createInstance(CI.nsIFilePicker);
  const title="FlashGot - "+$("wellget-label").value;
  fp.init(window, title, CI.nsIFilePicker.modeOpen);
  fp.appendFilters(CI.nsIFilePicker.filterApps);
  if(!g_wellGetPath) {
    g_wellGetPath = fg.profDir.clone();
    g_wellGetPath.QueryInterface(CI.nsILocalFile)
                .initWithPath(g_wellGetPath.path.substring(0,3));
    g_wellGetPath.append("WellGet.exe");
  }
  try {
    fp.displayDirectory = g_wellGetPath.parent;
    fp.defaultString = g_wellGetPath.leafName;
  } catch (ex) { fg.log(ex); }
 
  if (fp.show() == CI.nsIFilePicker.returnOK) {
    var f = fp.file.QueryInterface(CI.nsILocalFile);
    if(!(f.exists() && f.isExecutable() &&
        f.path.substring(0,1).toUpperCase() == 
        fg.profDir.path.substring(0,1).toUpperCase())) {
      CC["@mozilla.org/embedcomp/prompt-service;1"]
                .getService(CI.nsIPromptService)
                .alert(window, "FlashGot / WellGet", 
                  fg.getString("wellget.mustBeSameDrive", 
                            [fg.profDir.path.substring(0,1)]));
      return;
    }
    g_wellGetPath = f;
    $("wellget-text").value = f.path;
    fg.DMS["WellGet"]._supported = null;
  }
}

var shownInContextMenu = {};
function fgo_shownInContextMenuClicked(cbx) {
  var dmName = fgo_currentDmName();
  if(dmName) shownInContextMenu[dmName] = cbx.checked;
}

function fgo_detectNow() {
  fg.DMS = fg.checkDownloadManagers(true, true);
  fgo_populateDMS();
}


