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

const ASK_NEVER = [false, false, false];

// *** Base/Windows DMS ********************************************************
function FlashGotDM(name) {
  if (arguments.length > 0) {
    this._init(name);
  }
}

FlashGotDM.init = function() {
  FlashGotDM.dms = [];
  FlashGotDM.dmtests = {};
  FlashGotDM.executables = {};
  FlashGotDM.deleteOnExit = [];
  FlashGotDM.deleteOnUninstall = [];
  FlashGotDM.initDMS();
};

FlashGotDM.cleanup = function(uninstalling) {
  var trash = [].concat(FlashGotDM.deleteOnExit);
  if (uninstalling) trash = trash.concat(FlashGotDM.deleteOnUninstall);
  for (var f of trash) {
    if (f instanceof CI.nsIFile) {
      try { f.remove(true); } catch(ex) {}
    }
  }
};

FlashGotDM.prototype = {
  _init: function(name) {
    this.name = name;
    const dms = FlashGotDM.dms;
    var pos = dms.length;
    if (name in dms) {
      var other = dms[name];
      for (var j = pos; j-- > 0;) {
        if (dms[j] == other) {
          pos = j;
          break;
        }
      }
    }
    dms[name] = dms[pos] = this;
  }
,

  _exeFile: false,
  _supported: null,
  custom: false,
  disabledLink: false,
  disabledSel: false,
  disabledAll: false,
  exeName: "FlashGot.exe",
  askPath: ASK_NEVER,
  cookieSupport: true,
  authURLSupport: true,
  postSupport: false,
  priority: "",
  autoselect: true,

  _codeName: null,
  get codeName() {
    return this._codeName || (this._codeName = this.name.replace(/\W/g,"_"));
  },

  getPref: function(name, def) {
    return fg.getPref("dmsopts." + this.codeName + "." + name, def);
  },
  setPref: function(name, value) {
    fg.setPref("dmsopts." + this.codeName + "." + name, value);
  },

  get asciiFilter() {
    return this.getPref("asciiFilter", false);
  },

  get shownInContextMenu() {
    return this.getPref("shownInContextMenu", false);
  },
  set shownInContextMenu(b) {
    this.setPref("shownInContextMenu", b);
    return b;
  }
,
  get service() {
    return fg;
  }
,

  get exeFile() {
    if (typeof(this._exeFile) == "object") return this._exeFile;
    const exeName = this.exeName;
    if (!exeName) return this._exeFile = null;
    if (typeof(FlashGotDM.executables[exeName]) == "object") {
      return this._exeFile = FlashGotDM.executables[exeName];
    }
    try {
      var exeFile = fg.profDir.clone();
      exeFile.append(exeName);
      this._exeFile = this.checkExePlatform(exeFile);
      if(this._exeFile) {
        FlashGotDM.deleteOnUninstall.push(this._exeFile);
        if (this.createExecutable()) {
          this.log(this._exeFile.path + " created");
        }
      }
    } catch(ex) {
      this._exeFile = null;
      this.log("Can't init " + exeName + ":\n" + ex.message);
    }
    return FlashGotDM.executables[exeName] = this._exeFile;
  }
,
  checkExePlatform: function(exeFile) {
    var path = exeFile.path;
    if (/\/.*\.exe$/.test(path)) { // slash mismatch, exe on Unix?

      if (!(fg.getPref("useWine", true) || this.name == fg.defaultDM))
        return null;

      if(!FlashGotDM.wine) {
        // check for wine
        var wine = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
        var winePaths = fg.getPref("wine.paths", "/usr/bin/wine:/usr/local/bin/wine:/opt/local/bin/wine:/Applications/Darwine/Wine.bundle/Contents/bin/wine");
        if (!winePaths) return null;

        for (var winePath of winePaths.split(/[;:,]+/)) {
          try {
            wine.initWithPath(winePath);
            if(wine.exists()) {
              FlashGotDM.wine = wine;
              break;
            }
          } catch(e) {}
        }
        if(!FlashGotDM.wine) return null;
        FlashGotDM.wineExecutables = [];
      }
      FlashGotDM.wineExecutables.push(exeFile);
      return exeFile;
    }

    if (fg.isMac) return null;

    if (exeFile.leafName == FlashGotDM.prototype.exeName) {
      // check if it's a global install and, if it is, put the executable
      // in the install dir to comply with the S.A.F.E.R. policy
      var reg = CC['@mozilla.org/chrome/chrome-registry;1'].getService(CI.nsIChromeRegistry);
      var uri = reg.convertChromeURL(IOS.newURI("chrome://flashgot/content", null, null));
      if (uri instanceof CI.nsIJARURI) {
        uri = uri.JARFile;
        if (uri instanceof CI.nsIFileURL) {
          if (uri.file.path.indexOf(fg.profDir.path) !== 0) { // global install
            if (exeFile.exists()) exeFile.remove(false);
            var globalFile = uri.file.parent.clone();
            globalFile.append(exeFile.leafName);
            exeFile = globalFile;
          }
        }
      }
      return exeFile;
    }

    return /\\.*\.sh$/i.test(path) ? null : exeFile;
  }
,
  get supported() {
    if (typeof(this._supported) == "boolean") return this._supported;
    if (this.customSupportCheck) {
      return this._supported = this.customSupportCheck();
    }
    return this.baseSupportCheck();
  },

  baseSupportCheck: function() {
    if (!this.exeName) return true;
    if (!this.exeFile) return false;

    var dmtest;
    if (typeof(FlashGotDM.dmtests[this.exeName]) != "string") {
      const dmtestFile = fg.tmpDir.clone();
      dmtestFile.append(this.exeName + ".test");
      try {
        if (dmtestFile.exists()) {
          try { dmtestFile.remove(false); } catch(rex) {}
        }
        this.launchSupportTest(dmtestFile);
        this.log(dmtest = IO.readFile(dmtestFile));
      } catch(ex) {
        this.log(ex.message);
        dmtest = "";
      }
      FlashGotDM.dmtests[this.exeName] = dmtest;
    } else dmtest = FlashGotDM.dmtests[this.exeName];
    return this._supported = dmtest.indexOf(this.name + "|OK") > -1;
  }
,
  readWinRegString: function(hkroot, hkpath, hk) {
    if (!hk) hk = "";
    var key, ret = null;
    if ("@mozilla.org/windows-registry-key;1" in CC) {  // Firefox 1.5 or newer
      key = CC["@mozilla.org/windows-registry-key;1"].createInstance(CI.nsIWindowsRegKey);
      key.open(key["ROOT_KEY_" + hkroot], hkpath, key.ACCESS_READ);
      ret = key.readStringValue(hk);
      key.close();
    } else {
      hkroot = hkroot.replace(/^([A-Z])*_(A_Z).*$/, "HK$1$2"); // CURRENT_USER -> HKCU
      if ("@mozilla.org/winhooks;1" in CC) {	// SeaMonkey or other older non-toolkit application
        key = CC["@mozilla.org/winhooks;1"].getService(CI.nsIWindowsRegistry);
      } else if ("@mozilla.org/browser/shell-service;1" in CC) {
        key = CC["@mozilla.org/browser/shell-service;1"].getService(CI.nsIWindowsShellService)
          && ("getRegistryEntry" in key);
      }
      if (key) key.getRegistryEntry(key[hkroot], hkpath, hk);
    }
    return ret;
  }
,
  launchSupportTest: function (testFile) {
    this.runNative(["-o", testFile.path], true);
  },

  shouldList: function() {
    return this.supported;
  }
,
  log: function(msg) {
    fg.log(msg);
  }
,
  updateProgress: function(links, idx, len) {
    if (!links.progress) return;
    if ((idx % 100) == 0) {
      if (!len) {
        links.progress.update(100);
        return;
      }
    }
    links.progress.update(70 + 29 * idx / len);
  }
,
  isValidLink: null
,
  get quiet() {
    return this.getPref("quiet") ||
      fg.getPref(this.codeName + ".quiet", false);
  },
  quietOp: function(opType) {
    return this.getPref("quiet." + opType, false) ||
      fg.getPref(this.codeName + ".quiet." + opType, false);
  }
,
  createJobHeader: function(links, opType) {
    return links.length + ";" + this.name + ";" +
      (this.quietOp(opType) ? fg.OP_QET : opType)
      + ";" + links.folder + ";\n"
  }
,
  createJobBody: function(links) {
    var jobLines = [];

    for (var j = 0, len = links.length, l; j < len; j++) {
      jobLines.push((l = links[j]).href,
           l.description,
           this.getCookie(l, links),
           l.postData || links.postData ||  '');
      this.updateProgress(links, j, len);
    }
    return jobLines.join("\n");
  }
,
  createJob: function(links, opType, extras) {
    var job = this.createJobHeader(links, opType)
      + this.getReferrer(links) + "\n"
      + this.createJobBody(links);

    if (typeof(links.document) == "object") {
      job += "\n" + links.document.referrer + "\n" + links.document.cookie + "\n";
    } else {
      job += "\n\n\n";
    }
    if(!extras) job += "\n\n";
    else {
      while(extras.length < 3) extras.push('');
      job += extras.join("\n");
    }
    var cph = this.getPref("cookiePersistence", null);
    if(cph != null) job += cph;
    return job;
  }
,
  download: function(links, opType) {
    try {
      links.folder = links.folder || (links.length > 0 ? this.selectFolder(links, opType) : "");
      this.checkCookieSupport();
      if (!this.authURLSupport) this.removeUserpass(links);
      this.performDownload(links, opType);
    } catch(ex) {
      this.log(ex + "\n" + ex.stack);
    } finally {
      this.updateProgress(links, 0); // 100%
    }
  }
,
  // best override point
  performDownload: function(links, opType) {
    this.performJob(this.createJob(links, opType));
  }
,
  getReferrer: function(links) {
    if (links.redirProcessedBy) {
      for (p in links.redirProcessedBy) {
        if (fg.getPref("redir.anonymous." + p, false)) return "";
      }
    }
    if (!fg.getPref("autoReferrer", true))
      return fg.getPref("fakeReferrer", "");

    var ret = links.referrer || links.document && links.document.URL || links[0] && links[0].href;

    return (ret && /^https?:*/.test(ret)) ? ret : "";
  }
,
  checkCookieSupport: function() {
    this.getCookie = this.cookieSupport && !fg.getPref("omitCookies")
    ? this._getCookie
    : function() { return ""; }
    ;
  },
  removeUserpass: function(links) {
    for (var j = links.length, l; j-- > 0;) {
      l = links[j];
      l.href = l.href.replace(/^([\w-]+:\/\/)[^\/]+@/, '$1');
    }
  }
,
  getCookie: function() { return ""; }
,
  _getCookie: function(link, links) {
    if (!this.cookieSupport) return (this.getCookie = function() { return ""; })();
    var host, cookies;
    if ((cookies = links.cookies)) {
      host = link.host;
      return host && cookies[host] || "";
    }
    this.initCookies(links);
    return this._getCookie(link, links);
  },

  initCookies: function(links) {
    var host, cookies, j, objCookie;
    const hostCookies = {};

    var l, parts;
    for (j = links.length; j-- > 0;) {
      l = links[j];
      parts = l.href.match(/^https?:\/\/([^\/:]+)/i); // host?
      if (parts) {
        host = parts[1];
        var hpos = host.indexOf("@");
        if (hpos > -1) host = host.substring(hpos + 1);
        hostCookies[l.host = host] = "";
      } else {
        l.host = null;
      }
    }

    var cookieHost, cookieTable, tmpCookie;
    const domainCookies = {};

    for (var iter = fg.cookieManager.enumerator; iter.hasMoreElements();) {
      if ((objCookie = iter.getNext()) instanceof CI.nsICookie) {
        cookieHost = objCookie.host;
        if (cookieHost.charAt(0) == ".") {
          cookieHost = cookieHost.substring(1);
          cookieTable = domainCookies;
          if (typeof(tmpCookie=domainCookies[cookieHost]) != "string") {
            tmpCookie = "";
          }
        } else {
          if (typeof(tmpCookie=hostCookies[cookieHost])!="string") continue;
          cookieTable = hostCookies;
        }
        cookieTable[cookieHost] = tmpCookie.concat(objCookie.name + "=" + objCookie.value + "; ");
      }
    }

    for (cookieHost in hostCookies) {
      var dotPos;
      for (host = cookieHost; (dotPos=host.indexOf('.'))>=0; ) {
        if ((tmpCookie = domainCookies[host])) {
          hostCookies[cookieHost] += tmpCookie;
        }
        host = host.substring(dotPos+1);
      }
    }

    links.cookies = hostCookies;
  },

  // see http://www.cookiecentral.com/faq/#3.5 and http://www.xulplanet.com/references/xpcomref/ifaces/nsICookie.html
  formatNSCookie: function(cookie) {
    return [
      cookie.host,
      cookie.isDomain ? "TRUE" : "FALSE",
      cookie.path,
      cookie.isSecure? "TRUE" : "FALSE",
      cookie.expires || this.cookieExpires,
      cookie.name,
      cookie.value
    ].join("\t");
  },
  cookieExpires: 0, // to be set once in getCookies()
  createCookieFile: function() {
    if (fg.getPref("omitCookies")) return null;

    const cookies = [];
    this.cookieExpires = Date.now() + 24 * 3600 * 3650; // ten years for session cookies

    for (var cookie, iter = fg.cookieManager.enumerator; iter.hasMoreElements();) {
      if ((cookie = iter.getNext()) instanceof CI.nsICookie) {
        cookies.push(this.formatNSCookie(cookie));
      }
    }

    const f = fg.tmpDir.clone();
    f.append("cookies");
    f.createUnique(0, B8('600'));
    IO.writeFile(f, cookies.join("\n"));

    fg.doomPrivateFile(f);

    return f.path;
  }
,
  createJobFile: function(job) {
    const jobFile = fg.tmpDir.clone();
    jobFile.append("flashgot.fgt");
    jobFile.createUnique(0, B8('700'));
    IO.writeFile(jobFile, job);
    return jobFile;
  }
,

  performJob: function(job) {
    const jobFile = this.createJobFile(job);
    const args = (fg.inPrivate || fg.getPref("shredding")) ? ["-p"] : [];
    args.push(jobFile.path);
    return this.runNative(args, false);
  }
,
  createExecutable: function() {
    const exeFile = this.exeFile;
    if (!exeFile) return false;

    var exists = exeFile.exists();
    if (exists && !fg.firstRun)
      return false;

    var channel = IOS.newChannel("chrome://flashgot/content/" + this.exeName, null, null);
    var bis = CC['@mozilla.org/binaryinputstream;1'].createInstance(CI.nsIBinaryInputStream);
    bis.setInputStream(channel.open());
    const bytesCount = channel.contentLength;
    const templateImage = bis.readBytes(bytesCount);
    bis.close();

    if (exists) {
      channel = IOS.newChannelFromURI(IOS.newFileURI(this.exeFile));
      bis = CC['@mozilla.org/binaryinputstream;1'].createInstance(CI.nsIBinaryInputStream);
      bis.setInputStream(channel.open());
      try {
        if (channel.contentLength == bytesCount) {
          const currentImage = bis.readBytes(channel.contentLength);
          if (currentImage == templateImage) return false;
        }
      } finally {
        bis.close();
      }
    }

    var bos = null;
    try {
      const fos = CC["@mozilla.org/network/file-output-stream;1"].createInstance(CI.nsIFileOutputStream);
      fos.init(exeFile, 0x02 | 0x08 | 0x20, B8('755'), 0);
      bos = CC['@mozilla.org/binaryoutputstream;1'].createInstance(CI.nsIBinaryOutputStream);
      bos.setOutputStream(fos);
      bos.writeBytes(templateImage, bytesCount);
      bos.close();
      return true;
    } catch(ioex) {
      this.log("Error writing " + exeFile.path + ": " + ioex);
    } finally {
      if (bos) try { bos.close(); } catch(e) {}
    }
    return false;
  }
,
  runNative: function(args, blocking, exeFile) {
    const t0 = Date.now();
    try {
      if (typeof(exeFile) == "object"
        || (exeFile = this.exeFile).exists()
        || this.createExecutable()) {
        const proc = CC['@mozilla.org/process/util;1'].createInstance(
          CI.nsIProcess);
        if (FlashGotDM.wine && FlashGotDM.wineExecutables.indexOf(exeFile) > -1) {
          args.unshift(exeFile.path);
          exeFile = FlashGotDM.wine;
        }
        proc.init(exeFile);
        this.log("Running " + exeFile.path + " " + args.join(" ") + " -- " +(blocking ? "blocking" : "async") );
        proc["runw" in proc ? "runw" : "run"](blocking, args, args.length, {});
        if (blocking && proc.exitValue != 0) {
          this.log("Warning: native invocation of\n"
            + exeFile.path
            + "\nwith arguments <"
            + args.join(" ")
            + ">\nreturned " + proc.exitValue);
        }
        return proc.exitValue;
      } else {
        this.log("Bad executable " + exeFile);
      }
    } catch(err) {
      this.log("Error running native executable:\n" + exeFile.path +
        " " + args.join(" ") + "\n" + err.message);
    } finally {
      this.log("Native execution time " + (Date.now() - t0));
    }
    return 0xffffffff;
  }
,
  getWindow: function() {
    return fg.getWindow();
  }
,
  selectFolder: function(links, opType) {
    if (this.quiet || this.quietOp(opType)) return "";

    const autoPref_FF = "browser.download.useDownloadDir";
    const autoPref_Moz = "browser.download.autoDownload";

    var initialDir = null;
    var downloadDir = null;
    links.quickDownload = false;

    const pref = CC["@mozilla.org/preferences-service;1"].getService(CI.nsIPrefBranch);

    function findDownloadDir(prefName) {
      try {
        downloadDir = initialDir = pref.getComplexValue(prefName, CI.nsILocalFile);
        return prefName;
      } catch(ex) {
        return "";
      }
    }
    const isMulti = opType != fg.OP_ONE;
    const multiDirPref = "flashgot.multiDir";
    var downloadDirPref =
                    (isMulti && findDownloadDir(multiDirPref)) ||
                    findDownloadDir("browser.download.dir") ||
                    findDownloadDir("browser.download.downloadDir") ||
                    findDownloadDir("browser.download.defaultFolder") ||
                    "browser.download.dir";

    if (isMulti) downloadDirPref = multiDirPref;

    try {
      links.quickDownload = pref.getBoolPref(autoPref_FF);
    } catch(noFFEx) {
      try {
        links.quickDownload = pref.getBoolPref(autoPref_Moz);
      } catch(noMozEx) {}
    }

    if (!this.askPath[opType]) return "";

    if (((!isMulti) || fg.getPref("multiQuiet", false)) &&
        downloadDir && downloadDir.exists() && downloadDir.isDirectory()  &&
        links.quickDownload) {
      return downloadDir.path;
    }

    var urlLabel = links.length > 1
      ? links.length + " @ " +
      (function() {
        var ll = links.map(function(l) {
          return l.href.match(/^[\w-]+:\/*([^\/]*)/)[1];
        }).sort(); // extract and sort domains
        for (var j = ll.length; j-- > 1;) // remove dupes
          if (ll[j - 1] == ll[j]) ll.splice(j, 1);
        return ll;
      })().join(", ")
      : links[0].href.replace(/^[\w-]+:\/*([^\/]+\/).*?([^\/\?]+)(?:$|\?.*)/, '$1.../$2');

    var params = {
      title: "FlashGot (" + this.name.replace(/[\(\)]/g, "") + ") " + urlLabel,
      initialDir: initialDir,
      choosenDir: null,
      links: links
    }

    this.getWindow().openDialog(
              "chrome://flashgot/content/chooser.xul",
              "flashgotChooser",
              "chrome, dialog, modal, dependent, centerscreen, resizable",
              params);

    if (params.choosenDir) {
      pref.setComplexValue(downloadDirPref, CI.nsILocalFile, params.choosenDir);
      var path = new String(params.choosenDir.path);
      path._fgSelected = true;
      return path;
    }

    throw new Error("Download cancelled by user");

  },
  sanitizeWinArg: function(a) {
    return a.replace(/([\|\(\) &\^])/g, "^$1");
  },

  supportURLs: function(links, argsTemplate) {
    if (!links.length) return null;
    const sfile = /\[[^\]]*UFILE[^\]]*\]/.test(argsTemplate);
    const slist = /\[[^\]]*ULIST[^\]]*\]/.test(argsTemplate);
    if (!(sfile || slist)) return null;
    var ulist = links.map(function(l) { return l.href });
    links.length = 1;
    var ufile;
    if (sfile) {
      const f =  FlashGotDMX.prototype.createJobFile
        .call(this, ulist.join(fg.isWindows ? "\r\n" : "\n"));
      fg.doomPrivateFile(f);
      ufile = f.path;
    }
    return { list: ulist, file: ufile || null };
  },

  nativeUI: null,
  hideNativeUI: function(document) {
    if (!(this.nativeUI && this.getPref("hideNativeUI", true))) return;
    fg.hideNativeUI(document, this.nativeUI);
  }
}




// *** Unix-like DMS ***********************************************************
function FlashGotDMX(name, cmd, argsTemplate, unixPath) {
  if (arguments.length != 0) {
    this._init(name);
    this.unixCmds[name] = cmd;
    this.unixCmd = cmd;
    if (argsTemplate) this.argsTemplate = argsTemplate;
    if (unixPath) {
      this.unixPath = unixPath;
      this.unixPaths.push(unixPath);
    }
    this.cookieSupport =  /\[.*?(?:CFILE|COOKIE).*?\]/.test(this.argsTemplate);
  }
  if (fg.isMac) {
    this.createJobFile = FlashGotDMMac.prototype.createJobFile;
  }
}
FlashGotDMX.prototype = new FlashGotDM();
FlashGotDMX.constructor = FlashGotDMX;
FlashGotDMX.prototype.exeName = "flashgot.sh";
FlashGotDMX.prototype.terminal = false;
FlashGotDMX.prototype.askPath = [true, true, true];
FlashGotDMX.prototype.unixCmds = {};
FlashGotDMX.prototype.unixPaths = [];
FlashGotDMX.prototype.__defineGetter__("unixShell", function() {
  var f = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
  try {
    f.initWithPath("/bin/sh");
    if (!f.exists()) {
      this.log(f.path + " not found");
      f = null;
    }
  } catch(ex) {
    f = null;
    this.log("No *X shell: " + ex.message);
  }
  delete FlashGotDMX.prototype.unixShell;
  return FlashGotDMX.prototype.unixShell = f;
});

FlashGotDMX.prototype.argsTemplate = "[URL]";
FlashGotDMX.prototype.launchSupportTest = function(testFile) {
  const cmds = this.unixCmds;
  var script= "PATH=\"" + this.unixPaths.join(":") + ":$PATH:" +  "\"\n(\n";
  for (var name in cmds) {
    cmd = cmds[name];
    script += " which \"" + cmd + "\" && echo '"
      + name + "|OK' || echo '" + name+"|KO'\n";
  }
  script += ") > '" + testFile.path + "' 2>/dev/null\n";
  this.performJob(script, true);
};

FlashGotDMX.prototype.createCmdLine = function(parms, cmd) {
  return '"' + (cmd || this.unixCmd) + '" ' +
    this.argsTemplate.replace(/\[(.*?)(URL|FNAME|REFERER|COOKIE|FOLDER|POST|UFILE|CFILE|ULIST|USERPASS|UA)(.*?)\]/g,
      function(all, before, parm, after) {
          var v = parms[parm];

          return typeof(v) != "undefined" && v != null
            ? before + v + (after.substring(0, 1) == '|' ? '' : after)
            : (after.substring(0, 1) == '|' ? after.substring(1) : "");
      }
   ) + "\n";
};
FlashGotDMX.prototype.shellEsc = function(s) {
  return s ? s.replace(/([\\\*\?\[\]\$&<>\|\(\)\{\};"'`])/g,"\\$1").replace(/\s/g,"\\ ") : null;
};
FlashGotDMX.prototype.createJob = function(links, opType) {
    const shellEsc = this.shellEsc;
  // basic implementation

  const folder = shellEsc(links.folder);
  const referrer = shellEsc(this.getReferrer(links));
  const postData = shellEsc(links.postData);
  const cmd = this.unixCmd;


  var len = links.length;
  var job = (this.unixPath ? "PATH=" + this.unixPath + ":$PATH\n" : "") +
            this.shreddingCmd();

  if (links.folder) job += "cd '" + links.folder + "'\n";

  var l, url;

  const cookieFile = this.createCookieFile();
  const forceSingle = len == 1 && /\[[^\]]*\bURL\b/.test(this.argsTemplate);

  const urls = forceSingle ? null : this.supportURLs(links, this.argsTemplate);

  var ufile, ulist;
  if (urls) {
    ufile = shellEsc(urls.file);
    ulist = urls.list.map(shellEsc).join(' ');
  }

  const userAgent = shellEsc(CC["@mozilla.org/network/protocol;1?name=http"].getService(CI.nsIHttpProtocolHandler).userAgent);

  len = links.length; // needed because supportURLs can cut links.length
  for (var j = 0; j < len; j++) {
    l = links[j];
    if (!l) continue;
    url = l.href;
    if (!ufile) job += "echo \"URL " + (j + 1) + "/" + len + "\"...\n";
    job += this.createCmdLine({
      URL: shellEsc(url),
      FNAME: l.fname && shellEsc(l.fname) || null,
      REFERER: referrer,
      COOKIE: shellEsc(this.getCookie(l, links)),
      CFILE: cookieFile,
      FOLDER: folder,
      POST: l.postData && shellEsc(l.postData) || postData,
      UFILE: ufile,
      ULIST: ulist,
      USERPASS: l.userPass && shellEsc(l.userPass) || null,
      UA: userAgent
    }, cmd);
    this.updateProgress(links, j, len);
  }

  if (this.terminal) {
    const autoClose = fg.getPref("term.autoClose", -1);
    const title = shellEsc("FlashGot " +  (len > 1 ? "(" + len + ")" : links[0].href));
    const shell = this.unixShell && shellEsc(this.unixShell.path) || '';
    job =
      "if [ -z \"$FLASHGOT_TERM\" ]; then\n" +
      "  export FLASHGOT_TERM; FLASHGOT_TERM=1\n" +
      "  if which flashgot-term >/dev/null 2>&1; then\n" +
      "     flashgot-term " + title + " " + shell + " \"$0\" && exit\n" +
      "  fi\n" +
      "  if which gnome-terminal >/dev/null 2>&1; then\n" +
      "    gnome-terminal -t " + title + " -x " + shell + " \"$0\" && exit\n" +
      "  fi\n" +
      "  if which konsole >/dev/null 2>&1; then\n" +
      "    konsole -T " + title + " -e " + shell + " \"$0\" && exit\n" +
      "  fi\n" +
      "  if which lxterminal >/dev/null 2>&1; then\n" +
      "    lxterminal -t " + title + " -e " + shell + " \"$0\" && exit\n" +
      "  fi\n" +
      "  if which urxvt >/dev/null 2>&1; then\n" +
      "    urxvt -title " + title + " -e " + shell + " \"$0\" && exit\n" +
      "  fi\n" +
      "  if which rxvt >/dev/null 2>&1; then\n" +
      "    rxvt -title " + title + " -e " + shell + " \"$0\" && exit\n" +
      "  fi\n" +
      "  if which xfce4-terminal >/dev/null 2>&1; then\n" +
      "    xfce4-terminal -T " + title + " -e " + shell + " \"$0\" && exit\n" +
      "  fi\n" +
      "  if which xterm >/dev/null 2>&1; then\n" +
      "    xterm -T " + title + " -e " + shell + " \"$0\" && exit\n" +
      "  fi\n" +
      "fi\n" +
      job +
        (autoClose < 0
          ? "\necho -n 'Press [ENTER] to quit... ' && read l || sleep 5\n"
          : "\nsleep " + autoClose + "\n");
  }

  return job;
};

FlashGotDMX.prototype.shreddingCmd = function() {
  return (fg.inPrivate || fg.getPref("shredding"))
    ? "\n( shred -uf \"$0\" || srm -fm \"$0\" || rm -P \"$0\" || rm \"$0\" ) >/dev/null 2>&1 &\n"
    : "";
};

FlashGotDMX.prototype.performJob = function(job, blocking) {

  job = "#!" + this.unixShell.path + "\n" + job + this.shreddingCmd();

  const jobFile = this.createJobFile(job);
  jobFile.permissions = parseInt("0700", 8);
  return !(fg.isMac
    ? this.runNative([], blocking, FlashGotDMMac.exeFile)
    : this.runNative([jobFile.path], blocking, this.unixShell)
  );
};
FlashGotDMX.prototype.checkExePlatform = function(exeFile) {
  return this.unixShell && exeFile;
};
FlashGotDMX.prototype.createExecutable = function() {
  return false;
};






// *** Mac OS X DMS ************************************************************
function FlashGotDMMac(name, creatorId, macAppName) {
  if (arguments.length != 0) {
    this._initMac(name, creatorId, macAppName);
  }
}
FlashGotDMMac.exeFile = null;
FlashGotDMMac.appleScriptFile = null;
FlashGotDMMac.appleScriptName = "flashgot-mac-script";
FlashGotDMMac.OSASCRIPT = "/usr/bin/osascript";
FlashGotDMMac.prototype = new FlashGotDM();
FlashGotDMMac.constructor = FlashGotDMMac;
FlashGotDMMac.prototype.exeName = "FlashGot";
FlashGotDMMac.prototype.cookieSupport = false;
FlashGotDMMac.prototype.macCreators = [];
FlashGotDMMac.prototype._initMac = function(name, creatorId, macAppName) {
  this._init(name);

  if (creatorId) {
    const creators=FlashGotDMMac.prototype.macCreators;
    creators[creators.length] = {name: name, id: creatorId};
  }
  this.macAppName = macAppName ? macAppName : name;
  this.initAppleScriptBridge();
  FlashGotDMMac.exeFile = this.exeFile;
};

FlashGotDMMac.prototype.initAppleScriptBridge = function() {
  if (FlashGotDMMac.appletScriptFile) return;

  (FlashGotDMMac.appleScriptFile = fg.tmpDir.clone())
      .append(FlashGotDMMac.appleScriptName);

}
FlashGotDMMac.prototype.shellEsc = function(s) {
  return s ? "'" + s.replace(/'/g, '"\'"') + "'" : null;
}
FlashGotDMMac.prototype.createScriptLauncher = function() {
  return "#!/bin/sh\n" +
    "SCRIPT=" + this.shellEsc(FlashGotDMMac.appleScriptFile.path) + "\n" +
    "USCRIPT=\"$SCRIPT.$$\"\n" +
    "mv \"$SCRIPT\" \"$USCRIPT\" || exit 1\n" +
    "head -n 1 \"$USCRIPT\" | grep '#!' >/dev/null &&  \"$USCRIPT\" || " +
    FlashGotDMMac.OSASCRIPT + " \"$USCRIPT\"\n" +
    "( srm -fm \"$USCRIPT\" || rm -P \"$USCRIPT\" || rm \"$USCRIPT\" ) &"; // inPrivate or not...
};
FlashGotDMMac.prototype.checkExePlatform = function(exeFile) {
  return fg.isMac && exeFile || null;
};
FlashGotDMMac.prototype.createExecutable = function() {


  var exeFile = this._exeFile;
  if (!exeFile) return false;

  try {
   var scriptLauncher = this.createScriptLauncher();
   var mustCreate = true;
   if (exeFile.exists()) {
     if (IO.readFile(exeFile) == scriptLauncher) {
       exists = true;
       if (exeFile.isExecutable()) return false;
       mustCreate = false;
     } else {
       this.log(exeFile.path + " is corrupted or obsolete, replacing it...");
       try { exeFile.remove(true); } catch(rex) {}
     }
   } else {
     this.log(exeFile.path + " not found, creating it...");
   }
   if (mustCreate) {
      this.log("Creating Mac executable");
      exeFile.create(0, B8('700'));
      IO.writeFile(exeFile, scriptLauncher);

      try {
        this.log("Trying to reset Leopard's quarantine attribute...");
        var xattr =  CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
        xattr.initWithPath("/usr/bin/xattr");
        this.runNative(["-d", "com.apple.quarantine", exeFile.path], true, xattr);
      } catch(e) {
        this.log("Couldn't clear quarantine attribute " + e);
      }
   }
   this.log("Setting executable permissions on " + exeFile.path);
   exeFile.permissions = parseInt("0700", 8);

   return mustCreate;
  } catch(ex) {
    this.log("Cannot create Mac executable: " + ex.message);
  }
  return false;
};
FlashGotDMMac.prototype.launchSupportTest = function(testFile) {
  const creators = FlashGotDMMac.prototype.macCreators;

  var s = [
    'global gRes',
    'set gRes to ""',
    'on theTest(theName, theId)',
    '  set gRes to gRes & theName',
    '  try',
    '    tell app "Finder" to get application file id theId',
    '    set gRes to gRes & "|OK\n"',
    '  on error',
    '    set gRes to gRes & "|KO\n"',
    '  end try',
    'end theTest'
  ];
  for (var j = creators.length; j-- > 0; ) {
    s.push('theTest("' + creators[j].name + '","' +creators[j].id + '")');
  }
  s.push(
    'set theFile to POSIX file "' + testFile.path + '"',
    'try',
    '  set fh to open for access theFile with write permission',
    '  write (gRes) to theFile',
    '  close access fh',
    'on error',
    '  try',
    '    close access fh',
    '  end try',
    'end try'
  );
  this.performJob(s.join("\n"), true);
};
FlashGotDMMac.prototype.createJobFile = function(job) {
  const jobFile = FlashGotDMMac.appleScriptFile;
  try {
    jobFile.remove(true);
  } catch(ex) {}
  try {
    jobFile.create(0, B8('600'));
    IO.writeFile(jobFile, job, /^#/.test(job) ? null : fg.getPref("appleScriptEncoding"));
    return jobFile;
  } catch(ex) {
    this.log("Cannot write " + (jobFile && jobFile.path) + ex.message);
  }
  return null;
}
FlashGotDMMac.prototype.performJob = function(job, blocking) {
  return (this.createJobFile(job)) && !this.runNative([], blocking, this.exeFile);
};

FlashGotDMMac.prototype.createJob = function(links,opType) {
  const referrer = this.getReferrer(links);
  var job = "tell application \""+ this.macAppName+ "\"\n";
  for (var j = 0, len = links.length; j < len; j++) {
    job += 'GetURL "' + links[j].href + '" from "' + referrer  + "\"\n";
    this.updateProgress(links, j, len);
  }
  job += "end tell\n";
  return job;
};



// *** Custom DMS **************************************************************
function FlashGotDMCust(name, codeName) {
  if (arguments.length == 0 || (!name) || (!name.length)) return;
  name = name.replace(/,/g, " ");
  if (codeName) {
    this._codeName = codeName;
  }
  this._init(name);
  this.prefsBase = "custom." + this.codeName + ".";
}

FlashGotDMCust.init = function() {
  const names = fg.getPref("custom", "").split(/\s*,\s*/);
  for (var j = names.length; j-->0;) {
    new FlashGotDMCust(names[j]);
  }
}

FlashGotDMCust.persist = function() {
  const dms = FlashGotDM.dms;
  const cdms = [];
  for (var j = dms.length; j-->0;) {
    if (dms[j].custom) cdms.push(dms[j].name);
  }
  fg.setPref("custom", cdms.join(","));
}

FlashGotDMCust.prototype = new FlashGotDM();
FlashGotDMCust.constructor = FlashGotDM;

delete FlashGotDMCust.prototype.launchSupportTest;
delete FlashGotDMCust.prototype.exeFile;
FlashGotDMCust.prototype.PLACEHOLDERS = ["URL", "COMMENT", "REFERER", "COOKIE", "FOLDER", "FNAME", "HEADERS", "POST", "RAWPOST", "ULIST", "UFILE", "CFILE", "USERPASS", "UA"];

FlashGotDMCust.prototype.custom = true;
FlashGotDMCust.prototype. _supported = true;
FlashGotDMCust.prototype.cookieSupport = false;
FlashGotDMCust.prototype.postSupport = true;
FlashGotDMCust.prototype.askPath = [true, true, true];

FlashGotDMCust.prototype.__defineGetter__("exeFile",function() {
  try {
    return fg.prefs.getComplexValue(this.prefsBase + "exe",
      CI.nsILocalFile);
  } catch(ex) {
    return null;
  }
});
FlashGotDMCust.prototype.__defineSetter__("exeFile",function(v) {
  try {
    if (v) {
      fg.prefs.setComplexValue(this.prefsBase + "exe",
          CI.nsILocalFile,v);
      return v;
    }
  } catch(ex) {
  }
  return null;
});

FlashGotDMCust.prototype.__defineGetter__("argsTemplate", function() {
  if (this.forcedTemplate) return this.forcedTemplate;
  var t = fg.getPref(this.prefsBase+"args", "[URL]");
  return /['"`]/.test(t) ? this.argsTemplate = t : t;
});
FlashGotDMCust.prototype.__defineSetter__("argsTemplate",function(v) {
  if (!v) {
    v = "";
  } else {
    v = v.replace(/['"`]/g,"");
  }
  fg.setPref(this.prefsBase + "args", v);
  this.askPath = [];
  return v;
});


FlashGotDMCust.prototype.download = function(links, opType) {
  const t = this.argsTemplate;
  this.cookieSupport = /\[.*?(?:CFILE|COOKIE).*?\]/.test(t);
  this.askPath[opType] = /\[.*?FOLDER.*?\]/.test(t);
  var exeFile = this.exeFile;
  // portable hacks
  if (exeFile && !exeFile.exists()) {
    // try changing the first part of path
    var path = exeFile.path;
    var profPath = fg.profDir.path;
    var pos1, pos2;
    if (path[1] == ":" && profPath[1] == ":") {
      // easy, it's Windows, swap drive letter
      path = profPath[0] + path.substring(1);
    } else if(path.indexOf("/mount/") == 0 && profPath.indexOf("/mount/") == 0) {
      pos1 = path.indexOf("/", 7);
      pos2 = profPath.indexOf("/", 7);
      path = "/mount/" + profPath.substring(7, pos2) + path.substring(pos1);
    } else if((pos1 = path.indexOf("/",1)) > 0 && (pos2 = profPath.indexOf("/", 1)) > 0) {
      path = profPath.substring(0, pos2) + path.substring(pos1);
    } else exeFile = null;
    if (exeFile) {
      exeFile = exeFile.clone().QueryInterface(CI.nsILocalFile).initWithPath(path);
      if (!exeFile.exists()) exeFile = null;
    }
  }
  links.exeFile= (exeFile ||
    (exeFile = this.exeFile = this.locateExeFile())) ? exeFile : null;
  FlashGotDM.prototype.download.call(this, links, opType);
};

FlashGotDMCust.prototype.locateExeFile = function(name) {


  if (!name) name = this.name;
  var title = fg.getString("custom.exeFile");
  title = 'FlashGot (' + name + ') - ' + title;

  const fp = CC["@mozilla.org/filepicker;1"].createInstance(CI.nsIFilePicker);
  const win = this.getWindow();
  fp.init(win, title, CI.nsIFilePicker.modeOpen);
  fp.appendFilters(CI.nsIFilePicker.filterApps);
  fp.appendFilters(CI.nsIFilePicker.filterAll);

  if (fp.show() == CI.nsIFilePicker.returnOK) {
    var file = fp.file.QueryInterface(CI.nsILocalFile);
    if (file.exists()) {
      return file;
    }
  }
  return null;
};

FlashGotDMCust.prototype._addParts = function(a, s) {
  var parts = s.split(/\s+/);
  var k, p;
  for (k in parts) {
    if ((p = parts[k])) {
      a.push(p);
    }
  }
};

FlashGotDMCust.prototype.makeArgs = function(parms) {
  const args = [];
  var t = this.argsTemplate;
  var v, len, alt;

  var idx;
  var rx = new RegExp("\\[([\\s\\S]*?)(\\S*)\\b(" + this.PLACEHOLDERS.join("|") + ")\\b(\\S*?)([\\s\\S]*?)\\]");
  for (var m;
      m = t.match(rx);
      t = t.substring(idx + m[0].length)
     ) {

    if ((idx = m.index) > 0) {
      this._addParts(args, t.substring(0, idx));
    }

    v = parms[m[3]];
    alt = m[4].substring(0, 1) == '|';
    if (!v) {
      if (alt) {
        this._addParts(args, m[4].substring(1));
        this._addParts(args, m[5]);
      }
      continue;
    }

    if (alt) m[4] = '';

    this._addParts(args, m[1]);
    if (v.push) { // array argument
      if (m[2]) args.push(m[2]);
      args.push.apply(args, v);
      if (m[4]) args.push(m[4])
    } else {
      args.push(m[2] + v + (alt ? '' : m[4]));
    }

    this._addParts(args, m[5]);
  }

  if (t.length) {
    this._addParts(args, t);
  }
  return args;
};

FlashGotDMCust.prototype.createJob = function(links, opType) {
  return { links: links, opType: opType };
};

FlashGotDMCust.prototype.shellEsc = function(s) {
  return s ? '"' + s.replace(/"/g, '""') + '"' : null;
}

FlashGotDMCust.prototype.winEscHack = function(s) {
  // hack for bug at http://mxr.mozilla.org/seamonkey/source/xpcom/threads/nsProcessCommon.cpp#149
  var rstr = /^\w+:\/+/.test(s) ? "# " : " ";
  return (/[;&=]/.test(s) && !/\s/.test(s)) // "=" and ";" are command line separators on win!!!
    ? s + rstr : s; // we add a space to force escaping
}

FlashGotDMCust.prototype.performJob = function(job) {
  const links = job.links;
  const exeFile = links.exeFile;
  if (links.length < 1 || !exeFile) return false;

  var esc = (fg.isWindows && this.getPref("winEscHack", true))
    ? this.winEscHack : function(s) { return s; }

  const folder = links.folder;
  const referrer = esc(this.getReferrer(links));
  const postData = esc(links.postData);
  var cookieFile = this.createCookieFile();


  var maxLinks = fg.getPref(this.prefsBase + "maxLinks", 0);
  if (maxLinks > 0 && links.length > maxLinks) {
    this.log("Too many links (" + links.length + "), cutting to "
        + this.prefsBase + "maxLinks (" + maxLinks + ")");
    links.length = maxLinks;
  }


  const urls = this.supportURLs(links, this.argsTemplate) || { file: null, list: null };

  const userAgent = esc(CC["@mozilla.org/network/protocol;1?name=http"].getService(CI.nsIHttpProtocolHandler).userAgent);

  for (var l, j = 0, len = links.length; j < len; j++) {
    l = links[j];
    var extraHeaders = null;
    if (l.extraHeaders) {
      extraHeaders = "";
      for (var p in l.extraHeaders) {
        extraHeaders += p + ": " + l.extraHeaders[p] + "\r\n";
      }
      extraHeaders = extraHeaders.length ? esc(extraHeaders) : null;
    }
    this.runNative(
      this.makeArgs({
        URL: esc(l.href),
        COMMENT: esc(l.description),
        FNAME: l.fname && esc(l.fname) || null,
        REFERER: referrer,
        COOKIE: esc(this.getCookie(l, links)),
        FOLDER: folder,
        POST: l.postData && esc(l.postData) || postData,
        RAWPOST: l.rawPostData && esc(l.rawPostData) || postData,
        HEADERS: extraHeaders,
        CFILE: cookieFile,
        UFILE: urls.file,
        ULIST: urls.list,
        USERPASS: l.userPass && esc(l.userPass) || null,
        UA: userAgent
       }),
       false, exeFile);
    this.updateProgress(links, j, len);
  }
  return true;
};
FlashGotDMCust.prototype.checkExePlatform = function(exeFile) {
  return exeFile;
};
FlashGotDMCust.prototype.createExecutable = function() {
  return false;
};
// End FlashGotDMCust.prototype

// *****************************************************************************
// END DMS CLASSES
// *****************************************************************************

// DMS initialization

FlashGotDM.initDMS = function() {
  const isWin = fg.isWindows;
  var dm;

  new FlashGotDM("BitComet");

  dm = new FlashGotDM("Download Accelerator Plus");
  dm.nativeUI = "#dapctxmenu1, #dapctxmenu2";

  dm.performDownload =  function(links, opType) {
    if (!("IDAPComponent" in CI)) {
      this.log("DAP extension not found, falling back to IE integration");
      FlashGotDM.prototype.performDownload.apply(this, arguments);
      return;
    }

    function getDAP() {
      return CC["@speedbit.com/dapfirefox/dapcomponent;1"].createInstance(CI.IDAPComponent);
    }
    function downloadDoc(doc) {
      getDAP().RigthClickMenuDownloadAll(doc, "Firefox");
      doc.defaultView.location.href = "about:blank";
    }

    try {

      if (opType == fg.OP_ONE) {
        var l = links[0];
        getDAP().RigthClickMenuDownload(
          l.href, this.getReferrer(links), this.getCookie(l, links), l.description, "Firefox");
        return;
      }

      if (!links.document) {
        this.log("DAP: No document found");
        return;
      }

      var doc = links.document;
      var url = doc.URL;
      if (opType == fg.OP_SEL) {
        var bwin = links.browserWindow || fg.getBrowserWindow(doc);
        if (!bwin) {
          this.log("DAP: no browser window found");
          return;
        }
        var f = bwin.document.getElementById("_flashgot_iframe");
        if (!f) {
          f =  bwin.document.createElement("iframe");
          f.id = "_flashgot_iframe";
          f.setAttribute("type", "content");
          f.style.display = "none";
        }

        f.docShell.QueryInterface(CI.nsIWebPageDescriptor).loadPage(
          DOM.getDocShellFromWindow(doc.defaultView).QueryInterface(CI.nsIWebPageDescriptor).currentDescriptor,
          2
        );

        var dm = this;
        f.addEventListener("DOMContentLoaded", function(ev) {
          try {
            var f = ev.currentTarget;
            f.removeEventListener(ev.type, arguments.callee, false);
            var doc = f.contentDocument;
            if (doc.URL != url) return;
            var root = doc.documentElement;
            while(root.firstChild) root.removeChild(root.firstChild);
            root.appendChild(doc.createElement("head"));
            root.appendChild(doc.createElement("body"));
            var frag = doc.createDocumentFragment();
            var a, l;
            for(var j = 0; j < links.length; j++) {
              a = doc.createElement("a");
              l = links[j];
              a.href = l.href;
              a.appendChild(doc.createTextNode(l.description));
              frag.appendChild(a);
            }
            doc.body.appendChild(frag);
            downloadDoc(doc, "Firefox");
          } catch(e) {
            dm.log("DAP Selection: " + e.message + " - " + e.stack);
          }
        }, false);

      } else {
        downloadDoc(doc);
      }
    } catch(e) {
      this.log("DAP: " + e.message + " - " + e.stack);
      return;
    }
  };




  new FlashGotDM("Download Master");

  for (dm of [new FlashGotDM("DTA"), new FlashGotDM("DTA (Turbo)")]) {
    dm.__defineGetter__("_supported", function() {
      delete this._supported;
      return this._supported = (function() {
            try {
              IOS.newChannel("chrome://dta-modules/content/support/filtermanager.js", null, null);
              return true;
            } catch(e) {}
            try {
              IOS.newChannel("resource://dta/support/filtermanager.jsm", null, null);
              return true;
            } catch(e) {}
            return  "dtaIFilterManager" in CI || "@downthemall.net/privacycontrol;1" in CC;
          })();
    });
    dm.turboDTA = /Turbo/.test(dm.name);
    dm.nativeUI = dm.turboDTA
      ? "#context-dta-savelinkt, #context-tdta, #dtaCtxTDTA, #dtaCtxSaveT, #dtaCtxTDTA-direct, #dtaCtxSaveT-direct, #dtaCtxTDTASel-direct, #dtaCtxSaveLinkT-direct"
      : "#context-dta-savelink, #context-dta, #dtaCtxDTA, #dtaCtxSave, #dtaCtxDTA-direct, #dtaCtxSave-direct, #dtaCtxDTASel-direct, #dtaCtxSaveLink-direct";

    dm.performDownload = function(links, opType) {
      if(!links.document) {
        this.log("No document found in " + links);
        return;
      }

      var cs = links.document && links.document.characterSet || "UTF-8";
      var w = links.browserWindow || fg.getBrowserWindow(links.document);
      var wrapURL, mlSupport, DTA;
      try {
        if (!("DTA" in this)) {
          this.DTA = {};
          try {
            Components.utils.import("resource://dta/api.jsm", this.DTA);
          } catch (e) {
            var glue = {}
            Components.utils.import("chrome://dta-modules/content/glue.jsm", glue);
            this.DTA = glue.require("api");
          }
        }
        DTA = this.DTA;
        wrapURL = function(url, cs) { return new DTA.URL(IOS.newURI(url, cs, null)); }
        mlSupport = true;
      } catch(e) {

        delete this.DTA;
        if(!(w && w.DTA_AddingFunctions && w.DTA_AddingFunctions.saveLinkArray)) {
          this.log("DTA Support problem: " + w + ", " + (w && w.DTA_AddingFunctions) + ", tb:" +
            w.gBrowser + ", wl:" + w.location + ", wo:" + w.wrappedJSObject + ", " +
              (w && w.DTA_AddingFunctions && w.DTA_AddingFunctions.saveLinkArray));
          return;
        }

        this.log("Legacy DTA (1.x)");
        mlSupport = w.DTA_getLinkPrintMetalink;
        wrapURL = w.DTA_URL
        ? w.DTA_URL.toSource().indexOf("DTA_URL(url, preference)") > -1
          ? function(url, cs) { return new w.DTA_URL(IOS.newURI(url, cs, null)); }
          : function(url, cs) { return new w.DTA_URL(url, cs); }
        : function(url) { return url };

        DTA = {
          __noSuchMethod__: function(m, args) {
            if (m == "saveSingleLink") args.shift();
            else {
              args[0] = turbo;
              if (m === "turboSaveLinkArray") m = "saveLinkArray";
            }
            return w.DTA_AddingFunctions[m].apply(w.DTA_AddingFunctions, args);
          }
        };
      }

      var turbo = this.turboDTA;

      var anchors = [], images = [], l, arr;

      var hash, ml;
      var referrer = this.getReferrer(links);
      var tag;
      var single = opType == fg.OP_ONE;

      var lastItem = null;
      for (var j = 0, len = links.length; j < len; j++) {
        l = links[j];
        arr = single || !(tag = l.tagName) || tag.toLowerCase() == "a" ? anchors : images;
        try {
          arr.push(lastItem = {
              url: wrapURL(l.href, cs),
              description: l.description,
              ultDescription: '',
              referrer: referrer,
              isPrivate: fg.inPrivate,
          });

          if ("postData" in l) lastItem.postData = l.postData;

          if (("fname" in l) && l.fname) {
            lastItem.fileName = lastItem.destinationName = l.fname;
            // if (single && !turbo) single = false;
          }
          if (arr == anchors && mlSupport && l.href.indexOf("#") > 0) {
            hash = l.href.match(/.*#(.*)/)[1];
            ml = mlSupport(l.href);
            if (ml) {
              arr.push(lastItem = {
                url: wrapURL(ml, cs),
                description: '[metalink] http://www.metalinker.org/',
                ultDescription: '',
                referrer: referrer,
                metalink: true
              });
            }
          }
        } catch(e) {
          this.log("DTA: " + e.message);
        }
        this.updateProgress(links, j, len);
      }
      for (;;) {
        try {
          if (!lastItem) {
            this.log("DTA: no link found in " + links.length);
          } else if (single && (DTA.saveSingleItem || w.DTA_AddingFunctions.saveSingleItem)) {
            this.log("DTA.saveSingleItem " + lastItem.toSource());
            DTA.saveSingleItem(w, turbo, lastItem);
          } else if (single && (DTA.saveSingleLink || w.DTA_AddingFunctions.saveSingleLink)) {
            this.log("DTA.saveSingleLink " + lastItem.url);
            DTA.saveSingleLink(w, turbo, lastItem.url, lastItem.referrer, lastItem.description, lastItem.postData || links.postData);
          } else {
            this.log("DTA.saveLinkArray " + anchors.toSource());
            DTA[turbo ? "turboSaveLinkArray" : "saveLinkArray"](w, anchors, images);
          }
          break;
        } catch(e) {
          if (!turbo) break;
          turbo = false;
        }
      }
    }
  }

  new FlashGotDM("FlashGet");
  new FlashGotDM("FlashGet 2");

  try {
    dm = null;
    const FG_CTRID = "@flashget.com/FlashgetXpiEx;1";
    if (FG_CTRID in CC && ("FlvDetector" in CC[FG_CTRID].createInstance(CI.IFlashgetXpi))) {
      dm = new FlashGotDM("FlashGet 3");
      dm._supported = true;
      dm.performDownload = function(links, opType) {
        const obj = CC[FG_CTRID].createInstance(CI.IFlashgetXpi);
        const ref = this.getReferrer(links);
        var l;
        if (opType == fg.OP_ONE) {
          l = links[0];
          obj.AddUrl(l.href, l.description, ref, "FlashGet3", this.getCookie(l, links), 0);
        } else {
          const arr = [ref];
          const len = links.length;
          const dlExtRx = /\.(?:rar|zip|7z|gz|bz2|bz|avi|wmv|mov|flv|mp3|mp4|asf|asx|ram|exe|\d{3})\b/i;
          var cookie = '';
          for (var j = 0; j < len; j++) {
            l = links[j];
            if (l.redirected ||
                !cookie && (l.contentType || dlExtRx.test(l.href))) {
              cookie = this.getCookie(l, links);
            }
            arr[j * 2 + 1] = l.href;
            arr[j * 2 + 2] = l.description;
          }
          if (!cookie) cookie = this.getCookie(links[0], links);
          obj.AddAllUrl(arr.length, arr, "FlashGet3", cookie, 0);
        }
      }
    }
  } catch(e) {
    dm = null;
  }
  dm = dm || new FlashGotDM("FlashGet 2.x");
  dm.nativeUI = "#flashgetSingle, #flashgetAll, #flashgetSep, #flashget3Single, #flashget3All, #flashget3Sep";


  dm = new FlashGotDM("Free Download Manager");

  new FlashGotDM("FreshDownload");


  dm = new FlashGotDM("GetRight");
  dm.metalinkSupport = true;
  dm.download = function(links, opType) {
    if (opType == fg.OP_ONE && !fg.getPref("GetRight.quick")) {
      opType = fg.OP_SEL;
    }
    FlashGotDM.prototype.download.call(this, links, opType);
  };

  dm.createJob = function(links, opType) {
    var folder = links.folder;
    if (!(folder && folder._fgSelected)) folder = false;

    var referrer = this.getReferrer(links);

    switch (opType) {
      case fg.OP_ONE:
        var job = FlashGotDM.prototype.createJob.call(this, links, opType,
          fg.getPref("GetRight.old") ? ["old"] : null
          ).replace(/; /g, ";");
        return job;
      case fg.OP_SEL:
      case fg.OP_ALL:
        var urlList = "";
        var referrerLine = (referrer && referrer.length > 0) ? "\r\nReferer: " + referrer + "\r\n" : "\r\n";
        var replacer = fg.getPref("GetRight.replaceSpecialChars", true) ? /[^\w\.-]/g : /[\x00-\x1f\\]+/g;
        var l, k, len, decodedURL, urlParts, fileSpec, cookie;

        for (var j = 0; j < links.length; j++) {
          l=links[j];

          if (l.fname) fileSpec = l.fname;
          else if (folder) {
            fileSpec = '';
            decodedURL = unescape(l.href);
            urlParts = decodedURL.match(/\/\/.+[=\/]([^\/]+\.\w+)/);
            if (!urlParts) urlParts=l.href.match(/.*\/(.*\w+.*)/);
            if (urlParts && (fileSpec = urlParts[1])
              // && (links.length==1 ||  !/\.(php|[\w]?htm[l]?|asp|jsp|do|xml|rdf|\d+)$/i.test(fileSpec))
             ) {
              urlParts = fileSpec.match(/(.*\.\w+).*/);
              if (urlParts) fileSpec = urlParts[1];
              fileSpec = fileSpec.replace(replacer, '_');
            } else continue;
          } else fileSpec = '';

          if (fileSpec) {
            if (folder) fileSpec = folder + "\\" + fileSpec;
            fileSpec = "File: " + fileSpec + "\r\n";
          }

          urlList+="URL: "+l.href
            +"\r\nDesc: "+l.description + "\r\n" + fileSpec;

            if (l.md5) {
            urlList += "MD5: " + l.md5 + "\r\n";
          }
          if (l.sha1) {
            urlList += "SHA1: " + l.sha1+ "\r\n";
          }
          if (l.metalinks) {
            for (k = 0, len = Math.min(16, l.metalinks.length); k < len; k++) {
              urlList += "Alt: " + l.metalinks[k] + "\r\n";
            }
          } else {
            urlList += referrerLine;
            if ((cookie = this.getCookie(l, links))) {
              urlList += "Cookie: " + cookie + "\r\n";
            }
          }
          this.updateProgress(links, j, len);
        }
        var file = fg.tmpDir.clone();
        file.append("flashgot.grx");
        file.createUnique(0, B8('600'));
        var charset=null;
        try {
          charset=fg.getPref("GetRight.charset",
            fg.prefService.QueryInterface(CI.nsIPrefBranch
            ).getComplexValue("intl.charset.default",
              CI.nsIPrefLocalizedString).data);
        } catch(ex) {}
        IO.writeFile(file, urlList, charset);
        referrer = file.path;
        break;
    }
    var cmdOpts="/Q";
    if (fg.getPref("GetRight.autostart",false)) { // CHECK ME!!!
      cmdOpts+="\n /AUTO";
    }
    return this.createJobHeader({ length: 0, folder: "" }, opType) +
      referrer + "\n" + cmdOpts;
  };
  dm.askPath=[false,true,true];

  new FlashGotDM("GigaGet");

  new FlashGotDM("HiDownload");
  new FlashGotDM("InstantGet");

  dm = new FlashGotDM("iGetter Win");
  dm.nativeUI = "#all-igetter, #igetter-link";
  dm.__defineGetter__("supported", function() {
    if (typeof(this._supported) == "boolean") return this._supported;
    if (fg.isMac) return this._supported = false;

    this._supported = ("nsIGetterMoz" in CI);
    this.cookieSupport = false;
    if (this._supported) return true;
    this.cookieSupport = true;
    return this._supported = !!this.createExecutable();
  });
  dm.createExecutable = function() {
    var exeFile, path, key;

    exeFile = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
    try {
      path = this.readWinRegString("CURRENT_USER", "Software\\iGetter")
      exeFile.initWithPath(path);
    } catch(e) {
      path = null;
    }
    if (!(path && exeFile.exists())) {
      try {
        exeFile = fg.directoryService.get("ProgF", CI.nsIFile);
        exeFile.append("iGetter");
        exeFile.append("iGetter.exe");
      } catch(e) {
        path = "C:\\Program Files\\iGetter\\iGetter.exe";
        try {
          exeFile.initWithPath(path);
        } catch(e2) {
          return null;
        }
      }
    }

    this.browser = 3;
    if ("@mozilla.org/xre/app-info;1" in Components.classes) {
      var info = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
      if(info.name.indexOf("Firefox") > -1) this.browser = 4;
    }

    return exeFile.exists() ? this._exeFile = exeFile : null;
  }
  dm.createJob = function(links, opType) {
    const cs = this.cookieSupport;
    var l;
    var job = [this.getReferrer(links)];
    for (var j=0; j < links.length; j++) {
      l = links[j];
      job.push(l.href,
        cs ? l.description + "~%iget^=" + this.getCookie(l, links)
           : l.description
      );
    }
    return job.join("\r\n") + "\r\n";
  };
  dm.performJob = function(job) {
    const file = this.createJobFile(job);
    if (this.exeFile) {
      return !this.runNative(['-f', file.path, '-b', this.browser])
    } else {
      CC["@presenta/iGetter"]
              .getService(CI.nsIGetterMoz)
              .NewURL(file.path);
      if (file.exists()) file.remove(0);
      return true;
    }
  };

  new FlashGotDM("Internet Download Accelerator");
  (new FlashGotDM("Internet Download Manager")).postSupport = true;

  var lg2002 = new FlashGotDM("LeechGet 2002");
  var lg2004 = new FlashGotDM("LeechGet");

  lg2004.createJob = lg2002.createJob = function(links, opType) {
    var referrer;
    switch (opType) {
      case fg.OP_ONE:
        return FlashGotDM.prototype.createJob.call(this, links,
            links.quickDownload ? fg.OP_ONE : fg.OP_SEL);

      case fg.OP_SEL:
        var htmlDoc="<html><head><title>FlashGot selection</title></head><body>";
        var l;
        for (var j=0, len=links.length; j<len; j++) {
          l = links[j];
          var des = l.description;
          var tag = l.tagName ? l.tagName.toLowerCase() : "";
          htmlDoc = htmlDoc.concat(tag == "img"
            ? '<img src="' + l.href + '" alt="' + des
              + '" width="' + l.width + '" height="' + l.height +
              "\" />\n"
            : "<a href=\"" + l.href + "\">" + des + "</a>\n");
          this.updateProgress(links, j, len);
        }
        referrer = fg.httpServer.addDoc(
          htmlDoc.concat("</body></html>")
        );
        break;
       default:
        referrer = links.document && links.document.URL || "";
        if (referrer.match(/^\s*file:/i)) { // fix for local URLs
          // we serve local URLs through built-in HTTP server...
          return this.createJob(links,fg.OP_SEL);
        }
    }
    return this.createJobHeader({ length: 0, folder: "" },opType) + referrer + "\n";
  };

  new FlashGotDM("Net Transport");
  new FlashGotDM("Net Transport 2");
  new FlashGotDM("NetAnts");
  new FlashGotDM("Mass Downloader");

  dm = new FlashGotDM("Orbit");
  dm.nativeUI = "#OrbitDownloadUp, #OrbitDownload, #OrbitDownloadAll, #OrbidDownload_menuitem, #OrbitDownloadAll_menuitem";

  dm = new FlashGotDM("ReGet");
  dm.postSupport = true;
  if("@reget.com/regetextension;1" in CC) {
    try {
      dm.reGetService = CC["@reget.com/regetextension;1"].createInstance(CI.IRegetDownloadFFExtension);
      if (dm.reGetService.isExtensionEnabled()) {
        dm._supported = true;
        dm.performJob = function() { return true };
        dm.createJob = function(links, opType) {
          const rg = this.reGetService;
          var l;
          var len = links.length;
          var ref = links.referrer;
          if (len == 1) {
            l = links[0];
            rg.setUrl(l.href);
            rg.setInfo(l.description);
            rg.setCookie(this.getCookie(l, links));
            rg.setReferer(ref);
            rg.setPostData(l.postData || links.postData);
            rg.setConfirmation(true);
            rg.addDownload();
            return;
          }
          for (var j = 0; j < len; j++) {
            l = links[j];
            rg.addToMassDownloadList(
              l.href,
              ref,
              this.getCookie(l, links),
              l.description,
              "");
            this.updateProgress(links, j, len);
          }
          rg.runMassDownloadList();
        }
      }
    } catch(rgEx) {}
  }

  if (isWin) {
    dm = new FlashGotDMCust("Retriever");
    dm.cookieSupport = true;
    dm.askPath = ASK_NEVER;
    dm.custom = false;
    dm._supported = null;

    if (fg.getPref(dm.prefsBase + "maxLinks", -1000) == -1000) {
      fg.setPref(dm.prefsBase + "maxLinks", 10);
    }
    dm.customSupportCheck = function() {
      try {
        var cmd = this.readWinRegString("CLASSES_ROOT", "Retriever.Retriever.jar.HalogenWare\\shell\\Open\\command");
        this.jarPath = cmd.replace(/.*-jar "?(.*?\.jar).*/, "$1");
        this.argsTemplate = "[URL] [Referer:REFERER] [Cookie:COOKIE] [post:POST]";

        this.exeFile = fg.java;

        return true;
      } catch(e) {
        return false;
      }
    };

    dm.makeArgs = function(parms) {
      return ["-jar", this.jarPath].concat(
        FlashGotDMCust.prototype.makeArgs.apply(this, arguments)
      );
    };

    dm = new FlashGotDMCust("DownloadStudio");
    dm.cookieSupport = true;
    dm.askPath = ASK_NEVER;
    dm.custom = false;
    dm._supported = null;

    dm.customSupportCheck = function() {
      try {
        var path = this.readWinRegString("LOCAL_MACHINE", "SOFTWARE\\Conceiva\\DownloadStudio", "Path");
        if (!path) return false;
        var exeFile = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
        exeFile.initWithPath(path);
        exeFile.append("DownloadStudio.exe");
        if (exeFile.exists() && exeFile.isExecutable()){
          this.exeFile = exeFile;
          this.argsTemplate = "<downloadstudio><originator>firefox</originator> " +
            "<script><add_jobs display_dialog=yes><joblist><job> [<url>URL</url>] " +
            "[<url_list_file>UFILE</url_list_file>] [<referer>REFERER</referer>] " +
            "[<post_data>POST</post_data>] [<cookie>COOKIE</cookie>] " +
            "</job></joblist></add_jobs></script></downloadstudio>";
          return true;
        }
      } catch(e) {}
      return false;
    };

  }

  const httpFtpValidator = function(url) {
    return /^(http:|ftp:)/.test(url);
  };
  dm = new FlashGotDM("Star Downloader");
  dm.cookieSupport = false;
  dm.isValidLink = httpFtpValidator;

  dm = new FlashGotDM("TrueDownloader");
  dm.isValidLink = httpFtpValidator;


  dm = new FlashGotDM("Thunder");
  dm.nativeUI = "#ThunderDownloadUp, #ThunderDownload, #ThunderDownloadAll";
  dm.thunderDelay = 3000;
  dm.performDownload = function(links, opType) {
    var self = this;
    var postCall = function() {
      self.__proto__.performDownload.call(self, links, opType);
    }
    try {
      var path = this.readWinRegString("LOCAL_MACHINE","Software\\Thunder Network\\ThunderOem\\thunder_backwnd", "Path");
      var exeFile = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
      exeFile.initWithPath(path);
      this.runNative([], false, exeFile);
      fg.delayExec(postCall, this.thunderDelay); // give thunder one second to popup (more if cold start)
      this.thunderDelay = 1000;
      return;
    } catch(e) {}
    postCall();
  }
  new FlashGotDM("Thunder (Old)");


  if (isWin) {
    dm = new FlashGotDM("WellGet");
    dm.autoselect = false;
    dm.getRelativeExe = function() {
      try {
        return fg.prefs.getComplexValue("WellGet.path", CI.nsILocalFile);
      } catch(ex) {}
      return null;
    };
    dm.customSupportCheck = function() {
      var wellGetExe = this.getRelativeExe();
      try {
         var currentPath = wellGetExe.path;
         if(wellGetExe.exists() && wellGetExe.isExecutable()) return true;

         wellGetExe.initWithPath(fg.profDir.path.substring(0,2) +
           currentPath.substring(2));
         if (wellGetExe.exists() && wellGetExe.isExecutable()) {
           if(wellGetExe.path != currentPath) {
              fg.prefs.setComplexValue("WellGet.path",  CI.nsILocalFile, wellGetExe);
           }
           return true;
         }
         return false;
      } catch(ex) {
      }

      return !wellGetExe && this.baseSupportCheck();
    };
    dm.createJob = function(links, opType) {
      var wellGetExe = this.getRelativeExe();
      return FlashGotDM.prototype.createJob.call(this, links, opType,
        wellGetExe ? [wellGetExe.path] : null);
    };
    dm.shouldList = function() { return true; }
  }

  dm = new FlashGotDM("JDownloader");
  dm.askPath = [true, true, true];
  dm.cookieSupport = true;
  dm.customSupportCheck = function() {
    try {
      if (this._checkPath()) return true;

      var self = this;
      fg.delayExec(function() {
        var r = self._createRequest("GET", function(r) {
          self._handleResponse(r.responseText.split(/[\r\n]+/));
        });
        r.send(null);
      }, 0);
    } catch(e) {
      fg.log(e);
    }
    return false;
  };
  dm._handleResponse = function(res) {
    if (res.length < 2) return;
    var p = res[0];
    if (fg.isWindows) p = p.replace(/\//g, '\\');
    this.setPref("path", p);
    if (this._checkPath()) {
      this.setPref("args", res[1].substring(0, res[1].lastIndexOf(res[0])).replace(/^java\s*/, ''));
      this._supported = true;
    }
  };
  dm._checkPath = function() {
    try {
      var p = this.getPref("path", "");
      if (p) {
        var f = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
        f.initWithPath(p);
        if (f.exists()) {
          this.jdFile = f;
          return true;
        }
      }
    } catch(e) {}
    this.setPref("path", "");
    this.jdFile = null;
    return false;
  };

  dm._winExe = function() {
    var exe = null;
    if (fg.isWindows) try {
      var fname = this.jdFile.leafName;
      if (/\.(jar|exe)$/.test(fname)) {
        var f = this.jdFile.clone();
        f.leafName = fname.replace(/jar$/, 'exe');
        if (f.exists() && f.isExecutable()) this.jdFile = exe = f;
      }
    } catch (e) {}
    return exe;
  };

  dm._macExe = function() {
    try {
      if (!/\.app\/Contents\/Resources\/Java\/[^\/]+\.jar$/.test(this.jdFile.path)) return null;
      var exe = this.jdFile.parent.parent.parent;
      exe.append("MacOS");
      exe.append("JavaApplicationStub");
      return exe.exists() ? exe : null;
    } catch (e) {
      return null;
    }
  },

  dm._createRequest = function(method, callback) {
    var r = CC["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(CI.nsIXMLHttpRequest);
    var url = this.getPref("url");
    r.open(method, url, true);
    try {
      var chan = r.channel;
      if (chan instanceof CI.nsIHttpChannel) {
        var referrer = chan.URI.clone();
        referrer.host = "localhost";
        chan.referrer = referrer;
      }
      chan.loadFlags |= chan.INHIBIT_PERSISTENT_CACHING;
    } catch(e) {
      fg.log(e);
    }

    if (callback) {
      r.addEventListener("readystatechange", function() {
        if (r.readyState === 4) {
          try {
            fg.log("JDownloader response:\n" + r.status + "\n" + r.responseText);
          } catch (e) {}
          callback(r);
        }
      }, false);
    }
    return r;
  }
  dm.MAX_RETRIES = 6;
  dm.performDownload = function(links, opType) {
    const pp = { urls: [], descriptions: [], cookies: [] };
    var l, j, len;
    for (j = 0, len = links.length; j < len; j++) {
      l = links[j];
      pp.urls.push(l.href);
      pp.descriptions.push(l.description);
      pp.cookies.push(this.getCookie(l, links));
    }

    if (links.some(function(l) { return "fname" in l }))
      pp.fnames = links.map(function(l) { return l.fname || ''; });

    if (links.some(function(l) { return "pwd" in l }))
      pp.arcpass = links.map(function(l) { return l.pwd || ''; });

    if (links.some(function(l) { return "userPass" in l }))
      pp.httpauth = links.map(function(l) { return l.userPass || '' });

    const data = [
      "autostart=" + (this.getPref("autostart", true) ? "1" : "0"),
      "package=" + encodeURIComponent(links.document && links.document.title || "FlashGot")
    ];
    const referrer = this.getReferrer(links);
    if (referrer) data.push("referer=" + encodeURIComponent(referrer));
    if (links.folder && links.folder._fgSelected) data.push("dir=" + encodeURIComponent(links.folder));
    if (links.postData) data.push("postData=" + encodeURIComponent(links.postData));
    for (j in pp) {
      data.push(j + "=" + encodeURIComponent(pp[j].join("\n")));
    }
    this._post({data: data.join("&"), retries: this.MAX_RETRIES});
  };
  dm._post = function(ctx) {
    var self = this;
    var r = this._createRequest("POST", function(r) {
      if (r.status != 200) self._handleRetry(ctx);
    });

    r.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    r.send(ctx.data);
  };

  dm._handleRetry = function(ctx) {
    var msg, fail = true;
    if (ctx.retries-- == this.MAX_RETRIES) {
      if (this._checkPath()) try {
        var args,
            exe = this._winExe() || this._macExe();
        if (exe) {
          args = [];
        } else {
          if (!this.java) {
            this.java = fg.java;
          }
          exe = this.java;
          args = this.getPref("args", '').split(/\s+/).filter(function(a) { return a });
          args.push("-jar");
          args.push(this.jdFile.path);
        }
        fail = !this.runNative(args, false, exe);
      } catch(e) {
        fg.log(e);
        this.java = null;
      }
      if (fail) msg = "Cannot launch " + (this.jdFile && this.jdFile.path || "JDownloader") + ". Please launch it manually or ensure Java is enabled in your browser.";
    } else if (ctx.retries == 0) {
      msg = "JDownloader not responding on " + this.getPref("url") + "!\nPlease check your firewall settings.";
    } else {
      fail = false;
    }
    if (fail) {
      DOM.mostRecentBrowserWindow.alert(msg);
    } else {
      var self = this;
      fg.delayExec(function() { self._post(ctx); }, this.getPref("delay", 8) * 1000);
    }
  };

  dm = new FlashGotDMX("Aria", "aria", "[-r REFERER] [-d FOLDER] -g [URL]");
  dm.createJob = function(links,opType) {
    return FlashGotDMX.prototype.createJob.call(this,links,opType) + "\nsleep 4\n" + this.unixCmd + " -s &\n";
  };

  dm = new FlashGotDMX("Downloader 4 X (nt)", "nt");
  dm.createJob = function(links, opType) {
    return this.unixCmd + "&\nsleep 1\n" +
      (links.folder && links.folder._fgSelected
      ? this.unixCmd + " -d " + this.shellEsc(links.folder) + "\n"
      :"") +
      FlashGotDMX.prototype.createJob.call(this, links, opType);
  };

  dm = new FlashGotDMX("Downloader 4 X", "d4x", "[--referer REFERER] [-a URL] [--al POST] [COOKIE]");
  dm.askPath = [false, true, true];
  dm.cookieSupport = true;
  dm.createJob = function(links, opType) {
    const shellEsc = this.shellEsc;
    const referrer = shellEsc(this.getReferrer(links));
    const folder = links.folder._fgSelected && links.folder || null;
    const quiet = this.quiet;
    const len = links.length;
    var job;

    if (len > 0) {

      var urls = [];
      const ftpDirRx = /^(ftp:\/\/.*)\/$/;
      for (var j = 0; j < len; j++) {
        urls.push(shellEsc(links[j].href.replace(ftpDirRx, '$1')));
        this.updateProgress(links, j, len);
      }
      urls = urls.join(" ");

      var promptURLs_fakePost = null;
      var quietURLs_fakeCookie = null;

      if (quiet) {
        quietURLs_fakeCookie = urls;
        urls = null;
      } else if(len > 1) {
        promptURLs_fakePost = urls;
        urls = null;
      }

      var cookieFile = this.createCookieFile();

      job = (cookieFile && cookieFile.path)
        ? "mkdir -p $HOME/.netscape && ln -fs " +
          shellEsc(cookieFile.path) +
          " $HOME/.netscape/cookies\n"
        : "";

      if (folder) job += this.unixCmd + " -d " + shellEsc(folder) + "\n";

      job += this.createCmdLine({
         URL: urls,
         REFERER: referrer,
         COOKIE: quietURLs_fakeCookie || null,
         POST: promptURLs_fakePost
      });
    } else job = "";

    return job;
  };

  dm = new FlashGotDMX("GNOME Gwget","gwget");
  dm.askPath = ASK_NEVER;
  dm.createJob = function(links, opType) {
    if (opType == fg.OP_ALL) {
      links.length = 1;
      links[0].href = links.document ? links.document.URL : this.getReferrer(links);
      opType = fg.OP_ONE;
    }
    return FlashGotDMX.prototype.createJob.call(this, links, opType)
  }

  dm = new FlashGotDMX("FlareGet", "flareget",
      "[URL] [-o FNAME] [-c COOKIE] [-l CFILE] [-a USERPASS] [-u UA] [-r REFERER] [-d POST]",
      "/opt/flareget");
  dm.askPath = ASK_NEVER;

  dm = new FlashGotDMX("KDE KGet","kget", "[ULIST]");
  dm.askPath = ASK_NEVER;

  if (isWin) {
    new FlashGotDM("wxDownload Fast");
  } else {
    dm = new FlashGotDMX("wxDownload Fast", "wxdfast", "[-reference REFERER] [-destination FOLDER] [-list UFILE]");
    dm.askPath = ASK_NEVER;
  }

  dm = new FlashGotDMX("Axel", "axel", '-a -n 4 [-o FNAME] [URL]');
  dm.terminal = true;
  dm.createJob = function(links, opType) {
    this.argsTemplate = this.argsTemplate.replace(/\b-n \d+/, "-n " + this.getPref("connections", 4));
    this._checkAxelFeatures();
    return this.__proto__.createJob.call(this, links , opType);
  };
  dm._checkAxelFeatures = function() {
    const outFile = fg.tmpDir.clone();
    outFile.append("axelHelp.txt");
    this.performJob(this.unixCmd + " -h >'" + outFile.path + "' 2>&1", true);
    if(IO.readFile(outFile).indexOf("--header") < 0) {
      this.cookieSupport = false;
    } else {
      this.cookieSupport = true;
      this.argsTemplate = '[-H Cookie:COOKIE] [-H Referer:REFERER] ' + this.argsTemplate;
    }
    this.checkCookieSupport();
    this._checkAxelFeatures = function() {};
  }


  dm = new FlashGotDMX("cURL", "curl", '-C - -L [-o FNAME|-O] [--referer REFERER] [-b COOKIE] [-d POST] [--anyauth -u USERPASS] [--user-agent UA] [URL]');
  dm.postSupport = true;
  dm.authURLSupport = false;
  dm.terminal = true;
  if (fg.isMac) dm.autoselect = false;

  dm = new FlashGotDMX("FatRat", "fatrat", "[ULIST]");
  dm.askPath = ASK_NEVER;

  dm = new FlashGotDMX("MultiGet", "multiget", '[url=URL] [refer=REFERER]');
  dm.askPath = ASK_NEVER;

  dm = new FlashGotDMX("Prozilla", "proz", '-r [-P FOLDER] [URL]');
  dm.terminal = true;

  dm = new FlashGotDMX("Wget", "wget", '-c [-O FNAME] [--directory-prefix=FOLDER] [--referer=REFERER] [--post-data=POST] [--load-cookies=CFILE] [--header=Cookie:COOKIE] [--input-file=UFILE] [--user-agent=UA] [URL]');
  dm.postSupport = true;
  dm.terminal = true;
  dm.__defineGetter__("_trustServerOpt", function() {
    const outFile = fg.tmpDir.clone();
    outFile.append("wgetHelp.txt");
    if (this.performJob(this.unixCmd + " -h >'" + outFile.path + "' 2>&1", true)) {
      delete this._trustServerOpt;
      return this._trustServerOpt = IO.readFile(outFile).indexOf("--trust-server-names") !== -1;
    }
    return false;
  });
  dm.createJob = function(links, opType) {
    const homeDir = fg.directoryService.get("Home", CI.nsILocalFile).path;
    const opt = "--trust-server-names ";
    if (links.folder == homeDir)
      while (this.argsTemplate.indexOf(opt) !== -1)
        this.argsTemplate = this.argsTemplate.replace(opt, "");
    else if (this._trustServerOpt && this.argsTemplate.indexOf(opt) < 0)
      this.argsTemplate = opt + this.argsTemplate;
    return this.__proto__.createJob.call(this, links, opType);
  }

  var ugetTemplate = '[--http-cookie-file=CFILE] [--http-post-data=POST] [--http-referer=REFERER] [--filename=FNAME] [--input-file=UFILE]';
  if (fg.isWindows) {
    dm = new FlashGotDMCust("uGet", "Uget");
    dm.argsTemplate = ugetTemplate;
    dm.cookieSupport = true;
    dm.askPath = ASK_NEVER;
    dm.custom = false;
    dm._supported = null;

    dm.customSupportCheck = function() {
      var path;
      try {
        path = this.readWinRegString("LOCAL_MACHINE", "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\uget.exe");
      } catch (e) {
        path = this.getPref("path");
      }

      if (!path) return false;

      try {
        var exeFile = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
        exeFile.initWithPath(path);
        if (!(exeFile.exists() && exeFile.isExecutable())) return false;
        this.exeFile = exeFile;
        return true;
      } catch(e) {
        return false;
      }
    };


  } else {
    dm = new FlashGotDMX("uGet", "uget-gtk",  ugetTemplate);
    dm._codeName = "Uget";
    dm.postSupport = true;
    dm.askPath = ASK_NEVER;
  }
  // backward compatibility with name change
  // TODO: refactor me for future reuse
  if (/\bUget\b/.test(fg.getUPref('detect.cache', ''))) {
    if (fg.defaultDM === dm.codeName) fg.defaultDM = dm.name;
    if (fg.getUPref("media.dm") === dm.codeName) fg.setUPref("media.dm", dm.name);
    fg.setUPref('detect.cache', fg.getUPref('detect.cache', '').replace(/\bUget\b/, dm.name));
  }


  var xdmTemplate = '[-u URL] -m [-c COOKIE] [-r REFERER]';
  if (fg.isWindows) {
    dm = new FlashGotDMCust("XDM");
    dm.argsTemplate = xdmTemplate;
    dm.cookieSupport = true;
    dm.askPath = ASK_NEVER;
    dm.custom = false;
    dm._supported = null;

    dm.customSupportCheck = function() {
      var path;
      try {
        path = this.readWinRegString("CURRENT_USER", "SOFTWARE\\xdm", "Path");
      } catch (e) {
        path = this.getPref("path");
      }

      if (!path) return false;

      try {
        var exeFile = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
        exeFile.initWithPath(path);
        if (!(exeFile.exists() && exeFile.isExecutable())) return false;
        this.exeFile = exeFile;
        return true;
      } catch(e) {
        return false;
      }
    };


  } else {
    dm = new FlashGotDMX("XDM", "xdman",  xdmTemplate);
    dm.askPath = ASK_NEVER;
  }


  dm = new FlashGotDM("pyLoad");
  dm.askPath = ASK_NEVER;
  dm.cookieSupport = true;
  dm.autoselect = false;
  dm._supported = true; // pyload does not necessarily need to run on localhost, so it should always be active
  dm._createRequest = function(method, url, callback, async) {
    var r = CC["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(CI.nsIXMLHttpRequest);
    r.open(method, url, async);
    try {
      var chan = r.channel;
      if (chan instanceof CI.nsIHttpChannel) {
        var referrer = chan.URI.clone();
        referrer.host = "localhost";
        chan.referrer = referrer;
      }
    } catch(e) {
      fg.log(e);
    }

    if (callback) {
      r.addEventListener("readystatechange", function() {
        if (r.readyState === 4) {
          try {
            fg.log("pyLoad response status:\n" + r.status + "\n" + r.statusText);
          } catch (e) {}
          callback(r);
        }
      }, false);
    }
    return r;
  }
  dm.performDownload = function(links, opType) {
    const pp = { urls: [], descriptions: [], cookies: [] };
    var l, j, len;
    for (j = 0, len = links.length; j < len; j++) {
      l = links[j];
      pp.urls.push(l.href);
      pp.descriptions.push(l.description);
      pp.cookies.push(this.getCookie(l, links));
    }

    if (links.some(function(l) { return "fname" in l }))
      pp.fnames = links.map(function(l) { return l.fname || ''; });

    if (links.some(function(l) { return "pwd" in l }))
      pp.arcpass = links.map(function(l) { return l.pwd || ''; });

    if (links.some(function(l) { return "userPass" in l }))
      pp.httpauth = links.map(function(l) { return l.userPass || '' });

    var pkg = (links.document && links.document.title || "FlashGot");
    // filter out all non-ASCII characters, because pyLoad 0.4.9 crashes when logging a non-ASCII character (e.g. '»')
    pkg = encodeURIComponent(pkg.replace(new RegExp("[^\x20-\x7E]","im"),""));

    const data = [
      "autostart=" + (this.getPref("autostart", true) ? "1" : "0"),
      "package=" + pkg
    ];
    const referrer = this.getReferrer(links);
    if (referrer) data.push("referer=" + encodeURIComponent(referrer));
    if (links.postData) data.push("postData=" + encodeURIComponent(links.postData));
    for (j in pp) {
      data.push(j + "=" + encodeURIComponent(pp[j].join("\n")));
    }
    this._post(data.join("&"));
  };
  dm._post = function(data) {
    var self = this;
    var url = this.getPref("url");
    var r = this._createRequest("POST", url, function(r) {
      if (r.status != 200) {
      	var msg = r.status === 500
          ? "An internal error occured during adding the package to pyLoad. Check the pyLoad logfile for further information!"
          : "pyLoad is not responding on " + self.getPref("url")
            + "!\nPlease check your firewall settings and the pyLoad configuration for the 'ClickAndLoad' plugin.\n"
            + "Or try to restart pyLoad or the device itself (pyLoad may not be responding properly after some time)."
        ;
        DOM.mostRecentBrowserWindow.alert(msg);
      }
    });

    r.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    r.send(data);
  };

  dm = new FlashGotDMX("Aria 2", "aria2c", '--continue [-d FOLDER] [-o FNAME] [--referer=REFERER] [--load-cookies=CFILE] [--input-file=UFILE] [URL]');
  dm.terminal = true;

  dm = new FlashGotDMX("Steadyflow", "steadyflow", '[add URL]');
  dm.askPath = ASK_NEVER;


    if (fg.isWindows) {
        dm = new FlashGotDMCust("ZigzagDownLoader");
        dm.cookieSupport = true;
        dm.custom = false;
        dm._supported = null;

        dm.customSupportCheck = function() {
          var path;
          try {
            path = this.readWinRegString("LOCAL_MACHINE", "SOFTWARE\\Cygwin\\setup", "rootdir");
          } catch (e) {
            path = null;
          }

          if (!path) return false;

          try {
            var exeFile = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
            exeFile.initWithPath(path);
            exeFile.append("zdl.bat");
            if (!(exeFile.exists() && exeFile.isExecutable())) return false;

            this.exeFile = exeFile;
            this.argsTemplate = "--stream [URL] [FNAME] [FOLDER] [CFILE] [COOKIE] [REFERER]";
            return true;
          } catch(e) {
            return false;
          }
        };
      } else {
        dm = new FlashGotDMX("ZigzagDownLoader", "zdl", "--stream [URL] [FNAME] [FOLDER] [CFILE] [COOKIE] [REFERER]");
      }



  if (fg.isMac) {
    dm = new FlashGotDMX("Progressive Downloader", "$(defaults read com.PS.PSD psAppPath)", "-add [url UFILE] [cookie CFILE] [referer REFERER] [destination FOLDER]");
  }

  function FlashGotDMSD(version) {
    this._initMac(typeof(version) == "number" && version > 3 ? "Speed Download" : ("Speed Download " + version), "Spee");
    this.version = version;
    if (version > 2 || version == "Lite") {
      this.cookieSupport = true;
      this.postSupport = true;
    }
  };

  FlashGotDMSD.prototype=new FlashGotDMMac();
  FlashGotDMSD.prototype.createJob = function(links,opType) {
    var urlList = [];
    var cookieList = [];
    var l;
    for (var j=0, len = links.length; j < len; j++) {
      l = links[j];
      urlList.push(l.href);
      if (this.cookieSupport) {
        cookieList.push(this.getCookie(l, links));
      }
      this.updateProgress(links, j, len);
    }
    var job = 'tell app "' + this.macAppName +
      '" to AddURL {"' + urlList.join('","') + '"}';

    if (this.postSupport) {
      var postData = links[0].postData || links.postData;
      if (postData) {
        job +=' with form data "' + postData + '"';
      }

      const referer = this.getReferrer(links);
      if (referer && referer.length) {
        job += ' from "' + referer + '"';
      }

      if (cookieList.length) {
        job += ' with cookies {"' + cookieList.join('","') + '"}';
      }
    }

    return job;
  };

  if (fg.getPref("oldSD", false)) {
    new FlashGotDMSD(2);
    new FlashGotDMSD(3);
  }
  new FlashGotDMSD(3.5);
  new FlashGotDMSD("Lite");

  dm = new FlashGotDMMac("Leech", "com.manytricks.Leech");
  dm.askPath = [true, true, true];
  dm.cookieSupport = dm.postSupport = true;
  dm.createJob = function(links, opType) {
    var urlList = [];
    var cookieList = [];
    var l;
    for (var j = 0, len = links.length; j < len; j++) {
      l = links[j];
      urlList.push(l.href);
      if (this.cookieSupport) {
        cookieList.push(this.getCookie(l, links).replace(/;\s*$/, ''));
      }
      this.updateProgress(links, j, len);
    }

    var job = 'tell app "' + this.macAppName + '" to download URLs {"'
      + urlList.join('", "') + '"}';
    var postData = links[0].postData || links.postData;
    if (postData) {
      job += ' by posting data "' + postData + '"';
    }
    job += ' to POSIX path "' + links.folder + '"';
    if (cookieList.length) {
      job += ' using cookies "' + cookieList.join('; ') + '; "';
    }
    const referer = this.getReferrer(links);
    if (referer && referer.length) {
      job += ' with referrer "' + referer + '"';
    }

    return job;
  }

  dm = new FlashGotDMMac("iGetter", "iGET");
  dm.cookieSupport = true;
  dm.nativeUI = ["sep", "link", "sel", "all"].map(
    function(s) { return "#context-igetter-" + s; }
  ).join(",");

  dm.createJob = function(links, opType) {
    const referrer = this.getReferrer(links);
    var l, params = [];
    for (var j = 0, len = links.length; j < len; j++) {
      l = links[j];
      params.push('{\u00ABclass ----\u00BB:"' + l.href +
        '", \u00ABclass refe\u00BB:"' + referrer  +
        '", \u00ABclass cook\u00BB:"' + this.getCookie(l, links) +
        '"}');
      this.updateProgress(links, j, len);
    }
    return "tell application \"" + this.macAppName +
      "\"\n\u00ABevent iGETGURL\u00BB {" +
       params.join(",") +
      "} given \u00ABclass brsg\u00BB:\"MOZB\"\n" +
      "end tell\n";
  };

  dm = new FlashGotDMMac("Folx 2", "com.eltima.Folx");
  dm.nativeUI = "#folxAddURL, #folxAddAllURLs, #folxAddSelected";
  dm.cookieSupport = true;
  dm.createJob = function(links, opType) {
    var urls = [], cookies = [], titles = [];
    for (var j = 0, len = links.length, l; j < len; j++) {
      l = links[j];
      urls.push(l.href);
      cookies.push(this.getCookie(l, links));
      titles.push(l.description.replace(/[\u0000-\u0020"\s]+/g, ' '));
    }
    var job = "tell application \"Folx\"\nactivate\n" +
      'add URLs {"' + urls.join('", "') +
      "\"} with referrer \"" + this.getReferrer(links) +
      "\" with cookies {\"" + cookies.join('", "') +
      "\"} with titles {\"" + titles.join('", "') +
      "\"} ";
    var postData = links[0].postData || links.postData;
    if (postData) {
      job += 'with post data "' + postData + '"';
    }
    job += "\nend tell";

    return job;
  }

  dm = new FlashGotDMMac("Folx", "com.eltima.Folx3");
  ["nativeUI", "cookieSupport", "createJob"].forEach(function(p) {
    dm[p] = FlashGotDM.dms["Folx 2"][p];
  });

  dm.performDownload = function(links, opType) {
    var job = this.createJob(links, opType);
    this.performJob(job, true);
    this.performJob(job.replace("Folx", "Folx 3"));
  };

  if ("nsIDownloadManager" in CI) {
    dm = new FlashGotDM(fg.getString("dm.builtIn"));
    dm._codeName = "_Built_In_";
    dm._supported = true;
    dm.priority = "zzz"; // put on the bottom of the list

    dm.askPath = [true, true, true];
    dm.postSupport = true;

    dm._checkLinks = function(links, cs, callback) {
      var l, ch,
        count = links.length,
        noRedir = this.getPref("noRedir") || links.postData,
        allDone = true,
        progressHolder = { progress: links.progress };

      var rx;
      try {
        rx = new RegExp(this.getPref("noRedir.extensions"), "i");
      } catch (e) {}

      for (var j = links.length; j-- > 0;) {
        l = links[j];
        l.uri = IOS.newURI(l.href, cs, null);

        if (noRedir || l.postData || l.fname || !(l.uri instanceof CI.nsIURL) ||
            rx && rx.test(l.uri.fileName)) {
          count--;
          continue;
        }

        allDone = false;

        try {
          ch = IOS.newChannelFromURI(l.uri);
        }
        catch (x) {
          this.log("newChannelFromURI() failed: " + l.href + " (" + l.uri.spec + "): " + x + "\n" + x.stack);
          --count;
          continue;
        }
        ch.asyncOpen({
          dm: this,
          link: l,
          onStartRequest: function(ch, ctx) {
            if (!(ch instanceof CI.nsIHttpChannel) || !Components.isSuccessCode(ch.status) || Math.floor(ch.responseStatus / 100) != 3)
              this._done(ch);
          },
          onDataAvailable: function(req, ctx , stream , offset , count ) {
            this._done(ch);
          },
          onStopRequest: function(req, ctx, status) {
          },

          _done: function(ch) {
            var status = ch.status;
            ch.cancel(NS_BINDING_ABORTED);
            if (ch instanceof CI.nsIHttpChannel && Components.isSuccessCode(status) && ch.responseStatus == 200 && !/\b(?:x|ht)ml\b/.test(ch.contentType)) {
              // this.link.uri = ch.URI; // removed, it breaks filesonic.com...
              this.link.fname = fg.extractFileName(ch) || this.link.fname;
            }

            if (--count === 0) {
              callback();
              progressHolder.progress.update(100);
            } else {
              this.dm.updateProgress(progressHolder, links.length - count, links.length);
            }
          }
        }, null);
      }

      if (allDone) callback();
      else links.progress = null; // prevents the progress bar from being filled immediately
    };

    dm._prepareDownload = function(links, opType) {
      const cs = links.document && links.document.characterSet || "UTF-8";
      var ref = this.getReferrer(links);
      try {
        links.refURI = ref && IOS.newURI(ref, cs, null) || null;
      } catch(e) {
        fg.log(e + "\n... for ref=" + ref + ", charset=" + cs);
        links.refURI = null;
      }

      var self = this;
      this._checkLinks(links, cs, function() { self.performDownload(links, opType); });
    };

    dm._streamify = function(s, contentType) {
      if (s == null) return null;
      var stream = CC["@mozilla.org/io/string-input-stream;1"].createInstance(CI.nsIStringInputStream);
      stream.setData(s, s.length);
      if (stream instanceof CI.nsISeekableStream) stream.seek(0, 0);
      var mis = CC["@mozilla.org/network/mime-input-stream;1"].createInstance(CI.nsIMIMEInputStream);
      if (contentType) { mis.addHeader("Content-Type", contentType); }
      mis.addContentLength = true;
      mis.setData(stream);
      return mis;
    }

    dm.performDownload = function(links, opType) {
      if (!links._prepared) {
        links._prepared = true;
        this._prepareDownload(links, opType);
        return;
      }

      const persistFlags = CI.PERSIST_FLAGS_REPLACE_EXISTING_FILES |
        CI.nsIWebBrowserPersist.PERSIST_FLAGS_AUTODETECT_APPLY_CONVERSION |
        CI.nsIWebBrowserPersist.PERSIST_FLAGS_FROM_CACHE;

      const dType = CI.nsIDownloadManager.DOWNLOAD_TYPE_DOWNLOAD;
      var postData = links.postData, postStream;
      var uri, folder, file;
      var args;
      var now = Date.now() * 1000;
      var dm = CC["@mozilla.org/download-manager;1"].getService(CI.nsIDownloadManager);
      folder = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
      folder.initWithPath(links.folder);
      var mozAddDownload;
      try { // Fx 26 and above
        Components.utils.import("chrome://flashgot/content/JSDownloadsAPI.jsm");
      } catch (e) {
        fg.log(e);
        JSDownloadsAPI = null;
      }
      if (!JSDownloadsAPI) {
        // older browsers / Seamonkey
        if(dm.startBatchUpdate) {
          mozAddDownload = typeof(dType) == "undefined"
            ? function(src, dest, des, persist) { return dm.addDownload(src, dest, des, null, now, null, persist); }
            : function(src, dest, des, persist) { return dm.addDownload(dType, src, dest, des, null, null, now, null, persist); }
            ;
          dm.startBatchUpdate();
        } else {
          mozAddDownload = function(src, dest, des, persist) { return dm.addDownload(dType, src, dest, des, null, now, null, persist, fg.inPrivate); };
        }
      }

      var dl;
      const overwrite = this.getPref("overwrite", false);
      var persist = {}; // dummy for JSDownloadsAPI
      var isPrivate = fg.inPrivate;
      for(var j = 0, len = links.length, l; j < len; j++) {
        l = links[j];
        try {
          uri = l.uri;

          file = fg.createDownloadFile(folder, l.fname || uri, overwrite);

          if (!file) continue;
          fg.log("Saving " + l.href + " to " + file.path);

          if (JSDownloadsAPI) {

            JSDownloadsAPI.add(l, links, file.path, isPrivate, function(err) {
              if (isPrivate) {
                Cu.reportError(err);
              } else {
                fg.log("Skipping link " + l.href + ": " + err);
              }
            });

            continue;
          }

          persist = CC["@mozilla.org/embedding/browser/nsWebBrowserPersist;1"].createInstance(CI.nsIWebBrowserPersist);
          persist.persistFlags = persistFlags;
          dl =  mozAddDownload(uri, IOS.newFileURI(file), file.leafName, persist);
          if (dl instanceof CI.nsIWebProgressListener) persist.progressListener = dl;
          else continue;

          postStream = this._streamify(l.postData || postData, l.postContentType);
          var extraHeaders = "";
          if (l.extraHeaders) {
            for (var p in l.extraHeaders) {
              extraHeaders += p + ": " + l.extraHeaders[p] + "\r\n";
            }
          }
          if (!extraHeaders) { extraHeaders = null; }
          if ("savePrivacyAwareURI" in persist) { // Gecko >= 19
            if ("REFERRER_POLICY_ORIGIN_WHEN_XORIGIN" in CI.nsIHttpChannel) { // Gecko >= 36
              persist.savePrivacyAwareURI(uri, l.cacheKey || null,
                links.refURI, CI.nsIHttpChannel.REFERRER_POLICY_ORIGIN_WHEN_XORIGIN,
                postStream, extraHeaders, file, fg.inPrivate);
            } else {
              persist.savePrivacyAwareURI(uri, l.cacheKey || null,
                links.refURI, postStream, extraHeaders, file, fg.inPrivate);
            }
          } else {
            persist.saveURI(uri, l.cacheKey || null,
                  links.refURI, postStream, extraHeaders, file);
          }
        } catch (e) {
          fg.log("Skipping link " + l.href + ": " + e);
        }
      }

      if (JSDownloadsAPI) return;

      if(dm.endBatchUpdate) dm.endBatchUpdate();
      if(dm.flush) dm.flush();

      if(this.getPref("showDM", true)) {
        try { // SeaMonkey
          dm.open(links.browserWindow, dl);
        } catch(notSeamonkey) {

          const DMBRANCH = "browser.download.manager.";
          var prefs = fg.prefService.getBranch(DMBRANCH);
          try {
            if (!(prefs.getBoolPref("showWhenStarting")))
              return;
          } catch(noPref) {
            return;
          }

          try { // 1.9 (Toolkit)
             // http://mxr.mozilla.org/seamonkey/source/toolkit/components/downloads/src/nsDownloadProxy.h#94
             var dmui = CC["@mozilla.org/download-manager-ui;1"].getService(CI.nsIDownloadManagerUI);
             var focus = false;
             try {
               focus = prefs.getBoolPref("focusWhenStarting");
             } catch(noPref) {}
             if (dmui.visible && !focus) {
               dmui.getAttention();
               return;
             }
             dmui.show(null, dl, CI.nsIDownloadManagerUI.REASON_NEW_DOWNLOAD);
          } catch(e1) {
            try { // 1.8 (Firefox 2)
              links.browserWindow.document.getElementById("Tools:Downloads").doCommand();
            } catch(e2) {
            }
          }
        }
      }
    };
  }

  FlashGotDMCust.init();

  fg.sortDMS();

  dm = null;
};
