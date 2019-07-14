var EXPORTED_SYMBOLS = ["LinkChooser"];
const {interfaces: Ci, classes: Cc, utils: Cu} = Components;

function LinkChooser(tree, links, filter, allChoosen) {
    this.tree = tree;
    this.links = links;
    
    
    Array.forEach(tree.getElementsByTagName("treecol"), function(c) {
      c.setAttribute("class", "sortDirectionIndicator");
    });
    
    let ms = Cc['@mozilla.org/uriloader/external-helper-app-service;1']
                     .getService(Ci.nsIMIMEService)
    let excludeURL = /(?:\.(?:(?:ph|js|as|)px?|[js]html?)|\/)(?:[?#]|$)/i;
    let excludeType = /html$/;
    let includeURL = /\/(?:download|file)s?\//i;
    let archive = /^(?:7z|rar|arj|gz|bz|tar)/i;
    const genericIcon = "moz-icon://goat.generic?size=16";
    const folderIcon = "moz-icon://goat.html?size=16";
    for (let j = links.length; j-- > 0;) {
      let l = links[j];
      let fname = l._fname = l.fname || l.href.split(/\/?[?#]/)[0].replace(/.*\//, '');
      let parts = fname.split(".");
      let ext = l._ext = parts.length > 1 ? parts[parts.length - 1] : "";
      
      if (l.contentType) {
        l._type = l.contentType;
      } else if (ext) {
        try {
          l._type = l.contentType || ms.getTypeFromExtension(ext);
        } catch (e) {
          l._type = "";
        }
      }
      if (l._type) {
        try {
            ext = ms.getPrimaryExtension(l._type, ext);
        } catch (e) {
            ext = "";
        }
      } else {
        l._type = ext ? "(" + ext + ")" : fname ? "???" : "/";
      }
      l._icon = ext ? "moz-icon://goat." + (archive.test(ext) ? "zip" : ext) + "?size=16"
        : fname ? genericIcon : folderIcon;
      l._choosen = allChoosen || includeURL.test(l.href) && !(excludeType.test(l._type) || !fname || excludeURL.test(l.href));
    }
    this.update();

    this.filterChanged(filter);
    
    this.sort();
    
    if (!this.filter) {
      this.selectAll();
    }
}

LinkChooser.prototype = {
  rows: null,
  filter: null,
  save: function() {
    let ll = this.links;
    for (let j = ll.length; j-- > 0;) {
      if (!ll[j]._choosen) ll.splice(j, 1);
    }
  },
  
  filterChanged: function(filter) {
    this.selection.clearSelection();
    if (!filter) {
      this.filter = null;
    }
    else {
      try {
        this.filter = new RegExp(filter);
      } catch (e) {
        try {
          this.filter = new RegExp(filter.replace(/[^\w\s]/g, '\\$&'), "i");
        } catch (e) {}
      }
      if (this.filter) {
        let rows = this.rows;
        let rx = this.filter;
        let s = this.selection;
        for (let j = rows.length; j-- > 0;) {
          let l = rows[j];
          if (rx.test(l._type + "*" + l.href))
            s.rangedSelect(j, j, true);
        }
      }
    }
  },
  
  cycleHeader: function(column) {
    let topRow = this.tree.treeBoxObject.getFirstVisibleRow();
    this.sort(column);
    if (topRow) this.tree.treeBoxObject.scrollToRow(topRow);
  },
  
  sort: function(column) {
    let tree = this.tree;
    var columnName;
    var order = tree.getAttribute("sortDirection") == "ascending" ? 1 : -1;
    if (column) {
      columnName = column.id;
      if (tree.getAttribute("sortResource") === columnName) {
        order *= -1;
      }
    } else {
      columnName = tree.getAttribute("sortResource");
    }
    
    if (!(columnName in this._propsMap))
      return;
    
    let prop = this._propsMap[columnName];
    
    let rows = this.rows;
    for (let j = rows.length; j-- > 0;) {
      let l = rows[j];
      let sortKey = l[prop];
      l._sortKey = (typeof sortkey === "string") ? sortKey.toLowerCase() : sortKey;
    }
    
    rows.sort(function(a, b) a._sortKey > b._sortKey ? 1 * order : a._sortKey < b._sortKey ? -1 * order : 0);
    
    let sortDirection = order === 1 ? "ascending" : "descending";
    
    tree.setAttribute("sortDirection", sortDirection);
    tree.setAttribute("sortResource", columnName);
    tree.view = this;
    
    var cols = tree.getElementsByTagName("treecol");
    for (let j = cols.length; j-- > 0;) {
      cols[j].removeAttribute("sortDirection");
    }
    try {
      tree.ownerDocument.getElementById(columnName).setAttribute("sortDirection", sortDirection);
    } catch (e) {
      dump("Failed at setting sortDirection on " + columnName);
    }
  },
  selectAll: function() {
    this.selection.selectAll();
    this.tree.focus();
  },
  invertSelection: function() {
    try {
      this.selection.invertSelection();
    } catch (e) {
      // not implemented?
      let s = this.selection;
      for (let j = this.rowCount; j-- > 0;) s.toggleSelect(j);
    }
    this.tree.focus();
  },
  choose: function(b) {
    let rows = this.rows;
    let s = this.selection;
    for (let j = rows.length; j-- > 0;) {
      if (s.isSelected(j)) rows[j]._choosen = b;
    }
  },
  chooseAll: function() {
    this.selectAll();
    this.choose(true);
  },
  
  update: function() {
    if (!this.rows) {
      this.rows = this.links;
    }
    this.tree.view = this;
  },
  
  get rowCount() this.rows.length,
  getCellText : function(row, column){
    var l = this.rows[row];
    var p = this._propsMap[column.id];
    return p ? l[p] : "";
  },
  
  _propsMap: {
    "links-url": "href",
    "links-name": "_fname",
    "links-type": "_type",
    "links-choosen": "_choosen",
  },
  
  getCellValue: function(row, column) column.id === "links-choosen" && this.rows[row]._choosen,
  setCellValue: function(row, column, value) {
    if (column.id === "links-choosen") {
      let b = value === "true" || value == 1;
      if (this.rows[row]._choosen !== b) {
        this.rows[row]._choosen = b;
        if (this.selection && this.selection.isSelected(row)) {
          this.choose(b);
        }
      }
    }
  },
  isEditable: function(row, column) column.id === "links-choosen",
  setTree: function(treebox) { this.treebox = treebox; },
  isContainer: function(row) false,
  isSeparator: function(row) false,
  isSorted: function() { return false; },
  getLevel: function(row) 0,
  getImageSrc: function(row, col) col.id === "links-type" && this.rows[row]._icon || "",
  
  getRowProperties: function(row,props) {},
  getCellProperties: function(row,col,props) {},
  getColumnProperties: function(colid,col,props) {}
}

