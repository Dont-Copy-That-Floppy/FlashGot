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

function FlashGotGalleryBuilder() {}

FlashGotGalleryBuilder.INTERVAL_RX=/\[\s*(\d+)\s*-\s*(\d+)\s*(;{0,1}\s*\d*)\s*\]/;
FlashGotGalleryBuilder.INTERVAL_AZ_RX=/\[\s*([a-z]{1})\s*-\s*([a-z]{1})\s*(;{0,1}\s*\d*)\s*\]/i;
FlashGotGalleryBuilder.EXPR_RX=/\[\s*([\w]+)\s*\((.*?)\)\s*\]/i;

FlashGotGalleryBuilder.prototype = {
  
  urlsTableModel: {
    selection: null,
    data: [],
    get rowCount() { return this.data.length; },
    getCellText: function(row, col) {
      return this.data[row][col.id?col.id:col];
    },
    setTree: function(treeBox) { this.treeBox = treeBox; },
    isContainer: function(index) { return false; },
    isSeparator: function(index) { return false; }, 
    isSorted: function() { return false; },
    getLevel: function(index) { return 0; },
    getImageSrc: function(row, col) {
      return null;
    },
    getCellProperties: function(row, col, props) {},
    getColumnProperties: function(column, elem, prop) {}, 
    getRowProperties: function(row, props) { },
  
    isContainerOpen: function(index) { },
    isContainerEmpty: function(index) { return false; },
    canDropOn: function(index) { return false; },
    canDropBeforeAfter: function(index, before) { return false; },
    drop: function(row, orientation) { return false; },
    
    getParentIndex: function(index) { return 0; },
    hasNextSibling: function(index, after) { return false; },
    getProgressMode: function(row, column) { },
    getCellValue: function(row, column) { },
    toggleOpenState: function(index) { },
    cycleHeader: function(col, elem) { },
    selectionChanged: function() {
      try {
        gFlashGotGB.urlsPreviewDoc.getElementById(
            FlashGotGalleryHTML.prototype.galleryId).innerHTML =
            this.data[this.selection.currentIndex].html;
      } catch(ex) {
      } 
    },
    cycleCell: function(row, column) { },
    isEditable: function(row, column) { return false; },
    performAction: function(action) { },
    performActionOnRow: function(action, row) { },
    performActionOnCell: function(action, row, column) { }
  },
  
  sandbox: Components.utils.Sandbox ? Components.utils.Sandbox("about:") : null,
  expressions: {},
  selectedExprName: null,
  onload: function() {
    try {
      var data=window.arguments[0];
      this.previewTextBox.value=data.previewURL;
      this.contentTextBox.value=data.contentURL;
      this.referrerTextBox.value=data.referrerURL;
      this.originalWindow=data.originalWindow;
      this.tmpDir=data.tmpDir;
      this.prefs=data.prefs;
      this.filePath=null;
      if(this.sandbox) {
        try {
          this.expressions = Components.utils.evalInSandbox(this.prefs.getCharPref("buildGallery.expressions"), this.sandbox);
          // Gecko 31: functions and some other types are not visible by default anymore.
          // See https://developer.mozilla.org/en-US/docs/Xray_vision
          if (this.expressions && Components.utils.waiveXrays) {
            this.expressions = Components.utils.waiveXrays(this.expressions);
          }
        } catch(ex) {}
        if(typeof(this.expressions)!="object" || !this.expressions) this.expressions = {};
      } else {
        document.getElementById("flashgotGB-expr-tab").setAttribute("disabled", "true");
      }
      this.normalizeURL(this.previewTextBox);
      this.normalizeURL(this.contentTextBox);
      
      function fixColLabel(id) {
        var col = document.getElementById(id + "Col");
        col.setAttribute("label",col.getAttribute("label").replace(/:/g,""));
      }
      fixColLabel("preview");
      fixColLabel("content");
      this.urlsTable.view = this.urlsTableModel;
      this.validateURLs();
      document.getElementById("mainTabs").setAttribute("onselect","gFlashGotGB.tabSelected(event)");
    } catch(e) {
      gFlashGotService.log(e);
      window.dump(e);
      this.dialog.cancelDialog();
    }
    
  }
,
  saveExpressions: function() {
    if(typeof(this.expressions)=="object" && this.expressions) {
      this.prefs.setCharPref("buildGallery.expressions",this.expressions.toSource());
    }
  }
,
  get dialog() {
    return document.documentElement;
  }
,
  get previewBase() {
    return this.trim(this.previewTextBox.value);
  }
, get contentBase() {
    return this.trim(this.contentTextBox.value);
  }
, get referrer() {
    return this.trim(this.referrerTextBox.value);
  }
,
  get previewTextBox() {
    return document.getElementById("flashgotGB-preview-text");
  }
,  
  get contentTextBox() {
    return document.getElementById("flashgotGB-content-text");
  }
,
  get referrerTextBox() {
    return document.getElementById("flashgotGB-referrer-text");
  }
, 
  get urlsTable() {
    return document.getElementById("flashgotGB-urlsTable");
  }
,
  get urlsPreviewDoc() {
    return document.getElementById("flashgotGB-urls-preview").contentDocument;
  }
,
  get exprListBox() { 
    return document.getElementById("flashgotGB-expr-list");
  }
,
  get exprTextBox() {
    return document.getElementById("flashgotGB-expr-text");
  }
,
  trim: function(s) {
    return s.replace(/^\s+/g,"").replace(/\s+$/g,"");
  }
, 
  checkIntervals: function(url) {
    return url.search(FlashGotGalleryBuilder.INTERVAL_RX)>-1 || url.search(FlashGotGalleryBuilder.INTERVAL_AZ_RX)>-1;
  }
,
  normalizeURL: function(textBox) { 
    var url=textBox.value;
    var hasIntervals=this.checkIntervals(url);
    if(!hasIntervals) {
      url=url.replace(/(\{|\(|<)/g,"[").replace(/(\}|\)|>)/g,"]");
      textBox.value=this.checkIntervals(url)
        ?url
        :textBox.value.replace(/(\d+)/g,"[$1-$1;1]");
      }
  }
,  
  validateURLs: function() {

    var htmlBuilder = new FlashGotGalleryHTML(this);
   
    var valid = htmlBuilder.valid;
    this.dialog.getButton("accept").setAttribute("disabled", !valid);
    const model= this.urlsTableModel;
    model.treeBox.rowCountChanged(0, -model.data.length);
    const urlList = model.data = [];

    if(valid) {
      for(var html; html = htmlBuilder.nextFragment();) {
        urlList[urlList.length] = {
          html: html,
          previewCol: htmlBuilder.currentPreviewURL,
          contentCol: htmlBuilder.currentContentURL
        }
      }
      model.treeBox.rowCountChanged(0, urlList.length);
    }
    
    
    const exprListBox=this.exprListBox;
    const selectedExprName=this.selectedExprName;
    exprListBox.setAttribute("suppressonselect","true");
    while(exprListBox.getRowCount()>0) exprListBox.removeItemAt(0);
    const exprNames=htmlBuilder.exprNames;
    var selectedItem=null;
    var len=exprNames.length;
    for(var j=0; j<len; j++) {
      item=exprListBox.appendItem(exprNames[j]);
      if(selectedItem==null || item.label==selectedExprName) selectedItem=item;
    }
    
    if(selectedItem) {
      exprListBox.selectItem(selectedItem);
    }
    this.exprSelected();
    
    exprListBox.removeAttribute("suppressonselect");

  }
,
  synchronizePreview: function() {
    this.synchronizeIntervals(this.contentTextBox,this.previewTextBox,
    { rx: /\.(mpg|mp4|gvi|flv|swf|mpeg|wmv|avi|mov|divx|ogm)$/i, ext: ".jpg" });
  }
,
  synchronizeContent: function() {
    this.synchronizeIntervals(this.previewTextBox,this.contentTextBox,
    { rx: /\.(jpg|jpeg|gif|png|bmp)$/i, ext: ".mpg" });
  }
,
  synchronizeIntervals: function(srcBox,dstBox,extFix) {
    var dst=this.trim(dstBox.value);
    if(dst=="") {
      dst=srcBox.value.replace(extFix.rx,extFix.ext);
    } else {
      var isrc=new FlashGotGalleryIterator(this.trim(srcBox.value));
      var idst=new FlashGotGalleryIterator(dst);
      dst="";
      var src=""
      while(isrc && idst && isrc.valid && idst.valid) {
        dst=dst.concat(
            idst.base.substring(0,idst.match.index)
          ).concat(
            isrc.match[0]
          );
         isrc=isrc.delegate;
         idst=idst.delegate;
      }
    }
    if(idst) dst=dst.concat(idst.base);
    dstBox.value=dst;
    this.validateURLs();
  }
,
  build: function() {
    var htmlBuilder=new FlashGotGalleryHTML(this);
  
    const cc=Components.classes;
    const ci=Components.interfaces;
   
    const galFile=cc["@mozilla.org/file/local;1"].createInstance(ci.nsILocalFile);
    galFile.initWithPath(this.tmpDir.path);
    galFile.append("flashgotGB.html");
    galFile.createUnique(0,-1);
    
    this.filePath=galFile.path;
    
    const os=cc["@mozilla.org/network/file-output-stream;1"].createInstance(
      ci.nsIFileOutputStream);
    
    try {
      os.init(galFile,0x02,-1,0);
      
      var html = htmlBuilder.header; 
      os.write(html, html.length);
      
      while( (html = htmlBuilder.nextFragment()) ) {
        os.write(html, html.length);
        if(!htmlBuilder.valid) break;
      }
      
      html = htmlBuilder.footer;
      os.write(html,html.length);
    
    } finally {
      os.close();
    }
    
    var w = this.originalWindow;
    var url = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService).newFileURI(galFile).spec;
    if(typeof(w.messenger)=="object" && w.messenger.OpenURL) { 
      // Thunderbird
      w.messenger.OpenURL(url);
    } else if(w.closed) {
      w = window.open(url, "_blank");
    } else {
      var browser = w.getBrowser();
      browser.selectedTab = browser.addTab(url);
    }
  }
