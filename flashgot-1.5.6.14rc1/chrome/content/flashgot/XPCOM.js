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

const SERVICE_CID = Components.ID(SERVICE_ID);
var SERVICE_INSTALLING = false;

const SERVICE_FACTORY = {
  get _instance() {
    delete this._instance;
    try {
      return this._instance = SERVICE_CREATE();
    } catch(e) {
      dump(e + "\n");
    }
    return null;
  },
  
  createInstance: function (outer, iid) {
    if (outer != null)
        throw Components.results.NS_ERROR_NO_AGGREGATION;

    xpcom_checkInterfaces(iid, SERVICE_IIDS, Components.results.NS_ERROR_INVALID_ARG);
    return this._instance;
  }
};

function xpcom_generateQI(iids) {
  var lines = [];
  for (var j = iids.length; j-- > 0;) {
    lines.push("if(CI." + iids[j].name + ".equals(iid)) return this;");
  }
  lines.push("throw Components.results.NS_ERROR_NO_INTERFACE;");
  return new Function("iid", lines.join("\n"));
}


function xpcom_checkInterfaces(iid,iids,ex) {
  for (var j = iids.length; j-- >0;) {
    if (iid.equals(iids[j])) return true;
  }
  throw ex;
}

var Module = {
  get categoryManager() {
    delete this.categoryManager;
    return this.categoryManager = CC['@mozilla.org/categorymanager;1'
        ].getService(CI.nsICategoryManager);
  },
  firstTime: true,
  registerSelf: function(compMgr, fileSpec, location, type) {
    if (this.firstTime) {
      compMgr.QueryInterface(CI.nsIComponentRegistrar
        ).registerFactoryLocation(SERVICE_CID,
        SERVICE_NAME,
        SERVICE_CTRID, 
        fileSpec,
        location, 
        type);
      const catman = this.categoryManager;
      for (var j = 0, len = SERVICE_CATS.length; j < len; j++) {
        catman.addCategoryEntry(SERVICE_CATS[j],
          SERVICE_CTRID, SERVICE_CTRID, false, true);
      }
      this.firstTime = false;
      try {
        if (fileSpec instanceof CI.nsILocalFile) {
          fileSpec = fileSpec.parent;
          fileSpec.append(".autoreg");
          fileSpec.remove(false);
        }
      } catch(e) {}
    }
  },
  
  unregisterSelf: function(compMgr, fileSpec, location) {
    compMgr.QueryInterface(CI.nsIComponentRegistrar
      ).unregisterFactoryLocation(SERVICE_CID, fileSpec);
    const catman = this.categoryManager;
    for (var j = 0, len = SERVICE_CATS.length; j < len; j++) {
      catman.deleteCategoryEntry(SERVICE_CATS[j], SERVICE_CTRID, false);
    }
  },

  getClassObject: function (compMgr, cid, iid) {
    if (cid.equals(SERVICE_CID))
      return SERVICE_FACTORY;
  
    if (!iid.equals(CI.nsIFactory))
      throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    
    throw Components.results.NS_ERROR_NO_INTERFACE;
  },

  canUnload: function(compMgr) {
    return true;
  }
}
function NSGetModule(compMgr, fileSpec) {
  return Module;
}
function NSGetFactory(cid) {
  if (!SERVICE_CID.equals(cid)) throw Components.results.NS_ERROR_FACTORY_NOT_REGISTERED;
  return SERVICE_FACTORY;
}
