var $ = function(id) { return document.getElementById(id); }
var $$ = function(tag) { return document.getElementsByTagName(tag); }

function UIUtils(serv) {
  this.serv = serv;
}
UIUtils.prototype = {
  tabselPrefName: "options.tabSelectedIndexes",
  resumeTabSelections: function() {
    var info = window.arguments && window.arguments[0];
    var indexes = info && info.tabselIndexes ||
                  this.serv.getPref(this.tabselPrefName, "").split(/\s*,\s*/);
    // select tabs from external param
    
    var tabs = $$("tabs");
    var tcount = Math.min(tabs.length, indexes.length);
    var self = this;
    var listener = function(ev) { self.persistTabSelections(); }
    for(var t = tabs.length; t-- > 0;) {
      try {
        tabs[t].selectedIndex = parseInt(indexes[t]) || 0;
      } catch(e) {}
      tabs[t].addEventListener("select", listener, false); 
    }
    this.persistTabSelections();
    
    if (info && info.callback) {
      window.setTimeout(info.callback, 0);
    }
  },
  
  persistTabSelections: function() {
    var tabs = $$("tabbox");
    var ss = [];
    for(var tcount = 0; tcount < tabs.length; tcount++) {
      ss.push(tabs[tcount].selectedIndex);
    }
    this.serv.setPref(this.tabselPrefName, ss.join(","));
  },
  
  visitCheckboxes: function(callback) {
    const rxOpt=/^(inv|moz|)opt-(.*)/;
    var j, checkbox, match;
    const opts = $$("checkbox");
    for(j = opts.length; j-- > 0;) {
      checkbox = opts[j];
      if((match = checkbox.id.match(rxOpt))) {
        callback(match[2], match[1] == "inv", checkbox, match[1] == "moz");
      }
    }
  },
  
  visitTextboxes: function(callback) {
    const rxOpt=/^opt-(.*)/;
    var j, box, match;
    const opts = $$("textbox");
    for(j = opts.length; j-- > 0;) {
      box = opts[j];
      if((match = box.id.match(rxOpt))) {
        callback(match[1], box);
      }
    }
  },
  
  syncGroup: function(caption) {
    var b = !caption.checked;
    var node = caption.parentNode;
    while((node = node.nextSibling)) {
      node.disabled = b;
    }
  },
  
  moveButtonsDown: function() {
    var ref = document.documentElement.getButton("extra2");
    Array.slice(arguments, 0).forEach(function(s) {
      var b;
      if (s) {
        b = $(s);
        b.className = ref.className;
      } else {
        b = document.createElement("spacer");
        b.setAttribute("flex", "1");
      }
      ref.parentNode.insertBefore(b, ref);
      b.hidden = false;
    });
  }
};