,
  createExpression: function(text) {
    function create_in_sandbox(text) {
      var expr = { text: text };
      try {
        // Function() creates a named function ("anonymous"),
        // but gives "better" syntax errors than eval() except
        // when it's an unmatched closing curly bracket "}".
        // In the latter case, it gives the line number of the
        // preceeding parsed contruct, i.e. the parser eats
        // whitespace without incrementing the line number,
        // e.g. "return 123;\n}" reports the "virtual" line
        // number 1 and not 2, and "return 123;\n\n\n\n\n}"
        // reports the "virtual" line number 1 as well.
        expr.func = new Function("", text); //eval("(function(){" + text + "\n});");
        expr.err = null;
      } catch(err) {
        expr.err = err;
      }
      return expr;
    }
    var expr = Components.utils.evalInSandbox(""
      + "var $f = " + create_in_sandbox + "\n;"
      + "var $t = String(" + text.toSource() + "\n);" // (new String("abc")) -> "abc".
      + "$f($t);"
      , this.sandbox);
    // Gecko 31: functions and some other types are not visible by default anymore.
    // See https://developer.mozilla.org/en-US/docs/Xray_vision
    if (expr && Components.utils.waiveXrays) { expr = Components.utils.waiveXrays(expr); }
    // Get the source line number and text.
    // Depends on how buggy the JS parser is - see the comment in the try block.
    var err = expr && expr.err;
    if (err && err.lineNumber != null && arguments.callee.caller != null && arguments.callee.caller !== arguments.callee) {
      // Compile/eval something that gives a syntax error in line 1.
      var tmpExpr = this.createExpression(":");
      if (tmpExpr && tmpExpr.err && tmpExpr.err.lineNumber != null) {
        var lines = text.split(/\r\n|\r|\n/);
        var sourceLineNumber = Math.min(lines.length - 1, err.lineNumber - tmpExpr.err.lineNumber);
        var sourceLine = lines[sourceLineNumber];
        // Ignore trailing empty lines, e.g. "-\n\n\n".
        for (var i = lines.length; ! sourceLine.length && i-- > 0; ) {
          sourceLine = lines[sourceLineNumber = i];
        }
        expr.errLineNumber = sourceLineNumber + 1;
        expr.errLineText = sourceLine;
      }
    }
    return expr;
  }
