function Shredder(exe, args) {
  if (typeof(exe) == "function") {
    this.exists = true;
    this.shred = exe;
    return this;
  } else if (exe instanceof CI.nsIFile) {
    this.exe = exe;
  } else {
    this.exe = CC["@mozilla.org/file/local;1"].createInstance(CI.nsILocalFile);
    try {
      this.exe.initWithPath(exe);
    } catch(e) {
      dump(exe + e + "\n");
      return this;
    }
  }
  this.args = args;
  this.exists = this.exe.exists();
  return this;
}

Shredder.prototype = {
  exists: false,
  exe: null,
  shred: function(files) {
    if (!files.length) return;
    var p = CC['@mozilla.org/process/util;1'].createInstance(CI.nsIProcess);
    p.init(this.exe);
    var args = this.args.concat(files.map(function(f) { return f.path; }));
    p.run(false, args, args.length, {});
  }
}

Shredder.create = function(exe, args) {
  var s = new Shredder(exe, args);
  return s.exists ? s : null;
}

Shredder.instance = (function() {
  return fg.isMac && Shredder.create("/usr/bin/srm", ["-fm"]) ||
    fg.isWindows && Shredder.create((function() {
      var exe = fg.profDir.clone();
      exe.append("FlashGot.exe");
      return exe;
    })(), ["-s"]) ||
    Shredder.create("/usr/bin/shred", ["-fu"]) ||
    Shredder.create(function(files) {
      files.forEach(function(f) {
        try {
          f.remove(true);
        }
        catch(e) {
          dump("Couldn't remove " + f.path + ", " + e + "\n");
        }
      });
    });
})();

Shredder.shred = function(files) {
  return Shredder.instance.shred(files);
}

