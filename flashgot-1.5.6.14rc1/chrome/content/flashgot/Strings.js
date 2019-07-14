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

function Strings(chromeName) {
  this.chromeName = chromeName;
}

Strings.wrap = function(s, length, sep) {
  if (!sep) sep = ' ';
    
  function wrapPara(p) {
    if (!length) length = 80;
    if (p.length <= length) return p;
    chunks = [];
    var pos;
    while (p.length > length) {
      pos = p.lastIndexOf(sep, length);
      if (pos < 0) pos = p.indexOf(sep, length);
      if (pos < 0) break;
      chunks.push(p.substring(0, pos));
      p = p.substring(pos + 1);
    }

    if (chunks.length) {
      res  = chunks.join("\n");
      if (p.length) res += "\n" + p;
      return res;
    } else return p;
  }
  if (typeof(s) != "string") s = s.toString();
  var paras = s.split("\n");
  
  for (var j = 0; j < paras.length; j++) paras[j] = wrapPara(paras[j]);
  return paras.join("\n");
}

Strings.prototype = {
  bundles: {},
  getBundle: function(path) {
    if (path in this.bundles) return this.bundles[path];
    try {
      return this.bundles[path] = 
        CC["@mozilla.org/intl/stringbundle;1"]
                  .getService(CI.nsIStringBundleService)
                  .createBundle("chrome://" + this.chromeName +  "/" + path +
                                "/" + this.chromeName + ".properties");
    } catch(ex) {
      return this.bundles[path] = null;
    }
  },
  
  _stringFrom: function(bundle, name, parms) {
    try {
      return parms ? bundle.formatStringFromName(name, parms, parms.length) : bundle.GetStringFromName(name);
    } catch(ex) {
      return null;
    }
  }
,
  getString: function(name, parms) {  
    return this._stringFrom(this.getBundle("locale"), name, parms) || name;
  }
  
  
  
};