,
  func2Expr: function(func) {
    var f = func.toString();
    f=f.substring(f.indexOf('{')+1,f.lastIndexOf('}'));
    var indent=f.match(/^([ \t]+)\w/m);
    if(indent) {
      var spaces=indent[1];
      var rxSpaces=new RegExp(spaces,'g');
      f=f.replace(new RegExp('^'+spaces+'((?:'+spaces+')*)','mg'),
      function($0,$1) {
        return $1.replace(rxSpaces,' ');
      });
    }
    return f.replace(/^[\s]*\n/gm,'');
  }
,
  tabSelected: function(ev) {
    switch(ev.target.selectedItem.id) {
      case "flashgotGB-url-tab":
        this.exprChanged();
        this.validateURLs();
        break;
      case "flashgotGB-expr-tab":
          this.validateURLs();
          this.exprTextBox.focus();
    }
  }
,
  exprSelected: function() {
    const exprTextBox=this.exprTextBox;
    const exprDes=document.getElementById("flashgotGB-expr-des");
    const rxFxName=/\bfunction \w+\(/;
    const errorTextBox=document.getElementById("flashgotGB-expr-error-text");
    const selectedItem=this.exprListBox.selectedItem;
    this.exprChanged();
    if(!selectedItem) {
      this.selectedExprName=null;
      exprTextBox.value="";
      exprDes.value=exprDes.value.replace(rxFxName,"function fx(");
      exprTextBox.setAttribute("disabled",true);
      errorTextBox.value="";
    } else {
      exprTextBox.removeAttribute("disabled");
      const exprName=selectedItem.label;
      this.selectedExprName=exprName;
      const expr=this.expressions[exprName];
      exprTextBox.value=expr?expr.text:'return "";';
      exprDes.value=exprDes.value.replace(rxFxName,"function "+exprName+"(");
      this.exprChanged();
    }
  }
, 
  exprChanged: function() {
    const selectedExprName=this.selectedExprName;
    if(!selectedExprName) {
      this.exprTextBox.setAttribute("disabled",true);
    } else {
      this.exprTextBox.removeAttribute("disabled");
      var text=this.exprTextBox.value;
      var expr=this.expressions[selectedExprName];
      if(text.replace(/\s+/,'').length) {
        if( (!expr) || expr.text!=text) {
          expr = this.expressions[selectedExprName] = this.createExpression(text);
          this.saveExpressions();
        }
      } else if(expr) {
        delete this.expressions[selectedExprName];
        this.saveExpressions();
      }
    }
    this._hilightErrors();
  }
,
  _hilightErrors: function() {
    const exprList = this.exprListBox;
    exprList.style.background = "white";
    const item = exprList.selectedItem;
    if ( ! item) { return; }
    const expr = this.expressions[item.label];
    if ( ! expr) { return; }
    const err = expr.err;
    this.exprTextBox.style.color = item.style.color = err ? "red" : "black";
    const errTextBox = document.getElementById("flashgotGB-expr-error-text");
    errTextBox.value = err;
    if (err && expr.errLineNumber) {
      errTextBox.value += "\nLine: " + expr.errLineNumber;
      if (expr.errLineText) {
        errTextBox.value += ":\n" + expr.errLineText + "\n";
      }
    }
  }
}


