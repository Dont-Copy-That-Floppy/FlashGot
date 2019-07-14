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

var RedirectContext = function(links, opType, dm, onfinish) {
  this.links = links;
  this.opType = opType;
  this.dm = dm;
  this.onfinish = onfinish || function() {};
  this.processedBy = {};
  this.redirects = 0;
  this.maxRedirects = 1;
  var srv = dm.service;
  this.processors = this.processors.filter(function(p){
    var enabledPref = "redir." + p.name + ".enabled";
    return srv.getPref(enabledPref, true) && dm.getPref(enabledPref, true);
  });
};

RedirectContext.prototype = {
  prefs: CC["@mozilla.org/preferences-service;1"].getService(CI.nsIPrefService).getBranch("flashgot.redir."),
  
  print: Components.utils && Components.utils.reportError || dump,
  log: function(msg) {
    this.print("[FlashGot Redirect Processor] " + msg);
  },
  process: function(links) {
    if(!links) links = this.links;
    try {
      this.start();
      for (j = links.length; j-- > 0;) {
        this.processLink(links[j]);
      }
    } catch(e) {
      this.log(e);
    } finally {
      this.done();
    }
  },
  
  processLink: function(l) {
    const processors = this.processors;
    l.redirects = [];
    l.redirected = false;
    for (var p = 0, plen = processors.length, j; p < plen; p++) {
      try {
        processors[p](l, this);
      } catch(e) {
        this.log(processors[p].name + ": " + e + " " + e.stack);
      }
    }
  },
  
  start: function() {
    this.redirects++;
    this._progress();
  },
  
  done: function() {
    if (--this.redirects == 0) {
      this.onfinish(this.processedBy);
    }
    this._progress();
  },
  
  getQueue: function(key) {
    key = (key || arguments.callee.caller.name) + ".queue";
    return (key in this) ? this[key] : this[key] = {
      _new: true,
      _q: [],
      _ctx: this,
      add: function(f) {
        if (typeof(f) !== "function") return false;
        this._ctx.start();
        this._q.push(f);
        return this._new && !(this._new = false);
      },
      consume: function() {
        const f = this._q.shift();
        if (f) {
          try {
            f();
          } finally {
            this._ctx.done();
          }
          return true;
        }
        return false;
      }
    };
  },
  
  _progress: function() {
    if(this.redirects > this.maxRedirects) this.maxRedirects = this.redirects;
    if(this.redirects >= 0) {
      this.links.progress.update(
          40 + 30 * (this.maxRedirects - this.redirects) / this.maxRedirects);
    }
  },
  
  change: function(l, newURL, processedBy, multiReplace, attrs) {
    this.processedBy[processedBy || arguments.callee.caller.name] = true;
    if (l.href == newURL || l.redirects.indexOf(newURL) > -1) return;
    l.redirects.push(l.href);
    
    if (!this.links.some(function(l) { return l.href == newURL })) {
      var nl, p;
      if (multiReplace) {
        nl = {};
        for(p in l) nl[p] = l[p];
        this.links.push(nl);
      } else {
        nl = l;
        l = null;
      }
      if (attrs) {
        for(p in attrs) nl[p] = attrs[p];
      }
      nl.href = newURL;
      nl.contentType = null; // prevent spidering
      nl.redirected = true;
      this.processLink(nl); // recursive processing
    }
    if (l) {
      var pos = this.links.indexOf(l);
      if (pos > -1) this.links.splice(pos, 1);
    }
  },
  
  createReq: function(method, url) {
    var xhr = CC["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(CI.nsIXMLHttpRequest);
    xhr.open(method, url);
    xhr.channel.loadFlags |= xhr.channel.INHIBIT_PERSISTENT_CACHING;
    if (fg.inPrivate) fg.privatize(xhr.channel);
    return xhr;
  },
  
  load: function(url, callbacks, data) {
    
    if (typeof(data) == "undefined") data = null;
    
    var req = this.createReq(data == null ?  "GET" :"POST", url);
   
    if (data != null) req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    
    if (typeof(callbacks) != "object") {
      callbacks = { ok: callbacks };
    }
    var context = this;
    callbacks.call = function(phase) {
      if (typeof(this[phase]) == "function") this[phase](req, context);
    }
    
    callbacks.call(0);
    
    req.addEventListener("readystatechange", function() {
      var phase = req.readyState;
      try {
        callbacks.call(phase);
      } catch(e) {
        context.log(e);
      }
      if (phase == 4) {
        try {
          if (req.status == 200) callbacks.call("ok");
        } catch(e) {
          context.log(e);
        } finally {
          context.done();
        }
      }
    }, false);
    
    this.start();
    try {
      req.send(data);
    } catch(e) {
      this.done();
    }
  },
  
  processors: [
    function anonym_to(l, context) { // anonym.to, anonymz.com, linkbucks.com
      var m = l.href.match(/^http:\/\/(?:[^\.\/]+\.)?(linkbucks\.com|anonym\.to|anonymz\.com)(?:\/?.*?)?\?.*?(http.*)/i);
      if (m) {
        var href = m[2];
        context.change(l, /^http%3a/i.test(href) ? unescape(href) : href, m[1].replace(".", "_"));
      }
    },
   
    
    function chooselinks_com(l, context) {
      if (/^https?:\/\/(?:[^\/]*\w\.)?(?:(?:chooselink|re-links)\.com|linksafe\.me)\//i.test(l.href)) {
        /* old style, let's keep it around just in case
        context.load(l.href, function(req) {
          var m = req.responseText.match(/\blocation(?:\.href)?\s*=\s*['"](https?:\/\/[^"']+)/);
          if (m) context.change(l, m[1], "chooselinks_com");
        });
        */
        context.start();
        context.sniffRedir(l.href, function(u) {
          context.change(l, u, 'chooselinks_com');
          context.done();
        });
      }
    },
    
    function filesonic_com(l, context) {
      if (/^https?:\/\/(?:[^\/]*\w\.)?(?:sharingmatrix|filesonic)\.com\/file\//i.test(l.href)) {
        const DELAY = 500;
        const q = context.getQueue();
        context.start();
        if (q.add(function() {
           context.sniffRedir(l.href, function(u) {
             context.change(l, u, 'filesonic_com');
             context.done();
             fg.delayExec(function() { q.consume(); }, DELAY);
           }, "GET", 0);
         }))
          q.consume();
      }
    },
    
    function ftp2share_net(l, context) {
        if (/^https?:\/\/ftp2share\.net\//.test(l.href)) {
          var processedBy = arguments.callee.name;
          context.load(l.href, function(req) {
            var mm = req.responseText.match(/javascript:\s*go\s*\(((["']).*\2)/g);
            if (mm) {
              for(var j = 0, len = mm.length; j < len; j++) {
                try {
                  context.change(l, atob(mm[j].replace(/[^A-Za-z0-9\+\/\=]|javascript:.*?go/g, "")), processedBy, true);
                } catch(e) {
                  context.log(e);
                }
              }
            }
          }, "download=true");
          
        }
    },
    
    function depositfiles_com(l, context) {
      if (/^http:\/\/(?:depositfiles\.(?:org|com)|dfiles\.eu)\//.test(l.href))
        context.load(l.href, function(req) {
          var m = req.responseText.match(/https?:\/\/[^"'\s]+(?:depositfiles\.(?:org|com)|dfiles\.eu)\/auth\-[^"' ]+/);
          if (m) context.change(l, m[0]);
        });
    },
    
    function fileserve_com(l, context) {
      if (/^http:\/\/(?:[^\.\/]+\.)?fileserve\.com\//.test(l.href) &&
          !("_fileservePost" in l)) {
        processedBy = arguments.callee.name;
        
        
        context.load(l.href, { "3": function(req) { 
          if (req.channel.URI.spec != l.href) {
            l._fileservePost = true;
            context.change(l, req.channel.URI.spec, processedBy);
          }
          req.abort(); // otherwise we download the whole file from the browser ;)
        }}, "download=premium"); // POST to same url
      }
    },
    
    function hideurl_biz(l, context) {
      if (/^http:\/\/hideurl\.biz\//.test(l.href)) {
        if (/\btype=r1/.test(l.href)) { // Rapidshare Free, skip
          context.links.splice(context.links.indexOf(l), 1);
          return;
        }
        var processedBy = arguments.callee.name;
        if (/\/link\.php/.test(l.href) && !/\btype=r2/.test(l.href)) {  // r2 = Rapidshare Premium
         if (context.sniffRedir(l.href, function(url) {
            if(url) context.change(l, url, processedBy);
            context.done();
            }))
            context.start();
        } else {
          context.load(l.href, function(req) {
            var m = req.responseText.match(/https?:\/\/(?:[^/]*\brapidshare\.|hideurl\.biz\/link\.php)[^'"]+/g);
            if (m) for (var u of m) context.change(l, u, processedBy, true);
          });
        }
      }
    },
    
    function imagebam_com(l, context) {
      if (/^http:\/\/[\\w\.]*?imagebam\.com\/image\/\w+/.test(l.href)) {
        context.load(l.href, function(req) {
          var m = req.responseText.match(/\bhttps?:\/\/[0-9]+\.imagebam\.com\/d(?:dl\.php\?ID=[^"']+|ownload\/[^"']+\?download=[^"']*)/i);
          if (m) context.change(l, m[0]);
        });
      }
    },
    
    function imagefap_com(l, context) {
      if (!/^https?:\/\/(?:[^\.\/]+\.)?imagefap\.com\/(?:gallery|pictures|photo)[\.\/]/.test(l.href))
        return;

      var processedBy = arguments.callee.name;
      if (/imagefap\.com\/photo\//.test(l.href)) {
        context.load(l.href, function(req) {
          var t = req.responseText;
          var url;
          var m = t.match(/return lD\(["']([^"']+)/i);
          if (m) {
            url = lD(m[1]);
          } else {
            m = t.match(/mainPhoto.*(http:\/\/[^"']+)/);
            if (!m) return;
            url = m[1];
          }
          
          m = t.match(/<title>([^\s>]+)\sin gallery\s*([^<]*)/);    
          
          context.change(l, url, processedBy, false, 
            m && { fname: m[1].replace(/[^\w\-\.]/g, '_'), description: m[2] });
          
          function lD(s) { 
            var s1 = unescape(s.slice(0, -1)); 
            var k = s.slice(-1); 
            var t = [];
            for(var j = 0; j < s1.length; j++) t.push(s1.charCodeAt(j) - k); 
            return unescape(String.fromCharCode.apply(String, t)); 
          }
        });
        return;
      }  
      var m = l.href.match(/\bimagefap\.com\/(?:pictures\/|gallery(?:\.php.*gid=|\/))(\d+)/);

      if (m) {
        var base = l.href.replace(/(\bimagefap\.com\/).*/, '$1');
        var pageURL = base + "pictures/" + m[1] + "/?view=2";

        context.load(pageURL, function(req) {
         
          var t = req.responseText.replace(/relatedgalleriescontainer[\s\S]+function\s+showMoreGalleries/, '');
         
          var m = t.match(/<a[^>]*"\/(?:image\.php|photo\/)?[^"]*/ig);
          if (!m) return;
          
          for (var j = 0; j < m.length; j++) {
            context.change(l, m[j].replace(/.*"\//, base).replace(/&amp;/g, '&'), processedBy, true);
          }
          
        });
      }
    },
    
    
    function imagevenue_com(l, context) {
      if (/^http:\/\/img\d+\.imagevenue\.com\/img\.php\?image=/.test(l.href)) {
        context.load(l.href, function(req) {
          var m = req.responseText.match(/<img[^>]*id="thepic"[^>]*SRC="([^"]+)/i);
          if (m) context.change(l, l.href.replace(/img\.php\?.*/, m[1]));
        });
       }
    },
    
    function lix_in(l, context) {
      if (/^http:\/\/lix\.in\//.test(l.href)) {
        var processedBy = arguments.callee.name;
        context.load(l.href, function(req) {
          var m = req.responseText.match(/<iframe[^>]*src\s*=\s*['"]([^"']+).*/);
          if (m) {
           context.change(l, m[1]);
           return;
          }

          var m = req.responseText.match(/name="in" value="[^"]+/g);
          if (m) {

            for (var s of m) {
              context.load(l.href, function(req) {
                 var m = req.responseText.match(/<iframe[^>]*src\s*=\s*['"]([^"']+).*/);
                 if (m) {
                   context.change(l, m[1], processedBy, true);
                 } else {
                   print(req.responseText);
                 }
              }, "in=" + escape(s.replace(/.*value="/, "")) + "&submit=continue");
              
            }
          }
          
        }, "tiny=" + escape(l.href.replace(/.*lix\.in\//, "")) + "&submit=continue");
      }
    },

    function link_protector_com(l, context) {
      if (!/^http:\/\/link-protector\.com\//.test(l.href)) return;
      function addRef(req) { req.setRequestHeader("Referer", context.links.referrer); }
      context.load(l.href,
        {
          0: addRef,
          1: addRef,
          ok: function(req) {
            var m = req.responseText.match(/yy\[i\]\s*-(\d+)[\S\s]+stream\(['"]([^'"]+)/);
            if (m) {
              function decode(t, x) {
                function stream(prom){var yy=new Array();for(i=0; i*4 <prom.length; i++){yy[i]=prom.substr(i*4,4);}yy.reverse();var xstream=new String;for (var i = 0; i < yy.length; i++){xstream+=String.fromCharCode(yy[i]-x);}return xstream;}
                return stream(t);
              }
              context.change(l, decode(m[2], m[1]).match(/="(https?:[^" ]+)/)[1]); 
            } else if((m = req.responseText.match(/<a href="(https?:[^" ]+)/))) {
              context.change(l, m[1]);
            }
          }
        });
    },
    
    function linkbank_eu(l, context) {
      if (!/^http:\/\/(?:[\w-]+\.)linkbank.eu\/show\.php/.test(l.href)) return;
      
      var posli = l.href.replace(/show.*/, "posli.php?match=");
      context.load(l.href, function(req) {
          var m = req.responseText.match(/posli\("\d+",\s*"\d+"\)/g);
          if (!m) return;
          for (var sm of m) {
            sm = sm.match(/posli\("(\d+)",\s*"(\d+)"\)/);
            if(context.sniffRedir(posli + sm[1] + "&id=" + sm[2], callback))
              context.start();
          }
      });
      
      var processedBy = arguments.callee.name;
      function callback(url) {
        if (url) context.change(l, url, processedBy, true)
        context.done();
      }
    },
    
    function linkbucks_com(l, context) {
      if (/^http:\/\/(?:[\w-]+\.)linkbucks\.com\/link\/[^?]*$/.test(l.href)) {
        context.load(l.href, function(req) {
          var m = req.responseText.match(/document\.location\.href\s*=\s*"(https?:\/\/[^"]*)/);
          if (m) context.change(l, m[1]);
        });
      }
    },

    function megaupload_com(l, context) {
      if (context.links.postData ||
          !/^http:\/\/(?:[\w-]+\.)?mega(?:upload|rotic)\.com\/.*\?d=/.test(l.href)
        ) return;
      var processor = arguments.callee;
      
      if (!processor._direct) {
        processor._direct = true;
        context.megauploadQueue = [];
        context.load(l.href.replace(/^(http.*?\/\/.*?\/).*/i, '$1?c=account'), function(req) {  
          dequeue();
        }, "do=directdownloads&accountupdate=1&set_ddl=1");
      }
      
      if (context.megauploadQueue) {
        context.megauploadQueue.push(l);
        return;
      }
      
      var force = false;
      try {
        force = context.prefs.getBoolPref("megaupload_com.force");
      } catch(e) {}
      
      if (force && context.sniffRedir(l.href,
        function(url) {
          context.change(l, url, processor.name);
          context.done();
        })) {
        context.start();
      }

      function dequeue() {
        var queue = context.megauploadQueue;
        if (queue) {
          context.megauploadQueue = null;
          for (l of queue) {
            try {
              context.start();
              processor(l, context);
            } finally {
              context.done();
            }
          }
        }
      }
    },
    
    function netload_in(l, context) {
      var m = l.href.match(/^http:\/\/netload\.in\/([^\/]+)\/.*(\.[a-z]+)$/);
      if (m) {
        context.change(l, "http://netload.in/" + m[1] + m[2]);
      }
    },
    
    function oron_com(l, context) {
      if (/^https?:\/\/(www\.)?oron\.com\/\w+/.test(l.href)) {
        var processedBy = arguments.callee.name;
        context.load(l.href, function(req) {
          var m = req.responseText.match(/<form[^>]+action=""[\s\S]+?<\/form>/i);

          if (!m) return;
          var data = [];


          for (var p of m[0].match(/<input[^>]+/g)) {
            m = p.match(/name="(.*)"\s*value="(.*?)"/);
            if (m) data.push(escape(m[1]) + "=" + escape(m[2]));
          }
          context.load(l.href, function(req) {
            var m = req.responseText.match(/<a[^>]+(https?:\/\/[^"'>]+)[^>]+\batitle\b/i);
            if (m) {
              context.change(l, m[1], processedBy);
            }
          }, data.join("&"));
        });
      }
    },
    
    function photobucket_com(l, context) {
      if (/^http:\/\/media\.photobucket\.com\/.*\b(?:image|video)\//.test(l.href)) {
        var processedBy = arguments.callee.name;
        context.load(l.href, function(req) {
          var m = req.responseText.match(/"video_src"[^>]*(http:\/\/[^"]+)/) ||
                  req.responseText.match(/"image_src"[^>]*(http:\/\/[^"]+)/);
          if (m) {
            var title = req.responseText.match(/<h2 id="mediaTitle">(.*)<\/h2>/);
            context.change(l, m[1], processedBy, false, title && {description: title[1]});
          }
        });
      }
    },
    
    function protectlinks_com(l, context) {
      if (/^https?:\/\/(?:[^\/]*\w\.)?(?:protectlinks\.com)\/\d+/i.test(l.href))
        context.load(l.href.replace(/\/(\d+)/,'/redirect.php?id=$1'), function(req) {
            var m = req.responseText.match(/<iframe[^>]*pagetext[^>]*(https?:\/\/[^"'>\s]*)/i);
            if (m) context.change(l, m[1].replace(/&#x([0-9a-f]+);/ig, 
                function($, $1) { return String.fromCharCode(parseInt("0x" + $1))}
                ).replace(/&amp;/g, '&'));
        });
    },
    
    function rapidbolt_com(l, context) {
      if (/^https?:\/\/(?:[^\/]*\w\.)?(?:rapidbolt|rsmonkey)\.com\//i.test(l.href))
        context.load(l.href, function(req) {
            var m = req.responseText.match(/\bhttps?:\/\/[^"'\s\/]*?\b(?:rapidshare|sharingmatrix|hotfile|oron)\.com[^"'\s]*/g);
            if (m) for (var url of m) context.change(l, url, "rapidbolt_com", true);
        });
    },
    
    
    function rapidshare_com(l, context) {      
      // base URL: http://rapidshare.com/files/123/xyz.rar
      // Sample API request: http://api.rapidshare.com/cgi-bin/rsapi.cgi?sub=download_v1&fileid=123&filename=xyz.rar&try=1&cbf=RSAPIDispatcher&cbid=1
      // Sample API response: RSAPIDispatcher(1,"DL:rs302tl2.rapidshare.com,SOMEHEXKEY,157,0");
      //                                            ^ host, dlauth, delaySecs, ???
      // Sample API wait response: RSAPIDispatcher(1,"You need to wait 862 seconds until you can download another file without having RapidPro.");
      // Sample download URL: http://rs302tl2.rapidshare.com/cgi-bin/rsapi.cgi?sub=download_v1&editparentlocation=0&bin=1&fileid=123&filename=xyz.rar&dlauth=SOMEHEXKEY
      
      if (!/^http:\/\/(?:[^\/]+\.)?rapidshare\.com\//.test(l.href)) return;
      
      const cm = fg.cookieManager;
      var cookieRef = {host: ".rapidshare.com", name: "enc", path: "/"};
      if (cm[("cookieExists" in cm) ? "cookieExists" : "findMatchingCookie"](cookieRef, {value: 0})) {
        for (var iter = cm.enumerator, cookie; iter.hasMoreElements();) {
          if (((cookie = iter.getNext()) instanceof CI.nsICookie) &&
              cookie.host === cookieRef.host && cookie.name === cookieRef.name) {
            fg.setPref("redir.rapidshare_com.cookie", cookie.value);
          }
        }
        return; // Rapid Pro logged in
      }
      var storedCookie = fg.getPref("redir.rapidshare_com.cookie");
      if (storedCookie) {
        cm.add(cookieRef.host, "/", cookieRef.name, storedCookie, false, false, true, Date.now() + 86400);
      }
      
      if (!("originalURL" in l)) l.originalURL = l.href;
      
      var m = l.href.match(/^http:\/\/rapidshare\.com\/files\/(\d+)\/(.*)/);
      
      if (m) {
        if ("rapidPro" in context) {
          if (!context.rapidPro) {
            context.change(l, "http://api.rapidshare.com/cgi-bin/rsapi.cgi?sub=download_v1&fileid=" +
                         m[1] + "&filename=" + m[2] + "&try=1&cbf=RSAPIDispatcher&cbid=1", "rapidshare_com");
          }
          return;
        }
        
        var xhr = context.createReq("GET", l.href);
        if (xhr.channel instanceof CI.nsIHttpChannel) xhr.channel.redirectionLimit = 0;
        xhr.addEventListener("readystatechange", function() {
          if (xhr.readyState != 4) return;
          if (xhr.status == 200 && xhr.channel.contentType == "text/html") {
            if (!/\bdelete/.test(xhr.responseText)) {
              context.rapidPro = false;
              rapidshare_com(l, context);
            }
          } else context.rapidPro = true;
          context.done();
        }, false);
        xhr.send(null);
        context.start();
      }
      
      m = l.href.match(/^http:\/\/api\.rapidshare\.com\/cgi-bin\/rsapi\.cgi\?sub=download_v1&fileid=([^&]+).*filename=([^&]+)/);
  
      if (m) {
        var fileid = m[1], filename = m[2]; 
        context.load(l.href, function(req) {
          var m = req.responseText.match(/"(.*)"/);
          if (!m) return;
          var res = m[1];
          if (/\bdelete/.test(res)) return;
          
          var secs;
          m = res.match(/^DL:([\w.-]+),([^,]+),(\d+)/);
          if (m) { // got download meta data!
            secs = parseInt(m[3]);
            var url = "http://" + m[1] +
                "/cgi-bin/rsapi.cgi?sub=download_v1&editparentlocation=0&bin=1&fileid=" + fileid +
                "&filename=" + filename + "&dlauth=" + m[2];
            if (secs === 0) {
              context.change(l, url, "rapidshare_com");
              return;
            }
            l.href = url;
          } else {
            m = res.match(/\d+(?=\s+sec)/);
            secs = m ? parseInt(m[0]) + 2 : 600;
          }
          // wait...
          
          if (!("rapidshareRetry" in context.links)) {
            const retryPref = "redir.rapidshare_com.defaultRetry";
            if (!(context.links.rapidshareRetry = fg.getPref(retryPref, false))) {
            
              const alwaysAsk = { value: true };
              const prompt = CC["@mozilla.org/embedcomp/prompt-service;1"].getService(CI.nsIPromptService);
              context.links.rapidshareRetry = 
                prompt.confirmEx(
                  DOM.mostRecentBrowserWindow,
                  "FlashGot - Rapidshare",
                  fg.getString("rapidshareRetry.confirm", [secs]),
                  prompt.STD_YES_NO_BUTTONS,
                  null,
                  null,
                  null,
                  fg.getString("alwaysAsk"),
                  alwaysAsk
                ) == 0;
              if (!alwaysAsk.value) {
                if (context.links.rapidshareRetry) {
                  fg.setPref(retryPref, true);
                } else {
                  fg.setPref("redir.rapidshare_com.enabled", false);
                }
              }
            }
          }
          
          if (context.links.rapidshareRetry) {
            context.links.splice(context.links.indexOf(l), 1);
            fg.delayExec(function() {
              var links = [l];
              links.rapidshareRetry = true;
              fg.download(links, fg.OP_ONE, fg.defaultDM);
            }, secs * 1000);
          } else {
            l.href = l.originalURL;
          }
          
        });

      }
    },
    
    function relink_us(l, context) {
      if (!/^https?:\/\/(?:[^\/]*\w\.)?relink\.us\/(?:f\/|.*\bid=)/.test(l.href) ||
          /\/(?:frame|getfile)/.test(l.href)) return;
      const cm = fg.cookieManager;
     
      const processedBy = arguments.callee.name;
      const p = processedBy in context ? context[processedBy] : context[processedBy] = {queue: [], running: false};
      const DELAY = 2500;
      const BASE = "http://relink.us/";
      const REP = BASE + "frame.php?$1";

      
      if (p.running) {
        p.queue.push(process);
      } else {
        process();
      }

      function process() {
        p.running = true;
        const origin = l.href;
        var links;
        delayedNext(function(req) {
          links = req.responseText.match(/\bgetFile\(.*?\)/g);
        });
        
        function next() {
          if (links) {
            var url = links.shift();
            if (url) {
              context.load(
                url.replace(/getFile\(['"](.*?)['"]\)/, REP), 
                handler
              );
              return;
            }
          }
          if (p.queue.length) (p.queue.shift())()
          else p.running = false;
        }
        
        function delayedNext(callback) {
          cm.remove("www.relink.us", "PHPSESSID", "/", false);
          context.load(origin, function(req) {
            context.start();
            fg.delayExec(function() {
            try {
              if (callback) callback(req);

              next();
            } catch(e) {
              fg.log(e);
            } finally {
              context.done();
            }
            }, DELAY); 
         });



        }
        
        const handler = {
          
          2: function onRedir(req) {
            var redir = req.channel.URI.spec;

            if (!/^https?:\/\/(?:[^\/]*\w\.)?relink\.us\//.test(redir)) {
              req.abort();  
              context.change(l, redir, processedBy, true);
            }
          },
          
          "ok": function onLoad(req) {
            try {
              var t = req.responseText;
  
              var m = t.match(/\beval\(.*?"([^"]+)"/); // base64 eval
              if (m) {
                try {
                  t = atob(m[1]);
                } catch(ex) {}
              }
              
              m = t.match(/"\d+"/g);
              if (m) {
              
                t = m.map(function(s) { return String.fromCharCode(parseInt(s.replace(/"/g, ''))) }).join('');
                
                m = t.match(/<iframe[^>]+(getfile[^'"]+)/i);
                if (m) {
                  context.load(BASE + m[1], handler);
                  return;
                }
                
                m = t.match(/http:\/\/[^"]*\/files[^"\s]+/);
                if (m) context.change(l, m[0], processedBy, true);
                else fg.log("Unparseable " + t);
              
              } 
              
              m = t.match(/<iframe[^>]+(http:\/\/[^"']+)/i);
              if (m) {
                context.change(l, m[1], processedBy, true);
              }
            } finally {
              delayedNext(); 
            }           
          }
        };
      }
    },
    
    function rsprotect_com(l, context) {
      if (/^https?:\/\/(?:[^\/]*\w\.)?(?:rsprotect\.com|rapidsafe\.net)\//i.test(l.href))
        context.load(l.href, function(req) {
            var m = req.responseText.match(/\baction\s*=["'\s]*?(https?:\/\/.*?rapidshare\.com[^"'\s]*)/i);
            if (m) context.change(l, m[1].replace(/&#x([0-9a-f]+);/ig, 
                function($, $1) { return String.fromCharCode(parseInt("0x" + $1))}));
        });
    },
    
    function shorten_ws(l, context) {
      if (/^http:\/\/[^\/]*shorten\.ws\//.test(l.href))
        context.load(l.href, function(req) {
          var m = req.responseText.match(/<table[^>]*shortURLTable[\s\S]*?<a[^>]*(https?:[^ ">]*)/);
          if (m) context.change(l, m[1]);
        });
    },
    
    function stealth_to(l, context) {

      var doc = context.links.document;
      if(!doc) return;

      var rx = /http:\/\/stealth\.to\/.*[&\?]id=/;
      if (!(rx.test(l.href) || 
          !context.stealth_to_topChecked && doc && rx.test(doc.URL))) 
        return;
      var stealth_to = arguments.callee;
      if(!context.stealth_to_topChecked) {
         context.stealth_to_topChecked = true;
         if(doc && rx.test(doc.URL) && 
            checkList(doc.documentElement.innerHTML)) 
           return;
      }
      
      var postData = context.links.postData || l.href.match(/&code=.*/) || null;
      if (postData) {
        l.href = l.href.replace(/&code=.*/, '');
        postData = postData.toString();
      }
     
      context.load(l.href, function(req) {
          checkAll(req.responseText);
        }, postData);
      
      function checkAll(html) {
        return checkCaptcha(html) || checkList(html) || checkAjax(html);
      }
    
      function checkCaptcha(html) {
        if (/<input[^>]*code/.test(html)) { // captcha page
          var docURL = l.href + "#FlashGot_Form";
          var ee, j, f;
          var renew = null;
          if(docURL == doc.URL) {
           renew = doc;
          } else {
            ee = doc.getElementsByTagName("iframe");
          
            for(j = ee.length; j-- > 0;) 
              if(ee[j].src == docURL) break;
            
            if(j >= 0) {
             f = ee[j];
             renew = f.contentDocument;
            } else {
              ee = doc.getElementsByTagName("a");
              for(var j = ee.length; j-- > 0;)
                if(ee[j].href == l.href) break;
       
              var a = j < 0 ? doc.body : ee[j];
              var f = doc.createElement("iframe");
              f.style.display = "block";
              f.style.width="350px";
              f.style.height="120px";
              f.style.borderStyle = "solid";
              f.style.borderColor = "orange";
              f.style.borderWidth = "2px";
              doc.defaultView.addEventListener("DOMFrameContentLoaded", function(ev) {
              var d = ev.target.contentDocument;
              if (!d.body) return;
              d.body.removeAttribute("onload");
              
              var f = d.getElementsByTagName("form")[0];
              d.body.insertBefore(f, d.body.firstChild);
              var ii = d.getElementsByTagName("img");
              for (var j = ii.length; j-- > 0;) {
                if (/captcha/.test(ii[j].src)) {
                  d.body.insertBefore(ii[j], f).style.display="block";
                  break;
                }
              }
              
              ii = d.getElementsByTagName("input");
              for(j = 0; j < ii.length; j++) f.appendChild(ii[j]);
              while(f.nextSibling) d.body.removeChild(f.nextSibling);
              ii = d.getElementsByTagName("link");
              for(j = 0; j < ii.length; j++) ii[j].href="data:";
              }, true);
              f.src = docURL;
              a.appendChild(f);
            }
          }
          
          if(renew) {
            // renew captcha
            ee = renew.getElementsByTagName("img");
             for(j = ee.length; j-- > 0;) 
               ee[j].src = ee[j].src + "?" + Date.now();
          }
          
          context.links.splice(context.links.indexOf(l), 1); 
          return true;
        }
        return false;
      }
      
      function checkList(html) {
        var m = html.match(/\bdownload\(['"]?\d+/g);
        if (m) {
          
          var nl, args, p;
          var ids = [];
          args = [ context.links.indexOf(l), 1 ]; // Array.splice parameters
          for (var id of m) {
            id = id.replace(/\D/g, '');
            if (ids.indexOf(id) > -1) continue;
            ids.push(id);
            // copy link;
            nl = {};
            for(p in l) nl[p] = l[p];
            nl.href = "http://stealth.to/index.php?go=download&id=" + id;  
            stealth_to(nl, context);
            args.push(nl); 
          }
          Array.prototype.splice.apply(context.links, args); // replace parent link with children
          if(/#FlashGot_Form$/.test(doc.URL))
          {
            // close iframe
            var ee = doc.defaultView.parent.document.getElementsByTagName("iframe");
            for(var j = ee.length; j-- > 0;) {
              if(ee[j].contentDocument == doc) {
                ee[j].parentNode.removeChild(ee[j]);
              }
            }
          }
          return true;
        }
        return false;
      }
      
      function checkAjax(html) {
        var parts = html.split("|||");
        if (parts.length < 2) return false;
        context.change(l, "http://" + parts[0]);
        return true;
      }
      
    }, 
    
    function tube_url(l, context) {
      if (/^http:\/\/(?:[^\/]+\.)*tubeurl\.com\//.test(l.href))
        context.load(l.href, function(req) {
          var m = req.responseText.match(/<meta[^>]*refresh[^>]*(https?:[^ ">]*)/i);
          if (m) context.change(l, m[1]);
        });
    },
    
    function tinyurl_com(l, context) { // tinyurl.com or moourl.com or downloads.sourceforge.net
      var m = l.href.match(/^https?:\/\/(?:(tiny|moo)url\.com|(?:[^\/\.]+\.)?sourceforge\.net)\//);
      if (!m) return;
      var processedBy = m[1] ? m[1] + "url_com" : "sf_net";
      
      if (processedBy == "sf_net" && /\/download$/.test(l.href)) {
        context.load(l.href, function(req) {
          var m = req.responseText.match(/\bhttp:\/\/downloads\.sourceforge\.net[^"']+/);
          if (m) context.change(l, m[0].replace(/&amp;/g, '&'), processedBy);
        });
        return;
      }
      
      var limit = processedBy == "sf_net" ? 0 : 20;
      var method = processedBy == "moourl_com" ? "GET" : "HEAD";
      var callback = function(url) {
        if (url) context.change(l, url, processedBy);
        context.done();
      };
      if (context.sniffRedir(l.href, callback, method,  limit)) {
        context.start();
      }
    },
    
    function uploaded_to(l, context) {
      if (/^http:\/\/ul\.to\//.test(l.href)) {
        context.change(l, l.href.replace("/ul.to/", "/uploaded.to/file/"));
      }
    },
    
    function uploading_com(l, context) {
      if (/^http:\/\/(?:[^\/]+\.)*uploading\.com\/files\//.test(l.href)) {
        
        function dequeue() {
          var l = context._uploading_com_queue.shift();
          if (!l) return;
          context.load(l.href, function(req) { // initial GET to set the file cookie
            context.done();
            var m = req.responseText.match(/\bdo_request\(.*\bfile_id:\s*(\d+),\s*code:\s*['"](\w+)/);
            if (m) {  
              context.load(
                l.href.replace(/\/files\/.*/, '/files/get/?JsHttpRequest=' + Date.now() + '-xml'),
                function(req) {
                  var m = req.responseText.match(/"link":\s*"(http[^"]+)/);
                  if (m) context.change(l, m[1].replace(/\\/g, ''), "uploading_com");
                  dequeue();
                }, "action=get_link&file_id=" + m[1] + "&code=" + m[2] + "&pass=undefined"
              );
              return;
            }
            dequeue();
            
          });
        }

        var m = l.href.match(/\buploading\.com\/files\/(\w+)\//);

        if (!m) return;
        var id = m[1];
        if ("_uploading_com_map" in context) {
          if (id in context._uploading_com_map) {
            var l0 = context._uploading_com_map[id];
            if (l0.href.length < l.href.length && l0.description == l0.href) {
              l0.href = l.href;
              l0.description = /^http:/.test(l.description) ? l.href : l.description;
            }
            context.links.splice(context.links.indexOf(l), 1);
            return;
          }
          context._uploading_com_queue.push(l);
        } else {
          context._uploading_com_queue = [l];
          context._uploading_com_map = {}; 
          dequeue();
        }
        context._uploading_com_map[id] = l;
        context.start();
      }
    },
    
    function urlcash_com(l, context) {
      if (/^http:\/\/(?:[^\/]+\.)*urlcash\.net\//.test(l.href)) {
        context.load(l.href, function(req) {
          var m = req.responseText.match(/(?:<meta[^>]*URL|<iframe[^>]+redirectframe[^>]+)=["']?(http[^'"]+)/i);
          if (m) context.change(l, m[1]);
        });
      }
    },
    
    function zshare_net(l, context) {
      if (/^http:\/\/(?:[^\/]+\.)*zshare\.net\/[a-z]+\/[a-z0-9]+\/$/.test(l.href)) {
        context.load(l.href.replace(/^(http:\/\/(?:[^\/]+\.)*zshare\.net\/)[a-z]+(\/.*)/, '$1download$2'),
        function(req) {
          var m = req.responseText.match(/Array\('([\s\S]*?)'\)/);
          if (m) context.change(l, m[1].split(/'\s*,\s*'/).join(''));
        }, "download=1&imageField=");
      }
    },
    
    function media(l, context) {
      if (!l.contentType) return;
      switch(l.contentType) {
        // see http://gonze.com/playlists/playlist-format-survey.html
        case "audio/mpegurl":
        case "audio/x-mpegurl":
        // case "video/x-ms-asf": // we should need to differentiate asx from asf, see MediaSniffer
        case "video/x-ms-asx":
        case "video/x-ms-wax":
        case "video/x-ms-wvx":
        case "audio/vnd.rn-realaudio":
        case "audio/x-pn-realaudio":
        case "application/smil":
        case "audio/x-scpls":
        break;
        default:
        return;
      }
      context.load(l.href,
        function(req) {
          var urls = req.responseText.match(/\b[a-z]{3,6}:\/\/[^\s<"']*/g);
          if (!urls) return;
          for (var u of urls) {
            context.change(l, u, "media", true);
          }
        });
    },
    
    function generic(l, context) {
      if (l.contentType || l.noRedir) return; // avoid jamming FlashGot Media or already redirected URLs
      
      if (typeof(context.genericRx) !== "object") {
        try {
          var exceptions = context.dm.service.getPref("redir.generic.exceptions", "");
          if (exceptions) context.genericExceptionsRx = new RegExp(exceptions.split(/\s+/).join("|"), "i");
        } catch (e) {}
        try {
          context.genericRx = new RegExp(context.dm.service.getPref("redir.generic.rx", null), "i");
        } catch(e) {
          context.genericRx = null;
        }
      }  
      if (context.genericRx === null) return;
      var url = l.href.replace(/\b(?:ref|orig|parent|from|s(?:ou)?rc)\w*=[^&]+/g, '');
      var m = !(context.genericExceptionsRx && context.genericExceptionsRx.test(url)) &&
              url.match(context.genericRx);
      if (m) {
        var href = m[1];
        context.change(l, (/^https?%3a/i.test(href) ? unescape(href) : href).replace(/^(https?):\/+/i, '$1://'), null, true); // latest arg -> add, rather than replace
      }
    }

  ],
  
  sniffRedir: function(url, callback, method, limit) {
    var ch = IOS.newChannel(url, null, null);
    if(!(ch instanceof CI.nsIHttpChannel)) return false;
    
    if (method && (method instanceof CI.nsIHttpChannel)) { // copy data from another channel
      var och = method;
      method = och.requestMethod;
      if (ch instanceof CI.nsIUploadChannel && och instanceof CI.nsIUploadChannel) {
        ch.loadFlags |= ch.LOAD_BYPASS_CACHE;
        och.uploadStream.seek(0, 0);
        ch.setUploadStream(och.uploadStream, och.getRequestHeader("Content-Type"), -1);
      } 
    }
    ch.requestMethod = method || "HEAD";
    ch.redirectionLimit = typeof(limit) == "undefined" ? 20 : limit;
    ch.asyncOpen(this.redirSniffer, {
       callback: callback,
       get wrappedJSObject() { return this; }
    });
    return true;
  },
  redirSniffer: {
    onStartRequest: function(req, ctx) {
      req.cancel(NS_BINDING_ABORTED);
    },
    onDataAvailable: function(req, ctx , stream , offset , count ) {
      req.cancel(NS_BINDING_ABORTED);
    },
    onStopRequest: function(req, ctx) {
      var url;
      if (req instanceof CI.nsIHttpChannel) {
        try {
          url = req.URI.resolve(req.getResponseHeader("Location"));
        } catch(e) {}
      }
      if (!url) {
        url = (req instanceof CI.nsIChannel) ? req.URI.spec : "";
      }
      ctx.wrappedJSObject.callback(url);
    }
  }
  
  
  
};
