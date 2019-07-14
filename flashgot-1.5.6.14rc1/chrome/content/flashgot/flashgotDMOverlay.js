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


var gFlashGotDMDialog = null;

function FlashGotDMDialog() {
  gFlashGotDMDialog = this;

  this.url = dialog.mLauncher.source.spec;
  
  
  
  try {
    this.openerDocument = dialog.mContext.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
      .getInterface(Components.interfaces.nsIDOMWindow).document;
  } catch(ex) {
    this.openerDocument = top.opener && top.opener.content && top.opener.content.document || null;
  }
  
  try {
      this.referrer = dialog.mContext.QueryInterface(
        Components.interfaces.nsIWebNavigation).currentURI.spec;
  } catch(ex) {
     this.referrer = this.openerDocument && this.openerDocument.URL || this.url;
  }
  
  
  this.dialog = dialog;
  

  this.fname = dialog.mLauncher.suggestedFileName;
  var ext = this.fname.split('.');
  this.ext = ext.length > 0 ? ext[ext.length -1].toLowerCase() : "";
  this.extensionExists = gFlashGotService.extensions.indexOf(this.ext) > -1;
  const itc = gFlashGotService.interceptor;
  
  
  if(itc.lastPost) {
    gFlashGotService.log("Recent post info found: " + itc.lastPost + ", " +
                         itc.lastPost.URI.spec + " VS " + this.url + ", " +
                         itc.lastPost.isPending() +
                         ", " + (itc.lastPost.URI == dialog.mLauncher.source));
    if(itc.lastPost.URI.spec == this.url &&
       (itc.lastPost.isPending() || itc.lastPost.URI == dialog.mLauncher.source)) {
      this.postChannel = itc.lastPost;
    }
  }
  
  if(gFlashGotService.DMS.found && (!itc.bypassAutoStart)
      && (itc.forceAutoStart
          || ( itc.autoStart
            && (itc.interceptAll
                || this.extensionExists)))) {
    this.download();
    return;
  }

  window.setTimeout(function() { gFlashGotDMDialog.init(); }, 0);
  
  if(typeof(ReGetDmDialog) != "undefined") {
    ReGetDmDialog.prototype.init = function() {};
    document.getElementById("regetRadio").style.display = "none";
    document.getElementById("regetBasic").style.display = "none";
  }
  
  this.forceNormal();
}