function FlashGotGalleryHTML(builder) {
  this.builder=builder;
  this.previews=new FlashGotGalleryIterator(builder.previewBase);
  this.contents=new FlashGotGalleryIterator(builder.contentBase);
  var exprNames=[];
  var name,expr;
  
  for(var base=builder.previewBase.concat(builder.contentBase), match=null;
    match=base.match(FlashGotGalleryBuilder.EXPR_RX);
    base=base.substring(match.index+match[0].length)
    ) {
     exprNames[exprNames.length]=match[1];
  }
  const ee=builder.expressions;

  for(name in ee) {
    exprNames[exprNames.length]=name;
    expr=ee[name];
    this.env[name] = expr.func
      // FF 32.0.1: transfering (assigning) a function from one sandbox
      // to another doesn't work: typeof works, but calling it throws
      // "Permission denied to access object", and accessing its properties
      // (either explicitly or implicitly, e.g. in a string concatenation)
      // throws "Permission denied to access property '...'".
      // Creating a proxy function doesn't work either - |arguments| is
      // empty:
      //   function create_proxy_func(expr) {
      //     return function(){ return expr.func.apply(null, arguments); };
      //   }
      //   this.env[name] = expr.func ? create_proxy_func(expr) : ...;
      // So we have 2 options:
      // 1) create a new function in this sandbox.
      // 2) use one sandbox for everything: loading the functions from prefs
      // (FlashGotGalleryBuilder.onload), creating them from the editor text
      // (FlashGotGalleryBuilder.createExpression), and calling them
      // (FlashGotGalleryHTML.evalExpressions).
      ? new Function("", expr.text)
      : function() { throw new Error("["+name+"()]"+" not implemented!"); };
  }
  
  exprNames=exprNames.sort();
  for(var prevName=null, j=exprNames.length; j-->0;) {
    name=exprNames[j];
    if(name==prevName) exprNames.splice(j,1);
    else prevName=name;
  }
  this.exprNames=exprNames;
  this.buildDOM(this.builder.urlsPreviewDoc);
}

FlashGotGalleryHTML.prototype = {
  index: 0,
  env: Components.utils.Sandbox ? Components.utils.Sandbox("about:blank") : null,
  galleryId: "flashgotGB-gallery",
  xmlesc: function(s) {
    return s && s.replace(/[&"<>]/g, 
      function(c) { return { '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] }
    ) || "";
  }
,
  get headElementSource() {

    return '<head><title>' 
        + this.xmlesc(this.builder.referrer + " - "
            + this.builder.dialog.getAttribute('title')) 
        + '</title>\n'
        +'<style type="text/css">\n'
        +'body,div { font-family: verdana,arial,helvetica,sans-serif; '
        +'font-size: 10px; color: black; background: white }\n'
        +'a { color: blue; text-decoration: underline; }\n'
        +'</style></head>'
        ;
  }
, 
  get header() {
    const persist = {
      referrer: this.builder.referrer,
      preview: this.previews.base,
      content: this.contents.base
    };
    var h = this.headElementSource + '<body><div style="display: none">';
    for(var p in persist) {
      h += '<span id="' + p + '">' + this.xmlesc(persist[p]) + '</span>';
    }
    return h + '</div><div id="' + this.galleryId + '">';
  }
,  
  get footer() {
    return "\n</div></body>";
  }
,
  _eval: function(ctx, name, parm) {
    return Components.utils.evalInSandbox(name + "(" + parm + ")", ctx);
  }
,
  // evaluates macros and javascript functions
  _macroPattern: /\[\$(\d+)\]/g,
  evalExpressions: function(iterator) {
    var url = iterator.nextURL();
    if (!url) return url;
    const index = this.index;
    
    // macro evaluation
    url = url.replace(this._macroPattern, function(all, digits) {
      var n = parseInt(digits);
      const len = digits.length;
      var res;
      if (n == 0) {
         res = index.toString();
      } else {
        var delegate = iterator;
        while (n-- > 1 && delegate) delegate = delegate.delegate;
        if (!delegate) return all;
        res = delegate.renderedCursor;
        if (len > 0) res = res.toString().replace(/^0+/, "");
      }
      
      return len > 0
        ? digits.replace(/\d/g, '0').substring(0, len - res.length).concat(res)
        : res;
    });
    
    if(!(this.exprNames.length && this.env))  return url;
    
    // function evaluation
    var base = url;
    var evalURL = "";
    const ee=this.builder.expressions;
    const ctx = this.env;
    ctx.index = index;
    ctx.baseURL = base;
    
    var name, expr, subst, res;
    
    for(var match=null;
        match=base.match(FlashGotGalleryBuilder.EXPR_RX);
        base=base.substring(match.index + match[0].length)
    ) {
      name=match[1];
      expr=ee[name];
      subst=match[0];
      if(expr && expr.func) {
        try {
          res = this._eval(ctx, name, match[2]);
          if(res != null && typeof(res) != "undefined") {
            subst=res;
          }
          expr.err=null;
        } catch(err) {
          expr.err=err;
        }
      }
      evalURL+=base.substring(0,match.index).concat(subst);
    }
    evalURL+=base;
    return evalURL;
  }
,
  nextFragment: function() {
    this.index++;
    var p = this.currentPreviewURL = 
      this.evalExpressions(this.previews);
    var c = this.currentContentURL = 
      this.evalExpressions(this.contents);
    if( 
       (! (p || c) )
      || (p==null && !this.contents.valid) 
      || (c==null && !this.previews.valid) 
    ) {
      return null;
    }
    c = this.xmlesc(c);
    p = this.xmlesc(p);
    var html = p ? '<img src="' + p + '" alt="' + ( c ? c : "???" )+'" />': c + '<br />\n';
    if(c) html = '<a href="' + c + '">' + html + '</a>\n';
    return html;
  }
,
  get valid() {
    return this.previews.valid || this.contents.valid;
  }
,  
  reset: function() {
    this.previews.reset();
    this.contents.reset();
    this.index = 0;
  }
,
  buildDOM: function(doc) {
    if(!doc.getElementById(this.galleryId)) {
      doc.documentElement.innerHTML = this.headElementSource;
      doc.documentElement.appendChild(doc.createElement("body")
      ).appendChild(doc.createElement("div")).id = this.galleryId;
    }
  }

}


function FlashGotGalleryIterator(base) {
  this.base=base;
  var match=FlashGotGalleryBuilder.INTERVAL_RX.exec(this.base);
  var matchAZ=FlashGotGalleryBuilder.INTERVAL_AZ_RX.exec(this.base);
  if(match && ( (!matchAZ) || matchAZ.index>match.index) ) {
    var idx = match.index;
    this.isAZ = false;
    this.start = parseInt(match[1],10);
    this.end = parseInt(match[2],10);
    this.padding = "";
    for(var j=(this.end>this.start?match[1]:match[2]).length; 
      j-->0; 
      this.padding=this.padding.concat("0") 
      );
    this.valid=true;
  } else if((this.isAZ=((match=matchAZ)!=null))) {
    if(/[a-z]{1}/.test(match[1])) {
      match[2] = match[2].toLowerCase();
    } else {
      match[2] = match[2].toUpperCase();
    }
    this.start = match[1].charCodeAt(0);
    this.end = match[2].charCodeAt(0);  
    this.valid = true;
  } else {
    this.valid = false;
    return;
  }
  
  this.match = match;
  
  var stepMatch = this.match[3].match(/;\s*(\d+)/);
  this.step =  (stepMatch ? parseInt(stepMatch[1], 10) : 1) * (this.start <= this.end ? 1 : -1);
    
  this.cursor=this.start;
 
  this.delegate=new FlashGotGalleryIterator(
    this.match.input.substring(this.match.index+this.match[0].length)
    );
}
  
FlashGotGalleryIterator.prototype = {
  renderedCursor: "",
  reset: function() {
    this.cursor=this.start;
    if(this.delegate) this.delegate.reset();
  }
,
  nextURL: function() {
   
    if(!this.valid) return this.base;
    if(this.step==0
      || (this.step>0 && this.cursor>this.end)
      || (this.step<0 && this.cursor<this.end)) {
      return null;
    }
    
    var count;
    
    if(this.isAZ) {
      count=String.fromCharCode(this.cursor);
    } else {
      count=new String(this.cursor);
      if(count.length<this.padding.length) {
        count=this.padding.substring(count.length).concat(count);
      }
    }
    
    var delegatePart=this.delegate.nextURL();
    if(delegatePart==null || !this.delegate.valid) {
      this.cursor+=this.step;
      if(delegatePart==null) {
        this.delegate.reset();
        return this.nextURL();
      }
    }
    
    this.renderedCursor=count;
    
    return this.match.input.substring(0,this.match.index
      ).concat(count
      ).concat(delegatePart);  
   
  }
  
}

var gFlashGotGB=new FlashGotGalleryBuilder();