FlashGotDMDialog.prototype = {
  get choosen() {
    return gFlashGotService.getPref("dmchoice", false);
  }, 
  set choosen(v) {
    gFlashGotService.setPref("dmchoice", v);
    return v;
  },
  
 
  remember: null,
  choice: null,
  check: null,

  forceNormal: function(secondChance) {
    var basicBox = document.getElementById('basicBox');
    var normalBox = document.getElementById('normalBox');
    var self = this;
    if ((normalBox && basicBox)) {
      if (normalBox.collapsed && basicBox.collapsed && !secondChance) {
        window.setTimeout(function() { self.forceNormal(true); }, 10);
        return;
      }
      if (normalBox.collapsed) {
        
        var e = document.getElementById('open');
        e.parentNode.collapsed = true;
        e.disabled = true;
        
        var nodes = normalBox.getElementsByTagName('separator');
        for (var j = nodes.length; j-- > 0;) {
          nodes[j].collapsed = true;
        }
        
        basicBox.collapsed = true;
        normalBox.collapsed = false;
      }
    }
    self.sizeToContent();
  },
  
  sizeToContent: function() {
    return window.sizeToContent();
    try {
      window.sizeToContent();
    } catch(e) {
      dump(e + "\n");
      try {
				var btn = document.documentElement.getButton('accept');
				window.innerHeight = btn.boxObject.y + 10; 
			}
			catch (e) {
				dump(e + "\n");
			}		
    }
    var boxes = document.getAnonymousNodes(document.documentElement);
    var h = 48; // margin
    var w = 0;
    var bo;
    for (var j = boxes.length; j-- > 0;) {
      bo = boxes[j].boxObject;
      h += bo.height;
      w = Math.max(w, bo.width);
    }
    w += 48; // margin

    h = Math.max(window.outerHeight, h);
    w = Math.max(window.outerWidth, w);
    window.resizeTo(window.outerWidth, h);
    if (window.outerWidth < w || window.outerHeight < h) 
      window.resizeTo(w, h);
  },
  
  init: function() {
    
    const dmsMenu = this.dmsMenu = document.getElementById("flashgot-dms");
      
    this.remember = document.getElementById("rememberChoice") || document.getElementById("alwaysHandle");
    if(this.remember) {
      this.remember.collapsed = false;
      if(this.remember.id == "rememberChoice" && 
        this.remember.parentNode.previousSibling &&
        this.remember.parentNode.previousSibling.nodeName == "separator") {
        this.remember.parentNode.previousSibling.collapsed = false;
      }
    }
   
    
    this.choice = document.getElementById("flashgot-dmradio");
    this.check = document.getElementById("flashgot-dmcheck");

    const dms = gFlashGotService.DMS;
    if(!dms.found) {
      this.choice.setAttribute("disabled", "true");
      if(this.check) this.check.setAttribute("disabled", "true");
      dmsMenu.setAttribute("collapsed", "true");
      return;
    }
    const defaultDM = gFlashGotService.defaultDM; 
    
    

    var menuItem;
    var enabledDMSs=0;
    dmsMenu.removeAllItems();
    var dm;
    for(var j=0, len = dms.length; j<len; j++) {
      dm=dms[j];
      if(dm.supported) {
        enabledDMSs++;
        menuItem=dmsMenu.appendItem(dm.name, dm.codeName);
        if(defaultDM==dm.name) {
          dmsMenu.selectedItem=menuItem;
        }
      }
    }
    
    const modeRadioGroup=document.getElementById("mode");
    
    if(enabledDMSs < 2) {
      dmsMenu.setAttribute("collapsed","true");
    } else {
      dmsMenu.addEventListener("popuphidden", function() {
        gFlashGotDMDialog.toggleChoice();
      }, true);
      
      const openRadio = document.getElementById("open");
      if(openRadio) {
        var maxWidth = Math.max(
          openRadio.boxObject.width, this.choice.boxObject.width
        );
        if(maxWidth > 0) openRadio.width = this.choice.width = maxWidth;
      }
    }
    
    if(this.choosen) {
      if(this.remember) this.remember.checked = this.extensionExists && gFlashGotService.interceptor.autoStart;
      document.getElementById("mode").selectedItem = this.choice;
      if(this.check) this.check.checked = true;
    }
    
    this.toggleChoice();
    modeRadioGroup.addEventListener(
      "select", function(event) {
        gFlashGotDMDialog.toggleChoice(event)
      },true);
    
    var d = document.documentElement;
    d.setAttribute('ondialogaccept',
      'if(gFlashGotDMDialog.dialogAccepted()) { '
      + document.documentElement.getAttribute('ondialogaccept')
      +'}');
      d.setAttribute("onblur", "if(dialog) {" + d.getAttribute("onblur") + " }");
  }
,
  toggleChoice: function() {
    var dmchoice = document.getElementById("mode").selectedItem == this.choice;
    
    this.choosen = dmchoice;
    var remember = this.remember;
    
    if(dmchoice) {
      this.dmsMenu.removeAttribute("disabled");
      window.setTimeout(
        function() { 
          document.documentElement.getButton('accept').disabled = false;
        }, 10);
      if(remember) {
        remember.disabled = false;
      }
    } else {
      this.dmsMenu.setAttribute("disabled", true);
    }
  }
,
   dialogAccepted: function() {
    if(this.choosen) {
      if(this.remember && this.remember.checked) {
        gFlashGotService.addExtension(this.ext);
        gFlashGotService.interceptor.autoStart = true;
      }
      if(this.dmsMenu.selectedItem) {
        gFlashGotService.defaultDM = this.dmsMenu.selectedItem.getAttribute("label");
      }
      this.download();
      return false;
    } else {
      return true;
    }
  }
,
  download: function() {
    var links=[ {
       href: this.url, 
       description: this.fname,
       fname: this.fname,
       noRedir: true
    } ];
    links.referrer = this.referrer;
    links.document = this.openerDocument;
    links.browserWindow = gFlashGotService.getBrowserWindow(links.document);
    if(this.postChannel) {
      gFlashGotService.interceptor.extractPostData(this.postChannel, links);
    }
    gFlashGotService.download(links);
    with(document.documentElement) {
      removeAttribute('ondialogaccept');
      removeAttribute('onblur');
      removeAttribute('onfocus');
      cancelDialog();
    }
  }
}

window.addEventListener("load",  function(e) { new FlashGotDMDialog(); }, false);



